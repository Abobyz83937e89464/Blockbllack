"use strict";

// ================================================================
//  POLYFILL
// ================================================================
(function(){
    if(!CanvasRenderingContext2D.prototype.roundRect){
        CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
            r=typeof r==="number"?r:0;
            if(r>w/2)r=w/2;if(r>h/2)r=h/2;
            this.moveTo(x+r,y);this.lineTo(x+w-r,y);
            this.quadraticCurveTo(x+w,y,x+w,y+r);
            this.lineTo(x+w,y+h-r);
            this.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
            this.lineTo(x+r,y+h);
            this.quadraticCurveTo(x,y+h,x,y+h-r);
            this.lineTo(x,y+r);
            this.quadraticCurveTo(x,y,x+r,y);
            this.closePath();return this;
        };
    }
})();

// ================================================================
//  CONSTANTS
// ================================================================
const G=8;
const ASCEND_SCORE=100;
const BOSS_BASE=5000;
const MAX_WAVES=3;
const DRAG_UP=50;
const BLOCKED=-1;
const MAIN_SWORD_CD=30000;
const DIVINE_SWORD_CD=10000;
const BOSS_FLASH_CD=3000;
const BOSS_REVENGE_CD=15000;
const BOSS_BOMB_CD=20000;

// ================================================================
//  DOM
// ================================================================
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const cvs=$("#game-canvas");
const cx=cvs.getContext("2d");
const cosCvs=$("#cosmic-canvas");
const cosCx=cosCvs?cosCvs.getContext("2d"):null;

// ================================================================
//  ASSETS
// ================================================================
const ASSETS={
    boss:{src:"boss-entity.png",label:"BOSS ENTITY"},
    mainSword:{src:"main-sword.png",label:"MAIN SWORD"},
    divineSword:{src:"divine-sword.png",label:"DIVINE SWORD"},
    gameOver:{src:"game-over.png",label:"GAME OVER SKULL"},
};
const IMG={};

// ================================================================
//  SHAPES
// ================================================================
const SH=[
    {c:[[1,1],[1,1]],cl:"#ff0055"},
    {c:[[1,1,1,1]],cl:"#009dff"},
    {c:[[1],[1],[1],[1]],cl:"#009dff"},
    {c:[[1,0],[1,0],[1,1]],cl:"#a855f7"},
    {c:[[0,1],[0,1],[1,1]],cl:"#f59e0b"},
    {c:[[1,1,1],[0,1,0]],cl:"#10b981"},
    {c:[[1,1,1],[1,0,0]],cl:"#ef4444"},
    {c:[[1,1,1],[0,0,1]],cl:"#8b5cf6"},
    {c:[[1,1],[1,0]],cl:"#ec4899"},
    {c:[[1]],cl:"#fbbf24"},
    {c:[[1,1],[0,1]],cl:"#06b6d4"},
    {c:[[1,1,1]],cl:"#14b8a6"},
    {c:[[1],[1],[1]],cl:"#14b8a6"},
    {c:[[1,1]],cl:"#f97316"},
    {c:[[1],[1]],cl:"#f97316"},
];

// ================================================================
//  GAME STATE
// ================================================================
let grid=[];
let score=0;
let phase="menu"; // menu|normal|ascending|boss|gameover|victory
let bossHp=BOSS_BASE;
let bossWave=1;
let bossAlpha=0;

// Boss movement
let bossX=0,bossY=0,bossTX=0,bossTY=0;
let bossMoveTimer=0;
let bossW=0,bossH=0;

// Canvas geometry
let cellSz=0,gridOX=0,gridOY=0,cScale=1,bossAreaH=0;

// Slots
let slots=[null,null,null];
let drag=null,dragging=false;

// Timers (ms)
let mainSwAcc=0,divSwAcc=0,bFlashAcc=0,bRevAcc=0,bBombAcc=0;
let lastTs=0;

// Animation pools
let mainSwords=[];
let divineSwords=[];
let bossBombs=[];
let impactFX=[];
let breakFX=[];
let lineFX=[];
let blocked=[];
let shakeA=0,shakeD=0;
let bossScreenFlash=0;

// Cosmic background
let stars=[],stairSegs=[];

// ================================================================
//  UTILITY
// ================================================================
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// ================================================================
//  ASSET LOADER
// ================================================================
async function loadAssets(){
    const bar=$("#progress-bar");
    const stat=$("#status-text");
    const list=$("#asset-list");
    const keys=Object.keys(ASSETS);
    let done=0;

    for(const key of keys){
        const a=ASSETS[key];
        if(stat)stat.textContent="LOADING "+a.label+"...";
        const ok=await new Promise(res=>{
            const img=new Image();
            img.crossOrigin="anonymous";
            img.src=a.src;
            img.onload=()=>{IMG[key]=img;res(true);};
            img.onerror=()=>{console.warn("MISSING:",a.src);res(false);};
            setTimeout(()=>res(false),6000);
        });
        done++;
        if(bar)bar.style.width=((done/keys.length)*100)+"%";
        if(list)list.innerHTML+='<div class="'+(ok?"ok":"fail")+'">'+(ok?"✔":"✘")+" "+a.label+"</div>";
    }

    // Set game-over skull
    const skull=$("#go-skull");
    if(skull&&IMG.gameOver){skull.src=IMG.gameOver.src;}
    else if(skull){skull.style.display="none";}

    if(stat)stat.textContent="ALL SYSTEMS READY";
    await sleep(500);
    const pre=$("#preloader");
    if(pre){pre.classList.add("hidden");setTimeout(()=>{pre.style.display="none";},700);}
}

// ================================================================
//  CANVAS SIZING
// ================================================================
function sizeCanvas(){
    const wrap=$("#canvas-wrapper");
    if(!wrap)return;
    const wW=wrap.clientWidth,wH=wrap.clientHeight,pad=10;

    // Boss area = ~40% of canvas for big boss
    bossAreaH=phase==="boss"?Math.floor(Math.min(wH*0.38,280)):0;

    const avail=Math.min(wW-pad*2,wH-pad*2-bossAreaH);
    cellSz=Math.floor(avail/G);
    const gPx=cellSz*G;

    cvs.width=Math.max(gPx+pad*2,wW);
    cvs.height=bossAreaH+gPx+pad*2;

    const ds=Math.min(wW/cvs.width,wH/cvs.height,1);
    cvs.style.width=(cvs.width*ds)+"px";
    cvs.style.height=(cvs.height*ds)+"px";
    cScale=ds;

    gridOX=(cvs.width-gPx)/2;
    gridOY=bossAreaH+pad;

    // Boss size — BIG ~55% of canvas width
    bossW=Math.floor(cvs.width*0.55);
    bossH=Math.floor(bossAreaH*0.85);
    if(bossW<100)bossW=100;
    if(bossH<80)bossH=80;

    if(cosCvs){cosCvs.width=window.innerWidth;cosCvs.height=window.innerHeight;}

    if(phase==="boss"&&bossX===0&&bossY===0){
        bossX=(cvs.width-bossW)/2;
        bossY=(bossAreaH-bossH)/2;
        pickBossTarget();
    }
}

// ================================================================
//  GRID HELPERS
// ================================================================
function resetGrid(){grid=Array.from({length:G},()=>Array(G).fill(0));}

function canPlace(cells,gx,gy){
    for(let r=0;r<cells.length;r++)
        for(let c=0;c<cells[r].length;c++)
            if(cells[r][c]){
                const nx=gx+c,ny=gy+r;
                if(nx<0||nx>=G||ny<0||ny>=G)return false;
                if(grid[ny][nx]!==0)return false;
            }
    return true;
}

function placeOnGrid(cells,color,gx,gy){
    for(let r=0;r<cells.length;r++)
        for(let c=0;c<cells[r].length;c++)
            if(cells[r][c])grid[gy+r][gx+c]=color;
}

// ================================================================
//  SLOT MANAGEMENT
// ================================================================
function rndShape(){
    const d=SH[Math.floor(Math.random()*SH.length)];
    return{cells:d.c.map(r=>[...r]),color:d.cl,used:false};
}

function fillSlots(){
    const els=$$(".slot");
    for(let i=0;i<3;i++){
        slots[i]=rndShape();
        renderMini(els[i],slots[i]);
        els[i].classList.remove("used","dragging");
    }
}

function renderMini(el,s){
    el.innerHTML="";
    const mc=document.createElement("canvas");
    const maxD=Math.max(s.cells.length,s.cells[0].length);
    const u=Math.floor(52/Math.max(maxD,2));
    mc.width=66;mc.height=66;
    const m=mc.getContext("2d");
    const ox=(66-s.cells[0].length*u)/2;
    const oy=(66-s.cells.length*u)/2;
    s.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        m.fillStyle=s.color;m.shadowColor=s.color;m.shadowBlur=5;
        m.beginPath();m.roundRect(ox+c*u+1,oy+r*u+1,u-2,u-2,3);m.fill();
        m.shadowBlur=0;
        m.fillStyle="rgba(255,255,255,0.2)";
        m.fillRect(ox+c*u+2,oy+r*u+2,u-4,2);
    }));
    el.appendChild(mc);
}

function allUsed(){return slots.every(s=>!s||s.used);}

function anyMove(){
    for(let i=0;i<3;i++){
        if(!slots[i]||slots[i].used)continue;
        const cs=slots[i].cells;
        for(let gy=0;gy<=G-cs.length;gy++)
            for(let gx=0;gx<=G-cs[0].length;gx++)
                if(canPlace(cs,gx,gy))return true;
    }
    return false;
}

// ================================================================
//  LINE CLEARING
// ================================================================
function clearLines(){
    let rows=[],cols=[];
    for(let y=0;y<G;y++){
        if(grid[y].every(c=>c!==0&&c!==BLOCKED))rows.push(y);
    }
    for(let x=0;x<G;x++){
        let ok=true;
        for(let y=0;y<G;y++)if(grid[y][x]===0||grid[y][x]===BLOCKED){ok=false;break;}
        if(ok)cols.push(x);
    }
    const total=rows.length+cols.length;
    if(!total)return 0;

    // break particles
    rows.forEach(y=>{
        for(let x=0;x<G;x++)
            spawnBreak(gridOX+x*cellSz+cellSz/2,gridOY+y*cellSz+cellSz/2,grid[y][x]);
    });
    cols.forEach(x=>{
        for(let y=0;y<G;y++)
            if(!rows.includes(y))
                spawnBreak(gridOX+x*cellSz+cellSz/2,gridOY+y*cellSz+cellSz/2,grid[y][x]);
    });

    // line flash FX
    rows.forEach(y=>lineFX.push({type:"row",idx:y,a:1,t:20}));
    cols.forEach(x=>lineFX.push({type:"col",idx:x,a:1,t:20}));

    // clear grid
    rows.forEach(y=>grid[y].fill(0));
    cols.forEach(x=>{for(let y=0;y<G;y++)grid[y][x]=0;});

    // remove cleared blocked
    blocked=blocked.filter(b=>!rows.includes(b.y)&&!cols.includes(b.x));

    // scoring
    const pts=total*50*(total>1?2:1);
    score+=pts;
    updateScore();

    // boss damage from lines
    if(phase==="boss"){
        bossHp-=total*30;
        if(bossHp<0)bossHp=0;
        syncBoss();
        doShake(4,8);
        if(bossHp<=0)onBossKill();
    }
    return total;
}

function updateScore(){
    const el=$("#score");
    if(el)el.textContent=score.toString().padStart(4,"0");
}

// ================================================================
//  MAIN SWORD (main-sword.png) — every 30s
// ================================================================
function spawnMainSword(){
    mainSwords.push({
        x:cvs.width/2+(Math.random()-0.5)*100,
        y:cvs.height+60,
        speed:9+Math.random()*3,
        rot:0,alpha:1,scale:0.9,
        alive:true,cleared:false
    });
}

function updateMainSwords(){
    mainSwords.forEach(s=>{
        if(!s.alive)return;
        s.y-=s.speed;
        s.rot+=0.02;
        // clear some blocks when passing grid
        if(!s.cleared&&s.y<gridOY+G*cellSz&&s.y>gridOY){
            s.cleared=true;
            let n=0,att=0;
            while(n<4&&att<40){
                att++;
                const rx=Math.floor(Math.random()*G);
                const ry=Math.floor(Math.random()*G);
                if(grid[ry][rx]!==0&&grid[ry][rx]!==BLOCKED){
                    spawnBreak(gridOX+rx*cellSz+cellSz/2,gridOY+ry*cellSz+cellSz/2,grid[ry][rx]);
                    grid[ry][rx]=0;
                    n++;
                }
            }
            doShake(5,10);
        }
        if(s.y<-160)s.alive=false;
    });
    mainSwords=mainSwords.filter(s=>s.alive);
}

function drawMainSwords(){
    mainSwords.forEach(s=>{
        cx.save();
        cx.globalAlpha=s.alpha;
        cx.translate(s.x,s.y);
        cx.rotate(s.rot);
        cx.scale(s.scale,s.scale);
        if(IMG.mainSword){
            const w=65,h=130;
            cx.shadowColor="#fbbf24";
            cx.shadowBlur=30;
            cx.drawImage(IMG.mainSword,-w/2,-h/2,w,h);
            cx.shadowBlur=0;
        }else{
            fallbackSword(cx,"#fbbf24");
        }
        cx.restore();
    });
}

// ================================================================
//  DIVINE SWORD (divine-sword.png) — every 10s boss only
// ================================================================
function spawnDivineSword(){
    divineSwords.push({
        x:cvs.width/2+(Math.random()-0.5)*60,
        y:cvs.height+70,
        tx:bossX+bossW/2,
        ty:bossY+bossH/2,
        speed:15,rot:0,alpha:1,scale:1.1,
        trail:[],alive:true,clearedBlk:false,
        dmg:500*bossWave
    });
}

function updateDivineSwords(){
    divineSwords.forEach(s=>{
        if(!s.alive)return;

        // trail
        s.trail.push({x:s.x,y:s.y,a:0.9});
        if(s.trail.length>14)s.trail.shift();
        s.trail.forEach(t=>{t.a*=0.82;});

        // clear blocked when passing through grid
        if(!s.clearedBlk&&s.y<gridOY+G*cellSz&&s.y>gridOY){
            s.clearedBlk=true;
            clearAllBlocked();
            // also destroy random blocks for chaos
            let n=0,att=0;
            while(n<3&&att<30){
                att++;
                const rx=Math.floor(Math.random()*G);
                const ry=Math.floor(Math.random()*G);
                if(grid[ry][rx]!==0&&grid[ry][rx]!==BLOCKED){
                    spawnBreak(gridOX+rx*cellSz+cellSz/2,gridOY+ry*cellSz+cellSz/2,grid[ry][rx]);
                    grid[ry][rx]=0;
                    n++;
                }
            }
            doShake(8,15);
        }

        // track boss position
        s.tx=bossX+bossW/2;
        s.ty=bossY+bossH/2;

        const dx=s.tx-s.x,dy=s.ty-s.y;
        const d=Math.hypot(dx,dy);

        if(d<40){
            // HIT BOSS
            s.alive=false;
            bossHp-=s.dmg;
            if(bossHp<0)bossHp=0;
            syncBoss();
            spawnImpact(s.x,s.y,50);
            doShake(18,30);
            bossScreenFlash=12;
            doFlash("impact");
            if(bossHp<=0)onBossKill();
        }else{
            s.x+=(dx/d)*s.speed;
            s.y+=(dy/d)*s.speed;
            s.rot=Math.atan2(dy,dx)-Math.PI/2;
        }
    });
    divineSwords=divineSwords.filter(s=>s.alive);
}

function drawDivineSwords(){
    divineSwords.forEach(s=>{
        // trail glow
        s.trail.forEach(t=>{
            cx.globalAlpha=t.a*0.4;
            cx.fillStyle="#a855f7";
            cx.shadowColor="#a855f7";
            cx.shadowBlur=14;
            cx.beginPath();
            cx.arc(t.x,t.y,8,0,Math.PI*2);
            cx.fill();
        });
        cx.shadowBlur=0;
        cx.globalAlpha=s.alpha;

        cx.save();
        cx.translate(s.x,s.y);
        cx.rotate(s.rot);
        cx.scale(s.scale,s.scale);

        if(IMG.divineSword){
            const w=75,h=150;
            cx.shadowColor="#e040fb";
            cx.shadowBlur=35;
            cx.drawImage(IMG.divineSword,-w/2,-h/2,w,h);
            cx.shadowBlur=0;
        }else{
            fallbackSword(cx,"#a855f7");
        }
        cx.restore();
        cx.globalAlpha=1;
    });
}

function fallbackSword(c,color){
    c.fillStyle=color;
    c.shadowColor=color;
    c.shadowBlur=12;
    c.beginPath();
    c.moveTo(0,-45);c.lineTo(-9,12);c.lineTo(0,6);c.lineTo(9,12);
    c.closePath();c.fill();
    c.fillStyle="#999";c.fillRect(-3,12,6,16);
    c.fillStyle=color;c.fillRect(-11,10,22,4);
    c.shadowBlur=0;
}

// ================================================================
//  BOSS MOVEMENT — erratic & fast
// ================================================================
function pickBossTarget(){
    const m=10;
    bossTX=m+Math.random()*(cvs.width-bossW-m*2);
    bossTY=Math.random()*(bossAreaH-bossH-5)+2;
    bossMoveTimer=300+Math.random()*600;
}

function updateBoss(dt){
    if(phase!=="boss")return;
    bossMoveTimer-=dt;
    if(bossMoveTimer<=0)pickBossTarget();

    const spd=0.07+bossWave*0.025;
    bossX+=(bossTX-bossX)*spd;
    bossY+=(bossTY-bossY)*spd;

    // jitter
    bossX+=(Math.random()-0.5)*3*bossWave;
    bossY+=(Math.random()-0.5)*2;

    // clamp
    if(bossX<0)bossX=0;
    if(bossX>cvs.width-bossW)bossX=cvs.width-bossW;
    if(bossY<0)bossY=0;
    if(bossY>bossAreaH-bossH)bossY=bossAreaH-bossH;
}

// ================================================================
//  BOSS FLASH (every 3s)
// ================================================================
function doBossFlash(){
    if(phase!=="boss")return;
    bossScreenFlash=8;
    const rf=$("#red-flash");
    if(rf){
        rf.className="red-flash pulse-in";
        setTimeout(()=>{rf.className="red-flash pulse-out";},100);
        setTimeout(()=>{rf.className="red-flash";},1200);
    }
    doShake(3,6);
}

// ================================================================
//  BOSS REVENGE — block cells
// ================================================================
function bossBlock(){
    if(phase!=="boss")return;
    const cnt=2+Math.floor(bossWave*0.5);
    let p=0,a=0;
    while(p<cnt&&a<80){
        a++;
        const rx=Math.floor(Math.random()*G);
        const ry=Math.floor(Math.random()*G);
        if(grid[ry][rx]===0){
            grid[ry][rx]=BLOCKED;
            blocked.push({x:rx,y:ry});
            spawnBreak(gridOX+rx*cellSz+cellSz/2,gridOY+ry*cellSz+cellSz/2,"#a855f7");
            p++;
        }
    }
    if(p>0)doShake(6,12);
}

function clearAllBlocked(){
    blocked.forEach(b=>{
        if(b.y>=0&&b.y<G&&b.x>=0&&b.x<G&&grid[b.y][b.x]===BLOCKED){
            grid[b.y][b.x]=0;
            spawnBreak(gridOX+b.x*cellSz+cellSz/2,gridOY+b.y*cellSz+cellSz/2,"#a855f7");
        }
    });
    blocked=[];
}

// ================================================================
//  BOSS BOMBS — fly up, hang, slam down
// ================================================================
function spawnBombs(){
    if(phase!=="boss")return;
    const cnt=2+bossWave;
    for(let i=0;i<cnt;i++){
        const tx=Math.floor(Math.random()*G);
        const ty=Math.floor(Math.random()*G);
        const worldTX=gridOX+tx*cellSz+cellSz/2;
        const worldTY=gridOY+ty*cellSz+cellSz/2;
        bossBombs.push({
            x:bossX+bossW/2,
            y:bossY+bossH/2,
            tx:worldTX,ty:worldTY,
            gx:tx,gy:ty,
            ph:"up",
            peakY:-50-Math.random()*80,
            upSpd:8+Math.random()*4,
            downSpd:0,
            timer:0,
            alive:true,
            alpha:1
        });
    }
}

function updateBombs(dt){
    bossBombs.forEach(b=>{
        if(!b.alive)return;

        if(b.ph==="up"){
            b.y-=b.upSpd;
            b.x+=(b.tx-b.x)*0.02;
            if(b.y<=b.peakY){
                b.ph="hang";
                b.timer=800;
            }
        }else if(b.ph==="hang"){
            b.timer-=dt;
            b.x+=(b.tx-b.x)*0.05;
            b.alpha=0.5+Math.sin(performance.now()*0.02)*0.5;
            if(b.timer<=0){
                b.ph="down";
                b.downSpd=2;
            }
        }else if(b.ph==="down"){
            b.downSpd+=0.8;
            b.y+=b.downSpd;
            b.x+=(b.tx-b.x)*0.1;
            b.alpha=1;
            if(b.y>=b.ty){
                b.alive=false;
                const gx=b.gx,gy=b.gy;
                if(gx>=0&&gx<G&&gy>=0&&gy<G){
                    if(grid[gy][gx]===0){
                        grid[gy][gx]=BLOCKED;
                        blocked.push({x:gx,y:gy});
                    }else if(grid[gy][gx]!==BLOCKED){
                        spawnBreak(b.tx,b.ty,grid[gy][gx]);
                        grid[gy][gx]=BLOCKED;
                        blocked.push({x:gx,y:gy});
                    }
                }
                spawnImpact(b.tx,b.ty,15);
                doShake(4,8);
            }
        }
    });
    bossBombs=bossBombs.filter(b=>b.alive);
}

function drawBombs(){
    bossBombs.forEach(b=>{
        cx.save();
        cx.globalAlpha=b.alpha;

        const r=b.ph==="down"?10+b.downSpd*0.3:8;

        // glowing orb
        const grd=cx.createRadialGradient(b.x,b.y,0,b.x,b.y,r*2);
        grd.addColorStop(0,"rgba(255,0,85,0.9)");
        grd.addColorStop(0.5,"rgba(168,85,247,0.5)");
        grd.addColorStop(1,"transparent");
        cx.fillStyle=grd;
        cx.beginPath();
        cx.arc(b.x,b.y,r*2,0,Math.PI*2);
        cx.fill();

        // white core
        cx.fillStyle="#fff";
        cx.shadowColor="#ff0055";
        cx.shadowBlur=15;
        cx.beginPath();
        cx.arc(b.x,b.y,r*0.6,0,Math.PI*2);
        cx.fill();
        cx.shadowBlur=0;

        // targeting reticle
        if(b.ph==="hang"||b.ph==="down"){
            cx.strokeStyle="rgba(255,0,85,"+(0.3+Math.sin(performance.now()*0.015)*0.3)+")";
            cx.lineWidth=2;
            cx.setLineDash([4,4]);
            cx.beginPath();
            cx.arc(b.tx,b.ty,cellSz*0.6,0,Math.PI*2);
            cx.stroke();
            cx.setLineDash([]);

            // crosshair
            cx.beginPath();
            cx.moveTo(b.tx-cellSz*0.4,b.ty);
            cx.lineTo(b.tx+cellSz*0.4,b.ty);
            cx.moveTo(b.tx,b.ty-cellSz*0.4);
            cx.lineTo(b.tx,b.ty+cellSz*0.4);
            cx.stroke();
        }

        cx.restore();
    });
}

// ================================================================
//  PARTICLES
// ================================================================
function spawnImpact(x,y,n){
    for(let i=0;i<n;i++){
        const a=Math.random()*Math.PI*2;
        const sp=Math.random()*10+2;
        impactFX.push({
            x:x,y:y,
            vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
            life:1,decay:0.02+Math.random()*0.03,
            sz:2+Math.random()*5,
            clr:Math.random()>0.4?"#ff0055":"#fbbf24"
        });
    }
}

function spawnBreak(x,y,clr){
    const color=(typeof clr==="string"&&clr.startsWith("#"))?clr:"#ff0055";
    for(let i=0;i<5;i++){
        const a=Math.random()*Math.PI*2;
        const sp=Math.random()*3+1;
        breakFX.push({
            x:x,y:y,
            vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
            life:1,decay:0.025+Math.random()*0.03,
            sz:1.5+Math.random()*2.5,
            clr:color
        });
    }
}

function updateParticles(){
    impactFX.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy;
        p.vx*=0.93;p.vy*=0.93;
        p.life-=p.decay;
    });
    impactFX=impactFX.filter(p=>p.life>0);

    breakFX.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy;
        p.vy+=0.12;
        p.life-=p.decay;
    });
    breakFX=breakFX.filter(p=>p.life>0);

    lineFX.forEach(e=>{e.t--;e.a=e.t/20;});
    lineFX=lineFX.filter(e=>e.t>0);
}

function drawParticles(){
    // impact
    impactFX.forEach(p=>{
        cx.globalAlpha=p.life;
        cx.fillStyle=p.clr;
        cx.shadowColor=p.clr;
        cx.shadowBlur=6;
        cx.beginPath();
        cx.arc(p.x,p.y,p.sz,0,Math.PI*2);
        cx.fill();
    });
    cx.shadowBlur=0;

    // break
    breakFX.forEach(p=>{
        cx.globalAlpha=p.life;
        cx.fillStyle=p.clr;
        cx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz);
    });
    cx.globalAlpha=1;

    // line flash
    lineFX.forEach(e=>{
        cx.fillStyle="rgba(255,255,255,"+e.a*0.45+")";
        if(e.type==="row")
            cx.fillRect(gridOX,gridOY+e.idx*cellSz,G*cellSz,cellSz);
        else
            cx.fillRect(gridOX+e.idx*cellSz,gridOY,cellSz,G*cellSz);
    });
}

// ================================================================
//  SCREEN SHAKE
// ================================================================
function doShake(a,d){shakeA=a;shakeD=d;}

function getShake(){
    if(shakeD>0){
        shakeD--;
        const i=shakeA*(shakeD/20);
        return{x:(Math.random()-0.5)*i*2,y:(Math.random()-0.5)*i*2};
    }
    return{x:0,y:0};
}

// ================================================================
//  FLASH HELPERS
// ================================================================
function doFlash(type){
    const el=$("#white-flash");
    if(!el)return;

    if(type==="impact"){
        el.className="white-flash impact-in";
        setTimeout(()=>{el.className="white-flash impact-out";},120);
        setTimeout(()=>{el.className="white-flash";},800);
    }else if(type==="quick"){
        el.className="white-flash flash-quick-in";
        setTimeout(()=>{el.className="white-flash flash-quick-out";},250);
        setTimeout(()=>{el.className="white-flash";},1200);
    }else if(type==="boss-reveal"){
        el.className="white-flash boss-reveal-in";
        setTimeout(()=>{el.className="white-flash boss-reveal-out";},400);
        setTimeout(()=>{el.className="white-flash";},2000);
    }
}

// ================================================================
//  BOSS HUD
// ================================================================
function syncBoss(){
    const max=BOSS_BASE*bossWave;
    const r=Math.max(0,bossHp/max);
    const bar=$("#boss-hp-bar");
    const txt=$("#boss-hp-text");
    const tag=$("#boss-wave-tag");
    if(bar)bar.style.width=(r*100)+"%";
    if(txt)txt.textContent=Math.max(0,Math.floor(bossHp))+" / "+max;
    if(tag)tag.textContent="WAVE "+bossWave;
}

function showBossHUD(){
    const el=$("#boss-hud");
    if(el){el.classList.remove("hidden");el.classList.add("visible");}
    const tb=$("#timer-box");
    if(tb){tb.classList.remove("hidden");tb.classList.add("visible");}
}

function hideBossHUD(){
    const el=$("#boss-hud");
    if(el){el.classList.add("hidden");el.classList.remove("visible");}
    const tb=$("#timer-box");
    if(tb){tb.classList.add("hidden");tb.classList.remove("visible");}
}

function updateTimerUI(){
    const mf=$("#main-sword-fill");
    const df=$("#divine-sword-fill");
    if(mf)mf.style.width=Math.min(100,(mainSwAcc/MAIN_SWORD_CD)*100)+"%";
    if(df)df.style.width=Math.min(100,(divSwAcc/DIVINE_SWORD_CD)*100)+"%";
}

// ================================================================
//  QUESTION MARKS GENERATOR
// ================================================================
function showQuestionMarks(){
    const container=$("#question-marks");
    if(!container)return;
    container.innerHTML="";

    // fill with ??? scattered
    for(let i=0;i<60;i++){
        const span=document.createElement("span");
        span.className="qm";
        span.textContent="?";
        span.style.animationDelay=(Math.random()*2)+"s";
        span.style.fontSize=(20+Math.random()*30)+"px";
        span.style.opacity=0.4+Math.random()*0.6;
        container.appendChild(span);
    }
    container.classList.add("visible");
}

function hideQuestionMarks(){
    const container=$("#question-marks");
    if(!container)return;
    container.classList.remove("visible");
    setTimeout(()=>{container.innerHTML="";},1500);
}

// ================================================================
//  ASCENSION SEQUENCE — cinematic multi-phase
// ================================================================
async function ascend(){
    phase="ascending";

    // PHASE 1: Float UI away smoothly
    const container=$("#game-ui-container");
    if(container)container.classList.add("float-away");
    await sleep(2200);

    // PHASE 2: Gradual white flash — builds slowly
    const flash=$("#white-flash");
    if(flash)flash.className="white-flash phase-1";
    await sleep(2000);
    if(flash)flash.className="white-flash phase-2";
    await sleep(2500);
    if(flash)flash.className="white-flash phase-3";
    await sleep(2000);
    if(flash)flash.className="white-flash phase-full";
    await sleep(1500);
    if(flash)flash.className="white-flash phase-hold";

    // PHASE 3: "ВОЗНЕСИСЬ" — beautiful smooth fade in
    const overlay=$("#ascension-overlay");
    const txt=$("#ascension-text");
    if(overlay)overlay.classList.add("visible");
    await sleep(300);

    if(txt){
        txt.textContent="ВОЗНЕСИСЬ";
        txt.className="ascension-text text-glow-red";
        await sleep(50);
        txt.classList.add("show");
    }
    await sleep(3500);

    // smooth fade out first text
    if(txt){
        txt.classList.remove("show");
        txt.classList.add("hide");
    }
    await sleep(1800);

    // PHASE 4: Second text
    if(txt){
        txt.className="ascension-text text-glow-gold";
        txt.textContent="ДА НАЧНЕТСЯ ТВОЕ\nФИНАЛЬНОЕ ИСПЫТАНИЕ";
        await sleep(50);
        txt.classList.add("show");
    }
    await sleep(4000);

    // fade out second text
    if(txt){
        txt.classList.remove("show");
        txt.classList.add("hide");
    }
    await sleep(2000);

    // hide overlay text
    if(overlay)overlay.classList.remove("visible");
    if(txt){txt.textContent="";txt.className="ascension-text";}

    // PHASE 5: fade out white — everything looks normal again
    if(flash)flash.className="white-flash phase-fade";

    // transition backgrounds
    const bg=$("#bg-layer");
    if(bg)bg.style.opacity="0";
    const cos=$("#cosmic-bg");
    if(cos){cos.classList.remove("hidden");cos.classList.add("visible");}
    initCosmos();

    await sleep(3000);
    if(flash)flash.className="white-flash";

    // restore UI
    if(container)container.classList.remove("float-away");
    await sleep(1500);

    // looks normal for a moment...
    await sleep(2000);

    // PHASE 6: SUDDEN sharp flash — boss reveal!
    doFlash("boss-reveal");
    await sleep(200);

    // QUESTION MARKS flood the screen
    showQuestionMarks();
    await sleep(5000);

    // hide question marks
    hideQuestionMarks();
    await sleep(1500);

    // Enter boss phase
    phase="boss";
    bossHp=BOSS_BASE;
    bossWave=1;
    bossAlpha=0;
    bossX=0;bossY=0;
    mainSwAcc=0;divSwAcc=0;
    bFlashAcc=0;bRevAcc=0;bBombAcc=0;

    sizeCanvas();
    showBossHUD();
    syncBoss();
}

// ================================================================
//  COSMIC BACKGROUND
// ================================================================
function initCosmos(){
    const w=cosCvs?cosCvs.width:400;
    const h=cosCvs?cosCvs.height:800;
    stars=[];
    for(let i=0;i<250;i++){
        stars.push({
            x:Math.random()*w,y:Math.random()*h,
            sz:Math.random()*2+0.4,sp:Math.random()*0.4+0.08,
            br:Math.random(),tw:Math.random()*0.02+0.004
        });
    }
    stairSegs=[];
    for(let i=0;i<14;i++){
        stairSegs.push({
            x:w*0.28+i*w*0.035,
            y:h*0.88-i*h*0.055,
            w:w*0.13,h:5,
            glow:Math.random(),gd:1
        });
    }
}

function drawCosmos(){
    if(!cosCx||!cosCvs)return;
    const w=cosCvs.width,h=cosCvs.height;

    // sky gradient
    const g=cosCx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,"#08001a");
    g.addColorStop(0.35,"#100030");
    g.addColorStop(0.65,"#1a0048");
    g.addColorStop(1,"#050811");
    cosCx.fillStyle=g;
    cosCx.fillRect(0,0,w,h);

    // nebula
    const neb=cosCx.createRadialGradient(w*0.5,h*0.28,0,w*0.5,h*0.28,w*0.45);
    neb.addColorStop(0,"rgba(90,0,180,0.14)");
    neb.addColorStop(0.6,"rgba(40,0,120,0.06)");
    neb.addColorStop(1,"transparent");
    cosCx.fillStyle=neb;
    cosCx.fillRect(0,0,w,h);

    // stars
    stars.forEach(s=>{
        s.br+=s.tw;
        const a=0.25+Math.abs(Math.sin(s.br))*0.75;
        cosCx.fillStyle="rgba(255,255,255,"+a+")";
        cosCx.beginPath();
        cosCx.arc(s.x,s.y,s.sz,0,Math.PI*2);
        cosCx.fill();
        s.y+=s.sp;
        if(s.y>h){s.y=0;s.x=Math.random()*w;}
    });

    // glowing stairs
    stairSegs.forEach(st=>{
        st.glow+=0.018*st.gd;
        if(st.glow>1||st.glow<0.25)st.gd*=-1;
        const a=st.glow*0.35;
        cosCx.fillStyle="rgba(190,170,255,"+a+")";
        cosCx.shadowColor="rgba(170,150,255,0.5)";
        cosCx.shadowBlur=14;
        cosCx.fillRect(st.x,st.y,st.w,st.h);
        cosCx.shadowBlur=0;
        cosCx.fillStyle="rgba(255,255,255,"+a*0.4+")";
        cosCx.fillRect(st.x,st.y,st.w,1);
    });
}

// ================================================================
//  BOSS DRAWING — BIG boss
// ================================================================
function drawBoss(){
    if(phase!=="boss")return;

    // fade in
    if(bossAlpha<1)bossAlpha=Math.min(1,bossAlpha+0.015);

    cx.save();
    cx.globalAlpha=bossAlpha;

    // aura glow
    const aura=cx.createRadialGradient(
        bossX+bossW/2,bossY+bossH/2,20,
        bossX+bossW/2,bossY+bossH/2,bossW*0.7
    );
    aura.addColorStop(0,"rgba(168,85,247,"+0.3*bossAlpha+")");
    aura.addColorStop(0.4,"rgba(255,0,85,"+0.15*bossAlpha+")");
    aura.addColorStop(1,"transparent");
    cx.fillStyle=aura;
    cx.fillRect(0,0,cvs.width,bossAreaH+20);

    // screen flash overlay
    if(bossScreenFlash>0){
        bossScreenFlash--;
        cx.fillStyle="rgba(255,0,85,"+bossScreenFlash*0.025+")";
        cx.fillRect(0,0,cvs.width,cvs.height);
    }

    // boss jitter when damaged
    let jx=0,jy=0;
    if(bossScreenFlash>0){
        jx=(Math.random()-0.5)*10;
        jy=(Math.random()-0.5)*6;
    }

    // draw boss image BIG
    if(IMG.boss){
        cx.drawImage(IMG.boss,bossX+jx,bossY+jy,bossW,bossH);

        // glitch scanlines
        if(bossScreenFlash>0||Math.random()>0.93){
            cx.globalCompositeOperation="screen";
            cx.fillStyle="rgba(255,0,85,"+(0.12+Math.random()*0.15)+")";
            cx.fillRect(bossX-15,bossY+Math.random()*bossH,bossW+30,2+Math.random()*4);
            cx.fillStyle="rgba(0,200,255,"+(0.08+Math.random()*0.1)+")";
            cx.fillRect(bossX-8,bossY+Math.random()*bossH,bossW+16,2);
            cx.globalCompositeOperation="source-over";
        }
    }else{
        // fallback circle boss
        cx.fillStyle="rgba(168,85,247,"+bossAlpha+")";
        cx.shadowColor="#a855f7";
        cx.shadowBlur=40;
        cx.beginPath();
        cx.arc(bossX+bossW/2,bossY+bossH/2,bossH*0.4,0,Math.PI*2);
        cx.fill();
        cx.shadowBlur=0;

        cx.fillStyle="#ff0055";
        cx.beginPath();
        cx.arc(bossX+bossW/2,bossY+bossH/2-5,12,0,Math.PI*2);
        cx.fill();

        cx.font="bold 10px Orbitron";
        cx.fillStyle="#fff";
        cx.textAlign="center";
        cx.fillText("NAMELESS DEITY",bossX+bossW/2,bossY+bossH-10);
    }

    cx.restore();
}

// ================================================================
//  BOSS KILL
// ================================================================
function onBossKill(){
    if(bossWave>=MAX_WAVES){
        phase="victory";
        doFlash("impact");
        doShake(20,40);
        setTimeout(()=>{
            $("#game-screen").classList.remove("active");
            $("#boss-defeat-screen").classList.add("active");
            const vs=$("#victory-score");
            if(vs)vs.textContent=score.toString().padStart(4,"0");
        },2000);
    }else{
        bossWave++;
        bossHp=BOSS_BASE*bossWave;
        syncBoss();
        doFlash("impact");
        doShake(14,25);
        bossScreenFlash=20;
        mainSwAcc=0;
        divSwAcc=0;
        bRevAcc=0;
        bBombAcc=0;
    }
}

// ================================================================
//  GAME OVER
// ================================================================
function triggerGameOver(){
    if(phase==="gameover"||phase==="victory")return;
    phase="gameover";
    setTimeout(()=>{
        $("#game-screen").classList.remove("active");
        $("#game-over-screen").classList.add("active");
        const fs=$("#final-score");
        if(fs)fs.textContent=score.toString().padStart(4,"0");
    },500);
}

// ================================================================
//  GRID DRAWING
// ================================================================
function drawGrid(){
    const now=performance.now();
    for(let y=0;y<G;y++){
        for(let x=0;x<G;x++){
            const dx=gridOX+x*cellSz;
            const dy=gridOY+y*cellSz;
            const val=grid[y][x];

            if(val===0){
                // empty cell
                cx.fillStyle="rgba(255,255,255,0.025)";
                cx.beginPath();
                cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3);
                cx.fill();
            }else if(val===BLOCKED){
                // boss blocked cell
                const pulse=0.3+Math.sin(now*0.008)*0.2;
                cx.fillStyle="rgba(168,85,247,"+pulse+")";
                cx.beginPath();
                cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3);
                cx.fill();

                // X mark
                cx.strokeStyle="rgba(255,0,85,"+(pulse+0.25)+")";
                cx.lineWidth=2.5;
                cx.lineCap="round";
                const m=7;
                cx.beginPath();
                cx.moveTo(dx+m,dy+m);
                cx.lineTo(dx+cellSz-m,dy+cellSz-m);
                cx.moveTo(dx+cellSz-m,dy+m);
                cx.lineTo(dx+m,dy+cellSz-m);
                cx.stroke();

                // pulsing border
                cx.strokeStyle="rgba(168,85,247,"+pulse*0.6+")";
                cx.lineWidth=1;
                cx.beginPath();
                cx.roundRect(dx+1,dy+1,cellSz-2,cellSz-2,3);
                cx.stroke();
            }else{
                // filled cell
                const clr=typeof val==="string"?val:"#ff0055";

                // shadow
                cx.fillStyle="rgba(0,0,0,0.25)";
                cx.beginPath();
                cx.roundRect(dx+3,dy+3,cellSz-4,cellSz-4,4);
                cx.fill();

                // block
                cx.fillStyle=clr;
                cx.shadowColor=clr;
                cx.shadowBlur=7;
                cx.beginPath();
                cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4);
                cx.fill();
                cx.shadowBlur=0;

                // highlight
                cx.fillStyle="rgba(255,255,255,0.18)";
                cx.fillRect(dx+4,dy+3,cellSz-8,2);

                // bottom shadow
                cx.fillStyle="rgba(0,0,0,0.12)";
                cx.fillRect(dx+4,dy+cellSz-6,cellSz-8,2);
            }

            // grid line
            cx.strokeStyle="rgba(255,255,255,0.04)";
            cx.lineWidth=0.5;
            cx.strokeRect(dx,dy,cellSz,cellSz);
        }
    }

    // outer border
    cx.strokeStyle="rgba(255,255,255,0.08)";
    cx.lineWidth=1;
    cx.beginPath();
    cx.roundRect(gridOX-1,gridOY-1,G*cellSz+2,G*cellSz+2,5);
    cx.stroke();
}

// ================================================================
//  GHOST PREVIEW
// ================================================================
function drawGhost(){
    if(!drag||!drag.valid)return;
    drag.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        const dx=gridOX+(drag.gx+c)*cellSz;
        const dy=gridOY+(drag.gy+r)*cellSz;

        cx.fillStyle="rgba(255,255,255,0.12)";
        cx.beginPath();
        cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4);
        cx.fill();

        cx.strokeStyle="rgba(255,255,255,0.35)";
        cx.lineWidth=1.5;
        cx.beginPath();
        cx.roundRect(dx+2,dy+2,cellSz-4,cellSz-4,4);
        cx.stroke();
    }));
}

// ================================================================
//  DRAGGED PIECE
// ================================================================
function drawDragged(){
    if(!drag)return;
    drag.cells.forEach((row,r)=>row.forEach((v,c)=>{
        if(!v)return;
        const px=drag.px+c*cellSz;
        const py=drag.py+r*cellSz;

        cx.globalAlpha=0.82;
        cx.fillStyle=drag.color;
        cx.shadowColor=drag.color;
        cx.shadowBlur=10;
        cx.beginPath();
        cx.roundRect(px+2,py+2,cellSz-4,cellSz-4,4);
        cx.fill();
        cx.shadowBlur=0;
        cx.globalAlpha=1;

        cx.fillStyle="rgba(255,255,255,0.28)";
        cx.fillRect(px+4,py+3,cellSz-8,2);
    }));
}

// ================================================================
//  INPUT HANDLING
// ================================================================
function cvsCoords(clientX,clientY){
    const r=cvs.getBoundingClientRect();
    return{x:(clientX-r.left)/cScale,y:(clientY-r.top)/cScale};
}

function onStart(e){
    if(phase!=="normal"&&phase!=="boss")return;
    const el=e.target.closest(".slot");
    if(!el)return;
    const idx=parseInt(el.dataset.slot);
    if(isNaN(idx)||!slots[idx]||slots[idx].used)return;
    e.preventDefault();
    dragging=true;

    const t=e.touches?e.touches[0]:e;
    const co=cvsCoords(t.clientX,t.clientY);
    const s=slots[idx];
    const pw=s.cells[0].length*cellSz;
    const ph=s.cells.length*cellSz;

    drag={
        cells:s.cells,color:s.color,
        px:co.x-pw/2,py:co.y-ph/2-DRAG_UP,
        gx:-1,gy:-1,valid:false,slotIdx:idx
    };

    el.classList.add("dragging");
}

function onMove(e){
    if(!dragging||!drag)return;
    e.preventDefault();
    const t=e.touches?e.touches[0]:e;
    const co=cvsCoords(t.clientX,t.clientY);

    const pw=drag.cells[0].length*cellSz;
    const ph=drag.cells.length*cellSz;

    drag.px=co.x-pw/2;
    drag.py=co.y-ph/2-DRAG_UP;

    // snap to grid
    const centerX=drag.px+pw/2;
    const centerY=drag.py+ph/2;
    const gx=Math.round((centerX-gridOX-pw/2)/cellSz);
    const gy=Math.round((centerY-gridOY-ph/2)/cellSz);
    drag.gx=gx;
    drag.gy=gy;
    drag.valid=canPlace(drag.cells,gx,gy);
}

function onEnd(){
    if(!dragging||!drag)return;
    const els=$$(".slot");
    const idx=drag.slotIdx;

    if(drag.valid){
        placeOnGrid(drag.cells,drag.color,drag.gx,drag.gy);
        slots[idx].used=true;
        els[idx].classList.remove("dragging");
        els[idx].classList.add("used");

        clearLines();
        score+=10;
        updateScore();

        // ascension check
        if(score>=ASCEND_SCORE&&phase==="normal"){
            drag=null;
            dragging=false;
            ascend();
            return;
        }

        if(allUsed()){
            setTimeout(fillSlots,180);
        }else{
            setTimeout(()=>{
                if(!anyMove())triggerGameOver();
            },80);
        }
    }else{
        els[idx].classList.remove("dragging");
    }
    drag=null;
    dragging=false;
}

// ================================================================
//  MAIN GAME LOOP
// ================================================================
function loop(ts){
    requestAnimationFrame(loop);

    const dt=lastTs?Math.min(ts-lastTs,50):16;
    lastTs=ts;

    // === UPDATES ===

    // Main sword timer (both normal & boss)
    if(phase==="normal"||phase==="boss"){
        mainSwAcc+=dt;
        if(mainSwAcc>=MAIN_SWORD_CD){
            mainSwAcc=0;
            spawnMainSword();
        }
    }

    // Boss-specific timers
    if(phase==="boss"){
        divSwAcc+=dt;
        if(divSwAcc>=DIVINE_SWORD_CD){
            divSwAcc=0;
            spawnDivineSword();
        }

        bFlashAcc+=dt;
        if(bFlashAcc>=BOSS_FLASH_CD){
            bFlashAcc=0;
            doBossFlash();
        }

        bRevAcc+=dt;
        if(bRevAcc>=BOSS_REVENGE_CD){
            bRevAcc=0;
            bossBlock();
        }

        bBombAcc+=dt;
        if(bBombAcc>=BOSS_BOMB_CD){
            bBombAcc=0;
            spawnBombs();
        }

        updateBoss(dt);
        updateTimerUI();
    }

    updateMainSwords();
    updateDivineSwords();
    updateBombs(dt);
    updateParticles();

    const sk=getShake();

    // === DRAW ===
    if(phase==="boss"||phase==="ascending"||phase==="victory"){
        drawCosmos();
    }

    cx.clearRect(0,0,cvs.width,cvs.height);

    cx.save();
    cx.translate(sk.x,sk.y);

    // subtle background
    cx.fillStyle="rgba(5,8,17,0.2)";
    cx.fillRect(0,0,cvs.width,cvs.height);

    // draw boss
    drawBoss();

    // draw grid
    drawGrid();

    // draw ghost
    drawGhost();

    // draw dragged piece
    drawDragged();

    // draw projectiles
    drawMainSwords();
    drawDivineSwords();
    drawBombs();

    // draw particles
    drawParticles();

    cx.restore();
}

// ================================================================
//  GAME START / RESET
// ================================================================
function startGame(){
    score=0;
    bossHp=BOSS_BASE;
    bossWave=1;
    bossAlpha=0;
    bossX=0;bossY=0;
    bossTX=0;bossTY=0;
    bossMoveTimer=0;
    mainSwAcc=0;divSwAcc=0;bFlashAcc=0;bRevAcc=0;bBombAcc=0;
    phase="normal";
    blocked=[];
    mainSwords=[];divineSwords=[];bossBombs=[];
    impactFX=[];breakFX=[];lineFX=[];
    shakeA=0;shakeD=0;bossScreenFlash=0;
    drag=null;dragging=false;

    resetGrid();
    updateScore();
    hideBossHUD();
    sizeCanvas();
    fillSlots();

    // reset backgrounds
    const bg=$("#bg-layer");if(bg)bg.style.opacity="1";
    const cos=$("#cosmic-bg");if(cos){cos.classList.add("hidden");cos.classList.remove("visible");}
    const gc=$("#game-ui-container");if(gc)gc.classList.remove("float-away");
    const ao=$("#ascension-overlay");if(ao)ao.classList.remove("visible");
    const qm=$("#question-marks");if(qm){qm.classList.remove("visible");qm.innerHTML="";}
    const mf=$("#main-sword-fill");if(mf)mf.style.width="0%";
    const df=$("#divine-sword-fill");if(df)df.style.width="0%";
    const wf=$("#white-flash");if(wf)wf.className="white-flash";
    const rf=$("#red-flash");if(rf)rf.className="red-flash";
}

function toMenu(){
    $$(".screen").forEach(s=>s.classList.remove("active"));
    $("#main-menu").classList.add("active");
    const bg=$("#bg-layer");if(bg)bg.style.opacity="1";
    const cos=$("#cosmic-bg");if(cos){cos.classList.add("hidden");cos.classList.remove("visible");}
    hideBossHUD();
    const gc=$("#game-ui-container");if(gc)gc.classList.remove("float-away");
    const ao=$("#ascension-overlay");if(ao)ao.classList.remove("visible");
    const qm=$("#question-marks");if(qm){qm.classList.remove("visible");qm.innerHTML="";}
    const wf=$("#white-flash");if(wf)wf.className="white-flash";
    const rf=$("#red-flash");if(rf)rf.className="red-flash";
    phase="menu";
}

// ================================================================
//  EVENT BINDINGS
// ================================================================
let loopOn=false;

$("#start-btn").addEventListener("click",()=>{
    $("#main-menu").classList.remove("active");
    $("#game-screen").classList.add("active");
    startGame();
    if(!loopOn){loopOn=true;requestAnimationFrame(loop);}
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

// Touch
const hotbar=$("#hotbar");
hotbar.addEventListener("touchstart",onStart,{passive:false});
document.addEventListener("touchmove",onMove,{passive:false});
document.addEventListener("touchend",onEnd,{passive:false});
document.addEventListener("touchcancel",onEnd,{passive:false});

// Mouse
hotbar.addEventListener("mousedown",onStart);
document.addEventListener("mousemove",e=>{if(dragging)onMove(e);});
document.addEventListener("mouseup",onEnd);

// Resize
let rsT;
window.addEventListener("resize",()=>{
    clearTimeout(rsT);
    rsT=setTimeout(sizeCanvas,120);
});

// Prevent scroll/context
document.addEventListener("contextmenu",e=>e.preventDefault());
document.body.addEventListener("touchmove",e=>{
    if(dragging)e.preventDefault();
},{passive:false});

// ================================================================
//  BOOT
// ================================================================
loadAssets();
