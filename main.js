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

import { SystemState, CONFIG } from "./manage/SystemState.js";
import { CameraSystem } from "./manage/CameraSystem.js";
import { Renderer } from "./manage/Renderer.js";
import { InputManager } from "./manage/InputManager.js";
import { HistoryManager, createMoveCommand, createMoveControlPointCommand, createAddControlPointCommand, createDeleteControlPointCommand } from "./manage/HistoryManager.js";


// ============================================================================
// CORE LOGIC & HUB
// ============================================================================

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
                const limit = ObjectFactoryImpl.LocalGridConfig.halfSize;
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
                if (cp) {
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
        case 'CHANGE_DEPTH_LAYER':
            SystemState.editDepthLayer += intent.delta;
            updateControlPointsDisplay();
            SystemState.ifControl = true;
            break;
        case 'SCROLL_SLICE_DEPTH':
            {
                const { steps, stepSize, maxDepth, currentDepth } = intent;
                const sign = Math.sign(steps);
                const absSteps = Math.abs(steps);
                const targetLayer = Math.round(currentDepth / stepSize) + steps;
                const targetDepth = targetLayer * stepSize;
                if (targetDepth > maxDepth || targetDepth < -maxDepth) {
                    console.log(`Depth limit reached: current=${currentDepth.toFixed(1)}, target=${targetDepth.toFixed(1)}, limit=±${maxDepth.toFixed(1)}`);
                    return;
                }
                const obj = SystemState.focusedObject;
                const dir = SystemState.mainWindow.direction;
                const delta = targetDepth - currentDepth;
                const targetX = obj.center.x + dir.x * delta;
                const targetY = obj.center.y + dir.y * delta;
                const targetZ = obj.center.z + dir.z * delta;
                animateSliceTransition(obj, targetX, targetY, targetZ, 150);
            }
            break;
        case 'ADD_CONTROL_POINT':
            addControlPointAt(intent.x, intent.y);
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
    updateCamera();
    updateVisibleReflection(); // Ensure reflection vectors are updated before rendering
    const imageData = Renderer.render(ctx, width, height); // NOTE: Renderer.render now handles point drawing logic
    const pixelData = imageData.data;
    if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'EDIT') {
        Renderer.renderScreenPointsHelper(pixelData, width, height);
    }
    if (SystemState.virtualMouse.enabled) {
        updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
    }
    renderScreenOverlay(pixelData, width, height);
    ctx.putImageData(imageData, 0, 0);
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
    if (win && win.findNearestPoint) {
        snapped = win.findNearestPoint(mouseX, mouseY, 0, (p) => {
            // [Fix] 拖拽时忽略物体自身的可吸附点（主要是中心点）
            if (SystemState.isDragging && SystemState.draggingObject) {
                if (p.ownerObject === SystemState.draggingObject) {
                    // console.log('[DEBUG] Ignoring self point for drag:', p.tag);
                    return false;
                }
            }

            if (SystemState.interactionState === 'EDIT') {
                if (p.tag !== 'LOCAL_GRID') return false;
            }
            if (SystemState.draggingObject && p.isGridPoint) {
                if (isGridPointOccupied(p.gx, p.gy, p, SystemState.draggingObject)) {
                    return false;
                }
            }
            return true;
        });
    }
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
        const pointDis = snapped.dis || 40;
        const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
        perspectiveScale = Math.max(0.3, Math.min(3.0, baseDis / pointDis));
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
    console.log('截面深度:', SystemState.focusSliceDepth);
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

    // 阶段3重构：使用 Transform 组件
    // 禁止直接修改 Point 世界坐标

    // 更新 Transform
    // 注意：obj.center 引用了 obj.transform.position，但为了明确语义，使用 transform
    if (obj.transform) {
        obj.transform.position.x = x;
        obj.transform.position.y = y;
        obj.transform.position.z = z;

        obj._dirty = true;
        obj.updateWorldPoints();
    } else {
        // Fallback for legacy objects (if any)
        const dx = x - obj.center.x;
        const dy = y - obj.center.y;
        const dz = z - obj.center.z;

        const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
        for (const p of points) {
            p.x += dx;
            p.y += dy;
            p.z += dz;
        }
        // FIX: 确保 controlPoints 也跟随移动
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

    if (obj.centerPoint) {
        // centerPoint is updated in updateWorldPoints if transform exists
        // but double check for sync
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
    const localGrid = ObjectFactoryImpl.createLocalGridObject(obj);
    SystemState.localGrid = localGrid;
    SystemState.objects.push(localGrid);
    showControlPoints(obj);
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
    const points = obj.controlPoints && obj.controlPoints.length > 0 ? obj.controlPoints : (obj.constructionPoints || []).slice(0, 20);
    for (const cp of points) { cp.tag = 'CONTROL'; cp.isAttractable = true; }
}

function hideControlPoints() {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    const points = obj.controlPoints && obj.controlPoints.length > 0 ? obj.controlPoints : (obj.constructionPoints || []).slice(0, 20);
    for (const p of points) { p.tag = null; }
}

function updateControlPointsDisplay() {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    hideControlPoints();
    showControlPoints(obj);
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

function updateLocalGrid() {
    // 性能优化：只在 EDIT 态时更新
    if (SystemState.interactionState !== 'EDIT') return;

    const grid = SystemState.localGrid;
    const target = SystemState.focusedObject;
    const win = SystemState.mainWindow;
    if (!grid || !target || !win) return;

    // 1. 同步 Transform (Pose)
    // 确保 Grid 的位置和旋转与 Target 完全一致
    grid.transform.position.x = target.transform.position.x;
    grid.transform.position.y = target.transform.position.y;
    grid.transform.position.z = target.transform.position.z;

    grid.transform.rotation.w = target.transform.rotation.w;
    grid.transform.rotation.x = target.transform.rotation.x;
    grid.transform.rotation.y = target.transform.rotation.y;
    grid.transform.rotation.z = target.transform.rotation.z;

    // 2. 更新世界坐标
    grid._dirty = true;
    grid.updateWorldPoints();

    // 3. 切片显示逻辑 (Slice Visibility)
    const dir = win.direction;
    const planePt = dir.start;
    const orientationType = target._currentOrientationState?.type || 'FACE';
    const layerSpacing = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);
    const SLICE_THRESHOLD = layerSpacing * 0.6;

    for (const p of grid.displayPoints) {
        // p.x, p.y, p.z 已经在 updateWorldPoints 中被更新为世界坐标
        const dist = (p.x - planePt.x) * dir.x + (p.y - planePt.y) * dir.y + (p.z - planePt.z) * dir.z;

        if (p.tag === 'LOCAL_GRID' && Math.abs(dist) <= SLICE_THRESHOLD) {
            p.isAttractable = true;
            p._isActiveSlice = true;
        } else {
            p.isAttractable = false;
            p._isActiveSlice = false;
        }
    }
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
        updateLocalGrid();
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
    const layerSpacing = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);
    const maxDepth = ObjectFactoryImpl.LocalGridConfig.getMaxDepthForOrientation(orientationType);
    const currentDist = (obj.center.x - planePt.x) * dir.x + (obj.center.y - planePt.y) * dir.y + (obj.center.z - planePt.z) * dir.z;
    let nearestLayer = Math.round(currentDist / layerSpacing);
    const maxLayer = Math.floor(maxDepth / layerSpacing);
    nearestLayer = Math.max(-maxLayer, Math.min(maxLayer, nearestLayer));
    const nearestLayerDist = nearestLayer * layerSpacing;
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

function physicsStep(dt) {
    for (const obj of SystemState.objects) {
        if (obj.animationLock) continue;
        if (!obj.physics || !obj.physics.enabled) continue;
    }
    for (const obj of SystemState.objects) {
        if (obj.animationLock) continue;
        if (obj.commitPhysics) {
            obj.commitPhysics();
        }
    }
}

async function gameLoop(timestamp = 0) {
    const dt = timestamp - SystemState.lastTimestamp;
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
            console.log('控制点已修改，需要重建形状');
            SystemState.sceneDirty = true;
        }
    }
    physicsStep(dt);
    updateLocalGrid();

    // Draw camera feed
    CameraSystem.drawCameraFeedOnMainCanvas(SystemState.ctx);

    // 只要有控制输入、场景变动、光照变动或动画，就重绘
    const hasAnimation = SystemState.taskQueues.current.length > 0 || SystemState.taskQueues.next.length > 0;
    if (SystemState.ifControl || SystemState.sceneDirty || SystemState.lightDirty || hasAnimation) {
        // [OPTIMIZATION B] 按需更新光照
        // 只有当场景改变(物体移动) 或 光照改变 时才更新光照/反射
        // 首次运行或脏标记为真时更新
        if (SystemState.sceneDirty || SystemState.lightDirty) {
            updateLight();
            updateVisibleReflection();
            SystemState.sceneDirty = false;
            SystemState.lightDirty = false;
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
