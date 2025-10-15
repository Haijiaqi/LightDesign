import { Window } from './base/Window.js';
import { Object } from './base/Object.js';
import { Point } from './base/Point.js';
import { Vector } from './base/Vector.js';

// ========================
// 1. 配置参数（预留接口）
// ========================
const CONFIG = {
    // 显示器物理尺寸（厘米）
    screenXLengthCm: 31.0,
    screenYLengthCm: 15.515,
    // 双眼瞳距（厘米）
    eyeD: 6.2,
    // 相机初始参数
    initialCamRadius: 20,
    // 点云密度
    spherePoints: 1000,
    cubePoints: 1000
};

// ========================
// 2. 创建3D对象（立方体和球体）
// ========================
function createCube(size = 5, pointsPerFace = 100) {
    const points = [];
    const halfSize = size / 2;
    
    // 生成立方体6个面的点
    for (let i = 0; i < pointsPerFace; i++) {
        // 前面 (z = +halfSize)
        points.push(new Point(
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size,
            halfSize
        ));
        
        // 后面 (z = -halfSize)
        points.push(new Point(
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size,
            -halfSize
        ));
        
        // 左面 (x = -halfSize)
        points.push(new Point(
            -halfSize,
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size
        ));
        
        // 右面 (x = +halfSize)
        points.push(new Point(
            halfSize,
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size
        ));
        
        // 上面 (y = +halfSize)
        points.push(new Point(
            (Math.random() - 0.5) * size,
            halfSize,
            (Math.random() - 0.5) * size
        ));
        
        // 下面 (y = -halfSize)
        points.push(new Point(
            (Math.random() - 0.5) * size,
            -halfSize,
            (Math.random() - 0.5) * size
        ));
    }
    
    return new Object(points);
}

function createSphere(radius = 3, numPoints = 2000) {
    const points = [];
    
    // 生成球形点云
    for (let i = 0; i < numPoints; i++) {
        // 使用均匀分布的球坐标
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        
        const x = radius * Math.sin(phi) * Math.cos(theta) - 5;
        const y = radius * Math.sin(phi) * Math.sin(theta) - 20;
        const z = radius * Math.cos(phi) + 5;
        
        points.push(new Point(x, y, z));
    }
    
    return new Object(points);
}

// 创建示例对象
const objects = [
    createSphere(3, CONFIG.spherePoints),
    createCube(5, Math.floor(CONFIG.cubePoints / 6))
];

// ========================
// 3. 初始化全局变量
// ========================
let screenWidthPx = window.innerWidth;
let screenHeightPx = window.innerHeight;

// 相机控制参数
let camAngle = 0; // 水平旋转角度
let camElevation = 0; // 垂直旋转角度
let camRadius = CONFIG.initialCamRadius; // 相机距离
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// 光源参数
let lightAngle = Math.PI / 4;
let lightElevation = Math.PI / 6;
let lightRadius = 30;

// 创建窗口实例
let hiddenWindow = null;
let lightWindow = null;
let mainWindow = null;

// DOM元素
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const debugDiv = document.getElementById('debug');

// ========================
// 4. 初始化函数
// ========================
function init() {
    // 设置画布大小
    resizeCanvas();
    
    // 创建隐藏窗口用于法向量估算
    hiddenWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
    
    // 创建光源窗口
    lightWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
    
    // 创建主渲染窗口
    mainWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
    
    // 估算法向量
    estimateNormals();
    
    // 计算初始光源
    updateLight();
    
    // 添加到DOM
    document.body.appendChild(canvas);
    
    // 设置事件监听器
    setupEventListeners();
    
    debugDiv.textContent = "初始化完成";
}

// ========================
// 5. 法向量估算
// ========================
function estimateNormals() {
    console.log("开始估算法向量...");
    const radius = 15;
    
    // 从多个角度计算法向量
    for (let index = 0; index < 10; index++) {
        // 生成随机角度
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        
        // 相机位置
        const camX = radius * Math.sin(theta) * Math.cos(phi);
        const camY = radius * Math.sin(theta) * Math.sin(phi);
        const camZ = radius * Math.cos(theta);
        
        // 设置视线方向（指向原点）
        const hiddenDir = new Vector(0, 0, 0);
        hiddenDir.normalInit(camX, camY, camZ, 0, 0, 0);
        
        // 相机位置（稍微后移）
        const hiddenCamPos = hiddenDir.getPoint(-5);
        
        // 计算并估算法向量
        hiddenWindow.calculate(hiddenCamPos, 0, hiddenDir, objects, 0);
        // hiddenWindow.calculateNormal();
    }
    
    console.log("法向量估算完成");
}

// ========================
// 6. 光源更新
// ========================
function updateLight() {
    // 计算光源位置
    const lightX = 0;//lightRadius * Math.cos(lightElevation) * Math.cos(lightAngle);
    const lightY = -30;//lightRadius * Math.cos(lightElevation) * Math.sin(lightAngle);
    const lightZ = 5;//lightRadius * Math.sin(lightElevation);
    
    // 设置光源方向（指向原点）
    const lightDir = new Vector(0, 0, 0);
    lightDir.normalInit(lightX, lightY, lightZ, 0, 0, 0);
    
    // 光源位置（稍微后移）
    const lightCamPos = lightDir.getPoint(-5);
    
    // 计算反射光线
    lightWindow.calculate(lightCamPos, 0, lightDir, objects, 1.0);
    
    return { lightX, lightY, lightZ };
}

// ========================
// 7. 更新相机位置
// ========================
function updateCamera() {
    // 计算相机位置（球坐标转笛卡尔坐标）
    const camX = 0;//camRadius * Math.cos(camElevation) * Math.sin(camAngle);
    const camY = -20;//camRadius * Math.cos(camElevation) * Math.cos(camAngle);
    const camZ = 0;//camRadius * Math.sin(camElevation);
    
    // 设置视线方向（指向原点）
    const mainDir = new Vector(0, 0, 0);
    mainDir.normalInit(camX, camY, camZ, 0, 0, 0);
    
    // 相机位置（稍微后移）
    const mainCamPos = mainDir.getPoint(-15);
    
    return { camX, camY, camZ, mainDir, mainCamPos };
}

// ========================
// 8. 渲染函数
// ========================
function render() {
    // 清空画布
    ctx.clearRect(0, 0, screenWidthPx, screenHeightPx);
    
    // 更新相机
    const { camX, camY, camZ, mainDir, mainCamPos } = updateCamera();
    
    // 重新计算主视角投影（启用双眼模式）
    mainWindow.calculate(mainCamPos, CONFIG.eyeD, mainDir, objects, 0);
    
    // 渲染红蓝点
    for (const obj of objects) {
        for (const p of obj.points) {
            // 左眼（红）
            ctx.fillStyle = `hsl(0, 100%, 35%)`;
            ctx.fillRect(p.xL, p.yL, 1, 1);

            // 右眼（蓝）
            ctx.fillStyle = `hsl(240, 100%, 50%)`;
            ctx.fillRect(p.xR, p.yR, 1, 1);
        }
    }
    
    // 更新调试信息
    const lightPos = updateLight();
    debugDiv.textContent = 
        `相机: (${camX.toFixed(1)}, ${camY.toFixed(1)}, ${camZ.toFixed(1)}) | ` +
        `光源: (${lightPos.lightX.toFixed(1)}, ${lightPos.lightY.toFixed(1)}, ${lightPos.lightZ.toFixed(1)}) | ` +
        `距离: ${camRadius.toFixed(1)}`;
}

// ========================
// 9. 事件监听器设置
// ========================
function setupEventListeners() {
    // 键盘控制
    const keys = {};
    
    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
    });
    
    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });
    
    // 鼠标控制
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
    
    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            
            // 水平旋转（绕Y轴）
            camAngle += deltaX * 0.01;
            
            // 垂直旋转（限制在-85°到85°之间，避免翻转）
            camElevation = Math.max(-Math.PI/2 + 0.1, 
                           Math.min(Math.PI/2 - 0.1, camElevation + deltaY * 0.01));
            
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        }
    });
    
    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        // 缩放相机距离（限制最小和最大距离）
        camRadius = Math.max(5, Math.min(100, camRadius + e.deltaY * 0.1));
    });
    
    // 窗口大小变化
    window.addEventListener('resize', () => {
        resizeCanvas();
        // 重新创建窗口实例以适应新尺寸
        hiddenWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
        lightWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
        mainWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
    });
    
    // 处理输入的主循环
    function handleInput() {
        const rotationSpeed = 0.05;
        const moveSpeed = 0.5;
        
        // WASD 控制相机旋转
        if (keys['a']) camAngle -= rotationSpeed; // 左转
        if (keys['d']) camAngle += rotationSpeed; // 右转
        if (keys['w']) camElevation = Math.min(Math.PI/2 - 0.1, camElevation + rotationSpeed); // 上仰
        if (keys['s']) camElevation = Math.max(-Math.PI/2 + 0.1, camElevation - rotationSpeed); // 下俯
        
        // Q/E 控制相机距离
        if (keys['q']) camRadius = Math.max(5, camRadius - moveSpeed); // 靠近
        if (keys['e']) camRadius = Math.min(100, camRadius + moveSpeed); // 远离
        
        // 方向键控制光源
        if (keys['arrowleft']) lightAngle -= rotationSpeed;
        if (keys['arrowright']) lightAngle += rotationSpeed;
        if (keys['arrowup']) lightElevation = Math.min(Math.PI/2 - 0.1, lightElevation + rotationSpeed);
        if (keys['arrowdown']) lightElevation = Math.max(-Math.PI/2 + 0.1, lightElevation - rotationSpeed);
    }
    
    // 主循环
    function gameLoop() {
        handleInput();
        render();
        requestAnimationFrame(gameLoop);
    }
    
    gameLoop();
}

// ========================
// 10. 调整画布大小
// ========================
function resizeCanvas() {
    screenWidthPx = window.innerWidth;
    screenHeightPx = window.innerHeight;
    canvas.width = screenWidthPx;
    canvas.height = screenHeightPx;
}

// ========================
// 11. 启动应用
// ========================
init();