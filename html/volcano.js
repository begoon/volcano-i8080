"use strict";

// ═══════════════════════════════════════════════════════════════════
// VOLCANO (ВУЛКАН) — HTML5 Canvas
// Faithful port from the i8080 assembly (1987) for Radio-86RK
//
// All physics use the original 8.8 fixed-point arithmetic.
// All timers use original game-tick counts.
// The 7-tick frame divider mirrors the assembly's human_hands_timer.
// ═══════════════════════════════════════════════════════════════════

// ─── Display grid ────────────────────────────────────────────────
const COLS = 78;
const ROWS = 30;
const FW = 64;
const FH = 25;
const FOX = 7;
const FOY = 3;

// ─── Tick rate (adjustable with [ / ]) ───────────────────────────
let TICK_HZ = 6;
let TICK_MS = 1000 / TICK_HZ;

// ─── Assembly constants ──────────────────────────────────────────
const N_STONES = 10;
const N_BULLETS = 10; // 0x0A
const LAVA_RESET = 10; // 0x0A ticks (at 1/7 rate)
const LAVA_LEVELS = 16; // 0x10, counts down
const CARRY_TICKS = 40; // 0x28 (at 1/7 rate)
const SWING_START = 10; // 0x0A (last 10 slow-ticks: J/L swing)
const WAVE_PERIOD = 7; // human_hands_timer reset value
const MAX_SOULS = 4;
const SL = 55;
const SR = 62;
const SROOF = 16;
const HX0 = 58;
const HY0 = 15;

// ─── Terrain ─────────────────────────────────────────────────────
const terrainSet = new Set();
const tKey = (x, y) => y * FW + x;

function buildTerrain() {
    [37, 38, 39, 40].forEach((c) => terrainSet.add(tKey(c, 9)));
    [35, 36, 41].forEach((c) => terrainSet.add(tKey(c, 10)));
    const L = {
        11: [34],
        12: [33],
        13: [32],
        14: [27, 28, 29, 30, 31],
        15: [26],
        16: [25],
        17: [23, 24],
        18: [18, 19, 20, 21, 22],
        19: [16, 17],
        20: [14, 15],
        21: [9, 10, 11, 12, 13],
        22: [7, 8],
        23: [2, 3, 4, 5, 6],
        24: [0, 1],
    };
    const R = {
        11: [42],
        12: [43],
        13: [44],
        14: [45, 46],
        15: [47],
        16: [48],
        17: [49, 50],
        18: [51],
        19: [52],
        20: [53, 54],
    };
    for (const [r, cs] of Object.entries(L)) cs.forEach((c) => terrainSet.add(tKey(c, +r)));
    for (const [r, cs] of Object.entries(R)) cs.forEach((c) => terrainSet.add(tKey(c, +r)));
}

// Lava bounds per row [left, right] inclusive
const LAVA = {
    9: [37, 40],
    10: [35, 41],
    11: [34, 42],
    12: [33, 43],
    13: [32, 44],
    14: [27, 46],
    15: [26, 47],
    16: [25, 48],
    17: [23, 50],
    18: [18, 51],
    19: [16, 52],
    20: [14, 54],
    21: [9, 54],
    22: [7, 54],
    23: [2, 54],
    24: [0, 54],
};

// Lava table (assembly lava_levels): [count, row, col, humanRow, humanCol]
// lava_level counts DOWN from 15 to 0
const LAVA_TABLE = [
    [55, 24, 0, 0, 0],
    [53, 23, 2, 22, 3],
    [48, 22, 7, 0, 0],
    [46, 21, 9, 20, 10],
    [41, 20, 14, 0, 0],
    [37, 19, 16, 0, 0],
    [34, 18, 18, 17, 19],
    [28, 17, 23, 0, 0],
    [24, 16, 25, 0, 0],
    [22, 15, 26, 0, 0],
    [20, 14, 27, 13, 28],
    [13, 13, 32, 0, 0],
    [11, 12, 33, 0, 0],
    [9, 11, 34, 0, 0],
    [7, 10, 35, 0, 0],
    [4, 9, 37, 0, 0],
];

// People: [col, row, platformRow] (from animate_person_wave calls)
const PDEF = [
    [3, 22, 23],
    [10, 20, 21],
    [19, 17, 18],
    [28, 13, 14],
];

// ─── Collision ───────────────────────────────────────────────────
function isLava(x, y) {
    if (y < 9 || y > currentLavaRow) return false;
    const b = LAVA[y];
    return b != null && x >= b[0] && x <= b[1];
}
function isStation(x, y) {
    if (y === SROOF && x >= SL && x <= SR) return true;
    return y > SROOF && (x === SL || x === SR);
}
function isSolid(x, y) {
    return terrainSet.has(tKey(x, y)) || isLava(x, y) || isStation(x, y);
}
// Screen-buffer style: is this cell empty (space)?
function cellFree(x, y) {
    if (x < 0 || x >= FW || y < 0 || y >= FH) return false;
    return !terrainSet.has(tKey(x, y)) && !isLava(x, y) && !isStation(x, y);
}

// ─── Canvas ──────────────────────────────────────────────────────
const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
let cellW, cellH, fontSize;

function resize() {
    const dpr = window.devicePixelRatio || 1;
    ctx.font = "100px monospace";
    const ratio = ctx.measureText("M").width / 100;
    fontSize = Math.floor(Math.min(window.innerHeight / ROWS, window.innerWidth / (COLS * ratio)));
    cellH = fontSize;
    cellW = fontSize * ratio;
    const pw = Math.ceil(COLS * cellW);
    const ph = Math.ceil(ROWS * cellH);
    canvas.style.width = pw + "px";
    canvas.style.height = ph + "px";
    canvas.width = Math.ceil(pw * dpr);
    canvas.height = Math.ceil(ph * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ─── Screen buffer ───────────────────────────────────────────────
const screen = Array.from({ length: ROWS }, () => new Array(COLS).fill(" "));
function screenClear() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) screen[r][c] = " ";
}
function screenPut(c, r, ch) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) screen[r][c] = ch;
}
function fieldPut(c, r, ch) {
    screenPut(FOX + c, FOY + r, ch);
}
function screenStr(c, r, s) {
    for (let i = 0; i < s.length; i++) screenPut(c + i, r, s[i]);
}
function screenCenter(r, s) {
    screenStr(Math.floor((COLS - s.length) / 2), r, s);
}
function screenFlush() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, COLS * cellW, ROWS * cellH);
    ctx.fillStyle = "#fff";
    ctx.font = fontSize + "px monospace";
    ctx.textBaseline = "top";
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (screen[r][c] !== " ") ctx.fillText(screen[r][c], c * cellW, r * cellH);
}

// ─── Title art ───────────────────────────────────────────────────
const TITLE = [
    "V.....V. .OOOOO.. L....... .CCCCC.. ......A. N.....N. .OOOOO..",
    "V....V.. O.....O. L....... C.....C. .....AA. NN....N. O.....O.",
    "V...V... O.....O. L....... C....... ....A.A. N.N...N. O.....O.",
    "V..V.... O.....O. L....... C....... ...A..A. N..N..N. O.....O.",
    "V.V..... O.....O. L....... C....... ..A...A. N...N.N. O.....O.",
    "VV...... O.....O. L....... C.....C. .AAAAAA. N....NN. O.....O.",
    "V....... .OOOOO.. LLLLLLL. .CCCCC.. A.....A. N.....N. .OOOOO..",
];

// ─── RNG (simple, matches assembly's uniform [0..max]) ───────────
function rng(max) {
    return Math.floor(Math.random() * (max + 1));
}

// ─── 8.8 fixed-point stone ──────────────────────────────────────
// Each stone: { xVel, xPos, yVel, yPos } as 16-bit unsigned ints
// High byte = integer, low byte = fraction
function initStone() {
    const colOff = rng(3); // 0-3
    const col = 0x25 + colOff; // 37-40
    const frac = rng(0xff); // x_pos_lo
    // x_vel computation (exact assembly algorithm)
    let a = ((frac & 0xfc) | colOff) & 0xff;
    a = ((a >> 2) | ((a & 3) << 6)) & 0xff; // two RRC
    a = (a - 0x80) & 0xff; // sui 80h
    const xVelLo = a;
    const xVelHi = a & 0x80 ? 0xff : 0x00; // sbb a (sign extension)
    // y_vel_lo from assembly: xra c; sui 83h
    const yVelLo = ((xVelHi ^ xVelLo) - 0x83) & 0xff;
    return {
        xVel: ((xVelHi << 8) | xVelLo) & 0xffff,
        xPos: ((col << 8) | frac) & 0xffff,
        yVel: (0xff00 | yVelLo) & 0xffff, // y_vel_hi = 0xFF (-1)
        yPos: 0x0800, // row 8
    };
}

function updateStone(s) {
    // x_pos += x_vel
    const xSum = s.xPos + s.xVel;
    s.xPos = xSum & 0xffff;
    // y_vel += 1 (gravity)
    s.yVel = (s.yVel + 1) & 0xffff;
    // y_pos += y_vel
    s.yPos = (s.yPos + s.yVel) & 0xffff;
    // integer positions
    const col = (s.xPos >> 8) & 0xff;
    const row = (s.yPos >> 8) & 0xff;
    // bounds check (assembly: col >= 64 or row >= 25 → respawn)
    if (col >= 64 || row >= 25) {
        Object.assign(s, initStone());
        return null; // respawned
    }
    return { col, row };
}

// ─── Game state ──────────────────────────────────────────────────
let state; // title|playing|exp_fast|exp_slow|falling|respawn|gameover
let hx, hy, hdir; // helicopter cockpit position and direction
let hAlive;
let hangChar; // 0 = not carrying, or 'I'/'J'/'L'
let hangTimer; // carry countdown (at 1/7 rate)
let lives, rescued;
let lavaLevel; // counts DOWN from 15 to 0
let currentLavaRow; // the lowest row filled with lava (9 = peak only)
let lavaTimer; // counts down from 10 (at 1/7 rate)
let divider; // human_hands_timer: 7-tick frame divider
let waveTog; // person wave toggle
let stones, bullets, souls;
let people; // [{col, row, alive}]
let fallingCol, fallingRow; // falling person (-1 = none)
let expRadius, expDir, expCx, expCy, expCb;
let overMsg;
let respawnTicks;

function resetGame() {
    hx = HX0;
    hy = HY0;
    hdir = 0; // 0 = left (assembly: 0), 0xFF = right
    hAlive = true;
    hangChar = 0;
    hangTimer = 0;
    lives = 3;
    rescued = 0;
    lavaLevel = LAVA_LEVELS; // starts at 16, counts down
    currentLavaRow = 8; // no lava rows filled yet (peak at 9)
    lavaTimer = LAVA_RESET;
    divider = WAVE_PERIOD;
    waveTog = false;
    stones = [];
    for (let i = 0; i < N_STONES; i++) stones.push(initStone());
    bullets = [];
    souls = [];
    people = PDEF.map(([c, r, pr]) => ({ col: c, row: r, pRow: pr, alive: true }));
    fallingRow = -1;
    fallingCol = -1;
    overMsg = "";
    respawnTicks = 0;
}

// ─── Input ───────────────────────────────────────────────────────
let keyQ = [];
document.addEventListener("keydown", (e) => {
    const dominated = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "Enter",
        "BracketLeft",
        "BracketRight",
    ];
    if (dominated.includes(e.code)) e.preventDefault();
    keyQ.push(e.code);
});
function popKey() {
    const k = keyQ.length ? keyQ[keyQ.length - 1] : null;
    keyQ = [];
    return k;
}

// ─── Helicopter cells ────────────────────────────────────────────
function heliCells() {
    const d = hdir; // 0=left, 0xFF=right
    const cells = [
        [hx - 1, hy - 1, "-"],
        [hx, hy - 1, "+"],
        [hx + 1, hy - 1, "-"],
    ];
    if (d) {
        // right: +-O
        cells.push([hx - 2, hy, "+"], [hx - 1, hy, "-"], [hx, hy, "O"]);
    } else {
        // left: O-+
        cells.push([hx, hy, "O"], [hx + 1, hy, "-"], [hx + 2, hy, "+"]);
    }
    return cells;
}
function heliBounds() {
    return heliCells().map(([x, y]) => [x, y]);
}

// ─── Drawing ─────────────────────────────────────────────────────
function drawBorder() {
    const x1 = FOX - 1;
    const y1 = FOY - 1;
    const x2 = FOX + FW;
    const y2 = FOY + FH;
    screenPut(x1, y1, "+");
    screenPut(x2, y1, "+");
    screenPut(x1, y2, "+");
    screenPut(x2, y2, "+");
    for (let x = x1 + 1; x < x2; x++) {
        screenPut(x, y1, "-");
        screenPut(x, y2, "-");
    }
    for (let y = y1 + 1; y < y2; y++) {
        screenPut(x1, y, "|");
        screenPut(x2, y, "|");
    }
}
function drawTerrain() {
    for (const k of terrainSet) fieldPut(k % FW, Math.floor(k / FW), "X");
}
function drawLava() {
    for (let r = 9; r <= currentLavaRow; r++) {
        const b = LAVA[r];
        if (b) for (let c = b[0]; c <= b[1]; c++) fieldPut(c, r, "+");
    }
}
function drawStation() {
    for (let c = SL; c <= SR; c++) fieldPut(c, SROOF, "=");
    for (let r = SROOF + 1; r < FH; r++) {
        fieldPut(SL, r, "!");
        fieldPut(SR, r, "!");
    }
    for (let i = 0; i < rescued; i++) fieldPut(SL + 1 + i, SROOF + 1, "I");
    const spare = Math.max(0, lives - 1);
    const sy = [20, 22];
    for (let i = 0; i < Math.min(spare, sy.length); i++) {
        const r = sy[i];
        const c = 58;
        fieldPut(c - 1, r - 1, "-");
        fieldPut(c, r - 1, "+");
        fieldPut(c + 1, r - 1, "-");
        fieldPut(c, r, "O");
        fieldPut(c + 1, r, "-");
        fieldPut(c + 2, r, "+");
    }
}
function drawPeople() {
    for (const p of people) if (p.alive) fieldPut(p.col, p.row, waveTog ? "Y" : "I");
}
function drawStones() {
    for (const s of stones) {
        const c = (s.xPos >> 8) & 0xff;
        const r = (s.yPos >> 8) & 0xff;
        if (c < 64 && r < 25) fieldPut(c, r, "*");
    }
}
function drawSouls() {
    for (const s of souls) {
        fieldPut(s[1], s[0], "(");
        fieldPut(s[1] + 1, s[0], ")");
    }
}
function drawBullets() {
    for (const b of bullets) fieldPut(b[1], b[0], "-");
}
function drawHeli() {
    if (!hAlive) return;
    for (const [x, y, ch] of heliCells()) fieldPut(x, y, ch);
    if (hangChar) fieldPut(hx, hy + 1, String.fromCharCode(hangChar));
}
function drawHud() {
    screenCenter(1, "Lives: " + lives + "  Rescued: " + rescued + "/" + PDEF.length + "  [" + TICK_HZ + " Hz]");
}
function drawWorld() {
    screenClear();
    drawBorder();
    drawTerrain();
    drawLava();
    drawStation();
    drawPeople();
    drawStones();
    drawSouls();
    drawBullets();
    drawHeli();
    drawHud();
    if (fallingRow >= 0) fieldPut(fallingCol, fallingRow, "Y");
}
function drawExplosionRing(cx, cy, radius) {
    // 8 directions with doubled X offset (assembly: add a before dad d)
    const dirs = [
        [0, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [-1, -1],
    ];
    for (const [dx, dy] of dirs) {
        const c = cx + dx * radius * 2;
        const r = cy + dy * radius;
        if (c >= 0 && c < FW && r >= 0 && r < FH) fieldPut(c, r, ".");
    }
}

// ─── End condition ───────────────────────────────────────────────
function checkEnd() {
    if (rescued === PDEF.length) {
        overMsg = "YOU WIN! All " + PDEF.length + " rescued!";
        state = "gameover";
        return true;
    }
    const alive = people.filter((p) => p.alive).length;
    const carrying = hangChar ? 1 : 0;
    if (alive === 0 && carrying === 0) {
        overMsg = "GAME OVER  -  Rescued " + rescued + "/" + PDEF.length;
        state = "gameover";
        return true;
    }
    return false;
}

// ─── Crash sequence ──────────────────────────────────────────────
function startCrash() {
    const cx = hx;
    const cy = hy;
    const hadPerson = hangChar !== 0;
    hAlive = false;
    hangChar = 0;
    lives--;
    // fast explosion (expanding 0→31)
    expCx = cx;
    expCy = cy;
    expRadius = 0;
    expDir = 1;
    expCb = () => {
        if (hadPerson) {
            // slow explosion (contracting 32→0) then soul
            expRadius = 32;
            expDir = -1;
            expCb = () => {
                if (souls.length < MAX_SOULS) souls.push([cy, cx]);
                afterCrash();
            };
            state = "exp_slow";
        } else {
            afterCrash();
        }
    };
    state = "exp_fast";
}
function afterCrash() {
    if (lives <= 0) {
        overMsg = "GAME OVER  -  Rescued " + rescued + "/" + PDEF.length;
        state = "gameover";
    } else {
        respawnTicks = Math.floor(TICK_HZ * 0.5); // ~0.5s respawn delay
        state = "respawn";
    }
}

// ─── Process bullets (called twice per tick, assembly-faithful) ──
// Assembly checks screen buffer char at new position:
//   space → continue, '*' → stone hit, 'O' → crash,
//   'I'/'Y' → person kill, anything else → bullet removed
function processBullets() {
    bullets = bullets.filter((b) => {
        const row = b[0];
        const nc = b[1] + b[2];
        if (nc < 0 || nc >= FW) return false;
        b[1] = nc;
        // Solid obstacle: remove bullet
        if (terrainSet.has(tKey(nc, row)) || isStation(nc, row) || isLava(nc, row)) return false;
        // Stone collision
        for (const s of stones) {
            const sc = (s.xPos >> 8) & 0xff;
            const sr = (s.yPos >> 8) & 0xff;
            if (sc === nc && sr === row) {
                Object.assign(s, initStone()); // respawn stone
                return false; // bullet consumed
            }
        }
        // Person collision
        for (const p of people) {
            if (p.alive && p.col === nc && p.row === row) {
                killPerson(p);
                return false;
            }
        }
        return true;
    });
}

// ─── Process stones ──────────────────────────────────────────────
function processStones() {
    for (const s of stones) {
        const pos = updateStone(s);
        if (!pos) continue; // respawned
        const { col, row } = pos;
        // Check stone vs bullet
        for (let j = bullets.length - 1; j >= 0; j--) {
            if (bullets[j][0] === row && bullets[j][1] === col) {
                bullets.splice(j, 1);
                Object.assign(s, initStone()); // respawn stone
                break;
            }
        }
        // Check stone vs any helicopter cell (rotor, body, cockpit)
        if (hAlive) {
            for (const [bx, by] of heliBounds()) {
                if (col === bx && row === by) {
                    startCrash();
                    return;
                }
            }
        }
    }
}

// ─── Soul movement (integer, assembly-faithful) ──────────────────
function moveSouls() {
    for (const s of souls) {
        let [row, col] = s;
        let nr = row;
        let nc = col;
        // Vertical: random(0..2), dcr → -1/0/+1
        const vr = rng(2) - 1;
        if (vr === 1) {
            // parity odd → seek helicopter vertically
            if (hAlive) {
                nr = row + (hy > row ? 1 : hy < row ? -1 : 0);
            }
        } else {
            nr = row + vr;
        }
        if (nr < 0 || nr >= FH) nr = row;
        // Horizontal: random(0..1)
        if (rng(1) === 1 && hAlive) {
            nc = col + (hx > col ? 1 : hx < col ? -1 : 0);
        }
        if (nc < 0 || nc >= 63) nc = col;
        // Check destination (both cells of "()" must be free)
        if (cellFree(nc, nr) && cellFree(nc + 1, nr)) {
            s[0] = nr;
            s[1] = nc;
        }
        // Check collision with helicopter
        if (hAlive) {
            const sr = s[0];
            const sc = s[1];
            if (
                (sr === hy && (sc === hx || sc + 1 === hx)) ||
                // also check rotor and tail cells
                heliBounds().some(([bx, by]) => by === sr && (bx === sc || bx === sc + 1))
            ) {
                startCrash();
                return;
            }
        }
    }
}

// ─── Create soul at position ─────────────────────────────────────
function spawnSoul(row, col) {
    if (souls.length < MAX_SOULS) souls.push([row, col]);
}

// ─── Person kill (lava, bullet, etc.) ────────────────────────────
function killPerson(p) {
    p.alive = false;
    spawnSoul(p.row, p.col);
}

// ─── Process lava (assembly-faithful) ────────────────────────────
function processLava() {
    lavaLevel--;
    if (lavaLevel < 0) return;
    const entry = LAVA_TABLE[lavaLevel];
    currentLavaRow = entry[1];
    // Check if person on this ledge
    if (entry[3] !== 0) {
        for (const p of people) {
            if (p.alive && p.row === entry[3] && p.col === entry[4]) {
                killPerson(p);
            }
        }
    }
}

// ─── Main game tick (assembly game_loop equivalent) ──────────────
function tickPlaying() {
    const key = popKey();

    // Speed adjustment
    if (key === "BracketRight") {
        TICK_HZ = Math.min(200, TICK_HZ + 5);
        TICK_MS = 1000 / TICK_HZ;
    }
    if (key === "BracketLeft") {
        TICK_HZ = Math.max(10, TICK_HZ - 5);
        TICK_MS = 1000 / TICK_HZ;
    }

    // ── Process bullets (first pass) ──
    processBullets();

    // ── Move stones ──
    processStones();
    if (state !== "playing") return;

    // ── Process bullets (second pass — assembly does this twice) ──
    processBullets();

    // ── Update falling person (every tick, like assembly) ──
    if (fallingRow >= 0) {
        const below = fallingRow + 1;
        if (below >= FH || isSolid(fallingCol, below)) {
            // Person landed: explosion + soul
            spawnSoul(fallingRow, fallingCol);
            fallingRow = -1;
            checkEnd();
        } else {
            fallingRow = below;
        }
    }

    // ── Process helicopter ──
    if (hAlive) {
        const ox = hx;
        const oy = hy;
        let moved = false;

        if (key === "ArrowUp") {
            hy--;
            moved = true;
        } else if (key === "ArrowDown") {
            hy++;
            moved = true;
        } else if (key === "ArrowLeft") {
            hdir = 0;
            hx--;
            moved = true;
        } else if (key === "ArrowRight") {
            hdir = 0xff;
            hx++;
            moved = true;
        } else if (key === "Space" && bullets.length < N_BULLETS) {
            // Fire from cockpit in facing direction
            const dx = hdir ? 1 : -1;
            bullets.push([hy, hx + dx, dx]);
        }

        // Clamp
        hx = Math.max(2, Math.min(FW - 3, hx));
        hy = Math.max(1, Math.min(FH - 2, hy));

        // Deposit check (before collision)
        if (hangChar && hy + 1 === SROOF && hx >= SL && hx <= SR) {
            hangChar = 0;
            hangTimer = 0;
            rescued++;
            if (checkEnd()) return;
        }

        // Collision check
        if (moved) {
            let crash = false;
            let blocked = false;
            for (const [cx, cy] of heliBounds()) {
                if (cx < 0 || cx >= FW || cy < 0 || cy >= FH) {
                    crash = true;
                    break;
                }
                if (terrainSet.has(tKey(cx, cy)) || isLava(cx, cy)) {
                    crash = true;
                    break;
                }
                if (cy === SROOF && cx >= SL && cx <= SR) {
                    blocked = true;
                    continue;
                }
                if (cy > SROOF && (cx === SL || cx === SR)) {
                    crash = true;
                    break;
                }
            }
            if (crash) {
                hx = ox;
                hy = oy;
                startCrash();
                return;
            }
            if (blocked) {
                hx = ox;
                hy = oy;
            }
        }

        // Pickup check: cockpit directly above person
        if (!hangChar) {
            for (const p of people) {
                if (p.alive && p.col === hx && p.row === hy + 1) {
                    p.alive = false;
                    hangChar = 0x49; // 'I'
                    hangTimer = CARRY_TICKS;
                    break;
                }
            }
        }
    }

    // ── Souls print (every tick in assembly — drawing handled in render) ──
    // Soul vs helicopter collision (also every tick via screen buffer in asm,
    // but movement is only every 7th tick)
    if (hAlive) {
        for (const s of souls) {
            const sr = s[0];
            const sc = s[1];
            for (const [bx, by] of heliBounds()) {
                if (by === sr && (bx === sc || bx === sc + 1)) {
                    startCrash();
                    return;
                }
            }
        }
    }

    // ── 7-tick divider (human_hands_timer) ──
    divider--;
    if (divider > 0) {
        // Fast path: skip slow systems
        drawWorld();
        screenCenter(ROWS - 1, "Arrows: move  Space: fire  [/]: speed");
        screenFlush();
        return;
    }

    // ── Slow systems (every 7th tick) ──
    waveTog = !waveTog;
    divider = WAVE_PERIOD;

    // Move and check souls
    if (souls.length > 0) {
        moveSouls();
        if (state !== "playing") return;
    }

    // Lava timer
    lavaTimer--;
    if (lavaTimer <= 0) {
        processLava();
        lavaTimer = LAVA_RESET;
        if (checkEnd()) return;
    }

    // Carry timer (only on slow ticks)
    if (hangChar) {
        hangTimer--;
        if (hangTimer <= 0) {
            // Person falls
            fallingRow = hy + 1;
            fallingCol = hx;
            hangChar = 0;
        } else if (hangTimer < SWING_START) {
            // Toggle J/L swing
            hangChar = hangChar === 0x4a ? 0x4c : 0x4a;
        }
    }

    // Render
    drawWorld();
    screenCenter(ROWS - 1, "Arrows: move  Space: fire  [/]: speed");
    screenFlush();
}

// ─── Explosion ticks ─────────────────────────────────────────────
function tickExplosion() {
    popKey();
    drawWorld();
    drawExplosionRing(expCx, expCy, expRadius);
    screenFlush();
    expRadius += expDir;
    const done = expDir > 0 ? expRadius >= 32 : expRadius < 0;
    if (done) expCb();
}

// ─── Respawn ticks ───────────────────────────────────────────────
function tickRespawn() {
    popKey();
    // Continue physics during respawn
    processBullets();
    processStones();
    if (state !== "respawn") return;
    processBullets();
    divider--;
    if (divider <= 0) {
        waveTog = !waveTog;
        divider = WAVE_PERIOD;
        if (souls.length > 0) moveSouls();
        lavaTimer--;
        if (lavaTimer <= 0) {
            processLava();
            lavaTimer = LAVA_RESET;
            checkEnd();
        }
    }
    if (state !== "respawn") return;
    drawWorld();
    screenFlush();
    respawnTicks--;
    if (respawnTicks <= 0) {
        hx = HX0;
        hy = HY0;
        hdir = 0;
        hAlive = true;
        hangChar = 0;
        hangTimer = 0;
        state = "playing";
    }
}

// ─── Title / Game Over ───────────────────────────────────────────
function tickTitle() {
    const k = popKey();
    if (k === "Space" || k === "Enter") {
        resetGame();
        state = "playing";
        return;
    }
    screenClear();
    const ax = Math.floor((COLS - TITLE[0].length) / 2);
    for (let i = 0; i < TITLE.length; i++)
        for (let j = 0; j < TITLE[i].length; j++) if (TITLE[i][j] !== ".") screenPut(ax + j, 5 + i, TITLE[i][j]);
    screenCenter(15, "(C) 1987 BONY");
    screenCenter(17, "Radio-86RK  /  Intel 8080");
    screenCenter(19, "JavaScript remake by Alexander Demin 2026");
    screenCenter(21, "Arrows: move     Space: fire");
    screenCenter(23, "[  ]  adjust speed");
    screenCenter(25, "Press SPACE to start");
    screenFlush();
}
function tickGameOver() {
    const k = popKey();
    if (k === "Space" || k === "Enter") {
        resetGame();
        state = "playing";
        return;
    }
    drawWorld();
    const mr = Math.floor(FH / 2) + FOY;
    screenCenter(mr, overMsg);
    screenCenter(mr + 2, "Press SPACE to play again");
    screenFlush();
}

// ─── Main loop ───────────────────────────────────────────────────
let lastTs = 0;
let tickAccum = 0;

function mainLoop(ts) {
    requestAnimationFrame(mainLoop);
    const dt = ts - lastTs;
    lastTs = ts;
    tickAccum += dt;

    // Cap accumulated time to prevent spiral on tab switch
    if (tickAccum > 200) tickAccum = 200;

    while (tickAccum >= TICK_MS) {
        tickAccum -= TICK_MS;
        switch (state) {
            case "title":
                tickTitle();
                break;
            case "playing":
                tickPlaying();
                break;
            case "exp_fast":
            case "exp_slow":
                tickExplosion();
                break;
            case "respawn":
                tickRespawn();
                break;
            case "gameover":
                tickGameOver();
                break;
        }
    }
}

// ─── Init ────────────────────────────────────────────────────────
buildTerrain();
resize();
window.addEventListener("resize", resize);
state = "title";
requestAnimationFrame(mainLoop);
