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
    // 点云密度
    spherePoints: 1000,
    cubePoints: 2000
};

// ========================
// 2. 创建3D对象（立方体和球体）
// ========================
function createCube(size = 5, pointsPerFace = 100, x = 0, y = -30, z = 0, alpha = 0, ifEntity = false) {
    const points = [];
    const halfSize = size / 2;
    // 转换角度为弧度
    const rad = alpha * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    // 生成点的总数（根据是否填充内部调整）
    const totalPoints = ifEntity 
        ? pointsPerFace * 6 + pointsPerFace * 3 // 面 + 内部点
        : pointsPerFace * 6;

    for (let i = 0; i < pointsPerFace; i++) {
        // 生成立方体6个面的点
        // 前面 (z = +halfSize)
        addPoint(
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size,
            halfSize
        );
        
        // 后面 (z = -halfSize)
        addPoint(
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size,
            -halfSize
        );
        
        // 左面 (x = -halfSize)
        addPoint(
            -halfSize,
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size
        );
        
        // 右面 (x = +halfSize)
        addPoint(
            halfSize,
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size
        );
        
        // 上面 (y = +halfSize)
        addPoint(
            (Math.random() - 0.5) * size,
            halfSize,
            (Math.random() - 0.5) * size
        );
        
        // 下面 (y = -halfSize)
        addPoint(
            (Math.random() - 0.5) * size,
            -halfSize,
            (Math.random() - 0.5) * size
        );

        // 如果需要填充内部，添加内部随机点
        if (ifEntity) {
            addPoint(
                (Math.random() - 0.5) * size,
                (Math.random() - 0.5) * size,
                (Math.random() - 0.5) * size
            );
        }
    }

    // 辅助函数：添加点并应用旋转和位移
    function addPoint(px, py, pz) {
        // 绕Z轴旋转
        const rotatedX = px * cosA - py * sinA;
        const rotatedY = px * sinA + py * cosA;
        const rotatedZ = pz;

        // 应用位移
        const finalX = rotatedX + x;
        const finalY = rotatedY + y;
        const finalZ = rotatedZ + z;

        points.push(new Point(finalX, finalY, finalZ));
    }

    return new Object(points);
}
function createFace(size = 5, pointsPerFace = 100, x = 0, y = 0, z = 0, alpha = 0, ifEntity = false) {
    const points = [];
    const halfSize = size / 2;
    // 转换角度为弧度
    const rad = alpha * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    // 生成点的总数（根据是否填充内部调整）
    const totalPoints = ifEntity 
        ? pointsPerFace * 6 + pointsPerFace * 3 // 面 + 内部点
        : pointsPerFace * 6;

    for (let i = 0; i < pointsPerFace; i++) {
        // 生成立方体6个面的点
        const x0 = (Math.random() - 0.5) * 5 * size;
        const y0 = 0;
        const z0 = (Math.random() - 0.5) * 2 * size;
        const po = addPoint(x0, y0, z0);
        const pn = addPoint(x0, y0 - 1, z0);
        // 如果需要填充内部，添加内部随机点
        if (ifEntity) {
            addPoint(
                (Math.random() - 0.5) * size,
                (Math.random() - 0.5) * size,
                (Math.random() - 0.5) * size
            );
        }
        const p = new Point(po.finalX, po.finalY, po.finalZ);
        p.nx = pn.finalX - po.finalX;
        p.ny = pn.finalY - po.finalY;
        p.nz = pn.finalZ - po.finalZ;
        points.push(p);
        // points.push(new Point(pn.finalX, pn.finalY, pn.finalZ));
    }

    // 辅助函数：添加点并应用旋转和位移
    function addPoint(px, py, pz) {
        // 绕Z轴旋转
        const rotatedX = px * cosA - py * sinA;
        const rotatedY = px * sinA + py * cosA;
        const rotatedZ = pz;

        // 应用位移
        const finalX = rotatedX + x;
        const finalY = rotatedY + y;
        const finalZ = rotatedZ + z;
        return {finalX: finalX, finalY: finalY, finalZ: finalZ};
    }

    return new Object(points);
}
function createSphere(x0, y0, z0, radius = 1, numPoints = 50) {
    const points = [];
    
    // 生成球形点云
    for (let i = 0; i < numPoints; i++) {
        // 使用均匀分布的球坐标
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
    const points = [];
    
    points.push(new Point(0.1, -10, 1.3));
    points.push(new Point(0, -10, 1.2));
    points.push(new Point(0.1, -10, 1.1));
    points.push(new Point(0, -10, 1));
    
    return new Object(points);
}
function createLatitudeSphere(radius = 10, latitudeCount = 10, pointsPerCircle = 20) {
    const points = [];
    const latitudeStep = Math.PI / (latitudeCount + 1); // 纬度间隔（0到π）

    // 生成每个纬度圈
    for (let lat = 1; lat <= latitudeCount; lat++) {
        const theta = lat * latitudeStep; // 极角（0为北极，π为南极）
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const circleRadius = radius * sinTheta; // 该纬度圈的半径

        // 生成当前纬度圈上的点
        for (let i = 0; i < pointsPerCircle; i++) {
            const phi = (i / pointsPerCircle) * Math.PI * 2; // 方位角
            points.push(new Point(
                circleRadius * Math.cos(phi), // X坐标
                circleRadius * Math.sin(phi), // Y坐标
                radius * cosTheta             // Z坐标
            ));
        }
    }

    return new Object(points);
}
function createRectangleFace(pointsCount = 1000, rotationZ = 0, ys = 0) {
    const points = [];
    const rad = rotationZ * Math.PI / 180; // 角度转弧度
    const cosθ = Math.cos(rad);
    const sinθ = Math.sin(rad);

    // 四个角点原始坐标
    const corners = [
        {x: -2 + ys, y: 0 + ys, z: 8 + ys},  // 左上角
        {x: 2 + ys, y: 0 + ys, z: 8 + ys},   // 右上角
        {x: -2 + ys, y: 0 + ys, z: 0 + ys},  // 左下角
        {x: 2 + ys, y: 0 + ys, z: 0 + ys}    // 右下角
    ];

    // 绕Z轴旋转公式：X-Y平面内旋转，Z坐标不变
    const rotatePoint = (p) => {
        return {
            x: p.x * cosθ - p.y * sinθ,  // Z轴旋转影响X和Y
            y: p.x * sinθ + p.y * cosθ,
            z: p.z                       // Z坐标保持不变
        };
    };

    // 处理角点
    corners.forEach(corner => {
        const rotated = rotatePoint(corner);
        points.push(new Point(rotated.x, rotated.y, rotated.z));
    });

    // 生成面内随机点
    for (let i = 0; i < pointsCount; i++) {
        // 原始矩形范围内随机点（x: -2~2, z: 0~8，y固定0）
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

    // 生成经度圈（绕Z轴的圆）
    for (let lon = 0; lon < longitudeLines; lon++) {
        const lonAngle = (lon / longitudeLines) * twoPi; // 经度角（0到2π）
        const cosLon = Math.cos(lonAngle);
        const sinLon = Math.sin(lonAngle);

        // 每个经度圈上的点
        for (let i = 0; i < pointsPerLine; i++) {
            const latAngle = halfPi - (i / (pointsPerLine - 1)) * Math.PI; // 纬度角（π/2到-π/2）
            const cosLat = Math.cos(latAngle);
            const sinLat = Math.sin(latAngle);

            // 球面坐标转笛卡尔坐标
            const x = radius * cosLat * cosLon;
            const y = radius * cosLat * sinLon;
            const z = radius * sinLat;

            points.push(new Point(x, y, z));
        }
    }

    // 生成纬度圈（平行于赤道的圆）
    for (let lat = 1; lat < latitudeLines; lat++) {
        const latAngle = halfPi - (lat / latitudeLines) * Math.PI; // 排除南北极点
        const cosLat = Math.cos(latAngle);
        const sinLat = Math.sin(latAngle);
        const circleRadius = radius * cosLat; // 纬度圈半径

        // 每个纬度圈上的点
        for (let i = 0; i < pointsPerLine; i++) {
            const lonAngle = (i / (pointsPerLine - 1)) * twoPi; // 经度角（0到2π）
            const cosLon = Math.cos(lonAngle);
            const sinLon = Math.sin(lonAngle);

            // 球面坐标转笛卡尔坐标
            const x = circleRadius * cosLon;
            const y = circleRadius * sinLon;
            const z = radius * sinLat;

            points.push(new Point(x, y, z));
        }
    }

    return new Object(points);
}
// 创建示例对象
const objects = [
    // createSphere(5, CONFIG.spherePoints),
    // createRectangleFace(),
    // createRectangleFace(1000,0,2),
    // createSphereWithLines(),
    createCube(5, Math.floor(CONFIG.cubePoints), 0, 0, 0, 45, false)
];
const otherObjects = [
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
let lightAngle = 0;// Math.PI / 2;
let lightElevation = 0;//Math.PI / 6;
let lightRadius = 1;

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
    hiddenWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'hidden');
    
    // 创建光源窗口
    lightWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'light');
    // 创建主渲染窗口
    mainWindow = new Window(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm, 'main');
    mainWindow.direction = new Vector(0, 0, 0);
    mainWindow.direction.normalInit(0, 0, 0, 0, 1, 0);
    mainWindow.capital = mainWindow.direction.getPoint(-50);
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
    for (let index = 0; index < 1000; index++) {
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
        hiddenWindow.calculate(hiddenCamPos, 0, hiddenDir, objects, 0, otherObjects);
        // hiddenWindow.calculateNormal();
    }
    
    console.log("法向量估算完成");
}

// ========================
// 6. 光源更新
// ========================
function updateLight() {
    // 计算光源位置
    const lightX = lightRadius * Math.cos(lightElevation) * Math.cos(lightAngle);
    const lightY = lightRadius * Math.cos(lightElevation) * Math.sin(lightAngle);
    const lightZ = lightRadius * Math.sin(lightElevation);
    
    // 设置光源方向（指向原点）
    const lightDir = new Vector(0, 0, 0);
    lightDir.normalInit(lightX, lightY, lightZ, 0, 0, 0);
    
    // 光源位置（稍微后移）
    const lightCamPos = lightDir.getPoint(-5);
    // 计算反射光线
    lightWindow.calculate(lightCamPos, 0, lightDir, objects, 1.0, otherObjects);
    otherObjects.length = 0;
    otherObjects.push(createSphere(lightWindow.capital.x, lightWindow.capital.y, lightWindow.capital.z));
    
    return { lightX, lightY, lightZ };
}

// ========================
// 7. 更新相机位置
// ========================
function updateCamera() {
    // 计算相机位置（球坐标转笛卡尔坐标）
    // const camX = camRadius * Math.cos(camElevation) * Math.sin(camAngle);
    // const camY = camRadius * Math.cos(camElevation) * Math.cos(camAngle);
    // const camZ = camRadius * Math.sin(camElevation);
    
    // 设置视线方向（指向原点）

    // mainWindow.capital.x = Math.cos(camElevation) * Math.sin(camAngle) + ;
    // mainWindow.capital.y = Math.cos(camElevation) * Math.cos(camAngle);
    // mainWindow.capital.z = Math.sin(camElevation);
    // const mainDir = new Vector(0, 0, 0);
    // mainDir.normalInit(camX, camY, camZ, 0, 0, 0);
    
    // 相机位置（稍微后移）
    // const mainCamPos = mainWindow.direction.getPoint(-35);
    // 重新计算主视角投影（启用双眼模式）
    mainWindow.calculate(mainWindow.capital, CONFIG.eyeD, mainWindow.direction, objects, 0, otherObjects);
    
    // return { camX, camY, camZ, mainDir, mainCamPos };
}

// ========================
// 8. 渲染函数
// ========================
function render() {
    // 清空画布
    ctx.clearRect(0, 0, screenWidthPx, screenHeightPx);
    // 更新相机
    updateCamera();
    
    
    // 渲染红蓝点// 遍历 grid 二维数组（行方向）
    for (let gridX = 0; gridX < mainWindow.grid.length; gridX++) {
        // 遍历当前行的每个网格（列方向）
        for (let gridY = 0; gridY < mainWindow.grid[gridX].length; gridY++) {
            // 当前网格中的点集合（对应原 obj.points）
            const pointsInGrid = mainWindow.grid[gridX][gridY];
            
            // 遍历当前网格内的所有点
            for (const p of pointsInGrid) {
                if (Math.abs(p.xL - p.xR) > 0) {
                    // 左眼（红）：仅在坐标非0时绘制
                    if (p.xL !== 0 && p.yL !== 0) {
                        ctx.fillStyle = `hsl(0, 100%, ${p.light * 35}%)`;
                        ctx.fillRect(p.xL, p.yL, 1, 1);
                    }
                    // 右眼（蓝）：仅在坐标非0时绘制
                    if (p.xR !== 0 && p.yR !== 0) {
                        ctx.fillStyle = `hsl(240, 100%, ${p.light * 50}%)`;
                        ctx.fillRect(p.xR, p.yR, 1, 1);
                    }
                } else {
                    // 双眼坐标一致时（紫色）
                    ctx.fillStyle = `hsl(285, 90%, ${p.light * 50}%)`;
                    ctx.fillRect(p.xL, p.yL, 1, 1);
                }
            }
        }
    }
    
    // 更新调试信息
    updateLight();
    // debugDiv.textContent = 
    //     `相机: (${camX.toFixed(1)}, ${camY.toFixed(1)}, ${camZ.toFixed(1)}) | ` +
    //     `光源: (${lightPos.lightX.toFixed(1)}, ${lightPos.lightY.toFixed(1)}, ${lightPos.lightZ.toFixed(1)}) | ` +
    //     `距离: ${camRadius.toFixed(1)}`;
}

// ========================
// 9. 事件监听器设置
// ========================
function setupEventListeners() {
    // 键盘控制
    const keys = {};
    
    window.addEventListener('keydown', (e) => {
        if (e.key == 'Shift') {
            if (e.location == 1) {
                keys['shiftleft'] = true;
            } else {
                keys['shiftright'] = true;
            }
        } else {
            keys[e.key.toLowerCase()] = true;
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.key == 'Shift') {
            if (e.location == 1) {
                keys['shiftleft'] = false;
            } else {
                keys['shiftright'] = false;
            }
        } else {
            keys[e.key.toLowerCase()] = false;
        }
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
        mainWindow.update(screenWidthPx, screenHeightPx, CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
    });
    
    // 处理输入的主循环
    function handleInput() {
        const rotationSpeed = 0.05;
        const moveSpeed = 0.5;
        camAngle = 0;
        // if (keys['`'] || keys['1'] || keys['2'] || keys['3'] || keys['4'] || keys['5'] || keys['6'] || keys['7'] || keys['8'] || keys['9'] || keys['0'] || keys['-'] || keys['=']) {
        //     if (keys['`']) camAngle = Math.PI;
        //     if (keys['1']) camAngle = Math.PI * (5 / 6);
        //     if (keys['2']) camAngle = Math.PI * (2 / 3);
        //     if (keys['3']) camAngle = Math.PI * (1 / 2);
        //     if (keys['4']) camAngle = Math.PI * (1 / 3);
        //     if (keys['5']) camAngle = Math.PI / 6;
        //     if (keys['6']) camAngle = 0;
        //     if (keys['7']) camAngle = -Math.PI / 6;
        //     if (keys['8']) camAngle = -Math.PI * (1 / 3);
        //     if (keys['9']) camAngle = -Math.PI * (1 / 2);
        //     if (keys['0']) camAngle = -Math.PI * (2 / 3);
        //     if (keys['-']) camAngle = -Math.PI * (5 / 6);
        //     if (keys['=']) camAngle = -Math.PI;
        //     camAngle += mainWindow.dirAngle;
        //     mainWindow.direction.x = Math.cos(camElevation) * Math.sin(camAngle);
        //     mainWindow.direction.y = Math.cos(camElevation) * Math.cos(camAngle);
        //     mainWindow.direction.z = Math.sin(camElevation);
        // }

        // if (keys['shiftleft'] || keys['x'] || keys['c'] || keys['v'] || keys['b'] || keys['n'] || keys['m'] || keys[','] || keys['.'] || keys['/'] || keys['shiftright']) {
        //     if (keys['shiftleft']) camAngle = Math.PI * (5 / 10);
        //     if (keys['z']) camAngle = -Math.PI * (4 / 20);
        //     if (keys['x']) camAngle = -Math.PI * (3 / 20);
        //     if (keys['c']) camAngle = -Math.PI * (2 / 20);
        //     if (keys['v']) camAngle = -Math.PI * (1 / 20);
        //     if (keys['b']) camAngle = 0;
        //     if (keys['n']) camAngle = Math.PI * (1 / 20);
        //     if (keys['m']) camAngle = Math.PI * (2 / 20);
        //     if (keys[',']) camAngle = Math.PI * (3 / 20);
        //     if (keys['.']) camAngle = Math.PI * (4 / 20);
        //     if (keys['/']) camAngle = Math.PI * (5 / 20);
            
        //     camAngle += mainWindow.dirAngle;
        //     const hcd = mainWindow.capital.getD(mainWindow.direction.start);
        //     mainWindow.direction.start.x = hcd * Math.cos(camElevation) * Math.sin(camAngle) + mainWindow.capital.x;
        //     mainWindow.direction.start.y = hcd * Math.cos(camElevation) * Math.cos(camAngle) + mainWindow.capital.y;
        //     mainWindow.direction.start.z = hcd * Math.sin(camElevation) + mainWindow.capital.z;
        //     mainWindow.direction.x = Math.cos(camElevation) * Math.sin(camAngle);
        //     mainWindow.direction.y = Math.cos(camElevation) * Math.cos(camAngle);
        //     mainWindow.direction.z = Math.sin(camElevation);
        //     // if (keys['shiftright']) camDir = -Math.PI * (1 / 2);
        // }
        // WASD 控制相机旋转
        if (keys['z']) camAngle = -0.04;
        if (keys['x']) camAngle = -0.02;
        if (keys['c']) camAngle = -0.01;
        if (keys['v']) camAngle = 0;
        if (keys['b']) camAngle = 0.01;
        if (keys['n']) camAngle = 0.02;
        if (keys['m']) camAngle = 0.04;
        mainWindow.horizontalRotation(camAngle);
        // if (keys['arrowleft'] || keys['arrowright'] || keys['arrowup'] || keys['arrowdown']) {
        //     if (keys['arrowleft']) camAngle = -rotationSpeed; // 左转
        //     if (keys['arrowright']) camAngle = rotationSpeed; // 右转
        //     mainWindow.horizontalRotation(camAngle);
        // }
        // // Q/E 控制相机距离
        // if (keys['q']) camRadius = Math.max(5, camRadius - moveSpeed); // 靠近
        // if (keys['e']) camRadius = Math.min(100, camRadius + moveSpeed); // 远离
        
        // // 方向键控制光源
        // if (keys['arrowleft']) lightAngle -= rotationSpeed;
        // if (keys['arrowright']) lightAngle += rotationSpeed;
        // if (keys['arrowup']) lightElevation = Math.min(Math.PI/2 - 0.1, lightElevation + rotationSpeed);
        // if (keys['arrowdown']) lightElevation = Math.max(-Math.PI/2 + 0.1, lightElevation - rotationSpeed);
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