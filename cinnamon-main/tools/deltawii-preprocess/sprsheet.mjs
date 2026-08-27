#!/usr/bin/env node
// sprsheet -- cuts named sprites out of a data.win and lays their frames out as one PNG.
//
//   node sprsheet.mjs <data.win> <out.png> <sprite-name> [more names...]
//
// This exists to be looked at. Pulling a character out of one game to draw in another is
// a chain of guesses -- the right sprite name, the right page, the right rectangle, the
// right decoder -- and every one of them fails silently into a plausible-looking mess.
// A contact sheet turns the whole chain into something that can be checked by eye before
// any of it reaches the console.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeQoi, readQoiCache } from "./qoi.mjs";
import { encodePng } from "./png-write.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function python(script, args) {
    for (const exe of ["python", "python3", "py"]) {
        const r = spawnSync(exe, [path.join(here, script), ...args],
                            { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
        if (r.error) continue;
        if (r.status !== 0) process.exit(r.status);
        return r.stdout;
    }
    console.error("no working python on PATH");
    process.exit(2);
}

const [dataWin, outPng, ...names] = process.argv.slice(2);
if (!dataWin || !outPng || names.length === 0) {
    console.error("usage: node sprsheet.mjs <data.win> <out.png> <sprite-name>...");
    process.exit(2);
}

const sprites = JSON.parse(python("sprframes.py", [dataWin, ...names]).toString());

// Decode only the pages the wanted frames actually live on. A full chapter has dozens of
// 2048x2048 pages and these sprites sit on one or two of them.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprsheet-"));
const cachePath = path.join(cacheDir, "pages.qoicache");
python("gmtex.py", [dataWin, cachePath]);
const cache = fs.readFileSync(cachePath);
const entries = readQoiCache(cache);

const pages = new Map();
function page(id) {
    if (pages.has(id)) return pages.get(id);
    const e = entries[id];
    if (!e || e.width === 0) throw new Error(`page ${id} has no data`);
    const img = decodeQoi(cache, e.offset, e.size);
    pages.set(id, img);
    console.log(`  decoded page ${id}: ${img.width}x${img.height}`);
    return img;
}

// One row per sprite, one column per frame.
const cell = { w: 0, h: 0 };
for (const s of sprites) {
    for (const f of s.frames) {
        cell.w = Math.max(cell.w, f.boundW || f.sourceW);
        cell.h = Math.max(cell.h, f.boundH || f.sourceH);
    }
}
const cols = Math.max(...sprites.map((s) => s.frames.length));
const PAD = 2;
const sheetW = cols * (cell.w + PAD) + PAD;
const sheetH = sprites.length * (cell.h + PAD) + PAD;

// A magenta ground, so a frame that decodes to nothing is obvious rather than blending
// into a black background the way transparent pixels would.
const sheet = Buffer.alloc(sheetW * sheetH * 4);
for (let i = 0; i < sheetW * sheetH; i++) {
    sheet[i * 4] = 255; sheet[i * 4 + 1] = 0; sheet[i * 4 + 2] = 255; sheet[i * 4 + 3] = 255;
}

sprites.forEach((s, row) => {
    console.log(`  ${s.name}: ${s.frames.length} frame(s), ${s.width}x${s.height}`);
    s.frames.forEach((f, col) => {
        const src = page(f.page);
        const dx0 = PAD + col * (cell.w + PAD) + (f.targetX || 0);
        const dy0 = PAD + row * (cell.h + PAD) + (f.targetY || 0);

        for (let y = 0; y < f.sourceH; y++) {
            for (let x = 0; x < f.sourceW; x++) {
                const sIdx = ((f.sourceY + y) * src.width + (f.sourceX + x)) * 4;
                const dIdx = ((dy0 + y) * sheetW + (dx0 + x)) * 4;
                if (dIdx < 0 || dIdx + 3 >= sheet.length) continue;
                sheet[dIdx]     = src.data[sIdx];
                sheet[dIdx + 1] = src.data[sIdx + 1];
                sheet[dIdx + 2] = src.data[sIdx + 2];
                sheet[dIdx + 3] = src.data[sIdx + 3];
            }
        }
    });
});

fs.writeFileSync(outPng, encodePng(sheet, sheetW, sheetH));
console.log(`wrote ${outPng} (${sheetW}x${sheetH}, ${sprites.length} row(s) x ${cols} column(s))`);
