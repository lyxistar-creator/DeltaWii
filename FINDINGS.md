# DeltaWii — rilievi misurati

Tutto quello che sta qui è stato **misurato** sui file in `game/`, non dedotto.
Data: 2026-08-26.

## Inventario (`game/`)

843 MB copiati da `C:\Program Files (x86)\Steam\steamapps\common\DELTARUNE`.
Esclusi i binari Windows (`DELTARUNE.exe`, `execute_program_pipe_x64.dll`,
`shader_replace_simple_x64.dll`, 7,1 MB) — inutili su Wii. 482 file, verificati
uno per uno contro la sorgente.

| percorso | dimensione | contenuto |
|---|---|---|
| `game/data.win` | 2,9 MB | selettore capitoli (**non** 13 MB) |
| `game/mus/` | 286 MB | 339 `.ogg` condivisi da tutti i capitoli |
| `game/chapter1_windows/` | 23 MB | `data.win` 12,5 MB + `audiogroup1.dat` 8,6 MB |
| `game/chapter2_windows/` | 74 MB | `data.win` 63,8 MB + `audiogroup1.dat` 7,0 MB |
| `game/chapter3_windows/` | 146 MB | `data.win` 120,4 MB + `audiogroup1.dat` 7,4 MB + `vid/` |
| `game/chapter4_windows/` | 137 MB | `data.win` 125,9 MB + `audiogroup1.dat` 6,7 MB |
| `game/chapter5_windows/` | 177 MB | `data.win` 157,8 MB + `audiogroup1.dat` 6,7 MB + `vid/` |

454 `.ogg`, 4 `.mp4` (2 in ch3, 2 in ch5 — entrambe le coppie sono EN/JP dello
stesso video), 6 `lang/lang_{en,ja}.json`.

## Formato TXTR — domanda #3 chiusa

**Le entry TXTR hanno stride 28 byte, e il puntatore ai dati sta a `+24`.**
Ecco perché `+4` (layout Undertale) e `+8` non funzionavano.

```c
struct TxtrEntry_bc17 {   /* 28 byte */
    u32 scaled;           /* +0  */
    u32 generatedMips;    /* +4  */
    u32 blockSize;        /* +8  lunghezza del blob compresso */
    u32 width;            /* +12 */
    u32 height;           /* +16 */
    u32 indexInGroup;     /* +20 */
    u32 dataOffset;       /* +24 offset assoluto nel file */
};
```

## I dati texture NON sono PNG — sono bzip2 + QOI

Questa è la scoperta che cambia il preprocessore. Al `dataOffset` c'è:

```c
struct TexBlob {          /* 12 byte di header */
    char magic[4];        /* "2zoq" */
    u16  width;           /* combacia con l'entry TXTR */
    u16  height;
    u32  uncompressedSize;
    /* poi: stream bzip2 ("BZh9"), lungo blockSize-12 */
};
```

Decomprimendo lo stream bzip2 si ottiene un QOI in variante GameMaker:

```c
struct GmQoi {            /* 12 byte, NON i 14 del QOI standard */
    char magic[4];        /* "fioq" — "qoif" a byte invertiti */
    u16  width;           /* little-endian, non big-endian */
    u16  height;
    u32  streamLength;    /* = len(decompresso) - 12, verificato */
    /* poi: stream QOI, senza i campi channels/colorspace */
};
```

**Validazione**: 190 texture su 190 (tutti e 6 gli eseguibili). Per ognuna:
`uncompressedSize` combacia esattamente con l'output di bzip2; magic `fioq`;
width/height del QOI combaciano con quelli dell'entry TXTR. Zero eccezioni.

Conseguenza: il preprocessore texture di WiiTale (che si aspetta PNG) va
riscritto attorno a **bzip2 + QOI**, non a `stb_image`. Il decoder QOI va scritto
a mano perché l'header è diverso da quello standard.

## Dimensioni delle pagine atlas — il problema GX è confermato

Distribuzione (190 pagine totali):

| dimensione | conteggio |
|---|---|
| 2048×2048 | 134 |
| 512×512 | 16 |
| 256×256 | 10 |
| 1024×2048 | 4 |
| 32×32 | 7 |
| 512×1024 | 3 |
| altre (64×64, 256×64, 128×128, 128×256, 1024×1024, 128×1) | 16 |

**134 pagine su 190 sono 2048×2048**, cioè il 70%. Il limite di 1024×1024 di
`GX_InitTexObj` morde su quasi tutto: il tiling in 4 e il disegno a pezzi degli
sprite a cavallo delle cuciture non è un caso limite, è il percorso normale.

Solo il capitolo 1: 7 pagine 2048×2048 su 9.

## Bytecode

Tutti e 6 gli eseguibili sono **bytecode 17** (byte `+1` di GEN8), come previsto.

## Chunk presenti nel `data.win` del capitolo 1

`GEN8 OPTN LANG EXTN SOND AGRP SPRT BGND PATH SCPT GLOB SHDR FONT TMLN OBJT
FEDS ACRV SEQN TAGS ROOM DAFL EMBI TPAG TGIN CODE VARI FUNC FEAT STRG TXTR AUDO`

Note rispetto a Undertale: ci sono `TGIN` (texture group info, 4,8 KB — serve a
sapere quali pagine appartengono a quale gruppo, utile per lo streaming), `FEAT`,
`FEDS`, `SEQN`, `ACRV`. C'è anche un `AUDO` da 6,4 MB *dentro* il `data.win` del
capitolo 1, oltre agli 8,6 MB di `audiogroup1.dat` — quindi l'audio è **diviso
fra i due**, non solo negli audiogroup.

## Cosa resta incerto

- **Formato `audiogroup1.dat`**: non aperto. Il `SOND` del `data.win` presumibilmente
  indicizza per `groupID`, ma non l'ho verificato.
- **Come si spartiscono `AUDO` interno e `audiogroup1.dat`**: misurato che
  esistono entrambi, non misurato quale suono sta dove.
- **`TGIN`**: presente, contenuto non decodificato.
- **Stream QOI**: ho validato solo l'header. Non ho ancora decodificato i pixel,
  quindi non so se GameMaker usa gli opcode QOI standard o li ha modificati.
- **Se Cinnamon regge il bytecode 17 di Deltarune**: il numero di versione combacia,
  ma non ho verificato che l'insieme di opcode e i tipi di chunk usati siano quelli
  che Cinnamon sa leggere.
