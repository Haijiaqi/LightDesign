import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js";

// ========================
// 1. 配置参数（预留接口）
// ========================
export const CONFIG = {
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

export const SystemState = {
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
