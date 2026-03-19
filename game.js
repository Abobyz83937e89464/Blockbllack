"use strict";

// Настройки и ассеты (используем имена из твоей таблицы)
const ASSETS_PATHS = {
    mainSword: 'main-sword.png',
    bossEntity: 'boss-entity.png',
    uiButton: 'ui-button.png',
    uiButtonActive: 'ui-button-active.png',
    divineSword: 'divine-sword.png'
};

const CONFIG = {
    gridSize: 10, // Поле 10x10
    targetScore: 2500, // Счет для перехода в финал
    calamityTimeout: 20, // 20 секунд в обычной фазе
    figureCellSize: 20 // Размер клетки для фигурки в хотбаре
};

// Стили блоков (процедурные, как мы и договаривались)
const BLOCK_STYLES = {
    cellBase: '#150015',
    cellActive: '#ff0055', // Базовый цвет для хардкора
    figureBase: '#4a004a', // Цвет фигурок в хотбаре
};

let gameData = {
    gameState: 'LOADING', // LOADING, MENU, PLAYING, FINAL, GAME_OVER
    score: 0,
    calamityTime: CONFIG.calamityTimeout,
    currentFigures: [null, null, null],
    selectedFigureIdx: null,
    draggedFigure: null,
    images: {}
};

// Определим базовые фигуры Блок Бласта (координаты клеток)
const FIGURES_DB = [
    [[0,0],[0,1]], // I-2
    [[0,0],[0,1],[0,2]], // I-3
    [[0,0],[1,0],[0,1],[1,1]], // O-2x2
    [[0,0],[1,0],[2,0],[1,1]], // T-3
    [[0,0],[1,0],[0,1]], // J-2
    [[0,0],[0,1],[1,1],[2,1]], // L-3
    [[0,0],[0,1],[0,2],[0,3],[0,4]], // I-5 (Самая бесячая)
];

// Элементы DOM
const els = {
    wrapper: document.getElementById('screen-wrapper'),
    preloader: document.getElementById('preloader'),
    mainMenu: document.getElementById('main-menu'),
    gameScreen: document.getElementById('game-screen'),
    finalScreen: document.getElementById('final-screen'),
    startBtn: document.getElementById('start-btn'),
    score: document.getElementById('score-display'),
    timerFill: document.getElementById('timer-fill'),
    timerText: document.getElementById('time-left'),
    canvas: document.getElementById('game-canvas'),
    vfxCanvas: document.getElementById('vfx-canvas'),
    finalCanvas: document.getElementById('final-canvas'),
    hotbar: document.getElementById('hotbar'),
    slots: document.querySelectorAll('.figure-slot'),
};

const ctxs = {
    game: els.canvas.getContext('2d'),
    vfx: els.vfxCanvas.getContext('2d'),
    final: els.finalCanvas.getContext('2d'),
};

// --- Ресайз Канвасов ---
function resizeCanvases() {
    const w = els.wrapper.clientWidth;
    els.canvas.width = w;
    els.canvas.height = w; // Поле квадратное
    els.vfxCanvas.width = els.wrapper.clientWidth;
    els.vfxCanvas.height = els.wrapper.clientHeight;
    els.finalCanvas.width = els.wrapper.clientWidth;
    els.finalCanvas.height = els.wrapper.clientHeight;
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// --- Загрузчик Ассетов ---
function loadImages(assets, callback) {
    let loaded = 0;
    const images = {};
    const total = Object.keys(assets).length;

    for (let key in assets) {
        const img = new Image();
        img.onload = () => {
            loaded++;
            if (loaded === total) callback(images);
        };
        img.src = assets[key];
        images[key] = img;
    }
}

// --- Класс Геймплея ---
class GameGrid {
    constructor() {
        this.reset();
    }

    reset() {
        this.grid = Array.from({ length: CONFIG.gridSize }, () => Array(CONFIG.gridSize).fill(0));
    }

    draw(ctx) {
        const cellSize = ctx.canvas.width / CONFIG.gridSize;
        ctx.lineWidth = 1;

        for (let r = 0; r < CONFIG.gridSize; r++) {
            for (let c = 0; c < CONFIG.gridSize; c++) {
                ctx.strokeStyle = '#222';
                ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);

                if (this.grid[r][c] === 1) {
                    ctx.fillStyle = BLOCK_STYLES.cellActive;
                    ctx.fillRect(c * cellSize + 2, r * cellSize + 2, cellSize - 4, cellSize - 4);
                }
            }
        }
    }

    canPlace(figure, startR, startC) {
        if (startR < 0 || startC < 0 || startR + this.getFigureHeight(figure) > CONFIG.gridSize || startC + this.getFigureWidth(figure) > CONFIG.gridSize) return false;

        for (let block of figure) {
            if (this.grid[startR + block[1]][startC + block[0]] === 1) return false;
        }
        return true;
    }

    place(figure, startR, startC) {
        for (let block of figure) {
            this.grid[startR + block[1]][startC + block[0]] = 1;
        }
    }

    getFigureWidth(figure) {
        return Math.max(...figure.map(b => b[0])) + 1;
    }
    getFigureHeight(figure) {
        return Math.max(...figure.map(b => b[1])) + 1;
    }

    checkLines() {
        let linesToClearR = [];
        let linesToClearC = [];

        // Проверка Рядов
        for (let r = 0; r < CONFIG.gridSize; r++) {
            if (this.grid[r].every(cell => cell === 1)) linesToClearR.push(r);
        }
        // Проверка Столбцов
        for (let c = 0; c < CONFIG.gridSize; c++) {
            if (this.grid.every(r => r[c] === 1)) linesToClearC.push(c);
        }

        // Очистка и Очки
        let combo = linesToClearR.length + linesToClearC.length;
        linesToClearR.forEach(r => this.grid[r].fill(0));
        linesToClearC.forEach(c => {
            for (let r = 0; r < CONFIG.gridSize; r++) this.grid[r][c] = 0;
        });

        if (combo > 0) {
            gameData.score += combo * 100 * combo;
            els.score.innerText = `СЧЕТ: ${gameData.score}`;
            vfx.flash();
            if (gameData.gameState === 'PLAYING') checkFinalProgress();
        }
    }
}

// --- Класс Фигурок и Тач-управления ---
class FigureManager {
    constructor() {
        this.slots = [null, null, null];
        els.hotbar.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        els.hotbar.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        els.hotbar.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    generate() {
        gameData.currentFigures = this.slots.map(() => {
            return FIGURES_DB[Math.floor(Math.random() * FIGURES_DB.length)];
        });
        this.slots = [...gameData.currentFigures];
        this.drawSlots();
    }

    drawSlots() {
        els.slots.forEach((slot, i) => {
            slot.innerHTML = ''; // Очистка
            if (this.slots[i] === null) return;
            
            const canvas = document.createElement('canvas');
            canvas.width = slot.clientWidth;
            canvas.height = slot.clientHeight;
            slot.appendChild(canvas);
            this.drawFigureToSlot(canvas.getContext('2d'), this.slots[i]);
        });
    }

    drawFigureToSlot(ctx, figure) {
        ctx.fillStyle = BLOCK_STYLES.figureBase;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#6a006a';
        const cs = CONFIG.figureCellSize;

        // Центрирование
        const w = Math.max(...figure.map(b => b[0])) + 1;
        const h = Math.max(...figure.map(b => b[1])) + 1;
        const offset = { x: (100 - w * cs)/2, y: (100 - h * cs)/2 };

        for (let b of figure) {
            ctx.fillRect(offset.x + b[0] * cs, offset.y + b[1] * cs, cs - 1, cs - 1);
            ctx.strokeRect(offset.x + b[0] * cs, offset.y + b[1] * cs, cs - 1, cs - 1);
        }
    }

    handleTouchStart(e) {
        if (gameData.gameState !== 'PLAYING') return;
        const touch = e.touches[0];
        const slot = e.target.closest('.figure-slot');
        if (!slot || slot.innerHTML === '') return;

        const idx = slot.getAttribute('data-slot');
        gameData.selectedFigureIdx = idx;
        gameData.draggedFigure = FIGURES_DB.find(f => JSON.stringify(f) === JSON.stringify(this.slots[idx]));
    }

    handleTouchMove(e) {
        if (gameData.gameState !== 'PLAYING' || !gameData.draggedFigure) return;
        // Мы не двигаем фигурку в DOM (это сложно и глючно на мобилах), мы просто "знаем", где тач
    }

    handleTouchEnd(e) {
        if (gameData.gameState !== 'PLAYING' || !gameData.draggedFigure) return;
        const touch = e.changedTouches[0];
        const gridPos = els.canvas.getBoundingClientRect();

        // Проверка, опустили ли над полем
        if (touch.clientX >= gridPos.left && touch.clientX <= gridPos.right && touch.clientY >= gridPos.top && touch.clientY <= gridPos.bottom) {
            
            const cellSize = els.canvas.width / CONFIG.gridSize;
            const c = Math.floor((touch.clientX - gridPos.left) / cellSize);
            const r = Math.floor((touch.clientY - gridPos.top) / cellSize);

            // Пытаемся поставить
            if (grid.canPlace(gameData.draggedFigure, r, c)) {
                grid.place(gameData.draggedFigure, r, c);
                vfx.flash();
                
                // Удаляем из хотбара
                this.slots[gameData.selectedFigureIdx] = null;
                this.drawSlots();
                if (this.slots.every(s => s === null)) this.generate();

                grid.checkLines();
            }
        }

        // Сброс выбора
        gameData.selectedFigureIdx = null;
        gameData.draggedFigure = null;
    }
}

// --- Класс Спецэффектов (VFX) ---
class VFXEngine {
    constructor() {
        this.ctx = ctxs.vfx;
    }

    flash() {
        els.wrapper.classList.add('white-flash-css');
        setTimeout(() => els.wrapper.classList.remove('white-flash-css'), 200);
    }

    shake() {
        els.wrapper.classList.add('screen-shake-css');
        setTimeout(() => els.wrapper.classList.remove('screen-shake-css'), 500);
    }
}

// --- Управление Основными Таймерами и Катаклизмом ---
let calamityInterval = null;

function initHardcoreTimers() {
    clearInterval(calamityInterval);
    gameData.calamityTime = CONFIG.calamityTimeout;
    updateHUD();

    calamityInterval = setInterval(() => {
        gameData.calamityTime -= 0.1;
        updateHUD();

        if (gameData.calamityTime <= 0) {
            triggerCalamitySword();
            gameData.calamityTime = CONFIG.calamityTimeout;
        }
    }, 100);
}

function updateHUD() {
    els.timerFill.style.width = (gameData.calamityTime / CONFIG.calamityTimeout) * 100 + '%';
    els.timerText.innerText = Math.max(0, gameData.calamityTime).toFixed(1) + 's';
}

function triggerCalamitySword() {
    vfx.shake();
    vfx.flash();

    const sword = gameData.images.mainSword;
    const cw = els.vfxCanvas.width;
    const ch = els.vfxCanvas.height;
    const ctx = ctxs.vfx;

    // Анимация диагонального меча (image_0.png)
    let startX = cw + 200;
    let startY = -ch / 2;
    const speed = ch / 10; // Быстрый срез

    const swordAnimation = setInterval(() => {
        ctx.clearRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(startX, startY);
        ctx.rotate(Math.PI / 4); // По диагонали

        const scale = ch / 2 / sword.width;
        ctx.drawImage(sword, -sword.width * scale / 2, -sword.height * scale / 2, sword.width * scale, sword.height * scale);
        ctx.restore();

        startX -= speed;
        startY += speed;

        if (startY > ch) {
            clearInterval(swordAnimation);
            grid.reset(); // ХАРДКОР: Очистка поля при ударе меча
            vfx.flash();
        }
    }, 1000 / 60); // 60fps
}

// --- Финальная Фаза ---
let finalLoop = null;

function checkFinalProgress() {
    if (gameData.score >= CONFIG.targetScore && gameData.gameState === 'PLAYING') {
        startFinalPhase();
    }
}

function startFinalPhase() {
    gameData.gameState = 'FINAL';
    clearInterval(calamityInterval);
    els.gameScreen.style.animation = 'fadeOut 1.5s forwards';
    els.finalScreen.classList.add('active');
    vfx.flash();

    const boss = gameData.images.bossEntity;
    const cw = els.finalCanvas.width;
    const ch = els.finalCanvas.height;
    const ctx = ctxs.final;

    // Стейт финальной сцены
    let stairsOffset = 0;
    let character = { r: CONFIG.gridSize - 1, c: 0 }; // Стартовая позиция в координатах сетки

    // --- Основной луп финальной сцены ---
    finalLoop = setInterval(() => {
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cw,ch); // Белый фон

        // --- 1. Лестница (Белый Limbo) ---
        // Генерируем бесконечно уходящие белые параллелограммы
        ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1;
        for (let i = 0; i < 20; i++) {
            const h = 40;
            ctx.beginPath();
            ctx.moveTo(0, stairsOffset + i * h);
            ctx.lineTo(cw, stairsOffset + (i+1) * h);
            ctx.stroke();
        }
        stairsOffset = (stairsOffset + 1) % 40;

        // --- 2. Босс (Безымянное Божество) ---
        // Парит на заднем фоне (slow wave movement)
        const bossY = ch / 2 + Math.sin(Date.now() / 1000) * 15;
        ctx.save();
        ctx.translate(cw / 2, bossY);
        const bossScale = cw / boss.width;
        ctx.drawImage(boss, -boss.width * bossScale / 2, -boss.height * bossScale / 2, boss.width * bossScale, boss.height * bossScale);
        ctx.restore();

        // --- 3. Игровое поле и Человечек ---
        // Мы рендерим сетку 10x10 как платформы
        const cellSizeFinal = cw / CONFIG.gridSize;
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        for (let r = 0; r < CONFIG.gridSize; r++) {
            for (let c = 0; c < CONFIG.gridSize; c++) {
                if (grid.grid[r][c] === 1) {
                    ctx.fillStyle = BLOCK_STYLES.cellActive;
                    ctx.fillRect(c * cellSizeFinal, r * cellSizeFinal, cellSizeFinal - 1, cellSizeFinal - 1);
                }
            }
        }
        // Человечек (плоский черный силуэт Limbo)
        ctx.fillStyle = '#000';
        ctx.fillRect(character.c * cellSizeFinal + cellSizeFinal / 4, character.r * cellSizeFinal - cellSizeFinal / 2, cellSizeFinal / 2, cellSizeFinal / 2);

        // --- 4. Буллет-Хелл (Мечи по горизонтали) ---
        const divineSword = gameData.images.divineSword;
        if (Date.now() % 50 === 0) { // Вспышка и вылет мечей
            vfx.flash();
            // Генерируем 3 горизонтальных следа от мечей (как в image_4.png)
            ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3;
            for(let j=0; j<3; j++) {
                let sy = Math.random() * ch;
                ctx.beginPath();
                ctx.moveTo(0, sy); ctx.lineTo(cw, sy);
                ctx.stroke();
            }
        }

        // --- Управление Финалом (Человечек поднимается) ---
        if (Date.now() % 2000 === 0) { // Каждые 2 сек делаем шаг
            character.r--; character.c++;
            if (character.r < 0 || character.c >= CONFIG.gridSize) {
                // Победил / Дошел до конца
                clearInterval(finalLoop);
                gameData.gameState = 'GAME_OVER';
                els.wrapper.style.backgroundColor = '#fff';
            }
        }

    }, 1000 / 60); // 60fps
}

// --- Управление Состояниями и Старт Игры ---
const grid = new GameGrid();
const figures = new FigureManager();
const vfx = new VFXEngine();

function startGame() {
    gameData.score = 0;
    els.score.innerText = `СЧЕТ: 0`;
    els.startBtn.parentNode.style.animation = 'fadeOut 0.5s forwards';
    setTimeout(() => {
        gameData.gameState = 'PLAYING';
        els.mainMenu.classList.remove('active');
        els.gameScreen.classList.add('active');
        vfx.flash();
        
        grid.reset();
        figures.generate();
        initHardcoreTimers();
    }, 500);
}

// --- Основной Инициализатор ---
loadImages(ASSETS_PATHS, (loadedImages) => {
    gameData.images = loadedImages;
    gameData.gameState = 'MENU';
    
    els.preloader.classList.remove('active');
    els.mainMenu.classList.add('active');
    
    els.startBtn.addEventListener('click', startGame);

    // Основной цикл отрисовки игры
    function gameLoop() {
        if (gameData.gameState === 'PLAYING' || gameData.gameState === 'GAME_OVER') {
            ctxs.game.clearRect(0, 0, els.canvas.width, els.canvas.height);
            grid.draw(ctxs.game);
        }
        requestAnimationFrame(gameLoop);
    }
    gameLoop();
});
