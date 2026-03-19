"use strict";

// ================================================================
//  POLYFILL
// ================================================================
(function(){
    if(!CanvasRenderingContext2D.prototype.roundRect){
        CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
            r=typeof r==="number"?r:0;
            if(r>w/2)r=w/2; if(r>h/2)r=h/2;
            this.moveTo(x+r,y);
            this.lineTo(x+w-r,y);
            this.quadraticCurveTo(x+w,y,x+w,y+r);
            this.lineTo(x+w,y+h-r);
            this.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
            this.lineTo(x+r,y+h);
            this.quadraticCurveTo(x,y+h,x,y+h-r);
            this.lineTo(x,y+r);
            this.quadraticCurveTo(x,y,x+r,y);
            this.closePath();
            return this;
        };
    }
})();

// ================================================================
//  CONSTANTS
// ================================================================
const G = 8;
const ASCEND_SCORE = 100;
const BOSS_BASE_HP = 5000;
const MAX_WAVES = 3;
const DRAG_OFFSET = 50;
const BLOCKED = -1;

// Timers (ms)
const MAIN_SWORD_CD    = 30000;  // main-sword every 30s
const DIVINE_SWORD_CD  = 10000;  // divine-sword every 10s (boss phase)
const BOSS_FLASH_CD    = 3000;   // boss flash every 3s
const BOSS_REVENGE_CD  = 15000;  // boss blocks cells every 15s
const BOSS_BOMB_CD     = 20000;  // boss bomb every 20s (5 min too long, made harder)

// ================================================================
//  DOM
// ================================================================
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);

const cvs = $("#game-canvas");
const cx = cvs.getContext("2d");
const cosmicCvs = $("#cosmic-canvas");
const cosmicCx = cosmicCvs ? cosmicCvs.getContext("2d") : null;

// ================================================================
//  IMAGES — GitHub Pages same repo
// ================================================================
const ASSETS = {
    boss:        { src: "boss-entity.png",  label: "BOSS ENTITY" },
    mainSword:   { src: "main-sword.png",   label: "MAIN SWORD" },
    divineSword: { src: "divine-sword.png", label: "DIVINE SWORD" },
};
const IMG = {};

// ================================================================
//  SHAPES
// ================================================================
const SHAPES = [
    {c:[[1,1],[1,1]],       cl:"#ff0055"},
    {c:[[1,1,1,1]],         cl:"#009dff"},
    {c:[[1],[1],[1],[1]],    cl:"#009dff"},
    {c:[[1,0],[1,0],[1,1]],  cl:"#a855f7"},
    {c:[[0,1],[0,1],[1,1]],  cl:"#f59e0b"},
    {c:[[1,1,1],[0,1,0]],    cl:"#10b981"},
    {c:[[1,1,1],[1,0,0]],    cl:"#ef4444"},
    {c:[[1,1,1],[0,0,1]],    cl:"#8b5cf6"},
    {c:[[1,1],[1,0]],        cl:"#ec4899"},
    {c:[[1]],                cl:"#fbbf24"},
    {c:[[1,1],[0,1]],        cl:"#06b6d4"},
    {c:[[1,1,1]],            cl:"#14b8a6"},
    {c:[[1],[1],[1]],        cl:"#14b8a6"},
    {c:[[1,1]],              cl:"#f97316"},
    {c:[[1],[1]],            cl:"#f97316"},
];

// ================================================================
//  STATE
// ================================================================
let grid = [];
let score = 0;
let phase = "menu"; // menu | normal | ascending | boss | gameover | victory
let bossHp = BOSS_BASE_HP;
let bossWave = 1;
let bossAlpha = 0;

// Boss movement — erratic
let bossX = 0, bossY = 0;
let bossTX = 0, bossTY = 0; // target
let bossVX = 0, bossVY = 0;
let bossMoveTimer = 0;
let bossW = 120, bossH = 100;

// Canvas geometry
let cellSz = 0, gridOX = 0, gridOY = 0, cScale = 1, bossAreaH = 0;

// Slots
let slots = [null,null,null];
let drag = null, dragging = false;

// Timers (accumulated ms)
let mainSwordAcc = 0;
let divineSwordAcc = 0;
let bossFlashAcc = 0;
let bossRevengeAcc = 0;
let bossBombAcc = 0;
let lastTs = 0;

// Animation pools
let mainSwords = [];     // main-sword.png projectiles (every 30s, normal+boss)
let divineSwords = [];   // divine-sword.png projectiles (every 10s, boss only)
let bossFlashes = [];    // boss flash effects
let bossBombs = [];      // boss bombs falling on grid
let impactFX = [];
let breakFX = [];
let lineFX = [];
let blockedCells = [];
let shakeAmt = 0, shakeDur = 0;

// Cosmic
let stars = [], stairSegs = [];

// Boss flash screen effect
let bossScreenFlash = 0;

// ================================================================
//  ASSET LOADER
// ================================================================
async function loadAssets() {
    const bar = $("#progress-bar");
    const stat = $("#status-text");
    const list = $("#asset-list");
    const keys = Object.keys(ASSETS);
    let done = 0;

    for (const key of keys) {
        const a = ASSETS[key];
        if (stat) stat.textContent = `LOADING ${a.label}...`;

        const ok = await new Promise(res => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = a.src;
            img.onload = () => { IMG[key] = img; res(true); };
            img.onerror = () => {
                console.warn("MISSING:", a.src);
                res(false);
            };
            setTimeout(() => res(false), 5000);
        });

        done++;
        if (bar) bar.style.width = ((done/keys.length)*100)+"%";
        if (list) list.innerHTML += `<div class="${ok?"ok":"fail"}">${ok?"✔":"✘"} ${a.label}</div>`;
    }

    if (stat) stat.textContent = "ALL SYSTEMS READY";
    await sleep(500);
    const pre = $("#preloader");
    if (pre) { pre.classList.add("hidden"); setTimeout(()=>pre.style.display="none",700); }
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ================================================================
//  CANVAS SIZING
// ================================================================
function sizeCanvas() {
    const wrap = $("#canvas-wrapper");
    if (!wrap) return;
    const wW = wrap.clientWidth, wH = wrap.clientHeight;
    const pad = 10;
    bossAreaH = phase === "boss" ? 160 : 0;
    const avail = Math.min(wW - pad*2, wH - pad*2 - bossAreaH);
    cellSz = Math.floor(avail / G);
    const gPx = cellSz * G;
    cvs.width = Math.max(gPx + pad*2, wW);
    cvs.height = bossAreaH + gPx + pad*2;
    const ds = Math.min(wW/cvs.width, wH/cvs.height, 1);
    cvs.style.width = (cvs.width*ds)+"px";
    cvs.style.height = (cvs.height*ds)+"px";
    cScale = ds;
    gridOX = (cvs.width - gPx)/2;
    gridOY = bossAreaH + pad;

    if (cosmicCvs) { cosmicCvs.width = window.innerWidth; cosmicCvs.height = window.innerHeight; }

    // Init boss position in canvas coords
    if (phase === "boss" && bossX === 0) {
        bossX = cvs.width/2 - bossW/2;
        bossY = 10;
        pickNewBossTarget();
    }
}

// ================================================================
//  GRID
// ================================================================
function resetGrid() { grid = Array.from({length:G}, ()=>Array(G).fill(0)); }

function canPlace(cells, gx, gy) {
    for (let r=0;r<cells.length;r++)
        for (let c=0;c<cells[r].length;c++)
            if (cells[r][c]) {
                const nx=gx+c, ny=gy+r;
                if (nx<0||nx>=G||ny<0||ny>=G) return false;
                if (grid[ny][nx]!==0) return false;
            }
    return true;
}

function placeOnGrid(cells, color, gx, gy) {
    for (let r=0;r<cells.length;r++)
        for (let c=0;c<cells[r].length;c++)
            if (cells[r][c]) grid[gy+r][gx+c] = color;
}

// ================================================================
//  SLOTS
// ================================================================
function rndShape() {
    const d = SHAPES[Math.floor(Math.random()*SHAPES.length)];
    return { cells: d.c.map(r=>[...r]), color: d.cl, used: false };
}

function fillSlots() {
    const els = $$(".slot");
    for (let i=0;i<3;i++) {
        slots[i] = rndShape();
        renderMini(els[i], slots[i]);
        els[i].classList.remove("used","dragging");
    }
}

function renderMini(el, s) {
    el.innerHTML = "";
    const mc = document.createElement("canvas");
    const maxD = Math.max(s.cells.length, s.cells[0].length);
    const u = Math.floor(52/Math.max(maxD,2));
    mc.width=66; mc.height=66;
    const m = mc.getContext("2d");
    const ox = (66-s.cells[0].length*u)/2;
    const oy = (66-s.cells.length*u)/2;
    s.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        m.fillStyle=s.color; m.shadowColor=s.color; m.shadowBlur=5;
        m.beginPath(); m.roundRect(ox+c*u+1, oy+r*u+1, u-2, u-2, 3); m.fill();
        m.shadowBlur=0;
        m.fillStyle="rgba(255,255,255,0.2)";
        m.fillRect(ox+c*u+2, oy+r*u+2, u-4, 2);
    }));
    el.appendChild(mc);
}

function allUsed() { return slots.every(s=>!s||s.used); }

function anyMove() {
    for (let i=0;i<3;i++) {
        if (!slots[i]||slots[i].used) continue;
        const cs=slots[i].cells;
        for (let gy=0;gy<=G-cs.length;gy++)
            for (let gx=0;gx<=G-cs[0].length;gx++)
                if (canPlace(cs,gx,gy)) return true;
    }
    return false;
}

// ================================================================
//  LINE CLEARING
// ================================================================
function clearLines() {
    let rows=[], cols=[];
    for (let y=0;y<G;y++) {
        if (grid[y].every(c=>c!==0&&c!==BLOCKED)) rows.push(y);
    }
    for (let x=0;x<G;x++) {
        let ok=true;
        for (let y=0;y<G;y++) if(grid[y][x]===0||grid[y][x]===BLOCKED){ok=false;break;}
        if (ok) cols.push(x);
    }
    const total = rows.length + cols.length;
    if (total===0) return 0;

    rows.forEach(y=>{
        for(let x=0;x<G;x++)
            spawnBreak(gridOX+x*cellSz+cellSz/2, gridOY+y*cellSz+cellSz/2, grid[y][x]);
    });
    cols.forEach(x=>{
        for(let y=0;y<G;y++) if(!rows.includes(y))
            spawnBreak(gridOX+x*cellSz+cellSz/2, gridOY+y*cellSz+cellSz/2, grid[y][x]);
    });

    rows.forEach(y=>lineFX.push({type:"row",idx:y,a:1,t:20}));
    cols.forEach(x=>lineFX.push({type:"col",idx:x,a:1,t:20}));

    rows.forEach(y=>grid[y].fill(0));
    cols.forEach(x=>{for(let y=0;y<G;y++)grid[y][x]=0;});

    blockedCells = blockedCells.filter(b=>!rows.includes(b.y)&&!cols.includes(b.x));

    const pts = total*50*(total>1?2:1);
    score += pts;
    updateScore();

    if (phase==="boss") {
        // divine swords already handle boss damage separately
        // line clear gives small damage
        bossHp -= total * 30;
        if(bossHp<0)bossHp=0;
        syncBossHUD();
        shake(4,8);
        if(bossHp<=0) onBossKill();
    }
    return total;
}

function updateScore() {
    const el=$("#score"); if(el) el.textContent=score.toString().padStart(4,"0");
}

// ================================================================
//  MAIN SWORD (main-sword.png) — every 30s from bottom
// ================================================================
function spawnMainSword() {
    const sx = cvs.width/2 + (Math.random()-0.5)*100;
    const sy = cvs.height + 50;
    // flies straight up and off screen, clearing random blocks it passes
    mainSwords.push({
        x: sx, y: sy,
        speed: 10 + Math.random()*3,
        rot: 0,
        alpha: 1,
        scale: 0.8,
        alive: true,
        cleared: false,
    });
}

function updateMainSwords() {
    mainSwords.forEach(s=>{
        if(!s.alive) return;
        s.y -= s.speed;
        s.rot += 0.03;

        // when it passes through grid, clear some blocks
        if (!s.cleared && s.y < gridOY + G*cellSz && s.y > gridOY) {
            s.cleared = true;
            // clear 3-5 random filled cells
            let cleared = 0, attempts = 0;
            while (cleared < 4 && attempts < 40) {
                attempts++;
                const rx = Math.floor(Math.random()*G);
                const ry = Math.floor(Math.random()*G);
                if (grid[ry][rx] !== 0 && grid[ry][rx] !== BLOCKED) {
                    spawnBreak(gridOX+rx*cellSz+cellSz/2, gridOY+ry*cellSz+cellSz/2, grid[ry][rx]);
                    grid[ry][rx] = 0;
                    cleared++;
                }
            }
            shake(5,10);
        }

        if (s.y < -150) s.alive = false;
    });
    mainSwords = mainSwords.filter(s=>s.alive);
}

function drawMainSwords() {
    mainSwords.forEach(s=>{
        cx.save();
        cx.globalAlpha = s.alpha;
        cx.translate(s.x, s.y);
        cx.rotate(s.rot);
        cx.scale(s.scale, s.scale);

        if (IMG.mainSword) {
            const w=60, h=120;
            // glow behind
            cx.shadowColor = "#fbbf24";
            cx.shadowBlur = 25;
            cx.drawImage(IMG.mainSword, -w/2, -h/2, w, h);
            cx.shadowBlur = 0;
        } else {
            drawFallbackSword(cx, "#fbbf24");
        }
        cx.restore();
    });
}

// ================================================================
//  DIVINE SWORD (divine-sword.png) — every 10s in boss phase
//  Flies from bottom through grid clearing BLOCKED cells, hits boss for huge damage
// ================================================================
function spawnDivineSword() {
    const sx = cvs.width/2 + (Math.random()-0.5)*60;
    const sy = cvs.height + 60;
    const tx = bossX + bossW/2 + (Math.random()-0.5)*30;
    const ty = bossY + bossH/2;

    divineSwords.push({
        x: sx, y: sy,
        tx, ty,
        speed: 16,
        rot: 0,
        alpha: 1,
        scale: 1.0,
        trail: [],
        alive: true,
        clearedBlocked: false,
        dmg: 500 * bossWave,
    });
}

function updateDivineSwords() {
    divineSwords.forEach(s=>{
        if(!s.alive) return;

        s.trail.push({x:s.x, y:s.y, a:0.9});
        if(s.trail.length>12) s.trail.shift();
        s.trail.forEach(t=>t.a*=0.83);

        // clear blocked cells when passing grid
        if (!s.clearedBlocked && s.y < gridOY + G*cellSz && s.y > gridOY) {
            s.clearedBlocked = true;
            clearAllBlocked();
            // also destroy some regular blocks for chaos
            let n = 0, att = 0;
            while(n<3 && att<30){
                att++;
                const rx=Math.floor(Math.random()*G), ry=Math.floor(Math.random()*G);
                if(grid[ry][rx]!==0 && grid[ry][rx]!==BLOCKED){
                    spawnBreak(gridOX+rx*cellSz+cellSz/2, gridOY+ry*cellSz+cellSz/2, grid[ry][rx]);
                    grid[ry][rx]=0; n++;
                }
            }
            shake(8,15);
        }

        // update target to current boss position
        s.tx = bossX + bossW/2;
        s.ty = bossY + bossH/2;

        const dx=s.tx-s.x, dy=s.ty-s.y;
        const d=Math.hypot(dx,dy);

        if (d < 35) {
            s.alive = false;
            bossHp -= s.dmg;
            if(bossHp<0)bossHp=0;
            syncBossHUD();
            spawnImpact(s.x, s.y, 45);
            shake(16, 28);
            bossScreenFlash = 10;
            flashScreen("heavy");
            if(bossHp<=0) onBossKill();
        } else {
            s.x += (dx/d)*s.speed;
            s.y += (dy/d)*s.speed;
            s.rot = Math.atan2(dy,dx) - Math.PI/2;
        }
    });
    divineSwords = divineSwords.filter(s=>s.alive);
}

function drawDivineSwords() {
    divineSwords.forEach(s=>{
        // trail
        s.trail.forEach(t=>{
            cx.globalAlpha = t.a * 0.4;
            cx.fillStyle = "#a855f7";
            cx.shadowColor = "#a855f7";
            cx.shadowBlur = 12;
            cx.beginPath(); cx.arc(t.x,t.y,7,0,Math.PI*2); cx.fill();
        });
        cx.shadowBlur=0; cx.globalAlpha=s.alpha;

        cx.save();
        cx.translate(s.x, s.y);
        cx.rotate(s.rot);
        cx.scale(s.scale, s.scale);

        if (IMG.divineSword) {
            const w=70, h=140;
            cx.shadowColor = "#e040fb";
            cx.shadowBlur = 30;
            cx.drawImage(IMG.divineSword, -w/2, -h/2, w, h);
            cx.shadowBlur = 0;
        } else {
            drawFallbackSword(cx, "#a855f7");
        }
        cx.restore();
        cx.globalAlpha=1;
    });
}

function drawFallbackSword(c, color) {
    c.fillStyle=color; c.shadowColor=color; c.shadowBlur=12;
    c.beginPath();
    c.moveTo(0,-45); c.lineTo(-9,12); c.lineTo(0,6); c.lineTo(9,12);
    c.closePath(); c.fill();
    c.fillStyle="#999"; c.fillRect(-3,12,6,16);
    c.fillStyle=color; c.fillRect(-11,10,22,4);
    c.shadowBlur=0;
}

// ================================================================
//  BOSS — ERRATIC MOVEMENT
// ================================================================
function pickNewBossTarget() {
    const margin = 20;
    bossTX = margin + Math.random()*(cvs.width - bossW - margin*2);
    bossTY = 5 + Math.random() * (bossAreaH - bossH - 10);
    bossMoveTimer = 500 + Math.random()*800; // ms until next target
}

function updateBossMovement(dt) {
    if (phase !== "boss") return;
    bossMoveTimer -= dt;
    if (bossMoveTimer <= 0) pickNewBossTarget();

    // Lerp aggressively — the boss is FAST and erratic
    const lerpSpeed = 0.06 + bossWave * 0.02;
    bossX += (bossTX - bossX) * lerpSpeed;
    bossY += (bossTY - bossY) * lerpSpeed;

    // Add jitter
    bossX += (Math.random()-0.5) * 2 * bossWave;
    bossY += (Math.random()-0.5) * 1.5;
}

// ================================================================
//  BOSS FLASH (every 3s)
// ================================================================
function bossFlash() {
    if (phase !== "boss") return;
    bossScreenFlash = 8;
    // brief screen flash
    const flash = $("#white-flash");
    if (flash) {
        flash.className = "white-flash flash-in";
        setTimeout(()=>{ flash.className = "white-flash flash-out"; }, 80);
        setTimeout(()=>{ flash.className = "white-flash"; }, 500);
    }
    shake(3, 6);
}

// ================================================================
//  BOSS REVENGE — block cells
// ================================================================
function bossBlockCells() {
    if (phase !== "boss") return;
    const count = 2 + Math.floor(bossWave * 0.5);
    let placed=0, att=0;
    while(placed<count && att<80) {
        att++;
        const rx=Math.floor(Math.random()*G), ry=Math.floor(Math.random()*G);
        if(grid[ry][rx]===0){
            grid[ry][rx]=BLOCKED;
            blockedCells.push({x:rx,y:ry});
            spawnBreak(gridOX+rx*cellSz+cellSz/2, gridOY+ry*cellSz+cellSz/2, "#a855f7");
            placed++;
        }
    }
    if(placed>0){ shake(6,12); }
}

function clearAllBlocked() {
    blockedCells.forEach(b=>{
        if(grid[b.y][b.x]===BLOCKED){
            grid[b.y][b.x]=0;
            spawnBreak(gridOX+b.x*cellSz+cellSz/2, gridOY+b.y*cellSz+cellSz/2, "#a855f7");
        }
    });
    blockedCells = [];
}

// ================================================================
//  BOSS BOMBS (every 20s) — fly up then land on grid
// ================================================================
function spawnBossBombs() {
    if (phase !== "boss") return;
    const count = 2 + bossWave;
    for (let i=0; i<count; i++) {
        const tx = Math.floor(Math.random()*G);
        const ty = Math.floor(Math.random()*G);
        const worldTX = gridOX + tx*cellSz + cellSz/2;
        const worldTY = gridOY + ty*cellSz + cellSz/2;

        bossBombs.push({
            // start from boss
            x: bossX + bossW/2,
            y: bossY + bossH/2,
            tx: worldTX, ty: worldTY,
            gridX: tx, gridY: ty,
            phase: "up", // up then down
            peakY: -50 - Math.random()*80,
            upSpeed: 8 + Math.random()*4,
            downSpeed: 0,
            timer: 0,
            alive: true,
            alpha: 1,
        });
    }
}

function updateBossBombs(dt) {
    bossBombs.forEach(b=>{
        if(!b.alive) return;

        if(b.phase === "up") {
            b.y -= b.upSpeed;
            b.x += (b.tx - b.x) * 0.02;
            if(b.y <= b.peakY) {
                b.phase = "hang";
                b.timer = 800; // hang for 800ms
            }
        } else if(b.phase === "hang") {
            b.timer -= dt;
            b.x += (b.tx - b.x) * 0.05; // center over target
            b.alpha = 0.5 + Math.sin(performance.now()*0.02)*0.5;
            if(b.timer <= 0) {
                b.phase = "down";
                b.downSpeed = 2;
            }
        } else if(b.phase === "down") {
            b.downSpeed += 0.8; // accelerate
            b.y += b.downSpeed;
            b.x += (b.tx - b.x) * 0.1;
            b.alpha = 1;

            if(b.y >= b.ty) {
                b.alive = false;
                // impact — block the cell
                const gx = b.gridX, gy = b.gridY;
                if(gx>=0&&gx<G&&gy>=0&&gy<G){
                    if(grid[gy][gx]===0){
                        grid[gy][gx] = BLOCKED;
                        blockedCells.push({x:gx,y:gy});
                    } else if(grid[gy][gx]!==BLOCKED) {
                        // destroy the block
                        spawnBreak(b.tx, b.ty, grid[gy][gx]);
                        grid[gy][gx] = BLOCKED;
                        blockedCells.push({x:gx,y:gy});
                    }
                }
                spawnImpact(b.tx, b.ty, 15);
                shake(4,8);
            }
        }
    });
    bossBombs = bossBombs.filter(b=>b.alive);
}

function drawBossBombs() {
    bossBombs.forEach(b=>{
        cx.save();
        cx.globalAlpha = b.alpha;

        // draw a glowing orb
        const radius = b.phase==="down" ? 10 + b.downSpeed*0.3 : 8;
        const grd = cx.createRadialGradient(b.x,b.y,0,b.x,b.y,radius*2);
        grd.addColorStop(0, "rgba(255,0,85,0.9)");
        grd.addColorStop(0.5, "rgba(168,85,247,0.5)");
        grd.addColorStop(1, "transparent");
        cx.fillStyle = grd;
        cx.beginPath(); cx.arc(b.x, b.y, radius*2, 0, Math.PI*2); cx.fill();

        cx.fillStyle = "#fff";
        cx.shadowColor = "#ff0055";
        cx.shadowBlur = 15;
        cx.beginPath(); cx.arc(b.x, b.y, radius*0.6, 0, Math.PI*2); cx.fill();
        cx.shadowBlur = 0;

        // if hanging, draw targeting reticle on grid
        if(b.phase==="hang" || b.phase==="down") {
            cx.strokeStyle = `rgba(255,0,85,${0.3+Math.sin(performance.now()*0.015)*0.3})`;
            cx.lineWidth = 2;
            cx.setLineDash([4,4]);
            cx.beginPath(); cx.arc(b.tx, b.ty, cellSz*0.6, 0, Math.PI*2); cx.stroke();
            cx.setLineDash([]);
        }

        cx.restore();
    });
}

// ================================================================
//  PARTICLES
// ================================================================
function spawnImpact(x,y,n) {
    for(let i=0;i<n;i++){
        const a=Math.random()*Math.PI*2, sp=Math.random()*10+2;
        impactFX.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
            life:1, decay:0.02+Math.random()*0.03, sz:2+Math.random()*5,
            clr:Math.random()>0.4?"#ff0055":"#fbbf24"});
    }
}
function spawnBreak(x,y,clr) {
    const c=(typeof clr==="string"&&clr.startsWith("#"))?clr:"#ff0055";
    for(let i=0;i<5;i++){
        const a=Math.random()*Math.PI*2, sp=Math.random()*3+1;
        breakFX.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
            life:1, decay:0.025+Math.random()*0.03, sz:1.5+Math.random()*2.5, clr:c});
    }
}

function updateParticles() {
    impactFX.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.93;p.vy*=0.93;p.life-=p.decay;});
    impactFX=impactFX.filter(p=>p.life>0);
    breakFX.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=0.12;p.life-=p.decay;});
    breakFX=breakFX.filter(p=>p.life>0);
    lineFX.forEach(e=>{e.t--;e.a=e.t/20;});
    lineFX=lineFX.filter(e=>e.t>0);
}

function drawParticles() {
    impactFX.forEach(p=>{
        cx.globalAlpha=p.life; cx.fillStyle=p.clr;
        cx.shadowColor=p.clr; cx.shadowBlur=6;
        cx.beginPath(); cx.arc(p.x,p.y,p.sz,0,Math.PI*2); cx.fill();
    });
    cx.shadowBlur=0;
    breakFX.forEach(p=>{
        cx.globalAlpha=p.life; cx.fillStyle=p.clr;
        cx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz);
    });
    cx.globalAlpha=1;
    lineFX.forEach(e=>{
        cx.fillStyle=`rgba(255,255,255,${e.a*0.45})`;
        if(e.type==="row") cx.fillRect(gridOX, gridOY+e.idx*cellSz, G*cellSz, cellSz);
        else cx.fillRect(gridOX+e.idx*cellSz, gridOY, cellSz, G*cellSz);
    });
}

// ================================================================
//  SCREEN SHAKE
// ================================================================
function shake(a,d){shakeAmt=a;shakeDur=d;}
function getShake(){
    if(shakeDur>0){shakeDur--;const i=shakeAmt*(shakeDur/20);
        return{x:(Math.random()-0.5)*i*2,y:(Math.random()-0.5)*i*2};}
    return{x:0,y:0};
}

function flashScreen(type){
    const el=$("#white-flash"); if(!el)return;
    el.className="white-flash flash-in";
    const hold=type==="heavy"?100:40;
    setTimeout(()=>{el.className="white-flash flash-hold";},80);
    setTimeout(()=>{el.className="white-flash flash-out";},hold+80);
    setTimeout(()=>{el.className="white-flash";},hold+2100);
}

// ================================================================
//  BOSS HUD
// ================================================================
function syncBossHUD(){
    const max=BOSS_BASE_HP*bossWave;
    const r=Math.max(0,bossHp/max);
    const bar=$("#boss-hp-bar"), txt=$("#boss-hp-text"), tag=$("#boss-wave-tag");
    if(bar)bar.style.width=(r*100)+"%";
    if(txt)txt.textContent=`${Math.max(0,Math.floor(bossHp))} / ${max}`;
    if(tag)tag.textContent=`WAVE ${bossWave}`;
}
function showBossHUD(){
    const el=$("#boss-hud"); if(el){el.classList.remove("hidden");el.classList.add("visible");}
    const tb=$("#auto-sword-timer-box"); if(tb){tb.classList.remove("hidden");tb.classList.add("visible");}
}
function hideBossHUD(){
    const el=$("#boss-hud"); if(el){el.classList.add("hidden");el.classList.remove("visible");}
    const tb=$("#auto-sword-timer-box"); if(tb){tb.classList.add("hidden");tb.classList.remove("visible");}
}

// ================================================================
//  ASCENSION SEQUENCE
// ================================================================
async function ascend() {
    phase = "ascending";

    // Phase 1: Float UI away
    const container = $("#game-ui-container");
    if(container) container.classList.add("float-away");
    await sleep(1800);

    // Phase 2: White flash + hold
    const flash = $("#white-flash");
    if(flash) flash.className = "white-flash flash-in";
    await sleep(200);
    if(flash) flash.className = "white-flash flash-hold";
    await sleep(300);

    // Phase 3: "ВОЗНЕСИСЬ" — smooth fade in on white background
    const overlay = $("#ascension-overlay");
    const txt = $("#ascension-text");
    if(txt){
        txt.textContent = "ВОЗНЕСИСЬ";
        txt.className = "ascension-text fade-in";
        txt.style.fontSize = "";
    }
    if(overlay) overlay.classList.add("visible");
    await sleep(3000);

    // Phase 4: Smooth crossfade to second text
    if(txt){
        txt.classList.remove("fade-in");
        txt.classList.add("fade-out");
    }
    await sleep(1500);
    if(txt){
        txt.textContent = "ДА НАЧНЕТСЯ ТВОЕ\nФИНАЛЬНОЕ ИСПЫТАНИЕ";
        txt.style.whiteSpace = "pre-line";
        txt.style.fontSize = "22px";
        txt.classList.remove("fade-out");
        txt.classList.add("fade-in");
    }
    await sleep(3500);

    // Phase 5: Fade out text
    if(txt){
        txt.classList.remove("fade-in");
        txt.classList.add("fade-out");
    }
    await sleep(1500);
    if(overlay) overlay.classList.remove("visible");
    if(txt){ txt.textContent=""; txt.style.fontSize=""; txt.style.whiteSpace=""; txt.className="ascension-text"; }

    // Transition background
    const bg = $("#bg-layer"); if(bg) bg.style.opacity="0";
    const cos = $("#cosmic-bg"); if(cos){cos.classList.remove("hidden");cos.classList.add("visible");}
    initCosmos();

    // Slow fade out white
    if(flash) flash.className = "white-flash flash-out";
    await sleep(2000);
    if(flash) flash.className = "white-flash";

    // Restore UI container
    if(container) container.classList.remove("float-away");

    // Enter boss phase
    phase = "boss";
    bossHp = BOSS_BASE_HP;
    bossWave = 1;
    bossAlpha = 0;
    bossX = 0; bossY = 0;
    mainSwordAcc = 0;
    divineSwordAcc = 0;
    bossFlashAcc = 0;
    bossRevengeAcc = 0;
    bossBombAcc = 0;

    sizeCanvas();
    showBossHUD();
    syncBossHUD();
}

// ================================================================
//  COSMIC BACKGROUND
// ================================================================
function initCosmos() {
    const w=cosmicCvs?cosmicCvs.width:400, h=cosmicCvs?cosmicCvs.height:800;
    stars=[];
    for(let i=0;i<250;i++){
        stars.push({x:Math.random()*w,y:Math.random()*h,
            sz:Math.random()*2+0.4, sp:Math.random()*0.4+0.08,
            br:Math.random(), tw:Math.random()*0.02+0.004});
    }
    stairSegs=[];
    for(let i=0;i<14;i++){
        stairSegs.push({x:w*0.28+i*w*0.035, y:h*0.88-i*h*0.055,
            w:w*0.13, h:5, glow:Math.random(), gd:1});
    }
}

function drawCosmos() {
    if(!cosmicCx||!cosmicCvs)return;
    const w=cosmicCvs.width, h=cosmicCvs.height;
    const g=cosmicCx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,"#08001a"); g.addColorStop(0.35,"#100030");
    g.addColorStop(0.65,"#1a0048"); g.addColorStop(1,"#050811");
    cosmicCx.fillStyle=g; cosmicCx.fillRect(0,0,w,h);

    const neb=cosmicCx.createRadialGradient(w*0.5,h*0.28,0,w*0.5,h*0.28,w*0.45);
    neb.addColorStop(0,"rgba(90,0,180,0.14)");
    neb.addColorStop(0.6,"rgba(40,0,120,0.06)");
    neb.addColorStop(1,"transparent");
    cosmicCx.fillStyle=neb; cosmicCx.fillRect(0,0,w,h);

    stars.forEach(s=>{
        s.br+=s.tw;
        const a=0.25+Math.abs(Math.sin(s.br))*0.75;
        cosmicCx.fillStyle=`rgba(255,255,255,${a})`;
        cosmicCx.beginPath(); cosmicCx.arc(s.x,s.y,s.sz,0,Math.PI*2); cosmicCx.fill();
        s.y+=s.sp; if(s.y>h){s.y=0;s.x=Math.random()*w;}
    });

    stairSegs.forEach(st=>{
        st.glow+=0.018*st.gd;
        if(st.glow>1||st.glow<0.25)st.gd*=-1;
        const a=st.glow*0.35;
        cosmicCx.fillStyle=`rgba(190,170,255,${a})`;
        cosmicCx.shadowColor="rgba(170,150,255,0.5)"; cosmicCx.shadowBlur=14;
        cosmicCx.fillRect(st.x,st.y,st.w,st.h);
        cosmicCx.shadowBlur=0;
        cosmicCx.fillStyle=`rgba(255,255,255,${a*0.4})`;
        cosmicCx.fillRect(st.x,st.y,st.w,1);
    });
}

// ================================================================
//  BOSS DRAWING
// ================================================================
function drawBoss() {
    if(phase!=="boss") return;
    if(bossAlpha<1) bossAlpha=Math.min(1,bossAlpha+0.015);

    cx.save();
    cx.globalAlpha = bossAlpha;

    // Boss aura glow
    const aura = cx.createRadialGradient(bossX+bossW/2, bossY+bossH/2, 10, bossX+bossW/2, bossY+bossH/2, 120);
    aura.addColorStop(0, `rgba(168,85,247,${0.3*bossAlpha})`);
    aura.addColorStop(0.5, `rgba(255,0,85,${0.12*bossAlpha})`);
    aura.addColorStop(1, "transparent");
    cx.fillStyle = aura;
    cx.fillRect(0, 0, cvs.width, bossAreaH);

    // Screen flash overlay from boss
    if(bossScreenFlash > 0) {
        bossScreenFlash--;
        cx.fillStyle = `rgba(255,0,85,${bossScreenFlash*0.03})`;
        cx.fillRect(0, 0, cvs.width, cvs.height);
    }

    if(IMG.boss) {
        cx.drawImage(IMG.boss, bossX, bossY, bossW, bossH);

        // glitch scanlines when damaged
        if(bossScreenFlash > 0 || Math.random() > 0.92) {
            cx.globalCompositeOperation = "screen";
            cx.fillStyle = `rgba(255,0,85,${0.15+Math.random()*0.15})`;
            cx.fillRect(bossX-10, bossY+Math.random()*bossH, bossW+20, 2+Math.random()*3);
            cx.fillStyle = `rgba(0,200,255,${0.1+Math.random()*0.1})`;
            cx.fillRect(bossX-5, bossY+Math.random()*bossH, bossW+10, 2);
            cx.globalCompositeOperation = "source-over";
        }
    } else {
        // fallback boss
        cx.fillStyle = `rgba(168,85,247,${bossAlpha})`;
        cx.shadowColor = "#a855f7"; cx.shadowBlur = 35;
        cx.beginPath(); cx.arc(bossX+bossW/2, bossY+bossH/2, 45, 0, Math.PI*2); cx.fill();
        cx.shadowBlur = 0;
        cx.fillStyle = "#ff0055";
        cx.beginPath(); cx.arc(bossX+bossW/2, bossY+bossH/2-5, 10, 0, Math.PI*2); cx.fill();
        cx.font = "bold 8px Orbitron"; cx.fillStyle = "#fff"; cx.textAlign = "center";
        cx.fillText("NAMELESS DEITY", bossX+bossW/2, bossY+bossH-5);
    }

    cx.restore();
}

// ================================================================
//  BOSS KILL
// ================================================================
function onBossKill() {
    if(bossWave >= MAX_WAVES) {
        phase = "victory";
        flashScreen("heavy");
        setTimeout(()=>{
            $("#game-screen").classList.remove("active");
            $("#boss-defeat-screen").classList.add("active");
            const vs=$("#victory-score"); if(vs)vs.textContent=score.toString().padStart(4,"0");
        }, 2000);
    } else {
        bossWave++;
        bossHp = BOSS_BASE_HP * bossWave;
        syncBossHUD();
        flashScreen("heavy");
        bossScreenFlash = 20;
        mainSwordAcc = 0;
        divineSwordAcc = 0;
        bossRevengeAcc = 0;
        bossBombAcc = 0;
        // Boss gets faster each wave
    }
}

// ================================================================
//  GAME OVER
// ================================================================
function triggerGameOver() {
    if(phase==="gameover"||phase==="victory") return;
    phase = "gameover";
    setTimeout(()=>{
        $("#game-screen").classList.remove("active");
        $("#game-over-screen").classList.add("active");
        const fs=$("#final-score"); if(fs)fs.textContent=score.toString().padStart(4,"0");
    }, 500);
}

// ================================================================
//  GRID DRAWING
// ================================================================
function drawGrid() {
    const now = performance.now();
    for(let y=0;y<G;y++){
        for(let x=0;x<G;x++){
            const dx=gridOX+x*cellSz, dy=gridOY+y*cellSz;
            const val=grid[y][x];

            if(val===0){
                cx.fillStyle="rgba(255,255,255,0.025)";
                cx.beginPath(); cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3); cx.fill();
            } else if(val===BLOCKED){
                const pulse = 0.3+Math.sin(now*0.008)*0.2;
                cx.fillStyle=`rgba(168,85,247,${pulse})`;
                cx.beginPath(); cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3); cx.fill();

                cx.strokeStyle=`rgba(255,0,85,${pulse+0.25})`;
                cx.lineWidth=2.5; cx.lineCap="round";
                const m=7;
                cx.beginPath();
                cx.moveTo(dx+m,dy+m); cx.lineTo(dx+cellSz-m,dy+cellSz-m);
                cx.moveTo(dx+cellSz-m,dy+m); cx.lineTo(dx+m,dy+cellSz-m);
                cx.stroke();

                cx.strokeStyle=`rgba(168,85,247,${pulse*0.6})`;
                cx.lineWidth=1;
                cx.beginPath(); cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3); cx.stroke();
            } else {
                const clr = typeof val==="string"?val:"#ff0055";
                cx.fillStyle="rgba(0,0,0,0.25)";
                cx.beginPath(); cx.roundRect(dx+3,dy+3,cellSz-4,cellSz-4,4); cx.fill();
                cx.fillStyle=clr; cx.shadowColor=clr; cx.shadowBlur=7;
                cx.beginPath(); cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4); cx.fill();
                cx.shadowBlur=0;
                cx.fillStyle="rgba(255,255,255,0.18)";
                cx.fillRect(dx+4,dy+3,cellSz-8,2);
                cx.fillStyle="rgba(0,0,0,0.12)";
                cx.fillRect(dx+4,dy+cellSz-6,cellSz-8,2);
            }

            cx.strokeStyle="rgba(255,255,255,0.04)"; cx.lineWidth=0.5;
            cx.strokeRect(dx,dy,cellSz,cellSz);
        }
    }
    cx.strokeStyle="rgba(255,255,255,0.08)"; cx.lineWidth=1;
    cx.beginPath(); cx.roundRect(gridOX-1,gridOY-1,G*cellSz+2,G*cellSz+2,5); cx.stroke();
}

// ================================================================
//  GHOST + DRAG DRAWING
// ================================================================
function drawGhost() {
    if(!drag||!drag.valid) return;
    drag.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        const dx=gridOX+(drag.gx+c)*cellSz, dy=gridOY+(drag.gy+r)*cellSz;
        cx.fillStyle="rgba(255,255,255,0.12)";
        cx.beginPath(); cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4); cx.fill();
        cx.strokeStyle="rgba(255,255,255,0.35)"; cx.lineWidth=1.5;
        cx.beginPath(); cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4); cx.stroke();
    }));
}

function drawDragged() {
    if(!drag) return;
    drag.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        const px=drag.px+c*cellSz, py=drag.py+r*cellSz;
        cx.globalAlpha=0.82; cx.fillStyle=drag.color;
        cx.shadowColor=drag.color; cx.shadowBlur=10;
        cx.beginPath(); cx.roundRect(px+2,py+2,cellSz-4,cellSz-4,4); cx.fill();
        cx.shadowBlur=0; cx.globalAlpha=1;
        cx.fillStyle="rgba(255,255,255,0.28)";
        cx.fillRect(px+4,py+3,cellSz-8,2);
    }));
}

// ================================================================
//  INPUT
// ================================================================
function cvsCoords(clientX, clientY) {
    const r=cvs.getBoundingClientRect();
    return { x:(clientX-r.left)/cScale, y:(clientY-r.top)/cScale };
}

function onStart(e) {
    if(phase!=="normal"&&phase!=="boss") return;
    const el=e.target.closest(".slot"); if(!el)return;
    const idx=parseInt(el.dataset.slot);
    if(isNaN(idx)||!slots[idx]||slots[idx].used) return;
    e.preventDefault(); dragging=true;

    const t=e.touches?e.touches[0]:e;
    const co=cvsCoords(t.clientX,t.clientY);
    const s=slots[idx];
    const pw=s.cells[0].length*cellSz, ph=s.cells.length*cellSz;

    drag={cells:s.cells,color:s.color,
        px:co.x-pw/2, py:co.y-ph/2-DRAG_OFFSET,
        gx:-1,gy:-1,valid:false,slotIdx:idx};

    el.classList.add("dragging");
}

function onMove(e) {
    if(!dragging||!drag) return;
    e.preventDefault();
    const t=e.touches?e.touches[0]:e;
    const co=cvsCoords(t.clientX,t.clientY);
    const pw=drag.cells[0].length*cellSz, ph=drag.cells.length*cellSz;
    drag.px=co.x-pw/2;
    drag.py=co.y-ph/2-DRAG_OFFSET;

    const centerX=drag.px+pw/2, centerY=drag.py+ph/2;
    const gx=Math.round((centerX-gridOX-pw/2)/cellSz);
    const gy=Math.round((centerY-gridOY-ph/2)/cellSz);
    drag.gx=gx; drag.gy=gy;
    drag.valid=canPlace(drag.cells,gx,gy);
}

function onEnd() {
    if(!dragging||!drag) return;
    const els=$$(".slot"), idx=drag.slotIdx;

    if(drag.valid) {
        placeOnGrid(drag.cells, drag.color, drag.gx, drag.gy);
        slots[idx].used = true;
        els[idx].classList.remove("dragging");
        els[idx].classList.add("used");

        clearLines();
        score += 10;
        updateScore();

        if(score>=ASCEND_SCORE && phase==="normal"){
            drag=null; dragging=false;
            ascend();
            return;
        }

        if(allUsed()){
            setTimeout(fillSlots,180);
        } else {
            setTimeout(()=>{ if(!anyMove()) triggerGameOver(); }, 80);
        }
    } else {
        els[idx].classList.remove("dragging");
    }
    drag=null; dragging=false;
}

// ================================================================
//  TIMER UI
// ================================================================
function updateTimerUI() {
    const mf=$("#main-sword-fill");
    const df=$("#divine-sword-fill");
    if(mf) mf.style.width=Math.min(100,(mainSwordAcc/MAIN_SWORD_CD)*100)+"%";
    if(df) df.style.width=Math.min(100,(divineSwordAcc/DIVINE_SWORD_CD)*100)+"%";
}

// ================================================================
//  MAIN LOOP
// ================================================================
function loop(ts) {
    requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(ts-lastTs, 50) : 16;
    lastTs = ts;

    // ---- UPDATES ----

    // Main sword timer (both phases)
    if(phase==="normal"||phase==="boss") {
        mainSwordAcc += dt;
        if(mainSwordAcc >= MAIN_SWORD_CD) {
            mainSwordAcc = 0;
            spawnMainSword();
        }
    }

    // Boss-specific timers
    if(phase==="boss") {
        divineSwordAcc += dt;
        if(divineSwordAcc >= DIVINE_SWORD_CD) {
            divineSwordAcc = 0;
            spawnDivineSword();
        }

        bossFlashAcc += dt;
        if(bossFlashAcc >= BOSS_FLASH_CD) {
            bossFlashAcc = 0;
            bossFlash();
        }

        bossRevengeAcc += dt;
        if(bossRevengeAcc >= BOSS_REVENGE_CD) {
            bossRevengeAcc = 0;
            bossBlockCells();
        }

        bossBombAcc += dt;
        if(bossBombAcc >= BOSS_BOMB_CD) {
            bossBombAcc = 0;
            spawnBossBombs();
        }

        updateBossMovement(dt);
        updateTimerUI();
    }

    updateMainSwords();
    updateDivineSwords();
    updateBossBombs(dt);
    updateParticles();

    const sk = getShake();

    // ---- DRAW ----
    if(phase==="boss"||phase==="ascending"||phase==="victory") {
        drawCosmos();
    }

    cx.clearRect(0,0,cvs.width,cvs.height);
    cx.save();
    cx.translate(sk.x,sk.y);

    cx.fillStyle="rgba(5,8,17,0.2)";
    cx.fillRect(0,0,cvs.width,cvs.height);

    drawBoss();
    drawGrid();
    drawGhost();
    drawDragged();
    drawMainSwords();
    drawDivineSwords();
    drawBossBombs();
    drawParticles();

    cx.restore();
}

// ================================================================
//  GAME START / RESET
// ================================================================
function startGame() {
    score=0; bossHp=BOSS_BASE_HP; bossWave=1; bossAlpha=0;
    bossX=0; bossY=0;
    mainSwordAcc=0; divineSwordAcc=0; bossFlashAcc=0;
    bossRevengeAcc=0; bossBombAcc=0;
    phase="normal";
    blockedCells=[]; mainSwords=[]; divineSwords=[];
    bossBombs=[]; impactFX=[]; breakFX=[]; lineFX=[];
    shakeAmt=0; shakeDur=0; bossScreenFlash=0;
    drag=null; dragging=false;

    resetGrid(); updateScore(); hideBossHUD(); sizeCanvas(); fillSlots();

    const bg=$("#bg-layer"); if(bg)bg.style.opacity="1";
    const cos=$("#cosmic-bg"); if(cos){cos.classList.add("hidden");cos.classList.remove("visible");}
    const gc=$("#game-ui-container"); if(gc)gc.classList.remove("float-away");
    const ao=$("#ascension-overlay"); if(ao)ao.classList.remove("visible");
    const af=$("#main-sword-fill"); if(af)af.style.width="0%";
    const df=$("#divine-sword-fill"); if(df)df.style.width="0%";
}

function toMenu() {
    $$(".screen").forEach(s=>s.classList.remove("active"));
    $("#main-menu").classList.add("active");
    const bg=$("#bg-layer"); if(bg)bg.style.opacity="1";
    const cos=$("#cosmic-bg"); if(cos){cos.classList.add("hidden");cos.classList.remove("visible");}
    hideBossHUD();
    const gc=$("#game-ui-container"); if(gc)gc.classList.remove("float-away");
    const ao=$("#ascension-overlay"); if(ao)ao.classList.remove("visible");
    phase="menu";
}

// ================================================================
//  EVENTS
// ================================================================
let loopOn=false;

$("#start-btn").addEventListener("click",()=>{
    $("#main-menu").classList.remove("active");
    $("#game-screen").classList.add("active");
    startGame();
    if(!loopOn){loopOn=true; requestAnimationFrame(loop);}
});

$("#retry-btn").addEventListener("click",()=>{
    $("#game-over-screen").classList.remove("active");
    $("#game-screen").classList.add("active");
    startGame();
});

$("#menu-btn").addEventListener("click",()=>{
    $("#game-over-screen").classList.remove("active");
    toMenu();
});

$("#victory-menu-btn").addEventListener("click",()=>{
    $("#boss-defeat-screen").classList.remove("active");
    toMenu();
});

const hotbar=$("#hotbar");
hotbar.addEventListener("touchstart",onStart,{passive:false});
document.addEventListener("touchmove",onMove,{passive:false});
document.addEventListener("touchend",onEnd,{passive:false});
document.addEventListener("touchcancel",onEnd,{passive:false});

hotbar.addEventListener("mousedown",onStart);
document.addEventListener("mousemove",e=>{if(dragging)onMove(e);});
document.addEventListener("mouseup",onEnd);

let rsT;
window.addEventListener("resize",()=>{clearTimeout(rsT);rsT=setTimeout(sizeCanvas,120);});

document.addEventListener("contextmenu",e=>e.preventDefault());
document.body.addEventListener("touchmove",e=>{if(dragging)e.preventDefault();},{passive:false});

// ================================================================
//  BOOT
// ================================================================
loadAssets();
