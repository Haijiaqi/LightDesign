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
    eyeD: 6.3,
    // 相机初始参数
    initialCamRadius: 20,
    initialCamAngle: 0,
    initialCamElevation: 0,
    // 光源初始参数
    initialLightRadius: 5,
    initialLightAngle: 0,
    initialLightElevation: 0,
    // 点云密度
    spherePoints: 1000,
    cubePoints: 2000,
    // 渲染和控制参数
    rotationSpeed: 0.05,
    moveSpeed: 0.5,
    zoomSpeed: 0.1,
    minZoom: 5,
    maxZoom: 100,
    minElevation: -Math.PI / 2 + 0.1,
    maxElevation: Math.PI / 2 - 0.1,
    // 拖拽旋转灵敏度
    dragRotationSpeed: 0.01,
    // 隐藏窗口估算次数
    normalEstimationIterations: 500,
    normalEstimationRadius: 25,
    // 临时代码：预留摄像头控制参数
    // cameraControl: {
    //     enabled: false,
    //     sensitivity: 0.01
    // },
};

// ========================
// 2. 对象创建函数
// ========================
function createCube(size = 5, pointsPerFace = 100, x = 0, y = -30, z = 0, alpha = 0, ifEntity = false) {
    const points = [];
    const halfSize = size / 2;
    const rad = alpha * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    // 生成6个面的点
    const faceGenerators = [
        () => ({ x: (Math.random() - 0.5) * size, y: (Math.random() - 0.5) * size, z: halfSize }), // 前
        () => ({ x: (Math.random() - 0.5) * size, y: (Math.random() - 0.5) * size, z: -halfSize }), // 后
        () => ({ x: -halfSize, y: (Math.random() - 0.5) * size, z: (Math.random() - 0.5) * size }), // 左
        () => ({ x: halfSize, y: (Math.random() - 0.5) * size, z: (Math.random() - 0.5) * size }), // 右
        () => ({ x: (Math.random() - 0.5) * size, y: halfSize, z: (Math.random() - 0.5) * size }), // 上
        () => ({ x: (Math.random() - 0.5) * size, y: -halfSize, z: (Math.random() - 0.5) * size })  // 下
    ];

    for (let i = 0; i < pointsPerFace; i++) {
        // 修复：解构赋值使用正确的属性名 x, y, z
        faceGenerators.forEach(gen => {
            const { x: px, y: py, z: pz } = gen(); // 使用别名 (x as px, y as py, z as pz)
            // 或者 const genResult = gen(); const px = genResult.x; const py = genResult.y; const pz = genResult.z;
            const rotatedX = px * cosA - py * sinA;
            const rotatedY = px * sinA + py * cosA;
            const rotatedZ = pz;
            points.push(new Point(rotatedX + x, rotatedY + y, rotatedZ + z));
        });

        if (ifEntity) {
            const intX = (Math.random() - 0.5) * size;
            const intY = (Math.random() - 0.5) * size;
            const intZ = (Math.random() - 0.5) * size;
            const rotatedX = intX * cosA - intY * sinA;
            const rotatedY = intX * sinA + intY * cosA;
            const rotatedZ = intZ;
            points.push(new Point(rotatedX + x, rotatedY + y, rotatedZ + z));
        }
    }
    return new Object(points);
}

function createSphere(x0, y0, z0, radius = 1, numPoints = 50) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const x = radius * Math.sin(phi) * Math.cos(theta) + x0;
        const y = radius * Math.sin(phi) * Math.sin(theta) + y0;
        const z = radius * Math.cos(phi) + z0;
        points.push(new Point(x, y, z));
    }
    return new Object(points);
}

function createPoints() {
    const points = [
        new Point(0.1, -10, 1.3),
        new Point(0, -10, 1.2),
        new Point(0.1, -10, 1.1),
        new Point(0, -10, 1)
    ];
    return new Object(points);
}

function createLatitudeSphere(radius = 10, latitudeCount = 10, pointsPerCircle = 20) {
    const points = [];
    const latitudeStep = Math.PI / (latitudeCount + 1);
    for (let lat = 1; lat <= latitudeCount; lat++) {
        const theta = lat * latitudeStep;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const circleRadius = radius * sinTheta;
        for (let i = 0; i < pointsPerCircle; i++) {
            const phi = (i / pointsPerCircle) * Math.PI * 2;
            points.push(new Point(
                circleRadius * Math.cos(phi),
                circleRadius * Math.sin(phi),
                radius * cosTheta
            ));
        }
    }
    return new Object(points);
}

function createRectangleFace(pointsCount = 1000, rotationZ = 0, ys = 0) {
    const points = [];
    const rad = rotationZ * Math.PI / 180;
    const cosθ = Math.cos(rad);
    const sinθ = Math.sin(rad);

    const corners = [
        {x: -2 + ys, y: 0 + ys, z: 8 + ys},
        {x: 2 + ys, y: 0 + ys, z: 8 + ys},
        {x: -2 + ys, y: 0 + ys, z: 0 + ys},
        {x: 2 + ys, y: 0 + ys, z: 0 + ys}
    ];

    const rotatePoint = (p) => ({
        x: p.x * cosθ - p.y * sinθ,
        y: p.x * sinθ + p.y * cosθ,
        z: p.z
    });

    corners.forEach(corner => {
        const rotated = rotatePoint(corner);
        points.push(new Point(rotated.x, rotated.y, rotated.z));
    });

    for (let i = 0; i < pointsCount; i++) {
        const rawPoint = {
            x: -2 + ys + Math.random() * 4,
            y: 0 + ys,
            z: 0 + ys + Math.random() * 8
        };
        const rotated = rotatePoint(rawPoint);
        points.push(new Point(rotated.x, rotated.y, rotated.z));
    }
    return new Object(points);
}

function createSphereWithLines(radius = 3, longitudeLines = 12, latitudeLines = 8, pointsPerLine = 30) {
    const points = [];
    const halfPi = Math.PI / 2;
    const twoPi = Math.PI * 2;

    // 经度线
    for (let lon = 0; lon < longitudeLines; lon++) {
        const lonAngle = (lon / longitudeLines) * twoPi;
        const cosLon = Math.cos(lonAngle);
        const sinLon = Math.sin(lonAngle);
        for (let i = 0; i < pointsPerLine; i++) {
            const latAngle = halfPi - (i / (pointsPerLine - 1)) * Math.PI;
            const cosLat = Math.cos(latAngle);
            const sinLat = Math.sin(latAngle);
            points.push(new Point(
                radius * cosLat * cosLon,
                radius * cosLat * sinLon,
                radius * sinLat
            ));
        }
    }

    // 纬度线
    for (let lat = 1; lat < latitudeLines; lat++) {
        const latAngle = halfPi - (lat / latitudeLines) * Math.PI;
        const cosLat = Math.cos(latAngle);
        const sinLat = Math.sin(latAngle);
        const circleRadius = radius * cosLat;
        for (let i = 0; i < pointsPerLine; i++) {
            const lonAngle = (i / (pointsPerLine - 1)) * twoPi;
            const cosLon = Math.cos(lonAngle);
            const sinLon = Math.sin(lonAngle);
            points.push(new Point(
                circleRadius * cosLon,
                circleRadius * sinLon,
                radius * sinLat
            ));
        }
    }
    return new Object(points);
}

// ========================
// 3. 系统状态管理
// ========================
const SystemState = {
    // 对象列表
    objects: [
        createCube(5, Math.floor(CONFIG.cubePoints), 0, 0, 0, 45, false)
    ],
    otherObjects: [], // 例如光源点

    // 窗口实例
    hiddenWindow: null,
    lightWindow: null,
    mainWindow: null,

    // 相机控制参数
    camAngle: CONFIG.initialCamAngle,
    camElevation: CONFIG.initialCamElevation,
    camRadius: CONFIG.initialCamRadius,

    // 光源控制参数
    lightAngle: CONFIG.initialLightAngle,
    lightElevation: CONFIG.initialLightElevation,
    lightRadius: CONFIG.initialLightRadius,

    // 鼠标拖拽状态
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,

    // 键盘状态
    keys: {},

    // DOM 元素
    canvas: null,
    ctx: null,
    debugDiv: null,

    // 画布尺寸
    screenWidthPx: window.innerWidth,
    screenHeightPx: window.innerHeight,
};

// ========================
// 4. 初始化函数
// ========================
function init() {
    // 创建 DOM 元素
    SystemState.canvas = document.createElement('canvas');
    SystemState.ctx = SystemState.canvas.getContext('2d');
    SystemState.debugDiv = document.getElementById('debug') || document.createElement('div'); // 防止 debugDiv 不存在
    SystemState.debugDiv.id = 'debug'; // 确保 ID
    if (!document.getElementById('debug')) {
        document.body.appendChild(SystemState.debugDiv);
    }

    // 设置画布大小
    resizeCanvas();

    // 创建窗口实例
    SystemState.hiddenWindow = new Window(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'hidden');
    SystemState.lightWindow = new Window(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'light');
    SystemState.mainWindow = new Window(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'main');
    SystemState.mainWindow.direction = new Vector(0, 0, 0);
    SystemState.mainWindow.direction.normalInit(0, 0, 0, 0, 1, 0);
    SystemState.mainWindow.capital = SystemState.mainWindow.direction.getPoint(-50);

    // 估算法向量
    estimateNormals();

    // 计算初始光源
    updateLight();

    // 添加到DOM
    document.body.appendChild(SystemState.canvas);

    // 设置事件监听器
    setupEventListeners();

    SystemState.debugDiv.textContent = "初始化完成";
    console.log("初始化完成");
}

// ========================
// 5. 法向量估算
// ========================
function estimateNormals() {
    console.log("开始估算法向量...");
    const radius = CONFIG.normalEstimationRadius;

    for (let index = 0; index < CONFIG.normalEstimationIterations; index++) {
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const camX = radius * Math.sin(theta) * Math.cos(phi);
        const camY = radius * Math.sin(theta) * Math.sin(phi);
        const camZ = radius * Math.cos(theta);
        const hiddenDir = new Vector(0, 0, 0);
        hiddenDir.normalInit(camX, camY, camZ, 0, 0, 0);
        const hiddenCamPos = hiddenDir.getPoint(-5);
        SystemState.hiddenWindow.calculate(hiddenCamPos, 0, hiddenDir, SystemState.objects, 0, SystemState.otherObjects);
    }
    console.log("法向量估算完成");
}

// ========================
// 6. 光源更新
// ========================
function updateLight() {
    const lightX = SystemState.lightRadius * Math.cos(SystemState.lightElevation) * Math.cos(SystemState.lightAngle);
    const lightY = SystemState.lightRadius * Math.cos(SystemState.lightElevation) * Math.sin(SystemState.lightAngle);
    const lightZ = SystemState.lightRadius * Math.sin(SystemState.lightElevation);
    const lightDir = new Vector(0, 0, 0);
    lightDir.normalInit(lightX, lightY, lightZ, 0, 0, 0);
    const lightCamPos = lightDir.getPoint(-5);
    SystemState.lightWindow.calculate(lightCamPos, 0, lightDir, SystemState.objects, 1.0, SystemState.otherObjects);
    SystemState.otherObjects.length = 0; // 清空 otherObjects
    SystemState.otherObjects.push(createSphere(lightX, lightY, lightZ, 1, 20)); // 添加光源点
}

// ========================
// 7. 相机更新
// ========================
function updateCamera() {
    SystemState.mainWindow.calculate(SystemState.mainWindow.capital, CONFIG.eyeD, SystemState.mainWindow.direction, SystemState.objects, 0, SystemState.otherObjects);
}

// ========================
// 8. 渲染函数
// ========================
function render() {
    const ctx = SystemState.ctx;
    ctx.clearRect(0, 0, SystemState.screenWidthPx, SystemState.screenHeightPx);
    updateCamera();

    // 渲染红蓝点
    for (let gridX = 0; gridX < SystemState.mainWindow.grid.length; gridX++) {
        for (let gridY = 0; gridY < SystemState.mainWindow.grid[gridX].length; gridY++) {
            const pointsInGrid = SystemState.mainWindow.grid[gridX][gridY];
            for (const p of pointsInGrid) {
                if (Math.abs(p.xL - p.xR) > 0) {
                    if (p.xL !== 0 && p.yL !== 0) {
                        ctx.fillStyle = `hsl(0, 100%, ${p.light * 35}%)`;
                        ctx.fillRect(p.xL, p.yL, 1, 1);
                    }
                    if (p.xR !== 0 && p.yR !== 0) {
                        ctx.fillStyle = `hsl(240, 100%, ${p.light * 50}%)`;
                        ctx.fillRect(p.xR, p.yR, 1, 1);
                    }
                } else {
                    ctx.fillStyle = `hsl(285, 90%, ${p.light * 50}%)`;
                    ctx.fillRect(p.xL, p.yL, 1, 1);
                }
            }
        }
    }
}

// ========================
// 9. 输入处理
// ========================
function handleInput() {
    const keys = SystemState.keys;

    // WASD 控制相机水平旋转 (模拟原始代码中的 Z/X/C/V/B/N/M)
    if (keys['z']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed);
    if (keys['x']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed * 0.5);
    if (keys['c']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed * 0.25);
    if (keys['v']) SystemState.mainWindow.horizontalRotation(0); // 无旋转
    if (keys['b']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed * 0.25);
    if (keys['n']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed * 0.5);
    if (keys['m']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed);

    // Q/E 控制相机距离
    if (keys['q']) SystemState.camRadius = Math.max(CONFIG.minZoom, SystemState.camRadius - CONFIG.moveSpeed);
    if (keys['e']) SystemState.camRadius = Math.min(CONFIG.maxZoom, SystemState.camRadius + CONFIG.moveSpeed);

    // 方向键控制光源
    if (keys['arrowleft']) SystemState.lightAngle -= CONFIG.rotationSpeed;
    if (keys['arrowright']) SystemState.lightAngle += CONFIG.rotationSpeed;
    if (keys['arrowup']) SystemState.lightElevation = Math.min(CONFIG.maxElevation, SystemState.lightElevation + CONFIG.rotationSpeed);
    if (keys['arrowdown']) SystemState.lightElevation = Math.max(CONFIG.minElevation, SystemState.lightElevation - CONFIG.rotationSpeed);

    // 临时代码：预留摄像头控制逻辑入口
    // if (CONFIG.cameraControl.enabled) {
    //     // 这里可以从摄像头数据更新 SystemState.camAngle, SystemState.camElevation 等
    //     // 例如：SystemState.camAngle += cameraHeadYaw * CONFIG.cameraControl.sensitivity;
    // }
}

// ========================
// 10. 事件监听器设置
// ========================
function setupEventListeners() {
    // 键盘事件
    window.addEventListener('keydown', (e) => {
        SystemState.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', (e) => {
        SystemState.keys[e.key.toLowerCase()] = false;
    });

    // 鼠标事件
    SystemState.canvas.addEventListener('mousedown', (e) => {
        SystemState.isDragging = true;
        SystemState.lastMouseX = e.clientX;
        SystemState.lastMouseY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
        SystemState.isDragging = false;
    });
    SystemState.canvas.addEventListener('mousemove', (e) => {
        if (SystemState.isDragging) {
            const deltaX = e.clientX - SystemState.lastMouseX;
            const deltaY = e.clientY - SystemState.lastMouseY;
            SystemState.camAngle += deltaX * CONFIG.dragRotationSpeed;
            SystemState.camElevation = Math.max(CONFIG.minElevation, Math.min(CONFIG.maxElevation, SystemState.camElevation - deltaY * CONFIG.dragRotationSpeed)); // 注意 deltaY 符号
            SystemState.lastMouseX = e.clientX;
            SystemState.lastMouseY = e.clientY;
        }
    });

    // 滚轮事件
    SystemState.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        SystemState.camRadius = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, SystemState.camRadius + e.deltaY * CONFIG.zoomSpeed));
    });

    // 窗口大小变化事件
    window.addEventListener('resize', () => {
        resizeCanvas();
        // 重新创建窗口实例以适应新尺寸
        SystemState.hiddenWindow = new Window(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'hidden');
        SystemState.lightWindow = new Window(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'light');
        SystemState.mainWindow.update(SystemState.screenWidthPx, SystemState.screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
        // 重新估算法向量（可选，可能耗时）
        // estimateNormals();
    });
}

// ========================
// 11. 调整画布大小
// ========================
function resizeCanvas() {
    SystemState.screenWidthPx = window.innerWidth;
    SystemState.screenHeightPx = window.innerHeight;
    SystemState.canvas.width = SystemState.screenWidthPx;
    SystemState.canvas.height = SystemState.screenHeightPx;
}

// ========================
// 12. 动态对象创建接口（预留）
// ========================
function createObjectFromCommand(command) {
    // 临时代码：预留通过指令创建对象的接口
    // 例如: command = { type: 'sphere', params: { x: 0, y: 0, z: 0, radius: 5, points: 100 } }
    console.log("收到创建对象指令:", command);
    switch(command.type) {
        case 'sphere':
            return createSphere(command.params.x, command.params.y, command.params.z, command.params.radius, command.params.points);
        case 'cube':
            return createCube(command.params.size, command.params.pointsPerFace, command.params.x, command.params.y, command.params.z, command.params.alpha, command.params.ifEntity);
        default:
            console.warn("未知的对象类型:", command.type);
            return null;
    }
}

// ========================
// 13. 摄像头控制接口（预留）
// ========================
function updateFromCamera(cameraData) {
    // 临时代码：预留摄像头数据更新系统状态的接口
    // 例如: cameraData = { headYaw: 0.1, headPitch: -0.05, handPosition: {x: 1, y: 2, z: 3} }
    // SystemState.camAngle += cameraData.headYaw * CONFIG.cameraControl.sensitivity;
    // SystemState.camElevation += cameraData.headPitch * CONFIG.cameraControl.sensitivity;
    console.log("收到摄像头数据:", cameraData);
}

// ========================
// 14. 主循环
// ========================
function gameLoop() {
    handleInput();
    updateLight(); // 每帧更新光源位置（如果需要动态光源）
    render();
    requestAnimationFrame(gameLoop);
}

// ========================
// 15. 启动应用
// ========================
init();
gameLoop(); // 启动主循环