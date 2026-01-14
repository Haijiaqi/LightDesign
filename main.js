import { Window } from "./base/Window.js";
import { Object } from "./base/Object.js";
import { Point } from "./base/Point.js";
import { Vector } from "./base/Vector.js";
import { Classifier } from "./math/Classifier.js";
import { StyleImpl } from "./manage/StyleImpl.js";
import { AnimationImpl } from "./manage/AnimationImpl.js";

// ========================
// 1. 配置参数（预留接口）
// ========================
const CONFIG = {
  // 显示器物理尺寸（厘米）
  screenXLengthCm: 31.0,
  screenYLengthCm: 17.4,
  screenWidth: 1920,
  screenHeight: 1080,
  // 双眼瞳距（厘米）
  eyeD: 6.3,

  // ========== 阶段1修改：用户/场景布置 ==========
  // 显示模式: '3D_LR'(左红右蓝), '3D_RL'(左蓝右红), '2D'(纯2D紫色)
  displayMode: '3D_LR',
  // 坐标系布置（厘米）：
  // - 旋转中心 = 原点 (0, 0, 0)
  // - 双眼在 +Y 方向，距原点 userDistanceFromOrigin
  // - 屏幕在 +Y 方向，距原点 screenDistance
  userEyeHeight: 8.7,              // Z 高度（人眼高度，约屏幕上边）
  screenCenterHeight: 0,           // 视窗中心 Z 高度（可独立设置）
  userDistanceFromOrigin: 10,      // 双眼到旋转中心距离
  screenDistance: 50,              // 屏幕到旋转中心距离
  // =============================================

  // 光源初始位置（可参数化，后期支持操作移动）
  lightX: 5,
  lightY: 15,
  lightZ: 0,  // 光源高度 0cm
  // 点云密度
  spherePoints: 1000,
  cubePoints: 250,
  // 渲染和控制参数
  rotationSpeed: 0.05,
  moveSpeed: 0.5,
  minElevation: -Math.PI / 2 + 0.1,
  maxElevation: Math.PI / 2 - 0.1,
  // 拖拽旋转灵敏度
  dragRotationSpeed: 0.01,
  // 隐藏窗口估算次数
  normalEstimationIterations: 500,
  normalEstimationRadius: 15,
  // 摄像头控制参数
  cameraControl: {
    enabled: false, // 默认关闭摄像头控制
    sensitivity: 0.005, // 控制灵敏度
    targetHue: 0, // 目标颜色的色调 (0=红, 120=绿, 240=蓝)
    targetHueTolerance: 30, // 色调容差
    targetSaturation: 0.7, // 最小饱和度
    targetValue: 0.5, // 最小亮度
    minArea: 50, // 最小识别面积 (像素^2)
    maxArea: 10000, // 最大识别面积 (像素^2)
    smoothingFactor: 0.1, // 位置平滑因子 (0-1, 1=无平滑)
  },
};


// ========================
// 2. 对象创建函数
// ========================
function createCube(
  size = 5,
  pointsPerFace = 100,
  x = 0,
  y = -30,
  z = 0,
  alpha = 0,
  ifEntity = false,
) {
  const points = [];
  const halfSize = size / 2;
  const rad = (alpha * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const faceGenerators = [
    () => ({
      x: (Math.random() - 0.5) * size,
      y: (Math.random() - 0.5) * size,
      z: halfSize,
    }), // 前
    () => ({
      x: (Math.random() - 0.5) * size,
      y: (Math.random() - 0.5) * size,
      z: -halfSize,
    }), // 后
    () => ({
      x: -halfSize,
      y: (Math.random() - 0.5) * size,
      z: (Math.random() - 0.5) * size,
    }), // 左
    () => ({
      x: halfSize,
      y: (Math.random() - 0.5) * size,
      z: (Math.random() - 0.5) * size,
    }), // 右
    () => ({
      x: (Math.random() - 0.5) * size,
      y: halfSize,
      z: (Math.random() - 0.5) * size,
    }), // 上
    () => ({
      x: (Math.random() - 0.5) * size,
      y: -halfSize,
      z: (Math.random() - 0.5) * size,
    }), // 下
  ];

  for (let i = 0; i < pointsPerFace; i++) {
    faceGenerators.forEach((gen) => {
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
  // 计算初始 frontDirection（默认朝向 -Y，即(0,-1,0)）
  // 因为 createCube 创建时绕 Z 轴旋转了 alpha 度
  // 原 front (0,-1,0) 绕 Z 轴旋转 alpha：
  // x' = 0*cos - (-1)*sin = sin(alpha)
  // y' = 0*sin + (-1)*cos = -cos(alpha)
  // z' = 0
  const frontX = Math.sin(rad);
  const frontY = -Math.cos(rad);
  const frontZ = 0;

  // 显式传入 center（避免 automatic averaging）
  // 对于立方体，中心即为传入的 {x,y,z}
  return new Object(points, {
    frontDirection: { x: frontX, y: frontY, z: frontZ },
    center: { x, y, z }
  });
}
function createPlane(
  width = 20,
  height = 10,
  pointsPerFace = 10000,
  x = 0,
  y = 0,
  z = 0,
  alpha = 5,
  ifEntity = false,
) {
  const points = [];
  const halfWidth = width / 2; // 宽度半值（X方向范围）
  const halfHeight = height / 2; // 高度半值（Z方向范围）
  const rad = (alpha * Math.PI) / 180; // 角度转弧度
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
    const nx = 0 * cosA - -1 * sinA; // 原法向量(0,-1,0)旋转后x分量
    const ny = 0 * sinA + -1 * cosA; // 原法向量(0,-1,0)旋转后y分量
    const nz = 0; // Z分量不变

    const p = new Point(rotatedX + x, rotatedY + y, rotatedZ + z);
    p.nx = nx;
    p.ny = ny;
    p.nz = nz;
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
function createSphere(x0, y0, z0, radius = 5, numPoints = 5000) {
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
  // 传递明确的 center 坐标，使物心位置为创建时的坐标
  return new Object(points, { center: { x: x0, y: y0, z: z0 } });
}

function createSphereWithMeridians(
  x0,
  y0,
  z0,
  radius = 2.5,
  numMeridians = 12,     // 每组大圆的数量（实际每组只有1个，但可旋转生成多个）
  pointsPerCircle = 50
) {
  const points = [];

  // 1. XY 平面大圆（绕Z轴）及其旋转副本
  const angleStep = (2 * Math.PI) / numMeridians;
  for (let i = 0; i < numMeridians; i++) {
    const angle = i * angleStep;
    for (let p = 0; p <= pointsPerCircle; p++) {
      const theta = (p / pointsPerCircle) * 2 * Math.PI;
      // 基础圆在 XY 平面
      let x = radius * Math.cos(theta);
      let y = radius * Math.sin(theta);
      let z = 0;
      // 绕 Z 轴旋转 angle（其实不需要，因为XY平面圆绕Z轴旋转还是自己）
      // 但为了生成多条，我们可以绕其他轴旋转这个圆
      // 更好的方式：直接生成三个坐标平面的圆

      // 实际上，我们只需要三个正交圆，然后可以旋转它们
    }
  }

  // 更简单：直接生成三个正交大圆
  // 圆1: XY平面 (z=z0)
  for (let p = 0; p <= pointsPerCircle; p++) {
    const theta = (p / pointsPerCircle) * 2 * Math.PI;
    points.push(new Point(
      x0 + radius * Math.cos(theta),
      y0 + radius * Math.sin(theta),
      z0
    ));
  }

  // 圆2: XZ平面 (y=y0)
  for (let p = 0; p <= pointsPerCircle; p++) {
    const theta = (p / pointsPerCircle) * 2 * Math.PI;
    points.push(new Point(
      x0 + radius * Math.cos(theta),
      y0,
      z0 + radius * Math.sin(theta)
    ));
  }

  // 圆3: YZ平面 (x=x0)
  for (let p = 0; p <= pointsPerCircle; p++) {
    const theta = (p / pointsPerCircle) * 2 * Math.PI;
    points.push(new Point(
      x0,
      y0 + radius * Math.cos(theta),
      z0 + radius * Math.sin(theta)
    ));
  }

  return new Object(points, { center: { x: x0, y: y0, z: z0 } });
}

/**
 * 创建世界格网（以原点为球心的整数格点）
 * @param {number} spacing - 格点间距（厘米），默认 10
 * @param {number} radius - 球形范围半径（厘米），默认 100
 * @returns {Object} 世界格网 Object
 */
function createWorldGrid(spacing = 10, radius = 100) {
  const points = [];

  // 确保格点坐标是 spacing 的整数倍（包含原点）
  const minBound = Math.ceil(-radius / spacing) * spacing;
  const maxBound = Math.floor(radius / spacing) * spacing;

  for (let x = minBound; x <= maxBound; x += spacing) {
    for (let y = minBound; y <= maxBound; y += spacing) {
      for (let z = minBound; z <= maxBound; z += spacing) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        if (dist <= radius) {
          const p = new Point(x, y, z);
          p.isAttractable = true;   // 可被吸附
          p.isGridPoint = true;     // 标记为世界格点
          p.light = 0.3;            // 较暗的固定亮度
          points.push(p);
        }
      }
    }
  }

  const grid = new Object([]);  // 传入空数组，避免属性丢失
  grid.isWorldGrid = true;
  grid.centerPoint = null;  // 世界格网不需要物心

  // 直接设置 displayPoints，保留所有自定义属性
  grid.displayPoints = points;

  return grid;
}

// ========================
// 3. 系统状态管理
// ========================

/**
 * 创建全整数坐标的网格对象（表面点）
 * @param {number} cx - 中心 X
 * @param {number} cy - 中心 Y
 * @param {number} cz - 中心 Z
 * @param {number} size - 边长点数
 * @param {number} spacing - 间距
 */
function createIntegerGridObject(cx, cy, cz, size = 6, spacing = 1) {
  const points = [];
  // 范围：[-size/2, size/2]
  // 对于 size=5: -2 到 2 (中心 0)
  // 对于 size=6: -3 到 2 (中心 -0.5)
  const startOffset = -Math.floor(size / 2);
  const endOffset = startOffset + size - 1;

  for (let ix = startOffset; ix <= endOffset; ix++) {
    for (let iy = startOffset; iy <= endOffset; iy++) {
      for (let iz = startOffset; iz <= endOffset; iz++) {
        // 判断是否为表面点
        const isSurface = (
          ix === startOffset || ix === endOffset ||
          iy === startOffset || iy === endOffset ||
          iz === startOffset || iz === endOffset
        );

        if (isSurface) {
          const x = cx + ix * spacing;
          const y = cy + iy * spacing;
          const z = cz + iz * spacing;

          const p = new Point(x, y, z);
          p.isAttractable = false; // 不可吸附
          // p.tag = 'CONTROL_GRID'; // 可选：添加特定标签
          points.push(p);
        }
      }
    }
  }

  return new Object(points, {
    center: { x: cx, y: cy, z: cz },
    frontDirection: { x: 0, y: -1, z: 0 },
    upDirection: { x: 0, y: 0, z: 1 },
    name: 'IntegerGrid'
  });
}

/**
 * 创建测试场景物体
 * 物体位于屏幕附近（Y ≈ screenDistance）
 */
function createTestScene() {
  return [
    createSphere(0, 50, 0, 3, 2000),     // 屏幕处主球（固定于 Y=50）
    createCube(5, 100, -10, 50, 0, 0),    // 正六面体（边长5cm，固定于 Y=50）
    createIntegerGridObject(10, 50, 0, 5, 1), // 新增：5x5x5 整数网格，位于 (10, 50, 0)
  ];
}

const SystemState = {
  ifControl: true,
  // 对象列表
  objects: createTestScene(),
  otherObjects: [], // 例如光源点

  // ========== 阶段 3B 新增 ==========
  screenPoints: [],  // 屏幕空间点数组（用于 UI 元素）
  // ==================================

  // 窗口实例
  hiddenWindow: null,
  lightWindow: null,
  mainWindow: null,

  // 旋转中心（阶段1新增）
  rotationCenter: null,

  // 鼠标拖拽状态
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,

  // 键盘状态
  keys: {},

  // 鼠标边缘状态（阶段1新增）
  mouseEdge: 0,  // -1=左边缘, 0=中间, 1=右边缘

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
  smoothingListX: [],

  // ========== 阶段 5 新增：任务队列 ==========
  taskQueues: {
    current: [],  // 当前帧正在执行的任务
    next: [],     // 下一帧待执行的任务

    /**
     * 交换队列：将 next 移到 current，清空 next
     */
    swap() {
      this.current = this.next;
      this.next = [];
    },

    /**
     * 提交新任务到队列
     * @param {Object} task - AnimationImpl.createTask() 返回的任务对象
     */
    submit(task) {
      this.next.push(task);
    },

    /**
     * 取消指定任务
     * @param {string} taskId - 任务 ID
     */
    cancel(taskId) {
      const findAndCancel = (arr) => {
        const task = arr.find(t => t.id === taskId);
        if (task) task._cancelled = true;
      };
      findAndCancel(this.current);
      findAndCancel(this.next);
    }
  },

  // 时间管理
  worldTime: 0,       // 世界时间（毫秒）
  lastTimestamp: 0,   // 上一帧时间戳
  // ===========================================

  // ========== 阶段 8 新增：状态机 ==========
  interactionState: 'VIEW',  // 交互状态：'VIEW' | 'FOCUS' | 'EDIT'
  focusedObject: null,       // 当前聚焦的物体（仅 FOCUS/EDIT 态有效）
  // =========================================

  // ========== 阶段 11B 新增 ==========
  focusSliceDepth: 0,  // 截面深度，相对物心距离
  focusVirtualMouseDepth: 0,  // FOCUS态虚拟鼠标深度，相对屏幕平面的距离（正值离用户更远）
  debugCenterPoint: false,  // 调试标志：输出 centerPoint 屏幕坐标（默认关闭）
  // ===================================

  // ========== 阶段 13 新增：蓄力系统 ==========
  isCharging: false,         // 是否正在蓄力
  chargeStartTime: 0,        // 蓄力开始时间戳
  chargePosition: { x: 0, y: 0 },  // 蓄力位置（屏幕坐标）
  chargeHitPoint: null,      // 蓄力命中的点（用于冲量应用）
  // ============================================

  // ========== 阶段 16 新增：EDIT 态变量 ==========
  editDepthLayer: 0,           // 当前编辑的深度层
  draggedControlPoint: null,   // 正在拖动的控制点
  longPressTimer: null,        // 长按计时器
  longPressTarget: null,       // 长按目标
  // ==============================================

  // ========== 整饬新增：对数速度系统 ==========
  velocityState: {
    rotation: { current: 0, target: 0, factor: 0 },    // 旋转速度
    moveForward: { current: 0, target: 0, factor: 0 }, // 前后移动速度
  },
  // =============================================

  // ========== FOCUS 态边缘旋转状态 ==========
  focusRotationState: {
    edgeStartTime: 0,       // 进入边缘的时间戳
    isAtEdge: false,        // 当前是否在边缘
    edgeDirection: { h: 0, v: 0 }  // 边缘方向: h=水平(-1左,1右), v=垂直(-1上,1下)
  },
  // ==========================================

  // ========== 世界格网与虚拟鼠标 ==========
  worldGrid: null,  // 世界格网 Object
  virtualMouse: {
    enabled: true,                // 是否启用
    screenPosition: { x: 0, y: 0 },
    snappedTo: null,              // 吸附到的点引用
  },
  // ========================================

  // ========== VIEW 态物体拖拽 ==========
  draggingObject: null,      // 正在拖拽的物体
  dragStartCenter: null,     // 拖拽开始时物心位置
  // ========================================
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
    SystemState.video = document.createElement("video");
    SystemState.video.srcObject = stream;
    SystemState.video.play();
    SystemState.video.style.display = "none"; // 隐藏视频元素
    document.body.appendChild(SystemState.video);

    // 创建用于处理视频帧的 canvas
    SystemState.videoCanvas = document.createElement("canvas");
    SystemState.videoCtx = SystemState.videoCanvas.getContext("2d");

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
    console.log(
      "摄像头未激活，跳过处理。SystemState.cameraActive =",
      SystemState.cameraActive,
    );
    console.groupEnd(); // 结束日志组
    return;
  }
  if (!CONFIG.cameraControl.enabled) {
    console.log(
      "摄像头控制在配置中被禁用，跳过处理。CONFIG.cameraControl.enabled =",
      CONFIG.cameraControl.enabled,
    );
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
    const headDis = processQueue(
      SystemState.smoothingListDis,
      res.estimateDis,
      3,
      0.4,
    );
    let headHeight = processQueue(
      SystemState.smoothingListHeight,
      res.headHeight,
      3,
      0.4,
    );
    let headX = processQueue(SystemState.smoothingListX, res.headX, 3, 0.4);
    headHeight =
      ((0.5 - headHeight) / 0.5 / 1.732) * headDis +
      SystemState.mainWindow.ylength / 2;
    if (Math.abs(headX - 0.5) > 0.25) {
      headX = 0;
    } else {
      headX = ((0.5 - headX) / 0.25 / 1.732) * headDis;
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
async function init() {
  // 改为 async
  // 创建 DOM 元素
  SystemState.canvas = document.createElement("canvas");
  SystemState.ctx = SystemState.canvas.getContext("2d");
  SystemState.debugDiv =
    document.getElementById("debug") || document.createElement("div");
  SystemState.debugDiv.id = "debug";
  if (!document.getElementById("debug")) {
    document.body.appendChild(SystemState.debugDiv);
  }

  // 设置画布大小
  resizeCanvas();

  // 创建窗口实例
  SystemState.hiddenWindow = new Window(
    SystemState.screenWidthPx,
    SystemState.screenHeightPx,
    CONFIG.screenXLengthCm,
    CONFIG.screenYLengthCm,
    "hidden",
  );
  SystemState.lightWindow = new Window(
    SystemState.screenWidthPx,
    SystemState.screenHeightPx,
    CONFIG.screenXLengthCm,
    CONFIG.screenYLengthCm,
    "light",
  );
  SystemState.mainWindow = new Window(
    window.innerWidth,
    window.innerHeight,
    (window.innerWidth / CONFIG.screenWidth) * CONFIG.screenXLengthCm,
    (window.innerHeight / CONFIG.screenHeight) * CONFIG.screenYLengthCm,
    "main",
  );


  // 1. 设置视窗距离为 1 倍显示器宽度 (User <-> Screen)
  const displayWidth = CONFIG.screenXLengthCm;
  // 视屏距离 = 1.0 * 宽度
  const eyeToScreenDist = 1.0 * displayWidth;
  // 屏幕位置 = 人眼位置 + 视屏距离
  CONFIG.screenDistance = CONFIG.userDistanceFromOrigin + eyeToScreenDist;

  // ========== 阶段1修改：用户初始位置 ==========
  const eyeZ = CONFIG.userEyeHeight;
  const screenZ = CONFIG.screenCenterHeight;  // 视窗中心高度（独立于人眼高度）

  // 旋转中心 = 原点（高度为视窗中心高度）
  SystemState.rotationCenter = new Point(0, 0, screenZ);

  // 双眼位置 = 原点向 +Y 方向偏移，高度为人眼高度
  SystemState.mainWindow.capital = new Point(0, CONFIG.userDistanceFromOrigin, eyeZ);

  // 视线方向：从双眼指向屏幕（+Y 方向）
  // direction.start = 屏幕参考点（屏幕平面上的锚点，高度为视窗中心高度）
  // 视窗法向量 = (0, 1, 0)，视窗平面与 Y 轴垂直（是 XZ 平面），与 XY 平面（水平面）垂直
  SystemState.mainWindow.direction = new Vector(0, 0, 0);
  SystemState.mainWindow.direction.normalInit(
    0, CONFIG.screenDistance, screenZ,      // 起点 = 屏幕位置（高度为视窗中心）
    0, CONFIG.screenDistance + 1, screenZ   // 方向 = +Y（视窗法向量指向 +Y，视窗平面垂直站立）
  );
  // 结果：direction.start = (0, 50, 0)，direction = (0, 1, 0)
  // 视窗初始朝向 +Y，视窗平面与 XY 平面垂直
  // =============================================




  // 估算法向量
  estimateNormals();

  // 计算初始光源
  updateLight();

  // 2. 创建世界格网 (半径 = 2 倍显示器宽度)
  SystemState.worldGrid = createWorldGrid(10, displayWidth * 2);

  // 3. 初始化移动限制 (保存初始位置)
  SystemState.movementConstraints = {
    initialY: CONFIG.userDistanceFromOrigin, // 人眼初始 Y
    range: 0.5 * displayWidth                // 限制范围 +/- 0.5 Width
  };
  SystemState.objects.push(SystemState.worldGrid);
  console.log("世界格网已创建，格点数:", SystemState.worldGrid.displayPoints.length);

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
    SystemState.hiddenWindow.calculate(
      hiddenCamPos,
      0,
      hiddenDir,
      SystemState.objects,
      0,
      SystemState.otherObjects,
    );
  }
  console.log("法向量估算完成");
}

// ========================
// 8. 光源更新
// ========================
function updateLight() {
  const eyeZ = CONFIG.userEyeHeight;
  const targetY = CONFIG.screenDistance;  // 光照目标：物体所在位置

  // 光源位置（使用 CONFIG 参数）
  const lightX = CONFIG.lightX;
  const lightY = CONFIG.lightY;
  const lightZ = CONFIG.lightZ;

  const lightDir = new Vector(0, 0, 0);
  // 光源从光源位置指向物体中心（0, targetY, eyeZ）
  lightDir.normalInit(lightX, lightY, lightZ, 0, targetY, eyeZ);
  const lightCamPos = lightDir.getPoint(-5);

  SystemState.lightWindow.calculate(
    lightCamPos,
    0,
    lightDir,
    SystemState.objects,
    1.0,
    SystemState.otherObjects,
  );
  SystemState.otherObjects.length = 0;
  // 光源小球放在实际光源位置
  SystemState.otherObjects.push(
    createSphere(lightX, lightY, lightZ, 0.5, 20),
  );
}

// ========================
// 9. 相机更新
// ========================
function updateCamera() {
  SystemState.mainWindow.calculate(
    SystemState.mainWindow.capital,
    CONFIG.eyeD,
    SystemState.mainWindow.direction,
    SystemState.objects,
    0,
    SystemState.otherObjects,
  );

  // 调试：验证 centerPoint 的屏幕坐标
  if (SystemState.debugCenterPoint) {
    const obj = SystemState.objects[0];
    if (obj && obj.centerPoint) {
      const cp = obj.centerPoint;
      console.log(`centerPoint 屏幕坐标: xM=${cp.xM?.toFixed(1)}, yM=${cp.yM?.toFixed(1)}, isObjectCenter=${cp.isObjectCenter}`);
    }
  }
}

// ========================
// 10. 渲染函数（基于putImageData批量绘图优化，支持邻接点绘制规则）
// ========================
// 阶段 3A：颜色 LUT 从 StyleImpl 获取
const COLOR_LUT = StyleImpl.getLUT();

// 2. 优化后的渲染函数
// 优化后的渲染函数（使用抽象子函数）
function render() {
  const ctx = SystemState.ctx;
  const { screenWidthPx: width, screenHeightPx: height } = SystemState;

  // 1. 初始化ImageData（批量像素容器）
  const imageData = ctx.createImageData(width, height);
  const pixelData = imageData.data; // RGBA数组：[R, G, B, A]，A固定255（不透明）

  updateCamera();

  // 2. 邻接点生成工具函数（提取为独立函数，避免子函数嵌套）
  function getNeighbors(x, y, light) {
    const neighbors = [];
    // 规则1：light∈(0.6, 1] → 8邻接
    if (light <= 1 && light > 0.6) {
      neighbors.push(
        { nx: x, ny: y - 1, ratio: 0.707 },
        { nx: x, ny: y + 1, ratio: 0.707 },
        { nx: x - 1, ny: y, ratio: 0.707 },
        { nx: x + 1, ny: y, ratio: 0.707 },
        { nx: x - 1, ny: y - 1, ratio: 0.4 },
        { nx: x + 1, ny: y - 1, ratio: 0.4 },
        { nx: x - 1, ny: y + 1, ratio: 0.4 },
        { nx: x + 1, ny: y + 1, ratio: 0.4 },
      );
    }
    // 规则2：light∈(0.3, 0.6] → 8邻接（原逻辑中ratio未用light计算，保持一致）
    else if (light <= 0.6 && light > 0.3) {
      neighbors.push(
        { nx: x, ny: y - 1, ratio: 0.707 },
        { nx: x, ny: y + 1, ratio: 0.707 },
        { nx: x - 1, ny: y, ratio: 0.707 },
        { nx: x + 1, ny: y, ratio: 0.707 },
        { nx: x - 1, ny: y - 1, ratio: 0.4 },
        { nx: x + 1, ny: y - 1, ratio: 0.4 },
        { nx: x - 1, ny: y + 1, ratio: 0.4 },
        { nx: x + 1, ny: y + 1, ratio: 0.4 },
      );
    }
    // 规则3：light≤0.3 → 无邻接
    return neighbors;
  }
  function drawColoredPoints(params) {
    const {
      colorType,
      x,
      y,
      light,
      baseLight,
      maxLutIndex,
      pixelData,
      width,
      height,
      getNeighbors,
    } = params;

    // 1. 跳过无效坐标（x/y为0或超出画布范围）
    if (x === 0 || y === 0 || x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }

    // 2. 计算主点亮度与颜色（复用原逻辑：亮度=light*baseLight，索引限制在[0, maxLutIndex]）
    const mainBrightnessVal = light * baseLight;
    const mainLutIndex = Math.max(
      0,
      Math.min(maxLutIndex, Math.round(mainBrightnessVal * 10)),
    );
    const [rMain, gMain, bMain] = COLOR_LUT[colorType][mainLutIndex] || [
      0, 0, 0,
    ];

    // 3. 绘制主点像素
    const mainPixelIdx = (y * width + x) * 4;
    pixelData[mainPixelIdx] = rMain; // R通道
    pixelData[mainPixelIdx + 1] = gMain; // G通道
    pixelData[mainPixelIdx + 2] = bMain; // B通道
    pixelData[mainPixelIdx + 3] = 255; // A通道（不透明）

    // 4. 计算并绘制邻接点
    const neighbors = getNeighbors(x, y, light);
    for (const nb of neighbors) {
      const { nx: neighborX, ny: neighborY, ratio } = nb;
      // 跳过邻接点无效坐标
      if (
        neighborX < 0 ||
        neighborX >= width ||
        neighborY < 0 ||
        neighborY >= height
      ) {
        continue;
      }
      // 计算邻接点亮度与颜色（复用原逻辑：亮度=light*baseLight*ratio）
      const nbBrightnessVal = light * baseLight * ratio;
      const nbLutIndex = Math.max(
        0,
        Math.min(maxLutIndex, Math.round(nbBrightnessVal * 10)),
      );
      const [rNb, gNb, bNb] = COLOR_LUT[colorType][nbLutIndex] || [0, 0, 0];

      // 绘制邻接点像素
      const nbPixelIdx = (neighborY * width + neighborX) * 4;
      pixelData[nbPixelIdx] = rNb;
      pixelData[nbPixelIdx + 1] = gNb;
      pixelData[nbPixelIdx + 2] = bNb;
      pixelData[nbPixelIdx + 3] = 255;
    }
  }
  function drawNonAdjacentPoints(params) {
    const {
      colorType,
      x,
      y,
      light,
      baseLight,
      maxLutIndex,
      pixelData,
      width,
      height,
      // 保留参数结构，但不使用邻接相关逻辑
      getNeighbors,
    } = params;

    // 1. 跳过无效坐标（同原逻辑：过滤边界外坐标）
    if (x === 0 || y === 0 || x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }

    // 2. 计算主点亮度与颜色（复用原逻辑，仅处理主点）
    const mainBrightnessVal = light * baseLight;
    const mainLutIndex = Math.max(
      0,
      Math.min(maxLutIndex, Math.round(mainBrightnessVal * 10)),
    );
    const [rMain, gMain, bMain] = COLOR_LUT[colorType][mainLutIndex] || [0, 0, 0];

    // 3. 仅绘制主点像素（移除所有邻接像素绘制逻辑）
    const mainPixelIdx = (y * width + x) * 4;
    pixelData[mainPixelIdx] = rMain; // R通道
    pixelData[mainPixelIdx + 1] = gMain; // G通道
    pixelData[mainPixelIdx + 2] = bMain; // B通道
    pixelData[mainPixelIdx + 3] = 255; // A通道（不透明）
  }

  for (let index = 0; index < SystemState.mainWindow.windowObjects.length; index++) {
    const element = SystemState.mainWindow.windowObjects[index];
    // 阶段1修改：优先使用 displayPoints，回退到 constructionPoints
    const renderPoints = (element.displayPoints && element.displayPoints.length > 0)
      ? element.displayPoints
      : element.constructionPoints;
    if (!renderPoints || renderPoints.length === 0) continue;
    for (let i = 0; i < renderPoints.length; i++) {
      const p = renderPoints[i];
      const commonParams = {
        light: p.light,
        pixelData,
        width,
        height,
        getNeighbors,
      };
      if (p.xM !== 0 && p.yM !== 0) {
        // 合并first为true/false的重复逻辑
        drawNonAdjacentPoints({
          ...commonParams,
          colorType: "purple",
          x: p.xM,
          y: p.yM,
          baseLight: 50,
          maxLutIndex: 350,
        });
      }
    }
  }
  // 3. 遍历所有网格点（主循环）
  for (let gridX = 0; gridX < SystemState.mainWindow.grid.length; gridX++) {
    const gridCol = SystemState.mainWindow.grid[gridX];
    for (let gridY = 0; gridY < gridCol.length; gridY++) {
      const pointsInGrid = gridCol[gridY];
      for (const p of pointsInGrid) {
        // 公共参数：所有点渲染都需要的基础参数（复用，减少重复传参）
        const commonParams = {
          light: p.light,
          pixelData,
          width,
          height,
          getNeighbors,
        };

        // ========== 整饬新增：CONTROL tag 特殊渲染 ==========
        if (p.tag === 'CONTROL') {
          // 控制点使用白色高亮 3x3 像素
          const cx = Math.floor(p.xM);
          const cy = Math.floor(p.yM);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const px = cx + dx;
              const py = cy + dy;
              if (px < 0 || px >= width || py < 0 || py >= height) continue;
              const idx = (py * width + px) * 4;
              pixelData[idx] = 255;       // R
              pixelData[idx + 1] = 255;   // G
              pixelData[idx + 2] = 255;   // B
              pixelData[idx + 3] = 255;   // A
            }
          }
          continue;  // 跳过正常渲染
        }
        // =====================================================

        // ========== 阶段1新增：显示模式判断 ==========
        if (CONFIG.displayMode === '2D') {
          // 纯2D模式：使用 xM/yM，紫色
          if (p.xM !== 0 && p.yM !== 0) {
            drawColoredPoints({
              ...commonParams,
              colorType: "purple",
              x: p.xM,
              y: p.yM,
              baseLight: 50,
              maxLutIndex: 500,
            });
          }
        } else {
          // 3D模式：根据 displayMode 决定左右眼颜色
          const isLR = CONFIG.displayMode === '3D_LR';
          const leftColor = isLR ? 'red' : 'blue';
          const rightColor = isLR ? 'blue' : 'red';
          const leftBaseLight = isLR ? 35 : 50;
          const rightBaseLight = isLR ? 50 : 35;
          const leftMaxLut = isLR ? 350 : 500;
          const rightMaxLut = isLR ? 500 : 350;

          // --------------------------
          // 处理立体点（有左右眼差异）
          // --------------------------
          if (Math.abs(p.xL - p.xR) > 0) {
            const first = p.xL % 2 === 0;

            // ① 左眼点
            if (first && p.xL !== 0 && p.yL !== 0) {
              drawColoredPoints({
                ...commonParams,
                colorType: leftColor,
                x: p.xL,
                y: p.yL,
                baseLight: leftBaseLight,
                maxLutIndex: leftMaxLut,
              });
            }

            // ② 右眼点
            if (p.xR !== 0 && p.yR !== 0) {
              drawColoredPoints({
                ...commonParams,
                colorType: rightColor,
                x: p.xR,
                y: p.yR,
                baseLight: rightBaseLight,
                maxLutIndex: rightMaxLut,
              });
            }

            if (!first && p.xL !== 0 && p.yL !== 0) {
              drawColoredPoints({
                ...commonParams,
                colorType: leftColor,
                x: p.xL,
                y: p.yL,
                baseLight: leftBaseLight,
                maxLutIndex: leftMaxLut,
              });
            }
          }
          // --------------------------
          // 处理紫色点（无左右眼差异，如网格点）
          // --------------------------
          else {
            if (p.xM !== 0 && p.yM !== 0) {
              drawColoredPoints({
                ...commonParams,
                colorType: "purple",
                x: p.xM,
                y: p.yM,
                baseLight: 50,
                maxLutIndex: 500,
              });
            }
          }
        }
        // =============================================
      }
    }
  }

  // 阶段11A新增：FOCUS/EDIT 态使用简化光照渲染 screenPoints（排除 FOCUS_ENTERING 中间态）
  if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'EDIT') {
    renderScreenPoints(pixelData, width, height);
  }

  // 渲染前更新虚拟鼠标（确保在渲染时虚拟鼠标点存在）
  if (SystemState.virtualMouse.enabled) {
    updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
  }

  // 渲染屏幕辅助元素（虚拟鼠标等）
  renderScreenOverlay(pixelData, width, height);

  // 4. 批量渲染所有像素（仅1次DOM操作）
  ctx.putImageData(imageData, 0, 0);
}

// ========================
// 阶段11A新增：简化光照渲染
// ========================

/**
 * 使用固定亮度渲染单个点（阶段11A新增）
 */
function renderPointSimple(p, light, pixelData, width, height) {
  const x = Math.floor(p.xM);
  const y = Math.floor(p.yM);

  if (x < 0 || x >= width || y < 0 || y >= height) return;

  // 使用现有 COLOR_LUT
  const baseLight = 50;  // 使用 purple 的 baseLight
  const lutIndex = Math.min(
    Math.floor(light * baseLight * 10),
    COLOR_LUT.purple.length - 1
  );
  const color = COLOR_LUT.purple[Math.max(0, lutIndex)];

  const idx = (y * width + x) * 4;
  pixelData[idx] = color[0];      // R
  pixelData[idx + 1] = color[1];  // G
  pixelData[idx + 2] = color[2];  // B
  pixelData[idx + 3] = 255;       // A
}

/**
 * 渲染 screenPoints（截面轮廓等）（整饬修改：移除 CONTROL，控制点现在在主渲染循环中处理）
 */
function renderScreenPoints(pixelData, width, height) {
  for (const p of SystemState.screenPoints) {
    // 执行投影
    const inverseRate = SystemState.mainWindow.calculateBasePoint(
      SystemState.mainWindow.capital,
      CONFIG.eyeD,
      SystemState.mainWindow.direction,
      p
    );
    if (inverseRate === null) continue;

    if (p.tag === 'SLICE_CONTOUR') {
      renderPointSimple(p, 0.8, pixelData, width, height);
    }
    // 整饬修改：CONTROL 渲染已移至主渲染循环，此处移除
  }
}

// ========================
// 虚拟鼠标系统
// ========================

/**
 * 更新虚拟鼠标（屏幕辅助元素，独立于空间点）
 * @param {number} mouseX - 鼠标屏幕 X 坐标
 * @param {number} mouseY - 鼠标屏幕 Y 坐标
 */
function updateVirtualMouse(mouseX, mouseY) {
  const vm = SystemState.virtualMouse;
  if (!vm.enabled) return;

  const width = SystemState.screenWidthPx;
  const height = SystemState.screenHeightPx;

  // 清除旧的虚拟鼠标点
  SystemState.screenPoints = SystemState.screenPoints.filter(
    p => p.tag !== 'VIRTUAL_MOUSE'
  );

  // 从鼠标位置向外扩展搜索整个grid
  const snapped = findNearestAttractableExpanding(mouseX, mouseY);

  let centerX = mouseX;
  let centerY = mouseY;
  let centerXL = mouseX;  // 左眼圈心
  let centerXR = mouseX;  // 右眼圈心
  let centerYL = mouseY;
  let centerYR = mouseY;
  let perspectiveScale = 1;  // 透视缩放因子（近大远小）

  // FOCUS/FOCUS_ENTERING 态：虚拟鼠标在指定深度平面上自由移动，但仍然要计算透视投影
  if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'FOCUS_ENTERING') {
    // 深度计算：屏幕平面深度 + 虚拟鼠标深度偏移
    // 屏幕到用户的基准距离
    const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;  // 40cm
    // 虚拟鼠标平面到用户的距离
    const vmDepth = baseDis + SystemState.focusVirtualMouseDepth;

    // 透视缩放：1cm 直径在该深度的屏幕投影大小
    perspectiveScale = Math.max(0.1, baseDis / vmDepth);

    // 计算左右眼视差（用于立体显示）
    // 视差 = (eyeD / 2) * (1 - baseDis / vmDepth)
    // 当 vmDepth > baseDis 时，点在屏幕后方（交叉视差）
    // 当 vmDepth < baseDis 时，点在屏幕前方（非交叉视差）
    const eyeD = CONFIG.eyeD;
    const halfEyeD = eyeD / 2;
    const disparity = halfEyeD * (1 - baseDis / vmDepth) * SystemState.mainWindow.DPIx;

    centerX = mouseX;
    centerY = mouseY;
    centerXL = mouseX - disparity;  // 左眼向左偏移
    centerXR = mouseX + disparity;  // 右眼向右偏移
    centerYL = mouseY;
    centerYR = mouseY;
    vm.snappedTo = null;
  } else if (snapped) {
    // 使用吸附点的完整左右眼坐标作为圈心
    // 如果格点严格在屏幕平面上，则 xL == xR == xM，自然无视差
    centerXL = snapped.xL;
    centerXR = snapped.xR;
    centerYL = snapped.yL;
    centerYR = snapped.yR;
    centerX = snapped.xM;
    centerY = snapped.yM;

    // 计算透视缩放：利用点到用户的距离 (dis) 
    const pointDis = snapped.dis || 40;
    const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
    perspectiveScale = Math.max(0.3, Math.min(3.0, baseDis / pointDis));

    vm.snappedTo = snapped;
  } else {
    // 无可吸附点时显示在鼠标位置
    centerX = mouseX;
    centerY = mouseY;
    centerXL = mouseX;
    centerXR = mouseX;
    centerYL = mouseY;
    centerYR = mouseY;
    perspectiveScale = 1;
    vm.snappedTo = null;
  }

  vm.screenPosition = { x: centerX, y: centerY };

  // 生成圈形点（世界空间 1cm 直径，通过透视投影到屏幕）
  // 基础半径 = 0.5cm（世界空间）
  // 屏幕上的像素大小 = 世界空间大小 * DPI * (baseDis / pointDis)
  // 其中 baseDis/pointDis 已经在 perspectiveScale 中计算
  const worldRadiusCm = 0.5;  // 世界空间 0.5cm 半径（直径 1cm）
  const radiusPx = worldRadiusCm * SystemState.mainWindow.DPIx * perspectiveScale;
  const numPoints = 24;

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusPx;
    const dy = Math.sin(angle) * radiusPx;

    const sp = new Point(0, 0, 0);
    sp.space = 'screen';
    sp.tag = 'VIRTUAL_MOUSE';

    // 中点坐标（用于 grid 索引，但实际不参与渲染）
    sp.xM = centerX + dx;
    sp.yM = centerY + dy;

    // 左右眼坐标：各自以左右眼圈心为中心画圈
    sp.xL = centerXL + dx;
    sp.xR = centerXR + dx;
    sp.yL = centerYL + dy;
    sp.yR = centerYR + dy;

    sp.light = 0.9;

    SystemState.screenPoints.push(sp);
  }
}

/**
 * 从鼠标位置向外扩展搜索最近的可吸附点
 * 逐层扩展搜索grid，一旦在某层找到可吸附点就返回最近的
 */
function findNearestAttractableExpanding(mouseX, mouseY) {
  const win = SystemState.mainWindow;
  if (!win || !win.grid) return null;

  const gridSize = win.gridsize;
  const gridWidth = win.grid.length;
  const gridHeight = win.grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) return null;

  // 计算鼠标所在的grid cell
  const centerGx = Math.floor(mouseX / gridSize);
  const centerGy = Math.floor(mouseY / gridSize);

  // 计算需要搜索的最大半径（覆盖整个grid）
  const maxRange = Math.max(
    Math.max(centerGx, gridWidth - 1 - centerGx),
    Math.max(centerGy, gridHeight - 1 - centerGy)
  ) + 1;

  let nearest = null;
  let minDist = Infinity;

  // 逐层向外扩展搜索
  for (let range = 0; range <= maxRange; range++) {
    let foundInThisLayer = false;

    // 搜索当前层的边界格子
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        // 只搜索边界（跳过内部已搜索过的）
        if (range > 0 && Math.abs(dx) < range && Math.abs(dy) < range) continue;

        const gx = centerGx + dx;
        const gy = centerGy + dy;

        // 边界检查
        if (gx < 0 || gx >= gridWidth) continue;
        if (gy < 0 || gy >= gridHeight) continue;

        // 遍历该格子内的所有点
        for (const p of win.grid[gx][gy]) {
          if (!p.isAttractable) continue;

          // 阶段16新增：EDIT 态只吸附屏幕平面附近的 局部格网点
          if (SystemState.interactionState === 'EDIT') {
            // 1. 只吸附局部格网点 (Control points snap to VM, so VM snaps to Grid)
            if (p.tag !== 'LOCAL_GRID') continue;

            // 2. 距离检测已移至 updateLocalGrid 控制 p.isAttractable
          }

          const dx = p.xM - mouseX;
          const dy = p.yM - mouseY;
          const distSq = dx * dx + dy * dy;

          // 找到更近的点
          if (distSq < minDist) {
            minDist = distSq;
            nearest = p;
            foundInThisLayer = true;
          }
        }
      }
    }

    // 如果在当前层找到了可吸附点，就停止搜索
    if (foundInThisLayer) {
      break;
    }
  }

  return nearest;
}

/**
 * 渲染屏幕辅助元素（虚拟鼠标等）
 * 独立于空间点渲染，直接使用屏幕坐标
 */
function renderScreenOverlay(pixelData, width, height) {
  // 调试：统计虚拟鼠标点数量
  const vmPoints = SystemState.screenPoints.filter(p => p.space === 'screen' && p.tag === 'VIRTUAL_MOUSE');
  if (vmPoints.length > 0 && !SystemState._vmRenderDebugLogged) {
    console.log(`renderScreenOverlay: 找到 ${vmPoints.length} 个虚拟鼠标点, 第一个位置: (${vmPoints[0].xL?.toFixed(0)}, ${vmPoints[0].yL?.toFixed(0)})`);
    SystemState._vmRenderDebugLogged = true;
  }

  for (const p of SystemState.screenPoints) {
    if (p.space !== 'screen') continue;

    if (p.tag === 'VIRTUAL_MOUSE') {
      // 虚拟鼠标：立体渲染
      const isLR = CONFIG.displayMode === '3D_LR';
      const leftColor = isLR ? 'red' : 'blue';
      const rightColor = isLR ? 'blue' : 'red';

      if (Math.abs((p.xL || 0) - (p.xR || 0)) > 0) {
        renderScreenPixel(p.xL, p.yL, leftColor, p.light, pixelData, width, height);
        renderScreenPixel(p.xR, p.yR, rightColor, p.light, pixelData, width, height);
      } else {
        renderScreenPixel(p.xM, p.yM, 'purple', p.light, pixelData, width, height);
      }
    }
  }
}

/**
 * 渲染单个屏幕像素
 */
function renderScreenPixel(x, y, colorType, light, pixelData, width, height) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || x >= width || y < 0 || y >= height) return;

  const baseLight = colorType === 'red' ? 35 : 50;
  const lutIndex = Math.min(
    Math.floor(light * baseLight * 10),
    COLOR_LUT[colorType].length - 1
  );
  const color = COLOR_LUT[colorType][Math.max(0, lutIndex)];

  const idx = (y * width + x) * 4;
  pixelData[idx] = color[0];
  pixelData[idx + 1] = color[1];
  pixelData[idx + 2] = color[2];
  pixelData[idx + 3] = 255;
}

/**
 * 更新截面轮廓（阶段11B新增）
 */
function updateSliceContour() {
  // FOCUS_ENTERING 中间态不创建截面轮廓
  if (SystemState.interactionState === 'FOCUS_ENTERING') return;

  const obj = SystemState.focusedObject;
  if (!obj) return;

  // 清除旧轮廓点
  SystemState.screenPoints = SystemState.screenPoints.filter(
    p => p.tag !== 'SLICE_CONTOUR'
  );

  // 预留：使用球谐函数在指定深度采样轮廓
  // const contourPoints = sampleContourAtDepth(obj, SystemState.focusSliceDepth, 36);

  // 临时逻辑已移除（解决大圈问题）
  // 待后续实现真正的截面轮廓采样
  console.log('截面深度:', SystemState.focusSliceDepth);
}

// ========================
// 11. 输入处理
// ========================

/**
 * 用户绕旋转中心水平旋转
 * 旋转 capital（双眼）、direction.start（屏幕参考点）、direction（视线方向）
 * @param {number} angle - 旋转角度（弧度）
 */
function userRotate(angle) {
  const center = SystemState.rotationCenter;
  const cam = SystemState.mainWindow.capital;
  const dir = SystemState.mainWindow.direction;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // 1. capital（双眼）绕旋转中心旋转
  const camDx = cam.x - center.x;
  const camDy = cam.y - center.y;
  cam.x = center.x + camDx * cos - camDy * sin;
  cam.y = center.y + camDx * sin + camDy * cos;

  // 2. direction.start（屏幕参考点）绕旋转中心旋转
  const startDx = dir.start.x - center.x;
  const startDy = dir.start.y - center.y;
  dir.start.x = center.x + startDx * cos - startDy * sin;
  dir.start.y = center.y + startDx * sin + startDy * cos;

  // 3. direction 向量旋转（修复变量覆盖 bug）
  const oldDirX = dir.x;
  const oldDirY = dir.y;
  dir.x = oldDirX * cos - oldDirY * sin;
  dir.y = oldDirX * sin + oldDirY * cos;

  // 4. 更新角度
  dir.getAngle();
  SystemState.mainWindow.getAngle();
}

/**
 * FOCUS 态边缘旋转处理
 * 鼠标在边缘时对数加速启动旋转，离开边缘瞬间停止
 */
function handleFocusEdgeRotation() {
  const x = SystemState.lastMouseX;
  const y = SystemState.lastMouseY;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const edgeThreshold = 20;  // 边缘检测阈值（像素）

  // 检测边缘
  const atLeft = x < edgeThreshold;
  const atRight = x > width - edgeThreshold;
  const atTop = y < edgeThreshold;
  const atBottom = y > height - edgeThreshold;

  const isAtEdge = atLeft || atRight || atTop || atBottom;
  const rotState = SystemState.focusRotationState;

  if (isAtEdge) {
    // 计算方向
    const h = atRight ? 1 : (atLeft ? -1 : 0);  // 水平：右=1，左=-1
    const v = atTop ? 1 : (atBottom ? -1 : 0);  // 垂直：上=1（向上翻），下=-1（向下翻）

    // 检测是否刚进入边缘或方向改变
    if (!rotState.isAtEdge || rotState.edgeDirection.h !== h || rotState.edgeDirection.v !== v) {
      rotState.edgeStartTime = Date.now();
      rotState.edgeDirection = { h, v };
    }
    rotState.isAtEdge = true;

    // 对数加速：1 - e^(-kt)
    const elapsed = (Date.now() - rotState.edgeStartTime) / 1000;  // 秒
    const accelRate = 3.0;  // 加速率
    const maxSpeed = 0.03;  // 最大旋转速度（弧度/帧）
    const speedFactor = 1 - Math.exp(-accelRate * elapsed);

    const hSpeed = h * speedFactor * maxSpeed;
    const vSpeed = v * speedFactor * maxSpeed;

    if (hSpeed !== 0 || vSpeed !== 0) {
      rotateFocusedObject(hSpeed * 100, vSpeed * 100);  // 乘以系数转换为像素增量
      SystemState.ifControl = true;
    }
  } else {
    // 离开边缘：瞬间停止
    rotState.isAtEdge = false;
    rotState.edgeStartTime = 0;
    rotState.edgeDirection = { h: 0, v: 0 };
  }
}

function handleInput() {
  // ========== FOCUS 态边缘旋转处理 ==========
  if (SystemState.interactionState === 'FOCUS') {
    handleFocusEdgeRotation();
    return;
  }

  // ========== FOCUS_ENTERING 态不处理输入 ==========
  if (SystemState.interactionState === 'FOCUS_ENTERING') return;

  // ========== EDIT 态不处理 VIEW/FOCUS 态的连续输入 (使用独立事件处理) ==========
  if (SystemState.interactionState === 'EDIT') return;
  // =========================================

  const keys = SystemState.keys;
  const rotState = SystemState.velocityState.rotation;
  const moveState = SystemState.velocityState.moveForward;

  // ========== 整饬修改：对数速度 - 设置目标和倍率 ==========
  // 旋转：Z/X/C 左转（速度递减），B/N/M 右转（速度递增）
  rotState.target = 0;
  rotState.factor = 0;

  if (keys["z"]) { rotState.target = CONFIG.rotationSpeed; rotState.factor = 1.0; }
  else if (keys["x"]) { rotState.target = CONFIG.rotationSpeed; rotState.factor = 0.5; }
  else if (keys["c"]) { rotState.target = CONFIG.rotationSpeed; rotState.factor = 0.25; }
  else if (keys["b"]) { rotState.target = -CONFIG.rotationSpeed; rotState.factor = 0.25; }
  else if (keys["n"]) { rotState.target = -CONFIG.rotationSpeed; rotState.factor = 0.5; }
  else if (keys["m"]) { rotState.target = -CONFIG.rotationSpeed; rotState.factor = 1.0; }

  // 鼠标边缘持续旋转
  if (SystemState.mouseEdge === -1) {
    rotState.target = CONFIG.rotationSpeed;
    rotState.factor = 0.25;
  } else if (SystemState.mouseEdge === 1) {
    rotState.target = -CONFIG.rotationSpeed;
    rotState.factor = 0.25;
  }

  // 前后移动：FG 前进，V 后退
  moveState.target = 0;
  moveState.factor = 0;

  if (keys["f"] || keys["g"]) { moveState.target = CONFIG.moveSpeed; moveState.factor = 1.0; }
  else if (keys["v"]) { moveState.target = -CONFIG.moveSpeed; moveState.factor = 1.0; }
  // ===========================================================

  // 方向键控制光源
  if (keys["arrowleft"]) SystemState.lightAngle -= CONFIG.rotationSpeed;
  if (keys["arrowright"]) SystemState.lightAngle += CONFIG.rotationSpeed;
  if (keys["arrowup"])
    SystemState.lightElevation = Math.min(
      CONFIG.maxElevation,
      SystemState.lightElevation + CONFIG.rotationSpeed,
    );
  if (keys["arrowdown"])
    SystemState.lightElevation = Math.max(
      CONFIG.minElevation,
      SystemState.lightElevation - CONFIG.rotationSpeed,
    );

  // 摄像头控制逻辑（如果启用）
  // 摄像头的更新在 processCamera 中进行
}

/**
 * 对数速度更新（整饬新增）
 * @param {Object} state - 速度状态 {current, target, factor}
 * @param {number} dt - 帧间隔（毫秒）
 * @param {number} accelK - 加速因子（越大加速越快）
 */
function updateLogVelocity(state, dt, accelK = 3.0) {
  if (state.target === 0) {
    // 目标为0时快速减速
    state.current *= Math.exp(-accelK * dt / 1000);
    if (Math.abs(state.current) < 0.001) state.current = 0;
  } else {
    // 向目标值对数接近
    const targetVel = state.target * state.factor;
    const diff = targetVel - state.current;
    state.current += diff * (1 - Math.exp(-accelK * dt / 1000));
  }
  return state.current;
}

/**
 * 应用对数速度到视角（整饬新增）
 * @param {number} dt - 帧间隔（毫秒）
 */
function applyVelocities(dt) {
  const rotVel = updateLogVelocity(SystemState.velocityState.rotation, dt);
  const moveVel = updateLogVelocity(SystemState.velocityState.moveForward, dt);

  // 应用旋转
  if (Math.abs(rotVel) > 0.0001) {
    userRotate(rotVel);
    SystemState.ifControl = true;
  }

  // 应用移动
  if (Math.abs(moveVel) > 0.0001) {
    const dir = SystemState.mainWindow.direction;
    SystemState.mainWindow.capital.x += dir.x * moveVel;
    SystemState.mainWindow.capital.y += dir.y * moveVel;
    SystemState.mainWindow.capital.z += dir.z * moveVel;
    dir.start.x += dir.x * moveVel;
    dir.start.y += dir.y * moveVel;
    dir.start.z += dir.z * moveVel;
    SystemState.ifControl = true;
  }
}

// ========================
// 12. 事件监听器设置
// ========================
function setupEventListeners() {
  // 键盘事件
  window.addEventListener("keydown", (e) => {
    SystemState.keys[e.key.toLowerCase()] = true;
    // 示例：按 'c' 键切换摄像头控制
    if (e.key.toLowerCase() === "p") {
      CONFIG.cameraControl.enabled = !CONFIG.cameraControl.enabled;
      if (CONFIG.cameraControl.enabled) {
        initCamera(); // 尝试重新初始化
      }
      SystemState.debugDiv.textContent = `摄像头控制: ${CONFIG.cameraControl.enabled ? "开启" : "关闭"}`;
      console.log(
        `摄像头控制: ${CONFIG.cameraControl.enabled ? "开启" : "关闭"}`,
      );
    }
    // 阶段15修改：ESC 键分层退出
    if (e.key === 'Escape') {
      if (SystemState.interactionState === 'EDIT') {
        exitEditState();  // EDIT -> FOCUS
      } else if (SystemState.interactionState === 'FOCUS') {
        exitFocusState();  // FOCUS -> VIEW
      }
    }

    // 阶段16新增：EDIT 态 WASD/QE 离散旋转
    if (SystemState.interactionState === 'EDIT') {
      const obj = SystemState.focusedObject;
      if (obj) {
        const key = e.key.toLowerCase();
        if (['w', 's', 'a', 'd', 'q', 'e'].includes(key)) {
          // 添加旋转冷却，防止按住时连续快速旋转
          const now = performance.now();
          const cooldownMs = 300; // 300ms 冷却时间
          if (!SystemState._lastRotationTime || (now - SystemState._lastRotationTime) > cooldownMs) {
            SystemState._lastRotationTime = now;
            OrientationUtils.transition(key, obj);
          }
        }
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    SystemState.keys[e.key.toLowerCase()] = false;
  });

  // 阶段10新增：click 事件用于双击检测
  SystemState.canvas.addEventListener("click", onMouseClick);

  // 阶段16新增：EDIT 态滚轮切片深度调节
  SystemState.canvas.addEventListener("wheel", (e) => {
    if (SystemState.interactionState === 'EDIT') {
      e.preventDefault();
      const obj = SystemState.focusedObject;
      if (!obj) return;

      // 初始化滚动累加器
      if (typeof SystemState._scrollAccumulator === 'undefined') {
        SystemState._scrollAccumulator = 0;
      }

      // 累加 deltaY
      SystemState._scrollAccumulator += e.deltaY;

      // 设定阈值：通常一格滚轮 deltaY 为 100 或 125
      // "滚三格滚轮" -> 约 300
      const TICK_THRESHOLD = 300;

      if (Math.abs(SystemState._scrollAccumulator) >= TICK_THRESHOLD) {
        // 触发切片移动
        const sign = Math.sign(SystemState._scrollAccumulator);
        const steps = Math.floor(Math.abs(SystemState._scrollAccumulator) / TICK_THRESHOLD);

        // Phase 16b: 深度限制检查
        // 计算当前物体中心到屏幕平面的距离
        const win = SystemState.mainWindow;
        const dir = win.direction;
        const planePt = dir.start;
        const currentDepth = (obj.center.x - planePt.x) * dir.x +
          (obj.center.y - planePt.y) * dir.y +
          (obj.center.z - planePt.z) * dir.z;

        // 使用配置值，根据当前姿态类型确定最大深度和层间距
        const orientationType = obj._currentOrientationState?.type || 'FACE';
        const maxDepth = LocalGridConfig.getMaxDepthForOrientation(orientationType);
        const stepSize = LocalGridConfig.getLayerSpacingForOrientation(orientationType);

        console.log(`[Wheel] Type: ${orientationType}, Step: ${stepSize.toFixed(3)}cm`);

        // 计算目标深度 (严格对齐到层，避免误差积累)
        // 先计算当前最近层，再加上步进
        const currentLayer = Math.round(currentDepth / stepSize);
        const targetLayer = currentLayer + steps * sign;
        const targetDepth = targetLayer * stepSize;

        // 限制深度在 [-maxDepth, +maxDepth] 范围内
        if (targetDepth > maxDepth || targetDepth < -maxDepth) {
          console.log(`Depth limit reached: current=${currentDepth.toFixed(1)}, target=${targetDepth.toFixed(1)}, limit=±${maxDepth.toFixed(1)}`);
          SystemState._scrollAccumulator = 0;
          return;
        }

        // 消耗累加器
        SystemState._scrollAccumulator -= sign * steps * TICK_THRESHOLD;

        // Phase 16b: 使用动画移动到严格对齐的目标位置
        const delta = targetDepth - currentDepth;
        const targetX = obj.center.x + dir.x * delta;
        const targetY = obj.center.y + dir.y * delta;
        const targetZ = obj.center.z + dir.z * delta;

        animateSliceTransition(obj, targetX, targetY, targetZ, 150); // 150ms 动画

        console.log(`Slice Scroll: Layer ${currentLayer} -> ${targetLayer}, Depth: ${targetDepth.toFixed(1)}cm`);
      }
    }
  }, { passive: false });

  // 鼠标事件
  SystemState.canvas.addEventListener("mousedown", (e) => {
    // 阶段16新增：EDIT 态控制点交互
    if (SystemState.interactionState === 'EDIT' && e.button === 0) {
      const cp = findControlPointAt(e.clientX, e.clientY);

      if (cp) {
        // 开始拖动
        SystemState.draggedControlPoint = cp;
        SystemState.lastMouseX = e.clientX;
        SystemState.lastMouseY = e.clientY;

        // 启动长按计时器
        SystemState.longPressTarget = cp;
        SystemState.longPressTimer = setTimeout(() => {
          deleteControlPoint(cp);
          SystemState.longPressTarget = null;
          SystemState.draggedControlPoint = null;
        }, 1000);  // 1秒长按
      }
    }
    // FOCUS 态：任意左键按下开始拖动旋转
    else if (SystemState.interactionState === 'FOCUS' && e.button === 0) {
      SystemState.isDragging = true;
      SystemState.lastMouseX = e.clientX;
      SystemState.lastMouseY = e.clientY;
    } else if (SystemState.interactionState === 'VIEW' && e.button === 0) {
      // VIEW 态：检测虚拟鼠标是否吸附在物心
      const snapped = SystemState.virtualMouse.snappedTo;
      if (snapped && snapped.isObjectCenter && snapped.ownerObject) {
        // 开始拖拽物体
        SystemState.draggingObject = snapped.ownerObject;
        SystemState.dragStartCenter = {
          x: snapped.ownerObject.center.x,
          y: snapped.ownerObject.center.y,
          z: snapped.ownerObject.center.z
        };
        console.log('开始拖拽物体');
      }
      SystemState.isDragging = true;
      SystemState.lastMouseX = e.clientX;
      SystemState.lastMouseY = e.clientY;
    }
  });
  window.addEventListener("mouseup", () => {
    // 阶段16新增：EDIT 态控制点释放
    if (SystemState.draggedControlPoint) {
      SystemState.draggedControlPoint = null;
      updateControlPointsDisplay();
    }

    if (SystemState.longPressTimer) {
      clearTimeout(SystemState.longPressTimer);
      SystemState.longPressTimer = null;
    }
    SystemState.longPressTarget = null;

    // 阶段13：处理蓄力释放
    if (SystemState.isCharging) {
      const chargeDuration = Date.now() - SystemState.chargeStartTime;
      const impulse = calculateImpulse(chargeDuration);

      console.log('释放蓄力，时长:', chargeDuration, 'ms, 冲量:', impulse.toFixed(3));

      if (impulse > 0.01) {
        applyTouchImpulse(impulse);
      }

      SystemState.isCharging = false;
      SystemState.chargeHitPoint = null;
    }

    // VIEW 态：释放拖拽物体
    if (SystemState.draggingObject) {
      const snapped = SystemState.virtualMouse.snappedTo;
      if (snapped && snapped.isGridPoint) {
        // 吸附到格点
        moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
        console.log('物体放置到格点:', snapped.x, snapped.y, snapped.z);
      }
      SystemState.draggingObject = null;
      SystemState.dragStartCenter = null;
    }

    SystemState.isDragging = false;
  });

  // 阶段10新增：双击检测
  SystemState.canvas.addEventListener('click', onMouseClick);
  SystemState.canvas.addEventListener("mousemove", (e) => {
    // 阶段16新增：EDIT 态控制点拖动
    if (SystemState.interactionState === 'EDIT' && SystemState.draggedControlPoint) {
      const dx = e.clientX - SystemState.lastMouseX;
      const dy = e.clientY - SystemState.lastMouseY;

      if (dx !== 0 || dy !== 0) {
        // 取消长按
        if (SystemState.longPressTimer) {
          clearTimeout(SystemState.longPressTimer);
          SystemState.longPressTimer = null;
        }

        // 移动控制点
        moveControlPoint(SystemState.draggedControlPoint, dx, dy);

        SystemState.lastMouseX = e.clientX;
        SystemState.lastMouseY = e.clientY;
        SystemState.ifControl = true;
      }
    }
    // VIEW 态：物体跟随虚拟鼠标拖拽
    if (SystemState.interactionState === 'VIEW' && SystemState.draggingObject) {
      const snapped = SystemState.virtualMouse.snappedTo;
      if (snapped && snapped.isGridPoint) {
        // 物体跟随到格点
        moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
      }
    }
    // FOCUS 态：不再使用拖动旋转，改为边缘控制（在 handleInput 中处理）

    // 阶段1新增：鼠标边缘状态更新
    const screenWidth = window.innerWidth;

    if (e.clientX <= 0) {
      // 鼠标在最左边缘（0像素）
      SystemState.mouseEdge = -1;
    } else if (e.clientX >= screenWidth - 1) {
      // 鼠标在最右边缘
      SystemState.mouseEdge = 1;
    } else {
      // 鼠标不在边缘
      SystemState.mouseEdge = 0;
    }

    // 更新虚拟鼠标（始终吸附最近可吸附点）
    if (SystemState.virtualMouse.enabled) {
      updateVirtualMouse(e.clientX, e.clientY);
      SystemState.ifControl = true;
    }

    // 始终更新鼠标位置，用于渲染时的虚拟鼠标更新
    SystemState.lastMouseX = e.clientX;
    SystemState.lastMouseY = e.clientY;
  });

  // 滚轮事件：前进/后退 或 FOCUS/EDIT 态调整截面深度
  SystemState.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    // 阶段16修改：EDIT 态深度层切换
    if (SystemState.interactionState === 'EDIT') {
      const delta = e.deltaY > 0 ? -1 : 1;
      SystemState.editDepthLayer += delta;
      console.log('切换深度层:', SystemState.editDepthLayer);
      updateControlPointsDisplay();
      SystemState.ifControl = true;
      return;
    }
    // FOCUS 态：滚轮同时更新截面深度和虚拟鼠标深度
    else if (SystemState.interactionState === 'FOCUS') {
      const delta = e.deltaY > 0 ? 0.5 : -0.5;
      SystemState.focusSliceDepth += delta;
      SystemState.focusVirtualMouseDepth += delta;  // 同步更新虚拟鼠标深度
      updateSliceContour();
      SystemState.ifControl = true;
      return;  // 不执行 VIEW 态的移动逻辑
    }

    const dir = SystemState.mainWindow.direction;
    const speed = CONFIG.moveSpeed * 2;  // 滚轮速度稍快

    // 移动限制逻辑
    const currentY = SystemState.mainWindow.capital.y;
    const initialY = SystemState.movementConstraints?.initialY ?? CONFIG.userDistanceFromOrigin;
    const range = SystemState.movementConstraints?.range ?? (CONFIG.screenXLengthCm * 0.5);
    const minY = initialY - range;
    const maxY = initialY + range;

    // 预计算移动增量
    let dx = 0, dy = 0, dz = 0;
    if (e.deltaY < 0) {
      // 前进
      dx = dir.x * speed; dy = dir.y * speed; dz = dir.z * speed;
    } else {
      // 后退
      dx = -dir.x * speed; dy = -dir.y * speed; dz = -dir.z * speed;
    }

    // 检查 Y 轴限制 (假设主要沿 Y 轴移动)
    const nextY = currentY + dy;
    if (nextY >= minY && nextY <= maxY) {
      SystemState.mainWindow.capital.x += dx;
      SystemState.mainWindow.capital.y += dy;
      SystemState.mainWindow.capital.z += dz;
      dir.start.x += dx;
      dir.start.y += dy;
      dir.start.z += dz;
    } else {
      console.log("已达到移动限制");
    }
    SystemState.ifControl = true;
  });

  // 窗口大小变化事件
  window.addEventListener("resize", () => {
    SystemState.ifControl = true;
    resizeCanvas();
    // 重新创建窗口实例以适应新尺寸
    SystemState.hiddenWindow = new Window(
      SystemState.screenWidthPx,
      SystemState.screenHeightPx,
      CONFIG.screenXLengthCm,
      CONFIG.screenYLengthCm,
      "hidden",
    );
    SystemState.lightWindow = new Window(
      SystemState.screenWidthPx,
      SystemState.screenHeightPx,
      CONFIG.screenXLengthCm,
      CONFIG.screenYLengthCm,
      "light",
    );
    SystemState.mainWindow.resizeRefresh(
      window.innerWidth,
      window.innerHeight,
      (window.innerWidth / CONFIG.screenWidth) * CONFIG.screenXLengthCm,
      (window.innerHeight / CONFIG.screenHeight) * CONFIG.screenYLengthCm,
    );
    // 重新估算法向量（可选，可能耗时）
    // estimateNormals();
  });
}

// ========================
// 13. 调整画布大小
// ========================
function resizeCanvas() {
  SystemState.canvas.width = window.innerWidth;
  SystemState.canvas.height = window.innerHeight;
  if (SystemState.mainWindow) {
    SystemState.mainWindow.windowObjects.length = 0;
  }
}

// ========================
// 14. 动态对象创建接口（预留）
// ========================
function createObjectFromCommand(command) {
  console.log("收到创建对象指令:", command);
  switch (command.type) {
    case "sphere":
      return createSphere(
        command.params.x,
        command.params.y,
        command.params.z,
        command.params.radius,
        command.params.points,
      );
    case "cube":
      return createCube(
        command.params.size,
        command.params.pointsPerFace,
        command.params.x,
        command.params.y,
        command.params.z,
        command.params.alpha,
        command.params.ifEntity,
      );
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

/**
 * 处理任务队列（阶段5新增）
 * 在每帧中执行所有当前任务，完成的任务移除，未完成的继续到下一帧
 * @param {number} worldTime - 当前世界时间（毫秒）
 * @param {number} dt - 帧间隔（毫秒）
 */
function processTaskQueue(worldTime, dt) {
  for (const task of SystemState.taskQueues.current) {
    const completed = AnimationImpl.executeTask(task, worldTime, dt);
    if (!completed) {
      // 任务未完成，继续到下一帧
      SystemState.taskQueues.next.push(task);
    } else if (task.then) {
      // 任务完成，如果有后续任务则提交
      SystemState.taskQueues.submit(task.then);
    }
  }
  // 交换队列
  SystemState.taskQueues.swap();
}

/**
 * 物理步进更新（阶段6新增）
 * 遍历所有物体，执行物理模拟并同步结果
 * @param {number} dt - 帧间隔（毫秒）
 */
function physicsStep(dt) {
  // 阶段 8 后添加状态判断
  // if (SystemState.interactionState === 'EDIT') return;

  // 遍历所有物体
  for (const obj of SystemState.objects) {
    // 跳过动画锁定的物体（动画期间不受物理影响）
    if (obj.animationLock) continue;

    // 跳过未启用物理的物体
    if (!obj.physics || !obj.physics.enabled) continue;

    // 物理更新逻辑（预留位置）
    // 当前阶段暂不实现具体物理计算
    // 后续可在此调用 PhysicsSystem.step() 等
  }

  // 同步物理结果到渲染点
  for (const obj of SystemState.objects) {
    // 跳过动画锁定的物体
    if (obj.animationLock) continue;

    // 调用 commitPhysics 同步数据
    if (obj.commitPhysics) {
      obj.commitPhysics();
    }
  }
}

/**
 * 更新可见层反射向量（阶段7新增）
 * 只对每个格子的浅层点计算反射向量，优化性能
 */
function updateVisibleReflection() {
  // 获取光源位置
  const lightX = CONFIG.lightX;
  const lightY = CONFIG.lightY;
  const lightZ = CONFIG.lightZ;

  const grid = SystemState.mainWindow.grid;
  const K = 5;  // 每格取浅层 K 个点

  // 检查 grid 是否存在
  if (!grid || grid.length === 0) return;

  for (let gx = 0; gx < grid.length; gx++) {
    const column = grid[gx];
    if (!column) continue;

    for (let gy = 0; gy < column.length; gy++) {
      const points = column[gy];
      if (!points || points.length === 0) continue;

      const count = Math.min(points.length, K);

      for (let i = 0; i < count; i++) {
        const p = points[i];

        // 跳过无法向量的点
        if (p.nx === 0 && p.ny === 0 && p.nz === 0) continue;

        // 计算入射向量（从光源指向点）
        const dx = p.x - lightX;
        const dy = p.y - lightY;
        const dz = p.z - lightZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.001) continue;

        // 归一化入射向量
        const ix = dx / dist;
        const iy = dy / dist;
        const iz = dz / dist;

        // 计算入射向量与法向量的点积
        const dot = ix * p.nx + iy * p.ny + iz * p.nz;

        // 计算反射向量：R = I - 2(I·N)N
        p.rx = ix - 2 * dot * p.nx;
        p.ry = iy - 2 * dot * p.ny;
        p.rz = iz - 2 * dot * p.nz;
      }
    }
  }
}

// ========================
// 状态机函数（阶段8新增）
// ========================

/**
 * 进入 VIEW 态
 * VIEW 态：观察模式，可旋转视角和移动位置
 */
function enterViewState() {
  SystemState.interactionState = 'VIEW';
  SystemState.focusedObject = null;
  console.log('进入 VIEW 态');

  // 恢复所有物体可见度
  for (const obj of SystemState.objects) {
    obj.visualAlpha = 1.0;
    const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
    for (const p of points) {
      if (p.tag === 'DIMMED') p.tag = null;
    }
  }
}

/**
 * 进入 FOCUS 态（阶段10新增，增强版）
 * FOCUS 态：聚焦模式，选中物体居中显示且正面朝向用户
 * @param {Object} obj - 要聚焦的物体
 */
function enterFocusState(obj) {
  if (!obj) {
    console.warn('enterFocusState: 物体不能为空');
    return;
  }

  // 使用中间状态，动画完成后才正式进入 FOCUS
  SystemState.interactionState = 'FOCUS_ENTERING';
  SystemState.focusedObject = obj;
  console.log('开始进入 FOCUS 态，聚焦物体:', obj.metadata?.name || 'Untitled');

  // 0. 清除截面轮廓（避免显示残留的大圈）
  SystemState.screenPoints = SystemState.screenPoints.filter(
    p => p.tag !== 'SLICE_CONTOUR'
  );

  // 1. 保存物体原位置和朝向
  if (obj.savePosition) {
    obj.savePosition();
  }
  const originalFront = { ...obj.frontDirection };
  obj._savedFrontDirection = originalFront;  // 保存到物体属性，退出时恢复

  // 关键修复：同时保存 Up 方向，否则 Roll 会丢失
  const originalUp = obj.upDirection ? { ...obj.upDirection } : { x: 0, y: 0, z: 1 };
  obj._savedUpDirection = originalUp;

  // 2. 计算居中目标位置
  const targetPos = calculateCenterPosition();
  const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

  // 3. 计算目标朝向（正面朝向用户 = 朝向 -direction）
  const dir = SystemState.mainWindow.direction;
  let targetFront = { x: -dir.x, y: -dir.y, z: -dir.z };
  // 归一化 targetFront
  const tfLen = Math.sqrt(targetFront.x ** 2 + targetFront.y ** 2 + targetFront.z ** 2);
  if (tfLen > 0) {
    targetFront.x /= tfLen;
    targetFront.y /= tfLen;
    targetFront.z /= tfLen;
  }

  // 归一化 originalFront
  const ofLen = Math.sqrt(originalFront.x ** 2 + originalFront.y ** 2 + originalFront.z ** 2);
  if (ofLen > 0) {
    originalFront.x /= ofLen;
    originalFront.y /= ofLen;
    originalFront.z /= ofLen;
  }

  // 4. 设置动画锁
  obj.animationLock = true;

  // 预计算旋转轴和总角度（避免动画末期叉积不稳定）
  const rotationAxis = {
    x: originalFront.y * targetFront.z - originalFront.z * targetFront.y,
    y: originalFront.z * targetFront.x - originalFront.x * targetFront.z,
    z: originalFront.x * targetFront.y - originalFront.y * targetFront.x
  };
  let axisLen = Math.sqrt(rotationAxis.x ** 2 + rotationAxis.y ** 2 + rotationAxis.z ** 2);
  if (axisLen < 0.001) {
    // 检查是否180度反向
    const dot = originalFront.x * targetFront.x + originalFront.y * targetFront.y + originalFront.z * targetFront.z;
    if (dot < -0.99) {
      // 180度翻转，取任意垂直轴
      if (Math.abs(originalFront.x) > 0.9) {
        rotationAxis.x = 0; rotationAxis.y = 1; rotationAxis.z = 0;
      } else {
        rotationAxis.x = 1; rotationAxis.y = 0; rotationAxis.z = 0;
      }
      axisLen = 1;
    }
  } else {
    rotationAxis.x /= axisLen;
    rotationAxis.y /= axisLen;
    rotationAxis.z /= axisLen;
  }
  const dotTotal = originalFront.x * targetFront.x + originalFront.y * targetFront.y + originalFront.z * targetFront.z;
  const totalAngle = Math.acos(Math.max(-1, Math.min(1, dotTotal)));

  // 5. 创建移动+旋转动画任务
  const duration = 500;
  const moveRotateTask = AnimationImpl.createTask({
    type: 'finite',
    target: obj,
    property: 'centerAndRotation', // 标识，实际不使用
    duration,
    easing: AnimationImpl.Easing.easeOut,
    compute: (progress) => ({
      position: {
        x: fromPos.x + (targetPos.x - fromPos.x) * progress,
        y: fromPos.y + (targetPos.y - fromPos.y) * progress,
        z: fromPos.z + (targetPos.z - fromPos.z) * progress
      },
      // 不计算插值 front
      progress
    }),
    apply: (targetObj, value) => {
      // 计算本帧移动增量
      const lastPos = targetObj._lastAnimPos || fromPos;
      const dx = value.position.x - lastPos.x;
      const dy = value.position.y - lastPos.y;
      const dz = value.position.z - lastPos.z;

      // 平移所有点
      const allPoints = [
        ...(targetObj.displayPoints || []),
        ...(targetObj.constructionPoints || [])
      ];
      for (const p of allPoints) {
        p.x += dx;
        p.y += dy;
        p.z += dz;
      }

      // 更新 center
      targetObj.center.x = value.position.x;
      targetObj.center.y = value.position.y;
      targetObj.center.z = value.position.z;

      // 更新 centerPoint
      if (targetObj.centerPoint) {
        targetObj.centerPoint.x = value.position.x;
        targetObj.centerPoint.y = value.position.y;
        targetObj.centerPoint.z = value.position.z;
      }

      // 移除 frontDirection 的插值更新，改由 rotateObjectTowardsFront 同步旋转
      // 以保持几何体与方向向量的严格一致性

      // 旋转点云使正面朝向目标方向
      // 使用进度增量计算本帧应旋转的角度
      // 旋转点云（使用预计算的轴和总角度）
      if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
        const lastProgress = targetObj._lastRotProgress || 0;
        const progressDelta = value.progress - lastProgress;

        // 本帧旋转量 = 总角度 * 进度增量
        const rotationAmount = totalAngle * progressDelta;

        if (rotationAmount > 0.0001) {
          // 使用 rotateObjectAroundAxis 替代 rotateObjectTowardsFront
          rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
        }
        targetObj._lastRotProgress = value.progress;
      }

      targetObj._lastAnimPos = { ...value.position };
    }
  });

  moveRotateTask.onComplete = () => {
    obj.animationLock = false;
    obj._lastAnimPos = null;
    obj._lastRotProgress = null;  // 清理旋转进度
    // 动画完成后正式进入 FOCUS 态
    SystemState.interactionState = 'FOCUS';
    console.log('FOCUS 态动画完成，正式进入 FOCUS');
  };

  SystemState.taskQueues.submit(moveRotateTask);

  // 6. 淡化其他物体（包括世界格网）
  for (const other of SystemState.objects) {
    if (other !== obj) {
      other.visualAlpha = 0.05;
      const points = other.displayPoints.length > 0 ? other.displayPoints : other.constructionPoints;
      for (const p of points) {
        p.tag = 'DIMMED';
      }
    }
  }

  // 触发渲染
  SystemState.ifControl = true;
}

/**
 * 旋转物体使其正面逐渐朝向目标方向
 */
function rotateObjectTowardsFront(obj, targetFront, amount) {
  const current = obj.frontDirection;

  // 计算当前朝向与目标朝向的夹角
  const dot = current.x * targetFront.x + current.y * targetFront.y + current.z * targetFront.z;
  // 移除阈值判断，允许微小角度旋转以实现精确对齐
  // if (dot > 0.99) return;

  // 计算旋转轴（叉积）
  const axis = {
    x: current.y * targetFront.z - current.z * targetFront.y,
    y: current.z * targetFront.x - current.x * targetFront.z,
    z: current.x * targetFront.y - current.y * targetFront.x
  };
  const axisLen = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
  if (axisLen < 0.001) return;

  // 归一化旋转轴
  axis.x /= axisLen;
  axis.y /= axisLen;
  axis.z /= axisLen;

  // 旋转所有点
  const center = obj.center;
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;

  const cos = Math.cos(amount);
  const sin = Math.sin(amount);

  for (const p of points) {
    const rx = p.x - center.x;
    const ry = p.y - center.y;
    const rz = p.z - center.z;

    const dotAxis = axis.x * rx + axis.y * ry + axis.z * rz;
    const crossX = axis.y * rz - axis.z * ry;
    const crossY = axis.z * rx - axis.x * rz;
    const crossZ = axis.x * ry - axis.y * rx;

    p.x = center.x + rx * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
    p.y = center.y + ry * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
    p.z = center.z + rz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);
  }

  // 同步旋转 frontDirection（保持与几何体的一致性）
  if (obj.frontDirection) {
    // frontDirection 是向量，相当于绕原点旋转
    const p = obj.frontDirection;
    // 旋转中心为原点 (0,0,0)
    const px = p.x;
    const py = p.y;
    const pz = p.z;

    const dotAxis = axis.x * px + axis.y * py + axis.z * pz;
    const crossX = axis.y * pz - axis.z * py;
    const crossY = axis.z * px - axis.x * pz;
    const crossZ = axis.x * py - axis.y * px;

    p.x = px * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
    p.y = py * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
    p.z = pz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);

    // 归一化
    const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (len > 0) {
      p.x /= len;
      p.y /= len;
      p.z /= len;
    }
  }
}

/**
 * 绕指定轴旋转物体（helper）
 */
function rotateObjectAroundAxis(obj, axis, amount) {
  const cos = Math.cos(amount);
  const sin = Math.sin(amount);
  const center = obj.center;
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;

  for (const p of points) {
    const rx = p.x - center.x;
    const ry = p.y - center.y;
    const rz = p.z - center.z;

    const dotAxis = axis.x * rx + axis.y * ry + axis.z * rz;
    const crossX = axis.y * rz - axis.z * ry;
    const crossY = axis.z * rx - axis.x * rz;
    const crossZ = axis.x * ry - axis.y * rx;

    p.x = center.x + rx * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
    p.y = center.y + ry * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
    p.z = center.z + rz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);
  }

  // 同步旋转 frontDirection
  if (obj.frontDirection) {
    const p = obj.frontDirection;
    // 旋转中心为原点 (0,0,0)
    const px = p.x, py = p.y, pz = p.z;
    const dotAxis = axis.x * px + axis.y * py + axis.z * pz;
    const crossX = axis.y * pz - axis.z * py;
    const crossY = axis.z * px - axis.x * pz;
    const crossZ = axis.x * py - axis.y * px;

    p.x = px * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
    p.y = py * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
    p.z = pz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);

    // 归一化
    const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (len > 0) { p.x /= len; p.y /= len; p.z /= len; }
  }

  // 同步旋转 upDirection
  if (obj.upDirection) {
    const p = obj.upDirection;
    const px = p.x, py = p.y, pz = p.z;
    const dotAxis = axis.x * px + axis.y * py + axis.z * pz;
    const crossX = axis.y * pz - axis.z * py;
    const crossY = axis.z * px - axis.x * pz;
    const crossZ = axis.x * py - axis.y * px;

    p.x = px * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
    p.y = py * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
    p.z = pz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);

    const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (len > 0) { p.x /= len; p.y /= len; p.z /= len; }
  }
}

/**
 * 将物体的 Quaternion 变换应用到所有点坐标上，并将 Quaternion 重置为 Identity
 * 用于在从 EDIT 态（使用 Quaternion）切换回其他态（使用 Points）时同步数据
 */
function applyQuaternionToPoints(obj) {
  if (!obj || !obj.quaternion) return;
  const q = obj.quaternion;

  // 如果接近 Identity，无需处理
  if (Math.abs(q.w - 1) < 0.0001 && Math.abs(q.x) < 0.0001 && Math.abs(q.y) < 0.0001 && Math.abs(q.z) < 0.0001) return;

  const center = obj.center;
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
  const { w, x, y, z } = q;

  // 预计算旋转矩阵参数
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  for (const p of points) {
    const rx = p.x - center.x;
    const ry = p.y - center.y;
    const rz = p.z - center.z;

    // 应用四元数旋转 p' = center + R * p_local
    p.x = center.x + (1 - (yy + zz)) * rx + (xy - wz) * ry + (xz + wy) * rz;
    p.y = center.y + (xy + wz) * rx + (1 - (xx + zz)) * ry + (yz - wx) * rz;
    p.z = center.z + (xz - wy) * rx + (yz + wx) * ry + (1 - (xx + yy)) * rz;
  }

  // 重置四元数
  obj.quaternion = { w: 1, x: 0, y: 0, z: 0 };

  // 局部格网同理
  if (SystemState.localGrid) {
    SystemState.localGrid.quaternion = { w: 1, x: 0, y: 0, z: 0 };
    updateLocalGrid();
  }
}

/**
 * 计算屏幕中心对应的世界坐标
 * 使用 direction.start 作为目标位置（这是屏幕平面上的参考点，代表视窗中心）
 */
function calculateCenterPosition() {
  // 更加鲁棒的计算：将物体放置在逻辑屏幕中心
  // 无论人眼在哪里 (Capital)，FOCUS 态下物体都应该回到 逻辑屏幕中心

  // 逻辑屏幕中心 = direction.start
  // direction.start 是屏幕平面上的参考点，初始化时为 (0, 50, screenCenterHeight)
  // 当用户绕旋转中心旋转时，该点也会同步旋转，因此它始终代表"对用户而言的屏幕中心"

  const dirStart = SystemState.mainWindow.direction.start;

  return {
    x: dirStart.x,
    y: dirStart.y,
    z: dirStart.z
  };
}

/**
 * 退出 FOCUS 态，返回 VIEW 态（阶段10新增）
 */
function exitFocusState() {
  const obj = SystemState.focusedObject;
  if (!obj) {
    enterViewState();
    return;
  }

  // 1. 获取保存的原位置
  const saved = obj.getSavedPosition ? obj.getSavedPosition() : null;
  if (!saved) {
    enterViewState();
    return;
  }

  // 2. 设置动画锁
  obj.animationLock = true;

  // 3. 创建归位动画（位置 + 方向）
  // 3. 创建归位动画（位置 + 方向）
  const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z }

  /**
   * 计算从 Frame A 旋转到 Frame B 所需的旋转轴和角度
   * Frame A: [cFront, cUp]
   * Frame B: [tFront, tUp]
   */
  function calculateRotationFromTwoFrames(cFront, cUp, tFront, tUp) {
    // 1. 构建正交基 A
    const cZ = cFront; // Forward
    const cX_temp = {
      x: cUp.y * cZ.z - cUp.z * cZ.y,
      y: cUp.z * cZ.x - cUp.x * cZ.z,
      z: cUp.x * cZ.y - cUp.y * cZ.x
    }; // Right = Up x Front? 
    // 通常 Right = Front x Up (RH) 或者 Up x Front (LH)?
    // 这里只要一致即可。假设 Right = Up x Front
    let cxLen = Math.sqrt(cX_temp.x ** 2 + cX_temp.y ** 2 + cX_temp.z ** 2);
    const cX = cxLen > 0.001 ?
      { x: cX_temp.x / cxLen, y: cX_temp.y / cxLen, z: cX_temp.z / cxLen } : { x: 1, y: 0, z: 0 }; // Singularity fallback
    const cY = { // Recompute Up = Front x Right
      x: cZ.y * cX.z - cZ.z * cX.y,
      y: cZ.z * cX.x - cZ.x * cX.z,
      z: cZ.x * cX.y - cZ.y * cX.x
    };

    // 2. 构建正交基 B
    const tZ = tFront;
    // 保证 tUp 与 tFront 正交
    // Project tUp onto plane perp to tZ
    // tUp_proj = tUp - (tUp . tZ) * tZ
    const dotTZ = tUp.x * tZ.x + tUp.y * tZ.y + tUp.z * tZ.z;
    const tUp_proj = {
      x: tUp.x - dotTZ * tZ.x,
      y: tUp.y - dotTZ * tZ.y,
      z: tUp.z - dotTZ * tZ.z
    };
    const tX_temp = {
      x: tUp_proj.y * tZ.z - tUp_proj.z * tZ.y,
      y: tUp_proj.z * tZ.x - tUp_proj.x * tZ.z,
      z: tUp_proj.x * tZ.y - tUp_proj.y * tZ.x
    };
    let txLen = Math.sqrt(tX_temp.x ** 2 + tX_temp.y ** 2 + tX_temp.z ** 2);
    const tX = txLen > 0.001 ?
      { x: tX_temp.x / txLen, y: tX_temp.y / txLen, z: tX_temp.z / txLen } : { x: 1, y: 0, z: 0 };
    const tY = {
      x: tZ.y * tX.z - tZ.z * tX.y,
      y: tZ.z * tX.x - tZ.x * tX.z,
      z: tZ.x * tX.y - tZ.y * tX.x
    };

    // 3. 计算旋转矩阵 R = B * A^T
    // A = [cX, cY, cZ], B = [tX, tY, tZ]
    // R[row][col]
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const A = [cX, cY, cZ];
    const B = [tX, tY, tZ];

    for (let i = 0; i < 3; i++) { // Row of B (x, y, z component)
      for (let j = 0; j < 3; j++) { // Col of A (x, y, z component)
        // R_ij = sum_k B_k[i] * A_k[j]  (Wait: A columns are cX, cY, cZ)
        // A^T rows are cX, cY, cZ
        // R = B * A^T
        // R[i][j] = row_i(B) . col_j(A^T) = row_i(B) . row_j(A)
        // row_i(B) = [tX[i], tY[i], tZ[i]]
        // row_j(A) = [cX[j]? No. col_j(A) is vector A[j].
        // A^T's col_j is row_j of A, which is component j of vectors cX, cY, cZ?
        // Let's stick to vector algebra:
        // R * cX = tX
        // R * cY = tY
        // R * cZ = tZ
        // R_row_i . cX = tX_i ...

        // Formula R = sum( B_k * A_k^T ) (outer product summation)
        // R = tX*cX^T + tY*cY^T + tZ*cZ^T
        // R_ij = tX[i]*cX[j] + tY[i]*cY[j] + tZ[i]*cZ[j]

        // accessing component: vector.x is [0], .y is [1]
        const valA_cX = j === 0 ? cX.x : j === 1 ? cX.y : cX.z;
        const valA_cY = j === 0 ? cY.x : j === 1 ? cY.y : cY.z;
        const valA_cZ = j === 0 ? cZ.x : j === 1 ? cZ.y : cZ.z;

        const valB_tX = i === 0 ? tX.x : i === 1 ? tX.y : tX.z;
        const valB_tY = i === 0 ? tY.x : i === 1 ? tY.y : tY.z;
        const valB_tZ = i === 0 ? tZ.x : i === 1 ? tZ.y : tZ.z;

        R[i][j] = valB_tX * valA_cX + valB_tY * valA_cY + valB_tZ * valA_cZ;
      }
    }

    // 4. Extract Axis-Angle
    const tr = R[0][0] + R[1][1] + R[2][2];
    const angle = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));

    let axis = { x: 0, y: 0, z: 1 };
    if (Math.abs(angle) > 0.001) {
      axis.x = R[2][1] - R[1][2];
      axis.y = R[0][2] - R[2][0];
      axis.z = R[1][0] - R[0][1];
      const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
      if (len > 0.001) {
        axis.x /= len; axis.y /= len; axis.z /= len;
      }
    }
    return { axis, angle };
  };
  // 必须归一化当前 frontDirection，否则角度计算错误
  let currentFront = { ...obj.frontDirection };
  const cfLen = Math.sqrt(currentFront.x ** 2 + currentFront.y ** 2 + currentFront.z ** 2);
  if (cfLen > 0) {
    currentFront.x /= cfLen;
    currentFront.y /= cfLen;
    currentFront.z /= cfLen;
  }

  // 获取保存的目标方向（也需归一化）
  let savedFront = obj._savedFrontDirection || obj.frontDirection;
  const sfLen = Math.sqrt(savedFront.x ** 2 + savedFront.y ** 2 + savedFront.z ** 2);
  if (sfLen > 0) {
    // 复制一份以免修改引用
    savedFront = { x: savedFront.x / sfLen, y: savedFront.y / sfLen, z: savedFront.z / sfLen };
  }

  // 确保有 upDirection（兼容性）
  let currentUp = { ...(obj.upDirection || { x: 0, y: 0, z: 1 }) };
  const cuLen = Math.sqrt(currentUp.x ** 2 + currentUp.y ** 2 + currentUp.z ** 2);
  if (cuLen > 0) { currentUp.x /= cuLen; currentUp.y /= cuLen; currentUp.z /= cuLen; }

  // 目标 Up 设为保存的 Up (如果有)，否则默认为 Z 轴
  let targetUp = obj._savedUpDirection ? { ...obj._savedUpDirection } : { x: 0, y: 0, z: 1 };
  const tuLen = Math.sqrt(targetUp.x ** 2 + targetUp.y ** 2 + targetUp.z ** 2);
  if (tuLen > 0) { targetUp.x /= tuLen; targetUp.y /= tuLen; targetUp.z /= tuLen; }

  // 计算 Frame-to-Frame 旋转（同时对齐 Front 和 Up）
  const { axis: rotationAxis, angle: totalAngle } = calculateRotationFromTwoFrames(currentFront, currentUp, savedFront, targetUp);

  // 3. 计算旋转轴长度（用于校验）
  let axisLen = 1; // 假定返回的 axis 已归一化或为默认
  // 如果 totalAngle 接近 0，则 axis 无所谓

  const moveRotateTask = AnimationImpl.createTask({
    id: 'focus_exit_' + Date.now(),
    target: obj,
    duration: 500,
    easing: AnimationImpl.Easing.easeOut,
    compute: (progress) => {
      return {
        progress: progress,
        position: AnimationImpl.lerpVec3(fromPos, saved, progress)
      };
    },
    apply: (targetObj, value) => {
      // 更新位置
      if (targetObj.center) {
        const dx = value.position.x - (targetObj._lastAnimPos?.x ?? fromPos.x);
        const dy = value.position.y - (targetObj._lastAnimPos?.y ?? fromPos.y);
        const dz = value.position.z - (targetObj._lastAnimPos?.z ?? fromPos.z);

        const allPoints = [
          ...(targetObj.displayPoints || []),
          ...(targetObj.constructionPoints || [])
        ];
        for (const p of allPoints) {
          p.x += dx;
          p.y += dy;
          p.z += dz;
        }

        targetObj.center.x = value.position.x;
        targetObj.center.y = value.position.y;
        targetObj.center.z = value.position.z;

        if (targetObj.centerPoint) {
          targetObj.centerPoint.x = value.position.x;
          targetObj.centerPoint.y = value.position.y;
          targetObj.centerPoint.z = value.position.z;
        }
      }

      // 旋转恢复（使用预计算的轴）
      if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
        const lastProgress = targetObj._lastRotProgress || 0;
        const progressDelta = value.progress - lastProgress;

        const rotationAmount = totalAngle * progressDelta;

        if (rotationAmount > 0.0001) {
          // 使用 rotateObjectAroundAxis 替代 rotateObjectTowardsFront
          rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
        }
        targetObj._lastRotProgress = value.progress;
      }

      targetObj._lastAnimPos = { ...value.position };
    }
  });

  moveRotateTask.onComplete = () => {
    obj.animationLock = false;
    obj.clearSavedPosition ? obj.clearSavedPosition() : null;
    obj._savedFrontDirection = null;
    obj._restoreRotationTarget = null;
    obj._lastAnimPos = null;
    obj._lastRotProgress = null;

    // 4. 恢复其他物体

    for (const other of SystemState.objects) {
      if (other !== obj) {
        other.visualAlpha = 1.0;
        const points = other.displayPoints.length > 0 ? other.displayPoints : other.constructionPoints;
        for (const p of points) {
          if (p.tag === 'DIMMED') p.tag = null;
        }
      }
    }

    // 5. 切换到 VIEW 态
    SystemState.interactionState = 'VIEW';
    SystemState.focusedObject = null;
    console.log('返回 VIEW 态');

    // 触发渲染
    SystemState.ifControl = true;
  };

  SystemState.taskQueues.submit(moveRotateTask);
}


/**
 * 旋转 FOCUS 态的聚焦物体（阶段12新增）
 * @param {number} dx - 鼠标水平移动像素
 * @param {number} dy - 鼠标垂直移动像素
 */
function rotateFocusedObject(dx, dy) {
  const obj = SystemState.focusedObject;
  if (!obj) return;
  if (obj.animationLock) return;

  const sensitivity = 0.005;  // 旋转灵敏度

  // 获取视窗的屏幕坐标轴向量
  // vx = 屏幕横向（世界空间）
  // vy = 屏幕纵向（世界空间，向上为正）
  const win = SystemState.mainWindow;
  const screenX = win.vx;  // Vector: 屏幕横向
  const screenY = win.vy;  // Vector: 屏幕纵向（注意：这是指向屏幕下方的，需要取反）

  // 水平拖动 -> 绕屏幕纵向轴（vy，取反后向上）旋转
  // 垂直拖动 -> 绕屏幕横向轴（vx）旋转
  const angleAroundScreenY = -dx * sensitivity;  // 水平拖动绕纵向轴（取反使方向自然）
  const angleAroundScreenX = dy * sensitivity;   // 垂直拖动绕横向轴

  const center = obj.center;
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;

  // 辅助函数：绕任意轴旋转点
  function rotatePointAroundAxis(p, axis, angle, pivot) {
    if (angle === 0) return;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ux = axis.x, uy = axis.y, uz = axis.z;

    // 罗德里格斯旋转公式
    const rx = p.x - pivot.x;
    const ry = p.y - pivot.y;
    const rz = p.z - pivot.z;

    const dot = ux * rx + uy * ry + uz * rz;
    const crossX = uy * rz - uz * ry;
    const crossY = uz * rx - ux * rz;
    const crossZ = ux * ry - uy * rx;

    p.x = pivot.x + rx * cos + crossX * sin + ux * dot * (1 - cos);
    p.y = pivot.y + ry * cos + crossY * sin + uy * dot * (1 - cos);
    p.z = pivot.z + rz * cos + crossZ * sin + uz * dot * (1 - cos);
  }

  // 构造旋转轴（使用视窗向量的归一化形式）
  const axisX = { x: screenX.x, y: screenX.y, z: screenX.z };  // 屏幕横向轴
  const axisY = { x: screenY.x, y: screenY.y, z: screenY.z };  // 屏幕纵向轴（修正：移除负号以反转旋转方向）

  for (const p of points) {
    rotatePointAroundAxis(p, axisY, angleAroundScreenY, center);
    rotatePointAroundAxis(p, axisX, angleAroundScreenX, center);
  }

  // 同步旋转 frontDirection
  if (obj.frontDirection) {
    const origin = { x: 0, y: 0, z: 0 };
    rotatePointAroundAxis(obj.frontDirection, axisY, angleAroundScreenY, origin);
    rotatePointAroundAxis(obj.frontDirection, axisX, angleAroundScreenX, origin);
    // 归一化
    const flen = Math.sqrt(obj.frontDirection.x ** 2 + obj.frontDirection.y ** 2 + obj.frontDirection.z ** 2);
    if (flen > 0) {
      obj.frontDirection.x /= flen; obj.frontDirection.y /= flen; obj.frontDirection.z /= flen;
    }

    // 更新 centerPoint
    if (obj.centerPoint) {
      obj.centerPoint.x = center.x;
      obj.centerPoint.y = center.y;
      obj.centerPoint.z = center.z;
    }
  }

  // 同步旋转 upDirection
  if (obj.upDirection) {
    const origin = { x: 0, y: 0, z: 0 };
    rotatePointAroundAxis(obj.upDirection, axisY, angleAroundScreenY, origin);
    rotatePointAroundAxis(obj.upDirection, axisX, angleAroundScreenX, origin);
    // 归一化
    const ulen = Math.sqrt(obj.upDirection.x ** 2 + obj.upDirection.y ** 2 + obj.upDirection.z ** 2);
    if (ulen > 0) {
      obj.upDirection.x /= ulen; obj.upDirection.y /= ulen; obj.upDirection.z /= ulen;
    }
  }

  // 更新截面轮廓
  updateSliceContour();
}

/**
 * 查找点击位置的表面点（阶段13新增）
 * @param {number} screenX - 屏幕 X 坐标
 * @param {number} screenY - 屏幕 Y 坐标
 * @returns {Point|null} 表面点或 null
 */
function findSurfaceHit(screenX, screenY) {
  const obj = SystemState.focusedObject;
  if (!obj) return null;

  // 使用 grid 查找最近的表面点
  const grid = SystemState.mainWindow.grid;
  const gridsize = SystemState.mainWindow.gridsize;

  const gx = Math.floor(screenX / gridsize);
  const gy = Math.floor(screenY / gridsize);
  const range = 2;  // 搜索 2 格范围

  let nearest = null;
  let minDist = 20;  // 最大搜索半径 20 像素

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const cx = gx + dx;
      const cy = gy + dy;

      if (cx < 0 || cx >= grid.length) continue;
      if (cy < 0 || cy >= grid[cx].length) continue;

      for (const p of grid[cx][cy]) {
        // 跳过 centerPoint（物心点不是表面）
        if (p.isObjectCenter) continue;

        const dist = Math.sqrt(
          (p.xM - screenX) ** 2 + (p.yM - screenY) ** 2
        );

        if (dist < minDist) {
          minDist = dist;
          nearest = p;
        }
      }
    }
  }

  return nearest;
}

/**
 * 计算蓄力冲量（阶段13新增）
 * @param {number} duration - 按压时长（毫秒）
 * @returns {number} 冲量值 (0-1)
 */
function calculateImpulse(duration) {
  // 100ms 以下无冲量（避免误触）
  if (duration < 100) return 0;

  // 2000ms 达到最大冲量
  const maxDuration = 2000;
  const t = Math.min(1, (duration - 100) / (maxDuration - 100));

  // smoothstep 曲线：开始和结束平滑
  const impulse = t * t * (3 - 2 * t);

  return impulse;
}

/**
 * 应用触碰冲量（阶段14完善）
 * @param {number} impulse - 冲量值 (0-1)
 */
function applyTouchImpulse(impulse) {
  const hitPoint = SystemState.chargeHitPoint;
  if (!hitPoint) return;

  const obj = SystemState.focusedObject;
  if (!obj) return;

  // 获取物理状态
  const physicsState = obj.representation?.physicsState;
  if (!physicsState || !physicsState.particles) {
    console.warn('applyTouchImpulse: 物体没有物理状态，使用简化方案');
    // 简化方案：直接修改 displayPoints 位置
    applyTouchImpulseSimple(impulse);
    return;
  }

  // 获取点击点的法向量
  const nx = hitPoint.nx || 0;
  const ny = hitPoint.ny || 0;
  const nz = hitPoint.nz || 0;

  // 检查法向量有效性
  const normalLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalLen < 0.001) {
    console.warn('applyTouchImpulse: 法向量无效');
    return;
  }

  // 归一化法向量
  const normNx = nx / normalLen;
  const normNy = ny / normalLen;
  const normNz = nz / normalLen;

  // 冲量方向：向内（法向量反方向）
  // 冲量强度：impulse * 配置因子
  const impulseFactor = 5.0;  // 冲量强度因子
  const impulseX = -normNx * impulse * impulseFactor;
  const impulseY = -normNy * impulse * impulseFactor;
  const impulseZ = -normNz * impulse * impulseFactor;

  // 影响半径
  const impactRadius = 2.0;

  // 命中点世界坐标
  const hitX = hitPoint.x;
  const hitY = hitPoint.y;
  const hitZ = hitPoint.z;

  // 分配冲量到邻近粒子
  const { particles, surfaceCount } = physicsState;
  let affectedCount = 0;

  for (let i = 0; i < surfaceCount; i++) {
    const p = particles[i];
    if (!p || !p.position || !p.velocity) continue;

    // 计算粒子到命中点的距离
    const dx = p.position.x - hitX;
    const dy = p.position.y - hitY;
    const dz = p.position.z - hitZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < impactRadius) {
      // 距离衰减权重（smoothstep）
      const t = 1 - (dist / impactRadius);
      const weight = t * t * (3 - 2 * t);

      // 应用冲量到速度
      p.velocity.x += impulseX * weight;
      p.velocity.y += impulseY * weight;
      p.velocity.z += impulseZ * weight;

      affectedCount++;
    }
  }

  console.log('应用冲量:', impulse.toFixed(3),
    '方向:', impulseX.toFixed(2), impulseY.toFixed(2), impulseZ.toFixed(2),
    '影响粒子:', affectedCount);

  // 启用物理更新（如果尚未启用）
  if (!obj.physics.enabled) {
    obj.physics.enabled = true;
    console.log('启用物理');
  }

  // 解除动画锁（允许物理更新）
  obj.animationLock = false;

  // 触发渲染
  SystemState.ifControl = true;
}

/**
 * 简化版冲量应用：直接修改 displayPoints 位置（阶段14备用）
 * @param {number} impulse - 冲量值 (0-1)
 */
function applyTouchImpulseSimple(impulse) {
  const hitPoint = SystemState.chargeHitPoint;
  const obj = SystemState.focusedObject;
  if (!hitPoint || !obj) return;

  // 获取法向量
  const nx = hitPoint.nx || 0;
  const ny = hitPoint.ny || 0;
  const nz = hitPoint.nz || 0;
  const normalLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalLen < 0.001) return;

  // 归一化法向量
  const normNx = nx / normalLen;
  const normNy = ny / normalLen;
  const normNz = nz / normalLen;

  // 位移量（向内）
  const displaceAmount = impulse * 0.5;
  const dispX = -normNx * displaceAmount;
  const dispY = -normNy * displaceAmount;
  const dispZ = -normNz * displaceAmount;

  // 影响半径
  const impactRadius = 2.0;
  const hitX = hitPoint.x;
  const hitY = hitPoint.y;
  const hitZ = hitPoint.z;

  // 获取显示点
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
  let affectedCount = 0;

  for (const p of points) {
    const dx = p.x - hitX;
    const dy = p.y - hitY;
    const dz = p.z - hitZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < impactRadius) {
      const t = 1 - (dist / impactRadius);
      const weight = t * t * (3 - 2 * t);

      // 直接修改位置
      p.x += dispX * weight;
      p.y += dispY * weight;
      p.z += dispZ * weight;

      affectedCount++;
    }
  }

  console.log('简化冲量应用:', impulse.toFixed(3), '影响点:', affectedCount);
  SystemState.ifControl = true;
}

// ========================
// 双击检测（阶段10新增）
// ========================
let lastClickTime = 0;
let lastClickTarget = null;
const DOUBLE_CLICK_THRESHOLD = 300; // 毫秒

/**
 * 处理鼠标点击事件（阶段15完善）
 * VIEW 态：双击物心进入 FOCUS 态
 * FOCUS 态：双击物体表面进入 EDIT 态
 */
function onMouseClick(event) {
  const now = Date.now();

  // VIEW 态：双击物心检测（仅当虚拟鼠标吸附到物心时触发）
  if (SystemState.interactionState === 'VIEW') {
    // 检查虚拟鼠标当前吸附的点是否为物心
    const snapped = SystemState.virtualMouse.snappedTo;
    const target = (snapped && snapped.isObjectCenter && snapped.ownerObject)
      ? snapped.ownerObject
      : null;

    if (target && target === lastClickTarget && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
      enterFocusState(target);
    }

    lastClickTime = now;
    lastClickTarget = target;
  }
  // FOCUS 态：双击任意位置进入 EDIT 态（阶段15精简）
  else if (SystemState.interactionState === 'FOCUS') {
    // 整饬修改：不再需要点击物体表面，双击任意位置即可
    if (lastClickTarget === 'focus_click' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
      enterEditState();
    }

    lastClickTime = now;
    lastClickTarget = 'focus_click';
  }
  // EDIT 态：双击空白处新增控制点（阶段16新增）
  else if (SystemState.interactionState === 'EDIT') {
    // 双击空白处新增控制点
    if (lastClickTarget === 'edit_empty' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
      addControlPointAt(event.clientX, event.clientY);
    }

    const cp = findControlPointAt(event.clientX, event.clientY);
    lastClickTime = now;
    lastClickTarget = cp ? 'edit_control' : 'edit_empty';
  }
}

/**
 * 查找点击位置的物心（专门搜索 isObjectCenter 点）
 * @param {number} screenX - 屏幕 X 坐标
 * @param {number} screenY - 屏幕 Y 坐标
 * @returns {Object|null} 物体对象或 null
 */
function findClickedObjectCenter(screenX, screenY) {
  // 扩展搜索最近的物心点（isObjectCenter=true 的点）
  const grid = SystemState.mainWindow.grid;
  const gridsize = SystemState.mainWindow.gridsize;

  const gx = Math.floor(screenX / gridsize);
  const gy = Math.floor(screenY / gridsize);

  let centerPoint = null;
  let minDist = 200;  // 搜索半径 200 像素（增大以匹配投影偏移）

  // 扩展搜索范围
  const maxRange = 10;  // 最大搜索格数
  for (let range = 0; range <= maxRange && !centerPoint; range++) {
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        // 只检查边界格子
        if (Math.abs(dx) !== range && Math.abs(dy) !== range) continue;

        const cx = gx + dx;
        const cy = gy + dy;

        if (cx < 0 || cx >= grid.length) continue;
        if (cy < 0 || cy >= grid[cx].length) continue;

        for (const p of grid[cx][cy]) {
          // 只查找物心点
          if (!p.isObjectCenter) continue;
          if (!p.ownerObject) continue;

          const dist = Math.sqrt((p.xM - screenX) ** 2 + (p.yM - screenY) ** 2);
          if (dist < minDist) {
            minDist = dist;
            centerPoint = p;
          }
        }
      }
    }
  }


  if (centerPoint && centerPoint.ownerObject) {
    return centerPoint.ownerObject;
  }
  return null;
}

/**
 * 进入 EDIT 态（阶段15完善）
 * EDIT 态：编辑模式，可操作控制点
 */
// ========================
// 阶段16新增：局部格网系统
// ========================

/**
 * 局部格网配置 (集中管理，方便调整)
 * 当前为开发测试值，正式版本应根据屏幕尺寸动态计算
 * 
 * 正式版尺寸逻辑：
 * - size = Round(Min(screenWidth, screenHeight) / 10) * 10  (整十cm)
 * - spacing = 1.0  (默认整cm间隔)
 */
const LocalGridConfig = {
  // 格网尺寸 (临时固定 8cm，正式版应为 Round(Min(ScreenW, ScreenH)/10)*10)
  size: 8,           // cm (临时测试值)
  spacing: 2.0,      // cm (临时测试值，正式版为 1.0)

  // 计算属性
  get halfSize() { return this.size / 2; },
  get layerCount() { return Math.floor(this.halfSize / this.spacing); },

  /**
   * 根据姿态类型获取层间距
   * - 面向 (FACE)：层间距 = spacing (沿面法向切)
   * - 棱向 (EDGE)：层间距 = spacing × cos(45°) = spacing / √2 (沿棱切)
   *
   * 棱向面时，格网被旋转45°，沿视线方向的层间距变为原来的 1/√2
   */
  getLayerSpacingForOrientation(orientationType) {
    if (!orientationType) return this.spacing;
    if (orientationType.includes('EDGE')) {
      return this.spacing / Math.SQRT2; // ≈ 1.41cm for 2cm spacing
    }
    return this.spacing;
  },

  /**
   * 根据姿态类型获取最大切片深度
   * - 面向：halfSize (切到面边缘)
   * - 棱向：halfSize × √2 (切到棱边缘，对角线更长)
   */
  getMaxDepthForOrientation(orientationType) {
    if (!orientationType) return this.halfSize;
    if (orientationType.includes('EDGE')) {
      return this.halfSize * Math.SQRT2; // 对角线 ≈ 5.66cm for 8cm
    }
    return this.halfSize; // 面向使用标准 halfSize
  }
};

/**
 * 创建局部格网对象
 * 配置来自 LocalGridConfig
 */
function createLocalGridObject(targetObj) {
  // 使用集中配置
  const finalSize = LocalGridConfig.size;
  const halfSize = LocalGridConfig.halfSize;
  const spacing = LocalGridConfig.spacing;

  console.log(`创建局部格网: 尺寸 ${finalSize}cm, 间距 ${spacing}cm`);

  const points = [];

  // 生成立方体点阵 (保证中心对称, 必须包含 0 点)
  const count = LocalGridConfig.layerCount;

  // 虚线配置：每两个格点之间插入 N 个虚线点
  const dashPointsPerEdge = 3; // 每条边上3个虚线点 (0.5cm 间隔)
  const dashSpacing = spacing / (dashPointsPerEdge + 1); // 0.5cm

  for (let ix = -count; ix <= count; ix++) {
    for (let iy = -count; iy <= count; iy++) {
      for (let iz = -count; iz <= count; iz++) {
        const x = ix * spacing;
        const y = iy * spacing;
        const z = iz * spacing;

        // 创建格点（可吸附）
        const p = new Point(x, y, z);
        p._localX = x;
        p._localY = y;
        p._localZ = z;
        p.isAttractable = true;
        p.tag = 'LOCAL_GRID';
        points.push(p);
      }
    }
  }

  // 生成虚线点（连接相邻格点，不可吸附）
  // 遍历所有格点，向 +X, +Y, +Z 三个方向生成虚线
  for (let ix = -count; ix <= count; ix++) {
    for (let iy = -count; iy <= count; iy++) {
      for (let iz = -count; iz <= count; iz++) {
        const x0 = ix * spacing;
        const y0 = iy * spacing;
        const z0 = iz * spacing;

        // +X 方向 (如果不是边界)
        if (ix < count) {
          for (let d = 1; d <= dashPointsPerEdge; d++) {
            const dp = new Point(x0 + d * dashSpacing, y0, z0);
            dp._localX = dp.x;
            dp._localY = dp.y;
            dp._localZ = dp.z;
            dp.isAttractable = false; // 虚线点不可吸附
            dp.tag = 'LOCAL_GRID_DASH';
            points.push(dp);
          }
        }

        // +Y 方向
        if (iy < count) {
          for (let d = 1; d <= dashPointsPerEdge; d++) {
            const dp = new Point(x0, y0 + d * dashSpacing, z0);
            dp._localX = dp.x;
            dp._localY = dp.y;
            dp._localZ = dp.z;
            dp.isAttractable = false;
            dp.tag = 'LOCAL_GRID_DASH';
            points.push(dp);
          }
        }

        // +Z 方向
        if (iz < count) {
          for (let d = 1; d <= dashPointsPerEdge; d++) {
            const dp = new Point(x0, y0, z0 + d * dashSpacing);
            dp._localX = dp.x;
            dp._localY = dp.y;
            dp._localZ = dp.z;
            dp.isAttractable = false;
            dp.tag = 'LOCAL_GRID_DASH';
            points.push(dp);
          }
        }
      }
    }
  }

  console.log(`局部格网生成: 格点 ${Math.pow(2 * count + 1, 3)}个, 虚线点 ${points.length - Math.pow(2 * count + 1, 3)}个`);

  const gridObj = new Object();
  gridObj.displayPoints = points;
  gridObj.center = { x: targetObj.center.x, y: targetObj.center.y, z: targetObj.center.z };
  // 复制四元数旋转
  if (targetObj.quaternion) {
    gridObj.quaternion = { ...targetObj.quaternion };
  } else {
    gridObj.quaternion = { w: 1, x: 0, y: 0, z: 0 };
  }

  // 标记为局部格网
  gridObj.isLocalGrid = true;
  gridObj.owner = targetObj; // 记录它跟随谁

  return gridObj;
}

/**
 * 更新局部格网（每一帧调用）
 * 确保格网与目标物体位置、姿态完全同步
 * 并根据与屏幕平面的距离设置吸附性和视觉效果（切片反馈）
 */
function updateLocalGrid() {
  const grid = SystemState.localGrid;
  const target = SystemState.focusedObject;
  const win = SystemState.mainWindow;

  if (!grid || !target || !win) return;

  // 1. 同步中心
  grid.center.x = target.center.x;
  grid.center.y = target.center.y;
  grid.center.z = target.center.z;

  // 2. 同步四元数
  // 由于物体可能处于物理旋转模式 (Quaternion=Identity, 但 Vectors 已旋转)
  // 我们必须从 Vectors 推导 Grid 的四元数，以确保 Grid 跟随物体旋转
  if (target.frontDirection && target.upDirection) {
    // 使用 OrientationUtils (假设已加载)
    if (typeof OrientationUtils !== 'undefined' && OrientationUtils.getQuaternionFromVectors) {
      grid.quaternion = OrientationUtils.getQuaternionFromVectors(target.frontDirection, target.upDirection);
    } else {
      // Fallback
      grid.quaternion = { ...target.quaternion };
    }
  } else if (target.quaternion) {
    grid.quaternion = { ...target.quaternion };
  }

  const dir = win.direction; // 视线/屏幕法向
  const planePt = dir.start; // 屏幕平面上的点

  // 3. 更新所有点的位置
  for (const p of grid.displayPoints) {
    if (p._localX === undefined) continue;

    const rotated = applyQuaternion({ x: p._localX, y: p._localY, z: p._localZ }, grid.quaternion);

    p.x = grid.center.x + rotated.x;
    p.y = grid.center.y + rotated.y;
    p.z = grid.center.z + rotated.z;

    // 4. 切片可视性与吸附性计算 (阶段16c改进)
    // 计算点到屏幕平面的距离
    const dist = (p.x - planePt.x) * dir.x +
      (p.y - planePt.y) * dir.y +
      (p.z - planePt.z) * dir.z;

    // 动态阈值：使用当前姿态的层间距的一半
    // 这确保每个层只包含该层的格点，不会与相邻层混淆
    const orientationType = target._currentOrientationState?.type || 'FACE';
    const layerSpacing = LocalGridConfig.getLayerSpacingForOrientation(orientationType);
    const SLICE_THRESHOLD = layerSpacing * 0.6; // 略大于一半，留余量

    // 只有 LOCAL_GRID 格点才可吸附，虚线点永远不可吸附
    if (p.tag === 'LOCAL_GRID' && Math.abs(dist) <= SLICE_THRESHOLD) {
      p.isAttractable = true;
      p._isActiveSlice = true;
    } else {
      p.isAttractable = false;
      p._isActiveSlice = false;
    }
  }
}

/**
 * 四元数旋转辅助函数
 * q: {w, x, y, z}
 * v: {x, y, z}
 */
function applyQuaternion(v, q) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

// ========================
// 阶段16b新增：动画辅助函数
// ========================

/**
 * 动画移动物体到目标位置（切片过渡动画）
 * @param {Object} obj - 物体对象
 * @param {number} targetX - 目标 X 坐标
 * @param {number} targetY - 目标 Y 坐标
 * @param {number} targetZ - 目标 Z 坐标
 * @param {number} duration - 动画时长（毫秒）
 */
function animateSliceTransition(obj, targetX, targetY, targetZ, duration = 150) {
  const startX = obj.center.x;
  const startY = obj.center.y;
  const startZ = obj.center.z;
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const t = Math.min(1, elapsed / duration);

    // 使用 easeOutCubic 缓动
    const eased = 1 - Math.pow(1 - t, 3);

    const newX = startX + (targetX - startX) * eased;
    const newY = startY + (targetY - startY) * eased;
    const newZ = startZ + (targetZ - startZ) * eased;

    // 使用 moveObjectTo 移动物体
    if (typeof moveObjectTo === 'function') {
      moveObjectTo(obj, newX, newY, newZ);
    }

    // 更新局部格网
    updateLocalGrid();
    SystemState.ifControl = true;

    if (t < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

/**
 * 动画旋转物体到目标四元数
 * @param {Object} obj - 物体对象
 * @param {Object} targetQ - 目标四元数 {w, x, y, z}
 * @param {number} duration - 动画时长（毫秒）
 */
function animateRotation(obj, axis, totalAngle, duration = 200) {
  const startTime = performance.now();
  let lastProgress = 0;

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const t = Math.min(1, elapsed / duration);

    // 使用 easeOutCubic 缓动
    const eased = 1 - Math.pow(1 - t, 3);

    // 计算本帧增量
    const progressDelta = eased - lastProgress;
    const angleDelta = totalAngle * progressDelta;

    // 关键修正：直接物理旋转点坐标 (x,y,z) 和 向量 (front/up)
    // 不再使用 quaternion 动画，确保 EDIT 态与 FOCUS/VIEW 态的坐标系一致性
    if (Math.abs(angleDelta) > 0.00001) {
      rotateObjectAroundAxis(obj, axis, angleDelta);
    }

    lastProgress = eased;

    // 同步局部格网 (如果需要)
    // 由于 rotateObjectAroundAxis 更新了 vectors, updateLocalGrid 应该能正确生成
    updateLocalGrid();
    SystemState.ifControl = true;

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      // 动画结束
      // 如果使用虚拟四元数追踪状态，这里不需要回写 obj.quaternion

      // Phase 16c: 旋转结束后，重新对齐到最近的层（确保与屏幕平面对齐）
      snapToNearestLayer(obj);
    }
  }

  requestAnimationFrame(animate);
}

/**
 * Phase 16c: 将物体中心对齐到最近的格网层（与屏幕平面对齐）
 * 
 * 关键：无论当前是什么姿态，都使用该姿态的层间距对齐
 * 
 * 关于动画和误差：
 * - 动画不会造成累积误差，因为目标位置始终是精确计算的 (nearestLayer * layerSpacing)
 * - animateSliceTransition 的最终位置就是这个精确目标
 * - 每次切层都重新计算层索引，确保始终对齐到精确位置
 */
function snapToNearestLayer(obj) {
  const win = SystemState.mainWindow;
  if (!win || !win.direction) return;

  const dir = win.direction;
  const planePt = dir.start;

  // 获取当前姿态类型
  const orientationType = obj._currentOrientationState?.type || 'FACE';

  // 获取该姿态下的有效层间距和最大深度
  const layerSpacing = LocalGridConfig.getLayerSpacingForOrientation(orientationType);
  const maxDepth = LocalGridConfig.getMaxDepthForOrientation(orientationType);

  console.log(`[SnapLayer] Type: ${orientationType}, Spacing: ${layerSpacing.toFixed(3)}cm`);

  // 计算当前物体中心到屏幕平面的距离
  const currentDist = (obj.center.x - planePt.x) * dir.x +
    (obj.center.y - planePt.y) * dir.y +
    (obj.center.z - planePt.z) * dir.z;

  // 计算最近的有效层索引（精确计算，无误差）
  let nearestLayer = Math.round(currentDist / layerSpacing);

  // 限制层索引在有效范围内（最大层 = maxDepth / layerSpacing）
  const maxLayer = Math.floor(maxDepth / layerSpacing);
  nearestLayer = Math.max(-maxLayer, Math.min(maxLayer, nearestLayer));

  // 目标位置 = 精确的层索引 × 层间距（无累积误差）
  const nearestLayerDist = nearestLayer * layerSpacing;

  // 计算需要移动的距离
  const delta = nearestLayerDist - currentDist;

  // 执行对齐动画
  if (Math.abs(delta) > 0.001) {
    const targetX = obj.center.x + delta * dir.x;
    const targetY = obj.center.y + delta * dir.y;
    const targetZ = obj.center.z + delta * dir.z;

    // 使用动画过渡到精确目标位置
    animateSliceTransition(obj, targetX, targetY, targetZ, 150);

    console.log(`Layer snap (${orientationType}): ${currentDist.toFixed(2)}cm -> Layer ${nearestLayer} (${nearestLayerDist.toFixed(2)}cm)`);
  }
}

// ========================
// 阶段16c：综合离散姿态系统 (96+ 态，视窗相对)
// ========================

const OrientationUtils = {
  // 当前视窗方向下的标准姿态列表
  STATES: [],
  _lastViewDir: null, // 缓存上次视窗方向避免重复计算

  /**
   * 根据当前视窗方向计算所有标准姿态
   * 姿态是相对于视窗坐标系的：
   * - 视窗 Z 轴 = 视线方向 (direction)
   * - 视窗 Y 轴 = 世界上方 (0,0,1) 去除视线分量
   * - 视窗 X 轴 = Y × Z
   */
  computeStatesForView() {
    const win = SystemState.mainWindow;
    if (!win || !win.direction) {
      // 默认视窗：朝 +Y 看
      this._computeStatesWithViewBasis(
        { x: 1, y: 0, z: 0 },  // viewX
        { x: 0, y: 0, z: 1 },  // viewY (up)
        { x: 0, y: 1, z: 0 }   // viewZ (forward)
      );
      return;
    }

    const dir = win.direction;
    // 检查是否需要重新计算
    if (this._lastViewDir &&
      Math.abs(this._lastViewDir.x - dir.x) < 0.001 &&
      Math.abs(this._lastViewDir.y - dir.y) < 0.001 &&
      Math.abs(this._lastViewDir.z - dir.z) < 0.001) {
      return; // 视窗方向未变，使用缓存
    }

    // 视窗 Z 轴 = 视线方向 (归一化)
    const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
    const viewZ = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

    // 视窗 Y 轴 = 世界上方 (0,0,1) 去除视线分量
    const worldUp = { x: 0, y: 0, z: 1 };
    const dotUp = worldUp.x * viewZ.x + worldUp.y * viewZ.y + worldUp.z * viewZ.z;
    let viewY = {
      x: worldUp.x - dotUp * viewZ.x,
      y: worldUp.y - dotUp * viewZ.y,
      z: worldUp.z - dotUp * viewZ.z
    };
    const lenY = Math.sqrt(viewY.x ** 2 + viewY.y ** 2 + viewY.z ** 2);
    if (lenY < 0.001) {
      // 视线垂直向上或向下，使用世界 Y 作为备选
      viewY = { x: 0, y: 1, z: 0 };
    } else {
      viewY = { x: viewY.x / lenY, y: viewY.y / lenY, z: viewY.z / lenY };
    }

    // 视窗 X 轴 = Y × Z
    const viewX = {
      x: viewY.y * viewZ.z - viewY.z * viewZ.y,
      y: viewY.z * viewZ.x - viewY.x * viewZ.z,
      z: viewY.x * viewZ.y - viewY.y * viewZ.x
    };

    this._computeStatesWithViewBasis(viewX, viewY, viewZ);
    this._lastViewDir = { x: dir.x, y: dir.y, z: dir.z };
  },

  /**
   * 使用给定的视窗坐标系基向量计算 96 个标准姿态
   */
  _computeStatesWithViewBasis(viewX, viewY, viewZ) {
    this.STATES = [];

    // 从视窗坐标系构建旋转矩阵 -> 四元数
    // 视窗坐标系相对于世界坐标系的旋转
    const viewQ = this._matrixToQuaternion(viewX, viewY, viewZ);

    // 基础 6 面姿态 (相对视窗坐标系的欧拉角)
    const faceOrientations = [
      { axis: 'Front', pitch: 0, yaw: 0 },
      { axis: 'Back', pitch: 0, yaw: 180 },
      { axis: 'Left', pitch: 0, yaw: 90 },
      { axis: 'Right', pitch: 0, yaw: -90 },
      { axis: 'Top', pitch: 90, yaw: 0 },
      { axis: 'Bottom', pitch: -90, yaw: 0 }
    ];

    // 12 条物理棱 (统一类型 EDGE，添加 baseVisual 属性)
    // baseVisual: 'H' = roll=0° 时看起来横向, 'V' = roll=0° 时看起来竖向
    const edgeOrientations = [
      // Top face 4 edges
      { axis: 'Top-Front', pitch: 45, yaw: 0, baseVisual: 'H' },
      { axis: 'Top-Back', pitch: 45, yaw: 180, baseVisual: 'H' },
      { axis: 'Top-Left', pitch: 45, yaw: 90, baseVisual: 'H' },
      { axis: 'Top-Right', pitch: 45, yaw: -90, baseVisual: 'H' },
      // Bottom face 4 edges
      { axis: 'Bottom-Front', pitch: -45, yaw: 0, baseVisual: 'H' },
      { axis: 'Bottom-Back', pitch: -45, yaw: 180, baseVisual: 'H' },
      { axis: 'Bottom-Left', pitch: -45, yaw: 90, baseVisual: 'H' },
      { axis: 'Bottom-Right', pitch: -45, yaw: -90, baseVisual: 'H' },
      // Vertical 4 edges (connecting top to bottom)
      { axis: 'Front-Left', pitch: 0, yaw: 45, baseVisual: 'V' },
      { axis: 'Front-Right', pitch: 0, yaw: -45, baseVisual: 'V' },
      { axis: 'Back-Left', pitch: 0, yaw: 135, baseVisual: 'V' },
      { axis: 'Back-Right', pitch: 0, yaw: -135, baseVisual: 'V' }
    ];

    // 生成 48 个面态 (6 面 × 8 滚转 positions: 0°, 45°, 90°, ... 315°)
    for (const face of faceOrientations) {
      // 基础姿态 (Pitch/Yaw relative to View)
      // 注意：这里 roll 设为 0
      const baseLocalQ = this.eulerToQuaternion(face.pitch, face.yaw, 0);

      for (let rollIdx = 0; rollIdx < 8; rollIdx++) {
        const roll = rollIdx * 45;
        // 滚转四元数 (绕 View Z 轴旋转)
        // 必须后乘 (Post-multiply) 以在 View 坐标系中应用滚转
        // 或者说：先应用基础姿态，再绕当前的 Z 轴 (即 View Z) 滚转？
        // 如果是 q_new = q_roll * q_base，则是绕世界/视窗 Z 轴 (取决于参考系)。
        // 这里的 quaternion 是相对于 View 坐标系的。
        // View Q 是 Identitiy (在 View Space 中)。
        // 所以 q_roll * q_base 是绕 View Z 轴旋转。

        const rollQ = this.eulerToQuaternion(0, 0, roll);

        // localQ = rollQ * baseLocalQ (注意乘法顺序可能从左到右或右到左，这里假设 standard: A*B means B then A? 
        // 还是 A*B means A applied to B?
        // _multiplyQuaternion 实现是: w = a.w*b.w - ...
        // 通常 q2 * q1 代表：先旋转 q1，再旋转 q2 (如果 q v q*)
        // 我们希望先摆正 Face (baseQ)，再 Roll (rollQ)。
        // 所以应该 rollQ * baseQ。

        const localQ = this._multiplyQuaternion(rollQ, baseLocalQ);

        // 变换到世界坐标系: worldQ = viewQ * localQ
        const worldQ = this._multiplyQuaternion(viewQ, localQ);

        this.STATES.push({
          type: 'FACE',
          axis: face.axis,
          roll: roll,
          euler: [face.pitch, face.yaw, roll],
          q: worldQ
        });
      }
    }

    // 生成 48 个棱态 (12 棱 × 4 滚转 positions: 0°, 90°, 180°, 270°)
    for (const edge of edgeOrientations) {
      // 基础姿态
      const baseLocalQ = this.eulerToQuaternion(edge.pitch, edge.yaw, 0);

      for (let rollIdx = 0; rollIdx < 4; rollIdx++) {
        const roll = rollIdx * 90;

        // 计算视觉朝向: roll=0°/180° 保持原样, roll=90°/270° 翻转
        // H + roll 0/180 = H, H + roll 90/270 = V
        // V + roll 0/180 = V, V + roll 90/270 = H
        const isFlipped = (roll === 90 || roll === 270);
        const visualOrientation = isFlipped
          ? (edge.baseVisual === 'H' ? 'V' : 'H')
          : edge.baseVisual;

        // 同样应用 Roll * Base
        const rollQ = this.eulerToQuaternion(0, 0, roll);
        const localQ = this._multiplyQuaternion(rollQ, baseLocalQ);
        const worldQ = this._multiplyQuaternion(viewQ, localQ);

        this.STATES.push({
          type: 'EDGE',  // 统一类型
          axis: edge.axis,
          roll: roll,
          baseVisual: edge.baseVisual,
          visualOrientation: visualOrientation, // 'H' 或 'V'
          euler: [edge.pitch, edge.yaw, roll],
          q: worldQ
        });
      }
    }

    console.log(`OrientationUtils: 计算了 ${this.STATES.length} 个标准姿态 (视窗相对)`);
  },

  /**
   * 从正交基向量构建四元数
   */
  _matrixToQuaternion(xAxis, yAxis, zAxis) {
    // 旋转矩阵的列是新坐标系的基向量
    // M = [xAxis | yAxis | zAxis]
    const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
    const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
    const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;

    const trace = m00 + m11 + m22;
    let w, x, y, z;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      w = 0.25 / s;
      x = (m21 - m12) * s;
      y = (m02 - m20) * s;
      z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
      w = (m21 - m12) / s;
      x = 0.25 * s;
      y = (m01 + m10) / s;
      z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
      w = (m02 - m20) / s;
      x = (m01 + m10) / s;
      y = 0.25 * s;
      z = (m12 + m21) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
      w = (m10 - m01) / s;
      x = (m02 + m20) / s;
      y = (m12 + m21) / s;
      z = 0.25 * s;
    }

    return this.normalize({ w, x, y, z });
  },

  /**
   * 四元数乘法 a * b
   */
  _multiplyQuaternion(a, b) {
    return {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    };
  },

  // 欧拉角转四元数 (Degree) -> {w, x, y, z}
  // Order: YXZ (Pitch-X, Yaw-Y, Roll-Z)
  eulerToQuaternion(pitch, yaw, roll) {
    const c1 = Math.cos(pitch * Math.PI / 360);
    const s1 = Math.sin(pitch * Math.PI / 360);
    const c2 = Math.cos(yaw * Math.PI / 360);
    const s2 = Math.sin(yaw * Math.PI / 360);
    const c3 = Math.cos(roll * Math.PI / 360);
    const s3 = Math.sin(roll * Math.PI / 360);

    return {
      w: c1 * c2 * c3 - s1 * s2 * s3,
      x: s1 * c2 * c3 + c1 * s2 * s3,
      y: c1 * s2 * c3 - s1 * c2 * s3,
      z: c1 * c2 * s3 + s1 * s2 * c3
    };
  },

  // 找到最近的姿态 (视窗相对)
  // allowedTypes: 可选，字符串数组，指定允许匹配的类型 (e.g. ['FACE', 'EDGE'])
  // requireRolled: FACE 滚转过滤 (true=旋转态, false=端正态, null=不限)
  // requireVisual: EDGE 视觉朝向过滤 ('H'=横向, 'V'=竖向, null=不限)
  getNearestState(currentQ, allowedTypes = null, requireRolled = null, requireVisual = null) {
    // 每次调用都重新计算视窗相对姿态
    this.computeStatesForView();

    let bestState = null;
    let maxDot = -1;

    // Debug: 记录前3个候选
    const candidates = [];

    for (const state of this.STATES) {
      // 如果指定了允许类型，跳过不匹配的
      if (allowedTypes && !allowedTypes.includes(state.type)) {
        continue;
      }

      // 如果指定了 requireRolled，过滤 FACE 的 roll 状态
      if (requireRolled !== null && state.type === 'FACE') {
        const isRolled = (state.roll % 90 !== 0);
        if (requireRolled && !isRolled) continue; // 要求旋转态，但这个是端正态
        if (!requireRolled && isRolled) continue; // 要求端正态，但这个是旋转态
      }

      // 如果指定了 requireVisual，过滤 EDGE 的 visualOrientation
      if (requireVisual !== null && state.type === 'EDGE') {
        if (state.visualOrientation !== requireVisual) continue;
      }

      // 四元数点积衡量相似度
      const dot = Math.abs(
        currentQ.w * state.q.w +
        currentQ.x * state.q.x +
        currentQ.y * state.q.y +
        currentQ.z * state.q.z
      );

      if (dot > maxDot) {
        maxDot = dot;
        bestState = state;
      }

      candidates.push({ state: state, dot: dot });
    }

    // 排序并打印前3个候选
    candidates.sort((a, b) => b.dot - a.dot);
    const top3 = candidates.slice(0, 3);
    const filterMsg = allowedTypes ? ` [Type:${allowedTypes}]` : '';
    const rollMsg = requireRolled !== null ? ` [Roll:${requireRolled ? 'R' : 'Std'}]` : '';
    console.log(`[NearestState] Top matches${filterMsg}${rollMsg}:`);
    top3.forEach((c, i) => {
      const rollStr = (c.state.roll % 90 !== 0) ? `(R ${c.state.roll}°)` : '';
      console.log(`  ${i + 1}. ${c.state.type} ${c.state.axis} ${rollStr} (dot=${c.dot.toFixed(5)})`);
    });

    return bestState;
  },

  // 插值动画 (Slerp)
  slerp(qa, qb, t) {
    // 简化版 Slerp
    let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;

    // 反转 qb 如果点积为负 (走短路径)
    let sign = 1;
    if (dot < 0) {
      dot = -dot;
      sign = -1;
    }

    if (dot > 0.9995) {
      // 线性插值
      const result = {
        w: qa.w + t * (sign * qb.w - qa.w),
        x: qa.x + t * (sign * qb.x - qa.x),
        y: qa.y + t * (sign * qb.y - qa.y),
        z: qa.z + t * (sign * qb.z - qa.z)
      };
      return this.normalize(result);
    }

    const theta_0 = Math.acos(dot);
    const theta = theta_0 * t;
    const sin_theta = Math.sin(theta);
    const sin_theta_0 = Math.sin(theta_0);

    const s0 = Math.cos(theta) - dot * sin_theta / sin_theta_0;
    const s1 = sin_theta / sin_theta_0;

    return {
      w: s0 * qa.w + s1 * sign * qb.w,
      x: s0 * qa.x + s1 * sign * qb.x,
      y: s0 * qa.y + s1 * sign * qb.y,
      z: s0 * qa.z + s1 * sign * qb.z
    };
  },

  normalize(q) {
    const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
    if (len === 0) return { w: 1, x: 0, y: 0, z: 0 };
    return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
  },

  // 状态流转逻辑 (阶段16核心)
  transition(key, obj) {
    // 物理旋转模式下，obj.quaternion 始终为 Identity。
    // 我们需要从当前向量推导"虚拟四元数"来追踪状态。
    const currentQ = this.getQuaternionFromVectors(obj.frontDirection, obj.upDirection);

    // 1. 获取当前状态 (如果没有则重新吸附)
    let currentState = obj._currentOrientationState;
    if (!currentState) {
      currentState = this.getNearestState(currentQ);
      if (!currentState) return;
      obj._currentOrientationState = currentState;
    }

    const type = currentState.type;
    let axis = null; // {x, y, z} in WORLD space
    let angle = 0;   // degree

    // 2. 计算视窗坐标系的基向量 (相对于当前视窗方向)
    // viewZ = 视线方向 (屏幕垂直轴，指向屏幕内)
    // viewY = 屏幕竖轴 (屏幕正上)
    // viewX = 屏幕横轴 (屏幕正右)
    const win = SystemState.mainWindow;
    let viewZ, viewY, viewX;

    if (win && win.direction) {
      const dir = win.direction;
      // viewZ = 视线方向 (归一化)
      const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
      viewZ = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

      // viewY = 世界上方 (0,0,1) 去除视线分量后归一化
      const worldUp = { x: 0, y: 0, z: 1 };
      const dotUp = worldUp.x * viewZ.x + worldUp.y * viewZ.y + worldUp.z * viewZ.z;
      viewY = {
        x: worldUp.x - dotUp * viewZ.x,
        y: worldUp.y - dotUp * viewZ.y,
        z: worldUp.z - dotUp * viewZ.z
      };
      const lenY = Math.sqrt(viewY.x ** 2 + viewY.y ** 2 + viewY.z ** 2);
      if (lenY < 0.001) {
        // 视线垂直向上或向下，使用世界 Y 作为备选
        viewY = { x: 0, y: 1, z: 0 };
      } else {
        viewY = { x: viewY.x / lenY, y: viewY.y / lenY, z: viewY.z / lenY };
      }

      // viewX = viewY × viewZ (屏幕右方向)
      viewX = {
        x: viewY.y * viewZ.z - viewY.z * viewZ.y,
        y: viewY.z * viewZ.x - viewY.x * viewZ.z,
        z: viewY.x * viewZ.y - viewY.y * viewZ.x
      };
    } else {
      // 默认视窗：朝 +Y 看
      viewX = { x: 1, y: 0, z: 0 };
      viewY = { x: 0, y: 0, z: 1 };
      viewZ = { x: 0, y: 1, z: 0 };
    }

    // 3. 根据按键选择旋转轴 (使用视窗坐标系)
    // WS: 绕屏幕横轴 (viewX) 旋转 - Pitch
    // AD: 绕屏幕竖轴 (viewY) 旋转 - Yaw
    // QE: 绕屏幕垂直轴 (viewZ) 旋转 - Roll

    // 判断是否是旋转后的面态 (roll 为 45°, 135°, 225°, 315° 时)
    const isRolledFace = type === 'FACE' && currentState.roll !== undefined &&
      (currentState.roll % 90 !== 0);
    const isStandardFace = type === 'FACE' && !isRolledFace;

    // 判断 EDGE 的视觉朝向
    const isEdgeH = type === 'EDGE' && currentState.visualOrientation === 'H';
    const isEdgeV = type === 'EDGE' && currentState.visualOrientation === 'V';

    // allowedTypes: 过滤允许的状态类型
    // requireRolled: FACE 滚转过滤 (true=旋转态, false=端正态, null=不限)
    // requireVisual: EDGE 视觉朝向过滤 ('H'=横向, 'V'=竖向, null=不限)
    let allowedTypes = null;
    let requireRolled = null;
    let requireVisual = null;

    // ============================================
    // 规则表 (统一使用 EDGE 类型 + visualOrientation)
    // ============================================
    // FACE(端正) + W/S → 45° → EDGE(视觉=H)
    // FACE(端正) + A/D → 45° → EDGE(视觉=V)
    // FACE(端正) + Q/E → 45° → FACE(旋转)
    // FACE(旋转) + W/S → 90° → EDGE(视觉=V)
    // FACE(旋转) + A/D → 90° → EDGE(视觉=H)
    // FACE(旋转) + Q/E → 45° → FACE(继续旋转)
    // EDGE(视觉=H) + W/S → 45° → FACE(端正)
    // EDGE(视觉=H) + A/D → 90° → FACE(旋转)
    // EDGE(视觉=H) + Q/E → 90° → EDGE(视觉=V)
    // EDGE(视觉=V) + W/S → 90° → FACE(旋转)
    // EDGE(视觉=V) + A/D → 45° → FACE(端正)
    // EDGE(视觉=V) + Q/E → 90° → EDGE(视觉=H)
    // ============================================

    if (key === 'w') { // Pitch Up
      axis = viewX;
      if (isStandardFace) {
        angle = 45;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      } else if (isRolledFace) {
        angle = 90;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isEdgeH) {
        angle = 45;
        allowedTypes = ['FACE'];
        requireRolled = false; // FACE(端正)
      } else if (isEdgeV) {
        angle = 90;
        allowedTypes = ['FACE'];
        requireRolled = true; // FACE(旋转)
      }

    } else if (key === 's') { // Pitch Down
      axis = viewX;
      if (isStandardFace) {
        angle = -45;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      } else if (isRolledFace) {
        angle = -90;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isEdgeH) {
        angle = -45;
        allowedTypes = ['FACE'];
        requireRolled = false;
      } else if (isEdgeV) {
        angle = -90;
        allowedTypes = ['FACE'];
        requireRolled = true;
      }

    } else if (key === 'a') { // Yaw Left
      axis = viewY;
      if (isStandardFace) {
        angle = 45;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isRolledFace) {
        angle = 90;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      } else if (isEdgeH) {
        angle = 90;
        allowedTypes = ['FACE'];
        requireRolled = true; // FACE(旋转)
      } else if (isEdgeV) {
        angle = 45;
        allowedTypes = ['FACE'];
        requireRolled = false; // FACE(端正)
      }

    } else if (key === 'd') { // Yaw Right
      axis = viewY;
      if (isStandardFace) {
        angle = -45;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isRolledFace) {
        angle = -90;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      } else if (isEdgeH) {
        angle = -90;
        allowedTypes = ['FACE'];
        requireRolled = true;
      } else if (isEdgeV) {
        angle = -45;
        allowedTypes = ['FACE'];
        requireRolled = false;
      }

    } else if (key === 'q') { // Roll Left
      axis = viewZ;
      if (type === 'FACE') {
        angle = 45;
        allowedTypes = ['FACE']; // 继续旋转
      } else if (isEdgeH) {
        angle = 90;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isEdgeV) {
        angle = 90;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      }

    } else if (key === 'e') { // Roll Right
      axis = viewZ;
      if (type === 'FACE') {
        angle = -45;
        allowedTypes = ['FACE'];
      } else if (isEdgeH) {
        angle = -90;
        allowedTypes = ['EDGE'];
        requireVisual = 'V';
      } else if (isEdgeV) {
        angle = -90;
        allowedTypes = ['EDGE'];
        requireVisual = 'H';
      }
    }


    if (!axis) return;

    // 3. 执行旋转 (使用轴角转四元数，因为轴是任意世界坐标向量)
    const angleRad = angle * Math.PI / 180;
    const halfAngle = angleRad / 2;
    const sinHalf = Math.sin(halfAngle);
    const rotQ = {
      w: Math.cos(halfAngle),
      x: axis.x * sinHalf,
      y: axis.y * sinHalf,
      z: axis.z * sinHalf
    };

    // Quaternion multiplication: RotQ * CurrentQ (注意乘法顺序，局部旋转 vs 世界旋转?)
    // 这里的 axis 是根据 View 计算的世界轴。
    // 所以是 World Rotation: NewQ = RotQ * CurrentQ

    const qa = rotQ;
    const qb = currentQ; // 使用虚拟四元数

    const newQ = {
      w: qa.w * qb.w - qa.x * qb.x - qa.y * qb.y - qa.z * qb.z,
      x: qa.w * qb.x + qa.x * qb.w + qa.y * qb.z - qa.z * qb.y,
      y: qa.w * qb.y - qa.x * qb.z + qa.y * qb.w + qa.z * qb.x,
      z: qa.w * qb.z + qa.x * qb.y - qa.y * qb.x + qa.z * qb.w
    };

    // 4. 吸附到最近的标准态 (根据预测的 NewQ 查找)
    const nextState = this.getNearestState(newQ, allowedTypes, requireRolled, requireVisual);
    if (nextState) {
      // 输出简洁日志
      const fromInfo = isRolledFace ? '(R)' : (isStandardFace ? '' : '');
      const toRollInfo = (nextState.roll % 90 !== 0) ? '(R)' : '';

      let targetInfo = '';
      if (allowedTypes) {
        targetInfo = ` → Expect:${allowedTypes[0]}`;
        if (requireRolled !== null) targetInfo += requireRolled ? '(R)' : '(Std)';
        if (requireVisual !== null) targetInfo += `(${requireVisual})`;
      }

      console.log(`[ROTATE] ${type}${fromInfo} + ${key.toUpperCase()} ${angle}° → ${nextState.type}${toRollInfo} (${nextState.axis}) [Vis:${nextState.visualOrientation || '-'}]${targetInfo}`);

      // Phase 16b: 使用物理动画过渡到目标姿态
      obj._currentOrientationState = nextState;

      // 传递轴和弧度给物理动画函数
      // 注意：轴必须归一化
      let animAxis = { ...axis };
      const axisLen = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
      if (axisLen > 0.001) {
        animAxis.x /= axisLen; animAxis.y /= axisLen; animAxis.z /= axisLen;
      }

      animateRotation(obj, animAxis, angleRad, 200);
    }
  },

  /**
   * 更新物体的所有姿态属性 (Quaternion + Vectors)
   * 确保 frontDirection 和 upDirection 与 quaternion 保持一致
   */
  updateObjectOrientation(obj, q) {
    if (!obj || !q) return;

    // 1. 更新四元数
    obj.quaternion = { ...q };

    // 2. 从四元数推导前向和上向向量
    // Q * (0,1,0) -> front
    // Q * (0,0,1) -> up
    // 假设初始状态: Front=(0,1,0), Up=(0,0,1)

    // 旋转向量 v = q * v0 * q_conj
    // 简化计算：
    // x' = x(1 - 2yy - 2zz) + y(2xy - 2wz) + z(2xz + 2wy)
    // y' = x(2xy + 2wz) + y(1 - 2xx - 2zz) + z(2yz - 2wx)
    // z' = x(2xz - 2wy) + y(2yz + 2wx) + z(1 - 2xx - 2yy)

    const { w, x, y, z } = q;

    // Front (0, -1, 0)  <-- 修正：基础朝向是 -Y
    // 旋转向量 (0, 1, 0) 是: [2(xy-wz), 1-2(xx+zz), 2(yz+wx)]
    // 所以 (0, -1, 0) 取反:
    obj.frontDirection = {
      x: -2 * (x * y - w * z),
      y: -(1 - 2 * (x * x + z * z)),
      z: -2 * (y * z + w * x)
    };

    // Up (0, 0, 1) <-- 保持不变
    obj.upDirection = {
      x: 2 * (x * z + w * y),
      y: 2 * (y * z - w * x),
      z: 1 - 2 * (x * x + y * y)
    };

    // 归一化以防万一
    const norm = (v) => {
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (len > 0) { v.x /= len; v.y /= len; v.z /= len; }
    };
    norm(obj.frontDirection);
    norm(obj.upDirection);
  },

  /**
   * 从 frontDirection + upDirection 计算完整四元数
   * 用于在物理旋转模式下计算"虚拟四元数"以进行状态匹配
   */
  getQuaternionFromVectors(frontDir, upDir) {
    const defaultFront = { x: 0, y: 1, z: 0 };
    const defaultUp = { x: 0, y: 0, z: 1 };

    let front = frontDir ? { ...frontDir } : { ...defaultFront };
    let up = upDir ? { ...upDir } : { ...defaultUp };

    // 归一化
    let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
    if (lenF < 0.001) front = { ...defaultFront };
    else { front.x /= lenF; front.y /= lenF; front.z /= lenF; }

    let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
    if (lenU < 0.001) up = { ...defaultUp };
    else { up.x /= lenU; up.y /= lenU; up.z /= lenU; }

    // 正交化 Right = Front x Up
    // 注意：这里 Front 是 vector。
    // 如果 Base Front 是 (0, -1, 0)，那么 transform matrix 应该是从 Base 旋转到 Current。
    // 旋转矩阵列向量：
    // Col 1 (Right): ?
    // Col 2 (Front): ?
    // Col 3 (Up): ?

    // 我们的 updateObjectOrientation 假定 Base Front 是 (0, -1, 0)
    // 所以 R * (0, -1, 0) = CurrentFront
    // => - (R * Y_axis) = CurrentFront
    // => R * Y_axis = -CurrentFront
    // 所以矩阵的第2列 (Y) 应该是 -CurrentFront

    // Up 是 (0, 0, 1)。 R * Z_axis = CurrentUp。
    // 所以矩阵第3列 (Z) 应该是 CurrentUp

    // Right (X) = Y x Z.
    // X = (-CurrentFront) x CurrentUp
    //   = - (Front x Up) = Up x Front

    let negFront = { x: -front.x, y: -front.y, z: -front.z };
    let colY = negFront;
    let colZ = up;

    let colX = {
      x: colY.y * colZ.z - colY.z * colZ.y,
      y: colY.z * colZ.x - colY.x * colZ.z,
      z: colY.x * colZ.y - colY.y * colZ.x
    };

    // 归一化 X
    let lenX = Math.sqrt(colX.x ** 2 + colX.y ** 2 + colX.z ** 2);
    if (lenX < 0.001) colX = { x: 1, y: 0, z: 0 };
    else { colX.x /= lenX; colX.y /= lenX; colX.z /= lenX; }

    // 重新计算 Y 确保正交 (Y = Z x X)
    colY = {
      x: colZ.y * colX.z - colZ.z * colX.y,
      y: colZ.z * colX.x - colZ.x * colX.z,
      z: colZ.x * colX.y - colZ.y * colX.x
    };

    // 矩阵转四元数
    // M = [colX, colY, colZ]
    const m00 = colX.x, m01 = colY.x, m02 = colZ.x;
    const m10 = colX.y, m11 = colY.y, m12 = colZ.y;
    const m20 = colX.z, m21 = colY.z, m22 = colZ.z;

    const trace = m00 + m11 + m22;
    let q = { w: 1, x: 0, y: 0, z: 0 };

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      q.w = 0.25 / s;
      q.x = (m21 - m12) * s;
      q.y = (m02 - m20) * s;
      q.z = (m10 - m01) * s;
    } else {
      if (m00 > m11 && m00 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
        q.w = (m21 - m12) / s;
        q.x = 0.25 * s;
        q.y = (m01 + m10) / s;
        q.z = (m02 + m20) / s;
      } else if (m11 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
        q.w = (m02 - m20) / s;
        q.x = (m01 + m10) / s;
        q.y = 0.25 * s;
        q.z = (m12 + m21) / s;
      } else {
        const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
        q.w = (m10 - m01) / s;
        q.x = (m02 + m20) / s;
        q.y = (m12 + m21) / s;
        q.z = 0.25 * s;
      }
    }
    return q;
  }
};

/**
 * 自动吸附到最近的规范化姿态（96态之一）
 * 从物体的 frontDirection + upDirection 计算完整四元数
 * Phase 16c: 使用双向量匹配
 */
function snapToNearestOrientation(obj) {
  // 1. 从 frontDirection + upDirection 计算完整四元数
  // 使用正交化构建旋转矩阵
  const defaultFront = { x: 0, y: 1, z: 0 };
  const defaultUp = { x: 0, y: 0, z: 1 };

  let front = obj.frontDirection || { ...defaultFront };
  let up = obj.upDirection || { ...defaultUp };

  // 归一化 front
  let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
  if (lenF < 0.001) front = { ...defaultFront };
  else front = { x: front.x / lenF, y: front.y / lenF, z: front.z / lenF };

  // 归一化 up
  let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
  if (lenU < 0.001) up = { ...defaultUp };
  else up = { x: up.x / lenU, y: up.y / lenU, z: up.z / lenU };

  // 使用 Gram-Schmidt 正交化确保正交
  // right = front × up
  let right = {
    x: front.y * up.z - front.z * up.y,
    y: front.z * up.x - front.x * up.z,
    z: front.x * up.y - front.y * up.x
  };
  let lenR = Math.sqrt(right.x ** 2 + right.y ** 2 + right.z ** 2);
  if (lenR < 0.001) {
    // front 和 up 平行，使用备选
    right = { x: 1, y: 0, z: 0 };
  } else {
    right = { x: right.x / lenR, y: right.y / lenR, z: right.z / lenR };
  }

  // 重新计算 up = right × front (确保正交)
  up = {
    x: right.y * front.z - right.z * front.y,
    y: right.z * front.x - right.x * front.z,
    z: right.x * front.y - right.y * front.x
  };

  // 构建旋转矩阵并转换为四元数
  // 列向量: [right, up, front]
  // 这里假设物体坐标系: X=right, Y=front, Z=up
  // 旋转矩阵 M 的列是物体坐标系基向量在世界坐标系中的表示
  const m00 = right.x, m01 = front.x, m02 = up.x;
  const m10 = right.y, m11 = front.y, m12 = up.y;
  const m20 = right.z, m21 = front.z, m22 = up.z;

  const trace = m00 + m11 + m22;
  let w, x, y, z;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  // 归一化
  const qLen = Math.sqrt(w * w + x * x + y * y + z * z);
  obj.quaternion = { w: w / qLen, x: x / qLen, y: y / qLen, z: z / qLen };

  console.log('从 front+up 计算的四元数:', obj.quaternion);

  // 2. 找到最近的标准姿态
  const bestState = OrientationUtils.getNearestState(obj.quaternion);
  if (bestState) {
    console.log(`自动吸附到姿态: ${bestState.type} (${bestState.axis})`);

    // 3. 计算从当前姿态到目标姿态需要的旋转
    // deltaQ = targetQ * inverse(currentQ)
    // 然后从 deltaQ 提取轴角
    const currentQ = obj.quaternion;
    const targetQ = bestState.q;

    // 计算 currentQ 的逆
    const invCurrentQ = {
      w: currentQ.w,
      x: -currentQ.x,
      y: -currentQ.y,
      z: -currentQ.z
    };

    // deltaQ = targetQ * invCurrentQ
    const deltaQ = {
      w: targetQ.w * invCurrentQ.w - targetQ.x * invCurrentQ.x - targetQ.y * invCurrentQ.y - targetQ.z * invCurrentQ.z,
      x: targetQ.w * invCurrentQ.x + targetQ.x * invCurrentQ.w + targetQ.y * invCurrentQ.z - targetQ.z * invCurrentQ.y,
      y: targetQ.w * invCurrentQ.y - targetQ.x * invCurrentQ.z + targetQ.y * invCurrentQ.w + targetQ.z * invCurrentQ.x,
      z: targetQ.w * invCurrentQ.z + targetQ.x * invCurrentQ.y - targetQ.y * invCurrentQ.x + targetQ.z * invCurrentQ.w
    };

    // 从 deltaQ 提取轴角
    // angle = 2 * acos(w)
    // axis = (x, y, z) / sin(angle/2)
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, deltaQ.w)));

    if (Math.abs(angle) > 0.001) { // 需要旋转
      const sinHalf = Math.sin(angle / 2);
      let axis;
      if (Math.abs(sinHalf) > 0.001) {
        axis = {
          x: deltaQ.x / sinHalf,
          y: deltaQ.y / sinHalf,
          z: deltaQ.z / sinHalf
        };
      } else {
        // 角度接近0或360，任意轴
        axis = { x: 0, y: 0, z: 1 };
      }

      console.log(`旋转轴: (${axis.x.toFixed(2)}, ${axis.y.toFixed(2)}, ${axis.z.toFixed(2)}), 角度: ${(angle * 180 / Math.PI).toFixed(1)}°`);

      // 4. 使用 rotateObjectAroundAxis 实际旋转物体点
      rotateObjectAroundAxis(obj, axis, angle);
    }

    // 5. 更新状态
    obj._currentOrientationState = bestState;
    obj.quaternion = { ...bestState.q };

    // 更新 frontDirection (rotateObjectAroundAxis 已经更新，这里确保与目标一致)
    const defaultFrontVec = { x: 0, y: 1, z: 0 };
    const rotatedFront = applyQuaternion(defaultFrontVec, bestState.q);
    obj.frontDirection = {
      x: rotatedFront.x,
      y: rotatedFront.y,
      z: rotatedFront.z
    };

    console.log('更新后的 frontDirection:', obj.frontDirection);
  }
}

/**
 * 进入 EDIT 态（阶段15/16完善）
 * EDIT 态：编辑模式，可操作控制点
 */
function enterEditState() {
  if (SystemState.interactionState !== 'FOCUS') {
    console.warn('enterEditState: 只能从 FOCUS 态进入 EDIT 态');
    return;
  }

  const obj = SystemState.focusedObject;
  if (!obj) {
    console.warn('enterEditState: 没有聚焦的物体');
    return;
  }

  SystemState.interactionState = 'EDIT';
  console.log('进入 EDIT 态');

  // 1. 临时移除世界格网（隐藏且不可吸附）
  SystemState.objects = SystemState.objects.filter(o => o !== SystemState.worldGrid);

  // 1.5 自动吸附到最近的标准姿态（阶段16新增）
  snapToNearestOrientation(obj);

  // 1.6 (Phase 16b) 将物体中心移动到屏幕平面上
  // 这确保格网的中心层与屏幕平面严格对齐（零视差）
  const win = SystemState.mainWindow;
  if (win && win.direction) {
    const dir = win.direction;
    const planePt = dir.start; // 屏幕平面上的点

    // 计算当前物体中心到屏幕平面的距离
    const currentDist = (obj.center.x - planePt.x) * dir.x +
      (obj.center.y - planePt.y) * dir.y +
      (obj.center.z - planePt.z) * dir.z;

    // 将物体沿视线方向移动，使其中心位于屏幕平面上 (dist = 0)
    const moveX = -currentDist * dir.x;
    const moveY = -currentDist * dir.y;
    const moveZ = -currentDist * dir.z;

    if (typeof moveObjectTo === 'function') {
      moveObjectTo(obj, obj.center.x + moveX, obj.center.y + moveY, obj.center.z + moveZ);
    }

    console.log(`物体中心对齐到屏幕平面: 移动了 ${(-currentDist).toFixed(2)}cm`);
  }

  // 2. 创建并显示局部格网（阶段16新增）
  const localGrid = createLocalGridObject(obj);
  SystemState.localGrid = localGrid;
  SystemState.objects.push(localGrid); // 加入渲染列表

  // 3. 显示控制点
  showControlPoints(obj);

  // 4. 触发渲染
  SystemState.ifControl = true;
}

/**
 * 显示物体的控制点（整饬修改：不再使用 screenPoints）
 * @param {Object} obj - 物体对象
 */
function showControlPoints(obj) {
  if (!obj) return;

  // 优先使用 controlPoints，没有则使用顶点
  const points = obj.controlPoints && obj.controlPoints.length > 0
    ? obj.controlPoints
    : (obj.constructionPoints || []).slice(0, 20);  // 限制数量

  if (points.length === 0) {
    console.log('showControlPoints: 物体没有控制点');
    return;
  }

  // 整饬修改：直接为控制点设置 tag（不再创建副本到 screenPoints）
  // 按照用户要求：像普通点一样显示，不设置特殊 tag
  for (const cp of points) {
    cp.tag = null; // 清除特殊标签，使用普通点渲染
    cp.isAttractable = true;
  }

  console.log('显示控制点:', points.length, '个');
}

/**
 * 隐藏控制点（整饬修改：清除 tag 而非从 screenPoints 移除）
 */
function hideControlPoints() {
  const obj = SystemState.focusedObject;
  if (!obj) return;

  const points = obj.controlPoints && obj.controlPoints.length > 0
    ? obj.controlPoints
    : (obj.constructionPoints || []).slice(0, 20);

  for (const p of points) {
    p.tag = null;
  }
}

/**
 * 退出 EDIT 态，返回 FOCUS 态（阶段15新增）
 */
function exitEditState() {
  if (SystemState.interactionState !== 'EDIT') return;

  // 1. 清除控制点显示
  hideControlPoints();

  // 2. 移除局部格网（阶段16新增）
  if (SystemState.localGrid) {
    SystemState.objects = SystemState.objects.filter(o => o !== SystemState.localGrid);
    SystemState.localGrid = null;
  }

  // 3. 恢复世界格网
  if (!SystemState.objects.includes(SystemState.worldGrid)) {
    SystemState.objects.push(SystemState.worldGrid);
  }

  // 4. 切换到 FOCUS 态
  SystemState.interactionState = 'FOCUS';
  console.log('返回 FOCUS 态');

  // 5. 触发渲染
  SystemState.ifControl = true;
}

// ========================
// 阶段16新增：EDIT 态操作函数
// ========================

/**
 * EDIT 态步进旋转物体（阶段16新增）
 * @param {number} angleX - X轴旋转角度
 * @param {number} angleZ - Z轴旋转角度
 */
function rotateEditObject(angleX, angleZ) {
  const obj = SystemState.focusedObject;
  if (!obj) return;

  const center = obj.center;
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;

  for (const p of points) {
    // 绕 X 轴旋转
    if (angleX !== 0) {
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const relY = p.y - center.y;
      const relZ = p.z - center.z;
      p.y = center.y + relY * cosX - relZ * sinX;
      p.z = center.z + relY * sinX + relZ * cosX;
    }

    // 绕 Z 轴旋转
    if (angleZ !== 0) {
      const cosZ = Math.cos(angleZ);
      const sinZ = Math.sin(angleZ);
      const relX = p.x - center.x;
      const relY = p.y - center.y;
      p.x = center.x + relX * cosZ - relY * sinZ;
      p.y = center.y + relX * sinZ + relY * cosZ;
    }
  }

  // 更新控制点显示
  updateControlPointsDisplay();
  SystemState.ifControl = true;
}

/**
 * 更新控制点显示位置（阶段16新增）
 */
function updateControlPointsDisplay() {
  const obj = SystemState.focusedObject;
  if (!obj) return;

  // 清除旧控制点
  hideControlPoints();

  // 重新显示
  showControlPoints(obj);
}

/**
 * 查找屏幕坐标处的控制点（整饬修改：使用物体控制点数组）
 */
function findControlPointAt(screenX, screenY) {
  const obj = SystemState.focusedObject;
  if (!obj) return null;

  const points = obj.controlPoints && obj.controlPoints.length > 0
    ? obj.controlPoints
    : (obj.constructionPoints || []).slice(0, 20);

  const radius = 15;  // 点击半径

  for (const p of points) {
    if (p.tag !== 'CONTROL') continue;

    const dist = Math.sqrt(
      (p.xM - screenX) ** 2 + (p.yM - screenY) ** 2
    );

    if (dist < radius) {
      return p;
    }
  }

  return null;
}

/**
 * 移动控制点（整饬修改：直接操作控制点）
 */
function moveControlPoint(controlPoint, dx, dy) {
  if (!controlPoint) return;

  // 简化：按屏幕移动量估算世界移动量
  const scale = 0.05;  // 屏幕像素到世界单位的比例

  // 水平移动 -> X方向
  controlPoint.x += dx * scale;
  // 垂直移动 -> Z方向
  controlPoint.z -= dy * scale;

  // 标记需要重新拟合
  const obj = SystemState.focusedObject;
  if (obj) {
    obj._needsRefit = true;
  }
}

/**
 * 删除控制点（整饬修改：直接操作控制点）
 */
function deleteControlPoint(controlPoint) {
  if (!controlPoint) return;

  const obj = SystemState.focusedObject;
  if (!obj || !obj.controlPoints) return;

  const index = obj.controlPoints.indexOf(controlPoint);

  if (index > -1) {
    obj.controlPoints.splice(index, 1);
    obj._needsRefit = true;
    console.log('删除控制点，剩余:', obj.controlPoints.length);
    updateControlPointsDisplay();
  }
}

/**
 * 在指定屏幕位置新增控制点（阶段16新增）
 */
function addControlPointAt(screenX, screenY) {
  const obj = SystemState.focusedObject;
  if (!obj) return;

  // 简化：在物体中心平面上创建点
  const center = obj.center;

  // 屏幕坐标转换为相对中心的偏移
  const screenCenterX = SystemState.screenWidthPx / 2;
  const screenCenterY = SystemState.screenHeightPx / 2;
  const offsetX = (screenX - screenCenterX) * 0.02;
  const offsetZ = (screenCenterY - screenY) * 0.02;

  const newPoint = new Point(
    center.x + offsetX,
    center.y,
    center.z + offsetZ
  );

  if (!obj.controlPoints) {
    obj.controlPoints = [];
  }

  obj.controlPoints.push(newPoint);
  obj._needsRefit = true;

  console.log('新增控制点，总数:', obj.controlPoints.length);
  updateControlPointsDisplay();
}

/**
 * 移动物体到指定坐标（VIEW 态拖拽用）
 * @param {Object} obj - 物体对象
 * @param {number} x - 目标 X 坐标
 * @param {number} y - 目标 Y 坐标
 * @param {number} z - 目标 Z 坐标
 */
function moveObjectTo(obj, x, y, z) {
  if (!obj || !obj.center) return;

  const dx = x - obj.center.x;
  const dy = y - obj.center.y;
  const dz = z - obj.center.z;

  // 移动所有点
  const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
  for (const p of points) {
    p.x += dx;
    p.y += dy;
    p.z += dz;
  }

  // 更新中心
  obj.center.x = x;
  obj.center.y = y;
  obj.center.z = z;

  // 更新物心点
  if (obj.centerPoint) {
    obj.centerPoint.x = x;
    obj.centerPoint.y = y;
    obj.centerPoint.z = z;
  }

  SystemState.ifControl = true;
}

/**
 * 主循环（阶段8修改）
 * @param {number} timestamp - requestAnimationFrame 提供的时间戳
 */
function gameLoop(timestamp = 0) {
  // 计算帧间隔
  const dt = timestamp - SystemState.lastTimestamp;
  SystemState.lastTimestamp = timestamp;
  SystemState.worldTime = timestamp;

  // 1. 输入处理
  handleInput();

  // 1.5 应用对数速度（整饬新增）
  applyVelocities(dt);

  // 2. 任务队列处理
  processTaskQueue(SystemState.worldTime, dt);

  // 2.5 检测控制点重建需求（整饬新增：任务 E）
  for (const obj of SystemState.objects) {
    if (obj._needsRefit) {
      // TODO: 调用形状重建函数
      // rebuildShapeFromControlPoints(obj);
      obj._needsRefit = false;
      console.log('控制点已修改，需要重建形状');
    }
  }

  // 3. 物理步进
  physicsStep(dt);

  // 3.5 更新局部格网（阶段16新增）
  updateLocalGrid();

  // 4. 摄像头显示
  drawCameraFeedOnMainCanvas(SystemState.ctx);

  // 5. 渲染（有控制输入或动画任务时）
  if (SystemState.ifControl || SystemState.taskQueues.current.length > 0) {
    updateLight();
    updateVisibleReflection();  // 阶段7新增：更新可见层反射
    render();
    SystemState.ifControl = false;
  }

  // 6. 请求下一帧
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
  SystemState.videoDisplayCanvas = document.createElement("canvas");
  SystemState.videoDisplayCtx = SystemState.videoDisplayCanvas.getContext("2d");

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
  style.position = "fixed"; // 固定定位，相对于视口居中
  style.top = "50%";
  style.left = "50%";
  // 通过transform平移实现精确居中（基于自身尺寸的一半）
  style.transform = "translate(-50%, -50%)";
  style.zIndex = "1"; // 控制层级
  style.border = "2px solid #fff"; // 可选：添加边框便于区分
  style.boxShadow = "0 0 10px rgba(0,0,0,0.3)"; // 可选：添加阴影提升视觉效果

  console.log(
    `摄像头显示画布初始化完成。尺寸: ${displayWidth}x${displayHeight}，缩放比例: ${scale}`,
  );
  return true;
}

// --- 2. 更新摄像头显示画布内容 (在 processCamera 或渲染循环中调用) ---
function updateCameraDisplay(test) {
  C.updateCameraDisplay(SystemState, test);
}

// --- 3. 将摄像头画面绘制到主渲染画布 (在 render 函数中调用) ---
function drawCameraFeedOnMainCanvas(
  ctx,
  x = 0,
  y = 0,
  width = 200,
  height = 150,
  opacity = 0.5,
) {
  // 可调整位置、大小和透明度
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
init()
  .then(() => {
    // 等待 init 完成
    gameLoop(); // 启动主循环
  })
  .catch(console.error);
