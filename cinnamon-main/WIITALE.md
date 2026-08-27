# WiiTale

A native Nintendo Wii backend for the Cinnamon GameMaker: Studio runner, targeting
Undertale 1.08 (WAD/bytecode version 16).

## Building

```bash
powershell -ExecutionPolicy Bypass -File build-wii.ps1
```

Produces `wiitale.dol`. `build-wii.ps1 clean` removes the build tree.

The script exists because `powerpc-eabi-gcc.exe` is a native Windows binary and reads
Windows `TMP`. Git Bash exports that as a POSIX path, which gcc cannot use, so it falls
back to `C:\Windows\` and fails. The script sets the toolchain paths and a writable
Windows `TMP`, then runs `make -f Makefile.wii`.

## Preparing the assets

Texture pages cannot be used as they ship. Decoded to RGBA8 the 26 pages are 188 MB,
against 88 MB of total Wii RAM, and decoding a single 2048x2048 PNG needs about 37 MB of
scratch that does not exist on the console. The preprocessor converts them offline:

```bash
node tools/wiitale-preprocess/preprocess.mjs <path-to-data.win> textures.wtex
```

It needs nothing but Node — PNG decoding uses Node's own zlib.

Each page is converted to the format that suits it. Pages that fit inside 256 colours
become CI8 (one byte per texel plus a palette), which is lossless for pixel art; pages
whose palettised form exceeds an RMSE of 8 are kept as raw RGB5A3 instead, because the
banding would otherwise be visible. For Undertale that comes out as 21 CI8 pages and 5
RGB5A3 pages, 61 MB in total, with a largest page of 8 MB.

To check a generated pack against its source:

```bash
node tools/wiitale-preprocess/verify.mjs <path-to-data.win> textures.wtex
```

This re-reads the pack exactly the way `src/wii/wii_textures.c` does, untiles every page
and compares it to the original image. On Undertale 1.08, 20 of 26 pages come back
bit-exact and the worst page has an RMSE of 4.5.

## SD card layout

```
sd:/apps/wiitale/boot.dol       from dist/apps/wiitale/
sd:/apps/wiitale/meta.xml       from dist/apps/wiitale/
sd:/apps/wiitale/data.win       the game's own file
sd:/apps/wiitale/textures.wtex  generated above
sd:/apps/wiitale/*.ogg          the game's external music files
```

The runner also accepts `sd:/wiitale/`, `usb:/apps/wiitale/` and `usb:/wiitale/`.

## Controls

Held sideways, NES-style, which is the default:

| Wiimote | Action |
| --- | --- |
| D-pad | Move (rotated a quarter turn for the sideways grip) |
| 2 | Confirm (Z) |
| 1 | Cancel (X) |
| Minus | Menu (C) |
| Plus | Enter |
| HOME | Quit |

Nunchuk and Classic Controller are also handled; with a Nunchuk attached the d-pad is
read upright, since that is the only way the remote can be held.

On-screen prompts are rewritten to name Wii buttons, at draw time rather than in
`data.win`, so the game file is never modified. The table lives next to the input
mapping in `src/wii/wii_renderer.c` and has to be kept in step with it.

### Button combinations

| Combination | What it does |
| --- | --- |
| Minus + Plus | Toggle pointer steering |
| 1 + Plus | Open/close the room warp menu |
| Hold 1 + 2 | Show the texture cache inspector |

**Pointer steering** walks the player toward the cursor. It is not path-finding: there is
no collision map here, so the player walks straight at the target and leans on any wall in
between, exactly as if the d-pad were held. The player's real position is read from the
`obj_mainchara` instance and the cursor is mapped back through the view rectangle, so it
works in rooms that do not scroll. Losing sight of the sensor bar falls back to the d-pad
rather than stopping the player.

**The warp menu** lists all 336 rooms, including ones normally unreachable, three columns
by twelve across ten pages. Aim and press A to warp, d-pad left/right to page, B to close.
The game is not stepped while it is open, so nothing runs on unattended behind it.

## How memory is kept inside 88 MB

The Wii has 24 MB of MEM1 and 64 MB of MEM2. Undertale's `data.win` is 60 MB on its own,
so nothing is loaded whole:

- `TXTR` (12 MB) and `AUDO` (33 MB) are never parsed. Both are indexed and streamed.
- Rooms are parsed on demand (`lazyLoadRooms`).
- Texture pages live in a 24 MB MEM2 pool with least-recently-used eviction. GX has only
  16 hardware TLUT slots against 26 pages, so palette slots are tied to residency rather
  than to page identity, and that also caps how many pages can be resident.
- Sound effects live in a 10 MB MEM2 pool of fixed-size slots, read straight out of
  `data.win`. ASND has little-endian voice formats, so the WAV payload reaches the DSP
  with no conversion.
- Music is decoded from Ogg Vorbis a block at a time with stb_vorbis. 90 MB of music
  could not be resident, and decompressed it would be roughly a gigabyte.

## What is not implemented

- **Shaders.** The Hollywood has no programmable pipeline, only the TEV. The shader
  entry points report "unsupported" so GML that guards on `shaders_are_supported()`
  takes the correct branch.
- **`surface_getpixel` / `sprite_create_from_surface`.** Both need a CPU readback of the
  EFB that is not implemented; they report failure rather than returning wrong data.
- **`gpu_set_blendmode_ext` alpha factors.** GX applies one factor pair to colour and
  alpha together. The alpha factors are stored so the getter round-trips, but only the
  colour pair reaches the hardware.
- **`bm_max` / `bm_min`.** GX has no max or min blend equation; both approximate.

## Status

Runs in Dolphin: the intro, the Ruins, dialogue, battles, sound effects and streamed
music all work. Never yet run on real hardware, so the frame rate there is unknown --
Dolphin runs on a modern CPU while the Wii has to interpret GML bytecode, decode Vorbis
and draw on a 729 MHz PowerPC.

Things worth knowing, all of them found the hard way:

- **GX cannot address a texture larger than 1024x1024.** Pages are split into tiles and
  sprites spanning a seam are drawn in pieces. Nothing packed below row 1024 of a tall
  page renders without this.
- **The loop must be paced to the room's speed.** The video interface returns at 60 Hz and
  Undertale's rooms run at 30, so without pacing the whole game runs at double speed.
- **Decoded Vorbis is big-endian, embedded WAV is little-endian.** They need different
  ASND voice formats; using one for the other produces loud static, not silence.
- **`ASND_TestVoiceBufferReady` returns 1 when ready**, not `SND_OK` (which is 0), and a
  streaming voice needs a non-null callback or it stops after its first block.
- **`Runner.displayScaleX/Y` are never initialised by the shared code**, so the backend
  has to compute them or every view collapses to a zero-sized viewport.
- **The libogc console draws into a framebuffer.** Logging anything after the game starts
  drawing paints over the frame; the console is switched off once the main loop begins.
