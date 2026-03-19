"use strict";

// ============================================================
// BLOCK BLAST NEO - CALAMITY BOSS EDITION
// Complete Game Engine
// ============================================================

// --- CONSTANTS ---
const GRID_SIZE = 8;
const ASCENSION_SCORE = 100;
const BOSS_MAX_HP = 5000;
const DRAG_OFFSET_Y = 50; // pixels above finger
const SWORD_SPEED = 12;
const BLOCKED_CELL_VALUE = 2; // special value for boss-blocked cells

// --- CANVAS & CONTEXT ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const cosmicCanvas = document.getElementById('cosmic-canvas');
const cosmicCtx = cosmicCanvas ? cosmicCanvas.getContext('2d') : null;

// --- GAME STATE ---
let grid = [];
let score = 0;
let gamePhase = 'normal'; // 'normal', 'ascension_transition', 'boss_fight', 'game_over', 'victory'
let bossHp = BOSS_MAX_HP;
let bossWave = 1;
let bossVisible = false;
let bossAlpha = 0;
let bossGlitchTimer = 0;
let bossGlitchActive = false;
let bossY = -200; // offscreen initially

// --- GEOMETRY ---
let cellSize = 0;
let gridOffsetX = 0;
let gridOffsetY = 0;
let canvasScale = 1;

// --- DRAG STATE ---
let activeDrag = null; // { shape, drawX, drawY, ghostGridX, ghostGridY, validGhost, slotIndex }
let isDragging = false;

// --- SHAPES ---
const SHAPES = [
    { cells: [[1, 1], [1, 1]], color: '#ff0055' },
    { cells: [[1, 1, 1, 1]], color: '#009dff' },
    { cells: [[1], [1], [1], [1]], color: '#009dff' },
    { cells: [[1, 0], [1, 0], [1, 1]], color: '#a855f7' },
    { cells: [[0, 1], [0, 1], [1, 1]], color: '#f59e0b' },
    { cells: [[1, 1, 1], [0, 1, 0]], color: '#10b981' },
    { cells: [[1, 1, 1], [1, 0, 0]], color: '#ef4444' },
    { cells: [[1, 1, 1], [0, 0, 1]], color: '#8b5cf6' },
    { cells: [[1, 1], [1, 0]], color: '#ec4899' },
    { cells: [[1]], color: '#fbbf24' },
    { cells: [[1, 1], [0, 1]], color: '#06b6d4' },
    { cells: [[1, 1, 1]], color: '#14b8a6' },
    { cells: [[1], [1], [1]], color: '#14b8a6' },
    { cells: [[1, 1]], color: '#f97316' },
    { cells: [[1], [1]], color: '#f97316' },
];

// --- SLOT DATA ---
let slots = [null, null, null]; // { shape, color, used }

// --- ANIMATIONS ---
let swordProjectiles = [];
let impactParticles = [];
let lineClearEffects = [];
let cosmicStars = [];
let stairParticles = [];
let blockBreakParticles = [];
let screenShakeAmount = 0;
let screenShakeDuration = 0;

// --- ASSETS ---
const ASSET_PATHS = {
    boss: '1000337814.png',
    swordLight: '1000337800.png',
    swordDark: '1000337798.png'
};
const images = {};
let assetsLoaded = false;

// --- BLOCKED CELLS (Boss Revenge) ---
let blockedCells = [];
let blockedCellTimer = 0;
const BLOCK_INTERVAL = 15000; // ms between boss blocking cells

// ============================================================
// ASSET LOADING
// ============================================================
async function loadAssets() {
    const bar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status-text');
    const keys = Object.keys(ASSET_PATHS);
    let loaded = 0;

    const statusMessages = ['LOADING TEXTURES...', 'CALIBRATING DEITY...', 'FORGING SWORDS...'];

    const promises = keys.map((key, i) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = ASSET_PATHS[key];
            img.onload = () => {
                images[key] = img;
                loaded++;
                if (bar) bar.style.width = ((loaded / keys.length) * 100) + '%';
                if (statusText && statusMessages[i]) statusText.textContent = statusMessages[i];
                resolve();
            };
            img.onerror = () => {
                console.warn('Asset not found:', ASSET_PATHS[key], '- using fallback rendering');
                loaded++;
                if (bar) bar.style.width = ((loaded / keys.length) * 100) + '%';
                resolve();
            };
        });
    });

    await Promise.race([
        Promise.all(promises),
        new Promise(r => setTimeout(r, 4000))
    ]);

    assetsLoaded = true;
    if (bar) bar.style.width = '100%';
    if (statusText) statusText.textContent = 'SYSTEM READY';

    await new Promise(r => setTimeout(r, 500));

    const preloader = document.getElementById('preloader');
    if (preloader) {
        preloader.classList.add('hidden');
        setTimeout(() => { preloader.style.display = 'none'; }, 600);
    }
}

// ============================================================
// CANVAS SETUP & RESPONSIVE
// ============================================================
function setupCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const wrapperW = wrapper.clientWidth;
    const wrapperH = wrapper.clientHeight;

    // Calculate available space
    const padding = 16;
    const availW = wrapperW - padding * 2;
    const availH = wrapperH - padding * 2;

    // Boss area at top of canvas
    const bossAreaHeight = (gamePhase === 'boss_fight' || gamePhase === 'ascension_transition') ? 160 : 0;

    const gridAvailH = availH - bossAreaHeight;
    const gridMaxSize = Math.min(availW, gridAvailH);

    cellSize = Math.floor(gridMaxSize / GRID_SIZE);
    const gridPixelSize = cellSize * GRID_SIZE;

    canvas.width = Math.max(gridPixelSize + padding * 2, wrapperW);
    canvas.height = bossAreaHeight + gridPixelSize + padding * 2;

    // Apply CSS sizing
    const displayScale = Math.min(wrapperW / canvas.width, wrapperH / canvas.height, 1);
    canvas.style.width = (canvas.width * displayScale) + 'px';
    canvas.style.height = (canvas.height * displayScale) + 'px';
    canvasScale = displayScale;

    gridOffsetX = (canvas.width - gridPixelSize) / 2;
    gridOffsetY = bossAreaHeight + padding;

    // Cosmic canvas
    if (cosmicCanvas) {
        cosmicCanvas.width = window.innerWidth;
        cosmicCanvas.height = window.innerHeight;
    }
}

// ============================================================
// GRID INITIALIZATION
// ============================================================
function initGrid() {
    grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
}

// ============================================================
// SHAPE GENERATION & SLOTS
// ============================================================
function getRandomShape() {
    const idx = Math.floor(Math.random() * SHAPES.length);
    return {
        cells: SHAPES[idx].cells.map(row => [...row]),
        color: SHAPES[idx].color
    };
}

function spawnNewShapes() {
    const slotElems = document.querySelectorAll('.slot');
    for (let i = 0; i < 3; i++) {
        const shape = getRandomShape();
        slots[i] = { ...shape, used: false };
        renderSlotPreview(slotElems[i], shape);
        slotElems[i].classList.remove('used', 'dragging');
    }
}

function renderSlotPreview(slotElem, shape) {
    slotElem.innerHTML = '';
    const miniCanvas = document.createElement('canvas');
    const cellCount = Math.max(shape.cells.length, shape.cells[0].length);
    const miniCellSize = Math.floor(60 / Math.max(cellCount, 2));
    const w = shape.cells[0].length * miniCellSize;
    const h = shape.cells.length * miniCellSize;

    miniCanvas.width = 70;
    miniCanvas.height = 70;
    const mCtx = miniCanvas.getContext('2d');

    const offX = (70 - w) / 2;
    const offY = (70 - h) / 2;

    shape.cells.forEach((row, y) => {
        row.forEach((val, x) => {
            if (val) {
                // Block fill
                mCtx.fillStyle = shape.color;
                mCtx.shadowColor = shape.color;
                mCtx.shadowBlur = 6;
                mCtx.beginPath();
                mCtx.roundRect(offX + x * miniCellSize + 1, offY + y * miniCellSize + 1, miniCellSize - 2, miniCellSize - 2, 3);
                mCtx.fill();
                mCtx.shadowBlur = 0;

                // Inner highlight
                mCtx.fillStyle = 'rgba(255,255,255,0.2)';
                mCtx.fillRect(offX + x * miniCellSize + 2, offY + y * miniCellSize + 2, miniCellSize - 4, 2);
            }
        });
    });

    slotElem.appendChild(miniCanvas);
}

// ============================================================
// PLACEMENT LOGIC
// ============================================================
function canPlace(cells, gx, gy) {
    for (let y = 0; y < cells.length; y++) {
        for (let x = 0; x < cells[y].length; x++) {
            if (cells[y][x]) {
                const nx = gx + x;
                const ny = gy + y;
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) return false;
                if (grid[ny][nx] !== 0) return false;
            }
        }
    }
    return true;
}

function placeShape(cells, color, gx, gy) {
    for (let y = 0; y < cells.length; y++) {
        for (let x = 0; x < cells[y].length; x++) {
            if (cells[y][x]) {
                grid[gy + y][gx + x] = color;
            }
        }
    }
}

function anyMovePossible() {
    for (let s = 0; s < 3; s++) {
        if (!slots[s] || slots[s].used) continue;
        const cells = slots[s].cells;
        for (let gy = 0; gy <= GRID_SIZE - cells.length; gy++) {
            for (let gx = 0; gx <= GRID_SIZE - cells[0].length; gx++) {
                if (canPlace(cells, gx, gy)) return true;
            }
        }
    }
    return false;
}

function allSlotsUsed() {
    return slots.every(s => s === null || s.used);
}

// ============================================================
// LINE CLEARING
// ============================================================
function checkAndClearLines() {
    let rowsToClear = [];
    let colsToClear = [];

    // Check rows
    for (let y = 0; y < GRID_SIZE; y++) {
        let full = true;
        for (let x = 0; x < GRID_SIZE; x++) {
            if (grid[y][x] === 0) { full = false; break; }
        }
        if (full) rowsToClear.push(y);
    }

    // Check cols
    for (let x = 0; x < GRID_SIZE; x++) {
        let full = true;
        for (let y = 0; y < GRID_SIZE; y++) {
            if (grid[y][x] === 0) { full = false; break; }
        }
        if (full) colsToClear.push(x);
    }

    const totalLines = rowsToClear.length + colsToClear.length;
    if (totalLines === 0) return 0;

    // Spawn line clear effects before clearing
    rowsToClear.forEach(y => {
        for (let x = 0; x < GRID_SIZE; x++) {
            const px = gridOffsetX + x * cellSize + cellSize / 2;
            const py = gridOffsetY + y * cellSize + cellSize / 2;
            spawnBlockBreakParticles(px, py, grid[y][x] || '#ff0055');
        }
    });
    colsToClear.forEach(x => {
        for (let y = 0; y < GRID_SIZE; y++) {
            if (!rowsToClear.includes(y)) {
                const px = gridOffsetX + x * cellSize + cellSize / 2;
                const py = gridOffsetY + y * cellSize + cellSize / 2;
                spawnBlockBreakParticles(px, py, grid[y][x] || '#ff0055');
            }
        }
    });

    // Add line clear flash effects
    rowsToClear.forEach(y => {
        lineClearEffects.push({
            type: 'row', index: y, alpha: 1.0, timer: 20
        });
    });
    colsToClear.forEach(x => {
        lineClearEffects.push({
            type: 'col', index: x, alpha: 1.0, timer: 20
        });
    });

    // Clear rows
    rowsToClear.forEach(y => {
        for (let x = 0; x < GRID_SIZE; x++) grid[y][x] = 0;
    });

    // Clear cols
    colsToClear.forEach(x => {
        for (let y = 0; y < GRID_SIZE; y++) grid[y][x] = 0;
    });

    // Remove any blocked cells that were on cleared lines
    blockedCells = blockedCells.filter(bc => {
        return !rowsToClear.includes(bc.y) && !colsToClear.includes(bc.x);
    });

    // Scoring
    const lineScore = totalLines * 50 * (totalLines > 1 ? 2 : 1); // combo bonus
    score += lineScore;
    updateScoreDisplay();

    // Spawn sword projectile in boss fight
    if (gamePhase === 'boss_fight') {
        // Spawn from the center of the cleared line area
        rowsToClear.forEach(y => {
            spawnSwordProjectile(
                gridOffsetX + (GRID_SIZE * cellSize) / 2,
                gridOffsetY + y * cellSize + cellSize / 2,
                totalLines
            );
        });
        colsToClear.forEach(x => {
            spawnSwordProjectile(
                gridOffsetX + x * cellSize + cellSize / 2,
                gridOffsetY + (GRID_SIZE * cellSize) / 2,
                totalLines
            );
        });
    }

    return totalLines;
}

// ============================================================
// SCORE DISPLAY
// ============================================================
function updateScoreDisplay() {
    const el = document.getElementById('score');
    if (el) el.textContent = score.toString().padStart(4, '0');
}

// ============================================================
// ASCENSION EVENT (SCORE >= 100)
// ============================================================
function triggerAscension() {
    gamePhase = 'ascension_transition';

    // White flash
    const flash = document.getElementById('white-flash');
    if (flash) {
        flash.classList.add('active');
        setTimeout(() => {
            flash.classList.remove('active');
            flash.classList.add('fade-out');
        }, 300);
        setTimeout(() => {
            flash.classList.remove('fade-out');
        }, 1200);
    }

    // Transition background
    setTimeout(() => {
        const bgLayer = document.getElementById('bg-layer');
        if (bgLayer) bgLayer.style.opacity = '0';

        const cosmicBg = document.getElementById('cosmic-bg');
        if (cosmicBg) {
            cosmicBg.classList.remove('hidden');
            cosmicBg.classList.add('visible');
        }

        initCosmicBackground();
    }, 500);

    // Show boss HUD
    setTimeout(() => {
        const bossHud = document.getElementById('boss-hud');
        if (bossHud) {
            bossHud.classList.remove('hidden');
            bossHud.classList.add('visible');
        }
        bossVisible = true;
        bossAlpha = 0;
        bossY = -150;
        gamePhase = 'boss_fight';
        setupCanvas(); // Recalculate with boss area
    }, 1200);
}

// ============================================================
// COSMIC BACKGROUND
// ============================================================
function initCosmicBackground() {
    cosmicStars = [];
    for (let i = 0; i < 200; i++) {
        cosmicStars.push({
            x: Math.random() * (cosmicCanvas ? cosmicCanvas.width : 400),
            y: Math.random() * (cosmicCanvas ? cosmicCanvas.height : 800),
            size: Math.random() * 2 + 0.5,
            speed: Math.random() * 0.5 + 0.1,
            brightness: Math.random(),
            twinkleSpeed: Math.random() * 0.02 + 0.005
        });
    }

    // Stair particles
    stairParticles = [];
    const stairCount = 12;
    for (let i = 0; i < stairCount; i++) {
        const cw = cosmicCanvas ? cosmicCanvas.width : 400;
        const ch = cosmicCanvas ? cosmicCanvas.height : 800;
        stairParticles.push({
            x: cw * 0.3 + (i * cw * 0.04),
            y: ch * 0.9 - (i * ch * 0.06),
            width: cw * 0.12,
            height: 6,
            glow: Math.random(),
            glowDir: 1
        });
    }
}

function drawCosmicBackground() {
    if (!cosmicCtx || !cosmicCanvas) return;

    const w = cosmicCanvas.width;
    const h = cosmicCanvas.height;

    // Sky gradient
    const skyGrad = cosmicCtx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#0a001a');
    skyGrad.addColorStop(0.3, '#120030');
    skyGrad.addColorStop(0.6, '#1a0044');
    skyGrad.addColorStop(1, '#050811');
    cosmicCtx.fillStyle = skyGrad;
    cosmicCtx.fillRect(0, 0, w, h);

    // Nebula glow
    const nebGrad = cosmicCtx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, w * 0.5);
    nebGrad.addColorStop(0, 'rgba(100, 0, 200, 0.15)');
    nebGrad.addColorStop(0.5, 'rgba(50, 0, 150, 0.08)');
    nebGrad.addColorStop(1, 'transparent');
    cosmicCtx.fillStyle = nebGrad;
    cosmicCtx.fillRect(0, 0, w, h);

    // Stars
    cosmicStars.forEach(star => {
        star.brightness += star.twinkleSpeed;
        const alpha = 0.3 + Math.abs(Math.sin(star.brightness)) * 0.7;
        cosmicCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        cosmicCtx.beginPath();
        cosmicCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        cosmicCtx.fill();

        star.y += star.speed;
        if (star.y > h) {
            star.y = 0;
            star.x = Math.random() * w;
        }
    });

    // Glowing stairs
    stairParticles.forEach(stair => {
        stair.glow += 0.02 * stair.glowDir;
        if (stair.glow > 1 || stair.glow < 0.3) stair.glowDir *= -1;

        const alpha = stair.glow * 0.4;
        cosmicCtx.fillStyle = `rgba(200, 180, 255, ${alpha})`;
        cosmicCtx.shadowColor = 'rgba(180, 160, 255, 0.6)';
        cosmicCtx.shadowBlur = 15;
        cosmicCtx.fillRect(stair.x, stair.y, stair.width, stair.height);
        cosmicCtx.shadowBlur = 0;

        // Stair edge glow
        cosmicCtx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
        cosmicCtx.fillRect(stair.x, stair.y, stair.width, 1);
    });
}

// ============================================================
// BOSS RENDERING
// ============================================================
function drawBoss() {
    if (!bossVisible) return;

    // Animate boss entrance
    if (bossAlpha < 1) bossAlpha += 0.015;
    if (bossAlpha > 1) bossAlpha = 1;

    const targetY = 10;
    if (bossY < targetY) bossY += 2;
    if (bossY > targetY) bossY = targetY;

    ctx.save();
    ctx.globalAlpha = bossAlpha;

    // Glitch effect
    let glitchOffsetX = 0;
    let glitchOffsetY = 0;
    if (bossGlitchActive) {
        glitchOffsetX = (Math.random() - 0.5) * 8;
        glitchOffsetY = (Math.random() - 0.5) * 4;
    }

    const bossWidth = 140;
    const bossHeight = 120;
    const bossX = (canvas.width - bossWidth) / 2 + glitchOffsetX;
    const bossDY = bossY + glitchOffsetY;

    // Boss glow aura
    const auraGrad = ctx.createRadialGradient(
        canvas.width / 2, bossDY + bossHeight / 2, 20,
        canvas.width / 2, bossDY + bossHeight / 2, 120
    );
    auraGrad.addColorStop(0, `rgba(168, 85, 247, ${0.3 * bossAlpha})`);
    auraGrad.addColorStop(0.5, `rgba(255, 0, 85, ${0.1 * bossAlpha})`);
    auraGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = auraGrad;
    ctx.fillRect(0, 0, canvas.width, 180);

    if (images.boss) {
        ctx.drawImage(images.boss, bossX, bossDY, bossWidth, bossHeight);

        // Glitch overlay
        if (bossGlitchActive && Math.random() > 0.5) {
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = `rgba(255, 0, 85, 0.3)`;
            ctx.fillRect(bossX - 5, bossDY + Math.random() * bossHeight, bossWidth + 10, 3);
            ctx.globalCompositeOperation = 'source-over';
        }
    } else {
        // Fallback boss rendering
        ctx.fillStyle = `rgba(168, 85, 247, ${bossAlpha})`;
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(canvas.width / 2, bossDY + 50, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Eye
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.arc(canvas.width / 2, bossDY + 45, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '10px Orbitron';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('NAMELESS DEITY', canvas.width / 2, bossDY + 100);
    }

    ctx.restore();

    // Boss HP bar on canvas
    drawBossHPBarCanvas();
}

function drawBossHPBarCanvas() {
    const barW = Math.min(canvas.width * 0.7, 280);
    const barH = 10;
    const barX = (canvas.width - barW) / 2;
    const barY = 140;
    const hpRatio = Math.max(0, bossHp / (BOSS_MAX_HP * bossWave));

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 5);
    ctx.fill();

    // HP fill
    if (hpRatio > 0) {
        const hpGrad = ctx.createLinearGradient(barX, 0, barX + barW * hpRatio, 0);
        hpGrad.addColorStop(0, '#ff0055');
        hpGrad.addColorStop(0.5, '#ff4488');
        hpGrad.addColorStop(1, '#ff0055');
        ctx.fillStyle = hpGrad;
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * hpRatio, barH, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 5);
    ctx.stroke();
}

function updateBossHUD() {
    const bar = document.getElementById('boss-hp-bar');
    const text = document.getElementById('boss-hp-text');
    const maxHp = BOSS_MAX_HP * bossWave;
    const ratio = Math.max(0, bossHp / maxHp);
    if (bar) bar.style.width = (ratio * 100) + '%';
    if (text) text.textContent = `${Math.max(0, Math.floor(bossHp))} / ${maxHp}`;
}

// ============================================================
// SWORD PROJECTILES
// ============================================================
function spawnSwordProjectile(fromX, fromY, lineCount) {
    const useDark = Math.random() > 0.5;
    const targetX = canvas.width / 2;
    const targetY = bossY + 60;

    for (let i = 0; i < lineCount; i++) {
        swordProjectiles.push({
            x: fromX + (Math.random() - 0.5) * 30,
            y: fromY,
            targetX: targetX + (Math.random() - 0.5) * 40,
            targetY: targetY,
            rotation: -Math.PI / 2,
            scale: 0.5 + Math.random() * 0.3,
            dark: i % 2 === 0 ? useDark : !useDark,
            alpha: 1,
            speed: SWORD_SPEED + Math.random() * 4,
            damage: 50 * lineCount,
            trail: [],
            active: true
        });
    }
}

function updateSwordProjectiles() {
    swordProjectiles.forEach(sword => {
        if (!sword.active) return;

        // Trail
        sword.trail.push({ x: sword.x, y: sword.y, alpha: 0.8 });
        if (sword.trail.length > 8) sword.trail.shift();
        sword.trail.forEach(t => t.alpha *= 0.85);

        // Move towards target
        const dx = sword.targetX - sword.x;
        const dy = sword.targetY - sword.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 20) {
            // Hit boss
            sword.active = false;
            bossHp -= sword.damage;
            if (bossHp < 0) bossHp = 0;
            updateBossHUD();

            // Impact effects
            spawnImpactParticles(sword.x, sword.y);
            triggerScreenShake(8, 15);
            bossGlitchActive = true;
            bossGlitchTimer = 20;

            // Check boss defeat
            if (bossHp <= 0) {
                handleBossDefeat();
            }
        } else {
            const moveX = (dx / dist) * sword.speed;
            const moveY = (dy / dist) * sword.speed;
            sword.x += moveX;
            sword.y += moveY;
            sword.rotation = Math.atan2(dy, dx) - Math.PI / 2;
        }
    });

    swordProjectiles = swordProjectiles.filter(s => s.active);
}

function drawSwordProjectiles() {
    swordProjectiles.forEach(sword => {
        // Draw trail
        sword.trail.forEach(t => {
            ctx.fillStyle = sword.dark ? `rgba(168, 85, 247, ${t.alpha * 0.3})` : `rgba(255, 200, 50, ${t.alpha * 0.3})`;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.save();
        ctx.translate(sword.x, sword.y);
        ctx.rotate(sword.rotation);
        ctx.scale(sword.scale, sword.scale);
        ctx.globalAlpha = sword.alpha;

        const imgKey = sword.dark ? 'swordDark' : 'swordLight';
        if (images[imgKey]) {
            ctx.drawImage(images[imgKey], -25, -50, 50, 100);
        } else {
            // Fallback sword
            const sColor = sword.dark ? '#a855f7' : '#fbbf24';
            ctx.fillStyle = sColor;
            ctx.shadowColor = sColor;
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.moveTo(0, -40);
            ctx.lineTo(-8, 10);
            ctx.lineTo(0, 5);
            ctx.lineTo(8, 10);
            ctx.closePath();
            ctx.fill();

            // Handle
            ctx.fillStyle = '#888';
            ctx.fillRect(-3, 10, 6, 15);
            ctx.fillStyle = sColor;
            ctx.fillRect(-10, 8, 20, 4);
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    });
}

// ============================================================
// PARTICLES
// ============================================================
function spawnImpactParticles(x, y) {
    for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 2;
        impactParticles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.02,
            size: Math.random() * 4 + 2,
            color: Math.random() > 0.5 ? '#ff0055' : '#fbbf24'
        });
    }
}

function spawnBlockBreakParticles(x, y, color) {
    for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        blockBreakParticles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.02,
            size: Math.random() * 3 + 1,
            color: typeof color === 'string' ? color : '#ff0055'
        });
    }
}

function updateParticles() {
    // Impact particles
    impactParticles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life -= p.decay;
    });
    impactParticles = impactParticles.filter(p => p.life > 0);

    // Block break particles
    blockBreakParticles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1;
        p.life -= p.decay;
    });
    blockBreakParticles = blockBreakParticles.filter(p => p.life > 0);

    // Line clear effects
    lineClearEffects.forEach(e => {
        e.timer--;
        e.alpha = e.timer / 20;
    });
    lineClearEffects = lineClearEffects.filter(e => e.timer > 0);
}

function drawParticles() {
    // Impact particles
    impactParticles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Block break particles
    blockBreakParticles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // Line clear effects
    lineClearEffects.forEach(e => {
        ctx.fillStyle = `rgba(255, 255, 255, ${e.alpha * 0.5})`;
        if (e.type === 'row') {
            ctx.fillRect(gridOffsetX, gridOffsetY + e.index * cellSize, GRID_SIZE * cellSize, cellSize);
        } else {
            ctx.fillRect(gridOffsetX + e.index * cellSize, gridOffsetY, cellSize, GRID_SIZE * cellSize);
        }
    });
}

// ============================================================
// SCREEN SHAKE
// ============================================================
function triggerScreenShake(amount, duration) {
    screenShakeAmount = amount;
    screenShakeDuration = duration;
}

function getScreenShakeOffset() {
    if (screenShakeDuration > 0) {
        screenShakeDuration--;
        const intensity = screenShakeAmount * (screenShakeDuration / 15);
        return {
            x: (Math.random() - 0.5) * intensity * 2,
            y: (Math.random() - 0.5) * intensity * 2
        };
    }
    return { x: 0, y: 0 };
}

// ============================================================
// BOSS REVENGE - BLOCK CELLS
// ============================================================
function bossBlockRandomCells() {
    if (gamePhase !== 'boss_fight') return;

    const numToBlock = Math.min(1 + Math.floor(bossWave / 2), 3);
    let attempts = 0;

    for (let i = 0; i < numToBlock; i++) {
        attempts = 0;
        while (attempts < 50) {
            const rx = Math.floor(Math.random() * GRID_SIZE);
            const ry = Math.floor(Math.random() * GRID_SIZE);
            if (grid[ry][rx] === 0) {
                grid[ry][rx] = BLOCKED_CELL_VALUE;
                blockedCells.push({ x: rx, y: ry, timer: 300 }); // ~5 seconds at 60fps
                break;
            }
            attempts++;
        }
    }

    // Boss glitch when blocking
    bossGlitchActive = true;
    bossGlitchTimer = 30;
    triggerScreenShake(4, 10);
}

function updateBlockedCells() {
    blockedCells.forEach(bc => {
        bc.timer--;
        if (bc.timer <= 0) {
            if (grid[bc.y][bc.x] === BLOCKED_CELL_VALUE) {
                grid[bc.y][bc.x] = 0;
            }
        }
    });
    blockedCells = blockedCells.filter(bc => bc.timer > 0);
}

// ============================================================
// BOSS DEFEAT
// ============================================================
function handleBossDefeat() {
    bossWave++;
    if (bossWave > 3) {
        // Victory!
        gamePhase = 'victory';
        setTimeout(() => {
            document.getElementById('game-screen').classList.remove('active');
            document.getElementById('boss-defeat-screen').classList.add('active');
            document.getElementById('victory-score').textContent = score.toString().padStart(4, '0');
        }, 1500);
    } else {
        // Next wave
        bossHp = BOSS_MAX_HP * bossWave;
        updateBossHUD();
        bossGlitchActive = true;
        bossGlitchTimer = 60;

        // Flash effect
        const flash = document.getElementById('white-flash');
        if (flash) {
            flash.classList.add('active');
            setTimeout(() => {
                flash.classList.remove('active');
                flash.classList.add('fade-out');
            }, 150);
            setTimeout(() => {
                flash.classList.remove('fade-out');
            }, 600);
        }
    }
}

// ============================================================
// GAME OVER CHECK
// ============================================================
function checkGameOver() {
    if (gamePhase === 'game_over' || gamePhase === 'victory') return;
    if (!allSlotsUsed() && !anyMovePossible()) {
        gamePhase = 'game_over';
        setTimeout(() => {
            document.getElementById('game-screen').classList.remove('active');
            document.getElementById('game-over-screen').classList.add('active');
            document.getElementById('final-score').textContent = score.toString().padStart(4, '0');
        }, 500);
    }
}

// ============================================================
// DRAWING: GRID
// ============================================================
function drawGrid() {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const drawX = gridOffsetX + x * cellSize;
            const drawY = gridOffsetY + y * cellSize;

            // Cell background
            if (grid[y][x] === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
                ctx.beginPath();
                ctx.roundRect(drawX + 1, drawY + 1, cellSize - 2, cellSize - 2, 3);
                ctx.fill();
            } else if (grid[y][x] === BLOCKED_CELL_VALUE) {
                // Blocked cell (boss revenge)
                const bc = blockedCells.find(b => b.x === x && b.y === y);
                const pulse = bc ? 0.3 + Math.sin(Date.now() * 0.01) * 0.2 : 0.4;
                ctx.fillStyle = `rgba(168, 85, 247, ${pulse})`;
                ctx.beginPath();
                ctx.roundRect(drawX + 1, drawY + 1, cellSize - 2, cellSize - 2, 3);
                ctx.fill();

                // X pattern
                ctx.strokeStyle = `rgba(255, 0, 85, ${pulse + 0.2})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(drawX + 6, drawY + 6);
                ctx.lineTo(drawX + cellSize - 6, drawY + cellSize - 6);
                ctx.moveTo(drawX + cellSize - 6, drawY + 6);
                ctx.lineTo(drawX + 6, drawY + cellSize - 6);
                ctx.stroke();
            } else {
                // Filled cell
                const color = typeof grid[y][x] === 'string' ? grid[y][x] : '#ff0055';

                // Block shadow
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.beginPath();
                ctx.roundRect(drawX + 3, drawY + 3, cellSize - 4, cellSize - 4, 4);
                ctx.fill();

                // Block fill
                ctx.fillStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.roundRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4, 4);
                ctx.fill();
                ctx.shadowBlur = 0;

                // Inner highlight
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.fillRect(drawX + 4, drawY + 3, cellSize - 8, 2);

                // Inner shadow at bottom
                ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
                ctx.fillRect(drawX + 4, drawY + cellSize - 6, cellSize - 8, 2);
            }

            // Grid lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(drawX, drawY, cellSize, cellSize);
        }
    }

    // Grid outer border glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gridOffsetX - 1, gridOffsetY - 1, GRID_SIZE * cellSize + 2, GRID_SIZE * cellSize + 2, 6);
    ctx.stroke();
}

// ============================================================
// DRAWING: GHOST PREVIEW
// ============================================================
function drawGhostPreview() {
    if (!activeDrag || !activeDrag.validGhost) return;

    const cells = activeDrag.shape;
    const gx = activeDrag.ghostGridX;
    const gy = activeDrag.ghostGridY;

    cells.forEach((row, y) => {
        row.forEach((val, x) => {
            if (val) {
                const drawX = gridOffsetX + (gx + x) * cellSize;
                const drawY = gridOffsetY + (gy + y) * cellSize;

                // Ghost fill
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.roundRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4, 4);
                ctx.fill();

                // Ghost border
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.roundRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4, 4);
                ctx.stroke();
            }
        });
    });
}

// ============================================================
// DRAWING: DRAGGED PIECE
// ============================================================
function drawDraggedPiece() {
    if (!activeDrag) return;

    const cells = activeDrag.shape;
    const color = activeDrag.color || '#ff0055';

    cells.forEach((row, y) => {
        row.forEach((val, x) => {
            if (val) {
                const drawX = activeDrag.drawX + x * cellSize;
                const drawY = activeDrag.drawY + y * cellSize;

                ctx.fillStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.roundRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4, 4);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;

                // Highlight
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(drawX + 4, drawY + 3, cellSize - 8, 2);
            }
        });
    });
}

// ============================================================
// INPUT HANDLING
// ============================================================
function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / canvasScale,
        y: (clientY - rect.top) / canvasScale
    };
}

function getSlotFromEvent(e) {
    const target = e.target.closest('.slot');
    if (!target) return -1;
    const idx = parseInt(target.dataset.slot);
    if (isNaN(idx) || !slots[idx] || slots[idx].used) return -1;
    return idx;
}

function startDragHandler(e) {
    if (gamePhase === 'game_over' || gamePhase === 'victory') return;

    const slotIdx = getSlotFromEvent(e);
    if (slotIdx === -1) return;

    e.preventDefault();
    isDragging = true;

    const touch = e.touches ? e.touches[0] : e;
    const coords = getCanvasCoords(touch.clientX, touch.clientY);

    const shape = slots[slotIdx].cells;
    const color = slots[slotIdx].color;

    // Calculate centering offset for the shape
    const shapePixelW = shape[0].length * cellSize;
    const shapePixelH = shape.length * cellSize;

    activeDrag = {
        shape: shape,
        color: color,
        drawX: coords.x - shapePixelW / 2,
        drawY: coords.y - shapePixelH / 2 - DRAG_OFFSET_Y,
        ghostGridX: -1,
        ghostGridY: -1,
        validGhost: false,
        slotIndex: slotIdx
    };

    // Mark slot as being dragged
    const slotElems = document.querySelectorAll('.slot');
    slotElems[slotIdx].classList.add('dragging');
}

function moveDragHandler(e) {
    if (!isDragging || !activeDrag) return;
    e.preventDefault();

    const touch = e.touches ? e.touches[0] : e;
    const coords = getCanvasCoords(touch.clientX, touch.clientY);

    const shape = activeDrag.shape;
    const shapePixelW = shape[0].length * cellSize;
    const shapePixelH = shape.length * cellSize;

    // Position piece 50px above the finger
    activeDrag.drawX = coords.x - shapePixelW / 2;
    activeDrag.drawY = coords.y - shapePixelH / 2 - DRAG_OFFSET_Y;

    // Calculate ghost grid position (snap to grid)
    const centerX = activeDrag.drawX + shapePixelW / 2;
    const centerY = activeDrag.drawY + shapePixelH / 2;

    const gx = Math.round((centerX - gridOffsetX - shapePixelW / 2) / cellSize);
    const gy = Math.round((centerY - gridOffsetY - shapePixelH / 2) / cellSize);

    activeDrag.ghostGridX = gx;
    activeDrag.ghostGridY = gy;
    activeDrag.validGhost = canPlace(shape, gx, gy);
}

function endDragHandler(e) {
    if (!isDragging || !activeDrag) return;

    const slotIdx = activeDrag.slotIndex;
    const slotElems = document.querySelectorAll('.slot');

    if (activeDrag.validGhost) {
        // Place the shape
        placeShape(activeDrag.shape, activeDrag.color, activeDrag.ghostGridX, activeDrag.ghostGridY);

        // Mark slot as used
        slots[slotIdx].used = true;
        slotElems[slotIdx].classList.remove('dragging');
        slotElems[slotIdx].classList.add('used');

        // Clear lines
        const linesCleared = checkAndClearLines();

        // Base score for placing
        score += 10;
        updateScoreDisplay();

        // Check ascension
        if (score >= ASCENSION_SCORE && gamePhase === 'normal') {
            triggerAscension();
        }

        // Refill slots if all used
        if (allSlotsUsed()) {
            setTimeout(() => spawnNewShapes(), 200);
        } else {
            // Check if any remaining moves possible
            setTimeout(() => checkGameOver(), 100);
        }
    } else {
        // Return to slot
        slotElems[slotIdx].classList.remove('dragging');
    }

    activeDrag = null;
    isDragging = false;
}

// ============================================================
// MAIN GAME LOOP
// ============================================================
let lastTime = 0;
let bossBlockTimer = 0;

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    // --- UPDATE ---

    // Screen shake
    const shake = getScreenShakeOffset();

    // Boss glitch timer
    if (bossGlitchTimer > 0) {
        bossGlitchTimer--;
        if (bossGlitchTimer <= 0) bossGlitchActive = false;
    }

    // Boss revenge: block cells periodically
    if (gamePhase === 'boss_fight') {
        bossBlockTimer += dt;
        if (bossBlockTimer >= BLOCK_INTERVAL) {
            bossBlockTimer = 0;
            bossBlockRandomCells();
        }
    }

    // Update systems
    updateSwordProjectiles();
    updateParticles();
    updateBlockedCells();

    // --- DRAW ---

    // Draw cosmic background
    if (gamePhase === 'boss_fight' || gamePhase === 'ascension_transition' || gamePhase === 'victory') {
        drawCosmicBackground();
    }

    // Clear game canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(shake.x, shake.y);

    // Background fill
    ctx.fillStyle = 'rgba(5, 8, 17, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw boss
    if (gamePhase === 'boss_fight' || gamePhase === 'ascension_transition') {
        drawBoss();
    }

    // Draw grid
    drawGrid();

    // Draw ghost preview
    drawGhostPreview();

    // Draw dragged piece
    drawDraggedPiece();

    // Draw sword projectiles
    drawSwordProjectiles();

    // Draw particles
    drawParticles();

    ctx.restore();

    requestAnimationFrame(gameLoop);
}

// ============================================================
// GAME INITIALIZATION
// ============================================================
function startGame() {
    score = 0;
    bossHp = BOSS_MAX_HP;
    bossWave = 1;
    bossVisible = false;
    bossAlpha = 0;
    bossY = -200;
    bossGlitchTimer = 0;
    bossGlitchActive = false;
    bossBlockTimer = 0;
    gamePhase = 'normal';
    blockedCells = [];
    swordProjectiles = [];
    impactParticles = [];
    blockBreakParticles = [];
    lineClearEffects = [];
    screenShakeAmount = 0;
    screenShakeDuration = 0;
    activeDrag = null;
    isDragging = false;

    initGrid();
    updateScoreDisplay();
    setupCanvas();
    spawnNewShapes();

    // Hide boss HUD
    const bossHud = document.getElementById('boss-hud');
    if (bossHud) {
        bossHud.classList.add('hidden');
        bossHud.classList.remove('visible');
    }

    // Reset background
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.opacity = '1';
    const cosmicBg = document.getElementById('cosmic-bg');
    if (cosmicBg) {
        cosmicBg.classList.add('hidden');
        cosmicBg.classList.remove('visible');
    }

    updateBossHUD();
}

function resetToMenu() {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('main-menu').classList.add('active');

    // Reset backgrounds
    const bgLayer = document.getElementById('bg-layer');
    if (bgLayer) bgLayer.style.opacity = '1';
    const cosmicBg = document.getElementById('cosmic-bg');
    if (cosmicBg) {
        cosmicBg.classList.add('hidden');
        cosmicBg.classList.remove('visible');
    }
    const bossHud = document.getElementById('boss-hud');
    if (bossHud) {
        bossHud.classList.add('hidden');
        bossHud.classList.remove('visible');
    }
}

// ============================================================
// EVENT BINDINGS
// ============================================================

// Start button
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    startGame();
    // Start animation loop only once
    if (!window._gameLoopStarted) {
        window._gameLoopStarted = true;
        requestAnimationFrame(gameLoop);
    }
});

// Retry button
document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    startGame();
});

// Menu buttons
document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.remove('active');
    resetToMenu();
});

document.getElementById('victory-menu-btn').addEventListener('click', () => {
    document.getElementById('boss-defeat-screen').classList.remove('active');
    resetToMenu();
});

// Touch drag events (on hotbar slots)
const hotbar = document.getElementById('hotbar');

hotbar.addEventListener('touchstart', startDragHandler, { passive: false });
document.addEventListener('touchmove', moveDragHandler, { passive: false });
document.addEventListener('touchend', endDragHandler, { passive: false });
document.addEventListener('touchcancel', endDragHandler, { passive: false });

// Mouse drag events (for desktop testing)
hotbar.addEventListener('mousedown', startDragHandler);
document.addEventListener('mousemove', (e) => {
    if (isDragging) moveDragHandler(e);
});
document.addEventListener('mouseup', endDragHandler);

// Window resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        setupCanvas();
    }, 100);
});

// Prevent unwanted behaviors
document.addEventListener('contextmenu', e => e.preventDefault());
document.body.addEventListener('touchmove', e => {
    if (isDragging) e.preventDefault();
}, { passive: false });

// ============================================================
// POLYFILL: CanvasRenderingContext2D.roundRect
// ============================================================
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
        let r = typeof radii === 'number' ? radii : (Array.isArray(radii) ? radii[0] : 0);
        if (r > w / 2) r = w / 2;
        if (r > h / 2) r = h / 2;
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r);
        this.lineTo(x + w, y + h - r);
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.lineTo(x + r, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r);
        this.lineTo(x, y + r);
        this.quadraticCurveTo(x, y, x + r, y);
        this.closePath();
        return this;
    };
}

// ============================================================
// BOOT
// ============================================================
loadAssets();
