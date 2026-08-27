// GameMaker's QOI variant, decoded to RGBA8.
//
// This is a straight port of decodeQoi() in src/image/image_decoder.c, kept
// deliberately line-for-line with it: the console decodes the same streams with that
// code, so any divergence here would produce a texture pack that does not match what
// the game would have drawn.
//
// It is not stock QOI. The header is 12 bytes rather than 14 (little-endian 16-bit
// width and height, then the stream length, and no channels/colorspace fields), and
// the opcode set is the older pre-1.0 draft: RUN_8/RUN_16 instead of QOI_OP_RUN, a
// three-byte DIFF_24 that also carries alpha, and a COLOR opcode with a channel mask.

const HEADER_SIZE = 12;

// Sign-extend the low "bits" bits of val to an 8-bit two's-complement value.
function signExtend(val, bits) {
    const mask = 1 << (bits - 1);
    return ((val ^ mask) - mask) & 0xff;
}

export function readQoiHeader(buf, offset = 0) {
    if (offset + HEADER_SIZE > buf.length) return null;
    if (buf[offset] !== 0x66 || buf[offset + 1] !== 0x69 ||
        buf[offset + 2] !== 0x6f || buf[offset + 3] !== 0x71) return null; // "fioq"
    return {
        width: buf[offset + 4] | (buf[offset + 5] << 8),
        height: buf[offset + 6] | (buf[offset + 7] << 8),
        length: buf.readUInt32LE(offset + 8),
    };
}

// Returns { width, height, data } where data is RGBA8, or throws.
export function decodeQoi(buf, offset = 0, size = buf.length - offset) {
    const head = readQoiHeader(buf, offset);
    if (!head) throw new Error("not a GameMaker QOI stream (missing 'fioq')");
    const { width, height, length } = head;
    if (width <= 0 || height <= 0) throw new Error(`bad QOI dimensions ${width}x${height}`);
    if (HEADER_SIZE + length > size) {
        throw new Error(`QOI stream claims ${length} bytes but only ${size - HEADER_SIZE} are present`);
    }

    const px = offset + HEADER_SIZE;
    const end = px + length;
    const raw = Buffer.alloc(width * height * 4);

    // The rolling 64-entry cache, keyed on r^g^b^a.
    const index = new Uint8Array(64 * 4);

    let pos = px;
    let run = 0;
    let r = 0, g = 0, b = 0, a = 255;

    for (let o = 0; o < raw.length; o += 4) {
        if (run > 0) {
            run--;
        } else if (pos < end) {
            const b1 = buf[pos++];

            if ((b1 & 0xc0) === 0x00) {
                // QOI_INDEX
                const i = (b1 & 0x3f) << 2;
                r = index[i]; g = index[i + 1]; b = index[i + 2]; a = index[i + 3];
            } else if ((b1 & 0xe0) === 0x40) {
                // QOI_RUN_8
                run = b1 & 0x1f;
            } else if ((b1 & 0xe0) === 0x60) {
                // QOI_RUN_16
                run = (((b1 & 0x1f) << 8) | buf[pos++]) + 32;
            } else if ((b1 & 0xc0) === 0x80) {
                // QOI_DIFF_8 -- 2-2-2 signed deltas on r,g,b
                r = (r + signExtend((b1 >> 4) & 3, 2)) & 0xff;
                g = (g + signExtend((b1 >> 2) & 3, 2)) & 0xff;
                b = (b + signExtend(b1 & 3, 2)) & 0xff;
            } else if ((b1 & 0xe0) === 0xc0) {
                // QOI_DIFF_16 -- 5-4-4 signed deltas on r,g,b
                const b2 = buf[pos++];
                const merged = (b1 << 8) | b2;
                r = (r + signExtend((merged >> 8) & 0x1f, 5)) & 0xff;
                g = (g + signExtend((merged >> 4) & 0x0f, 4)) & 0xff;
                b = (b + signExtend(merged & 0x0f, 4)) & 0xff;
            } else if ((b1 & 0xf0) === 0xe0) {
                // QOI_DIFF_24 -- 5-5-5-5 signed deltas, alpha included
                const b2 = buf[pos++];
                const b3 = buf[pos++];
                const merged = (b1 << 16) | (b2 << 8) | b3;
                r = (r + signExtend((merged >> 15) & 0x1f, 5)) & 0xff;
                g = (g + signExtend((merged >> 10) & 0x1f, 5)) & 0xff;
                b = (b + signExtend((merged >> 5) & 0x1f, 5)) & 0xff;
                a = (a + signExtend(merged & 0x1f, 5)) & 0xff;
            } else if ((b1 & 0xf0) === 0xf0) {
                // QOI_COLOR -- raw bytes for the channels whose flag bit is set
                if (b1 & 8) r = buf[pos++];
                if (b1 & 4) g = buf[pos++];
                if (b1 & 2) b = buf[pos++];
                if (b1 & 1) a = buf[pos++];
            }

            const i2 = ((r ^ g ^ b ^ a) & 63) << 2;
            index[i2] = r; index[i2 + 1] = g; index[i2 + 2] = b; index[i2 + 3] = a;
        }

        raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }

    return { width, height, data: raw };
}

// Reads the cache file gmtex.py writes. Returns an array of
// { width, height, offset, size } with width === 0 for pages that carry no data.
export function readQoiCache(buf) {
    if (buf.toString("latin1", 0, 4) !== "QCH1") throw new Error("not a QCH1 cache file");
    const count = buf.readUInt32LE(4);
    const pages = [];
    for (let i = 0; i < count; i++) {
        const o = 8 + i * 16;
        pages.push({
            width: buf.readUInt32LE(o),
            height: buf.readUInt32LE(o + 4),
            offset: buf.readUInt32LE(o + 8),
            size: buf.readUInt32LE(o + 12),
        });
    }
    return pages;
}
