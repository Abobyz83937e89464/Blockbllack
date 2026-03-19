"use strict";

// --- НАСТРОЙКИ ---
const GRID_SIZE = 8;
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
let score = 0;
let bossHp = 1000;
let maxBossHp = 1000;

// --- КАРТИНКИ (Из твоих загрузок) ---
const ASSETS = {
    boss: '1000337814.png',
    swordLight: '1000337800.png',
    swordDark: '1000337798.png'
};
const images = {};

// --- ЦВЕТА ---
const COLORS = {
    empty: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.1)',
    block: '#ff0055', // Под цвет твоего интерфейса
    ghost: 'rgba(255, 0, 85, 0.3)'
};

// --- ФИГУРЫ ---
const SHAPES = [
    [[1, 1], [1, 1]], // Квадрат
    [[1, 1, 1, 1]],   // Линия горизонт
    [[1], [1], [1], [1]], // Линия вертикаль
    [[1, 0], [1, 0], [1, 1]], // L-образная
    [[1, 1, 1], [0, 1, 0]]    // T-образная
];

let cellSize = 0;
let gridOffsetX = 0;
let gridOffsetY = 0;
let animations = []; // Для летящих мечей
let activeFigure = null;

// --- ЗАГРУЗКА КАРТИНОК ---
async function initSystem() {
    const bar = document.getElementById('progress-bar');
    const preloader = document.getElementById('preloader');
    
    const keys = Object.keys(ASSETS);
    let loaded = 0;

    const promises = keys.map(key => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = ASSETS[key];
            img.onload = () => {
                images[key] = img;
                loaded++;
                if(bar) bar.style.width = (loaded / keys.length) * 100 + "%";
                resolve();
            };
            img.onerror = () => {
                console.warn("Картинка не найдена:", ASSETS[key]);
                resolve(); // Игра запустится даже если картинки нет
            };
        });
    });

    await Promise.race([
        Promise.all(promises),
        new Promise(r => setTimeout(r, 3000)) // Ждем максимум 3 сек
    ]);

    if(preloader) {
        preloader.style.opacity = "0";
        setTimeout(() => preloader.style.display = "none", 500);
    }
}

// --- ГЕОМЕТРИЯ СЕТКИ ---
function setupCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    const hudOffset = 180; // Место для босса сверху
    const size = Math.min(wrapper.clientWidth, wrapper.clientHeight - hudOffset);
    
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
    
    cellSize = Math.floor((size - 20) / GRID_SIZE);
    gridOffsetX = (canvas.width - (cellSize * GRID_SIZE)) / 2;
    gridOffsetY = hudOffset;
}

// --- ОТРИСОВКА ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Босс и ХП
    if (images.boss) {
        const bossWidth = 200;
        const bossHeight = 130;
        ctx.drawImage(images.boss, (canvas.width - bossWidth) / 2, 10, bossWidth, bossHeight);
    }
    
    const hpBarWidth = 250;
    const hpBarHeight = 12;
    const hpX = (canvas.width - hpBarWidth) / 2;
    const hpY = 150;
    ctx.fillStyle = '#330000';
    ctx.fillRect(hpX, hpY, hpBarWidth, hpBarHeight);
    ctx.fillStyle = '#ff0055';
    ctx.fillRect(hpX, hpY, hpBarWidth * (bossHp / maxBossHp), hpBarHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(hpX, hpY, hpBarWidth, hpBarHeight);

    // 2. Сетка
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const drawX = gridOffsetX + x * cellSize;
            const drawY = gridOffsetY + y * cellSize;
            
            ctx.strokeStyle = COLORS.border;
            ctx.strokeRect(drawX, drawY, cellSize, cellSize);
            
            if (grid[y][x] !== 0) {
                ctx.fillStyle = COLORS.block;
                ctx.fillRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4);
            } else {
                ctx.fillStyle = COLORS.empty;
                ctx.fillRect(drawX + 1, drawY + 1, cellSize - 2, cellSize - 2);
            }
        }
    }

    // 3. Активная фигура в руке
    if (activeFigure && activeFigure.shape) {
        ctx.fillStyle = COLORS.block;
        activeFigure.shape.forEach((row, y) => {
            row.forEach((val, x) => {
                if (val) {
                    ctx.fillRect(
                        activeFigure.x + x * cellSize, 
                        activeFigure.y + y * cellSize, 
                        cellSize - 2, cellSize - 2
                    );
                }
            });
        });
    }

    // 4. Анимации ударов мечом
    animations.forEach((anim, index) => {
        anim.y -= 15; // Скорость полета меча вверх
        if (images.swordLight) {
            ctx.drawImage(images.swordLight, anim.x, anim.y, 60, 120);
        }
        if (anim.y < 50) {
            animations.splice(index, 1);
        }
    });

    requestAnimationFrame(draw);
}

// --- ЛОГИКА ---
function spawnNewShapes() {
    const slots = document.querySelectorAll('.slot');
    slots.forEach((slot, index) => {
        slot.innerHTML = '';
        slot.style.opacity = '1';
        const shapeIndex = Math.floor(Math.random() * SHAPES.length);
        const shape = SHAPES[shapeIndex];
        
        const miniCanvas = document.createElement('canvas');
        miniCanvas.width = 60;
        miniCanvas.height = 60;
        const mCtx = miniCanvas.getContext('2d');
        
        const miniCell = 15;
        mCtx.fillStyle = COLORS.block;
        shape.forEach((row, y) => {
            row.forEach((val, x) => {
                if (val) mCtx.fillRect(x * miniCell + 5, y * miniCell + 5, miniCell - 2, miniCell - 2);
            });
        });
        slot.appendChild(miniCanvas);
        slot.dataset.shape = JSON.stringify(shape);
    });
}

function checkLines() {
    let linesCleared = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
        if (grid[y].every(cell => cell !== 0)) {
            grid[y].fill(0);
            linesCleared++;
        }
    }

    for (let x = 0; x < GRID_SIZE; x++) {
        let colFull = true;
        for (let y = 0; y < GRID_SIZE; y++) {
            if (grid[y][x] === 0) { colFull = false; break; }
        }
        if (colFull) {
            for (let y = 0; y < GRID_SIZE; y++) grid[y][x] = 0;
            linesCleared++;
        }
    }

    if (linesCleared > 0) {
        score += linesCleared * 100;
        document.getElementById('score').innerText = score.toString().padStart(4, '0');
        
        // Урон по боссу
        const damage = linesCleared * 100;
        bossHp -= damage;
        if (bossHp < 0) bossHp = 0;
        
        // Спавн меча
        animations.push({
            x: canvas.width / 2 - 30,
            y: gridOffsetY + (GRID_SIZE * cellSize) / 2
        });

        if (bossHp === 0) {
            setTimeout(() => {
                alert("БОСС ПОВЕРЖЕН! ВОЛНА 2");
                bossHp = 1500;
                maxBossHp = 1500;
            }, 300);
        }
    }
}

function canPlace(shape, gridX, gridY) {
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x]) {
                if (gridY + y < 0 || gridY + y >= GRID_SIZE || gridX + x < 0 || gridX + x >= GRID_SIZE) return false;
                if (grid[gridY + y][gridX + x] !== 0) return false;
            }
        }
    }
    return true;
}

function placeShape(shape, gridX, gridY) {
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x]) grid[gridY + y][gridX + x] = 1;
        }
    }
    checkLines();
    
    let allEmpty = true;
    document.querySelectorAll('.slot').forEach(slot => {
        if (slot.style.opacity !== '0.2') allEmpty = false;
    });
    if (allEmpty) spawnNewShapes();
}

// --- УПРАВЛЕНИЕ ТАПАМИ И МЫШКОЙ ---
function startDrag(e) {
    const slot = e.target.closest('.slot');
    if (!slot || slot.style.opacity === '0.2' || !slot.dataset.shape) return;
    
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const rect = canvas.getBoundingClientRect();
    
    activeFigure = {
        shape: JSON.parse(slot.dataset.shape),
        x: touch.clientX - rect.left - cellSize,
        y: touch.clientY - rect.top - cellSize,
        slotElem: slot
    };
    slot.style.opacity = '0.2';
}

function moveDrag(e) {
    if (!activeFigure) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const rect = canvas.getBoundingClientRect();
    
    activeFigure.x = touch.clientX - rect.left - cellSize;
    // Поднимаем фигуру чуть выше пальца, чтобы было видно куда ставить
    activeFigure.y = touch.clientY - rect.top - cellSize * 2; 
}

function endDrag() {
    if (!activeFigure) return;
    
    const gridX = Math.round((activeFigure.x - gridOffsetX) / cellSize);
    const gridY = Math.round((activeFigure.y - gridOffsetY) / cellSize);

    if (canPlace(activeFigure.shape, gridX, gridY)) {
        placeShape(activeFigure.shape, gridX, gridY);
    } else {
        activeFigure.slotElem.style.opacity = '1'; // Возвращаем в слот
    }
    activeFigure = null;
}

// Бинды для телефона
document.getElementById('hotbar').addEventListener('touchstart', startDrag, { passive: false });
document.addEventListener('touchmove', moveDrag, { passive: false });
document.addEventListener('touchend', endDrag);

// Бинды для ПК (чтобы тестировать)
document.getElementById('hotbar').addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', moveDrag);
document.addEventListener('mouseup', endDrag);

// --- СТАРТ ИГРЫ ---
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    setTimeout(() => {
        setupCanvas();
        spawnNewShapes();
        requestAnimationFrame(draw);
    }, 100);
});

window.addEventListener('resize', setupCanvas);
initSystem();
