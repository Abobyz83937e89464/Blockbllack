"use strict";

const GRID_SIZE = 8;
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));

// Цвета в стиле Neo Browser
const COLORS = {
    empty: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.1)',
    block: '#009dff', // Твой основной синий
    ghost: 'rgba(0, 157, 255, 0.2)'
};

// Базовые фигуры (Block Blast)
const SHAPES = [
    [[1, 1], [1, 1]], // Квадрат
    [[1, 1, 1, 1]],   // Линия
    [[1, 0], [1, 0], [1, 1]], // L-образная
    [[1, 1, 1], [0, 1, 0]]    // T-образная
];

// 1. Отрисовка сетки
function drawGrid() {
    const cellSize = canvas.width / GRID_SIZE;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            ctx.strokeStyle = COLORS.border;
            ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
            
            if (grid[y][x] !== 0) {
                ctx.fillStyle = COLORS.block;
                ctx.fillRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
            } else {
                ctx.fillStyle = COLORS.empty;
                ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
            }
        }
    }
}

// 2. Генерация фигурок в слоты
function spawnNewShapes() {
    const slots = document.querySelectorAll('.slot');
    slots.forEach(slot => {
        slot.innerHTML = ''; // Очищаем старую
        const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
        const miniCanvas = document.createElement('canvas');
        miniCanvas.width = 60;
        miniCanvas.height = 60;
        const mCtx = miniCanvas.getContext('2d');
        
        // Рисуем мини-превью в слоте
        const miniCell = 12;
        mCtx.fillStyle = COLORS.block;
        shape.forEach((row, y) => {
            row.forEach((val, x) => {
                if (val) mCtx.fillRect(x * miniCell + 10, y * miniCell + 10, miniCell - 2, miniCell - 2);
            });
        });
        slot.appendChild(miniCanvas);
        slot.dataset.shape = JSON.stringify(shape);
    });
}

// 3. Подгонка размеров
function setupCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    const size = Math.min(wrapper.clientWidth, wrapper.clientHeight) - 40;
    canvas.width = size;
    canvas.height = size;
    drawGrid();
}

// Старт игры
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    setTimeout(() => {
        setupCanvas();
        spawnNewShapes();
    }, 100);
});

// Умная загрузка (чтобы не висло)
async function init() {
    const preloader = document.getElementById('preloader');
    const bar = document.getElementById('progress-bar');
    
    // Имитация загрузки ресурсов
    for(let i=0; i<=100; i+=20) {
        bar.style.width = i + "%";
        await new Promise(r => setTimeout(r, 100));
    }
    
    preloader.style.opacity = "0";
    setTimeout(() => preloader.style.display = "none", 500);
}

window.addEventListener('resize', setupCanvas);
init();
