#!/usr/bin/env python3
"""gmtex -- pulls the texture pages out of a Deltarune data.win.

    python gmtex.py <data.win> <out.qoicache>

Deltarune's TXTR blobs are not PNG. Each one is a "2zoq" container holding a bzip2
stream that decompresses to GameMaker's own QOI variant ("fioq"). Node has no bzip2,
so the decompression happens here -- bz2 is in the standard library and is the same
libbzip2 the console-side decoder uses -- and the QOI streams are handed to
preprocess.mjs through the cache file, which it decodes and quantises.

Cache layout, all little-endian:

    u32 magic     'QCH1'
    u32 count
    count * { u32 width; u32 height; u32 streamOffset; u32 streamSize }
    ... the raw "fioq" streams, back to back

A page with no data (an external texture) is written with width == 0.
"""

import bz2
import struct
import sys


def read_chunks(data):
    """Returns {name: (offset, size)} for the top-level FORM chunks."""
    if data[:4] != b'FORM':
        raise SystemExit('not a GameMaker WAD: no FORM magic')
    end = 8 + struct.unpack_from('<I', data, 4)[0]
    pos, out = 8, {}
    while pos + 8 <= end:
        name = data[pos:pos + 4].decode('latin1')
        size = struct.unpack_from('<I', data, pos + 4)[0]
        out[name] = (pos + 8, size)
        pos += 8 + size
    return out


def txtr_entries(data):
    """Reads the TXTR pointer table and the 28-byte entries behind it.

    Bytecode 17 lays an entry out as:
        +0 scaled  +4 generatedMips  +8 blockSize
        +12 width  +16 height  +20 indexInGroup  +24 dataOffset
    The data pointer is at +24, not at +4 the way bytecode 16 has it.
    """
    offset, _ = read_chunks(data)['TXTR']
    count = struct.unpack_from('<I', data, offset)[0]
    ptrs = struct.unpack_from('<%dI' % count, data, offset + 4)

    # Refuse to guess: a stride other than 28 means the layout is not the one above.
    strides = {ptrs[i + 1] - ptrs[i] for i in range(count - 1) if ptrs[i] and ptrs[i + 1]}
    if strides - {28}:
        raise SystemExit('unexpected TXTR entry strides %s (expected 28)' % sorted(strides))

    out = []
    for ptr in ptrs:
        if ptr == 0:
            out.append(None)
            continue
        scaled, mips, block, w, h, idx, data_off = struct.unpack_from('<7I', data, ptr)
        out.append({'width': w, 'height': h, 'blockSize': block, 'offset': data_off})
    return out


def decompress(data, entry, page):
    """2zoq container -> raw "fioq" QOI stream."""
    off, block = entry['offset'], entry['blockSize']
    magic = data[off:off + 4]
    if magic != b'2zoq':
        raise SystemExit('page %d: expected a 2zoq blob, found %r' % (page, magic))

    hdr_w, hdr_h = struct.unpack_from('<HH', data, off + 4)
    declared = struct.unpack_from('<I', data, off + 8)[0]
    if (hdr_w, hdr_h) != (entry['width'], entry['height']):
        raise SystemExit('page %d: container says %dx%d, TXTR entry says %dx%d'
                         % (page, hdr_w, hdr_h, entry['width'], entry['height']))

    raw = bz2.decompress(data[off + 12:off + block])
    if len(raw) != declared:
        raise SystemExit('page %d: bzip2 gave %d bytes, header declared %d'
                         % (page, len(raw), declared))
    if raw[:4] != b'fioq':
        raise SystemExit('page %d: decompressed to %r, not a fioq QOI' % (page, raw[:4]))

    qoi_w, qoi_h = struct.unpack_from('<HH', raw, 4)
    if (qoi_w, qoi_h) != (entry['width'], entry['height']):
        raise SystemExit('page %d: QOI says %dx%d, TXTR entry says %dx%d'
                         % (page, qoi_w, qoi_h, entry['width'], entry['height']))
    return raw


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: python gmtex.py <data.win> <out.qoicache>')
    src, dst = sys.argv[1], sys.argv[2]

    data = open(src, 'rb').read()
    entries = txtr_entries(data)
    print('%s: %d texture pages' % (src, len(entries)))

    table, streams, cursor, compressed = [], [], 0, 0
    for i, e in enumerate(entries):
        if e is None:
            table.append((0, 0, 0, 0))
            print('  page %2d: external, no data' % i)
            continue
        raw = decompress(data, e, i)
        table.append((e['width'], e['height'], cursor, len(raw)))
        streams.append(raw)
        cursor += len(raw)
        compressed += e['blockSize']
        print('  page %2d: %4dx%-4d  %7d B bz2 -> %8d B qoi'
              % (i, e['width'], e['height'], e['blockSize'], len(raw)))

    base = 8 + len(table) * 16
    out = bytearray()
    out += struct.pack('<4sI', b'QCH1', len(table))
    for w, h, off, size in table:
        out += struct.pack('<4I', w, h, 0 if w == 0 else base + off, size)
    for s in streams:
        out += s

    open(dst, 'wb').write(out)
    print('wrote %s  (%.1f MB bz2 -> %.1f MB qoi)'
          % (dst, compressed / 1048576, cursor / 1048576))


if __name__ == '__main__':
    main()
