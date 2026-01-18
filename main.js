import { Window } from "./base/Window.js";
import { Object } from "./base/Object.js";
import { Point } from "./base/Point.js";
import { Vector } from "./base/Vector.js";
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
import { SystemState, CONFIG } from "./manage/SystemState.js";
import { Renderer } from "./manage/Renderer.js";
import { ObjectFactoryImpl } from "./manage/ObjectFactoryImpl.js";
import * as CameraSystem from "./manage/CameraSystem.js";
import * as CursorSystem from "./manage/CursorSystem.js";
import * as InputManager from "./manage/InputManager.js";

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
  InputManager.setupEventListeners();

  // 初始化摄像头
  await CameraSystem.initCamera(); // 等待摄像头初始化
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
    CursorSystem.updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
  }

  // 渲染屏幕辅助元素（虚拟鼠标等）
  CursorSystem.renderScreenOverlay(pixelData, width, height);

  // 4. 批量渲染所有像素（仅1次DOM操作）
  ctx.putImageData(imageData, 0, 0);
}

// =====================================================
// [G] Window / Screen Glue
// =====================================================
// 说明: 只调用window,不自己算screen坐标
// 要求: 所有虚拟鼠标使用统一走window.virtualCursor
// =====================================================



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


// ========================
// 12. 事件监听器设置(Phase 2:纯转发)
// ========================
function setupEventListeners() {
  window.addEventListener("resize", () => {
    SystemState.ifControl = true;
    resizeCanvas();
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

/**
 * 查找点击位置的表面点（阶段13新增）
 * @param {number} screenX - 屏幕 X 坐标
 * @param {number} screenY - 屏幕 Y 坐标
 * @returns {Point|null} 表面点或 null
 */

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

/**
 * 查找点击位置的物心（专门搜索 isObjectCenter 点）
 * @param {number} screenX - 屏幕 X 坐标
 * @param {number} screenY - 屏幕 Y 坐标
 * @returns {Object|null} 物体对象或 null
 */

// ========================
// 阶段16c：综合离散姿态系统 (96+ 态，视窗相对)
// ========================

// OrientationUtils 和 snapToNearestOrientation 已迁移至 OrientationImpl.js

/**
 * 进入 EDIT 态（阶段15/16完善，动画版）
 * EDIT 态：编辑模式，可操作控制点
 * 优化：姿态吸附使用动画过渡，格网在动画完成后创建
 */
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
  InputManager.handleInput();

  // 1.5 应用对数速度（整饬新增）
  InputManager.applyVelocities(dt);

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
  InputManager.updateLocalGrid();

  // 4. 摄像头显示
  CameraSystem.drawCameraFeedOnMainCanvas(SystemState.ctx);

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
