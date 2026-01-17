import { Window } from "./base/Window.js";
import { Object } from "./base/Object.js";
import { Point } from "./base/Point.js";
import { Vector } from "./base/Vector.js";
import { Classifier } from "./math/Classifier.js";
import { StyleImpl } from "./manage/StyleImpl.js";
import { AnimationImpl } from "./manage/AnimationImpl.js";
import { ObjectFactoryImpl } from "./manage/ObjectFactoryImpl.js";
import { OrientationImpl } from "./manage/OrientationImpl.js";

// =====================================================
// [A] Global Runtime State (纯数据)
// =====================================================
// 说明: 本区块只包含配置参数和系统状态变量
// 禁止: 在此区块进行计算或状态判断
// =====================================================


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
// 2. 系统状态管理
// ========================

const SystemState = {
  ifControl: true,
  // 对象列表（使用 ObjectFactoryImpl 创建）
  objects: ObjectFactoryImpl.createTestScene(),
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

// =====================================================
// 逻辑区块总览（第一阶段：概念分区）
// =====================================================
// 本文件按8个逻辑区块组织，当前阶段各区块函数仍分散，
// 通过注释标记边界，为第二阶段拆分做准备。
//
// [A] Global Runtime State (纯数据)
//     位置: 文件顶部（已完成集中）
//     内容: CONFIG配置 + SystemState系统状态
//     
// [B] World / Interaction State Management
//     位置: 分散（见enterFocusState等函数）
//     内容: VIEW/FOCUS/EDIT状态切换函数
//     
// [C] Policies / Profiles (纯配置)
//     位置: 见[C]标记（当前为预留区域）
//     内容: 第二阶段将定义InputMaps等策略对象
//     
// [D] Interaction Intent Builders
//     位置: 分散
//     内容: 旋转/平移/编辑意图构建
//     
// [E] Geometry & Edit Operations
//     位置: 分散
//     内容: 几何算法、控制点操作等
//     
// [F] Animation / Task Queue
//     位置: 分散（见processTaskQueue等）
//     内容: 动画系统、任务队列
//     
// [G] Window / Screen Glue
//     位置: 见[G]标记（updateVirtualMouse等）
//     内容: 虚拟鼠标、屏幕坐标相关
//     
// [H] Init / Resize / Lifecycle
//     位置: 见[H]标记（init函数等）
//     内容: 初始化、事件监听、主循环
// =====================================================

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

// =====================================================
// [H] Init / Resize / Lifecycle
// =====================================================

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
  SystemState.worldGrid = ObjectFactoryImpl.createWorldGrid(10, displayWidth * 2);

  // 3. 初始化移动限制 (保存初始位置)
  SystemState.movementConstraints = {
    initialY: CONFIG.userDistanceFromOrigin, // 人眼初始 Y
    range: 0.5 * displayWidth                // 限制范围 +/- 0.5 Width
  };
  SystemState.objects.push(SystemState.worldGrid);
  // console.log("世界格网已创建，格点数:", SystemState.worldGrid.displayPoints.length);

  // 添加到DOM
  document.body.appendChild(SystemState.canvas);

  // 设置事件监听器
  setupEventListeners();

  // 初始化摄像头
  await initCamera(); // 等待摄像头初始化
  // initCameraDisplay();
  SystemState.debugDiv.textContent = "初始化完成";
  // console.log("初始化完成");
}

// ========================
// 7. 法向量估算
// ========================


// =====================================================
// Phase 2: 输入处理辅助函数（包装现有逻辑）
// =====================================================
// 说明: 这些函数包装handleInput等的分支逻辑
//      不改变任何业务逻辑，只是提取分支
// =====================================================

/**
 * VIEW态连续输入处理（提取自原handleInput的VIEW分支）
 */
function handleViewContinuousInput() {
  const keys = SystemState.keys;
  const rotState = SystemState.velocityState.rotation;
  const moveState = SystemState.velocityState.moveForward;

  // 旋转：Z/X/C 左转，B/N/M 右转
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
}

/**
 * FOCUS_ENTERING态连续输入处理（无操作）
 */
function handleFocusEnteringContinuousInput() {
  // FOCUS_ENTERING态不处理输入
}

/**
 * EDIT态连续输入处理（无操作）
 */
function handleEditContinuousInput() {
  // EDIT态不处理VIEW/FOCUS态的连续输入
}

/**
 * VIEW态键盘按下处理（提取自原keydown回调的VIEW分支）
 */
function handleViewKeyDown(e) {
  if (e.key === 'Escape') {
    // 检查是否有动画正在进行（任务队列中有任务）
    const hasPendingTasks = (SystemState.taskQueues.current?.length > 0) ||
      (SystemState.taskQueues.next?.length > 0);
    if (hasPendingTasks) {
      console.log('[STATE] VIEW ESC: 有动画进行中，忽略');
      return;
    }
    resetCameraDistance();
  }
}

/**
 * 复位视窗距离（保持视线方向，仅重置距离）
 * ESC 在 VIEW 态时调用，将用户拉回到初始观察距离
 * 
 * 原理：滚轮操作沿视线方向移动capital和dir.start，限制基于capital.y在[initialY-range, initialY+range]
 * ESC复位就是将capital.y恢复到initialY，同时同步移动dir.start
 */
function resetCameraDistance() {
  const win = SystemState.mainWindow;
  if (!win || !win.direction || !win.capital) return;

  const dir = win.direction;
  const dirStart = dir.start;

  // 获取初始 Y 值（人眼初始位置）
  const initialY = SystemState.movementConstraints?.initialY ?? CONFIG.userDistanceFromOrigin;
  const currentY = win.capital.y;

  // 计算 capital.y 与 initialY 的差值
  const deltaY = currentY - initialY;

  // 如果已经在初始位置附近，无需移动
  if (Math.abs(deltaY) < 0.001) {
    console.log('[STATE] VIEW ESC: 已在初始位置');
    return;
  }

  // 计算沿视线方向需要移动的量
  // 滚轮移动时：capital += dir * speed，且 dir.y 通常为 1（视线指向 +Y）
  // 要使 capital.y 减少 deltaY，需要沿 -dir 方向移动 deltaY / dir.y 的距离
  // 但简化处理：直接沿 dir 方向移动，使 capital.y 回到 initialY

  // 方法：计算需要沿 dir 方向移动多少使 capital.y 变为 initialY
  // capital.y + dir.y * t = initialY  =>  t = (initialY - capital.y) / dir.y = -deltaY / dir.y
  const moveAmount = -deltaY / (Math.abs(dir.y) > 0.001 ? dir.y : 1);

  // 沿视线方向移动 capital 和 dir.start
  const moveX = dir.x * moveAmount;
  const moveY = dir.y * moveAmount;
  const moveZ = dir.z * moveAmount;

  win.capital.x += moveX;
  win.capital.y += moveY;
  win.capital.z += moveZ;
  dirStart.x += moveX;
  dirStart.y += moveY;
  dirStart.z += moveZ;

  // 触发重新渲染
  SystemState.ifControl = true;
  console.log(`[STATE] VIEW ESC: capital.y ${currentY.toFixed(1)}cm → ${win.capital.y.toFixed(1)}cm`);
}

/**
 * FOCUS态键盘按下处理（提取自原keydown回调的FOCUS分支）
 */
function handleFocusKeyDown(e) {
  if (e.key === 'Escape') {
    // 检查聚焦物体是否有动画锁（防止重复触发）
    const obj = SystemState.focusedObject;
    if (obj && obj.animationLock) {
      console.log('[STATE] FOCUS ESC: 物体动画进行中，忽略');
      return;
    }
    // 检查是否有任务队列中的动画
    const hasPendingTasks = (SystemState.taskQueues.current?.length > 0) ||
      (SystemState.taskQueues.next?.length > 0);
    if (hasPendingTasks) {
      console.log('[STATE] FOCUS ESC: 有动画进行中，忽略');
      return;
    }
    exitFocusState();
  }
}

/**
 * EDIT态键盘按下处理（提取自原keydown回调的EDIT分支）
 */
function handleEditKeyDown(e) {
  if (e.key === 'Escape') {
    exitEditState();
    return;
  }

  const obj = SystemState.focusedObject;
  if (obj) {
    const key = e.key.toLowerCase();
    if (['w', 's', 'a', 'd', 'q', 'e'].includes(key)) {
      const now = performance.now();
      const cooldownMs = 300;
      if (!SystemState._lastRotationTime || (now - SystemState._lastRotationTime) > cooldownMs) {
        SystemState._lastRotationTime = now;
        OrientationImpl.transition(key, obj, SystemState.mainWindow?.direction, animateRotation);
      }
    }
  }
}

/**
 * VIEW态鼠标按下处理
 */
function handleViewMouseDown(e) {
  if (e.button === 0) {
    const snapped = SystemState.virtualMouse.snappedTo;
    if (snapped && snapped.isObjectCenter && snapped.ownerObject) {
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
}

/**
 * FOCUS态鼠标按下处理
 */
function handleFocusMouseDown(e) {
  if (e.button === 0) {
    SystemState.isDragging = true;
    SystemState.lastMouseX = e.clientX;
    SystemState.lastMouseY = e.clientY;
  }
}

/**
 * EDIT态鼠标按下处理
 */
function handleEditMouseDown(e) {
  if (e.button === 0) {
    const cp = findControlPointAt(e.clientX, e.clientY);

    if (cp) {
      SystemState.draggedControlPoint = cp;
      SystemState.lastMouseX = e.clientX;
      SystemState.lastMouseY = e.clientY;

      SystemState.longPressTarget = cp;
      SystemState.longPressTimer = setTimeout(() => {
        deleteControlPoint(cp);
        SystemState.longPressTarget = null;
        SystemState.draggedControlPoint = null;
      }, 1000);
    }
  }
}

/**
 * VIEW态鼠标移动处理
 */
function handleViewMouseMove(e) {
  if (SystemState.draggingObject) {
    const snapped = SystemState.virtualMouse.snappedTo;
    if (snapped && snapped.isGridPoint) {
      moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
    }
  }
}

/**
 * EDIT态鼠标移动处理
 */
function handleEditMouseMove(e) {
  if (SystemState.draggedControlPoint) {
    const dx = e.clientX - SystemState.lastMouseX;
    const dy = e.clientY - SystemState.lastMouseY;

    if (dx !== 0 || dy !== 0) {
      if (SystemState.longPressTimer) {
        clearTimeout(SystemState.longPressTimer);
        SystemState.longPressTimer = null;
      }

      moveControlPoint(SystemState.draggedControlPoint, dx, dy);

      SystemState.lastMouseX = e.clientX;
      SystemState.lastMouseY = e.clientY;
      SystemState.ifControl = true;
    }
  }
}

/**
 * VIEW态滚轮处理
 */
function handleViewWheel(e) {
  e.preventDefault();
  const dir = SystemState.mainWindow.direction;
  const speed = CONFIG.moveSpeed * 2;

  const currentY = SystemState.mainWindow.capital.y;
  const initialY = SystemState.movementConstraints?.initialY ?? CONFIG.userDistanceFromOrigin;
  const range = SystemState.movementConstraints?.range ?? (CONFIG.screenXLengthCm * 0.5);
  const minY = initialY - range;
  const maxY = initialY + range;

  let dx = 0, dy = 0, dz = 0;
  if (e.deltaY < 0) {
    dx = dir.x * speed; dy = dir.y * speed; dz = dir.z * speed;
  } else {
    dx = -dir.x * speed; dy = -dir.y * speed; dz = -dir.z * speed;
  }

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
}

/**
 * FOCUS态滚轮处理
 */
function handleFocusWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.5 : -0.5;
  SystemState.focusSliceDepth += delta;
  SystemState.focusVirtualMouseDepth += delta;
  updateSliceContour();
  SystemState.ifControl = true;
}

/**
 * EDIT态滚轮处理（深度层切换）
 */
function handleEditWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  SystemState.editDepthLayer += delta;
  // console.log('切换深度层:', SystemState.editDepthLayer);
  updateControlPointsDisplay();
  SystemState.ifControl = true;
}

/**
 * EDIT态滚轮处理（切片深度调节）
 */
function handleEditWheelSliceDepth(e) {
  e.preventDefault();
  const obj = SystemState.focusedObject;
  if (!obj) return;

  if (typeof SystemState._scrollAccumulator === 'undefined') {
    SystemState._scrollAccumulator = 0;
  }

  SystemState._scrollAccumulator += e.deltaY;
  const TICK_THRESHOLD = 300;

  if (Math.abs(SystemState._scrollAccumulator) >= TICK_THRESHOLD) {
    const sign = Math.sign(SystemState._scrollAccumulator);
    const steps = Math.floor(Math.abs(SystemState._scrollAccumulator) / TICK_THRESHOLD);

    const win = SystemState.mainWindow;
    const dir = win.direction;
    const planePt = dir.start;
    const currentDepth = (obj.center.x - planePt.x) * dir.x +
      (obj.center.y - planePt.y) * dir.y +
      (obj.center.z - planePt.z) * dir.z;

    const orientationType = obj._currentOrientationState?.type || 'FACE';
    const maxDepth = ObjectFactoryImpl.LocalGridConfig.getMaxDepthForOrientation(orientationType);
    const stepSize = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);

    console.log(`[Wheel] Type: ${orientationType}, Step: ${stepSize.toFixed(3)}cm`);

    const currentLayer = Math.round(currentDepth / stepSize);
    const targetLayer = currentLayer + steps * sign;
    const targetDepth = targetLayer * stepSize;

    if (targetDepth > maxDepth || targetDepth < -maxDepth) {
      console.log(`Depth limit reached: current=${currentDepth.toFixed(1)}, target=${targetDepth.toFixed(1)}, limit=±${maxDepth.toFixed(1)}`);
      SystemState._scrollAccumulator = 0;
      return;
    }

    SystemState._scrollAccumulator -= sign * steps * TICK_THRESHOLD;

    const delta = targetDepth - currentDepth;
    const targetX = obj.center.x + dir.x * delta;
    const targetY = obj.center.y + dir.y * delta;
    const targetZ = obj.center.z + dir.z * delta;

    animateSliceTransition(obj, targetX, targetY, targetZ, 150);

    console.log(`Slice Scroll: Layer ${currentLayer} -> ${targetLayer}, Depth: ${targetDepth.toFixed(1)}cm`);
  }
}

/**
 * VIEW态点击处理
 */
function handleViewClick(event) {
  const now = Date.now();
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

/**
 * FOCUS态点击处理
 */
function handleFocusClick(event) {
  const now = Date.now();
  if (lastClickTarget === 'focus_click' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
    enterEditState();
  }
  lastClickTime = now;
  lastClickTarget = 'focus_click';
}

/**
 * EDIT态点击处理
 */
function handleEditClick(event) {
  const now = Date.now();
  if (lastClickTarget === 'edit_empty' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
    addControlPointAt(event.clientX, event.clientY);
  }

  const cp = findControlPointAt(event.clientX, event.clientY);
  lastClickTime = now;
  lastClickTarget = cp ? 'edit_control' : 'edit_empty';
}


// =====================================================
// [C] Policies / Profiles (纯配置,不做计算)
// =====================================================
// Phase 2: InputMap 系统
// 职责: "输入→调用"的映射表，不包含任何业务逻辑
// 原则: 只允许显式函数名调用，禁止数学运算符(工程级护栏)
// =====================================================

/**
 * InputMaps - 输入映射系统(Phase 2)
 * 
 * 规则:
 * 1. 方法内禁止状态判断
 * 2. 只允许调用既有函数
 * 3. 不允许数学运算符（工程级护栏）
 * 4. 不允许合并相似函数（即使名字相同）
 */
const InputMaps = {
  VIEW: {
    onContinuousInput() {
      handleViewContinuousInput();
    },

    onKeyDown(e) {
      handleViewKeyDown(e);
    },

    onMouseDown(e) {
      handleViewMouseDown(e);
    },

    onMouseMove(e) {
      handleViewMouseMove(e);
    },

    onWheel(e) {
      handleViewWheel(e);
    },

    onClick(e) {
      handleViewClick(e);
    }
  },

  FOCUS: {
    onContinuousInput() {
      handleFocusEdgeRotation();
    },

    onKeyDown(e) {
      handleFocusKeyDown(e);
    },

    onMouseDown(e) {
      handleFocusMouseDown(e);
    },

    onMouseMove(e) {
      // FOCUS态不需要mousemove处理
    },

    onWheel(e) {
      handleFocusWheel(e);
    },

    onClick(e) {
      handleFocusClick(e);
    }
  },

  FOCUS_ENTERING: {
    onContinuousInput() {
      handleFocusEnteringContinuousInput();
    },

    onKeyDown(e) { },
    onMouseDown(e) { },
    onMouseMove(e) { },
    onWheel(e) { },
    onClick(e) { }
  },

  EDIT: {
    onContinuousInput() {
      handleEditContinuousInput();
    },

    onKeyDown(e) {
      handleEditKeyDown(e);
    },

    onMouseDown(e) {
      handleEditMouseDown(e);
    },

    onMouseMove(e) {
      handleEditMouseMove(e);
    },

    onWheel(e) {
      handleEditWheel(e);
    },

    onClick(e) {
      handleEditClick(e);
    },

    onWheelSliceDepth(e) {
      handleEditWheelSliceDepth(e);
    }
  }
};

// =====================================================
// [D] Interaction Intent Builders
// [E] Geometry & Edit Operations
// [F] Animation / Task Queue
// =====================================================
// [注意: D/E/F区块函数分散在文件中,待后续整理]

// =====================================================
// [D] Interaction Intent Builders
// [E] Geometry & Edit Operations
// [F] Animation / Task Queue
// =====================================================
// [注意: D/E/F区块函数分散在文件中,待后续整理]

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
    ObjectFactoryImpl.createSphere(lightX, lightY, lightZ, 0.5, 20),
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
// 10. 渲染系统（阶段2重构：Renderer 对象封装）
// ========================
const Renderer = {
  // 颜色 LUT 缓存
  LUT: StyleImpl.getLUT(),

  /**
   * 遍历邻接点并执行回调（零内存分配优化）
   * 替代原 getNeighbors 返回数组的方式，消除GC压力
   * @param {number} x - 中心X
   * @param {number} y - 中心Y
   * @param {number} light - 亮度
   * @param {function} callback - (nx, ny, ratio) => void
   */
  forEachNeighbor(x, y, light, callback) {
    // 规则1：light∈(0.6, 1] → 8邻接
    if (light <= 1 && light > 0.6) {
      callback(x, y - 1, 0.707);
      callback(x, y + 1, 0.707);
      callback(x - 1, y, 0.707);
      callback(x + 1, y, 0.707);
      callback(x - 1, y - 1, 0.4);
      callback(x + 1, y - 1, 0.4);
      callback(x - 1, y + 1, 0.4);
      callback(x + 1, y + 1, 0.4);
    }
    // 规则2：light∈(0.3, 0.6] → 8邻接（原逻辑中ratio未用light计算，保持一致）
    else if (light <= 0.6 && light > 0.3) {
      callback(x, y - 1, 0.707);
      callback(x, y + 1, 0.707);
      callback(x - 1, y, 0.707);
      callback(x + 1, y, 0.707);
      callback(x - 1, y - 1, 0.4);
      callback(x + 1, y - 1, 0.4);
      callback(x - 1, y + 1, 0.4);
      callback(x + 1, y + 1, 0.4);
    }
    // 规则3：light≤0.3 → 无邻接
  },

  /**
   * 绘制带颜色的点及其邻接点
   * 优化：移除 params 对象创建，直接传参
   */
  drawColoredPointImpl(ctxData, width, height, x, y, light, colorType, baseLight, maxLutIndex, drawNeighbors) {
    // 1. 跳过无效坐标
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;

    // 2. 绘制主点
    const mainBrightness = light * baseLight;
    // 快速索引计算
    const mainIdx = ((mainBrightness * 10) + 0.5) << 0; // fast round
    const clampedMainIdx = mainIdx < 0 ? 0 : (mainIdx > maxLutIndex ? maxLutIndex : mainIdx);

    // 获取颜色引用（避免解构开销）
    const lut = this.LUT[colorType];
    const color = lut[clampedMainIdx] || lut[0];

    const pixelIdx = (y * width + x) * 4;
    ctxData[pixelIdx] = color[0];
    ctxData[pixelIdx + 1] = color[1];
    ctxData[pixelIdx + 2] = color[2];
    ctxData[pixelIdx + 3] = 255;

    // 3. 绘制邻接点（仅当 drawNeighbors 为 true）
    if (drawNeighbors) {
      this.forEachNeighbor(x, y, light, (nx, ny, ratio) => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;

        const nbBrightness = light * baseLight * ratio;
        const nbIdx = ((nbBrightness * 10) + 0.5) << 0;
        const clampedNbIdx = nbIdx < 0 ? 0 : (nbIdx > maxLutIndex ? maxLutIndex : nbIdx);

        const nbColor = lut[clampedNbIdx] || lut[0];
        const nbPixelIdx = (ny * width + nx) * 4;

        // 简单且常用的alpha混合或直接覆盖？原逻辑是直接覆盖。
        ctxData[nbPixelIdx] = nbColor[0];
        ctxData[nbPixelIdx + 1] = nbColor[1];
        ctxData[nbPixelIdx + 2] = nbColor[2];
        ctxData[nbPixelIdx + 3] = 255;
      });
    }
  },

  /**
   * 绘制主逻辑
   */
  render(ctx, width, height) {
    // 1. 初始化ImageData
    const imageData = ctx.createImageData(width, height);
    const pixelData = imageData.data;

    const win = SystemState.mainWindow;

    // 2. 遍历 windowObjects
    for (let index = 0; index < win.windowObjects.length; index++) {
      const element = win.windowObjects[index];
      const renderPoints = (element.displayPoints && element.displayPoints.length > 0)
        ? element.displayPoints
        : element.constructionPoints;

      if (!renderPoints || renderPoints.length === 0) continue;

      for (let i = 0; i < renderPoints.length; i++) {
        const p = renderPoints[i];
        if (p.xM !== 0 && p.yM !== 0) {
          // 绘制紫色点（无视差的2D点），不开启邻接绘制
          this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 350, false);
        }
      }
    }

    // 3. 遍历 Grid Points
    const is3D = CONFIG.displayMode !== '2D';
    const isLR = CONFIG.displayMode === '3D_LR';
    // 预计算常量
    const leftColor = isLR ? 'red' : 'blue';
    const rightColor = isLR ? 'blue' : 'red';
    const leftBase = isLR ? 35 : 50;
    const rightBase = isLR ? 50 : 35;
    const leftMax = isLR ? 350 : 500;
    const rightMax = isLR ? 500 : 350;

    for (let gridX = 0; gridX < win.grid.length; gridX++) {
      const gridCol = win.grid[gridX];
      for (let gridY = 0; gridY < gridCol.length; gridY++) {
        const pointsInGrid = gridCol[gridY];

        for (const p of pointsInGrid) {
          // CONTROL 标签特殊渲染
          if (p.tag === 'CONTROL') {
            const cx = (p.xM + 0.5) << 0;
            const cy = (p.yM + 0.5) << 0;
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                const px = cx + dx;
                const py = cy + dy;
                if (px < 0 || px >= width || py < 0 || py >= height) continue;
                const idx = (py * width + px) * 4;
                pixelData[idx] = 255;
                pixelData[idx + 1] = 255;
                pixelData[idx + 2] = 255;
                pixelData[idx + 3] = 255;
              }
            }
            continue;
          }

          if (!is3D) {
            // 2D Mode
            if (p.xM !== 0 && p.yM !== 0) {
              this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 500, true);
            }
          } else {
            // 3D Mode
            if (Math.abs(p.xL - p.xR) > 0) {
              const first = (p.xL % 2 === 0); // 简单的交错策略? 

              // 根据 first 标志决定绘制顺序（原逻辑保留）
              // 先绘制左眼
              if (first && p.xL !== 0 && p.yL !== 0) {
                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
              }
              // 绘制右眼
              if (p.xR !== 0 && p.yR !== 0) {
                this.drawColoredPointImpl(pixelData, width, height, p.xR, p.yR, p.light, rightColor, rightBase, rightMax, true);
              }
              // 后绘制左眼
              if (!first && p.xL !== 0 && p.yL !== 0) {
                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
              }
            } else {
              // 紫色点
              if (p.xM !== 0 && p.yM !== 0) {
                this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 500, true);
              }
            }
          }
        }
      }
    }

    return imageData;
  },

  /**
   * 使用固定亮度渲染单个点
   */
  renderPointSimple(p, light, pixelData, width, height) {
    const x = Math.floor(p.xM);
    const y = Math.floor(p.yM);

    if (x < 0 || x >= width || y < 0 || y >= height) return;

    // 使用现有 LUT (Renderer.LUT)
    const baseLight = 50;  // 使用 purple 的 baseLight
    const lutIndex = Math.min(
      Math.floor(light * baseLight * 10),
      this.LUT.purple.length - 1
    );
    const color = this.LUT.purple[Math.max(0, lutIndex)];

    const idx = (y * width + x) * 4;
    pixelData[idx] = color[0];      // R
    pixelData[idx + 1] = color[1];  // G
    pixelData[idx + 2] = color[2];  // B
    pixelData[idx + 3] = 255;       // A
  },

  /**
   * 渲染 screenPoints（截面轮廓等）
   */
  renderScreenPointsHelper(pixelData, width, height) {
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
        this.renderPointSimple(p, 0.8, pixelData, width, height);
      }
    }
  }
};

// 2. 优化后的渲染函数（接口适配）
// 2. 优化后的渲染函数（接口适配）
function render() {
  const ctx = SystemState.ctx;
  const { screenWidthPx: width, screenHeightPx: height } = SystemState;

  updateCamera();

  // 调用 Renderer
  const imageData = Renderer.render(ctx, width, height);
  const pixelData = imageData.data;

  // 阶段11A新增：FOCUS/EDIT 态使用简化光照渲染 screenPoints（排除 FOCUS_ENTERING 中间态）
  if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'EDIT') {
    Renderer.renderScreenPointsHelper(pixelData, width, height);
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

// =====================================================
// [G] Window / Screen Glue
// =====================================================
// 说明: 只调用window,不自己算screen坐标
// 要求: 所有虚拟鼠标使用统一走window.virtualCursor
// =====================================================

function updateVirtualMouse(mouseX, mouseY) {
  const vm = SystemState.virtualMouse;
  if (!vm.enabled) return;

  const width = SystemState.screenWidthPx;
  const height = SystemState.screenHeightPx;

  // 清除旧的虚拟鼠标点
  SystemState.screenPoints = SystemState.screenPoints.filter(
    p => p.tag !== 'VIRTUAL_MOUSE'
  );

  // 从鼠标位置向外扩展搜索（调用 Window 的方法）
  const win = SystemState.mainWindow;
  let snapped = null;

  if (win && win.findNearestPoint) {
    snapped = win.findNearestPoint(mouseX, mouseY, 0, (p) => {
      // 阶段16新增：EDIT 态只吸附屏幕平面附近的 局部格网点
      if (SystemState.interactionState === 'EDIT') {
        if (p.tag !== 'LOCAL_GRID') return false;
      }

      // Phase 2新增：VIEW态拖动时，跳过已被其他物体占用的格点
      if (SystemState.draggingObject && p.isGridPoint) {
        if (isGridPointOccupied(p.gx, p.gy, p, SystemState.draggingObject)) {
          return false;
        }
      }
      return true;
    });
  }

  // 阶段1新增: 更新Window的virtualCursor缓存(统一出口)
  if (win && win.virtualCursor) {
    win.virtualCursor.setSnappedPoint(snapped);
  }

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
 * 检查世界格网点是否被其他物体占用
 * @param {number} gx - grid X 索引
 * @param {number} gy - grid Y 索引
 * @param {Object} gridPoint - 世界格网点
 * @param {Object} draggingObject - 正在拖动的物体（可为null）
 * @returns {boolean} true表示已被占用
 */
function isGridPointOccupied(gx, gy, gridPoint, draggingObject) {
  const grid = SystemState.mainWindow.grid;
  // 必须进行边界检查
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return false;
  if (gx < 0 || gx >= grid.length || gy < 0 || gy >= grid[0].length) return false;

  const cell = grid[gx][gy];
  if (!cell) return false;

  // 遍历该cell中的所有点，检查是否有其他物体的中心点
  for (const p of cell) {
    // 检查是否是其他物体的中心点
    if (p.isObjectCenter &&
      p.ownerObject &&
      p.ownerObject !== draggingObject) {

      // 检查该物心是否与格点坐标重合（容差范围内）
      const dx = Math.abs(p.x - gridPoint.x);
      const dy = Math.abs(p.y - gridPoint.y);
      const dz = Math.abs(p.z - gridPoint.z);
      const TOLERANCE = 0.1; // 容差：0.1cm（世界坐标）

      if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
        return true;  // 格点被占用
      }
    }
  }

  return false;  // 格点空闲
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
    Renderer.LUT[colorType].length - 1
  );
  const color = Renderer.LUT[colorType][Math.max(0, lutIndex)];

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

// =====================================================
// Phase 2: 输入分发器
// =====================================================

/**
 * 连续输入处理分发器(Phase 2:纯转发)
 * 禁止任何状态判断或业务逻辑
 */
function handleInput() {
  const map = InputMaps[SystemState.interactionState];
  if (map && map.onContinuousInput) {
    map.onContinuousInput();
  }
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
// 12. 事件监听器设置(Phase 2:纯转发)
// ========================
function setupEventListeners() {
  // =====================================================
  // Phase 2: 事件回调纯转发
  // 规则: 禁止任何状态判断，只做转发
  // 禁止: VIEW / FOCUS / EDIT 出现在此函数中
  // =====================================================

  // 键盘事件
  window.addEventListener("keydown", (e) => {
    SystemState.keys[e.key.toLowerCase()] = true;

    // 摄像头控制切换(全局功能，不分状态)
    if (e.key.toLowerCase() === "p") {
      CONFIG.cameraControl.enabled = !CONFIG.cameraControl.enabled;
      if (CONFIG.cameraControl.enabled) {
        initCamera();
      }
      SystemState.debugDiv.textContent = `摄像头控制: ${CONFIG.cameraControl.enabled ? "开启" : "关闭"}`;
      console.log(`摄像头控制: ${CONFIG.cameraControl.enabled ? "开启" : "关闭"}`);
    }

    // 转发到InputMap
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onKeyDown) {
      map.onKeyDown(e);
    }
  });

  window.addEventListener("keyup", (e) => {
    SystemState.keys[e.key.toLowerCase()] = false;
  });

  // click事件
  SystemState.canvas.addEventListener("click", (e) => {
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onClick) {
      map.onClick(e);
    }
  });

  // wheel事件 - EDIT态有两个wheel监听器，第一个处理切片深度
  SystemState.canvas.addEventListener("wheel", (e) => {
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onWheelSliceDepth) {
      map.onWheelSliceDepth(e);
    }
  }, { passive: false });

  // mousedown事件
  SystemState.canvas.addEventListener("mousedown", (e) => {
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onMouseDown) {
      map.onMouseDown(e);
    }
  });

  // mouseup事件
  window.addEventListener("mouseup", () => {
    // EDIT态控制点释放（无状态判断）
    if (SystemState.draggedControlPoint) {
      SystemState.draggedControlPoint = null;
      updateControlPointsDisplay();
    }

    if (SystemState.longPressTimer) {
      clearTimeout(SystemState.longPressTimer);
      SystemState.longPressTimer = null;
    }
    SystemState.longPressTarget = null;

    // 蓄力释放（无状态判断）
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

    // VIEW态拖拽物体释放（无状态判断）
    if (SystemState.draggingObject) {
      const snapped = SystemState.virtualMouse.snappedTo;
      if (snapped && snapped.isGridPoint) {
        moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
        console.log('物体放置到格点:', snapped.x, snapped.y, snapped.z);
      }
      SystemState.draggingObject = null;
      SystemState.dragStartCenter = null;
    }

    SystemState.isDragging = false;
  });

  // mousemove事件
  SystemState.canvas.addEventListener("mousemove", (e) => {
    // 转发到InputMap
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onMouseMove) {
      map.onMouseMove(e);
    }

    // 鼠标边缘状态更新（无状态判断）
    const screenWidth = window.innerWidth;

    if (e.clientX <= 0) {
      SystemState.mouseEdge = -1;
    } else if (e.clientX >= screenWidth - 1) {
      SystemState.mouseEdge = 1;
    } else {
      SystemState.mouseEdge = 0;
    }

    // 更新虚拟鼠标（无状态判断）
    if (SystemState.virtualMouse.enabled) {
      updateVirtualMouse(e.clientX, e.clientY);
      SystemState.ifControl = true;
    }

    // 始终更新鼠标位置
    SystemState.lastMouseX = e.clientX;
    SystemState.lastMouseY = e.clientY;
  });

  // 第二个wheel事件(FOCUS和VIEW态)
  SystemState.canvas.addEventListener("wheel", (e) => {
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onWheel) {
      map.onWheel(e);
    }
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
      return ObjectFactoryImpl.createSphere(
        command.params.x,
        command.params.y,
        command.params.z,
        command.params.radius,
        command.params.points,
      );
    case "cube":
      return ObjectFactoryImpl.createCube(
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
 * [DEBUG] 测量物体半径（用于调试尺寸变化问题）
 * 返回 displayPoints[0] 到 center 的距离作为代表性尺寸
 * @param {Object} obj - 物体对象
 * @returns {number} 代表性半径（厘米）
 */
function measureObjectRadius(obj) {
  if (!obj || !obj.center) return 0;
  const points = obj.displayPoints?.length > 0 ? obj.displayPoints : obj.constructionPoints;
  if (!points || points.length === 0) return 0;

  // 取第一个点到中心的距离作为代表性尺寸
  const p = points[0];
  const dx = p.x - obj.center.x;
  const dy = p.y - obj.center.y;
  const dz = p.z - obj.center.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * [DEBUG] 追踪物体第一个点的坐标变化（用于调试问题2）
 * 输出：points[0]的绝对坐标、center坐标、相对距离（半径）
 * @param {Object} obj - 物体对象
 * @param {string} label - 标签（标识调用点）
 */
function tracePoint(obj, label) {
  if (!obj || !obj.center) return;
  const points = obj.displayPoints?.length > 0 ? obj.displayPoints : obj.constructionPoints;
  if (!points || points.length === 0) return;

  const p = points[0];
  const c = obj.center;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dz = p.z - c.z;
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

  console.log(`[TRACE ${label}] P0=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ` +
    `C=(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) R=${r.toFixed(3)}cm`);
}

/**
 * 进入 VIEW 态
 * VIEW 态：观察模式，可旋转视角和移动位置
 */
function enterViewState() {
  SystemState.interactionState = 'VIEW';
  SystemState.focusedObject = null;


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
  // [DEBUG] 记录进入FOCUS前的物体尺寸
  const radiusBefore = measureObjectRadius(obj);
  console.log(`[STATE] VIEW→FOCUS: 物体=${obj.metadata?.name || 'Obj'}, 半径=${radiusBefore.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
  tracePoint(obj, 'VIEW→FOCUS');

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
          OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
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
    // [DEBUG] 记录进入FOCUS后的物体尺寸
    const radiusAfter = measureObjectRadius(obj);
    console.log(`[STATE] FOCUS entered: 半径=${radiusAfter.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
    tracePoint(obj, 'FOCUS-entered');
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
// 旋转辅助函数已迁移至 OrientationImpl.js

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

    // 如果角度接近 180度 (trace 接近 -1)，使用鲁棒算法提取轴
    if (Math.abs(angle - Math.PI) < 0.1) {
      // 180度情况：R 是对称的，且对角线项与轴分量平方有关
      // R_ii = 2 * axis_i^2 - 1  =>  axis_i = sqrt((R_ii + 1) / 2)
      // 需要确定符号。
      // 为简化，找到最大的对角元素以确保精度
      if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
        const S = Math.sqrt(1.0 + R[0][0] - R[1][1] - R[2][2]) * 2;
        axis.x = 0.25 * S;
        axis.y = (R[0][1] + R[1][0]) / S;
        axis.z = (R[0][2] + R[2][0]) / S;
      } else if (R[1][1] > R[2][2]) {
        const S = Math.sqrt(1.0 + R[1][1] - R[0][0] - R[2][2]) * 2;
        axis.x = (R[0][1] + R[1][0]) / S;
        axis.y = 0.25 * S;
        axis.z = (R[1][2] + R[2][1]) / S;
      } else {
        const S = Math.sqrt(1.0 + R[2][2] - R[0][0] - R[1][1]) * 2;
        axis.x = (R[0][2] + R[2][0]) / S;
        axis.y = (R[1][2] + R[2][1]) / S;
        axis.z = 0.25 * S;
      }
      // 归一化（虽然理论上已经是归一化的）
      const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
      if (len > 0.001) {
        axis.x /= len; axis.y /= len; axis.z /= len;
      }
    } else if (Math.abs(angle) > 0.001) {
      // 常规情况：使用偏对称部分
      axis.x = R[2][1] - R[1][2];
      axis.y = R[0][2] - R[2][0];
      axis.z = R[1][0] - R[0][1];
      const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
      if (len > 0.001) {
        axis.x /= len; axis.y /= len; axis.z /= len;
      } else {
        // [修复] 如果 calculated axis 长度过小但 angle 此时既不为0也不接近180
        // 这通常不应发生，但作为防守：回退到默认轴
        axis = { x: 0, y: 0, z: 1 };
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
      // [DEBUG] 动画帧追踪 - 开始
      const frameStart = value.progress < 0.1 || value.progress > 0.9;
      if (frameStart) tracePoint(targetObj, `anim-${(value.progress * 100).toFixed(0)}%-start`);

      // 更新位置
      if (targetObj.center) {
        const dx = value.position.x - (targetObj._lastAnimPos?.x ?? fromPos.x);
        const dy = value.position.y - (targetObj._lastAnimPos?.y ?? fromPos.y);
        const dz = value.position.z - (targetObj._lastAnimPos?.z ?? fromPos.z);

        // 修复：使用 Set 去重，避免同一 Point 对象被移动多次
        // （constructionPoints 可能与 displayPoints 共享相同的 Point 引用）
        const pointSet = new Set([
          ...(targetObj.displayPoints || []),
          ...(targetObj.constructionPoints || [])
        ]);
        for (const p of pointSet) {
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
          OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
        }
        targetObj._lastRotProgress = value.progress;
      }

      // [DEBUG] 动画帧追踪 - 结束
      if (frameStart) tracePoint(targetObj, `anim-${(value.progress * 100).toFixed(0)}%-end`);

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
    // [DEBUG] 记录返回VIEW后的物体尺寸
    const radiusFinal = measureObjectRadius(obj);
    console.log(`[STATE] →VIEW: 半径=${radiusFinal.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
    tracePoint(obj, '→VIEW');

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
 * 双击检测处理(Phase 2:纯转发)
 * 禁止任何状态判断
 */
function onMouseClick(event) {
  const map = InputMaps[SystemState.interactionState];
  if (map && map.onClick) {
    map.onClick(event);
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
// 局部格网系统已迁移至 ObjectFactoryImpl.js

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
    // 使用 OrientationImpl
    grid.quaternion = OrientationImpl.getQuaternionFromVectors(target.frontDirection, target.upDirection);
  } else if (target.quaternion) {
    grid.quaternion = { ...target.quaternion };
  }

  const dir = win.direction; // 视线/屏幕法向
  const planePt = dir.start; // 屏幕平面上的点

  // 3. 更新所有点的位置
  for (const p of grid.displayPoints) {
    if (p._localX === undefined) continue;

    const rotated = OrientationImpl.applyQuaternion({ x: p._localX, y: p._localY, z: p._localZ }, grid.quaternion);

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
    const layerSpacing = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);
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

// applyQuaternion 已迁移至 OrientationImpl.js

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
      OrientationImpl.rotateObjectAroundAxis(obj, axis, angleDelta);
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
  const layerSpacing = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);
  const maxDepth = ObjectFactoryImpl.LocalGridConfig.getMaxDepthForOrientation(orientationType);

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

// OrientationUtils 和 snapToNearestOrientation 已迁移至 OrientationImpl.js

/**
 * 进入 EDIT 态（阶段15/16完善，动画版）
 * EDIT 态：编辑模式，可操作控制点
 * 优化：姿态吸附使用动画过渡，格网在动画完成后创建
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

  // 使用中间状态表示正在进入EDIT
  SystemState.interactionState = 'EDIT_ENTERING';

  // [DEBUG] 记录进入EDIT时的物体尺寸
  const radiusEdit = measureObjectRadius(obj);
  console.log(`[STATE] FOCUS→EDIT: 半径=${radiusEdit.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
  tracePoint(obj, 'FOCUS→EDIT');

  // 1. 临时移除世界格网（隐藏且不可吸附）
  SystemState.objects = SystemState.objects.filter(o => o !== SystemState.worldGrid);

  // 2. 计算目标姿态（使用与 snapToNearestOrientation 完全一致的四元数构建）
  const win = SystemState.mainWindow;
  OrientationImpl.computeStatesForView(win?.direction);

  // === 以下代码与 OrientationImpl.snapToNearestOrientation 完全一致 ===
  const defaultFront = { x: 0, y: 1, z: 0 };
  const defaultUp = { x: 0, y: 0, z: 1 };

  let front = obj.frontDirection ? { ...obj.frontDirection } : { ...defaultFront };
  let up = obj.upDirection ? { ...obj.upDirection } : { ...defaultUp };

  // 归一化
  let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
  if (lenF < 0.001) front = { ...defaultFront };
  else front = { x: front.x / lenF, y: front.y / lenF, z: front.z / lenF };

  let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
  if (lenU < 0.001) up = { ...defaultUp };
  else up = { x: up.x / lenU, y: up.y / lenU, z: up.z / lenU };

  // 正交化
  let right = {
    x: front.y * up.z - front.z * up.y,
    y: front.z * up.x - front.x * up.z,
    z: front.x * up.y - front.y * up.x
  };
  let lenR = Math.sqrt(right.x ** 2 + right.y ** 2 + right.z ** 2);
  if (lenR < 0.001) {
    right = { x: 1, y: 0, z: 0 };
  } else {
    right = { x: right.x / lenR, y: right.y / lenR, z: right.z / lenR };
  }

  up = {
    x: right.y * front.z - right.z * front.y,
    y: right.z * front.x - right.x * front.z,
    z: right.x * front.y - right.y * front.x
  };

  // 构建四元数（与 snapToNearestOrientation 使用相同的矩阵列顺序）
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

  const qLen = Math.sqrt(w * w + x * x + y * y + z * z);
  const currentQ = { w: w / qLen, x: x / qLen, y: y / qLen, z: z / qLen };
  // === 四元数构建结束 ===

  const targetState = OrientationImpl.getNearestState(currentQ);

  if (!targetState) {
    // 无法计算目标姿态，直接完成
    finishEnterEditState(obj);
    return;
  }

  // 3. 计算旋转差
  const targetQ = targetState.q;
  const invCurrentQ = { w: currentQ.w, x: -currentQ.x, y: -currentQ.y, z: -currentQ.z };
  let deltaQ = OrientationImpl._multiplyQuaternion(targetQ, invCurrentQ);

  // 关键修复：四元数 q 和 -q 代表相同旋转，选择 w > 0 的以获得最短路径
  if (deltaQ.w < 0) {
    deltaQ = { w: -deltaQ.w, x: -deltaQ.x, y: -deltaQ.y, z: -deltaQ.z };
  }

  const rotAngle = 2 * Math.acos(Math.max(-1, Math.min(1, deltaQ.w)));
  console.log(`[STATE] EDIT snap: 需旋转 ${(rotAngle * 180 / Math.PI).toFixed(1)}°`);

  if (Math.abs(rotAngle) < 0.01) {
    // 几乎不需要旋转，直接完成
    obj._currentOrientationState = targetState;
    obj.quaternion = { ...targetState.q };
    finishEnterEditState(obj);
    return;
  }

  // 4. 提取旋转轴
  const sinHalf = Math.sin(rotAngle / 2);
  let rotAxis = { x: 0, y: 0, z: 1 };
  if (Math.abs(sinHalf) > 0.001) {
    rotAxis = {
      x: deltaQ.x / sinHalf,
      y: deltaQ.y / sinHalf,
      z: deltaQ.z / sinHalf
    };
  }

  // 5. 设置动画锁
  obj.animationLock = true;

  // 6. 创建旋转动画任务
  const duration = 250; // 250ms 过渡
  let lastProgress = 0;

  const rotateTask = AnimationImpl.createTask({
    id: 'edit_snap_' + Date.now(),
    target: obj,
    duration,
    easing: AnimationImpl.Easing.easeOut,
    compute: (progress) => ({ progress }),
    apply: (targetObj, value) => {
      const progressDelta = value.progress - lastProgress;
      const rotationAmount = rotAngle * progressDelta;

      if (rotationAmount > 0.0001) {
        OrientationImpl.rotateObjectAroundAxis(targetObj, rotAxis, rotationAmount);
      }
      lastProgress = value.progress;
    }
  });

  rotateTask.onComplete = () => {
    obj.animationLock = false;
    // 更新物体的姿态状态
    obj._currentOrientationState = targetState;
    obj.quaternion = { ...targetState.q };

    // 完成剩余的 EDIT 初始化
    finishEnterEditState(obj);
  };

  SystemState.taskQueues.submit(rotateTask);
  SystemState.ifControl = true;
}

/**
 * 完成 EDIT 态进入（动画后调用或无需动画时直接调用）
 * @param {Object} obj - 物体对象
 */
function finishEnterEditState(obj) {
  // 正式进入 EDIT 态
  SystemState.interactionState = 'EDIT';

  // 移动物体到屏幕平面
  const win = SystemState.mainWindow;
  if (win && win.direction) {
    const dir = win.direction;
    const planePt = dir.start;

    const currentDist = (obj.center.x - planePt.x) * dir.x +
      (obj.center.y - planePt.y) * dir.y +
      (obj.center.z - planePt.z) * dir.z;

    const moveX = -currentDist * dir.x;
    const moveY = -currentDist * dir.y;
    const moveZ = -currentDist * dir.z;

    if (typeof moveObjectTo === 'function') {
      moveObjectTo(obj, obj.center.x + moveX, obj.center.y + moveY, obj.center.z + moveZ);
    }

    console.log(`[STATE] EDIT对齐: 移动=${(-currentDist).toFixed(2)}cm, 新center.y=${obj.center.y.toFixed(2)}`);
  }

  // 创建并显示局部格网
  const localGrid = ObjectFactoryImpl.createLocalGridObject(obj);
  SystemState.localGrid = localGrid;
  SystemState.objects.push(localGrid);

  // 显示控制点
  showControlPoints(obj);

  // 触发渲染
  SystemState.ifControl = true;
  console.log('[STATE] EDIT entered');
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
  // [DEBUG] 记录退出EDIT后的物体尺寸
  const objExit = SystemState.focusedObject;
  if (objExit) {
    const radiusExitEdit = measureObjectRadius(objExit);
    console.log(`[STATE] EDIT→FOCUS: 半径=${radiusExitEdit.toFixed(3)}cm, center.y=${objExit.center.y.toFixed(2)}`);
    tracePoint(objExit, 'EDIT→FOCUS');
  }

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
