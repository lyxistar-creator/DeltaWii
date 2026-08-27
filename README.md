# DeltaWii

DELTARUNE Chapter 1, running natively on the Nintendo Wii.

It is the [Cinnamon](https://github.com/gemisis/butterscotch) GameMaker: Studio runner with
a backend written against libogc and the Hollywood's GX pipeline, built with devkitPPC. The
same backend also runs UNDERTALE, where it is called WiiTale.

**No game files are in this repository.** DELTARUNE is a commercial game; you supply your
own copy. This is the code that runs it.

## Status

Chapter 1 boots and plays: rooms, dialogue, battles, sound effects and streamed music all
work. Both games are locked to 30 frames per second, which is the rate they are authored
for.

Chapters 2 to 5 are not done. Each ships its own `data.win` and needs its own texture pack.

## What had to be worked out

Deltarune is not Undertale with different art, and four things had to be measured rather
than assumed.

**The texture entries are laid out differently.** Bytecode 17 gives each TXTR entry 28
bytes with the data pointer at `+24`, not the `+4` that bytecode 16 uses. Verified across
all 190 texture pages in all six executables.

**The textures are not PNG.** Each blob is a `2zoq` container holding a bzip2 stream that
decompresses to GameMaker's own QOI variant — a 12-byte header, little-endian dimensions,
and the pre-1.0 opcode set. The decoder in `src/image/image_decoder.c` already handled it;
the host-side preprocessor did not, and now does.

**134 of the 190 pages are 2048x2048.** GX cannot address a texture larger than 1024 in
either axis, so every page is cut into tiles and sprites spanning a seam are drawn in
pieces. On this game that is the normal path, not an edge case.

**The audio is in three places.** Chapter 1 keeps 56 sounds in the `data.win`'s own AUDO
chunk, 86 in `audiogroup1.dat`, and streams 9 more from `.ogg` files. A sound's index is
relative to its group, so a lookup has to carry the group with it.

More detail, with the measurements behind it, is in [FINDINGS.md](FINDINGS.md).

## Building

```
powershell -ExecutionPolicy Bypass -File cinnamon-main/build-wii.ps1
```

Needs devkitPPC. The wrapper exists because `powerpc-eabi-gcc.exe` reads the Windows `TMP`
variable, which Git Bash exports as a POSIX path that gcc cannot use.

## Preparing the assets

```
node cinnamon-main/tools/deltawii-preprocess/preprocess.mjs <data.win> textures.wtex
```

Needs Node and Python — Python does the bzip2 step, because Node has no bzip2 and the
standard library's is the same libbzip2 the console-side decoder uses.

Texture pages cannot be used as they ship: decoded to RGBA8 the chapter's nine pages come
to more than the Wii's entire 88 MB of RAM. Each page is quantised offline to a 256-colour
palette and stored as CI8 where that is lossless, which most pixel art is, and as raw
RGB5A3 where it would visibly band.

## SD card layout

```
sd:/apps/deltawii/boot.dol
sd:/apps/deltawii/meta.xml
sd:/apps/deltawii/data.win          the chapter's own file
sd:/apps/deltawii/audiogroup1.dat   likewise
sd:/apps/deltawii/textures.wtex     generated above
sd:/apps/deltawii/*.ogg             the chapter's sound effects
sd:/apps/deltawii/mus/              the music
sd:/apps/deltawii/lang/             the text
```

`usb:/apps/deltawii/` works too, and is searched after the SD card.

## Things worth knowing, all found the hard way

- **GX cannot address a texture larger than 1024x1024.** Nothing packed below row 1024 of
  a tall page renders without splitting it.
- **The loop must be paced, and paced with a fixed step.** The video interface returns at
  60 Hz and these games run at 30. Feeding the runner the measured elapsed time instead
  makes an expensive room run *faster*, so a scene's pace depends on how hard it is to draw.
- **Decoded Vorbis is big-endian, embedded WAV is little-endian.** They need different ASND
  voice formats; using one for the other is loud static, not silence.
- **`ASND_TestVoiceBufferReady` returns 1 when ready**, not `SND_OK`, which is 0. A
  streaming voice also needs a non-null callback or it stops after its first block.
- **`Runner.displayScaleX/Y` are never initialised by the shared code**, so the backend has
  to compute them or every view collapses to a zero-sized viewport.
- **The libogc console draws into a framebuffer.** Logging after the game starts drawing
  paints over the frame, so the console is switched off once the main loop begins.
- **Size the texture cache from what MEM2 actually has.** It was set to 24 MB while 43 MB
  were free, against a 40 MB texture pack: battles evicted tiles they needed again the same
  frame and re-read them off the card, which reads as the game running slowly when the
  cause is the disk.

## Licence

The Cinnamon runner keeps its own licence, in `cinnamon-main/LICENSE`. The Wii backend in
`cinnamon-main/src/wii/` and the tools in `cinnamon-main/tools/deltawii-preprocess/` are
new work in this repository.
