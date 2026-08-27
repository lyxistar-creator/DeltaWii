// A minimal RGBA PNG writer. PNG is a handful of chunks around a zlib stream and Node
// has zlib built in, so this is cheaper than a dependency.

import zlib from "node:zlib";

let crcTable = null;
function crc32(buf) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return c ^ 0xffffffff;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
}

// `rgba` is width*height*4 bytes.
export function encodePng(rgba, width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type: RGBA
    // 10..12 stay zero: deflate, adaptive filtering, no interlace

    // Filter type 0 (none) on every scanline. The extra byte per row is not worth
    // optimising for images this small.
    const stride = width * 4;
    const raw = Buffer.alloc(height * (1 + stride));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + stride)] = 0;
        rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}
