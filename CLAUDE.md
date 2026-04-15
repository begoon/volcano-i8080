# CLAUDE.md

## Project

Annotated disassembly of "Volcano" (ВУЛКАН) — an i8080 game for the RK86 (Радио-86РК) computer, originally written in 1987.

## Build

```
just ci        # build + test
just build     # assemble only
just test      # compare against golden binary
```

Requires `bun` (for `bunx asm8080`) and `just`.

## Key files

- `volcano.asm` — the annotated disassembly (source of truth)
- `VOLCANO.GAM` — golden original binary (byte-for-byte reference)
- `volcano.bin` — assembled output (must match VOLCANO.GAM exactly)
- `volcano.lst` — assembler listing with addresses and symbol table
- `Justfile` — build recipes

## Rules

- **Every change must pass `just ci`** — the assembled binary must match VOLCANO.GAM byte-for-byte.
- When renaming a label (e.g. `sub_5B2` to `init_stone`), add `; offset=05B2h` comment to preserve the original address.
- Use `bunx asm8080 --split -l volcano.asm` to regenerate the listing and verify offsets against the symbol table.
- Comments and labels are free — only `db`/`dw`/instructions produce bytes.

## Formatting conventions

- 8-space indent for instructions and data
- Mnemonics padded to 4 chars: `mvi  a, 3` (not `mvi a, 3`)
- Arguments: `arg1, arg2` (comma-space)
- At least 5 spaces before inline `;` comments
- Comments aligned vertically within each code block
- Labels on their own line, `db`/`dw` on the next line
- Label offset annotations: `label_name:  ; offset=XXXXh`
- No tabs, spaces only
