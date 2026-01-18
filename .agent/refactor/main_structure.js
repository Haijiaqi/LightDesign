/**
 * ===========================
 * MAIN.JS REFACTOR PROTOCOL
 * ===========================
 *
 * 本文件正在进行 Phase-by-Phase 拆分。
 *
 * ⚠️ 全局约束：
 * 1. 仅允许执行注释中明确标注的操作
 * 2. 禁止提前实现后续 Phase 的内容
 * 3. 禁止引入新抽象、新配置系统、新调度引擎
 * 4. 禁止修改任何业务逻辑、计算公式、调用顺序
 * 5. 禁止子模块之间产生依赖
 *
 * 如遇不确定情况：
 * - 必须暂停
 * - 以 TODO 标记
 * - 不得自行决策
 *
 * ⚠️ [EXTRACT-LATER] / [STAY] 函数处理规则：
 * - 所有未标记为 [MIGRATE] 的函数（如 rotateEditObject 等），其函数体应视为“冻结示意”
 * - 不允许任何重构、补全、删除、合并
 * - 即使逻辑明显不完整或调用了其他函数，也必须原样保留
 */

/**
 * main.js 结构分析文件
 * 仅保留引用、变量及方法签名、方法内调用关系
 * 用于结构分析和重构指导
 */

// ============================================================================
// IMPORTS
// ============================================================================
// [STAY IN main.js]
// 理由：
// - 导入声明随拆分自动调整
// - Phase 2 完成后需更新为从子模块导入
import { Window } from "./base/Window.js";
import { Object } from "./base/Object.js";
import { Point } from "./base/Point.js";
import { Vector } from "./base/Vector.js";
import { Classifier } from "./math/Classifier.js";
import { StyleImpl } from "./manage/StyleImpl.js";
import { AnimationImpl } from "./manage/AnimationImpl.js";
import { ObjectFactoryImpl } from "./manage/ObjectFactoryImpl.js";
import { OrientationImpl } from "./manage/OrientationImpl.js";

// ============================================================================
// CONSTANTS
// ============================================================================
// [MIGRATE → manage/SystemState.js]
// 操作类型：代码迁移（Migration）
// 约束：
// - 仅剪切 + 粘贴
// - 不修改属性名
// - 导出后在 main.js 中 import { CONFIG } from './manage/SystemState.js'
const CONFIG = { /* 屏幕、相机、光照、物理参数 */ };

// ============================================================================
// STATE
// ============================================================================
// [MIGRATE → manage/SystemState.js]
// 操作类型：代码迁移（Migration）
// 约束：
// - 仅剪切 + 粘贴
// - 不修改属性名
// - 需处理 ObjectFactoryImpl.createTestScene() 的 import
// - 导出后在 main.js 中 import { SystemState } from './manage/SystemState.js'
const SystemState = {
    // 控制标志
    ifControl: true,
    // 物体集合
    objects: [],           // ObjectFactoryImpl.createTestScene()
    otherObjects: [],
    screenPoints: [],
    // 窗口
    hiddenWindow: null,
    lightWindow: null,
    mainWindow: null,
    // 相机
    rotationCenter: null,
    // 输入状态
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    keys: {},
    mouseEdge: 0,
    // DOM
    canvas: null,
    ctx: null,
    debugDiv: null,
    screenWidthPx: 0,
    screenHeightPx: 0,
    // 摄像头
    video: null,
    videoCanvas: null,
    videoCtx: null,
    cameraActive: false,
    targetPosition: { x: 0, y: 0 },
    // 任务队列
    taskQueues: {
        current: [],
        next: [],
        swap() { /* ... */ },
        submit(task) { /* ... */ },
        cancel(taskId) { /* ... */ }
    },
    // 时间
    worldTime: 0,
    lastTimestamp: 0,
    // 交互状态
    interactionState: 'VIEW', // VIEW | FOCUS | FOCUS_ENTERING | EDIT | EDIT_ENTERING
    focusedObject: null,
    focusSliceDepth: 0,
    focusVirtualMouseDepth: 0,
    // 蓄力
    isCharging: false,
    chargeStartTime: 0,
    chargePosition: { x: 0, y: 0 },
    chargeHitPoint: null,
    // 编辑
    editDepthLayer: 0,
    draggedControlPoint: null,
    longPressTimer: null,
    longPressTarget: null,
    // 速度状态
    velocityState: {
        rotation: { current: 0, target: 0, factor: 0 },
        moveForward: { current: 0, target: 0, factor: 0 }
    },
    focusRotationState: { /* ... */ },
    // 网格
    worldGrid: null,
    localGrid: null,
    // 虚拟鼠标
    virtualMouse: {
        enabled: true,
        screenPosition: { x: 0, y: 0 },
        snappedTo: null
    },
    // 拖拽
    draggingObject: null,
    dragStartCenter: null
};

// [MIGRATE → manage/CameraSystem.js]
// 理由：Classifier 用于摄像头视频处理，跟随 CameraSystem 一起迁移
// ⚠️ 状态性澄清：
// - CameraSystem 中允许存在 **模块级私有状态**（如 Classifier C）
// - 但：不得读取 interactionState / keys，不得修改 SystemState 除摄像头字段以外的任何内容
const C = new Classifier();

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑的瞬态变量
// - 用于双击检测
let lastClickTime = 0;
let lastClickTarget = null;
const DOUBLE_CLICK_THRESHOLD = 300;

// ============================================================================
// CAMERA SYSTEM (摄像头子系统)
// ============================================================================
// [MIGRATE → manage/CameraSystem.js]
// 操作类型：代码迁移（Migration）
// 约束：
// - 仅剪切 + 粘贴
// - 不修改函数签名
// - 只暴露纯函数
// - 禁止依赖 InputManager 或 Renderer
// - 禁止读取 interactionState、keys 等输入相关状态
// [BOUNDARY]
// 本区块：
// - 不得 import 任何其他子模块
// - 只能被 main.js 直接调用
async function initCamera() {
    // → navigator.mediaDevices.getUserMedia()
    // → SystemState.video, videoCanvas, videoCtx
}

// [MIGRATE → manage/CameraSystem.js]
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 数学计算
// - 循环结构
function processCamera() {
    processQueue(/*...*/);
    // → SystemState.mainWindow.headMoveTo()
}

// [MIGRATE → manage/CameraSystem.js]
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 数据平滑算法
function processQueue(dataList, num, maxLength = 5, tol = 0.1) {
    // 数据平滑处理
}

// [MIGRATE → manage/CameraSystem.js]
function initCameraDisplay(scale = 0.5) {
    // → SystemState.videoDisplayCanvas
}

// [MIGRATE → manage/CameraSystem.js]
function updateCameraDisplay(test) {
    C.updateCameraDisplay(SystemState, test);
}

// [MIGRATE → manage/CameraSystem.js]
function drawCameraFeedOnMainCanvas(ctx, x = 0, y = 0, width = 200, height = 150, opacity = 0.5) {
    // → ctx.drawImage()
}

// ============================================================================
// RENDERER (渲染子系统)
// ============================================================================
// [ENCAPSULATE → manage/Renderer.js]
// 操作类型：封装迁移
// 允许：
// - 包装为对象 / 命名导出
// - 依赖 SystemState（读取 ctx, width, height, objects）和 StyleImpl（LUT）
// 禁止：
// - 修改内部实现
// - 修改调用时机
// - 依赖 InputManager 或 CameraSystem
// - 读取 interactionState、isDragging 等输入相关状态
// [BOUNDARY]
// 本区块：
// - 不得 import 任何其他子模块
// - 只能被 main.js 直接调用
// ⚠️ [READ-ONLY] 仅约束：函数体内部逻辑、循环、数学计算
// ⚠️ 不约束：函数的组织方式、对象封装、export 形式
const Renderer = {
    LUT: null, // StyleImpl.getLUT()

    // [READ-ONLY]
    // ⚠️ 禁止修改以下内容：
    // - 邻居遍历逻辑
    //Renderer.render()
    // 固定签名：render()
    // 所有 ctx / width / height 必须从 SystemState 内部读取
    // 禁止通过参数传递渲染上下文
    forEachNeighbor(x, y, light, callback) {
        // 邻居像素遍历
    },

    // [READ-ONLY]
    // ⚠️ 禁止修改以下内容：
    // - LUT 查表逻辑
    // - 像素写入逻辑
    drawColoredPointImpl(ctxData, width, height, x, y, light, colorType, baseLight, maxLutIndex, drawNeighbors) {
        this.forEachNeighbor(/*...*/);
    },

    // [READ-ONLY]
    // ⚠️ 禁止修改以下内容：
    // - 渲染循环结构
    // - 3D/2D 判断逻辑
    // - 性能关键路径
    render(ctx, width, height) {
        this.drawColoredPointImpl(/*...*/);
        // → imageData
    },

    renderPointSimple(p, light, pixelData, width, height) {
        // 简单点渲染
    },

    renderScreenPointsHelper(pixelData, width, height) {
        this.renderPointSimple(/*...*/);
    }
};

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 协调多个子模块（updateCamera, Renderer, updateVirtualMouse, renderScreenOverlay）
// - Phase 2 完成后改为调用 Renderer 模块
function render() {
    updateCamera();
    const imageData = Renderer.render(/*...*/);
    Renderer.renderScreenPointsHelper(/*...*/);
    updateVirtualMouse(/*...*/);
    renderScreenOverlay(/*...*/);
    // → ctx.putImageData()
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 调用 Window.calculate()
function updateCamera() {
    SystemState.mainWindow.calculate(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 调用 Window.calculate() 和 ObjectFactoryImpl
function updateLight() {
    SystemState.lightWindow.calculate(/*...*/);
    ObjectFactoryImpl.createSphere(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 操作 grid 数据
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 反射向量计算
function updateVisibleReflection() {
    // 更新网格点的反射向量
}

// [STAY IN main.js]
// 理由：
// - 初始化阶段调用
// - 操作 Window 对象
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 法向量估算算法
function estimateNormals() {
    // 法向量估算
}

// ============================================================================
// VIRTUAL MOUSE (虚拟鼠标子系统)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - 虚拟鼠标物理层已在 Window.js 中
// - 此函数是 Hub 协调逻辑，调用 Window.findNearestPoint 和 virtualCursor
// - Phase 2 不拆分
function updateVirtualMouse(mouseX, mouseY) {
    // → SystemState.mainWindow.findNearestPoint()
    // → SystemState.mainWindow.virtualCursor.setSnappedPoint()
    isGridPointOccupied(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - 操作 grid 数据
// - 被 updateVirtualMouse 调用
function isGridPointOccupied(gx, gy, gridPoint, draggingObject) {
    // → SystemState.mainWindow.grid
}

// [STAY IN main.js]
// 理由：
// - 屏幕覆盖渲染
// - 调用 renderScreenPixel
function renderScreenOverlay(pixelData, width, height) {
    renderScreenPixel(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - 被 renderScreenOverlay 调用
// - 使用 Renderer.LUT
function renderScreenPixel(x, y, colorType, light, pixelData, width, height) {
    // → Renderer.LUT
}

// [STAY IN main.js]
// 理由：
// - 操作 grid 数据
// - 被 FOCUS 状态使用
function findSurfaceHit(screenX, screenY) {
    // → SystemState.mainWindow.grid
}

// ============================================================================
// INPUT MAPS (输入映射表)
// ============================================================================
// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 操作类型：Intent 生成器改造
// 当前代码：
// - 不允许直接执行行为
// - 必须返回 Intent 对象
// - 禁止修改 SystemState
// - 禁止修改 SystemState
// - 禁止调用 CameraSystem / Renderer / Window 的任何方法
// ⚠️ 在 [INTENT-ONLY] 区块中：
// - 若原代码存在直接调用行为函数（如 moveObjectTo / enterFocusState）
// - 必须将该调用视为“历史残留示意”
// - 实施时必须删除函数调用，仅返回 Intent
// [BOUNDARY]
// 本区块：
// - 不得 import 任何其他子模块（CameraSystem / Renderer / Window）
// - 只能被 main.js 直接调用
const InputMaps = {
    VIEW: {
        onContinuousInput() { handleViewContinuousInput(); },
        onKeyDown(e) { handleViewKeyDown(e); },
        onMouseDown(e) { handleViewMouseDown(e); },
        onMouseMove(e) { handleViewMouseMove(e); },
        onWheel(e) { handleViewWheel(e); },
        onClick(e) { handleViewClick(e); }
    },
    FOCUS: {
        onContinuousInput() { handleFocusEdgeRotation(); },
        onKeyDown(e) { handleFocusKeyDown(e); },
        onMouseDown(e) { handleFocusMouseDown(e); },
        onMouseMove(e) { /* 空 */ },
        onWheel(e) { handleFocusWheel(e); },
        onClick(e) { handleFocusClick(e); }
    },
    FOCUS_ENTERING: {
        onContinuousInput() { handleFocusEnteringContinuousInput(); },
        onKeyDown(e) { },
        onMouseDown(e) { },
        onMouseMove(e) { },
        onWheel(e) { },
        onClick(e) { }
    },
    EDIT: {
        onContinuousInput() { handleEditContinuousInput(); },
        onKeyDown(e) { handleEditKeyDown(e); },
        onMouseDown(e) { handleEditMouseDown(e); },
        onMouseMove(e) { handleEditMouseMove(e); },
        onWheel(e) { handleEditWheel(e); },
        onClick(e) { handleEditClick(e); },
        onWheelSliceDepth(e) { handleEditWheelSliceDepth(e); }
    }
};

// ============================================================================
// INPUT HANDLERS - VIEW STATE
// ============================================================================
// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'SET_VELOCITY', payload: {...} }
// - 禁止直接修改 velocityState
function handleViewContinuousInput() {
    // → SystemState.keys, velocityState
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'RESET_CAMERA_DISTANCE' }
// - 禁止直接调用 resetCameraDistance()
function handleViewKeyDown(e) {
    if (e.key === 'Escape') resetCameraDistance();
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'START_DRAG', payload: { object } }
// - 禁止直接修改 draggingObject
function handleViewMouseDown(e) {
    // → SystemState.virtualMouse.snappedTo
    // → SystemState.draggingObject
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'MOVE_OBJECT', payload: { x, y, z } }
// - 禁止直接调用 moveObjectTo()
function handleViewMouseMove(e) {
    moveObjectTo(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'CAMERA_ZOOM', payload: { delta } }
// - 禁止直接修改 mainWindow.capital
function handleViewWheel(e) {
    // → SystemState.mainWindow.capital, direction
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'ENTER_FOCUS', payload: { object } }
// - 禁止直接调用 enterFocusState()
function handleViewClick(event) {
    enterFocusState(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 直接操作 mainWindow.capital
function resetCameraDistance() {
    // → SystemState.mainWindow.capital
}

// ============================================================================
// INPUT HANDLERS - FOCUS STATE
// ============================================================================
// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 null（无操作）
function handleFocusEnteringContinuousInput() {
    // 空
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'ROTATE_FOCUSED_OBJECT', payload: { dx, dy } }
// - 禁止直接调用 rotateFocusedObject()
function handleFocusEdgeRotation() {
    rotateFocusedObject(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'EXIT_FOCUS' }
// - 禁止直接调用 exitFocusState()
function handleFocusKeyDown(e) {
    if (e.key === 'Escape') exitFocusState();
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'START_DRAG' }
// - 禁止直接修改 isDragging
function handleFocusMouseDown(e) {
    // → SystemState.isDragging
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'ADJUST_SLICE_DEPTH', payload: { delta } }
// - 禁止直接调用 updateSliceContour()
function handleFocusWheel(e) {
    updateSliceContour();
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'ENTER_EDIT' }
// - 禁止直接调用 enterEditState()
function handleFocusClick(event) {
    enterEditState();
}

// ============================================================================
// INPUT HANDLERS - EDIT STATE
// ============================================================================
// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 null（无操作）
function handleEditContinuousInput() {
    // 空
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'EXIT_EDIT' } 或 { type: 'ROTATE_OBJECT', payload: { key } }
// - 禁止直接调用 exitEditState(), OrientationImpl.transition(), animateRotation()
function handleEditKeyDown(e) {
    if (e.key === 'Escape') exitEditState();
    OrientationImpl.transition(/*...*/);
    animateRotation(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'SELECT_CONTROL_POINT', payload: { point } }
// - 禁止直接调用 findControlPointAt(), deleteControlPoint()
function handleEditMouseDown(e) {
    findControlPointAt(/*...*/);
    deleteControlPoint(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'MOVE_CONTROL_POINT', payload: { dx, dy } }
// - 禁止直接调用 moveControlPoint()
function handleEditMouseMove(e) {
    moveControlPoint(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'CHANGE_DEPTH_LAYER', payload: { delta } }
// - 禁止直接调用 updateControlPointsDisplay()
function handleEditWheel(e) {
    updateControlPointsDisplay();
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'SCROLL_SLICE_DEPTH', payload: { delta } }
// - 禁止直接调用 animateSliceTransition()
function handleEditWheelSliceDepth(e) {
    ObjectFactoryImpl.LocalGridConfig.getMaxDepthForOrientation(/*...*/);
    animateSliceTransition(/*...*/);
}

// [INTENT-ONLY]
// [MIGRATE → manage/InputManager.js]
// 改造要求：
// - 返回 Intent 对象，如 { type: 'ADD_CONTROL_POINT', payload: { x, y } }
// - 禁止直接调用 addControlPointAt(), findControlPointAt()
function handleEditClick(event) {
    addControlPointAt(/*...*/);
    findControlPointAt(/*...*/);
}

// ============================================================================
// STATE TRANSITIONS (状态切换)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 状态切换核心
// - Phase 2 禁止下沉
function enterViewState() {
    // SystemState.interactionState = 'VIEW'
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 状态切换核心
// - 调用多个子模块和动画系统
// - Phase 2 禁止下沉
function enterFocusState(obj) {
    // SystemState.interactionState = 'FOCUS_ENTERING' → 'FOCUS'
    measureObjectRadius(/*...*/);
    tracePoint(/*...*/);
    calculateCenterPosition();
    OrientationImpl.rotateObjectAroundAxis(/*...*/);
    AnimationImpl.createTask(/*...*/);
    SystemState.taskQueues.submit(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 状态切换核心
// - 调用多个子模块和动画系统
// - Phase 2 禁止下沉
function exitFocusState() {
    // SystemState.interactionState = 'VIEW'
    enterViewState();
    AnimationImpl.createTask(/*...*/);
    AnimationImpl.lerpVec3(/*...*/);
    OrientationImpl.rotateObjectAroundAxis(/*...*/);
    SystemState.taskQueues.submit(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 状态切换核心
// - 调用多个子模块和动画系统
// - Phase 2 禁止下沉
function enterEditState() {
    // SystemState.interactionState = 'EDIT_ENTERING' → 'EDIT'
    measureObjectRadius(/*...*/);
    tracePoint(/*...*/);
    OrientationImpl.computeStatesForView(/*...*/);
    OrientationImpl.getNearestState(/*...*/);
    OrientationImpl.rotateObjectAroundAxis(/*...*/);
    AnimationImpl.createTask(/*...*/);
    finishEnterEditState(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - enterEditState 的后续步骤
function finishEnterEditState(obj) {
    moveObjectTo(/*...*/);
    ObjectFactoryImpl.createLocalGridObject(/*...*/);
    showControlPoints(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 状态切换核心
function exitEditState() {
    // SystemState.interactionState = 'FOCUS'
    hideControlPoints();
}

// ============================================================================
// OBJECT MANIPULATION (物体操作)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 直接操作物体位置
// - 被多个状态切换函数调用
function moveObjectTo(obj, x, y, z) {
    // 移动物体
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 旋转聚焦物体
function rotateFocusedObject(dx, dy) {
    // 旋转聚焦物体
    updateSliceContour();
}

// [STAY IN main.js]
// 理由：
// - 更新截面轮廓
// - 被 rotateFocusedObject 和 handleFocusWheel 调用
function updateSliceContour() {
    // 更新截面轮廓
}

// ============================================================================
// CONTROL POINTS (控制点操作)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 控制点显示/隐藏
function showControlPoints(obj) {
    // 显示控制点
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 控制点显示/隐藏
function hideControlPoints() {
    // 隐藏控制点
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 被 handleEditMouseDown 和 handleEditClick 调用
function findControlPointAt(screenX, screenY) {
    // 查找控制点
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 控制点移动
function moveControlPoint(controlPoint, dx, dy) {
    // 移动控制点
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 控制点删除
function deleteControlPoint(controlPoint) {
    updateControlPointsDisplay();
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 控制点添加
function addControlPointAt(screenX, screenY) {
    updateControlPointsDisplay();
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 更新控制点显示
function updateControlPointsDisplay() {
    hideControlPoints();
    showControlPoints(/*...*/);
}

// [EXTRACT-LATER Phase 3]
// 当前阶段：
// - 禁止处理
// - 禁止抽象
// - 禁止迁移
function rotateEditObject(angleX, angleZ) {
    updateControlPointsDisplay();
}

// ============================================================================
// LOCAL GRID (局部网格)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 更新局部网格
// - 调用 OrientationImpl 和 ObjectFactoryImpl
function updateLocalGrid() {
    OrientationImpl.getQuaternionFromVectors(/*...*/);
    OrientationImpl.applyQuaternion(/*...*/);
    ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 被 animateRotation 调用
function snapToNearestLayer(obj) {
    ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(/*...*/);
    ObjectFactoryImpl.LocalGridConfig.getMaxDepthForOrientation(/*...*/);
    animateSliceTransition(/*...*/);
}

// ============================================================================
// ANIMATION (动画)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 动画执行
// - 调用 moveObjectTo 和 updateLocalGrid
function animateSliceTransition(obj, targetX, targetY, targetZ, duration = 150) {
    moveObjectTo(/*...*/);
    updateLocalGrid();
    // → requestAnimationFrame(animate)
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 动画执行
// - 调用 OrientationImpl、updateLocalGrid、snapToNearestLayer
function animateRotation(obj, axis, totalAngle, duration = 200) {
    OrientationImpl.rotateObjectAroundAxis(/*...*/);
    updateLocalGrid();
    snapToNearestLayer(/*...*/);
    // → requestAnimationFrame(animate)
}

// ============================================================================
// PHYSICS (物理)
// ============================================================================
// [EXTRACT-LATER Phase 3]
// 当前阶段：
// - 禁止处理
// - 禁止抽象
// - 禁止迁移
function physicsStep(dt) {
    // 物理步进
}

// [STAY IN main.js]
// 理由：
// - 蓄力计算
// - 被 mouseup 事件调用
function calculateImpulse(duration) {
    // 计算冲量
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 冲量应用
function applyTouchImpulse(impulse) {
    applyTouchImpulseSimple(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - 简化冲量应用
// - 被 applyTouchImpulse 调用
function applyTouchImpulseSimple(impulse) {
    // 简化冲量应用
}

// [EXTRACT-LATER Phase 3]
// 当前阶段：
// - 禁止处理
// - 禁止抽象
// - 禁止迁移
function applyQuaternionToPoints(obj) {
    updateLocalGrid();
}

// ============================================================================
// UTILITIES (工具函数)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - 调试工具函数
// - 被状态切换函数调用
function measureObjectRadius(obj) {
    // 测量物体半径
}

// [STAY IN main.js]
// 理由：
// - 调试工具函数
// - 被状态切换函数调用
function tracePoint(obj, label) {
    // 追踪点位置
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 计算中心位置
function calculateCenterPosition() {
    // 计算中心位置
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 事件转发
function onMouseClick(event) {
    // → InputMaps[...].onClick()
}

// [STAY IN main.js]
// 理由：
// - 操作 grid 数据
// - 查找点击的物体中心
function findClickedObjectCenter(screenX, screenY) {
    // → SystemState.mainWindow.grid
}

// [EXTRACT-LATER Phase 3]
// 当前阶段：
// - 禁止处理
// - 禁止抽象
// - 禁止迁移
function createObjectFromCommand(command) {
    ObjectFactoryImpl.createSphere(/*...*/);
    ObjectFactoryImpl.createCube(/*...*/);
}

// [EXTRACT-LATER Phase 3]
// 当前阶段：
// - 禁止处理
// - 禁止抽象
// - 禁止迁移
function updateFromCamera(cameraData) {
    // 从摄像头更新
}

// ============================================================================
// VELOCITY & INPUT (速度与输入处理)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 输入处理入口
// - Phase 2 完成后改为调用 InputManager.getIntent()
function handleInput() {
    // → InputMaps[SystemState.interactionState].onContinuousInput()
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 速度计算
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 对数速度算法
function updateLogVelocity(state, dt, accelK = 3.0) {
    // 对数速度更新
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 应用速度
function applyVelocities(dt) {
    updateLogVelocity(/*...*/);
    userRotate(/*...*/);
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 用户旋转
// [READ-ONLY]
// ⚠️ 禁止修改以下内容：
// - 旋转计算
function userRotate(angle) {
    // 用户旋转
}

// ============================================================================
// TASK QUEUE (任务队列)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 任务队列处理
function processTaskQueue(worldTime, dt) {
    AnimationImpl.executeTask(/*...*/);
    SystemState.taskQueues.swap();
}

// ============================================================================
// EVENT LISTENERS (事件监听)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 事件绑定
// - Phase 2 完成后改为调用 InputManager.getIntent() 获取 Intent
function setupEventListeners() {
    // keydown → SystemState.keys, InputMaps[...].onKeyDown()
    // keyup → SystemState.keys
    // click → InputMaps[...].onClick()
    // wheel → InputMaps[...].onWheel(), onWheelSliceDepth()
    // mousedown → InputMaps[...].onMouseDown()
    // mouseup → calculateImpulse(), applyTouchImpulse(), moveObjectTo()
    // mousemove → InputMaps[...].onMouseMove(), updateVirtualMouse()
    // resize → resizeCanvas()
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 画布调整
function resizeCanvas() {
    // 调整画布大小
}

// ============================================================================
// INIT & MAIN LOOP (初始化与主循环)
// ============================================================================
// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 初始化入口
// - 调用所有子系统初始化
async function init() {
    resizeCanvas();
    // → new Window(...) × 3
    // → new Point(...), new Vector(...)
    estimateNormals();
    updateLight();
    ObjectFactoryImpl.createWorldGrid(/*...*/);
    setupEventListeners();
    initCamera();
}

// [STAY IN main.js]
// 理由：
// - Hub 调度逻辑
// - 主循环
// - 协调所有子系统
// [VERIFY]
// 拆分后请确认：
// - 行为一致
// - 调用顺序一致
// - SystemState 未被复制
function gameLoop(timestamp = 0) {
    handleInput();
    applyVelocities(/*...*/);
    processTaskQueue(/*...*/);
    physicsStep(/*...*/);
    updateLocalGrid();
    drawCameraFeedOnMainCanvas(/*...*/);
    updateLight();
    updateVisibleReflection();
    render();
    // → requestAnimationFrame(gameLoop)
}

// ============================================================================
// ENTRY POINT
// ============================================================================
// [STAY IN main.js]
// 理由：
// - 入口点
init().then(() => { gameLoop(); }).catch(console.error);
