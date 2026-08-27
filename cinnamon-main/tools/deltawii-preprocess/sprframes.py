#!/usr/bin/env python3
"""sprframes -- lists the texture-page rectangles that make up named sprites.

    python sprframes.py <data.win> <sprite-name> [more names...]

Prints JSON on stdout: one entry per sprite, each with its frames, and each frame with
the page it lives on and the rectangle to cut from it. Mirrors the SPRT layout that
src/data_win.c parses, including the GameMaker 2 "special" sprite header that sits
between the origin and the frame list.
"""
import json
import struct
import sys


def chunks(d):
    p, end, out = 8, 8 + struct.unpack_from('<I', d, 4)[0], {}
    while p + 8 <= end:
        n = d[p:p + 4].decode('latin1')
        s = struct.unpack_from('<I', d, p + 4)[0]
        out[n] = (p + 8, s)
        p += 8 + s
    return out


def gstr(d, ptr):
    if ptr == 0:
        return None
    n = struct.unpack_from('<I', d, ptr - 4)[0]
    return d[ptr:ptr + n].decode('utf-8', 'replace')


def tpag_at(d, offset):
    """A TPAG entry is 22 bytes of u16s, with the page id signed at the end."""
    sx, sy, sw, sh, tx, ty, tw, th, bw, bh = struct.unpack_from('<10H', d, offset)
    page = struct.unpack_from('<h', d, offset + 20)[0]
    return {'sourceX': sx, 'sourceY': sy, 'sourceW': sw, 'sourceH': sh,
            'targetX': tx, 'targetY': ty, 'targetW': tw, 'targetH': th,
            'boundW': bw, 'boundH': bh, 'page': page}


def read_sprite(d, ptr, is_gms2):
    spr = {}
    spr['name'] = gstr(d, struct.unpack_from('<I', d, ptr)[0])
    spr['width'], spr['height'] = struct.unpack_from('<2I', d, ptr + 4)
    spr['originX'], spr['originY'] = struct.unpack_from('<2i', d, ptr + 48)

    p = ptr + 56
    check = struct.unpack_from('<i', d, p)[0]
    p += 4

    if check == -1:
        # GameMaker 2 "special" header. Only sSpriteType 0 is a normal bitmap sprite.
        sversion, stype = struct.unpack_from('<2I', d, p)
        p += 8
        if stype != 0:
            return None
        if is_gms2:
            p += 8                       # playbackSpeed (f32) + playbackSpeedType (u32)
            if sversion >= 2:
                p += 4                   # sequenceOffset
                if sversion >= 3:
                    p += 4               # nineSliceOffset
            check = struct.unpack_from('<i', d, p)[0]
            p += 4
        else:
            check = 0

    count = check
    if count <= 0 or count > 4096:
        return None
    offs = struct.unpack_from('<%dI' % count, d, p)
    spr['frames'] = [tpag_at(d, o) for o in offs]
    return spr


def main():
    data = open(sys.argv[1], 'rb').read()
    wanted = set(sys.argv[2:])

    cl = chunks(data)
    major = struct.unpack_from('<I', data, cl['GEN8'][0] + 44)[0]
    is_gms2 = major >= 2

    off, _ = cl['SPRT']
    cnt = struct.unpack_from('<I', data, off)[0]
    ptrs = struct.unpack_from('<%dI' % cnt, data, off + 4)

    out = []
    for i, ptr in enumerate(ptrs):
        if ptr == 0:
            continue
        name = gstr(data, struct.unpack_from('<I', data, ptr)[0])
        if name not in wanted:
            continue
        spr = read_sprite(data, ptr, is_gms2)
        if spr is None:
            print('sprite %s is not a plain bitmap sprite' % name, file=sys.stderr)
            continue
        spr['index'] = i
        out.append(spr)

    missing = wanted - {s['name'] for s in out}
    if missing:
        print('not found: %s' % ', '.join(sorted(missing)), file=sys.stderr)
        sys.exit(1)

    json.dump(out, sys.stdout, indent=1)


if __name__ == '__main__':
    main()
