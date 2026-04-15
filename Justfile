# VOLCANO.GAM is the raw game binary (3840 bytes, loaded at 0x0100).
# tape/VOLCANO.GAM is a tape byte copy with a 5-byte prefix (E6 AA AA BB BB)
# where AAAA=start address, BBBB=end address, and a 3-byte trailer (E6 XX YY)
# where XXYY=checksum. The raw binary is extracted by stripping these.

ci: build test

build:
    bunx asm8080 --split -l volcano.asm

test:
    xxd VOLCANO.GAM >VOLCANO.GAM.hex
    xxd volcano.bin >volcano.bin.hex
    diff VOLCANO.GAM.hex volcano.bin.hex
