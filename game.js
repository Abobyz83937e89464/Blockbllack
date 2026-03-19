"use strict";

const ASSETS = {
    sword: 'main-sword.png',
    boss: 'boss-entity.png'
};

let images = {};
let gameActive = false;

// 1. ЗАГРУЗКА (Не пускаем в игру, пока не готово)
function loadGame() {
    let loaded = 0;
    const total = Object.keys(ASSETS).length;

    for (let key in ASSETS) {
        const img = new Image();
        img.src = ASSETS[key];
        img.onload = () => {
            loaded++;
            images[key] = img;
            if (loaded === total) {
                // Все загружено -> Убираем лоадер
                document.getElementById('preloader').classList.add('hidden');
                document.getElementById('main-menu').classList.add('active');
            }
        };
        img.onerror = () => {
            console.error("Ошибка загрузки: " + ASSETS[key]);
            // Если файла нет, всё равно пускаем через 3 сек (защита от вечного LOAD)
            setTimeout(() => {
                document.getElementById('preloader').classList.add('hidden');
                document.getElementById('main-menu').classList.add('active');
            }, 3000);
        };
    }
}

// 2. РАЗМЕРЫ (Авто-подбор под экран)
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

function resize() {
    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.5);
    canvas.width = size;
    canvas.height = size;
}
window.addEventListener('resize', resize);
resize();

// 3. СТАРТ
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    gameActive = true;
    initGame();
});

// 4. ТАЧ (Перетаскивание)
let isDragging = false;
let currentFigure = null;

canvas.addEventListener('touchstart', (e) => {
    if (!gameActive) return;
    const touch = e.touches[0];
    isDragging = true;
    // Логика выбора фигуры...
});

canvas.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault(); // Чтобы страница не скроллилась при игре
});

canvas.addEventListener('touchend', () => {
    isDragging = false;
});

function initGame() {
    console.log("Игра запущена, ассеты:", images);
    // Тут твой цикл отрисовки
}

loadGame();
