"use strict";

const ASSETS_LIST = [
    { name: 'sword', url: 'main-sword.png' },
    { name: 'boss', url: 'boss-entity.png' }
];

let assets = {};
let score = 0;

// УМНАЯ ЗАГРУЗКА
async function initSystem() {
    const bar = document.getElementById('progress-bar');
    const preloader = document.getElementById('preloader');
    
    // Создаем промисы для каждой картинки
    const promises = ASSETS_LIST.map((item, index) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = item.url;
            img.onload = () => {
                assets[item.name] = img;
                bar.style.width = ((index + 1) / ASSETS_LIST.length) * 100 + "%";
                resolve();
            };
            img.onerror = () => {
                console.warn("Skip missing asset:", item.name);
                resolve(); // Пропускаем, если картинки нет
            };
        });
    });

    // Ждем либо загрузки, либо таймаута в 3 секунды
    await Promise.race([
        Promise.all(promises),
        new Promise(r => setTimeout(r, 3000)) 
    ]);

    preloader.style.opacity = "0";
    setTimeout(() => preloader.style.display = "none", 500);
}

// УПРАВЛЕНИЕ РАЗМЕРАМИ
function setupCanvas() {
    const canvas = document.getElementById('game-canvas');
    const wrapper = document.getElementById('canvas-wrapper');
    const size = Math.min(wrapper.clientWidth, wrapper.clientHeight);
    canvas.width = size;
    canvas.height = size;
}

// ОБРАБОТКА ТАЧА (Перетаскивание)
let activeFigure = null;
const canvas = document.getElementById('game-canvas');

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    // Здесь будет логика захвата фигурки
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    // Логика движения
}, { passive: false });

// СТАРТ
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    setupCanvas();
});

window.addEventListener('resize', setupCanvas);
initSystem();
