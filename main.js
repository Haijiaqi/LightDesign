import { Window } from './base/Window.js';
import { Object } from './base/Object.js';
import { Point } from './base/Point.js';
import { Vector } from './base/Vector.js';

// ========================
// 1. 初始化 objects（示例点云）
// ========================
function createSampleObjects() {
    const points = [];
    // 生成一个球形点云（半径 20，中心在原点）
    for (let i = 0; i < 2000; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 3;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta) - 15;
        const z = r * Math.cos(phi);
        if (y < -15) {
            points.push(new Point(x, y, z));
        }
    }
    return [new Object(points)];
}

const objects = createSampleObjects();

// ========================
// 2. 获取屏幕物理尺寸（cm）和像素
// ========================
const screenWidthPx = window.innerWidth;
const screenHeightPx = window.innerHeight;
const screenXLengthCm = 31.0;      // 笔记本屏幕宽 31cm
const screenYLengthCm = 15.515;//17.4;      // 高 17.4cm
const eyeD = 6.2;                  // 瞳距 6.2cm

// ========================
// 3. 创建隐藏窗口：估算法向量
// ========================
console.log("Step 1: Estimating normals...");

let hiddenWindow = new Window(screenWidthPx, screenHeightPx, screenXLengthCm, screenYLengthCm);
// 随机生成一个距离原点 100cm 的相机位置（绕原点）
const radius = 15;

let hiddenDir = new Vector(0, 0, 0);
for (let index = 0; index < 10; index++) {
    // 生成随机角度和θ（球坐标角度）
    const phi = Math.random() * Math.PI * 2; // 方位角：0到2π
    const theta = Math.acos(2 * Math.random() - 1); // 极角：0到π（确保均匀分布）
    // 转换为笛卡尔坐标
    const camX = radius * Math.sin(theta) * Math.cos(phi);
    const camY = radius * Math.sin(theta) * Math.sin(phi);
    const camZ = radius * Math.cos(theta);
    hiddenDir.normalInit(camX, camY, camZ, 0, 0, 0);
    let hiddenCamPos = hiddenDir.getPoint(-5);
    // hiddenWindow.calculate(hiddenCamPos, 0, hiddenDir, objects, 0); // 不计算双眼
    hiddenWindow.calculateNormal(); // 估算法向量    
}
console.log("Normals estimated.");

// ========================
// 4. 创建光源窗口：计算反射光 rx, ry, rz
// ========================
console.log("Step 2: Calculating reflection...");

// 光源也放在 100cm 远（可调整）
const lightAngle = Math.random() * Math.PI * 2;
const lightX = 0;//20 * Math.cos(lightAngle);
const lightY = -30;// * Math.sin(lightAngle);
const lightZ = 5; // 稍微抬高
let lightDir = new Vector(0, 0, 0);
lightDir.normalInit(lightX, lightY, lightZ, 0, 0, 5);

let lightWindow = new Window(screenWidthPx, screenHeightPx, screenXLengthCm, screenYLengthCm);
let lightCamPos = lightDir.getPoint(-5);
// lightWindow.calculate(lightCamPos, 0, lightDir, objects, 1.0); // 第5个参数触发反射计算

console.log("Reflection calculated.");

// ========================
// 5. 创建主渲染窗口
// ========================
let mainCamAngle = 0; // 初始正对原点
let mainCamRadius = 20;
let mainCamX = 0;//mainCamRadius * Math.sin(mainCamAngle);
let mainCamY = -10;//mainCamRadius * Math.cos(mainCamAngle);
let mainCamZ = 0;
let mainDir = new Vector(0, 0, 0);
mainDir.normalInit(mainCamX, mainCamY, mainCamZ, 0, 0, 0);
let mainWindow = new Window(screenWidthPx, screenHeightPx, screenXLengthCm, screenYLengthCm);
let mainCamPos = mainDir.getPoint(-40);

mainWindow.calculate(mainCamPos, 0, mainDir, objects, 0);

// ========================
// 6. 渲染函数
// ========================
const canvas = document.createElement('canvas');
canvas.width = screenWidthPx;
canvas.height = screenHeightPx;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

const debugDiv = document.getElementById('debug');

function render() {
    // 清屏
    // ctx.fillStyle = 'hsl(240, 100%, 6%)';
    // ctx.fillRect(0, 0, width, height);
    ctx.clearRect(0, 0, screenWidthPx, screenHeightPx);// 背景

    // 重新计算主视角投影
    //mainWindow.direction = new Vector(0 - mainCamX, 0 - mainCamY, 0 - mainCamZ, mainCamX, mainCamY, mainCamZ);
    mainWindow.calculate(mainCamPos, eyeD, mainWindow.direction, objects, 0);

    // 渲染红蓝点
    for (const obj of objects) {
        for (const p of obj.points) {
            // // 左眼：红色
            // ctx.fillStyle = `rgb(${Math.min(255, 255 * p.light)}, 0, 0)`;
            // ctx.fillRect(p.xL, p.yL, 1, 1);

            // // 右眼：青色
            // ctx.fillStyle = `rgb(0, ${Math.min(255, 255 * p.light)}, ${Math.min(255, 255 * p.light)})`;
            // ctx.fillRect(p.xR, p.yR, 1, 1);
            // 左眼（红）
            ctx.fillStyle = `hsl(0, 100%, 35%)`;
            ctx.fillRect(p.xL, p.yL, 1, 1);

            // 右眼（蓝）
            ctx.fillStyle = `hsl(240, 100%, 50%)`;
            ctx.fillRect(p.xR, p.yR, 1, 1);
        }
    }

    debugDiv.textContent = `MainCam: (${mainCamX.toFixed(1)}, ${mainCamY.toFixed(1)}) | Light: (${lightX.toFixed(1)}, ${lightY.toFixed(1)})`;
}

// ========================
// 7. 输入控制
// ========================
let keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

function handleInput() {
    const speed = 0.1; // 弧度/帧

    // A/D: 控制主视角水平旋转
    if (keys['a'] || keys['A']) {
        mainCamPos.x -= speed;
        mainWindow.direction.x -= speed;
    }
    if (keys['d'] || keys['D']) {
        mainCamPos.x += speed;
        mainWindow.direction.x += speed;
    }

    // ←/→: 控制光源水平旋转
    // if (keys['ArrowLeft']) {
    //     lightAngle += speed;
    //     const newLightX = 100 * Math.sin(lightAngle);
    //     const newLightY = 100 * Math.cos(lightAngle);
    //     lightPos = new Point(newLightX, newLightY, lightZ);
    //     lightDir = new Vector(0 - newLightX, 0 - newLightY, 0 - lightZ, newLightX, newLightY, lightZ);
    //     // 重新计算光照
    //     lightWindow.calculate(lightPos, 0, lightDir, objects, 1.0);
    // }
    // if (keys['ArrowRight']) {
    //     lightAngle -= speed;
    //     const newLightX = 100 * Math.sin(lightAngle);
    //     const newLightY = 100 * Math.cos(lightAngle);
    //     lightPos = new Point(newLightX, newLightY, lightZ);
    //     lightDir = new Vector(0 - newLightX, 0 - newLightY, 0 - lightZ, newLightX, newLightY, lightZ);
    //     lightWindow.calculate(lightPos, 0, lightDir, objects, 1.0);
    // }

    // 更新主相机位置
    // mainCamX = mainCamRadius * Math.cos(mainCamAngle);
    // mainCamY = mainCamRadius * Math.sin(mainCamAngle);
    // mainCamPos.x += speed;
    // mainCamPos.x += speed;
}

// ========================
// 8. 主循环
// ========================
render(); // 初始渲染

function gameLoop() {
    handleInput();
    render();
    requestAnimationFrame(gameLoop);
}

gameLoop();