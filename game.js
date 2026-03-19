"use strict";

// Настройки и ассеты
const assets = {
    mainSword: 'main-sword.png',
    bossEntity: 'boss-entity.png',
    uiButton: 'ui-button.png',
    uiButtonActive: 'ui-button-active.png',
    divineSword: 'divine-sword.png'
};

const config = {
    gridSize: 10, // Поле 10x10
    targetScore: 1000, // Счет для перехода в финал
    swordInterval: 20000, // 20 секунд в обычной фазе
    finalInterval: 5000 // Хардкор: меч каждые 5 секунд в финале
};

let score = 0;
let isFinalPhase = false;
let currentSwordInterval = null;
let images;
let gameState = 'loading'; // loading, menu, playing, final

// Элементы DOM
const preloader = document.getElementById('preloader');
const mainMenu = document.getElementById('main-menu');
const gameScreen = document.getElementById('game-screen');
const finalScreen = document.getElementById('final-screen');
const scoreDisplay = document.getElementById('score-display');
const startBtn = document.getElementById('start-btn');
const whiteOverlay = document.querySelector('.white-overlay');

const gameCanvas = document.getElementById('game-canvas');
const vfxCanvas = document.getElementById('vfx-canvas');
const finalCanvas = document.getElementById('final-canvas');

const ctxGame = gameCanvas.getContext('2d');
const ctxVfx = vfxCanvas.getContext('2d');
const ctxFinal = finalCanvas.getContext('2d');

// --- Управление Разрешениями ---

function resizeCanvases() {
    const wrapper = document.getElementById('screen-wrapper');
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;

    gameCanvas.width = w;
    gameCanvas.height = h;
    vfxCanvas.width = w;
    vfxCanvas.height = h;
    finalCanvas.width = w;
    finalCanvas.height = h;

    if (window.grid) window.grid.resize(w, h);
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

// --- Классы и Логика ---

class Grid {
    constructor(cols, rows, width, height) {
        this.cols = cols;
        this.rows = rows;
        this.resize(width, height);
        this.grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    }

    resize(w, h) {
        this.cellW = w / this.cols;
        this.cellH = h / this.rows;
    }

    draw(ctx) {
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                ctx.strokeRect(c * this.cellW, r * this.cellH, this.cellW, this.cellH);
                if (this.grid[r][c] === 1) {
                    // Базовый блок - темный с красным неоном
                    ctx.fillStyle = '#ff0055';
                    ctx.fillRect(c * this.cellW, r * this.cellH, this.cellW, this.cellH);
                }
            }
        }
    }

    // Добавление блока на поле (реализация для теста, так как блокбласт)
    place(col, row) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            this.grid[row][col] = 1;
        }
    }

    // Удаление линии
    clearLine(row) {
        this.grid.splice(row, 1);
        this.grid.unshift(Array(this.cols).fill(0));
        score += 100;
        scoreDisplay.innerText = `СЧЕТ: ${score}`;
    }

    // Проверка полных линий
    checkLines() {
        for (let r = 0; r < this.rows; r++) {
            if (this.grid[r].every(cell => cell === 1)) {
                this.clearLine(r);
            }
        }
    }

    // Сброс поля
    reset() {
        this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }
}

class VFXEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    // Вспышка на экране
    flash() {
        whiteOverlay.classList.add('white-flash');
        setTimeout(() => whiteOverlay.classList.remove('white-flash'), 500);
    }

    // Тряска экрана
    shake() {
        gameScreen.classList.add('screen-shake');
        setTimeout(() => gameScreen.classList.remove('screen-shake'), 500);
    }
}

// --- Управление Состояниями Игры ---

function startGame() {
    gameScreen.classList.add('active');
    gameScreen.style.animation = 'fadeIn 0.5s forwards';
    gameState = 'playing';
    vfx.flash();
    vfx.shake();
    
    // Добавим несколько блоков для теста
    for (let i = 0; i < 5; i++) grid.place(i, 5);

    initHardcoreTimer();
}

function initHardcoreTimer() {
    if (currentSwordInterval) clearInterval(currentSwordInterval);
    
    const interval = isFinalPhase ? config.finalInterval : config.swordInterval;
    
    currentSwordInterval = setInterval(() => {
        triggerSwordSlash();
    }, interval);
}

function triggerSwordSlash() {
    vfx.shake();
    vfx.flash();
    
    const sword = images.mainSword;
    const w = gameCanvas.width;
    const h = gameCanvas.height;
    const ctx = ctxVfx;

    // Анимация меча на VFX Canvas
    let x = w;
    let y = 0;
    const speed = w / 15; // Меч летит очень быстро

    const animation = setInterval(() => {
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4); // По диагонали
        // Немного уменьшим меч, чтобы он влез
        const scale = w / 2 / sword.width;
        ctx.drawImage(sword, -sword.width * scale / 2, -sword.height * scale / 2, sword.width * scale, sword.height * scale);
        ctx.restore();

        x -= speed;
        y += speed;

        if (x < -w / 2 || y > h + h / 2) {
            clearInterval(animation);
            grid.reset(); // ХАРДКОР: Сброс поля при ударе меча
            vfx.flash();
        }
    }, 1000 / 60); // 60fps
}

// --- Финальная Фаза ---

function checkProgress() {
    if (score >= config.targetScore && !isFinalPhase) {
        startFinalPhase();
    }
}

function startFinalPhase() {
    isFinalPhase = true;
    gameState = 'final';
    clearInterval(currentSwordInterval);
    
    finalScreen.classList.add('active');
    finalScreen.style.animation = 'fadeIn 2s forwards';
    // Игровое поле плавно исчезает
    gameCanvas.style.animation = 'fadeOut 1s forwards'; 

    const boss = images.bossEntity;
    const w = finalCanvas.width;
    const h = finalCanvas.height;
    const ctx = ctxFinal;

    // --- Анимация Финальной Сцены ---
    let humanY = h;
    let bossY = h / 2;
    const humanSpeed = 1.5;

    const finalAnimation = setInterval(() => {
        ctx.clearRect(0, 0, w, h);
        
        // --- 1. Лестница (белые полосы) ---
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 10;
        for (let i = 0; i < 20; i++) {
            ctx.beginPath();
            ctx.moveTo(w / 4, h - i * 40 - (humanY % 40));
            ctx.lineTo(w * 0.75, h - i * 40 - (humanY % 40));
            ctx.stroke();
        }

        // --- 2. Босс (Безымянное Божество) ---
        ctx.save();
        ctx.translate(w / 2, bossY);
        // Покачивание босса
        const bossOffset = Math.sin(Date.now() / 500) * 10;
        const bossScale = w / 2 / boss.width;
        ctx.drawImage(boss, -boss.width * bossScale / 2, -boss.height * bossScale / 2 + bossOffset, boss.width * bossScale, boss.height * bossScale);
        ctx.restore();

        // --- 3. Человечек (силуэт) ---
        // Делаем простую анимацию ходьбы через покачивание
        ctx.fillStyle = '#000';
        const humanSize = 20;
        const humanX = w / 2 - humanSize / 2;
        const stepOffset = Math.abs(Math.sin(humanY / 10)) * 5;
        ctx.fillRect(humanX, humanY - stepOffset, humanSize, humanSize);

        humanY -= humanSpeed;

        // Порог: Босс начинает атаковать (включаем хардкор таймер)
        if (humanY < h / 2 && currentSwordInterval === null) {
            initHardcoreTimer();
            vfx.flash();
        }

        // Конец сцены: Финальное затемнение
        if (humanY < h / 4) {
            clearInterval(finalAnimation);
            whiteOverlay.style.opacity = 1;
            // Конец игры (Game over или Победа)
        }

    }, 1000 / 60); // 60fps
}

// --- Основная Инициализация ---

loadImages(assets, (loadedImages) => {
    images = loadedImages;
    gameState = 'menu';
    
    // Убираем прелоадер
    preloader.classList.remove('active');
    
    // Показываем меню с заставкой
    mainMenu.classList.add('active');
    mainMenu.style.animation = 'fadeIn 1s forwards';
    
    // Инициализируем объекты после загрузки
    const w = gameCanvas.width;
    const h = gameCanvas.height;
    window.grid = new Grid(config.gridSize, config.gridSize, w, h);
    window.vfx = new VFXEngine(vfxCanvas);

    // Обработчик кнопки старт
    startBtn.addEventListener('click', () => {
        mainMenu.style.animation = 'fadeOut 0.5s forwards';
        setTimeout(() => {
            mainMenu.classList.remove('active');
            startGame();
        }, 500);
    });

    // --- Основной Игровой Цикл ---
    function gameLoop() {
        if (gameState === 'playing') {
            ctxGame.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
            grid.draw(ctxGame);
            grid.checkLines();
            checkProgress();
        }
        
        requestAnimationFrame(gameLoop);
    }
    
    gameLoop();
});
