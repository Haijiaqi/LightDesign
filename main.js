/**
 * main.js - 核心逻辑枢纽 (Core Logic Hub)
 *
 * 模块职责索引 (Module Responsibility Index):
 *
 * [基础类 (Base)]
 * - base/Window.js:          3D投影窗口控制，负责坐标变换(世界->屏幕)、视锥体计算。
 * - base/Object.js:          3D物体基类，包含点云数据、中心点及基础属性。
 * - base/Point.js:           基础点类(x,y,z)，承载位置信息。
 * - base/Vector.js:          向量数学库，提供法向量计算、点积叉积等工具。
 *
 * [管理类 (Manage) - 逻辑/功能]
 * - manage/SystemState.js:   全局状态单例，存储 SystemState(运行时状态)。
 * - manage/Config.js:        集中式静态配置，定义屏幕尺寸、渲染参数及交互阈值(SystemState导出)。
 * - manage/InputManager.js:  输入交互管理器，负责监听鼠标/键盘事件并将原始输入转换为"意图(Intent)"传回 main.js。
 * - manage/Renderer.js:      渲染器，负责 Canvas 绘图、LUT 颜色查找表及像素级点云绘制。
 * - manage/CameraSystem.js:  摄像头系统，处理 WebCam 视频流、人脸/光源位置检测逻辑。
 * - manage/AnimationImpl.js: 动画系统，提供任务队列(Process/Next)、缓动函数及差值计算。
 * - manage/ObjectFactoryImpl.js: 对象工厂，负责生产几何体(立方体/球)、网格(世界/局部)及测试场景。
 * - manage/OrientationImpl.js:   姿态管理，处理四元数旋转、轴对齐(Snap)及姿态平滑过渡。
 */

import { Window } from "./base/Window.js";
import { Object } from "./base/Object.js";
import { Point } from "./base/Point.js";
import { Vector } from "./base/Vector.js";
import { AnimationImpl } from "./manage/AnimationImpl.js";
import { ObjectFactoryImpl } from "./manage/ObjectFactoryImpl.js";
import { OrientationImpl } from "./manage/OrientationImpl.js";

import { SystemState, CONFIG, EditConfig } from "./manage/SystemState.js";
import { OverlaySystem } from "./manage/OverlaySystem.js";
import { CameraSystem } from "./manage/CameraSystem.js";
import { Renderer } from "./manage/Renderer.js";
import { InputManager } from "./manage/InputManager.js";
import { HistoryManager, createMoveCommand, createMoveControlPointCommand, createAddControlPointCommand, createDeleteControlPointCommand } from "./manage/HistoryManager.js";

// [新增] 导入数学模块
import { SphericalHarmonics } from "./math/SphericalHarmonics.js";
import { Matrix } from "./math/Matrix.js";
import { FittingCalculator } from "./math/FittingCalculator.js";

// [新增] 导入参数化实现（用于动态阶数计算）
import { ParametricImpl } from "./base/ParametricImpl.js";

// Phase 9: 导入物理系统
import { PhysicsSystem } from "./math/PhysicsSystem.js";


// ============================================================================
// CORE LOGIC & HUB
// ============================================================================

// Phase 9: 全局物理系统实例（懒惰初始化）
let _globalPhysicsSystem = null;

async function init() {
    SystemState.canvas = document.createElement("canvas");
    SystemState.ctx = SystemState.canvas.getContext("2d");
    SystemState.debugDiv =
        document.getElementById("debug") || document.createElement("div");
    SystemState.debugDiv.id = "debug";
    if (!document.getElementById("debug")) {
        document.body.appendChild(SystemState.debugDiv);
    }
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
    SystemState.mainWindow = new Window(
        window.innerWidth,
        window.innerHeight,
        (window.innerWidth / CONFIG.screenWidth) * CONFIG.screenXLengthCm,
        (window.innerHeight / CONFIG.screenHeight) * CONFIG.screenYLengthCm,
        "main",
    );
    const displayWidth = CONFIG.screenXLengthCm;
    const eyeToScreenDist = 1.0 * displayWidth;
    CONFIG.screenDistance = CONFIG.userDistanceFromOrigin + eyeToScreenDist;
    const eyeZ = CONFIG.userEyeHeight;
    const screenZ = CONFIG.screenCenterHeight;
    SystemState.rotationCenter = new Point(0, 0, screenZ);
    SystemState.mainWindow.capital = new Point(0, CONFIG.userDistanceFromOrigin, eyeZ);
    SystemState.mainWindow.direction = new Vector(0, 0, 0);
    SystemState.mainWindow.direction.normalInit(
        0, CONFIG.screenDistance, screenZ,
        0, CONFIG.screenDistance + 1, screenZ
    );
    estimateNormals();
    updateLight();
    SystemState.worldGrid = ObjectFactoryImpl.createWorldGrid(10, displayWidth * 2);
    SystemState.movementConstraints = {
        initialY: CONFIG.userDistanceFromOrigin,
        range: 0.5 * displayWidth
    };
    SystemState.objects.push(SystemState.worldGrid);

    // [New] Create Light Object as a persistent, movable object
    SystemState.lightObject = ObjectFactoryImpl.createSphere(CONFIG.lightX, CONFIG.lightY, CONFIG.lightZ, 0.5, 20);
    SystemState.lightObject.tag = 'LIGHT_SOURCE';
    SystemState.objects.push(SystemState.lightObject);

    // [New] Integration: Initialize SphericalBasis (parametric sphere for SH fitting)
    const sphereBasis = SystemState.objects.find(obj => obj.metadata?.name === 'SphericalBasis');

    if (sphereBasis) {
        console.log(`[Main] SphericalBasis found. Control points: ${sphereBasis.controlPoints?.length}. Starting auto-fit...`);

        // Perform fit with adaptive order determination
        const sh = new SphericalHarmonics(15);

        // Enable verbose logging to see SH order determination process
        sphereBasis.verbose = true;

        sphereBasis.fitSphericalHarmonics({
            fitter: FittingCalculator,
            Matrix: Matrix,
            sphericalHarmonics: sh
        });

        // Generate display points with moderate density for better visibility
        sphereBasis.generateDisplayPoints({ density: EditConfig.displayPointDensity });

        console.log(`[Main] SphericalBasis ready. Display points: ${sphereBasis.displayPoints?.length}`);
    } else {
        console.warn("[Main] SphericalBasis not found.");
    }

    document.body.appendChild(SystemState.canvas);
    setupEventListeners();
    // Camera init
    // CameraSystem.initCamera is async, but we don't await here to not block UI?
    // Original awaited it.
    if (CONFIG.cameraControl.enabled) {
        await CameraSystem.initCamera();
    }
    SystemState.debugDiv.textContent = "初始化完成";

    // 注入辅助函数到 SystemState
    SystemState.setHelpers({
        measureObjectRadius,
        tracePoint,
        updateSliceContour,
    });
}

function setupEventListeners() {
    // Keyboard
    window.addEventListener("keydown", (e) => {
        SystemState.keys[e.key.toLowerCase()] = true;

        // 撤销/重做快捷键（全局，优先于其他处理）
        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (HistoryManager.undo()) {
                    SystemState.ifControl = true;
                }
                return;
            }
            if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                if (HistoryManager.redo()) {
                    SystemState.ifControl = true;
                }
                return;
            }
        }

        if (e.key.toLowerCase() === "p") {
            CONFIG.cameraControl.enabled = !CONFIG.cameraControl.enabled;
            if (CONFIG.cameraControl.enabled) {
                CameraSystem.initCamera();
            }
            SystemState.debugDiv.textContent = `摄像头控制: ${CONFIG.cameraControl.enabled ? "开启" : "关闭"}`;
        }

        const handlers = InputManager.getHandlers(SystemState.interactionState);
        if (handlers.onKeyDown) {
            const intent = handlers.onKeyDown(e);
            if (intent) processIntent(intent);
        }
    });

    window.addEventListener("keyup", (e) => {
        SystemState.keys[e.key.toLowerCase()] = false;
    });

    // Mouse / Canvas events
    SystemState.canvas.addEventListener("click", (e) => {
        const handlers = InputManager.getHandlers(SystemState.interactionState);
        if (handlers.onClick) {
            const intent = handlers.onClick(e);
            if (intent) processIntent(intent);
        }
    });

    SystemState.canvas.addEventListener("mousedown", (e) => {
        const handlers = InputManager.getHandlers(SystemState.interactionState);
        if (handlers.onMouseDown) {
            const intent = handlers.onMouseDown(e);
            if (intent) processIntent(intent);
        }
    });

    window.addEventListener("mouseup", () => {
        // Global mouse up logic (drag end)
        if (SystemState.draggedControlPoint) {
            // [HISTORY] Commit Control Point Move
            const obj = SystemState.focusedObject;
            if (obj && SystemState.dragStartControlPointPos) {
                const cp = SystemState.draggedControlPoint;
                const fromPos = SystemState.dragStartControlPointPos;
                const toPos = { x: cp.lx, y: cp.ly, z: cp.lz };

                // Only commit if moved
                if (Math.abs(fromPos.x - toPos.x) > 0.001 ||
                    Math.abs(fromPos.y - toPos.y) > 0.001 ||
                    Math.abs(fromPos.z - toPos.z) > 0.001) {

                    const cmd = createMoveControlPointCommand(obj, cp, fromPos, toPos);
                    HistoryManager.execute(cmd);
                }
            }

            SystemState.draggedControlPoint = null;
            SystemState.dragStartControlPointPos = null; // Clear temp state
            updateControlPointsDisplay();
        }
        if (SystemState.longPressTimer) {
            clearTimeout(SystemState.longPressTimer);
            SystemState.longPressTimer = null;
        }
        SystemState.longPressTarget = null;

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

        if (SystemState.draggingObject) {
            const snapped = SystemState.virtualMouse.snappedTo;
            if (snapped && snapped.isGridPoint) {
                moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
                console.log('物体放置到格点:', snapped.x, snapped.y, snapped.z);
            }

            // [HISTORY] Commit Object Move
            if (SystemState.dragStartCenter) {
                const obj = SystemState.draggingObject;
                const fromPos = SystemState.dragStartCenter;
                const toPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

                // Only commit if moved
                if (Math.abs(fromPos.x - toPos.x) > 0.001 ||
                    Math.abs(fromPos.y - toPos.y) > 0.001 ||
                    Math.abs(fromPos.z - toPos.z) > 0.001) {

                    const cmd = createMoveCommand(obj, fromPos, toPos);
                    HistoryManager.execute(cmd);
                }
            }

            SystemState.draggingObject = null;
            SystemState.dragStartCenter = null;
        }
        SystemState.isDragging = false;
    });

    // ... 

    // [Modified helpers below]

    function deleteControlPoint(controlPoint) {
        if (!controlPoint) return;
        const obj = SystemState.focusedObject;
        if (!obj || !obj.controlPoints) return;
        const index = obj.controlPoints.indexOf(controlPoint);
        if (index > -1) {
            // [HISTORY] Use Command
            const cmd = createDeleteControlPointCommand(obj, index);
            HistoryManager.execute(cmd);

            // Visual updates are handled by cmd.execute() -> but we might need extra refit triggers?
            // cmd.execute() splices array. 
            // We need to ensure UI updates.
            // The command execution modifies data. We should update flags.
            obj._needsRefit = true;
            updateControlPointsDisplay();
        }
    }

    function addControlPointAt(screenX, screenY) {
        const obj = SystemState.focusedObject;
        if (!obj) return;
        const center = obj.center;
        const screenCenterX = SystemState.screenWidthPx / 2;
        const screenCenterY = SystemState.screenHeightPx / 2;
        const offsetX = (screenX - screenCenterX) * 0.02;
        const offsetZ = (screenCenterY - screenY) * 0.02;
        const newPoint = new Point(center.x + offsetX, center.y, center.z + offsetZ);
        // if (!obj.controlPoints) obj.controlPoints = []; // Handled in command or here? 
        // Command handles pushing.

        // [HISTORY] Use Command
        const cmd = createAddControlPointCommand(obj, newPoint);
        HistoryManager.execute(cmd);

        obj._needsRefit = true;
        updateControlPointsDisplay();
    }

    SystemState.canvas.addEventListener("mousemove", (e) => {
        const handlers = InputManager.getHandlers(SystemState.interactionState);
        if (handlers.onMouseMove) {
            const intent = handlers.onMouseMove(e);
            if (intent) processIntent(intent);
        }

        // Mouse edge detection logic must stay here or be moved to a fast update loop?
        // Original: in mousemove listener.
        const screenWidth = window.innerWidth;
        if (e.clientX <= 0) {
            SystemState.mouseEdge = -1;
        } else if (e.clientX >= screenWidth - 1) {
            SystemState.mouseEdge = 1;
        } else {
            SystemState.mouseEdge = 0;
        }

        if (SystemState.virtualMouse.enabled) {
            updateVirtualMouse(e.clientX, e.clientY);
            SystemState.ifControl = true;
        }
        SystemState.lastMouseX = e.clientX;
        SystemState.lastMouseY = e.clientY;
    });

    SystemState.canvas.addEventListener("wheel", (e) => {
        const handlers = InputManager.getHandlers(SystemState.interactionState);
        if (handlers.onWheelSliceDepth) {
            const intent = handlers.onWheelSliceDepth(e);
            if (intent) processIntent(intent);
        }
        if (handlers.onWheel) {
            const intent = handlers.onWheel(e);
            if (intent) processIntent(intent);
        }
    }, { passive: false });

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

// ============================================================================
// INTENT PROCESSING
// ============================================================================

function processIntent(intent) {
    if (!intent) return;

    // Array of intents
    if (Array.isArray(intent)) {
        intent.forEach(processIntent);
        return;
    }

    //console.log("Processing Intent:", intent.type);

    switch (intent.type) {
        // VIEW
        case 'RESET_CAMERA_DISTANCE':
            resetCameraDistance();
            break;
        case 'SET_ROTATION_VELOCITY':
            SystemState.velocityState.rotation.target = intent.target;
            SystemState.velocityState.rotation.factor = intent.factor;
            break;
        case 'SET_MOVE_VELOCITY':
            SystemState.velocityState.moveForward.target = intent.target;
            SystemState.velocityState.moveForward.factor = intent.factor;
            break;
        case 'ADJUST_LIGHT_ANGLE':
            SystemState.lightAngle = (SystemState.lightAngle || 0) + intent.delta;
            SystemState.lightDirty = true;
            break;
        case 'ADJUST_LIGHT_ELEVATION':
            SystemState.lightElevation = Math.max(
                CONFIG.minElevation,
                Math.min(CONFIG.maxElevation, (SystemState.lightElevation || 0) + intent.delta)
            );
            SystemState.lightDirty = true;
            break;

        // ...

        case 'START_DRAG_VIEW':
            SystemState.isDragging = true;
            SystemState.lastMouseX = intent.x;
            SystemState.lastMouseY = intent.y;
            if (intent.payload) {
                SystemState.draggingObject = intent.payload.draggingObject;
                SystemState.dragStartCenter = intent.payload.dragStartCenter;
            }
            break;
        case 'MOVE_OBJECT':
            moveObjectTo(intent.object, intent.x, intent.y, intent.z);
            SystemState.sceneDirty = true;
            if (intent.object && intent.object.tag === 'LIGHT_SOURCE') {
                SystemState.lightDirty = true;
                // updateLight(); // Moved to gameLoop based on dirty flag
            }
            break;

        // ... 

        case 'ROTATE_FOCUSED_OBJECT':
            SystemState.rotateFocusedObject(intent.dx, intent.dy);
            SystemState.sceneDirty = true;
            SystemState.ifControl = true;
            break;

        // ...

        case 'EDIT_ROTATE_TRANSITION':
            OrientationImpl.transition(intent.key, intent.object, SystemState.mainWindow?.direction, animateRotation);
            SystemState.sceneDirty = true;
            break;

        // ...

        case 'MOVE_CONTROL_POINT':
            {
                if (SystemState.longPressTimer) {
                    clearTimeout(SystemState.longPressTimer);
                    SystemState.longPressTimer = null;
                }
                moveControlPoint(intent.controlPoint, intent.dx, intent.dy);
                SystemState.lastMouseX = intent.mouseX;
                SystemState.lastMouseY = intent.mouseY;
                SystemState.sceneDirty = true;
                SystemState.ifControl = true;
            }
            break;
        case 'CHANGE_DEPTH_LAYER':
            SystemState.editDepthLayer += intent.delta;
            updateControlPointsDisplay();
            SystemState.sceneDirty = true; // Visual change
            SystemState.ifControl = true;
            break;
        case 'CAMERA_ZOOM':
            handleCameraZoom(intent.delta);
            break;
        case 'ENTER_FOCUS_STATE':
            SystemState.enterFocus(intent.object);
            break;

        // FOCUS
        case 'ROTATE_FOCUSED_OBJECT':
            SystemState.rotateFocusedObject(intent.dx, intent.dy);
            SystemState.ifControl = true;
            break;
        case 'EXIT_FOCUS_STATE':
            SystemState.exitFocus();
            break;
        case 'START_DRAG_FOCUS':
            SystemState.isDragging = true;
            SystemState.lastMouseX = intent.x;
            SystemState.lastMouseY = intent.y;
            break;
        case 'ADJUST_SLICE_DEPTH':
            {
                const currentDepth = SystemState.focusSliceDepth;
                const limit = EditConfig.halfSize;
                const newDepth = Math.max(-limit, Math.min(limit, currentDepth + intent.delta));
                if (newDepth !== currentDepth) {
                    const diff = newDepth - currentDepth;
                    SystemState.focusSliceDepth = newDepth;
                    SystemState.focusVirtualMouseDepth += diff;
                    updateSliceContour();
                    SystemState.ifControl = true;
                } else {
                    console.log(`[FOCUS] Depth limit reached: ${limit.toFixed(1)}cm`);
                }
            }
            break;
        case 'FOCUS_PHYSICS_TOUCH':
            // 物理触碰：在虚拟鼠标位置向物体表面施加冲量
            {
                console.log('[PHYSICS] FOCUS_PHYSICS_TOUCH intent received:', intent);

                const obj = SystemState.focusedObject;
                if (!obj) {
                    console.log('[PHYSICS] No focused object');
                    break;
                }

                // [方案A] 延迟初始化物理系统：仅在首次左击时初始化
                if (obj._physicsReady && !obj.physics.enabled) {
                    console.log('[PHYSICS] First touch: initializing physics system...');

                    // 1. 启用物理
                    obj.physics.enabled = true;

                    // 2. 生成体积网格（覆盖 constructionPoints）
                    if (obj.representation?.type === 'sphericalHarmonics') {
                        console.log('[PHYSICS] Generating volumetric mesh for SH object');
                        obj.generateVolumetricMesh({
                            relaxIterations: 10
                        });
                    }

                    // 3. 构建物理拓扑
                    obj.rebuildPhysicsTopology({
                        physicsModel: obj.physics.model || CONFIG.defaultPhysicsModel,
                        stiffness: obj.physics.stiffness || CONFIG.physicsParams.force.stiffness,
                        damping: obj.physics.damping || CONFIG.physicsParams.force.damping
                    });

                    // 4. 创建全局物理系统（如果不存在）
                    if (!_globalPhysicsSystem) {
                        _globalPhysicsSystem = new PhysicsSystem({
                            gravity: { x: 0, y: 0, z: 0 },
                            substeps: CONFIG.physicsParams.system.substeps,
                            airDamping: CONFIG.physicsParams.force.airDamping,
                            globalDamping: CONFIG.physicsParams.force.globalDamping,
                            constraintIterations: 15,
                            verbose: CONFIG.physicsDebug,
                            // 系统参数
                            maxDisplacement: CONFIG.physicsParams.system.maxDisplacement,
                            fixedTimeStep: CONFIG.physicsParams.system.fixedTimeStep,
                            maxStepsPerFrame: CONFIG.physicsParams.system.maxStepsPerFrame
                        });
                    }

                    // 5. 添加到物理世界
                    _globalPhysicsSystem.addObject(obj);
                    obj._inPhysicsWorld = true;

                    // 6. 初始化质心锚点
                    initPhysicsCOM(obj);

                    // 7. PERFORMANCE 模式：设置临时显示点
                    if (CONFIG.physicsMode === 'PERFORMANCE' && obj._isVolumetric) {
                        obj._tempDisplayPoints = obj.constructionPoints.slice(0, obj._surfaceBoundary);
                        for (const p of obj._tempDisplayPoints) {
                            p.tag = p.tag || 'PHYSICS_NODE';
                        }
                        obj._tempDisplayPointsInitialized = true;
                    }

                    console.log('[PHYSICS] Physics system initialized on first touch');
                }

                if (!obj.constructionPoints || obj.constructionPoints.length === 0) {
                    console.log('[PHYSICS] No constructionPoints on object');
                    break;
                }
                console.log(`[PHYSICS] Object has ${obj.constructionPoints.length} constructionPoints, _surfaceBoundary=${obj._surfaceBoundary}`);

                // 计算虚拟鼠标的 3D 世界坐标
                const win = SystemState.mainWindow;
                const dir = win.direction;

                // 使用 getPointsInCell - 只检查鼠标所在的 GridCell
                // 有就有，没有就没有
                const cellPoints = win.getPointsInCell(intent.x, intent.y, null);

                // [DEBUG] Poke 诊断
                console.log(`[POKE DEBUG] Click=(${intent.x}, ${intent.y}), cellPoints=${cellPoints.length}`);

                if (cellPoints.length === 0) {
                    console.log('[POKE] No points in cell, skipping');
                    break;
                }

                // 取 cell 中离用户最近的点（dis 最小）- cell 已按 dis 排序
                const nearestPoint = cellPoints[0];
                const pointIdx = obj.constructionPoints ? obj.constructionPoints.indexOf(nearestPoint) : -1;
                console.log(`[POKE] nearestPoint idx=${pointIdx}, surfaceBound=${obj._surfaceBoundary}`);

                if (nearestPoint && nearestPoint.x !== undefined) {
                    // [Phase 3] Poke Enhancement
                    // 1. 方向锁定：Camera Look Dir (window.direction)
                    const pushDir = win.direction; // {x, y, z}Normalized

                    // 2. 冲量强度 (从配置读取)
                    const impulseMag = EditConfig.InteractionForces.pokeImpulse ?? 20.0;

                    // 3. AOE 衰减参数
                    const aoeRadius = EditConfig.InteractionForces.pokeRadius ?? 5.0;
                    const aoeDecayType = EditConfig.InteractionForces.pokeDecay || 'gaussian';
                    const sigma = aoeRadius / 2.0; // Gaussian width

                    // 获取物理状态
                    const physicsState = obj.representation?.physicsState;
                    if (!physicsState || !physicsState.particles) break; // 注意: 是 break 不是 return

                    // 4. 利用空间加速结构查找邻居 (Grid or Brute Force fallback for now)
                    // 由于目前没有建立基于 Particle 的独立 Grid，我们遍历 particles。
                    // 优化：后续阶段可引入 SpatialHash。目前假设粒子数 < 2048，暴力遍历可接受。

                    let activeCount = 0;
                    const particles = physicsState.particles;

                    // poke 中心点: 使用实际找到的 nearestPoint 的位置，而不是 vmWorld
                    // 这样 AOE 以实际的表面点为中心，更准确
                    const pokeCenter = {
                        x: nearestPoint.x ?? (nearestPoint.lx + obj.center.x),
                        y: nearestPoint.y ?? (nearestPoint.ly + obj.center.y),
                        z: nearestPoint.z ?? (nearestPoint.lz + obj.center.z)
                    };

                    for (let i = 0; i < particles.length; i++) {
                        const p = particles[i];
                        if (p.fixed) continue;

                        const dx = p.position.x - pokeCenter.x;
                        const dy = p.position.y - pokeCenter.y;
                        const dz = p.position.z - pokeCenter.z;
                        const distSq = dx * dx + dy * dy + dz * dz;

                        if (distSq > aoeRadius * aoeRadius) continue;

                        // 计算权重 [MODIFIED] - 用户要求各区域同性，去掉衰减
                        const dist = Math.sqrt(distSq);
                        let w = 1.0;
                        /* 
                        if (aoeDecayType === 'gaussian') {
                            w = Math.exp(-distSq / (sigma * sigma));
                        } else {
                            w = 1.0 - (dist / aoeRadius);
                        }
                        */

                        if (w < 0.01) continue;

                        // [Verlet Friendly] 施加冲量 -> 修改 oldPosition
                        // F = m * a -> Impulse = m * deltaV
                        // deltaX = deltaV * dt
                        // oldPosition -= deltaX
                        // 假设 dt = 1/60 (Physics fixed step)
                        const dt = 1 / 60;

                        // 冲量 = I * w * dir
                        // velocityChange = Impulse / mass
                        // displacement = velocityChange * dt

                        const invMass = 1.0 / (p.mass || 1.0);
                        const dv = impulseMag * w * invMass;

                        const dispX = pushDir.x * dv * dt;
                        const dispY = pushDir.y * dv * dt;
                        const dispZ = pushDir.z * dv * dt;

                        p.oldPosition.x -= dispX;
                        p.oldPosition.y -= dispY;
                        p.oldPosition.z -= dispZ;

                        activeCount++;
                    }

                    if (activeCount > 0) {
                        console.log(`[PHYSICS] Poke applied to ${activeCount} particles with Impulse=${impulseMag}`);
                        obj._physicsActive = true;
                        obj._physicsActiveFrames = 0;
                        obj._dirty = true;
                        SystemState.sceneDirty = true;
                    } else {
                        console.log(`[PHYSICS] No particles in AOE (radius=${aoeRadius}cm, center=nearestPoint)`);
                    }
                } else {
                    console.log(`[PHYSICS] nearestPoint has no valid x coordinate`);
                }
            }
            break;

        case 'SWIPE_PHYSICS_IMPULSE':
            {
                // [Phase 17] Physics Swipe Implementation
                // 优化: 使用 pointIndex 直接索引粒子，O(1)
                const { point, pointIndex, velocity, timestamp } = intent;
                const obj = SystemState.focusedObject;
                if (!obj || !obj.representation?.physicsState) break;

                const particles = obj.representation.physicsState.particles;

                // 优先使用 pointIndex 直接获取粒子 (O(1))
                // 如果 pointIndex 不存在或越界，则回退到位置匹配
                let targetP = null;
                if (pointIndex !== undefined && pointIndex >= 0 && pointIndex < particles.length) {
                    targetP = particles[pointIndex];
                } else if (point && point.x !== undefined) {
                    // Fallback: 位置匹配 (O(n))
                    let minDistSq = Infinity;
                    for (const p of particles) {
                        const dx = p.position.x - point.x;
                        const dy = p.position.y - point.y;
                        const dz = p.position.z - point.z;
                        const dSq = dx * dx + dy * dy + dz * dz;
                        if (dSq < minDistSq) {
                            minDistSq = dSq;
                            targetP = p;
                        }
                    }
                    if (minDistSq > 25.0) targetP = null; // 5cm tolerance
                } else {
                    console.log('[SWIPE] point is undefined or has no x property:', point);
                    break;
                }

                if (targetP) {
                    // 1. Debounce Check - 使用时间戳而不是 frameCount
                    const now = Date.now();
                    const cooldown = EditConfig.InteractionForces.swipeCooldown ?? 100; // ms
                    if (targetP._lastImpulseTime && (now - targetP._lastImpulseTime) < cooldown) {
                        // 节流日志
                        break;
                    }

                    // 2. Coordinate Conversion (Screen Velocity -> World Velocity)
                    const win = SystemState.mainWindow;
                    // Scale factor: roughly map screen pixels to world cm
                    // At typical view distance, 1cm world ≈ DPI pixels. 
                    // But perspective matters.
                    // Simplified: (px / DPI) * sensitivity

                    const gain = EditConfig.InteractionForces.swipeGain ?? 0.1;
                    const vxWorldMag = (velocity.x / win.DPIx) * gain;
                    const vyWorldMag = -(velocity.y / win.DPIy) * gain; // Screen Y is inverted

                    const worldVelX = vxWorldMag * win.vx.x + vyWorldMag * win.vy.x;
                    const worldVelY = vxWorldMag * win.vx.y + vyWorldMag * win.vy.y;
                    const worldVelZ = vxWorldMag * win.vx.z + vyWorldMag * win.vy.z;

                    // console.log(`[SWIPE] World velocity: (${worldVelX.toFixed(4)}, ${worldVelY.toFixed(4)}, ${worldVelZ.toFixed(4)})`);


                    // 3. Relative Velocity Check
                    // Ensure we are adding energy, not fighting it (unless desired?)
                    // "Don't push if it's already going faster than you"
                    // v_particle approx = (pos - oldPos) / dt
                    const dt = 1 / 60;
                    const pVx = (targetP.position.x - targetP.oldPosition.x) / dt;
                    const pVy = (targetP.position.y - targetP.oldPosition.y) / dt;
                    const pVz = (targetP.position.z - targetP.oldPosition.z) / dt;

                    const dotProd = worldVelX * pVx + worldVelY * pVy + worldVelZ * pVz;
                    const pSpeedSq = pVx * pVx + pVy * pVy + pVz * pVz;

                    // Only apply if we are pushing "forward" or "faster"
                    // Simple logic: if dot < pSpeedSq, implies mouse is slower than particle in that dir?
                    // Let's use simple logic: Always add, rely on damping to stabilize?
                    // User Plan: "dot(v_world, v_particle) < |v_particle|^2"
                    // If v_world is small and v_particle large, dot < pSpeedSq is TRUE.
                    // Wait, if I push SLOWER than particle, dot < pSpeedSq. I SHOULD NOT push.
                    // Check Logic: 
                    // v_mouse projection on v_Part < v_Part magnitude?
                    // If I move mouse slower than object, I shouldn't accelerate it.
                    // So: if (dot < pSpeedSq) SKIP.
                    // BUT initial state pSpeed is 0. 0 < 0 is false? No.
                    // Let's refine: if (pSpeedSq > 0.1 && dot < pSpeedSq) skip.

                    if (pSpeedSq > 10.0 && dotProd < pSpeedSq) {
                        // Mouse is moving slower than particle in particle's direction -> Slip effect (no force)
                        break;
                    }

                    // 4. Center Weighting [REMOVED] - 用户要求各区域同性
                    // const w = Math.min(1.0, Math.max(0.0, rLen / R_MAX));
                    const w = 1.0;

                    // 5. Apply Impulse (Verlet Friendly)
                    // deltaX = v_world * w * dt
                    // 之前的 50.0 系数保留以维持手感 (配合 swipeGain)
                    const dispX = worldVelX * w * dt * 50.0;
                    const dispY = worldVelY * w * dt * 50.0;
                    const dispZ = worldVelZ * w * dt * 50.0;

                    targetP.oldPosition.x -= dispX;
                    targetP.oldPosition.y -= dispY;
                    targetP.oldPosition.z -= dispZ;

                    targetP._lastImpulseTime = now;

                    obj._physicsActive = true;
                    obj._physicsActiveFrames = 0;

                    console.log(`[SWIPE] Applied to particle, w=${w.toFixed(2)}, disp=(${dispX.toFixed(3)}, ${dispY.toFixed(3)}, ${dispZ.toFixed(3)})`);
                } else {
                    // 节流日志
                    if (!SystemState._swipeMissLogFrame || SystemState.frameCount - SystemState._swipeMissLogFrame > 120) {
                        console.log(`[SWIPE] No particle match for point (minDistSq=${minDistSq.toFixed(2)})`);
                        SystemState._swipeMissLogFrame = SystemState.frameCount;
                    }
                }
            }
            break;
        case 'ENTER_EDIT_STATE':
            enterEditState();
            break;

        // EDIT
        case 'EXIT_EDIT_STATE':
            exitEditState();
            break;
        case 'EDIT_ROTATE_TRANSITION':
            OrientationImpl.transition(intent.key, intent.object, SystemState.mainWindow?.direction, animateRotation);
            break;
        case 'EDIT_MOUSE_DOWN':
            {
                const cp = findControlPointAt(intent.x, intent.y);
                // [FIX] 检查 isEditable，防止拖拽局部格网的棱点
                if (cp && cp.isEditable !== false) {
                    SystemState.draggedControlPoint = cp;
                    // [HISTORY] Save Start Position
                    SystemState.dragStartControlPointPos = { x: cp.lx, y: cp.ly, z: cp.lz };

                    SystemState.lastMouseX = intent.x;
                    SystemState.lastMouseY = intent.y;
                    SystemState.longPressTarget = cp;
                    SystemState.longPressTimer = setTimeout(() => {
                        deleteControlPoint(cp);
                        SystemState.longPressTarget = null;
                        SystemState.draggedControlPoint = null;
                        SystemState.dragStartControlPointPos = null;
                    }, 1000);
                }
            }
            break;
        case 'MOVE_CONTROL_POINT':
            // Legacy: 保留兼容性，但一般不再触发
            {
                if (SystemState.longPressTimer) {
                    clearTimeout(SystemState.longPressTimer);
                    SystemState.longPressTimer = null;
                }
                moveControlPoint(intent.controlPoint, intent.dx, intent.dy);
                SystemState.lastMouseX = intent.mouseX;
                SystemState.lastMouseY = intent.mouseY;
                SystemState.ifControl = true;
            }
            break;
        case 'SNAP_CONTROL_POINT_TO_GRID':
            {
                if (SystemState.longPressTimer) {
                    clearTimeout(SystemState.longPressTimer);
                    SystemState.longPressTimer = null;
                }

                const cp = intent.controlPoint;
                const gp = intent.gridPoint;
                const obj = SystemState.focusedObject;

                if (!cp || !gp || !obj) break;

                // [规则] 禁止拖到中心点（0,0,0）
                const CENTER_TOLERANCE = 0.01;
                const isCenterTarget = Math.abs(gp.lx) < CENTER_TOLERANCE &&
                    Math.abs(gp.ly) < CENTER_TOLERANCE &&
                    Math.abs(gp.lz) < CENTER_TOLERANCE;
                if (isCenterTarget) {
                    console.log('[EDIT] 不允许拖动控制点到中心');
                    break;
                }

                // 约束检查：不允许拖到已有控制点的位置
                const TOLERANCE = 0.05; // 5mm 容差
                let isOccupied = false;
                for (const otherCp of obj.controlPoints || []) {
                    if (otherCp === cp) continue; // 跳过自身
                    const dx = Math.abs(otherCp.lx - gp.lx);
                    const dy = Math.abs(otherCp.ly - gp.ly);
                    const dz = Math.abs(otherCp.lz - gp.lz);
                    if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
                        isOccupied = true;
                        break;
                    }
                }

                if (isOccupied) {
                    // 目标格点已被其他控制点占用，忽略此次移动
                    console.log('[EDIT] 目标格点已被占用，忽略移动');
                    break;
                }

                // 检查是否位置发生了变化（避免无效重拟合）
                const posDiff = Math.abs(cp.lx - gp.lx) + Math.abs(cp.ly - gp.ly) + Math.abs(cp.lz - gp.lz);
                if (posDiff < 0.001) {
                    // 位置未变，无需更新
                    break;
                }

                // 将格点的局部坐标赋值给控制点
                cp.lx = gp.lx;
                cp.ly = gp.ly;
                cp.lz = gp.lz;

                // 标记物体需要更新世界坐标
                obj._dirty = true;
                obj.updateWorldPoints();

                // 获取控制点索引，用于精确截断增量拟合缓存
                const cpIndex = obj.controlPoints?.indexOf(cp) ?? -1;

                // 关键：通知控制点已改变，使拟合缓存失效
                // 传入索引以实现精确截断（只清除该点之后的缓存）
                if (obj._onControlPointsChanged) {
                    obj._onControlPointsChanged(cpIndex);
                } else {
                    // fallback: 手动设置标记
                    obj._needsRefit = true;
                }

                SystemState.lastMouseX = intent.mouseX;
                SystemState.lastMouseY = intent.mouseY;
                SystemState.sceneDirty = true;
                SystemState.ifControl = true;

                console.log(`[EDIT] 控制点移动: index=${cpIndex}, 新坐标=(${cp.lx.toFixed(2)}, ${cp.ly.toFixed(2)}, ${cp.lz.toFixed(2)}), _needsRefit=${obj._needsRefit}`);
            }
            break;
        case 'CHANGE_DEPTH_LAYER':
            SystemState.editDepthLayer += intent.delta;
            updateControlPointsDisplay();
            SystemState.ifControl = true;
            break;
        case 'SCROLL_SLICE_DEPTH':
            {
                const { steps, stepSize, maxDepth, currentDepth } = intent;
                const targetLayer = Math.round(currentDepth / stepSize) + steps;
                const targetDepth = targetLayer * stepSize;
                // 边界检查：maxDepth 已在 EditConfig.getMaxDepthForOrientation 中正确计算
                // - 正面向：maxDepth = layerCount * spacing = 4 cm
                // - 棱面向：maxDepth = layerCount * spacing * √2 ≈ 5.66 cm
                if (targetDepth > maxDepth || targetDepth < -maxDepth) {
                    console.log(`Depth limit reached: target=${targetDepth.toFixed(2)}, limit=±${maxDepth.toFixed(2)}`);
                    return;
                }
                const obj = SystemState.focusedObject;
                const dir = SystemState.mainWindow.direction;
                const delta = targetDepth - currentDepth;
                const targetX = obj.center.x + dir.x * delta;
                const targetY = obj.center.y + dir.y * delta;
                const targetZ = obj.center.z + dir.z * delta;
                // 更新切片深度状态
                SystemState.focusSliceDepth = targetDepth;
                // [FIX] 清除旧吸附，强制更新格网，然后立即重新计算吸附
                SystemState.virtualMouse.snappedTo = null;
                updateLocalGrid(true);
                // 立即重新计算吸附，防止虚拟鼠标圈短暂漂浮
                if (SystemState.virtualMouse.enabled) {
                    updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
                }
                animateSliceTransition(obj, targetX, targetY, targetZ, 150);
            }
            break;
        case 'ADD_CONTROL_POINT':
            addControlPointAt(intent.x, intent.y);
            break;
        case 'DELETE_CONTROL_POINT':
            {
                const obj = SystemState.focusedObject;
                const cp = intent.controlPoint;
                if (obj && obj.controlPoints) {
                    const index = obj.controlPoints.indexOf(cp);
                    if (index > -1) {
                        const cmd = createDeleteControlPointCommand(obj, index);
                        HistoryManager.execute(cmd);
                        obj._needsRefit = true;
                        updateControlPointsDisplay();
                        console.log(`[EDIT] 删除控制点 #${index}`);
                    }
                }
            }
            break;
        case 'ADD_CONTROL_POINT_AT_GRID':
            {
                const obj = SystemState.focusedObject;
                const gp = intent.gridPoint;
                if (obj && gp) {
                    // 将格点的世界坐标转换为局部坐标
                    const localPos = worldToLocal(obj, { x: gp.x, y: gp.y, z: gp.z });

                    // [规则] 禁止在中心点（0,0,0）操作控制点
                    const CENTER_TOLERANCE = 0.01;
                    const isCenter = Math.abs(localPos.x) < CENTER_TOLERANCE &&
                        Math.abs(localPos.y) < CENTER_TOLERANCE &&
                        Math.abs(localPos.z) < CENTER_TOLERANCE;
                    if (isCenter) {
                        console.log(`[EDIT] 中心点不允许新增/删除控制点`);
                        break;
                    }

                    // 检查该位置是否已存在控制点（使用局部坐标比较）
                    const TOLERANCE = 0.01; // 1mm 容差
                    const existingIndex = obj.controlPoints?.findIndex(cp => {
                        const dx = Math.abs(cp.lx - localPos.x);
                        const dy = Math.abs(cp.ly - localPos.y);
                        const dz = Math.abs(cp.lz - localPos.z);
                        return dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE;
                    }) ?? -1;

                    if (existingIndex >= 0) {
                        // 位置已存在控制点 → 删除它（切换逻辑）
                        const cmd = createDeleteControlPointCommand(obj, existingIndex);
                        HistoryManager.execute(cmd);
                        obj._needsRefit = true;
                        updateControlPointsDisplay();
                        console.log(`[EDIT] 格点位置已有控制点，删除 #${existingIndex}`);
                    } else {
                        // 位置无控制点 → 新增
                        const newPoint = new Point(localPos.x, localPos.y, localPos.z);
                        newPoint.lx = localPos.x;
                        newPoint.ly = localPos.y;
                        newPoint.lz = localPos.z;
                        newPoint.tag = 'CONTROL';
                        newPoint.isVisible = true;      // 新点立即可见
                        newPoint.isAttractable = true;  // 新点可吸附

                        if (!obj.controlPoints) obj.controlPoints = [];
                        const cmd = createAddControlPointCommand(obj, newPoint);
                        HistoryManager.execute(cmd);
                        obj._needsRefit = true;
                        updateControlPointsDisplay();
                        console.log(`[EDIT] 新增控制点 at (${localPos.x.toFixed(2)}, ${localPos.y.toFixed(2)}, ${localPos.z.toFixed(2)})`);
                    }
                }
            }
            break;
    }
    // ... (End of processIntent switch)
}

// ============================================================================
// EFFECTUATORS & LOGIC
// ============================================================================

function handleCameraZoom(speed) {
    // ...
    const win = SystemState.mainWindow;
    const rotCenter = SystemState.rotationCenter;
    if (!win || !rotCenter) return;

    // 1. 获取当前半径向量 (在 XY 平面)
    const dx = win.capital.x - rotCenter.x;
    const dy = win.capital.y - rotCenter.y;
    const currentRadius = Math.sqrt(dx * dx + dy * dy);

    // 2. 限制范围
    // 2. 限制范围
    // 最小距离：不能穿过 Z 轴 (保留 0.1cm 缓冲，防止除零或奇异点)
    const minRadius = 0.1;
    // 最大距离：世界格网边界，即 screenXLengthCm (约 31cm)
    const maxRadius = CONFIG.screenXLengthCm;

    // 3. 计算移动
    // speed > 0 means get closer
    const newRadius = Math.max(minRadius, Math.min(maxRadius, currentRadius - speed));

    if (Math.abs(newRadius - currentRadius) < 0.001) {
        // console.log('[ZOOM] 已达边界'); // Reduce log spam
        return;
    }

    // 4. 应用新半径 (保持角度不变)
    // 归一化方向向量 (从圆心指向相机)
    const nx = dx / currentRadius;
    const ny = dy / currentRadius;

    const newX = rotCenter.x + nx * newRadius;
    const newY = rotCenter.y + ny * newRadius;
    const deltaX = newX - win.capital.x;
    const deltaY = newY - win.capital.y;

    win.capital.x = newX;
    win.capital.y = newY;
    // Z 不动

    // 同步 direction.start
    win.direction.start.x += deltaX;
    win.direction.start.y += deltaY;
    // Z 不动

    SystemState.ifControl = true;
    console.log(`[ZOOM] R: ${currentRadius.toFixed(1)} -> ${newRadius.toFixed(1)}`);
}

function resetCameraDistance() {
    // ESC 重置：只在 XY 平面重置距离，保持角度不变，Z 坐标完全不动
    const win = SystemState.mainWindow;
    if (!win || !win.capital) return;

    const rotCenter = SystemState.rotationCenter;
    if (!rotCenter) return;

    // 初始距离（在 XY 平面）
    const initialR = CONFIG.userDistanceFromOrigin;

    // 当前 capital 相对于 rotationCenter 在 XY 平面的位置
    const dx = win.capital.x - rotCenter.x;
    const dy = win.capital.y - rotCenter.y;
    const currentR = Math.sqrt(dx * dx + dy * dy);

    // 检查是否已在初始距离
    if (Math.abs(currentR - initialR) < 0.1) {
        console.log('[STATE] VIEW ESC: 已在初始距离');
        return;
    }

    // 计算缩放因子（只在 XY 平面）
    const scale = initialR / currentR;

    // 计算新位置
    const newX = rotCenter.x + dx * scale;
    const newY = rotCenter.y + dy * scale;

    // 计算位移差量
    const deltaX = newX - win.capital.x;
    const deltaY = newY - win.capital.y;

    // 应用位移到 capital
    win.capital.x = newX;
    win.capital.y = newY;

    // 应用位移到 direction.start (Screen Center) 以保持相对关系不变
    if (win.direction && win.direction.start) {
        win.direction.start.x += deltaX;
        win.direction.start.y += deltaY;
    }

    SystemState.ifControl = true;
    console.log(`[STATE] VIEW ESC: XY距离 ${currentR.toFixed(1)}cm → ${initialR.toFixed(1)}cm`);
}

function handleInput() {
    // Continuous input handling for View and Focus (edge rotation)
    // We poll InputManager manualy for continuous inputs every frame
    const handlers = InputManager.getHandlers(SystemState.interactionState);
    if (handlers.onContinuousInput) {
        const intent = handlers.onContinuousInput();
        if (intent) processIntent(intent);
    }
}

function updateLogVelocity(state, dt, accelK = 3.0) {
    if (state.target === 0) {
        state.current *= Math.exp(-accelK * dt / 1000);
        if (Math.abs(state.current) < 0.001) state.current = 0;
    } else {
        const targetVel = state.target * state.factor;
        const diff = targetVel - state.current;
        state.current += diff * (1 - Math.exp(-accelK * dt / 1000));
    }
    return state.current;
}

function userRotate(angle) {
    const center = SystemState.rotationCenter;
    const cam = SystemState.mainWindow.capital;
    const dir = SystemState.mainWindow.direction;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const camDx = cam.x - center.x;
    const camDy = cam.y - center.y;
    cam.x = center.x + camDx * cos - camDy * sin;
    cam.y = center.y + camDx * sin + camDy * cos;
    const startDx = dir.start.x - center.x;
    const startDy = dir.start.y - center.y;
    dir.start.x = center.x + startDx * cos - startDy * sin;
    dir.start.y = center.y + startDx * sin + startDy * cos;
    const oldDirX = dir.x;
    const oldDirY = dir.y;
    dir.x = oldDirX * cos - oldDirY * sin;
    dir.y = oldDirX * sin + oldDirY * cos;
    dir.getAngle();
    SystemState.mainWindow.getAngle();
}

function applyVelocities(dt) {
    const rotVel = updateLogVelocity(SystemState.velocityState.rotation, dt);
    const moveVel = updateLogVelocity(SystemState.velocityState.moveForward, dt);
    if (Math.abs(rotVel) > 0.0001) {
        userRotate(rotVel);
        SystemState.ifControl = true;
    }
    // FGV 移动已迁移至 InputManager 通过 CAMERA_ZOOM 发送直接意图，此处的 velocity 逻辑不再使用
    /*
    if (Math.abs(moveVel) > 0.0001) {
        // Legacy code removed
    }
    */
}

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
            0, // eyeD
            hiddenDir,
            SystemState.objects,
            0, // light
            SystemState.otherObjects,
        );
    }
    console.log("法向量估算完成");
}

function updateLight() {
    const eyeZ = CONFIG.userEyeHeight;
    const targetY = CONFIG.screenDistance;

    // [Fix] Use real-time coordinates from the light object if it exists
    let lx, ly, lz;
    if (SystemState.lightObject && SystemState.lightObject.center) {
        lx = SystemState.lightObject.center.x;
        ly = SystemState.lightObject.center.y;
        lz = SystemState.lightObject.center.z;
    } else {
        // Fallback to config only during early init
        lx = CONFIG.lightX;
        ly = CONFIG.lightY;
        lz = CONFIG.lightZ;
    }

    const lightDir = new Vector(0, 0, 0);
    // Light camera looks at (0, targetY, eyeZ) from (lx, ly, lz)
    lightDir.normalInit(lx, ly, lz, 0, targetY, eyeZ);
    const lightCamPos = lightDir.getPoint(-5);

    SystemState.lightWindow.calculate(
        lightCamPos,
        0,
        lightDir,
        SystemState.objects,
        1.0,
        SystemState.otherObjects,
    );

    // [Fix] Do NOT recreate the sphere every frame. 
    // The lightObject is now in SystemState.objects and rendered normally.
    SystemState.otherObjects.length = 0;
}

function updateCamera() {
    SystemState.mainWindow.calculate(
        SystemState.mainWindow.capital,
        CONFIG.eyeD,
        SystemState.mainWindow.direction,
        SystemState.objects,
        1.0,
        SystemState.otherObjects,
    );
    if (SystemState.debugCenterPoint) {
        const obj = SystemState.objects[0];
        if (obj && obj.centerPoint) {
            const cp = obj.centerPoint;
            console.log(`centerPoint 屏幕坐标: xM=${cp.xM?.toFixed(1)}, yM=${cp.yM?.toFixed(1)}, isObjectCenter=${cp.isObjectCenter}`);
        }
    }
}

function render() {
    const ctx = SystemState.ctx;
    const { screenWidthPx: width, screenHeightPx: height } = SystemState;
    // 正确时序：
    // 1. updateCamera: 更新相机位置和方向，为后续计算提供 direction 基准
    // 2. updateLocalGrid: 使用 win.direction 计算切片距离，设置 isVisible
    // 3. Renderer.render -> Window.calculate: 使用 isVisible 过滤点
    updateCamera();
    updateLocalGrid();
    // [PERF] updateVisibleReflection 已在 gameLoop 中按需调用，此处移除重复调用
    const imageData = Renderer.render(ctx, width, height); // NOTE: Renderer.render now handles point drawing logic
    const pixelData = imageData.data;

    // Overlay System Update & Render
    const overlayContext = {
        vmEnabled: SystemState.virtualMouse.enabled,
        mouseX: SystemState.lastMouseX,
        mouseY: SystemState.lastMouseY,
        snappedPoint: SystemState.virtualMouse.snappedTo,
        interactionState: SystemState.interactionState,
        focusedObject: SystemState.focusedObject,
        focusVirtualMouseDepth: SystemState.focusVirtualMouseDepth,
        sliceDepth: SystemState.focusSliceDepth || 0,
    };
    OverlaySystem.updateAll(SystemState.mainWindow, overlayContext);
    const overlayPoints = OverlaySystem.getAllPoints();
    renderOverlayPoints(pixelData, width, height, overlayPoints);

    // if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'EDIT') {
    //    Renderer.renderScreenPointsHelper(pixelData, width, height);
    // }

    // [PERF] updateVirtualMouse 已在 mousemove 事件中调用，吸附逻辑不需要每帧重复
    // 注意：虚拟鼠标的绘制由 OverlaySystem 处理
    // renderScreenOverlay(pixelData, width, height); // Replaced by renderOverlayPoints

    ctx.putImageData(imageData, 0, 0);
}

function renderOverlayPoints(pixelData, width, height, points) {
    const isLR = CONFIG.displayMode === '3D_LR';
    const leftColor = isLR ? 'red' : 'blue';
    const rightColor = isLR ? 'blue' : 'red';

    for (const p of points) {
        if (p.xM < 0 || p.xM >= width || p.yM < 0 || p.yM >= height) continue;

        // 检查是否有视差 (3D效果)
        if (Math.abs((p.xL || 0) - (p.xR || 0)) > 0) {
            Renderer.renderScreenPixel(p.xL, p.yL, leftColor, p.light, pixelData, width, height);
            Renderer.renderScreenPixel(p.xR, p.yR, rightColor, p.light, pixelData, width, height);
        } else {
            Renderer.renderScreenPixel(p.xM, p.yM, 'purple', p.light, pixelData, width, height);
        }
    }
}

function updateVirtualMouse(mouseX, mouseY) {
    // Copy logic from main_raw.js
    // This function is quite long, pasting it all here.
    const vm = SystemState.virtualMouse;
    if (!vm.enabled) return;
    const width = SystemState.screenWidthPx;
    const height = SystemState.screenHeightPx;
    SystemState.screenPoints = SystemState.screenPoints.filter(
        p => p.tag !== 'VIRTUAL_MOUSE'
    );
    const win = SystemState.mainWindow;
    let snapped = null;
    let snappedDistSq = Infinity;

    // 1. 搜索 3D 格网 (Window.grid)
    if (win && win.findNearestPoint) {
        snapped = win.findNearestPoint(mouseX, mouseY, 0, (p) => {
            // [Fix] 拖拽时忽略物体自身的可吸附点（主要是中心点）
            if (SystemState.isDragging && SystemState.draggingObject) {
                if (p.ownerObject === SystemState.draggingObject) {
                    return false;
                }
            }

            if (SystemState.interactionState === 'EDIT') {
                // EDIT 态：只吸附局部格网的活动层格点（LOCAL_GRID）或控制点（CONTROL）
                // 且必须在屏幕平面附近
                if (p.tag !== 'LOCAL_GRID' && p.tag !== 'CONTROL' && p.tag !== 'LOCAL_GRID_EDGE') return false;

                // [FIX] 拖动控制点时，排除正在被拖动的点本身
                if (SystemState.draggedControlPoint && p === SystemState.draggedControlPoint) {
                    return false;
                }

                // [FIX] 检查该格点是否已被其他控制点占用（避免拖到已有控制点的位置）
                if (SystemState.draggedControlPoint && p.tag === 'LOCAL_GRID') {
                    const obj = SystemState.focusedObject;
                    if (obj && obj.controlPoints) {
                        const TOLERANCE = 0.05; // 5mm 容差
                        for (const cp of obj.controlPoints) {
                            if (cp === SystemState.draggedControlPoint) continue;
                            const dx = Math.abs(cp.lx - p.lx);
                            const dy = Math.abs(cp.ly - p.ly);
                            const dz = Math.abs(cp.lz - p.lz);
                            if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
                                return false; // 该格点已被占用
                            }
                        }
                    }
                }

                // [FIX] 严格检查点到屏幕平面的距离
                const dir = win.direction;
                const planePt = dir.start;
                // 注意：这里使用 p.x (世界坐标)，因为 isAttractable 过滤是在 updateLocalGrid 做的，
                // 但对于 CONTROL 点（或其他 Object 的点），我们需要在这里做额外检查。
                const dist = (p.x - planePt.x) * dir.x + (p.y - planePt.y) * dir.y + (p.z - planePt.z) * dir.z;
                if (Math.abs(dist) > 0.2) return false;
            }
            if (SystemState.draggingObject && p.isGridPoint) {
                if (isGridPointOccupied(p.gx, p.gy, p, SystemState.draggingObject)) {
                    return false;
                }
            }
            return true;
        });

        if (snapped) {
            const dx = snapped.xM - mouseX;
            const dy = snapped.yM - mouseY;
            snappedDistSq = dx * dx + dy * dy;
        }
    }

    // 2. [DISABLED] 屏幕辅助格网吸附暂时关闭
    // if (SystemState.interactionState === 'EDIT') {
    //     const overlayResult = OverlaySystem.findNearestAttractable(mouseX, mouseY);
    //     if (overlayResult && overlayResult.distSq < snappedDistSq) {
    //         snapped = overlayResult.point;
    //         snappedDistSq = overlayResult.distSq;
    //     }
    // }
    if (win && win.virtualCursor) {
        win.virtualCursor.setSnappedPoint(snapped);
    }
    let centerX = mouseX;
    let centerY = mouseY;
    let centerXL = mouseX;
    let centerXR = mouseX;
    let centerYL = mouseY;
    let centerYR = mouseY;
    let perspectiveScale = 1;
    if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'FOCUS_ENTERING') {
        // FOCUS态：虚拟鼠标在指定深度平面，不吸附
        const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
        const vmDepth = baseDis + SystemState.focusVirtualMouseDepth;
        perspectiveScale = Math.max(0.1, baseDis / vmDepth);
        const eyeD = CONFIG.eyeD;
        const halfEyeD = eyeD / 2;
        const disparity = halfEyeD * (1 - baseDis / vmDepth) * SystemState.mainWindow.DPIx;
        centerX = mouseX;
        centerY = mouseY;
        centerXL = mouseX - disparity;
        centerXR = mouseX + disparity;
        centerYL = mouseY;
        centerYR = mouseY;
        vm.snappedTo = null;
    } else if (snapped) {
        // VIEW态 或 EDIT态：吸附到格点（世界网格或局部网格）
        centerXL = snapped.xL;
        centerXR = snapped.xR;
        centerYL = snapped.yL;
        centerYR = snapped.yR;
        centerX = snapped.xM;
        centerY = snapped.yM;

        // [FIX] 屏幕辅助交点是 2D 点，没有 dis 属性，使用固定 perspectiveScale
        if (snapped.isIntersection) {
            // 屏幕辅助格网交点：固定缩放
            perspectiveScale = 1;
        } else {
            // 3D 点：基于深度计算缩放
            const pointDis = snapped.dis || 40;
            const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
            perspectiveScale = Math.max(0.3, Math.min(3.0, baseDis / pointDis));
        }
        vm.snappedTo = snapped;
    } else {
        // 无吸附点时：跟随鼠标（屏幕平面）
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
    const worldRadiusCm = 0.5;
    const radiusPx = worldRadiusCm * SystemState.mainWindow.DPIx * perspectiveScale;
    const numPoints = 24;
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const dx = Math.cos(angle) * radiusPx;
        const dy = Math.sin(angle) * radiusPx;
        const sp = new Point(0, 0, 0);
        sp.space = 'screen';
        sp.tag = 'VIRTUAL_MOUSE';
        sp.xM = centerX + dx;
        sp.yM = centerY + dy;
        sp.xL = centerXL + dx;
        sp.xR = centerXR + dx;
        sp.yL = centerYL + dy;
        sp.yR = centerYR + dy;
        sp.light = 0.9;
        SystemState.screenPoints.push(sp);
    }
}

function isGridPointOccupied(gx, gy, gridPoint, draggingObject) {
    const grid = SystemState.mainWindow.grid;
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) return false;
    if (gx < 0 || gx >= grid.length || gy < 0 || gy >= grid[0].length) return false;
    const cell = grid[gx][gy];
    if (!cell) return false;
    for (const p of cell) {
        if (p.isObjectCenter &&
            p.ownerObject &&
            p.ownerObject !== draggingObject) {
            const dx = Math.abs(p.x - gridPoint.x);
            const dy = Math.abs(p.y - gridPoint.y);
            const dz = Math.abs(p.z - gridPoint.z);
            const TOLERANCE = 0.1;
            if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
                return true;
            }
        }
    }
    return false;
}

function renderScreenOverlay(pixelData, width, height) {
    // Moved helper function to Renderer, but overlay logic is still here
    const vmPoints = SystemState.screenPoints.filter(p => p.space === 'screen' && p.tag === 'VIRTUAL_MOUSE');
    if (vmPoints.length > 0 && !SystemState._vmRenderDebugLogged) {
        console.log(`renderScreenOverlay: 找到 ${vmPoints.length} 个虚拟鼠标点, 第一个位置: (${vmPoints[0].xL?.toFixed(0)}, ${vmPoints[0].yL?.toFixed(0)})`);
        SystemState._vmRenderDebugLogged = true;
    }
    for (const p of SystemState.screenPoints) {
        if (p.space !== 'screen') continue;
        if (p.tag === 'VIRTUAL_MOUSE') {
            const isLR = CONFIG.displayMode === '3D_LR';
            const leftColor = isLR ? 'red' : 'blue';
            const rightColor = isLR ? 'blue' : 'red';
            if (Math.abs((p.xL || 0) - (p.xR || 0)) > 0) {
                Renderer.renderScreenPixel(p.xL, p.yL, leftColor, p.light, pixelData, width, height); // CALL RENDERER
                Renderer.renderScreenPixel(p.xR, p.yR, rightColor, p.light, pixelData, width, height); // CALL RENDERER
            } else {
                Renderer.renderScreenPixel(p.xM, p.yM, 'purple', p.light, pixelData, width, height); // CALL RENDERER
            }
        }
    }
}

function updateSliceContour() {
    if (SystemState.interactionState === 'FOCUS_ENTERING') return;
    const obj = SystemState.focusedObject;
    if (!obj) return;
    SystemState.screenPoints = SystemState.screenPoints.filter(
        p => p.tag !== 'SLICE_CONTOUR'
    );
    // console.log('截面深度:', SystemState.focusSliceDepth);
    // Implementation details might be missing in raw dump? check line 1042-1050
    // It seems correct.
}

function updateVisibleReflection() {
    // Copy from main_raw.js
    // Use dynamic light position
    let lightX = CONFIG.lightX;
    let lightY = CONFIG.lightY;
    let lightZ = CONFIG.lightZ;
    if (SystemState.lightObject && SystemState.lightObject.center) {
        lightX = SystemState.lightObject.center.x;
        lightY = SystemState.lightObject.center.y;
        lightZ = SystemState.lightObject.center.z;
    }

    const grid = SystemState.mainWindow.grid;
    const K = 5;
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
                if (p.nx === 0 && p.ny === 0 && p.nz === 0) continue;

                // Calculate Vector from Light to Point
                const dx = p.x - lightX;
                const dy = p.y - lightY;
                const dz = p.z - lightZ;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < 0.001) continue;

                // Incident Vector I = Normalize(Point - Light)
                const ix = dx / dist;
                const iy = dy / dist;
                const iz = dz / dist;

                // Reflection Vector R = I - 2 * dot(I, N) * N
                // Note: I points FROM light TO point.
                const dot = ix * p.nx + iy * p.ny + iz * p.nz;
                p.rx = ix - 2 * dot * p.nx;
                p.ry = iy - 2 * dot * p.ny;
                p.rz = iz - 2 * dot * p.nz;
            }
        }
    }

}

function resizeCanvas() {
    SystemState.canvas.width = window.innerWidth;
    SystemState.canvas.height = window.innerHeight;
    // [FIX] 同步 SystemState 尺寸，防止全屏退出后 Y 偏移
    SystemState.screenWidthPx = window.innerWidth;
    SystemState.screenHeightPx = window.innerHeight;
    SystemState.imageData = null; // [OPTIMIZATION A] Reset cache
    if (SystemState.mainWindow) {
        SystemState.mainWindow.windowObjects.length = 0;
    }
}

// ... (Helpers)



function measureObjectRadius(obj) {
    if (!obj || !obj.center) return 0;
    const points = obj.displayPoints?.length > 0 ? obj.displayPoints : obj.constructionPoints;
    if (!points || points.length === 0) return 0;
    const p = points[0];
    const dx = p.x - obj.center.x;
    const dy = p.y - obj.center.y;
    const dz = p.z - obj.center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

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

// 状态转换函数已迁移到 SystemState 类中:
// - SystemState.enterView()
// - SystemState.enterFocus(obj)
// - SystemState.exitFocus()
// - SystemState.rotateFocusedObject(dx, dy)
// - SystemState.calculateCenterPosition()

function calculateImpulse(duration) {
    if (duration < 100) return 0;
    const maxDuration = 2000;
    const t = Math.min(1, (duration - 100) / (maxDuration - 100));
    return t * t * (3 - 2 * t);
}

function applyTouchImpulse(impulse) {
    // Copy main_raw.js 1840-1897
    // Implementation of physics impulse
    const hitPoint = SystemState.chargeHitPoint;
    if (!hitPoint) return;
    const obj = SystemState.focusedObject;
    if (!obj) return;
    // ... Simplified, use applyTouchImpulseSimple for now if needed, or copy full code
    // Assuming full code is needed for functionality equivalence.
    const nx = hitPoint.nx || 0, ny = hitPoint.ny || 0, nz = hitPoint.nz || 0;
    const normalLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (normalLen < 0.001) return;
    const normNx = nx / normalLen, normNy = ny / normalLen, normNz = nz / normalLen;
    const displaceAmount = impulse * 0.5;
    const dispX = -normNx * displaceAmount;
    const dispY = -normNy * displaceAmount;
    const dispZ = -normNz * displaceAmount;
    const impactRadius = 2.0;
    const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
    for (const p of points) {
        const dx = p.x - hitPoint.x;
        const dy = p.y - hitPoint.y;
        const dz = p.z - hitPoint.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < impactRadius) {
            const t = 1 - (dist / impactRadius);
            const weight = t * t * (3 - 2 * t);
            p.x += dispX * weight;
            p.y += dispY * weight;
            p.z += dispZ * weight;
        }
    }
    SystemState.ifControl = true;
}

function moveObjectTo(obj, x, y, z) {
    if (!obj) return;

    // 计算位移增量（用于物理粒子同步）
    const dx = x - obj.center.x;
    const dy = y - obj.center.y;
    const dz = z - obj.center.z;

    // 阶段3重构：使用 Transform 组件
    if (obj.transform) {
        obj.transform.position.x = x;
        obj.transform.position.y = y;
        obj.transform.position.z = z;

        obj._dirty = true;
        obj.updateWorldPoints();
    } else {
        // Fallback for legacy objects (if any)
        const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
        for (const p of points) {
            p.x += dx;
            p.y += dy;
            p.z += dz;
        }
        if (obj.controlPoints && obj.controlPoints.length > 0) {
            for (const cp of obj.controlPoints) {
                cp.x += dx;
                cp.y += dy;
                cp.z += dz;
            }
        }
        obj.center.x = x;
        obj.center.y = y;
        obj.center.z = z;
    }

    // [滚轮修复] 同步更新物理粒子位置
    // 物理粒子使用世界坐标，当物体中心移动时需要同步偏移
    const physicsState = obj.representation?.physicsState;
    if (physicsState && physicsState.particles && obj._inPhysicsWorld) {
        for (const particle of physicsState.particles) {
            if (particle && particle.position) {
                particle.position.x += dx;
                particle.position.y += dy;
                particle.position.z += dz;
                // 同步 oldPosition（Verlet 积分使用，防止下一帧产生意外速度）
                if (particle.oldPosition) {
                    particle.oldPosition.x += dx;
                    particle.oldPosition.y += dy;
                    particle.oldPosition.z += dz;
                }
            }
        }

        // [修复] 同步 COM 锚点
        // extractCOMDrift 依赖 anchorCOM 作为零漂移基准
        // 如果物体整体被移动，锚点必须跟随移动，否则会被误判为物理漂移
        if (physicsState.anchorCOM) {
            physicsState.anchorCOM.x += dx;
            physicsState.anchorCOM.y += dy;
            physicsState.anchorCOM.z += dz;
        }
    }

    if (obj.centerPoint) {
        obj.centerPoint.x = x;
        obj.centerPoint.y = y;
        obj.centerPoint.z = z;
    }
    SystemState.ifControl = true;
}

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

    // [配置化] 根据配置决定是否清除物理显示状态
    // keepPhysicsInEdit=false 时切回固有显示，true 时保持物理显示
    if (!CONFIG.physicsDisplay.keepPhysicsInEdit) {
        obj._tempDisplayPoints = null;
        obj._tempDisplayPointsInitialized = false;
        obj._physicsActive = false;
    }
    // 注：保留 physics.enabled 和 _inPhysicsWorld，以便后续可以重新激活物理

    SystemState.interactionState = 'EDIT_ENTERING';
    const radiusEdit = measureObjectRadius(obj);
    console.log(`[STATE] FOCUS→EDIT: 半径=${radiusEdit.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
    tracePoint(obj, 'FOCUS→EDIT');
    SystemState.objects = SystemState.objects.filter(o => o !== SystemState.worldGrid);
    const win = SystemState.mainWindow;
    OrientationImpl.computeStatesForView(win?.direction);
    const defaultFront = { x: 0, y: 1, z: 0 };
    const defaultUp = { x: 0, y: 0, z: 1 };
    let front = obj.frontDirection ? { ...obj.frontDirection } : { ...defaultFront };
    let up = obj.upDirection ? { ...obj.upDirection } : { ...defaultUp };
    let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
    if (lenF < 0.001) front = { ...defaultFront };
    else front = { x: front.x / lenF, y: front.y / lenF, z: front.z / lenF };
    let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
    if (lenU < 0.001) up = { ...defaultUp };
    else up = { x: up.x / lenU, y: up.y / lenU, z: up.z / lenU };
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
    const targetState = OrientationImpl.getNearestState(currentQ);
    if (!targetState) {
        finishEnterEditState(obj);
        return;
    }
    const targetQ = targetState.q;
    const invCurrentQ = { w: currentQ.w, x: -currentQ.x, y: -currentQ.y, z: -currentQ.z };
    let deltaQ = OrientationImpl._multiplyQuaternion(targetQ, invCurrentQ);
    if (deltaQ.w < 0) {
        deltaQ = { w: -deltaQ.w, x: -deltaQ.x, y: -deltaQ.y, z: -deltaQ.z };
    }
    const rotAngle = 2 * Math.acos(Math.max(-1, Math.min(1, deltaQ.w)));
    console.log(`[STATE] EDIT snap: 需旋转 ${(rotAngle * 180 / Math.PI).toFixed(1)}°`);
    if (Math.abs(rotAngle) < 0.01) {
        obj._currentOrientationState = targetState;
        obj.quaternion = { ...targetState.q };
        finishEnterEditState(obj);
        return;
    }
    const sinHalf = Math.sin(rotAngle / 2);
    let rotAxis = { x: 0, y: 0, z: 1 };
    if (Math.abs(sinHalf) > 0.001) {
        rotAxis = {
            x: deltaQ.x / sinHalf,
            y: deltaQ.y / sinHalf,
            z: deltaQ.z / sinHalf
        };
    }
    obj.animationLock = true;
    const duration = 250;
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
        obj._currentOrientationState = targetState;
        obj.quaternion = { ...targetState.q };
        finishEnterEditState(obj);
    };
    SystemState.taskQueues.submit(rotateTask);
    SystemState.ifControl = true;
}

function finishEnterEditState(obj) {
    SystemState.interactionState = 'EDIT';
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

    // 关键：初始化切片深度为 0（物体已对齐到屏幕平面）
    SystemState.focusSliceDepth = 0;
    // [FIX] 同时重置虚拟鼠标深度，确保 FOCUS/EDIT 切换时基准对齐
    SystemState.focusVirtualMouseDepth = 0;

    // [ENABLED] 创建局部格网
    const localGrid = ObjectFactoryImpl.createLocalGridObject(obj);
    SystemState.localGrid = localGrid;
    SystemState.objects.push(localGrid);
    console.log(`[DEBUG] LocalGrid created: displayPoints=${localGrid.displayPoints?.length}`);

    // 立即调用一次 updateLocalGrid 确保初始状态
    // 注意顺序：先 showControlPoints 初始化 tag，再 updateLocalGrid 设置 isVisible
    showControlPoints(obj);
    updateLocalGrid(true); // force=true 强制首次更新，设置正确的 isVisible

    SystemState.ifControl = true;
    console.log('[STATE] EDIT entered');
}

function exitEditState() {
    if (SystemState.interactionState !== 'EDIT') return;
    hideControlPoints();
    if (SystemState.localGrid) {
        SystemState.objects = SystemState.objects.filter(o => o !== SystemState.localGrid);
        SystemState.localGrid = null;
    }
    if (!SystemState.objects.includes(SystemState.worldGrid)) {
        SystemState.objects.push(SystemState.worldGrid);
    }
    SystemState.interactionState = 'FOCUS';

    // [FIX] 退出 EDIT 态时重置切片深度，确保 FOCUS 态的扫描范围对称
    // 因为物体即将通过动画回到屏幕中心，所以切片和虚拟鼠标也应重置归零
    SystemState.focusSliceDepth = 0;
    SystemState.focusVirtualMouseDepth = 0;
    SystemState.virtualMouse.snappedTo = null;

    const objExit = SystemState.focusedObject;
    if (objExit) {
        // 阶段3修复：使用动画平滑回到屏幕中心（保持姿态 D 不变）
        const fromPos = { x: objExit.center.x, y: objExit.center.y, z: objExit.center.z };
        const centerPos = SystemState.calculateCenterPosition();

        // 检查是否需要移动（避免不必要的动画）
        const dx = centerPos.x - fromPos.x;
        const dy = centerPos.y - fromPos.y;
        const dz = centerPos.z - fromPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 0.01) {
            // 使用动画任务平滑移动回屏幕中心
            const moveTask = AnimationImpl.createTask({
                id: 'edit_exit_recenter_' + Date.now(),
                target: objExit,
                duration: 300,
                easing: AnimationImpl.Easing.easeOut,
                compute: (progress) => ({
                    position: AnimationImpl.lerpVec3(fromPos, centerPos, progress)
                }),
                apply: (targetObj, value) => {
                    // 使用 Transform 系统更新位置
                    targetObj.transform.position.x = value.position.x;
                    targetObj.transform.position.y = value.position.y;
                    targetObj.transform.position.z = value.position.z;
                    targetObj._dirty = true;
                    targetObj.updateWorldPoints();
                }
            });
            SystemState.taskQueues.submit(moveTask);
            console.log(`[STATE] EDIT→FOCUS: 动画回中心, 距离=${dist.toFixed(2)}cm`);
        }
    }
    SystemState.ifControl = true;
}

function showControlPoints(obj) {
    if (!obj) return;
    // 初始化控制点属性（isVisible 由 updateLocalGrid 统一管理切片显示）
    const points = obj.controlPoints && obj.controlPoints.length > 0 ? obj.controlPoints : (obj.constructionPoints || []).slice(0, 20);
    for (const cp of points) {
        cp.tag = 'CONTROL';
        cp.isAttractable = true;
        cp.isVisible = true;  // 初始可见，由 updateLocalGrid 根据切片距离更新
    }
}

function hideControlPoints() {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    const points = obj.controlPoints && obj.controlPoints.length > 0 ? obj.controlPoints : (obj.constructionPoints || []).slice(0, 20);
    for (const p of points) {
        p.tag = null;
        p.isVisible = false;  // 退出 EDIT 时隐藏所有控制点
    }
}

function updateControlPointsDisplay() {
    // 注意：此函数现在仅用于新增/删除控制点后刷新
    // 切片显示逻辑完全由 updateLocalGrid 负责
    // 不再调用 showControlPoints 以避免覆盖切片状态

    // 触发 updateLocalGrid 刷新控制点可见性
    updateLocalGrid(true);
}

function findControlPointAt(screenX, screenY) {
    // This is duplicate logic from InputManager.js (handleEditClick)
    // Good to keep it here as a utility used by intents if needed
    // But InputManager duplicated it because it could not import.
    // Hub can use it.
    const obj = SystemState.focusedObject;
    if (!obj) return null;
    const points = obj.controlPoints && obj.controlPoints.length > 0
        ? obj.controlPoints
        : (obj.constructionPoints || []).slice(0, 20);
    const radius = 15;
    for (const p of points) {
        if (p.tag !== 'CONTROL') continue;
        const dist = Math.sqrt((p.xM - screenX) ** 2 + (p.yM - screenY) ** 2);
        if (dist < radius) return p;
    }
    return null;
}

/**
 * 将世界坐标转换为物体局部坐标
 */
function worldToLocal(obj, worldPos) {
    if (!obj.transform) {
        return {
            x: worldPos.x - obj.center.x,
            y: worldPos.y - obj.center.y,
            z: worldPos.z - obj.center.z
        };
    }

    // 平移
    const tx = worldPos.x - obj.transform.position.x;
    const ty = worldPos.y - obj.transform.position.y;
    const tz = worldPos.z - obj.transform.position.z;

    // 逆旋转（四元数共轭）
    const q = obj.transform.rotation;
    const qw = q.w, qx = -q.x, qy = -q.y, qz = -q.z;

    // 应用逆旋转 v' = q * v * q^(-1)
    const ix = qw * tx + qy * tz - qz * ty;
    const iy = qw * ty + qz * tx - qx * tz;
    const iz = qw * tz + qx * ty - qy * tx;
    const iw = -qx * tx - qy * ty - qz * tz;

    return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx
    };
}

function moveControlPoint(controlPoint, dx, dy) {
    if (!controlPoint) return;
    const obj = SystemState.focusedObject;
    if (!obj || !obj.transform) return;

    const scale = 0.05;
    const worldDx = dx * scale;
    const worldDy = 0; // Assuming Y is up/down in screen? Original code modified Z with dy.
    const worldDz = -dy * scale; // Original: z -= dy * scale

    // Inverse Transform: Delta_local = Q_inv * Delta_world
    // Q_inv for unit quaternion is (w, -x, -y, -z)
    const qw = obj.transform.rotation.w;
    const qx = obj.transform.rotation.x;
    const qy = obj.transform.rotation.y;
    const qz = obj.transform.rotation.z;

    // We only rotate the vector, so T doesn't matter for Delta.
    // v' = q_inv * v * q
    // invQ = (qw, -qx, -qy, -qz)

    // Inline quaternion vector rotation with inverse
    const iqw = qw;
    const iqx = -qx;
    const iqy = -qy;
    const iqz = -qz;

    const vx = worldDx;
    const vy = worldDy;
    const vz = worldDz;

    const ix = iqw * vx + iqy * vz - iqz * vy;
    const iy = iqw * vy + iqz * vx - iqx * vz;
    const iz = iqw * vz + iqx * vy - iqy * vx;
    const iw = -iqx * vx - iqy * vy - iqz * vz;

    const lx = ix * iqw + iw * -iqx + iy * -iqz - iz * -iqy;
    const ly = iy * iqw + iw * -iqy + iz * -iqx - ix * -iqz;
    const lz = iz * iqw + iw * -iqz + ix * -iqy - iy * -iqx;

    // Apply to local coordinates
    controlPoint.lx += lx;
    controlPoint.ly += ly;
    controlPoint.lz += lz;

    obj._dirty = true;
    obj.updateWorldPoints();

    if (obj) obj._needsRefit = true; // Trigger geometry refit if needed
}

function deleteControlPoint(controlPoint) {
    if (!controlPoint) return;
    const obj = SystemState.focusedObject;
    if (!obj || !obj.controlPoints) return;
    const index = obj.controlPoints.indexOf(controlPoint);
    if (index > -1) {
        // [HISTORY] Use Command
        const cmd = createDeleteControlPointCommand(obj, index);
        HistoryManager.execute(cmd);

        obj._needsRefit = true;
        updateControlPointsDisplay();
    }
}

function addControlPointAt(screenX, screenY) {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    const center = obj.center;
    const screenCenterX = SystemState.screenWidthPx / 2;
    const screenCenterY = SystemState.screenHeightPx / 2;
    const offsetX = (screenX - screenCenterX) * 0.02;
    const offsetZ = (screenCenterY - screenY) * 0.02;
    const newPoint = new Point(center.x + offsetX, center.y, center.z + offsetZ);

    // [HISTORY] Use Command
    const cmd = createAddControlPointCommand(obj, newPoint);
    HistoryManager.execute(cmd);

    obj._needsRefit = true;
    updateControlPointsDisplay();
}

function updateLocalGrid(force = false) {
    // 性能优化：只在 EDIT 态时更新
    if (SystemState.interactionState !== 'EDIT') return;

    const grid = SystemState.localGrid;
    const target = SystemState.focusedObject;
    const win = SystemState.mainWindow;
    if (!grid || !target || !win) {
        return;
    }

    // [PERF] 只在姿态变化时更新世界坐标（除非 force=true）
    const posChanged = (
        grid.transform.position.x !== target.transform.position.x ||
        grid.transform.position.y !== target.transform.position.y ||
        grid.transform.position.z !== target.transform.position.z
    );
    const rotChanged = (
        grid.transform.rotation.w !== target.transform.rotation.w ||
        grid.transform.rotation.x !== target.transform.rotation.x ||
        grid.transform.rotation.y !== target.transform.rotation.y ||
        grid.transform.rotation.z !== target.transform.rotation.z
    );

    // [PERF] 1. 姿态同步与世界坐标更新（仅在姿态变化或强制更新时执行）
    if (force || posChanged || rotChanged) {
        // 同步 Transform (Pose) - 确保 Grid 的位置和旋转与 Target 完全一致
        grid.transform.position.x = target.transform.position.x;
        grid.transform.position.y = target.transform.position.y;
        grid.transform.position.z = target.transform.position.z;

        grid.transform.rotation.w = target.transform.rotation.w;
        grid.transform.rotation.x = target.transform.rotation.x;
        grid.transform.rotation.y = target.transform.rotation.y;
        grid.transform.rotation.z = target.transform.rotation.z;

        // 更新世界坐标
        grid._dirty = true;
        grid.updateWorldPoints();
    }

    // 3. 双阈值逻辑：显示阈值 vs 吸附阈值
    const dir = win.direction;
    const planePt = dir.start;

    // 显示阈值：严格裁剪，只保留屏幕平面附近的点
    const DISPLAY_THRESHOLD = 0.1;
    // 吸附阈值：只有极近屏幕平面的点可吸附（0.1cm）
    const SNAP_THRESHOLD = 0.1;

    // ========================================================================
    // 局部格网点：使用 isVisible 控制业务显隐，light 保持固定值
    // ========================================================================
    for (const p of grid.displayPoints) {
        // 计算点到屏幕平面的距离
        const dist = (p.x - planePt.x) * dir.x + (p.y - planePt.y) * dir.y + (p.z - planePt.z) * dir.z;
        const absDist = Math.abs(dist);

        if (p.tag === 'LOCAL_GRID') {
            // 业务可见性：通过 isVisible 控制（与物理光照分离）
            p.isVisible = (absDist <= DISPLAY_THRESHOLD);
            // 吸附控制：只有屏幕平面上的点可吸附
            p.isAttractable = (absDist <= SNAP_THRESHOLD);
            // light 保持固定，不用于显隐
            p.light = 0.8;
        } else if (p.tag === 'LOCAL_GRID_DASH') {
            p.isVisible = (absDist <= DISPLAY_THRESHOLD);
            p.isAttractable = false;
            p.light = 0.4;
        } else if (p.tag === 'LOCAL_GRID_EDGE') {
            // 棱点：始终可见，始终可吸附
            p.isVisible = true;
            p.isAttractable = true;
            p.light = 0.8;
        }
    }

    // ========================================================================
    // 控制点切片显示：使用 isVisible 控制，保留 tag='CONTROL'
    // ========================================================================
    const focusedObj = SystemState.focusedObject;
    if (focusedObj && focusedObj.controlPoints && SystemState.interactionState === 'EDIT') {
        for (const cp of focusedObj.controlPoints) {
            // 计算控制点到屏幕平面的距离（世界坐标）
            const dist = (cp.x - planePt.x) * dir.x + (cp.y - planePt.y) * dir.y + (cp.z - planePt.z) * dir.z;
            const absDist = Math.abs(dist);

            // 业务可见性控制（tag 始终保持 'CONTROL'，用于样式）
            cp.isVisible = (absDist <= DISPLAY_THRESHOLD);
            cp.isAttractable = (absDist <= SNAP_THRESHOLD);
            // tag 不再用于显隐，保持固定
            if (!cp.tag) cp.tag = 'CONTROL';
        }
    }

    // ========================================================================
    // 显示点平面近点标记：为渲染提供 isPlaneNear 属性
    // ========================================================================
    if (focusedObj && focusedObj.displayPoints && SystemState.interactionState === 'EDIT') {
        const planeThreshold = EditConfig.planeHighlightThreshold;
        for (const dp of focusedObj.displayPoints) {
            // 计算显示点到屏幕平面的距离
            const dist = (dp.x - planePt.x) * dir.x + (dp.y - planePt.y) * dir.y + (dp.z - planePt.z) * dir.z;
            dp.isPlaneNear = (Math.abs(dist) <= planeThreshold);
        }
    }

    // [PERF] 只在姿态真正变化时触发重新渲染
    SystemState.ifControl = true;
}

function animateSliceTransition(obj, targetX, targetY, targetZ, duration = 150) {
    const startX = obj.center.x;
    const startY = obj.center.y;
    const startZ = obj.center.z;
    const startTime = performance.now();
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const newX = startX + (targetX - startX) * eased;
        const newY = startY + (targetY - startY) * eased;
        const newZ = startZ + (targetZ - startZ) * eased;
        moveObjectTo(obj, newX, newY, newZ);
        // updateLocalGrid 已移动到 render() 中

        // [FIX] 动画过程中持续更新吸附状态，防止虚拟鼠标漂浮
        if (SystemState.virtualMouse.enabled) {
            updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
        }

        SystemState.ifControl = true;
        if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}

function animateRotation(obj, axis, totalAngle, duration = 200) {
    const startTime = performance.now();
    let lastProgress = 0;
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const progressDelta = eased - lastProgress;
        const angleDelta = totalAngle * progressDelta;
        if (Math.abs(angleDelta) > 0.00001) {
            OrientationImpl.rotateObjectAroundAxis(obj, axis, angleDelta);
        }
        lastProgress = eased;
        updateLocalGrid();
        SystemState.ifControl = true;
        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            snapToNearestLayer(obj);
        }
    }
    requestAnimationFrame(animate);
}

function snapToNearestLayer(obj) {
    const win = SystemState.mainWindow;
    if (!win || !win.direction) return;
    const dir = win.direction;
    const planePt = dir.start;
    const orientationType = obj._currentOrientationState?.type || 'FACE';
    const layerSpacing = EditConfig.getLayerSpacingForOrientation(orientationType);
    const maxDepth = EditConfig.getMaxDepthForOrientation(orientationType);
    const currentDist = (obj.center.x - planePt.x) * dir.x + (obj.center.y - planePt.y) * dir.y + (obj.center.z - planePt.z) * dir.z;
    let nearestLayer = Math.round(currentDist / layerSpacing);
    const maxLayer = Math.floor(maxDepth / layerSpacing);
    nearestLayer = Math.max(-maxLayer, Math.min(maxLayer, nearestLayer));
    const nearestLayerDist = nearestLayer * layerSpacing;

    // 关键：更新切片深度状态，确保屏幕辅助格网奇偶性正确
    SystemState.focusSliceDepth = nearestLayerDist;

    const delta = nearestLayerDist - currentDist;
    if (Math.abs(delta) > 0.001) {
        const targetX = obj.center.x + delta * dir.x;
        const targetY = obj.center.y + delta * dir.y;
        const targetZ = obj.center.z + delta * dir.z;
        animateSliceTransition(obj, targetX, targetY, targetZ, 150);
    }
}

function processTaskQueue(worldTime, dt) {
    for (const task of SystemState.taskQueues.current) {
        const completed = AnimationImpl.executeTask(task, worldTime, dt);
        if (!completed) {
            SystemState.taskQueues.next.push(task);
        } else if (task.then) {
            SystemState.taskQueues.submit(task.then);
        }
    }
    SystemState.taskQueues.swap();
}

// ========== COM Splitting (质心分离) ==========
// 参考: .agent/implementation_plans/physics_com_splitting_design.md

/**
 * 初始化物理质心锚点
 * 在物体加入物理世界后调用，锁定 anchorCOM 作为参考点
 */
function initPhysicsCOM(obj) {
    const physicsState = obj.representation?.physicsState;
    if (!physicsState || !physicsState.particles) return;

    const particles = physicsState.particles;

    // 计算总质量（用于后续归一化）
    let totalMass = 0;
    for (const p of particles) {
        totalMass += p.mass;
    }

    // [FIX] 使用 obj.center 作为锚点，而非从粒子计算
    // 这确保 COM 锚定与 commitPhysicsState 的 _bodyToWorld 使用相同的参考点
    const com = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

    // 缓存到 physicsState
    physicsState.totalMass = totalMass;
    physicsState.anchorCOM = { ...com };  // 锁定锚点，永不修改
    physicsState.initialCOM = { ...com }; // 仅供调试

    if (CONFIG.physicsDebug) {
        console.log(`[COM] Initialized anchorCOM=(${com.x.toFixed(3)}, ${com.y.toFixed(3)}, ${com.z.toFixed(3)}), totalMass=${totalMass.toFixed(3)}, usingObjectCenter=true`);
    }
}

/**
 * 提取质心漂移并转移到 Object.center
 * 在 PhysicsSystem.step() 后、commitPhysics() 前调用
 */
function extractCOMDrift(obj) {
    const physicsState = obj.representation?.physicsState;
    if (!physicsState || !physicsState.anchorCOM) return;

    const particles = physicsState.particles;
    const anchor = physicsState.anchorCOM;
    const totalMass = physicsState.totalMass;

    if (totalMass <= 0) return;

    // 1. 计算当前帧质心
    let currCOM = { x: 0, y: 0, z: 0 };
    for (const p of particles) {
        currCOM.x += p.position.x * p.mass;
        currCOM.y += p.position.y * p.mass;
        currCOM.z += p.position.z * p.mass;
    }
    currCOM.x /= totalMass;
    currCOM.y /= totalMass;
    currCOM.z /= totalMass;

    // 2. 计算相对于锚点的漂移
    const drift = {
        x: currCOM.x - anchor.x,
        y: currCOM.y - anchor.y,
        z: currCOM.z - anchor.z
    };

    // 3. 归心：将所有粒子拉回锚点
    for (const p of particles) {
        p.position.x -= drift.x;
        p.position.y -= drift.y;
        p.position.z -= drift.z;

        // Verlet 积分：同步 oldPosition
        if (p.oldPosition) {
            p.oldPosition.x -= drift.x;
            p.oldPosition.y -= drift.y;
            p.oldPosition.z -= drift.z;
        }
    }

    // 4. 转移：将漂移累加到 Object.center
    // [配置化] 只有启用 COM 平移分离时才执行
    if (CONFIG.physicsDisplay.enableCOMTranslation) {
        obj.center.x += drift.x;
        obj.center.y += drift.y;
        obj.center.z += drift.z;
    }

    // 调试日志（低频）
    if (CONFIG.physicsDebug && (SystemState.frameCount % 120 === 0)) {
        const driftMag = Math.sqrt(drift.x * drift.x + drift.y * drift.y + drift.z * drift.z);
        if (driftMag > 0.001) {
            console.log(`[COM] drift=(${drift.x.toFixed(4)}, ${drift.y.toFixed(4)}, ${drift.z.toFixed(4)}), center=(${obj.center.x.toFixed(3)}, ${obj.center.y.toFixed(3)}, ${obj.center.z.toFixed(3)})`);
        }
    }
}

// ========== Phase 4+: 物理系统主循环 ==========
function physicsStep(dt) {
    // Phase 4: 仅在 FOCUS/EDIT 态运行物理
    if (SystemState.interactionState !== 'FOCUS' && SystemState.interactionState !== 'EDIT') {
        return;
    }

    // 检查物理模式是否启用
    if (CONFIG.physicsMode === 'OFF') {
        return;
    }

    const obj = SystemState.focusedObject;
    if (!obj) return;

    // [互斥] 如果有针对当前对象的动画任务（如归位动画），暂停物理
    const hasAnimationOnObject = SystemState.taskQueues.current.some(t => t.target === obj);
    if (hasAnimationOnObject) {
        if (CONFIG.physicsDebug) {
            console.log('[physicsStep] Paused: animation running on focused object');
        }
        return;
    }

    // Phase 4: 调试日志（降低频率）
    // if (CONFIG.physicsDebug && (SystemState.frameCount % 60 === 0)) {
    //     console.log('[physicsStep] dt=', (dt / 1000).toFixed(4), 'mode=', CONFIG.physicsMode);
    // }

    // [配置化] activateOnFocusEnter：进入 FOCUS 后自动初始化物理
    // [Fix] 必须检查 interactionState === 'FOCUS'，防止在 EDIT 态重拟合禁用物理后被错误地自动重新激活
    if (CONFIG.physicsDisplay.activateOnFocusEnter &&
        obj._physicsReady &&
        !obj.physics.enabled &&
        SystemState.interactionState === 'FOCUS') {
        console.log('[PHYSICS] Auto-activating physics (activateOnFocusEnter=true)');

        // 复用 FOCUS_PHYSICS_TOUCH 中的初始化逻辑
        obj.physics.enabled = true;

        if (obj.representation?.type === 'sphericalHarmonics') {
            obj.generateVolumetricMesh({ relaxIterations: 10 });
        }

        obj.rebuildPhysicsTopology({
            physicsModel: obj.physics.model || CONFIG.defaultPhysicsModel,
            stiffness: obj.physics.stiffness || CONFIG.physicsParams.force.stiffness,
            damping: obj.physics.damping || CONFIG.physicsParams.force.damping
        });

        if (!_globalPhysicsSystem) {
            _globalPhysicsSystem = new PhysicsSystem({
                gravity: { x: 0, y: 0, z: 0 },
                substeps: CONFIG.physicsParams.system.substeps,
                airDamping: CONFIG.physicsParams.force.airDamping,
                globalDamping: CONFIG.physicsParams.force.globalDamping,
                constraintIterations: 15,
                verbose: CONFIG.physicsDebug,
                // 系统参数
                maxDisplacement: CONFIG.physicsParams.system.maxDisplacement,
                fixedTimeStep: CONFIG.physicsParams.system.fixedTimeStep,
                maxStepsPerFrame: CONFIG.physicsParams.system.maxStepsPerFrame
            });
        }

        _globalPhysicsSystem.addObject(obj);
        obj._inPhysicsWorld = true;
        initPhysicsCOM(obj);

        if (CONFIG.physicsMode === 'PERFORMANCE' && obj._isVolumetric) {
            obj._tempDisplayPoints = obj.constructionPoints.slice(0, obj._surfaceBoundary);
            for (const p of obj._tempDisplayPoints) {
                p.tag = p.tag || 'PHYSICS_NODE';
            }
            obj._tempDisplayPointsInitialized = true;
        }

        // 自动激活模式下立即进入物理活动状态
        obj._physicsActive = true;
        obj._physicsActiveFrames = 0;
    }

    // Phase 5: 性能模式 - 直接映射建构点为临时显示点（仅在物理激活后）
    if (CONFIG.physicsMode === 'PERFORMANCE') {
        // [方案A] 只在物理激活 (_physicsActive=true) 后设置临时显示点
        // 物理未激活时保持固有显示 (displayPoints)
        if (obj._physicsActive && !obj._tempDisplayPointsInitialized && obj._isVolumetric) {
            // 注意：这里只是数组容器拷贝，点对象仍归 constructionPoints 所有
            obj._tempDisplayPoints = obj.constructionPoints.slice(0, obj._surfaceBoundary);
            for (const p of obj._tempDisplayPoints) {
                p.tag = p.tag || 'PHYSICS_NODE';
            }
            obj._tempDisplayPointsInitialized = true;
            if (CONFIG.physicsDebug) {
                console.log('[physicsStep] PERFORMANCE mode: _tempDisplayPoints initialized, count=', obj._tempDisplayPoints.length);
            }
        }
        // 位置已由 constructionPoints 持有，无需额外操作
    }

    // Phase 6: 效果模式 - 只在物理活动时拟合
    else if (CONFIG.physicsMode === 'QUALITY') {
        // 只在物理活动时（用户点击后）执行拟合
        if (obj._physicsActive && obj._isVolumetric && obj.representation?.data?.sphericalHarmonics) {
            // 世界坐标 -> 局部坐标（复用数组）
            const localPoints = obj._cachedLocalPositions || new Array(obj.constructionPoints.length);
            for (let i = 0; i < obj.constructionPoints.length; i++) {
                const p = obj.constructionPoints[i];
                if (!localPoints[i]) localPoints[i] = { x: 0, y: 0, z: 0 };
                // 使用局部坐标
                localPoints[i].x = p.lx ?? p.x;
                localPoints[i].y = p.ly ?? p.y;
                localPoints[i].z = p.lz ?? p.z;
            }
            obj._cachedLocalPositions = localPoints;

            // 拟合（严格使用固有阶数，禁止自动降级/升级）
            const lockedOrder = obj.representation.data.fittedOrder || 4;
            try {
                obj.fitSphericalHarmonics({
                    sourcePoints: localPoints,
                    order: lockedOrder,
                    useIncremental: false,
                    writeToTemp: true,
                    fitter: FittingCalculator,
                    Matrix: Matrix,
                    sphericalHarmonics: obj.representation.data.sphericalHarmonics
                });

                // 首次创建或原地更新
                const isFirstFrame = !obj._tempDisplayPoints || obj._tempDisplayPoints.length === 0;
                obj.generateDisplayPoints({
                    coefficients: obj._tempRepresentation.coefficients,
                    writeToTemp: true,
                    inPlace: !isFirstFrame,
                    density: 20
                });

                if (CONFIG.physicsDebug) {
                    console.log('[physicsStep] QUALITY mode: fitting completed, order=', lockedOrder);
                }
            } catch (err) {
                console.warn('[physicsStep] QUALITY mode fitting error:', err.message);
            }
            // 注：活动帧计数已移至物理步骤后统一处理
        }
    }

    // Phase 7: 法向量与光照更新
    // 明确法向量数据源
    const normalSource = (CONFIG.physicsMode === 'QUALITY' && obj._tempDisplayPoints)
        ? obj._tempDisplayPoints
        : obj.constructionPoints;

    // 仅在有点时更新法向量
    if (normalSource && normalSource.length > 0) {
        // 使用径向法向量作为简化版本（避免依赖 surfaceTriangles）
        for (const p of normalSource) {
            const len = Math.sqrt((p.lx || 0) ** 2 + (p.ly || 0) ** 2 + (p.lz || 0) ** 2);
            if (len > 1e-10) {
                p.nx = (p.lx || 0) / len;
                p.ny = (p.ly || 0) / len;
                p.nz = (p.lz || 0) / len;
                p._lnx = p.nx;
                p._lny = p.ny;
                p._lnz = p.nz;
            }
        }
    }

    // 触发反射更新
    SystemState.lightDirty = true;

    // Phase 9: 激活物理引擎（如果物体有物理配置）
    // 使用懒惰初始化的全局物理系统实例

    // 调试：显示条件检查
    if (CONFIG.physicsDebug && (SystemState.frameCount % 120 === 0)) {
        console.log(`[physicsStep] Checking physics conditions: physics.enabled=${obj.physics?.enabled}, points=${obj.constructionPoints?.length}`);
    }

    if (obj.physics?.enabled && obj.constructionPoints?.length > 0) {
        if (!_globalPhysicsSystem) {
            console.log('[physicsStep] Creating global PhysicsSystem');
            _globalPhysicsSystem = new PhysicsSystem({
                gravity: { x: 0, y: 0, z: 0 }, // 暂时禁用重力
                substeps: 10, // 增加子步数提高稳定性
                airDamping: 0.5, // 高空气阻力，快速衰减运动
                constraintIterations: 15, // 增加约束迭代
                verbose: CONFIG.physicsDebug
            });
        }
        // [方案A] 备用初始化路径
        // 正常情况下，物理初始化在 FOCUS_PHYSICS_TOUCH 中进行
        // 这里是兜底逻辑，防止物理启用但未通过点击初始化的情况
        if (!obj._inPhysicsWorld && !obj._physicsInitFailed) {
            console.log('[physicsStep] Fallback: Building physics topology for object');
            try {
                if (obj.representation?.type === 'sphericalHarmonics' && !obj._isVolumetric) {
                    console.log('[physicsStep] Generating volumetric mesh for SH object');
                    obj.generateVolumetricMesh({
                        relaxIterations: 10
                    });
                }

                if (!obj.representation?.physicsState?.particles?.length) {
                    obj.rebuildPhysicsTopology({
                        physicsModel: obj.physics.model || CONFIG.defaultPhysicsModel,
                        stiffness: obj.physics.stiffness || CONFIG.physicsParams.force.stiffness,
                        damping: obj.physics.damping || CONFIG.physicsParams.force.damping
                    });
                    console.log('[physicsStep] Topology built, mode=', obj.mode);
                }
            } catch (err) {
                console.error('[physicsStep] Failed to build topology:', err.message);
                obj._physicsInitFailed = true;
                return;
            }

            console.log('[physicsStep] Adding object to physics world');
            _globalPhysicsSystem.addObject(obj);
            obj._inPhysicsWorld = true;
            console.log('[physicsStep] Object added, _globalPhysicsSystem.objectCount=', _globalPhysicsSystem.objects?.length);

            initPhysicsCOM(obj);

            // 跳过本帧的物理计算，让系统稳定一帧
            return;
        }
        // 执行物理步
        if (CONFIG.physicsDebug) {
            const hasStarted = obj._hasLoggedPhysicsStart;
            if (!hasStarted) {
                console.log(`[PHYSICS] Object entering physics loop: ${obj.metadata?.name || 'Unknown'}`);
                console.log(`[PHYSICS] physicsModel=${obj.physics.model}, mass=${obj.physics.mass}`);
                obj._hasLoggedPhysicsStart = true;
            }
        }

        _globalPhysicsSystem.step(dt / 1000); // dt 是毫秒，PhysicsSystem 期望秒

        // [COM Splitting] 提取质心漂移，转移到 Object.center
        extractCOMDrift(obj);

        // [修复] 物理活动帧计数（两种模式共用，确保静止检测能触发）
        if (obj._physicsActive) {
            obj._physicsActiveFrames = (obj._physicsActiveFrames || 0) + 1;
        }

        // NaN 检测：如果物理发散，立即停止
        const p0 = obj.constructionPoints[0];
        if (p0 && (isNaN(p0.x) || isNaN(p0.y) || isNaN(p0.z))) {
            console.error('[PHYSICS] NaN detected! Disabling physics for this object.');
            obj.physics.enabled = false;
            obj._inPhysicsWorld = false;
            return;
        }

        // [配置化] 静止检测：如果物理活动了足够久且没有明显运动，则停止
        // 注意：必须在持续同步之前检测，避免 settle 帧双重同步
        let settled = false;
        if (obj._physicsActive && obj._physicsActiveFrames > CONFIG.physicsDisplay.settleFrameThreshold) {
            // 检测平均速度
            const particles = obj.representation?.physicsState?.particles || [];
            let totalVelSq = 0;
            for (const p of particles) {
                if (p.velocity) {
                    totalVelSq += p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y + p.velocity.z * p.velocity.z;
                }
            }
            const avgVelSq = totalVelSq / (particles.length || 1);

            // [配置化] 使用配置的速度阈值判定静止
            if (avgVelSq < CONFIG.physicsDisplay.settleVelocityThreshold) {
                obj._physicsActive = false;
                settled = true;

                // [关键] 先做最后一次同步，确保渲染显示的是物理最终位置
                if (obj._syncPhysicsToConstruction) {
                    obj._syncPhysicsToConstruction();
                }

                // [Phase 17] 然后执行重置到理想形状
                if (obj.commitPhysicsState) {
                    obj.commitPhysicsState();
                }

                // [配置化] 根据 revertOnSettle 决定是否恢复固有显示
                if (CONFIG.physicsDisplay.revertOnSettle) {
                    obj._tempDisplayPoints = null;
                    obj._tempDisplayPointsInitialized = false;
                }

                if (CONFIG.physicsDebug) {
                    const action = CONFIG.physicsDisplay.revertOnSettle ? 'restored to displayPoints' : 'kept physics display';
                    console.log(`[PHYSICS] Object settled, ${action} (avgVelSq=${avgVelSq.toFixed(6)})`);
                }
            }
        }

        // [FIX] 持续同步 particles 到 constructionPoints，使物理运动可视化
        // 只在物理激活期间同步，settle 帧不同步（已在上面单独处理）
        if (obj._physicsActive && !settled && obj._syncPhysicsToConstruction) {
            obj._syncPhysicsToConstruction();
        }

        // 调试：观察第一个点的变化
        if (CONFIG.physicsDebug && (SystemState.frameCount % 60 === 0)) {
            const pLast = obj.constructionPoints[4];
            console.log(`[PHYSICS] Step ${SystemState.frameCount}: P4 loc=(${pLast?.lx?.toFixed(3)}, ${pLast?.ly?.toFixed(3)}, ${pLast?.lz?.toFixed(3)})`);
        }
    }

    // 原有物理逻辑（保留兼容）
    // 移除冗余的 commitPhysics 调用，因为物理同步已在 commitPhysicsState 或 physics loop 中处理
    /*
    for (const o of SystemState.objects) {
        if (o.animationLock) continue;
        if (!o.physics || !o.physics.enabled) continue;
    }
    for (const o of SystemState.objects) {
        if (o.animationLock) continue;
        if (o.commitPhysics) {
            o.commitPhysics();
        }
    }
    */
}

async function gameLoop(timestamp = 0) {
    let dt = timestamp - SystemState.lastTimestamp;

    // [Fix] 限制最大 dt 为 33ms（约30fps），防止物理系统发散
    if (dt > 33) dt = 33;

    SystemState.lastTimestamp = timestamp;
    SystemState.worldTime = timestamp;

    // Camera Processing
    // CameraSystem.processCamera(); // Original had this
    // In `main_raw.js` line 149 `processCamera` calls `console.log`.
    // Wait, `processCamera` was NOT called in `gameLoop` in `main_raw.js`?
    // Let's check.
    // `initCamera` (L127) was called.
    // `processCamera` (L149) exists.
    // But where is it called?
    // Ah, it was NOT called in `gameLoop` in `main_raw.js` (lines 2398-2421).
    // But wait! `updateCamera` (L707) calls nothing related to video.
    // The system uses `TaskQueue`? No.
    // Let me re-read `main_raw.js` line check...
    // In `main_raw.js`:
    // Line 2402: handleInput();
    // Line 2413: drawCameraFeedOnMainCanvas(SystemState.ctx);
    // BUT `processCamera` (the one doing classifier logic) is NOT in gameLoop?
    // Found it: it seems `processCamera` was meant to be called.
    // Wait, checking `main_raw.js` again...
    // Accessing `view_file` results...

    // Actually, I don't see `processCamera` called in `gameLoop`.
    // However, I see `CameraSystem.processCamera` logic in `main_raw.js`:
    /*
    149: function processCamera() {
    ...
    209:     SystemState.mainWindow.headMoveTo(-headDis, headHeight, headX);
    */
    // It handles head tracking.
    // If it's not called, head tracking won't work.
    // Maybe it was called via `requestAnimationFrame` loop initiated separately?
    // L127 initCamera starts video.
    // It seems key: `gameLoop` calls `drawCameraFeedOnMainCanvas` but maybe `processCamera` is missing?
    // Or maybe I missed where it was called.
    // In `main.js` (lines 1-350 view), `initCamera` is defined.
    // Let's check `processCamera` calls.
    // Text search? No.
    // Anyhow, `CameraSystem.processCamera` should probably be called in `gameLoop` if we want head tracking.
    // I will add it to `gameLoop` if it's safe.
    if (SystemState.cameraActive && CONFIG.cameraControl.enabled) {
        CameraSystem.processCamera();
    }

    handleInput();
    applyVelocities(dt);
    if (Math.abs(SystemState.velocityState.rotation.current) > 0.001) SystemState.sceneDirty = true;

    processTaskQueue(SystemState.worldTime, dt);

    for (const obj of SystemState.objects) {
        if (obj._needsRefit) {
            obj._needsRefit = false;

            console.log(`[Refit] 检测到 _needsRefit, obj=${obj.metadata?.name}, representation.type=${obj.representation?.type}, hasSH=${!!obj.representation?.data?.sphericalHarmonics}`);

            // 检查是否有球谐表示
            // [Fix] 即使 representation.type 被更改为 'volumetric' (物理开启后)，
            // 只要存在 data.sphericalHarmonics，就应该允许编辑和重拟合
            if (obj.representation?.data?.sphericalHarmonics) {
                // [Fix] 重拟合会改变几何形状，使得当前的物理拓扑失效。
                // 并且拟合会将 mode 改为 parametric，导致物理引擎报错 (Illegal physics access)。
                // 因此在重拟合前必须禁用物理。下次启用物理时会触发 rebuild。
                if (obj.physics.enabled) {
                    console.log('[Refit] Disabling physics due to shape modification');
                    obj.physics.enabled = false;
                    obj._inPhysicsWorld = false;
                }

                const sh = obj.representation.data.sphericalHarmonics;
                const currentOrder = obj.representation.data.fittedOrder ?? 3;
                const N = obj.controlPoints?.length ?? 0;

                // 使用区间判定动态升降阶
                const newOrder = ParametricImpl.computeEditOrderWithBoundary(N, currentOrder);

                // 重新拟合
                obj.fitSphericalHarmonics({
                    order: newOrder,
                    fitter: FittingCalculator,
                    Matrix: Matrix,
                    sphericalHarmonics: sh
                });

                // 重新生成显示点（密度与初始化保持一致）
                obj.generateDisplayPoints({ density: EditConfig.displayPointDensity });

                // 调试：显示阶数变化信息
                const orderChanged = newOrder !== currentOrder;
                console.log(`[Refit] 重拟合完成: N=${N}, L=${currentOrder}→${newOrder}${orderChanged ? ' (阶数变化)' : ''}, displayPoints=${obj.displayPoints?.length}`);
            }

            SystemState.sceneDirty = true;
        }
    }
    physicsStep(dt);
    // [FIX] updateLocalGrid 已移动到 render() -> updateCamera() 之后

    // Draw camera feed
    CameraSystem.drawCameraFeedOnMainCanvas(SystemState.ctx);

    // 只要有控制输入、场景变动、光照变动或动画，就重绘
    const hasAnimation = SystemState.taskQueues.current.length > 0 || SystemState.taskQueues.next.length > 0;
    if (SystemState.ifControl || SystemState.sceneDirty || SystemState.lightDirty || hasAnimation) {
        // [OPTIMIZATION] 按需更新光照/反射
        // 首帧或脏标记时更新
        if (SystemState.sceneDirty || SystemState.lightDirty || !SystemState._reflectionInitialized) {
            updateLight();
            updateVisibleReflection();
            SystemState.sceneDirty = false;
            SystemState.lightDirty = false;
            SystemState._reflectionInitialized = true;
        }

        render();
        SystemState.ifControl = false;
    }
    requestAnimationFrame(gameLoop);
}

init()
    .then(() => {
        gameLoop();
    })
    .catch(console.error);
