#!/usr/bin/env python3
"""rawlog -- pulls a file off a FAT image by walking its cluster chain by hand.

    python rawlog.py <image.raw> <name-prefix>

A normal reader refuses a file whose directory entry and cluster chain disagree, and that
is exactly the state a log is in when the console -- or the emulator running it -- was
stopped mid-write. The bytes are still there; only the bookkeeping is behind. This reads
them anyway, which is the difference between having the last thing the runner said and
having nothing.
"""
import struct
import sys


def main():
    img = open(sys.argv[1], 'rb')
    want = sys.argv[2].replace(' ', '').lower()

    boot = img.read(512)
    bps = struct.unpack_from('<H', boot, 11)[0]
    spc = boot[13]
    rsvd = struct.unpack_from('<H', boot, 14)[0]
    nfat = boot[16]
    fatsz = struct.unpack_from('<H', boot, 22)[0] or struct.unpack_from('<I', boot, 36)[0]
    root = struct.unpack_from('<I', boot, 44)[0]
    data_start = rsvd + nfat * fatsz
    cluster_bytes = bps * spc

    img.seek(rsvd * bps)
    fat = img.read(fatsz * bps)

    def nxt(c):
        return struct.unpack_from('<I', fat, c * 4)[0] & 0x0fffffff

    def offset(c):
        return (data_start + (c - 2) * spc) * bps

    def entries(cluster):
        out, c, guard = [], cluster, 0
        while 2 <= c < 0x0ffffff8 and guard < 64:
            img.seek(offset(c))
            buf = img.read(cluster_bytes)
            guard += 1
            for o in range(0, cluster_bytes, 32):
                if buf[o] == 0:
                    return out
                if buf[o] == 0xe5 or buf[o + 11] == 0x0f:
                    continue          # deleted, or a long-name record
                short = buf[o:o + 11].decode('latin1')
                first = (struct.unpack_from('<H', buf, o + 20)[0] << 16) | \
                        struct.unpack_from('<H', buf, o + 26)[0]
                size = struct.unpack_from('<I', buf, o + 28)[0]
                out.append((short, buf[o + 11], first, size))
            c = nxt(c)
        return out

    def find(cluster):
        for short, attr, first, size in entries(cluster):
            if short.startswith('.'):
                continue
            if attr & 0x10:
                hit = find(first)
                if hit:
                    return hit
            elif short.replace(' ', '').lower().startswith(want):
                return (short, first, size)
        return None

    hit = find(root)
    if hit is None:
        sys.exit('no file starting with %r on the card' % want)

    short, first, size = hit
    print('# %s: entry claims %d bytes, chain starts at cluster %d'
          % (short.strip(), size, first), file=sys.stderr)

    out, c, guard = b'', first, 0
    # Keep reading past the recorded size: that field is the part most likely to be stale.
    while 2 <= c < 0x0ffffff8 and guard < 8192:
        img.seek(offset(c))
        out += img.read(cluster_bytes)
        c = nxt(c)
        guard += 1

    sys.stdout.write(out.rstrip(b'\x00').decode('utf-8', 'replace'))


if __name__ == '__main__':
    main()
