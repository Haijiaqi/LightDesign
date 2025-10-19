import { Window } from './base/Window.js';
import { Object } from './base/Object.js';
import { Point } from './base/Point.js';
import { Vector } from './base/Vector.js';
import { Classifier } from './math/Classifier.js';

// ========================
// 1. 配置参数（预留接口）
// ========================
const CONFIG = {
    // 显示器物理尺寸（厘米）
    screenXLengthCm: 31.0,
    screenYLengthCm: 17.4,
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
    cubePoints: 750,
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
    normalEstimationRadius: 15,
    // 摄像头控制参数
    cameraControl: {
        enabled: true, // 默认关闭摄像头控制
        sensitivity: 0.005, // 控制灵敏度
        targetHue: 0, // 目标颜色的色调 (0=红, 120=绿, 240=蓝)
        targetHueTolerance: 30, // 色调容差
        targetSaturation: 0.7, // 最小饱和度
        targetValue: 0.5, // 最小亮度
        minArea: 50, // 最小识别面积 (像素^2)
        maxArea: 10000, // 最大识别面积 (像素^2)
        smoothingFactor: 0.1 // 位置平滑因子 (0-1, 1=无平滑)
    },
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

    const faceGenerators = [
        () => ({ x: (Math.random() - 0.5) * size, y: (Math.random() - 0.5) * size, z: halfSize }), // 前
        () => ({ x: (Math.random() - 0.5) * size, y: (Math.random() - 0.5) * size, z: -halfSize }), // 后
        () => ({ x: -halfSize, y: (Math.random() - 0.5) * size, z: (Math.random() - 0.5) * size }), // 左
        () => ({ x: halfSize, y: (Math.random() - 0.5) * size, z: (Math.random() - 0.5) * size }), // 右
        () => ({ x: (Math.random() - 0.5) * size, y: halfSize, z: (Math.random() - 0.5) * size }), // 上
        () => ({ x: (Math.random() - 0.5) * size, y: -halfSize, z: (Math.random() - 0.5) * size })  // 下
    ];

    for (let i = 0; i < pointsPerFace; i++) {
        faceGenerators.forEach(gen => {
            const { x: px, y: py, z: pz } = gen(); // 修复解构赋值
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
function createPlane(width = 20, height = 10, pointsPerFace = 10000, x = 0, y = 0, z = 0, alpha = 5, ifEntity = false) {
    const points = [];
    const halfWidth = width / 2;   // 宽度半值（X方向范围）
    const halfHeight = height / 2; // 高度半值（Z方向范围）
    const rad = alpha * Math.PI / 180; // 角度转弧度
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    // 生成平面表面点（Z轴在平面上，中心位于Z轴）
    const generateSurfacePoint = () => {
        // 原始坐标：X范围[-halfWidth, halfWidth]，Z范围[-halfHeight, halfHeight]，Y=0（下边框初始在xy平面）
        const px = (Math.random() - 0.5) * width;
        const pz = (Math.random() - 0.5) * height;
        const py = 0;

        // 绕Z轴旋转点坐标
        const rotatedX = px * cosA - py * sinA;
        const rotatedY = px * sinA + py * cosA;
        const rotatedZ = pz;

        // 计算法向量（默认(0,-1,0)，同步绕Z轴旋转）
        const nx = 0 * cosA - (-1) * sinA; // 原法向量(0,-1,0)旋转后x分量
        const ny = 0 * sinA + (-1) * cosA; // 原法向量(0,-1,0)旋转后y分量
        const nz = 0; // Z分量不变

        const p = new Point(rotatedX + x, rotatedY + y, rotatedZ + z);
        p.nx = nx;p.ny = ny;p.nz = nz;
        // 平移到目标位置并返回点（包含法向量）
        return p;
    };

    // 生成平面点（表面点）
    for (let i = 0; i < pointsPerFace; i++) {
        points.push(generateSurfacePoint());
    }

    // 若需要实体点（内部填充点，逻辑同表面点）
    if (ifEntity) {
        for (let i = 0; i < pointsPerFace; i++) {
            points.push(generateSurfacePoint());
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
    ifControl: true,
    // 对象列表
    objects: [
        createCube(5, Math.floor(CONFIG.cubePoints), 0, 0, 8.7, 45, false),
        // createPlane()
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

    // 摄像头相关状态
    video: null,
    videoCanvas: null,
    videoCtx: null,
    cameraActive: false,
    targetPosition: { x: 0, y: 0 }, // 平滑后的目标位置
    lastDetectionTime: 0, // 上次检测时间，用于控制检测频率
    detectionInterval: 20, // 每隔 100ms 检测一次
    smoothingListDis: [],
    smoothingListHeight: [],
    smoothingListX: []
};
const C = new Classifier();

// ========================
// 4. 摄像头初始化函数
// ========================
async function initCamera() {
    if (!CONFIG.cameraControl.enabled) {
        console.log("摄像头控制未启用，跳过初始化。");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        SystemState.video = document.createElement('video');
        SystemState.video.srcObject = stream;
        SystemState.video.play();
        SystemState.video.style.display = 'none'; // 隐藏视频元素
        document.body.appendChild(SystemState.video);

        // 创建用于处理视频帧的 canvas
        SystemState.videoCanvas = document.createElement('canvas');
        SystemState.videoCtx = SystemState.videoCanvas.getContext('2d');

        SystemState.cameraActive = true;
        console.log("摄像头初始化成功。");
    } catch (err) {
        console.error("无法访问摄像头:", err);
        SystemState.debugDiv.textContent = `摄像头错误: ${err.message || err}`;
        CONFIG.cameraControl.enabled = false; // 禁用摄像头控制
    }
}

// ========================
// 5. 摄像头识别处理函数
// ========================
function processCamera() {
    console.group("=== processCamera 开始 ==="); // 开始一个日志组，方便折叠查看

    // 1. 检查摄像头是否已激活且配置允许处理
    if (!SystemState.cameraActive) {
        console.log("摄像头未激活，跳过处理。SystemState.cameraActive =", SystemState.cameraActive);
        console.groupEnd(); // 结束日志组
        return;
    }
    if (!CONFIG.cameraControl.enabled) {
        console.log("摄像头控制在配置中被禁用，跳过处理。CONFIG.cameraControl.enabled =", CONFIG.cameraControl.enabled);
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("摄像头已激活且控制已启用，继续处理。");

    // 2. 控制处理频率
    const now = Date.now();
    // console.log("当前时间戳:", now, "上次处理时间戳:", SystemState.lastDetectionTime, "间隔阈值:", SystemState.detectionInterval);
    if (now - SystemState.lastDetectionTime < SystemState.detectionInterval) {
        // console.log("未到处理间隔，跳过本次处理。距离下次处理还需:", (SystemState.detectionInterval - (now - SystemState.lastDetectionTime)), "ms");
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("已到达处理间隔，开始处理视频帧。");
    SystemState.lastDetectionTime = now;

    // 3. 获取视频和处理用的 Canvas 上下文
    const video = SystemState.video;
    const canvas = SystemState.videoCanvas;
    const ctx = SystemState.videoCtx;

    // 4. 检查视频是否准备好
    // console.log("视频 readyState:", video.readyState, " (0: HAVE_NOTHING, 1: HAVE_METADATA, 2: HAVE_CURRENT_DATA, 3: HAVE_FUTURE_DATA, 4: HAVE_ENOUGH_DATA)");
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        console.warn("视频数据不足，无法处理。");
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("视频数据充足，准备处理。");

    // 5. 设置处理 Canvas 的尺寸
    // console.log("视频原始尺寸: 宽", video.videoWidth, "高", video.videoHeight);
    canvas.width = video.videoWidth / 8;
    canvas.height = video.videoHeight / 8;
    // console.log("设置处理 Canvas 尺寸: 宽", canvas.width, "高", canvas.height);

    // 6. 将视频帧绘制到 Canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // console.log("已将视频帧绘制到处理 Canvas。");

    // 7. 获取像素数据
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    // console.log("获取到 ImageData，总像素数:", data.length / 4);
    const res = C.processImageFromCamera(data, canvas.width, canvas.height);
    if (res && res.estimateDis && res.headHeight && res.headX) {
        const headDis = processQueue(SystemState.smoothingListDis, res.estimateDis, 10, 0.4);
        let headHeight = processQueue(SystemState.smoothingListHeight, res.headHeight, 10, 0.4);
        let headX = processQueue(SystemState.smoothingListX, res.headX, 10, 0.4);
        headHeight = Math.tan(((0.5 - headHeight) / 0.5) * (Math.PI / 6)) * headDis + (SystemState.mainWindow.ylength / 2);
        if (Math.abs(headX - 0.5) > 0.25) {
            headX = 0;
        } else {
            headX = Math.tan(((0.5 - headX) / 0.25) * (Math.PI / 6)) * headDis;
        }
        SystemState.mainWindow.headMoveTo(-headDis, headHeight, headX);
        SystemState.ifControl = true;
    }

    // updateCameraDisplay(res);
    console.groupEnd(); // 结束日志组
    console.log("--- processCamera 结束 ---\n"); // 结束标记，增加空行便于阅读
}
function processQueue(dataList, num, maxLength = 5, tol = 0.1) {
    // 1. 入队并控制最大长度
    dataList.push(num);
    if (dataList.length > maxLength) {
        dataList.shift(); // 移除最旧的元素 (头部移除，O(n) 操作，但队列短所以影响小)
        // 如果 maxLength 非常大，可以考虑用循环数组优化 shift，但通常不必要。
    }

    // 2. 计算当前队列的初始平均值 (O(n))
    let sum = 0;
    const len = dataList.length;
    for (const val of dataList) {
        sum += val;
    }
    const avg = len > 0 ? sum / len : 0;

    // 3. 原地筛选元素 (O(n))
    // 使用 writeIndex 指针，将符合条件的元素依次放回数组前面
    let writeIndex = 0;
    let newSum = 0;
    const lastOriginalIndex = dataList.length - 1; // 新添加元素在筛选前的索引

    for (let i = 0; i < dataList.length; i++) {
        const val = dataList[i];
        let valid = false;

        if (avg === 0) {
            // 平均值为0时，使用绝对偏差判断
            valid = Math.abs(val) <= tol;
        } else {
            // 平均值非0时，使用相对偏差判断
            const diffRatio = Math.abs(val - avg) / Math.abs(avg);
            // 对最新添加的元素，使用更宽松的容差 (2 * tol)
            valid = i === lastOriginalIndex ? diffRatio <= 2 * tol : diffRatio <= tol;
        }

        if (valid) {
            dataList[writeIndex] = val; // 将有效元素写入新位置
            newSum += val;
            writeIndex++; // 移动写指针
        }
    }

    // 4. 截断数组到有效部分 (O(1))
    dataList.length = writeIndex;

    // 5. 返回筛选后数组的平均值
    return writeIndex > 0 ? newSum / writeIndex : 0;
}
// ========================
// 6. 初始化函数
// ========================
async function init() { // 改为 async
    // 创建 DOM 元素
    SystemState.canvas = document.createElement('canvas');
    SystemState.ctx = SystemState.canvas.getContext('2d');
    SystemState.debugDiv = document.getElementById('debug') || document.createElement('div');
    SystemState.debugDiv.id = 'debug';
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
    SystemState.mainWindow.direction.normalInit(0, 0, 8.7, 0, 1, 8.7);
    SystemState.mainWindow.capital = SystemState.mainWindow.direction.getPoint(-50);

    // 估算法向量
    estimateNormals();

    // 计算初始光源
    updateLight();

    // 添加到DOM
    document.body.appendChild(SystemState.canvas);

    // 设置事件监听器
    setupEventListeners();

    // 初始化摄像头
    await initCamera(); // 等待摄像头初始化
    // initCameraDisplay();
    SystemState.debugDiv.textContent = "初始化完成";
    console.log("初始化完成");
}

// ========================
// 7. 法向量估算
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
// 8. 光源更新
// ========================
function updateLight() {
    const lightX = SystemState.lightRadius * Math.cos(SystemState.lightElevation) * Math.cos(SystemState.lightAngle);
    const lightY = SystemState.lightRadius * Math.cos(SystemState.lightElevation) * Math.sin(SystemState.lightAngle);
    const lightZ = SystemState.lightRadius * Math.sin(SystemState.lightElevation);
    const lightDir = new Vector(0, 0, 0);
    lightDir.normalInit(lightX, lightY, lightZ + 8.7, 0, 0, 8.7);
    const lightCamPos = lightDir.getPoint(-5);
    SystemState.lightWindow.calculate(lightCamPos, 0, lightDir, SystemState.objects, 1.0, SystemState.otherObjects);
    SystemState.otherObjects.length = 0; // 清空 otherObjects
    SystemState.otherObjects.push(createSphere(lightCamPos.x, lightCamPos.y, lightCamPos.z, 0.5, 20)); // 添加光源点
}

// ========================
// 9. 相机更新
// ========================
function updateCamera() {
    SystemState.mainWindow.calculate(SystemState.mainWindow.capital, CONFIG.eyeD, SystemState.mainWindow.direction, SystemState.objects, 0, SystemState.otherObjects);
}

// ========================
// 10. 渲染函数（基于putImageData批量绘图优化，支持邻接点绘制规则）
// ========================// 1. 预计算固定色相的RGB颜色表（仅初始化一次，避免循环内复杂计算）
// 色相：红(0)、蓝(240)、紫(285)；饱和度：红/蓝(100%)、紫(90%)
const COLOR_LUT = (() => {
  const factor = 100; // 用于将小数亮度转换为数组索引的因子
  const maxBrightnessRed = 35;   // 对应 baseLight = 35
  const maxBrightnessBluePurple = 50; // 对应 baseLight = 50

  // 计算数组大小
  const sizeRed = Math.round(maxBrightnessRed * factor) + 1; // 0 到 3500 (含)
  const sizeBluePurple = Math.round(maxBrightnessBluePurple * factor) + 1; // 0 到 5000 (含)

  const lut = {
    red: new Array(sizeRed),    // 索引 0 到 3500
    blue: new Array(sizeBluePurple),   // 索引 0 到 5000
    purple: new Array(sizeBluePurple)  // 索引 0 到 5000
  };

  // 基础HSL转RGB（仅用于预计算，不在循环中调用）
  const hslToRgb = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };

  // 预计算红色（h=0, s=100%）：亮度0-35
  for (let i = 0; i < sizeRed; i++) {
    const l = i / factor; // 例如 i=150 -> l=1.5
    lut.red[i] = hslToRgb(0, 100, l);
  }

  // 预计算蓝色（h=240, s=100%）：亮度0-50
  for (let i = 0; i < sizeBluePurple; i++) {
    const l = i / factor;
    lut.blue[i] = hslToRgb(240, 100, l);
  }

  // 预计算紫色（h=285, s=90%）：亮度0-50
  for (let i = 0; i < sizeBluePurple; i++) {
    const l = i / factor;
    lut.purple[i] = hslToRgb(285, 90, l);
  }

  return lut;
})();

// 2. 优化后的渲染函数
function render() {
  const ctx = SystemState.ctx;
  const { screenWidthPx: width, screenHeightPx: height } = SystemState;
  
  // 初始化ImageData（批量像素容器）
  const imageData = ctx.createImageData(width, height);
  const pixelData = imageData.data; // RGBA数组：[R, G, B, A]，A固定255（不透明）

  updateCamera();

  // 遍历所有网格点（主循环）
  for (let gridX = 0; gridX < SystemState.mainWindow.grid.length; gridX++) {
    const gridCol = SystemState.mainWindow.grid[gridX];
    for (let gridY = 0; gridY < gridCol.length; gridY++) {
      const pointsInGrid = gridCol[gridY];
      for (const p of pointsInGrid) {
        // --------------------------
        // 处理非紫色点（红蓝点，完全独立计算）
        // --------------------------
        if (Math.abs(p.xL - p.xR) > 0) {
          const first = p.xL % 2 === 0;
          // ① 红色点：xL/yL，baseLight=35，从预计算表取色
          if (first && p.xL !== 0 && p.yL !== 0) {
            const x = p.xL;
            const y = p.yL;
            const light = p.light; // 使用 p.light (与修改前一致)
            const baseLight = 35;
            
            // 主点亮度：light * baseLight（计算索引）
            const mainBrightnessVal = light * baseLight;
            const mainIndex = Math.max(0, Math.min(3500, Math.round(mainBrightnessVal * 100))); // 限制索引范围 [0, 3500]
            const [rMain, gMain, bMain] = COLOR_LUT.red[mainIndex] || [0, 0, 0]; // 使用数组索引查找
            
            // 内联写主点像素（无函数调用开销，直接操作数组）
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const idx = (y * width + x) * 4;
              pixelData[idx] = rMain;
              pixelData[idx + 1] = gMain;
              pixelData[idx + 2] = bMain;
              pixelData[idx + 3] = 255;
            }

            // 红色点邻接点（根据light生成，独立计算）
            const redNeighbors = getNeighbors(x, y, light);
            for (const nb of redNeighbors) {
              const { nx, ny, ratio } = nb;
              // 邻接点亮度：light * baseLight * ratio（符合"亮度越高，邻接越亮"直觉）
              const nbBrightnessVal = light * baseLight * ratio; // light * 35 * ratio
              const nbIndex = Math.max(0, Math.min(3500, Math.round(nbBrightnessVal * 100))); // 限制索引范围 [0, 3500]
              const [rNb, gNb, bNb] = COLOR_LUT.red[nbIndex] || [0, 0, 0]; // 使用数组索引查找
              
              // 内联写邻接点像素
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nbIdx = (ny * width + nx) * 4;
                pixelData[nbIdx] = rNb;
                pixelData[nbIdx + 1] = gNb;
                pixelData[nbIdx + 2] = bNb;
                pixelData[nbIdx + 3] = 255;
              }
            }
          }

          // ② 蓝色点：xR/yR，baseLight=50，从预计算表取色（与红色点完全独立）
          if (p.xR !== 0 && p.yR !== 0) {
            const x = p.xR;
            const y = p.yR;
            const light = p.light; // 使用 p.light (与修改前一致)
            const baseLight = 50;
            
            // 主点像素
            const mainBrightnessVal = light * baseLight; // light * 50
            const mainIndex = Math.max(0, Math.min(5000, Math.round(mainBrightnessVal * 100))); // 限制索引范围 [0, 5000]
            const [rMain, gMain, bMain] = COLOR_LUT.blue[mainIndex] || [0, 0, 0]; // 使用数组索引查找
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const idx = (y * width + x) * 4;
              pixelData[idx] = rMain;
              pixelData[idx + 1] = gMain;
              pixelData[idx + 2] = bMain;
              pixelData[idx + 3] = 255;
            }

            // 蓝色点邻接点
            const blueNeighbors = getNeighbors(x, y, light);
            for (const nb of blueNeighbors) {
              const { nx, ny, ratio } = nb;
              const nbBrightnessVal = light * baseLight * ratio; // light * 50 * ratio
              const nbIndex = Math.max(0, Math.min(5000, Math.round(nbBrightnessVal * 100))); // 限制索引范围 [0, 5000]
              const [rNb, gNb, bNb] = COLOR_LUT.blue[nbIndex] || [0, 0, 0]; // 使用数组索引查找
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nbIdx = (ny * width + nx) * 4;
                pixelData[nbIdx] = rNb;
                pixelData[nbIdx + 1] = gNb;
                pixelData[nbIdx + 2] = bNb;
                pixelData[nbIdx + 3] = 255;
              }
            }
          }
          if (!first && p.xL !== 0 && p.yL !== 0) {
            const x = p.xL;
            const y = p.yL;
            const light = p.light; // 使用 p.light (与修改前一致)
            const baseLight = 35;
            
            // 主点亮度：light * baseLight（计算索引）
            const mainBrightnessVal = light * baseLight;
            const mainIndex = Math.max(0, Math.min(3500, Math.round(mainBrightnessVal * 100))); // 限制索引范围 [0, 3500]
            const [rMain, gMain, bMain] = COLOR_LUT.red[mainIndex] || [0, 0, 0]; // 使用数组索引查找
            
            // 内联写主点像素（无函数调用开销，直接操作数组）
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const idx = (y * width + x) * 4;
              pixelData[idx] = rMain;
              pixelData[idx + 1] = gMain;
              pixelData[idx + 2] = bMain;
              pixelData[idx + 3] = 255;
            }

            // 红色点邻接点（根据light生成，独立计算）
            const redNeighbors = getNeighbors(x, y, light);
            for (const nb of redNeighbors) {
              const { nx, ny, ratio } = nb;
              // 邻接点亮度：light * baseLight * ratio（符合"亮度越高，邻接越亮"直觉）
              const nbBrightnessVal = light * baseLight * ratio; // light * 35 * ratio
              const nbIndex = Math.max(0, Math.min(3500, Math.round(nbBrightnessVal * 100))); // 限制索引范围 [0, 3500]
              const [rNb, gNb, bNb] = COLOR_LUT.red[nbIndex] || [0, 0, 0]; // 使用数组索引查找
              
              // 内联写邻接点像素
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nbIdx = (ny * width + nx) * 4;
                pixelData[nbIdx] = rNb;
                pixelData[nbIdx + 1] = gNb;
                pixelData[nbIdx + 2] = bNb;
                pixelData[nbIdx + 3] = 255;
              }
            }
          }
        } 
        // --------------------------
        // 处理紫色点（独立逻辑）
        // --------------------------
        else {
          if (p.xL !== 0 && p.yL !== 0) {
            const x = p.xL;
            const y = p.yL;
            const light = p.light; // 使用 p.light (与修改前一致)
            const baseLight = 50;
            
            // 主点像素
            const mainBrightnessVal = light * baseLight; // light * 50
            const mainIndex = Math.max(0, Math.min(5000, Math.round(mainBrightnessVal * 100))); // 限制索引范围 [0, 5000]
            const [rMain, gMain, bMain] = COLOR_LUT.purple[mainIndex] || [0, 0, 0]; // 使用数组索引查找
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const idx = (y * width + x) * 4;
              pixelData[idx] = rMain;
              pixelData[idx + 1] = gMain;
              pixelData[idx + 2] = bMain;
              pixelData[idx + 3] = 255;
            }

            // 紫色点邻接点
            const purpleNeighbors = getNeighbors(x, y, light);
            for (const nb of purpleNeighbors) {
              const { nx, ny, ratio } = nb;
              const nbBrightnessVal = light * baseLight * ratio; // light * 50 * ratio
              const nbIndex = Math.max(0, Math.min(5000, Math.round(nbBrightnessVal * 100))); // 限制索引范围 [0, 5000]
              const [rNb, gNb, bNb] = COLOR_LUT.purple[nbIndex] || [0, 0, 0]; // 使用数组索引查找
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nbIdx = (ny * width + nx) * 4;
                pixelData[nbIdx] = rNb;
                pixelData[nbIdx + 1] = gNb;
                pixelData[nbIdx + 2] = bNb;
                pixelData[nbIdx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  // 批量渲染所有像素（仅1次DOM操作）
  ctx.putImageData(imageData, 0, 0);

  // --------------------------
  // 工具函数：生成邻接点（仅计算坐标和比例，无渲染逻辑）
  // --------------------------
  function getNeighbors(x, y, light) {
    const neighbors = [];
    // 规则1：light===1 → 8邻接（上下左右0.707，对角线0.34）
    if (light <= 1 && light > 0.6) {
      neighbors.push(
        { nx: x, ny: y - 1, ratio: 0.707 }, // 上
        { nx: x, ny: y + 1, ratio: 0.707 }, // 下
        { nx: x - 1, ny: y, ratio: 0.707 }, // 左
        { nx: x + 1, ny: y, ratio: 0.707 }, // 右
        { nx: x - 1, ny: y - 1, ratio: 0.4 }, // 左上
        { nx: x + 1, ny: y - 1, ratio: 0.4 }, // 右上
        { nx: x - 1, ny: y + 1, ratio: 0.4 }, // 左下
        { nx: x + 1, ny: y + 1, ratio: 0.4 }  // 右下
      );
    }
    // 规则2：0.19 < light ≤0.66 → 4邻接（light*0.707，保持亮度关联）
    else if (light <= 0.6 && light > 0.3) {
      const ratio = light * 0.707; // 亮度越低，邻接越暗，符合直觉
      neighbors.push(
        { nx: x, ny: y - 1, ratio: 0.707 }, // 上
        { nx: x, ny: y + 1, ratio: 0.707 }, // 下
        { nx: x - 1, ny: y, ratio: 0.707 }, // 左
        { nx: x + 1, ny: y, ratio: 0.707 }, // 右
        { nx: x - 1, ny: y - 1, ratio: 0.4 }, // 左上
        { nx: x + 1, ny: y - 1, ratio: 0.4 }, // 右上
        { nx: x - 1, ny: y + 1, ratio: 0.4 }, // 左下
        { nx: x + 1, ny: y + 1, ratio: 0.4 }  // 右下
      );
    }
    // 规则3：light ≤0.19 → 无邻接
    return neighbors;
  }
}

// ========================
// 11. 输入处理
// ========================
function handleInput() {
    const keys = SystemState.keys;

    // WASD 控制相机水平旋转 (模拟原始代码中的 Z/X/C/V/B/N/M)
    if (keys['z'] || keys['x'] || keys['c'] || keys['v'] || keys['b'] || keys['n'] || keys['m']) {
        SystemState.ifControl = true;
        if (keys['z']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed);
        if (keys['x']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed * 0.5);
        if (keys['c']) SystemState.mainWindow.horizontalRotation(-CONFIG.rotationSpeed * 0.25);
        if (keys['v']) SystemState.mainWindow.horizontalRotation(0); // 无旋转
        if (keys['b']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed * 0.25);
        if (keys['n']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed * 0.5);
        if (keys['m']) SystemState.mainWindow.horizontalRotation(CONFIG.rotationSpeed);
    }

    // Q/E 控制相机距离
    if (keys['q']) SystemState.camRadius = Math.max(CONFIG.minZoom, SystemState.camRadius - CONFIG.moveSpeed);
    if (keys['e']) SystemState.camRadius = Math.min(CONFIG.maxZoom, SystemState.camRadius + CONFIG.moveSpeed);

    // 方向键控制光源
    if (keys['arrowleft']) SystemState.lightAngle -= CONFIG.rotationSpeed;
    if (keys['arrowright']) SystemState.lightAngle += CONFIG.rotationSpeed;
    if (keys['arrowup']) SystemState.lightElevation = Math.min(CONFIG.maxElevation, SystemState.lightElevation + CONFIG.rotationSpeed);
    if (keys['arrowdown']) SystemState.lightElevation = Math.max(CONFIG.minElevation, SystemState.lightElevation - CONFIG.rotationSpeed);

    // 摄像头控制逻辑（如果启用）
    // 摄像头的更新在 processCamera 中进行
}

// ========================
// 12. 事件监听器设置
// ========================
function setupEventListeners() {
    // 键盘事件
    window.addEventListener('keydown', (e) => {
        SystemState.keys[e.key.toLowerCase()] = true;
        // 示例：按 'c' 键切换摄像头控制
        if (e.key.toLowerCase() === 'p') {
            CONFIG.cameraControl.enabled = !CONFIG.cameraControl.enabled;
            if (CONFIG.cameraControl.enabled) {
                initCamera(); // 尝试重新初始化
            }
            SystemState.debugDiv.textContent = `摄像头控制: ${CONFIG.cameraControl.enabled ? '开启' : '关闭'}`;
            console.log(`摄像头控制: ${CONFIG.cameraControl.enabled ? '开启' : '关闭'}`);
        }
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
        SystemState.ifControl = true;
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
// 13. 调整画布大小
// ========================
function resizeCanvas() {
    SystemState.screenWidthPx = window.innerWidth;
    SystemState.screenHeightPx = window.innerHeight;
    SystemState.canvas.width = SystemState.screenWidthPx;
    SystemState.canvas.height = SystemState.screenHeightPx;
}

// ========================
// 14. 动态对象创建接口（预留）
// ========================
function createObjectFromCommand(command) {
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
// 15. 摄像头控制接口（预留）
// ========================
function updateFromCamera(cameraData) {
    // 例如: cameraData = { headYaw: 0.1, headPitch: -0.05, handPosition: {x: 1, y: 2, z: 3} }
    // SystemState.camAngle += cameraData.headYaw * CONFIG.cameraControl.sensitivity;
    // SystemState.camElevation += cameraData.headPitch * CONFIG.cameraControl.sensitivity;
    console.log("收到摄像头数据:", cameraData);
}

// ========================
// 16. 主循环
// ========================
function gameLoop() {
    handleInput();
    processCamera(); // 在主循环中处理摄像头
    drawCameraFeedOnMainCanvas(SystemState.ctx);
    if (SystemState.ifControl) {
        updateLight(); // 每帧更新光源位置（如果需要动态光源）
        render();
        SystemState.ifControl = false;
    }
    requestAnimationFrame(gameLoop);
}
// 假设 SystemState.canvas 是你的主渲染画布 (ctx 是其 2D 上下文)
// 假设 SystemState.video 是你的摄像头视频元素
// 假设 SystemState.videoCanvas 是用于处理视频帧的隐藏 canvas

// --- 1. 初始化摄像头显示画布 (通常在 initCamera 或 init 时调用一次) ---
/**
 * 初始化摄像头显示画布，居中显示且支持尺寸调整
 * @param {number} scale - 尺寸缩放比例（0~1，1=原始尺寸，0.5=半尺寸，默认0.8）
 */
function initCameraDisplay(scale = 0.5) {
    // 创建或替换画布
    if (SystemState.videoDisplayCanvas) {
        SystemState.videoDisplayCanvas.remove();
    }
    SystemState.videoDisplayCanvas = document.createElement('canvas');
    SystemState.videoDisplayCtx = SystemState.videoDisplayCanvas.getContext('2d');

    // 获取视频原始尺寸（默认640x480）
    const videoWidth = SystemState.video?.videoWidth || 640;
    const videoHeight = SystemState.video?.videoHeight || 480;

    // 按比例调整尺寸（支持大小调节）
    const displayWidth = Math.round(videoWidth * scale);
    const displayHeight = Math.round(videoHeight * scale);
    SystemState.videoDisplayCanvas.width = displayWidth;
    SystemState.videoDisplayCanvas.height = displayHeight;

    // 添加到页面并设置居中样式
    document.body.appendChild(SystemState.videoDisplayCanvas);
    const style = SystemState.videoDisplayCanvas.style;
    style.position = 'fixed'; // 固定定位，相对于视口居中
    style.top = '50%';
    style.left = '50%';
    // 通过transform平移实现精确居中（基于自身尺寸的一半）
    style.transform = 'translate(-50%, -50%)';
    style.zIndex = '1'; // 控制层级
    style.border = '2px solid #fff'; // 可选：添加边框便于区分
    style.boxShadow = '0 0 10px rgba(0,0,0,0.3)'; // 可选：添加阴影提升视觉效果

    console.log(`摄像头显示画布初始化完成。尺寸: ${displayWidth}x${displayHeight}，缩放比例: ${scale}`);
    return true;
}


// --- 2. 更新摄像头显示画布内容 (在 processCamera 或渲染循环中调用) ---
function updateCameraDisplay(test) {
    C.updateCameraDisplay(SystemState, test);
}


// --- 3. 将摄像头画面绘制到主渲染画布 (在 render 函数中调用) ---
function drawCameraFeedOnMainCanvas(ctx, x = 0, y = 0, width = 200, height = 150, opacity = 0.5) { // 可调整位置、大小和透明度
    if (!SystemState.videoDisplayCanvas) {
        // console.warn("摄像头显示画布不存在，无法绘制。");
        return;
    }

    // 保存当前绘图状态
    ctx.save();

    // 设置透明度
    ctx.globalAlpha = opacity;

    // 绘制摄像头画面到主画布的指定位置和大小
    ctx.drawImage(SystemState.videoDisplayCanvas, x, y, width, height);

    // 恢复绘图状态
    ctx.restore();
}

// --- 使用示例 (集成到你的现有流程中) ---

// 在 initCamera 函数成功后调用
// if (SystemState.cameraActive) {
//     initCameraDisplay();
// }

// 在 processCamera 函数的末尾调用 (确保在视频数据就绪时更新)
// updateCameraDisplay(); // 这会更新 SystemState.videoDisplayCanvas 的内容

// 在 render 函数中，在绘制 3D 内容 *之前* 或 *之后* 调用
// drawCameraFeedOnMainCanvas(SystemState.ctx, 10, 10, 160, 120, 0.6); // 例如，左上角显示小窗口
// ... (渲染 3D 点云) ...
// FlushBatchDraw equivalent for canvas (ctx.flush() or requestAnimationFrame)

// 注意:
// - 如果你想让摄像头画面作为背景，就在 render 3D 内容 *之前* 调用 drawCameraFeedOnMainCanvas。
// - 如果你想让摄像头画面叠加在 3D 内容之上，就在 render 3D 内容 *之后* 调用。
// - 通过调整 x, y, width, height, opacity 参数可以控制摄像头画面的显示效果。
// - `updateCameraDisplay` 负责获取视频帧，`drawCameraFeedOnMainCanvas` 负责将其绘制到主画布。
// - `initCameraDisplay` 只需在摄像头初始化成功后调用一次。

// ========================
// 17. 启动应用
// ========================
init().then(() => { // 等待 init 完成
    gameLoop(); // 启动主循环
}).catch(console.error);