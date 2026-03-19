"use strict";

// ================================================================
//  BLOCK BLAST NEO — CALAMITY BOSS EDITION
//  Full Game Engine - Senior-level Refactored
// ================================================================

/* ---------- POLYFILL: roundRect ---------- */
(function () {
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            if (typeof r === "number") r = [r, r, r, r];
            if (!Array.isArray(r)) r = [0, 0, 0, 0];
            const [tl, tr, br, bl] = r;
            this.moveTo(x + tl, y);
            this.lineTo(x + w - tr, y);
            this.quadraticCurveTo(x + w, y, x + w, y + tr);
            this.lineTo(x + w, y + h - br);
            this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
            this.lineTo(x + bl, y + h);
            this.quadraticCurveTo(x, y + h, x, y + h - bl);
            this.lineTo(x, y + tl);
            this.quadraticCurveTo(x, y, x + tl, y);
            this.closePath();
            return this;
        };
    }
})();

// ================================================================
//  CONSTANTS
// ================================================================
const GRID = 8;
const ASCENSION_SCORE = 100;
const BOSS_BASE_HP = 5000;
const MAX_BOSS_WAVES = 3;
const DRAG_ABOVE_PX = 50;
const SWORD_FLY_SPEED = 14;
const AUTO_SWORD_INTERVAL = 10000;   // ms
const BOSS_REVENGE_INTERVAL = 15000; // ms
const AUTO_SWORD_DAMAGE = 1000;
const BLOCKED_CELL = -1;

// ================================================================
//  DOM REFS
// ================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const canvasEl = $("#game-canvas");
const ctx = canvasEl.getContext("2d");
const cosmicEl = $("#cosmic-canvas");
const cosmicCtx = cosmicEl ? cosmicEl.getContext("2d") : null;

// ================================================================
//  ASSET MANIFEST
// ================================================================
const ASSET_MANIFEST = {
    boss:        { src: "boss-entity.png",  label: "DEITY SPRITE" },
    mainSword:   { src: "main-sword.png",   label: "JUDGMENT BLADE" },
    divineSword: { src: "divine-sword.png", label: "DIVINE SWORD" },
};

const IMG = {};
let allAssetsReady = false;

// ================================================================
//  SHAPE DEFINITIONS
// ================================================================
const SHAPE_DEFS = [
    { c: [[1,1],[1,1]],           clr: "#ff0055" },
    { c: [[1,1,1,1]],             clr: "#009dff" },
    { c: [[1],[1],[1],[1]],       clr: "#009dff" },
    { c: [[1,0],[1,0],[1,1]],     clr: "#a855f7" },
    { c: [[0,1],[0,1],[1,1]],     clr: "#f59e0b" },
    { c: [[1,1,1],[0,1,0]],       clr: "#10b981" },
    { c: [[1,1,1],[1,0,0]],       clr: "#ef4444" },
    { c: [[1,1,1],[0,0,1]],       clr: "#8b5cf6" },
    { c: [[1,1],[1,0]],           clr: "#ec4899" },
    { c: [[1]],                   clr: "#fbbf24" },
    { c: [[1,1],[0,1]],           clr: "#06b6d4" },
    { c: [[1,1,1]],               clr: "#14b8a6" },
    { c: [[1],[1],[1]],           clr: "#14b8a6" },
    { c: [[1,1]],                 clr: "#f97316" },
    { c: [[1],[1]],               clr: "#f97316" },
];

// ================================================================
//  GAME STATE
// ================================================================
let grid        = [];
let score       = 0;
let phase       = "menu"; // menu | normal | ascending | boss | gameover | victory
let bossHp      = BOSS_BASE_HP;
let bossWave    = 1;
let bossAlpha   = 0;
let bossDrawY   = -200;
let bossGlitch  = 0;

let cellSz      = 0;
let gridOX      = 0;
let gridOY      = 0;
let cScale      = 1;
let bossAreaH   = 0;

let slots       = [null, null, null];
let drag        = null;   // active drag object
let dragging    = false;

// timers (ms accumulated)
let autoSwordAcc   = 0;
let bossRevengeAcc = 0;
let lastFrameTs    = 0;

// animation pools
let swords          = [];
let autoSwords      = [];
let impactParticles = [];
let breakParticles  = [];
let lineFX          = [];
let shakeAmt        = 0;
let shakeDur        = 0;

// cosmic bg
let stars     = [];
let stairSegs = [];

// blocked cells (boss revenge)
let blockedList = [];

// ================================================================
//  ASSET LOADER
// ================================================================
async function loadAllAssets() {
    const bar = $("#progress-bar");
    const status = $("#status-text");
    const list = $("#asset-list");

    const keys = Object.keys(ASSET_MANIFEST);
    let done = 0;

    function updateProgress() {
        done++;
        const pct = (done / keys.length) * 100;
        if (bar) bar.style.width = pct + "%";
    }

    const promises = keys.map((key) => {
        const entry = ASSET_MANIFEST[key];
        return new Promise((resolve) => {
            if (status) status.textContent = `LOADING ${entry.label}...`;
            const img = new Image();
            img.src = entry.src;
            img.onload = () => {
                IMG[key] = img;
                updateProgress();
                if (list) list.innerHTML += `<div class="loaded">✔ ${entry.label}</div>`;
                resolve(true);
            };
            img.onerror = () => {
                updateProgress();
                if (list) list.innerHTML += `<div class="failed">✘ ${entry.label} — MISSING</div>`;
                resolve(false);
            };
        });
    });

    const results = await Promise.all(promises);
    allAssetsReady = results.every(Boolean);

    if (!allAssetsReady) {
        if (status) status.textContent = "⚠ SOME ASSETS MISSING — GAME MAY LOOK DIFFERENT";
        await sleep(1500);
    } else {
        if (status) status.textContent = "ALL SYSTEMS NOMINAL";
    }
    if (bar) bar.style.width = "100%";

    await sleep(400);

    const pre = $("#preloader");
    if (pre) {
        pre.classList.add("hidden");
        setTimeout(() => { pre.style.display = "none"; }, 700);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================================================================
//  CANVAS SIZING
// ================================================================
function sizeCanvas() {
    const wrap = $("#canvas-wrapper");
    if (!wrap) return;

    const wW = wrap.clientWidth;
    const wH = wrap.clientHeight;
    const pad = 12;

    bossAreaH = (phase === "boss" ? 160 : 0);

    const avail = Math.min(wW - pad * 2, wH - pad * 2 - bossAreaH);
    cellSz = Math.floor(avail / GRID);
    const gridPx = cellSz * GRID;

    canvasEl.width  = Math.max(gridPx + pad * 2, wW);
    canvasEl.height = bossAreaH + gridPx + pad * 2;

    const dScale = Math.min(wW / canvasEl.width, wH / canvasEl.height, 1);
    canvasEl.style.width  = (canvasEl.width * dScale) + "px";
    canvasEl.style.height = (canvasEl.height * dScale) + "px";
    cScale = dScale;

    gridOX = (canvasEl.width - gridPx) / 2;
    gridOY = bossAreaH + pad;

    if (cosmicEl) {
        cosmicEl.width  = window.innerWidth;
        cosmicEl.height = window.innerHeight;
    }
}

// ================================================================
//  GRID HELPERS
// ================================================================
function resetGrid() {
    grid = Array.from({ length: GRID }, () => Array(GRID).fill(0));
}

function cellFree(x, y) {
    return x >= 0 && x < GRID && y >= 0 && y < GRID && grid[y][x] === 0;
}

function canPlace(cells, gx, gy) {
    for (let r = 0; r < cells.length; r++)
        for (let c = 0; c < cells[r].length; c++)
            if (cells[r][c]) {
                const nx = gx + c, ny = gy + r;
                if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return false;
                if (grid[ny][nx] !== 0) return false;
            }
    return true;
}

function placeOnGrid(cells, color, gx, gy) {
    for (let r = 0; r < cells.length; r++)
        for (let c = 0; c < cells[r].length; c++)
            if (cells[r][c])
                grid[gy + r][gx + c] = color;
}

// ================================================================
//  SLOT / SHAPE MANAGEMENT
// ================================================================
function randomShape() {
    const d = SHAPE_DEFS[Math.floor(Math.random() * SHAPE_DEFS.length)];
    return { cells: d.c.map(r => [...r]), color: d.clr, used: false };
}

function fillSlots() {
    const elems = $$(".slot");
    for (let i = 0; i < 3; i++) {
        slots[i] = randomShape();
        renderSlotMini(elems[i], slots[i]);
        elems[i].classList.remove("used", "dragging");
    }
}

function renderSlotMini(el, shape) {
    el.innerHTML = "";
    const mc = document.createElement("canvas");
    const maxDim = Math.max(shape.cells.length, shape.cells[0].length);
    const unit = Math.floor(56 / Math.max(maxDim, 2));
    mc.width = 68; mc.height = 68;
    const m = mc.getContext("2d");
    const ox = (68 - shape.cells[0].length * unit) / 2;
    const oy = (68 - shape.cells.length * unit) / 2;

    shape.cells.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        m.fillStyle = shape.color;
        m.shadowColor = shape.color;
        m.shadowBlur = 5;
        m.beginPath();
        m.roundRect(ox + c * unit + 1, oy + r * unit + 1, unit - 2, unit - 2, 3);
        m.fill();
        m.shadowBlur = 0;
        m.fillStyle = "rgba(255,255,255,0.22)";
        m.fillRect(ox + c * unit + 2, oy + r * unit + 2, unit - 4, 2);
    }));
    el.appendChild(mc);
}

function allSlotsUsed() { return slots.every(s => !s || s.used); }

function anyMoveExists() {
    for (let i = 0; i < 3; i++) {
        if (!slots[i] || slots[i].used) continue;
        const cs = slots[i].cells;
        for (let gy = 0; gy <= GRID - cs.length; gy++)
            for (let gx = 0; gx <= GRID - cs[0].length; gx++)
                if (canPlace(cs, gx, gy)) return true;
    }
    return false;
}

// ================================================================
//  LINE CLEARING
// ================================================================
function clearLines() {
    let rows = [], cols = [];

    for (let y = 0; y < GRID; y++) {
        if (grid[y].every(c => c !== 0 && c !== BLOCKED_CELL)) rows.push(y);
    }
    for (let x = 0; x < GRID; x++) {
        let full = true;
        for (let y = 0; y < GRID; y++)
            if (grid[y][x] === 0 || grid[y][x] === BLOCKED_CELL) { full = false; break; }
        if (full) cols.push(x);
    }

    const total = rows.length + cols.length;
    if (total === 0) return 0;

    // particles
    rows.forEach(y => {
        for (let x = 0; x < GRID; x++)
            spawnBreak(gridOX + x * cellSz + cellSz / 2, gridOY + y * cellSz + cellSz / 2, grid[y][x]);
    });
    cols.forEach(x => {
        for (let y = 0; y < GRID; y++)
            if (!rows.includes(y))
                spawnBreak(gridOX + x * cellSz + cellSz / 2, gridOY + y * cellSz + cellSz / 2, grid[y][x]);
    });

    // line flash
    rows.forEach(y => lineFX.push({ type: "row", idx: y, a: 1, t: 22 }));
    cols.forEach(x => lineFX.push({ type: "col", idx: x, a: 1, t: 22 }));

    // clear grid
    rows.forEach(y => grid[y].fill(0));
    cols.forEach(x => { for (let y = 0; y < GRID; y++) grid[y][x] = 0; });

    // remove any blocks on cleared lines
    blockedList = blockedList.filter(b => !rows.includes(b.y) && !cols.includes(b.x));

    // scoring
    const pts = total * 50 * (total > 1 ? 2 : 1);
    score += pts;
    updateScoreUI();

    // spawn main-sword projectile toward boss
    if (phase === "boss") {
        rows.forEach(y =>
            spawnMainSword(gridOX + GRID * cellSz / 2, gridOY + y * cellSz + cellSz / 2, total));
        cols.forEach(x =>
            spawnMainSword(gridOX + x * cellSz + cellSz / 2, gridOY + GRID * cellSz / 2, total));
    }

    return total;
}

// ================================================================
//  SCORE UI
// ================================================================
function updateScoreUI() {
    const el = $("#score");
    if (el) el.textContent = score.toString().padStart(4, "0");
}

// ================================================================
//  MAIN SWORD (line clear → boss)
// ================================================================
function spawnMainSword(fx, fy, combo) {
    const tx = canvasEl.width / 2 + (Math.random() - 0.5) * 30;
    const ty = bossDrawY + 70;
    for (let i = 0; i < Math.min(combo, 3); i++) {
        swords.push({
            x: fx + (Math.random() - 0.5) * 20,
            y: fy,
            tx, ty,
            rot: 0,
            sc: 0.55 + Math.random() * 0.2,
            alpha: 1,
            spd: SWORD_FLY_SPEED + Math.random() * 3,
            dmg: 80 * combo,
            trail: [],
            alive: true,
        });
    }
}

function updateMainSwords() {
    swords.forEach(s => {
        if (!s.alive) return;
        s.trail.push({ x: s.x, y: s.y, a: 0.7 });
        if (s.trail.length > 8) s.trail.shift();
        s.trail.forEach(t => (t.a *= 0.82));

        const dx = s.tx - s.x, dy = s.ty - s.y;
        const d = Math.hypot(dx, dy);
        if (d < 22) {
            s.alive = false;
            bossHp -= s.dmg;
            if (bossHp < 0) bossHp = 0;
            syncBossHUD();
            spawnImpact(s.x, s.y, 20);
            shake(6, 12);
            bossGlitch = 18;
            if (bossHp <= 0) onBossKill();
        } else {
            s.x += (dx / d) * s.spd;
            s.y += (dy / d) * s.spd;
            s.rot = Math.atan2(dy, dx) - Math.PI / 2;
        }
    });
    swords = swords.filter(s => s.alive);
}

function drawMainSwords() {
    swords.forEach(s => {
        // trail
        s.trail.forEach(t => {
            ctx.globalAlpha = t.a * 0.35;
            ctx.fillStyle = "#fbbf24";
            ctx.beginPath();
            ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = s.alpha;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.scale(s.sc, s.sc);

        if (IMG.mainSword) {
            const sw = 50, sh = 100;
            ctx.drawImage(IMG.mainSword, -sw / 2, -sh / 2, sw, sh);
        } else {
            drawFallbackSword(ctx, "#fbbf24");
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    });
}

// ================================================================
//  AUTO (DIVINE) SWORD — every 10 s
// ================================================================
function spawnAutoSword() {
    const startX = canvasEl.width / 2;
    const startY = canvasEl.height + 60;
    const tx = canvasEl.width / 2;
    const ty = bossDrawY + 70;

    autoSwords.push({
        x: startX,
        y: startY,
        tx, ty,
        rot: 0,
        sc: 1.0,
        alpha: 1,
        spd: SWORD_FLY_SPEED * 1.2,
        phase: "fly-through",  // fly-through → impact
        trail: [],
        alive: true,
        clearedBlocked: false,
    });
}

function updateAutoSwords() {
    autoSwords.forEach(s => {
        if (!s.alive) return;

        s.trail.push({ x: s.x, y: s.y, a: 0.9 });
        if (s.trail.length > 14) s.trail.shift();
        s.trail.forEach(t => (t.a *= 0.85));

        // clear blocked cells as it flies through the grid area
        if (!s.clearedBlocked && s.y < gridOY + GRID * cellSz && s.y > gridOY) {
            s.clearedBlocked = true;
            clearAllBlockedCells();
        }

        const dx = s.tx - s.x, dy = s.ty - s.y;
        const d = Math.hypot(dx, dy);

        if (d < 30) {
            s.alive = false;
            bossHp -= AUTO_SWORD_DAMAGE;
            if (bossHp < 0) bossHp = 0;
            syncBossHUD();
            spawnImpact(s.x, s.y, 40);
            shake(14, 24);
            bossGlitch = 30;
            flashScreen("heavy");
            if (bossHp <= 0) onBossKill();
        } else {
            s.x += (dx / d) * s.spd;
            s.y += (dy / d) * s.spd;
            s.rot = Math.atan2(dy, dx) - Math.PI / 2;
        }
    });
    autoSwords = autoSwords.filter(s => s.alive);
}

function drawAutoSwords() {
    autoSwords.forEach(s => {
        // glowing trail
        s.trail.forEach(t => {
            ctx.globalAlpha = t.a * 0.45;
            ctx.fillStyle = "#a855f7";
            ctx.shadowColor = "#a855f7";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = s.alpha;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.scale(s.sc, s.sc);

        if (IMG.divineSword) {
            const sw = 64, sh = 130;
            ctx.drawImage(IMG.divineSword, -sw / 2, -sh / 2, sw, sh);
        } else {
            drawFallbackSword(ctx, "#a855f7");
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    });
}

function drawFallbackSword(c, color) {
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.beginPath();
    c.moveTo(0, -45);
    c.lineTo(-9, 12);
    c.lineTo(0, 6);
    c.lineTo(9, 12);
    c.closePath();
    c.fill();
    c.fillStyle = "#999";
    c.fillRect(-3, 12, 6, 16);
    c.fillStyle = color;
    c.fillRect(-11, 10, 22, 4);
    c.shadowBlur = 0;
}

// ================================================================
//  BLOCKED CELLS (Boss Revenge)
// ================================================================
function bossBlockCells() {
    if (phase !== "boss") return;
    const count = 2;
    let placed = 0, attempts = 0;
    while (placed < count && attempts < 80) {
        attempts++;
        const rx = Math.floor(Math.random() * GRID);
        const ry = Math.floor(Math.random() * GRID);
        if (grid[ry][rx] === 0) {
            grid[ry][rx] = BLOCKED_CELL;
            blockedList.push({ x: rx, y: ry });
            placed++;
        }
    }
    if (placed > 0) {
        bossGlitch = 25;
        shake(5, 10);
    }
}

function clearAllBlockedCells() {
    blockedList.forEach(b => {
        if (grid[b.y][b.x] === BLOCKED_CELL) {
            grid[b.y][b.x] = 0;
            spawnBreak(
                gridOX + b.x * cellSz + cellSz / 2,
                gridOY + b.y * cellSz + cellSz / 2,
                "#a855f7"
            );
        }
    });
    blockedList = [];
}

// ================================================================
//  PARTICLES
// ================================================================
function spawnImpact(x, y, n) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 9 + 2;
        impactParticles.push({
            x, y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 1, decay: 0.02 + Math.random() * 0.03,
            sz: 2 + Math.random() * 4,
            clr: Math.random() > 0.4 ? "#ff0055" : "#fbbf24",
        });
    }
}

function spawnBreak(x, y, clr) {
    const color = (typeof clr === "string" && clr.startsWith("#")) ? clr : "#ff0055";
    for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 3 + 1;
        breakParticles.push({
            x, y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 1, decay: 0.025 + Math.random() * 0.03,
            sz: 1.5 + Math.random() * 2.5,
            clr: color,
        });
    }
}

function updateParticles() {
    impactParticles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.94; p.vy *= 0.94;
        p.life -= p.decay;
    });
    impactParticles = impactParticles.filter(p => p.life > 0);

    breakParticles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.12;
        p.life -= p.decay;
    });
    breakParticles = breakParticles.filter(p => p.life > 0);

    lineFX.forEach(e => { e.t--; e.a = e.t / 22; });
    lineFX = lineFX.filter(e => e.t > 0);
}

function drawParticles() {
    impactParticles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.clr;
        ctx.shadowColor = p.clr;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.shadowBlur = 0;

    breakParticles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.clr;
        ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    });
    ctx.globalAlpha = 1;

    lineFX.forEach(e => {
        ctx.fillStyle = `rgba(255,255,255,${e.a * 0.45})`;
        if (e.type === "row")
            ctx.fillRect(gridOX, gridOY + e.idx * cellSz, GRID * cellSz, cellSz);
        else
            ctx.fillRect(gridOX + e.idx * cellSz, gridOY, cellSz, GRID * cellSz);
    });
}

// ================================================================
//  SCREEN SHAKE
// ================================================================
function shake(amount, dur) { shakeAmt = amount; shakeDur = dur; }
function getShake() {
    if (shakeDur > 0) {
        shakeDur--;
        const i = shakeAmt * (shakeDur / 20);
        return { x: (Math.random() - 0.5) * i * 2, y: (Math.random() - 0.5) * i * 2 };
    }
    return { x: 0, y: 0 };
}

// ================================================================
//  WHITE FLASH HELPER
// ================================================================
function flashScreen(type) {
    const el = $("#white-flash");
    if (!el) return;
    el.className = "white-flash flash-in";
    const holdTime = type === "heavy" ? 120 : 50;
    setTimeout(() => el.className = "white-flash flash-hold", 100);
    setTimeout(() => el.className = "white-flash flash-out", holdTime + 100);
    setTimeout(() => el.className = "white-flash", holdTime + 1700);
}

// ================================================================
//  BOSS HUD SYNC
// ================================================================
function syncBossHUD() {
    const maxHp = BOSS_BASE_HP * bossWave;
    const ratio = Math.max(0, bossHp / maxHp);
    const bar = $("#boss-hp-bar");
    const txt = $("#boss-hp-text");
    const tag = $("#boss-wave-tag");
    if (bar) bar.style.width = (ratio * 100) + "%";
    if (txt) txt.textContent = `${Math.max(0, Math.floor(bossHp))} / ${maxHp}`;
    if (tag) tag.textContent = `WAVE ${bossWave}`;
}

function showBossHUD() {
    const el = $("#boss-hud");
    if (el) { el.classList.remove("hidden"); el.classList.add("visible"); }
    const tb = $("#auto-sword-timer-box");
    if (tb) { tb.classList.remove("hidden"); tb.classList.add("visible"); }
}

function hideBossHUD() {
    const el = $("#boss-hud");
    if (el) { el.classList.add("hidden"); el.classList.remove("visible"); }
    const tb = $("#auto-sword-timer-box");
    if (tb) { tb.classList.add("hidden"); tb.classList.remove("visible"); }
}

// ================================================================
//  ASCENSION SEQUENCE (score >= 100)
// ================================================================
async function ascend() {
    phase = "ascending";

    // Phase 1: float UI away
    const container = $("#game-ui-container");
    if (container) container.classList.add("float-away");
    await sleep(1600);

    // Phase 2: white flash
    const flash = $("#white-flash");
    if (flash) flash.className = "white-flash flash-in";
    await sleep(200);
    if (flash) flash.className = "white-flash flash-hold";

    // Phase 3: "ВОЗНЕСИСЬ"
    const overlay = $("#ascension-overlay");
    const txt = $("#ascension-text");
    if (overlay) overlay.classList.add("visible");
    if (txt) txt.textContent = "ВОЗНЕСИСЬ";
    await sleep(3000);

    // Phase 4: second text
    if (txt) {
        txt.style.fontSize = "22px";
        txt.textContent = "ДА НАЧНЕТСЯ ТВОЕ ФИНАЛЬНОЕ ИСПЫТАНИЕ";
    }
    await sleep(3000);

    // Phase 5: fade flash, hide text, reveal boss
    if (overlay) overlay.classList.remove("visible");
    if (txt) { txt.textContent = ""; txt.style.fontSize = ""; }

    // transition background
    const bg = $("#bg-layer");
    if (bg) bg.style.opacity = "0";
    const cosmic = $("#cosmic-bg");
    if (cosmic) { cosmic.classList.remove("hidden"); cosmic.classList.add("visible"); }
    initCosmos();

    if (flash) flash.className = "white-flash flash-out";
    await sleep(600);
    if (flash) flash.className = "white-flash";

    // reset UI container position
    if (container) container.classList.remove("float-away");

    // enter boss phase
    phase = "boss";
    bossHp = BOSS_BASE_HP;
    bossWave = 1;
    bossAlpha = 0;
    bossDrawY = -200;
    autoSwordAcc = 0;
    bossRevengeAcc = 0;

    sizeCanvas();
    showBossHUD();
    syncBossHUD();
}

// ================================================================
//  COSMIC BACKGROUND
// ================================================================
function initCosmos() {
    const w = cosmicEl ? cosmicEl.width : 400;
    const h = cosmicEl ? cosmicEl.height : 800;
    stars = [];
    for (let i = 0; i < 220; i++) {
        stars.push({
            x: Math.random() * w, y: Math.random() * h,
            sz: Math.random() * 2 + 0.4,
            sp: Math.random() * 0.4 + 0.08,
            br: Math.random(), tw: Math.random() * 0.02 + 0.004,
        });
    }
    stairSegs = [];
    for (let i = 0; i < 14; i++) {
        stairSegs.push({
            x: w * 0.28 + i * w * 0.035,
            y: h * 0.88 - i * h * 0.055,
            w: w * 0.13,
            h: 5,
            glow: Math.random(), gd: 1,
        });
    }
}

function drawCosmos() {
    if (!cosmicCtx || !cosmicEl) return;
    const w = cosmicEl.width, h = cosmicEl.height;

    const g = cosmicCtx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#08001a");
    g.addColorStop(0.35, "#100030");
    g.addColorStop(0.65, "#1a0048");
    g.addColorStop(1, "#050811");
    cosmicCtx.fillStyle = g;
    cosmicCtx.fillRect(0, 0, w, h);

    const neb = cosmicCtx.createRadialGradient(w * 0.5, h * 0.28, 0, w * 0.5, h * 0.28, w * 0.45);
    neb.addColorStop(0, "rgba(90,0,180,0.14)");
    neb.addColorStop(0.6, "rgba(40,0,120,0.06)");
    neb.addColorStop(1, "transparent");
    cosmicCtx.fillStyle = neb;
    cosmicCtx.fillRect(0, 0, w, h);

    stars.forEach(s => {
        s.br += s.tw;
        const a = 0.25 + Math.abs(Math.sin(s.br)) * 0.75;
        cosmicCtx.fillStyle = `rgba(255,255,255,${a})`;
        cosmicCtx.beginPath();
        cosmicCtx.arc(s.x, s.y, s.sz, 0, Math.PI * 2);
        cosmicCtx.fill();
        s.y += s.sp;
        if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
    });

    stairSegs.forEach(st => {
        st.glow += 0.018 * st.gd;
        if (st.glow > 1 || st.glow < 0.25) st.gd *= -1;
        const a = st.glow * 0.35;
        cosmicCtx.fillStyle = `rgba(190,170,255,${a})`;
        cosmicCtx.shadowColor = "rgba(170,150,255,0.5)";
        cosmicCtx.shadowBlur = 14;
        cosmicCtx.fillRect(st.x, st.y, st.w, st.h);
        cosmicCtx.shadowBlur = 0;
        cosmicCtx.fillStyle = `rgba(255,255,255,${a * 0.4})`;
        cosmicCtx.fillRect(st.x, st.y, st.w, 1);
    });
}

// ================================================================
//  BOSS DRAWING
// ================================================================
function drawBoss() {
    if (phase !== "boss") return;

    // animate entrance
    if (bossAlpha < 1) bossAlpha = Math.min(1, bossAlpha + 0.012);
    const targetY = 8;
    if (bossDrawY < targetY) bossDrawY = Math.min(targetY, bossDrawY + 2.5);

    ctx.save();
    ctx.globalAlpha = bossAlpha;

    let gx = 0, gy = 0;
    if (bossGlitch > 0) {
        gx = (Math.random() - 0.5) * 10;
        gy = (Math.random() - 0.5) * 6;
    }

    const bw = 150, bh = 130;
    const bx = (canvasEl.width - bw) / 2 + gx;
    const by = bossDrawY + gy;

    // aura
    const aura = ctx.createRadialGradient(canvasEl.width / 2, by + bh / 2, 15, canvasEl.width / 2, by + bh / 2, 130);
    aura.addColorStop(0, `rgba(168,85,247,${0.28 * bossAlpha})`);
    aura.addColorStop(0.6, `rgba(255,0,85,${0.08 * bossAlpha})`);
    aura.addColorStop(1, "transparent");
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, canvasEl.width, bossAreaH);

    if (IMG.boss) {
        ctx.drawImage(IMG.boss, bx, by, bw, bh);
        // glitch scanlines
        if (bossGlitch > 0 && Math.random() > 0.4) {
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = "rgba(255,0,85,0.25)";
            ctx.fillRect(bx - 8, by + Math.random() * bh, bw + 16, 3);
            ctx.fillStyle = "rgba(0,200,255,0.15)";
            ctx.fillRect(bx - 4, by + Math.random() * bh, bw + 8, 2);
            ctx.globalCompositeOperation = "source-over";
        }
    } else {
        // fallback
        ctx.fillStyle = `rgba(168,85,247,${bossAlpha})`;
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 35;
        ctx.beginPath();
        ctx.arc(canvasEl.width / 2, by + 55, 45, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ff0055";
        ctx.beginPath();
        ctx.arc(canvasEl.width / 2, by + 50, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "bold 9px Orbitron";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText("NAMELESS DEITY", canvasEl.width / 2, by + 110);
    }

    ctx.restore();
}

// ================================================================
//  BOSS KILL
// ================================================================
function onBossKill() {
    if (bossWave >= MAX_BOSS_WAVES) {
        // victory
        phase = "victory";
        flashScreen("heavy");
        setTimeout(() => {
            $("#game-screen").classList.remove("active");
            $("#boss-defeat-screen").classList.add("active");
            const vs = $("#victory-score");
            if (vs) vs.textContent = score.toString().padStart(4, "0");
        }, 1800);
    } else {
        // next wave
        bossWave++;
        bossHp = BOSS_BASE_HP * bossWave;
        syncBossHUD();
        bossGlitch = 50;
        flashScreen("heavy");
        autoSwordAcc = 0;
        bossRevengeAcc = 0;
    }
}

// ================================================================
//  GAME OVER
// ================================================================
function triggerGameOver() {
    if (phase === "gameover" || phase === "victory") return;
    phase = "gameover";
    setTimeout(() => {
        $("#game-screen").classList.remove("active");
        $("#game-over-screen").classList.add("active");
        const fs = $("#final-score");
        if (fs) fs.textContent = score.toString().padStart(4, "0");
    }, 500);
}

// ================================================================
//  GRID DRAWING
// ================================================================
function drawGrid() {
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            const dx = gridOX + x * cellSz;
            const dy = gridOY + y * cellSz;
            const val = grid[y][x];

            if (val === 0) {
                // empty
                ctx.fillStyle = "rgba(255,255,255,0.025)";
                ctx.beginPath();
                ctx.roundRect(dx + 1, dy + 1, cellSz - 2, cellSz - 2, 3);
                ctx.fill();
            } else if (val === BLOCKED_CELL) {
                // boss-blocked cell
                const pulse = 0.3 + Math.sin(performance.now() * 0.008) * 0.2;
                ctx.fillStyle = `rgba(168,85,247,${pulse})`;
                ctx.beginPath();
                ctx.roundRect(dx + 1, dy + 1, cellSz - 2, cellSz - 2, 3);
                ctx.fill();

                // X mark
                ctx.strokeStyle = `rgba(255,0,85,${pulse + 0.25})`;
                ctx.lineWidth = 2.5;
                ctx.lineCap = "round";
                const m = 7;
                ctx.beginPath();
                ctx.moveTo(dx + m, dy + m);
                ctx.lineTo(dx + cellSz - m, dy + cellSz - m);
                ctx.moveTo(dx + cellSz - m, dy + m);
                ctx.lineTo(dx + m, dy + cellSz - m);
                ctx.stroke();

                // pulsing border
                ctx.strokeStyle = `rgba(168,85,247,${pulse * 0.6})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(dx + 1, dy + 1, cellSz - 2, cellSz - 2, 3);
                ctx.stroke();
            } else {
                // filled cell
                const clr = typeof val === "string" ? val : "#ff0055";

                ctx.fillStyle = "rgba(0,0,0,0.25)";
                ctx.beginPath();
                ctx.roundRect(dx + 3, dy + 3, cellSz - 4, cellSz - 4, 4);
                ctx.fill();

                ctx.fillStyle = clr;
                ctx.shadowColor = clr;
                ctx.shadowBlur = 7;
                ctx.beginPath();
                ctx.roundRect(dx + 2, dy + 2, cellSz - 4, cellSz - 4, 4);
                ctx.fill();
                ctx.shadowBlur = 0;

                ctx.fillStyle = "rgba(255,255,255,0.18)";
                ctx.fillRect(dx + 4, dy + 3, cellSz - 8, 2);
                ctx.fillStyle = "rgba(0,0,0,0.12)";
                ctx.fillRect(dx + 4, dy + cellSz - 6, cellSz - 8, 2);
            }

            // grid line
            ctx.strokeStyle = "rgba(255,255,255,0.04)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(dx, dy, cellSz, cellSz);
        }
    }

    // outer border
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gridOX - 1, gridOY - 1, GRID * cellSz + 2, GRID * cellSz + 2, 5);
    ctx.stroke();
}

// ================================================================
//  GHOST PREVIEW
// ================================================================
function drawGhost() {
    if (!drag || !drag.valid) return;
    const cs = drag.cells;

    cs.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        const dx = gridOX + (drag.gx + c) * cellSz;
        const dy = gridOY + (drag.gy + r) * cellSz;

        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.roundRect(dx + 2, dy + 2, cellSz - 4, cellSz - 4, 4);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(dx + 2, dy + 2, cellSz - 4, cellSz - 4, 4);
        ctx.stroke();
    }));
}

// ================================================================
//  DRAGGED PIECE DRAWING
// ================================================================
function drawDragged() {
    if (!drag) return;

    drag.cells.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        const px = drag.px + c * cellSz;
        const py = drag.py + r * cellSz;

        ctx.globalAlpha = 0.82;
        ctx.fillStyle = drag.color;
        ctx.shadowColor = drag.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(px + 2, py + 2, cellSz - 4, cellSz - 4, 4);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillRect(px + 4, py + 3, cellSz - 8, 2);
    }));
}

// ================================================================
//  INPUT: DRAG & DROP
// ================================================================
function canvasCoords(cx, cy) {
    const r = canvasEl.getBoundingClientRect();
    return { x: (cx - r.left) / cScale, y: (cy - r.top) / cScale };
}

function onDragStart(e) {
    if (phase !== "normal" && phase !== "boss") return;
    const slotEl = e.target.closest(".slot");
    if (!slotEl) return;
    const idx = parseInt(slotEl.dataset.slot);
    if (isNaN(idx) || !slots[idx] || slots[idx].used) return;

    e.preventDefault();
    dragging = true;

    const touch = e.touches ? e.touches[0] : e;
    const co = canvasCoords(touch.clientX, touch.clientY);
    const s = slots[idx];
    const pw = s.cells[0].length * cellSz;
    const ph = s.cells.length * cellSz;

    drag = {
        cells: s.cells,
        color: s.color,
        px: co.x - pw / 2,
        py: co.y - ph / 2 - DRAG_ABOVE_PX,
        gx: -1, gy: -1,
        valid: false,
        slotIdx: idx,
    };

    slotEl.classList.add("dragging");
}

function onDragMove(e) {
    if (!dragging || !drag) return;
    e.preventDefault();

    const touch = e.touches ? e.touches[0] : e;
    const co = canvasCoords(touch.clientX, touch.clientY);

    const pw = drag.cells[0].length * cellSz;
    const ph = drag.cells.length * cellSz;

    drag.px = co.x - pw / 2;
    drag.py = co.y - ph / 2 - DRAG_ABOVE_PX;

    // snap calc
    const cx = drag.px + pw / 2;
    const cy = drag.py + ph / 2;
    const gx = Math.round((cx - gridOX - pw / 2) / cellSz);
    const gy = Math.round((cy - gridOY - ph / 2) / cellSz);

    drag.gx = gx;
    drag.gy = gy;
    drag.valid = canPlace(drag.cells, gx, gy);
}

function onDragEnd() {
    if (!dragging || !drag) return;

    const slotElems = $$(".slot");
    const idx = drag.slotIdx;

    if (drag.valid) {
        placeOnGrid(drag.cells, drag.color, drag.gx, drag.gy);
        slots[idx].used = true;
        slotElems[idx].classList.remove("dragging");
        slotElems[idx].classList.add("used");

        clearLines();
        score += 10;
        updateScoreUI();

        // ascension check
        if (score >= ASCENSION_SCORE && phase === "normal") {
            ascend();
            drag = null;
            dragging = false;
            return;
        }

        if (allSlotsUsed()) {
            setTimeout(fillSlots, 180);
        } else {
            setTimeout(() => {
                if (!anyMoveExists()) triggerGameOver();
            }, 80);
        }
    } else {
        slotElems[idx].classList.remove("dragging");
    }

    drag = null;
    dragging = false;
}

// ================================================================
//  AUTO-SWORD TIMER UI
// ================================================================
function updateAutoSwordTimerUI() {
    const fill = $("#auto-sword-fill");
    if (!fill) return;
    const pct = Math.min(100, (autoSwordAcc / AUTO_SWORD_INTERVAL) * 100);
    fill.style.width = pct + "%";
}

// ================================================================
//  MAIN LOOP
// ================================================================
function loop(ts) {
    requestAnimationFrame(loop);

    const dt = lastFrameTs ? (ts - lastFrameTs) : 16;
    lastFrameTs = ts;

    // ---------- UPDATES ----------
    if (phase === "boss") {
        // auto sword timer
        autoSwordAcc += dt;
        if (autoSwordAcc >= AUTO_SWORD_INTERVAL) {
            autoSwordAcc = 0;
            spawnAutoSword();
        }
        updateAutoSwordTimerUI();

        // boss revenge timer
        bossRevengeAcc += dt;
        if (bossRevengeAcc >= BOSS_REVENGE_INTERVAL) {
            bossRevengeAcc = 0;
            bossBlockCells();
        }

        // boss glitch countdown
        if (bossGlitch > 0) bossGlitch--;
    }

    updateMainSwords();
    updateAutoSwords();
    updateParticles();

    const sk = getShake();

    // ---------- DRAW ----------
    if (phase === "boss" || phase === "ascending" || phase === "victory") {
        drawCosmos();
    }

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    ctx.save();
    ctx.translate(sk.x, sk.y);

    // subtle canvas bg
    ctx.fillStyle = "rgba(5,8,17,0.2)";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    drawBoss();
    drawGrid();
    drawGhost();
    drawDragged();
    drawMainSwords();
    drawAutoSwords();
    drawParticles();

    ctx.restore();
}

// ================================================================
//  GAME INIT / RESET
// ================================================================
function startNewGame() {
    score = 0;
    bossHp = BOSS_BASE_HP;
    bossWave = 1;
    bossAlpha = 0;
    bossDrawY = -200;
    bossGlitch = 0;
    autoSwordAcc = 0;
    bossRevengeAcc = 0;
    phase = "normal";

    blockedList = [];
    swords = [];
    autoSwords = [];
    impactParticles = [];
    breakParticles = [];
    lineFX = [];
    shakeAmt = 0;
    shakeDur = 0;
    drag = null;
    dragging = false;

    resetGrid();
    updateScoreUI();
    hideBossHUD();
    sizeCanvas();
    fillSlots();

    // reset backgrounds
    const bg = $("#bg-layer");
    if (bg) bg.style.opacity = "1";
    const cos = $("#cosmic-bg");
    if (cos) { cos.classList.add("hidden"); cos.classList.remove("visible"); }

    // reset game-ui-container
    const gc = $("#game-ui-container");
    if (gc) gc.classList.remove("float-away");

    // reset ascension overlay
    const ao = $("#ascension-overlay");
    if (ao) { ao.classList.remove("visible"); ao.classList.remove("hidden-done"); }

    // reset auto sword timer
    const af = $("#auto-sword-fill");
    if (af) af.style.width = "0%";
}

function returnToMenu() {
    $$(".screen").forEach(s => s.classList.remove("active"));
    $("#main-menu").classList.add("active");

    const bg = $("#bg-layer");
    if (bg) bg.style.opacity = "1";
    const cos = $("#cosmic-bg");
    if (cos) { cos.classList.add("hidden"); cos.classList.remove("visible"); }
    hideBossHUD();

    const gc = $("#game-ui-container");
    if (gc) gc.classList.remove("float-away");
    const ao = $("#ascension-overlay");
    if (ao) { ao.classList.remove("visible"); }

    phase = "menu";
}

// ================================================================
//  EVENT BINDINGS
// ================================================================
let loopStarted = false;

$("#start-btn").addEventListener("click", () => {
    $("#main-menu").classList.remove("active");
    $("#game-screen").classList.add("active");
    startNewGame();
    if (!loopStarted) {
        loopStarted = true;
        requestAnimationFrame(loop);
    }
});

$("#retry-btn").addEventListener("click", () => {
    $("#game-over-screen").classList.remove("active");
    $("#game-screen").classList.add("active");
    startNewGame();
});

$("#menu-btn").addEventListener("click", () => {
    $("#game-over-screen").classList.remove("active");
    returnToMenu();
});

$("#victory-menu-btn").addEventListener("click", () => {
    $("#boss-defeat-screen").classList.remove("active");
    returnToMenu();
});

// --- Touch ---
const hotbar = $("#hotbar");
hotbar.addEventListener("touchstart", onDragStart, { passive: false });
document.addEventListener("touchmove", onDragMove, { passive: false });
document.addEventListener("touchend", onDragEnd, { passive: false });
document.addEventListener("touchcancel", onDragEnd, { passive: false });

// --- Mouse ---
hotbar.addEventListener("mousedown", onDragStart);
document.addEventListener("mousemove", (e) => { if (dragging) onDragMove(e); });
document.addEventListener("mouseup", onDragEnd);

// --- Resize ---
let rsTimer;
window.addEventListener("resize", () => {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(sizeCanvas, 120);
});

// --- Prevent scroll / context ---
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.body.addEventListener("touchmove", (e) => {
    if (dragging) e.preventDefault();
}, { passive: false });

// ================================================================
//  BOOT
// ================================================================
loadAllAssets();
