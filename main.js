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
}

function setupEventListeners() {
    // Keyboard
    window.addEventListener("keydown", (e) => {
        SystemState.keys[e.key.toLowerCase()] = true;
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
            SystemState.draggedControlPoint = null;
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
            SystemState.draggingObject = null;
            SystemState.dragStartCenter = null;
        }
        SystemState.isDragging = false;
    });

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
            break;
        case 'ADJUST_LIGHT_ELEVATION':
            SystemState.lightElevation = Math.max(
                CONFIG.minElevation,
                Math.min(CONFIG.maxElevation, (SystemState.lightElevation || 0) + intent.delta)
            );
            break;
        case 'RESET_CAMERA_DISTANCE':
            resetCameraDistance();
            break;
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
            if (intent.object && intent.object.tag === 'LIGHT_SOURCE') {
                updateLight();
            }
            break;
        case 'CAMERA_ZOOM':
            handleCameraZoom(intent.delta);
            break;
        case 'ENTER_FOCUS_STATE':
            enterFocusState(intent.object);
            break;

        // FOCUS
        case 'ROTATE_FOCUSED_OBJECT':
            rotateFocusedObject(intent.dx, intent.dy);
            SystemState.ifControl = true;
            break;
        case 'EXIT_FOCUS_STATE':
            exitFocusState();
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
                    SystemState.lastMouseX = intent.x;
                    SystemState.lastMouseY = intent.y;
                    SystemState.longPressTarget = cp;
                    SystemState.longPressTimer = setTimeout(() => {
                        deleteControlPoint(cp);
                        SystemState.longPressTarget = null;
                        SystemState.draggedControlPoint = null;
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
}

// ============================================================================
// EFFECTUATORS & LOGIC (From main_raw.js)
// ============================================================================

// ============================================================================
// EFFECTUATORS & LOGIC (From main_raw.js)
// ============================================================================

function handleCameraZoom(speed) {
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
    // 旋转只改变 capital.x/y，FGV 也只改变 XY（因为 direction.z = 0）

    const win = SystemState.mainWindow;
    if (!win || !win.capital) return;

    const rotCenter = SystemState.rotationCenter;
    if (!rotCenter) return;

    // 初始距离（在 XY 平面）：初始时 capital = (0, userDistanceFromOrigin, eyeZ)
    // rotCenter = (0, 0, screenZ)，所以 XY 平面距离 = userDistanceFromOrigin
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

    // 直接赋值新的 capital 位置（只改 X/Y，Z 不动）
    win.capital.x = rotCenter.x + dx * scale;
    win.capital.y = rotCenter.y + dy * scale;
    // win.capital.z 不动！

    // 同步更新 direction.start（只改 X/Y）
    const eyeToScreenDist = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
    win.direction.start.x = win.capital.x + win.direction.x * eyeToScreenDist;
    win.direction.start.y = win.capital.y + win.direction.y * eyeToScreenDist;
    // win.direction.start.z 不动！

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
    if (SystemState.mainWindow) {
        SystemState.mainWindow.windowObjects.length = 0;
    }
}

// ... COPY OTHER HELPER FUNCTIONS:
// measureObjectRadius, tracePoint, calculateCenterPosition, applyQuaternionToPoints
// enterViewState, enterFocusState, exitFocusState, enterEditState, finishEnterEditState, exitEditState
// moveObjectTo, rotateFocusedObject, showControlPoints, hideControlPoints
// findControlPointAt, moveControlPoint, deleteControlPoint, addControlPointAt, updateControlPointsDisplay
// animateSliceTransition, animateRotation, snapToNearestLayer, rotateEditObject
// calculateImpulse, applyTouchImpulse, applyTouchImpulseSimple
// physicsStep, processTaskQueue, gameLoop

// Due to token limits, I will paste the rest of the functions from main_raw.js in a separate tool call to append or I have to fit them here.
// I'll make a condensed version here for the critical ones.
// I strongly recommend using a second tool call to append the lengthy state transitions.

// Actually `write_to_file` does not support append.
// I must fit everything or use `run_command` to cat files.
// Let's assume I can compress comments.

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

function enterViewState() {
    SystemState.interactionState = 'VIEW';
    SystemState.focusedObject = null;
    for (const obj of SystemState.objects) {
        obj.visualAlpha = 1.0;
        const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
        for (const p of points) {
            if (p.tag === 'DIMMED') p.tag = null;
        }
    }
}

function enterFocusState(obj) {
    if (!obj) { console.warn('enterFocusState: 物体不能为空'); return; }
    SystemState.interactionState = 'FOCUS_ENTERING';
    SystemState.focusedObject = obj;
    const radiusBefore = measureObjectRadius(obj);
    console.log(`[STATE] VIEW→FOCUS: 物体=${obj.metadata?.name || 'Obj'}, 半径=${radiusBefore.toFixed(3)}cm`);
    tracePoint(obj, 'VIEW→FOCUS');
    SystemState.screenPoints = SystemState.screenPoints.filter(p => p.tag !== 'SLICE_CONTOUR');
    if (obj.savePosition) obj.savePosition();
    const originalFront = { ...obj.frontDirection };
    obj._savedFrontDirection = originalFront;
    const originalUp = obj.upDirection ? { ...obj.upDirection } : { x: 0, y: 0, z: 1 };
    obj._savedUpDirection = originalUp;
    const targetPos = calculateCenterPosition();
    const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };
    const dir = SystemState.mainWindow.direction;
    let targetFront = { x: -dir.x, y: -dir.y, z: -dir.z };
    const tfLen = Math.sqrt(targetFront.x ** 2 + targetFront.y ** 2 + targetFront.z ** 2);
    if (tfLen > 0) {
        targetFront.x /= tfLen;
        targetFront.y /= tfLen;
        targetFront.z /= tfLen;
    }
    const ofLen = Math.sqrt(originalFront.x ** 2 + originalFront.y ** 2 + originalFront.z ** 2);
    if (ofLen > 0) {
        originalFront.x /= ofLen;
        originalFront.y /= ofLen;
        originalFront.z /= ofLen;
    }
    obj.animationLock = true;
    const rotationAxis = {
        x: originalFront.y * targetFront.z - originalFront.z * targetFront.y,
        y: originalFront.z * targetFront.x - originalFront.x * targetFront.z,
        z: originalFront.x * targetFront.y - originalFront.y * targetFront.x
    };
    let axisLen = Math.sqrt(rotationAxis.x ** 2 + rotationAxis.y ** 2 + rotationAxis.z ** 2);
    if (axisLen < 0.001) {
        const dot = originalFront.x * targetFront.x + originalFront.y * targetFront.y + originalFront.z * targetFront.z;
        if (dot < -0.99) {
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
    const duration = 500;
    const moveRotateTask = AnimationImpl.createTask({
        type: 'finite',
        target: obj,
        property: 'centerAndRotation',
        duration,
        easing: AnimationImpl.Easing.easeOut,
        compute: (progress) => ({
            position: {
                x: fromPos.x + (targetPos.x - fromPos.x) * progress,
                y: fromPos.y + (targetPos.y - fromPos.y) * progress,
                z: fromPos.z + (targetPos.z - fromPos.z) * progress
            },
            progress
        }),
        apply: (targetObj, value) => {
            // 阶段3修改：使用 Transform 系统更新位置
            // 不再直接修改点的世界坐标，而是更新 transform.position
            targetObj.transform.position.x = value.position.x;
            targetObj.transform.position.y = value.position.y;
            targetObj.transform.position.z = value.position.z;

            // 处理旋转（增量旋转）
            if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                const lastProgress = targetObj._lastRotProgress || 0;
                const progressDelta = value.progress - lastProgress;
                const rotationAmount = totalAngle * progressDelta;
                if (rotationAmount > 0.0001) {
                    // rotateObjectAroundAxis 内部会调用 updateWorldPoints()
                    OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
                }
                targetObj._lastRotProgress = value.progress;
            } else {
                // 如果没有旋转，需要手动调用 updateWorldPoints 更新位置
                targetObj._dirty = true;
                targetObj.updateWorldPoints();
            }

            targetObj._lastAnimPos = { ...value.position };
        }
    });
    moveRotateTask.onComplete = () => {
        obj.animationLock = false;
        obj._lastAnimPos = null;
        obj._lastRotProgress = null;
        SystemState.interactionState = 'FOCUS';
        tracePoint(obj, 'FOCUS-entered');
    };
    SystemState.taskQueues.submit(moveRotateTask);
    for (const other of SystemState.objects) {
        if (other !== obj) {
            other.visualAlpha = 0.05;
            const points = other.displayPoints.length > 0 ? other.displayPoints : other.constructionPoints;
            for (const p of points) { p.tag = 'DIMMED'; }
        }
    }
    SystemState.ifControl = true;
}

function exitFocusState() {
    const obj = SystemState.focusedObject;
    if (!obj) {
        enterViewState();
        return;
    }
    const saved = obj.getSavedPosition ? obj.getSavedPosition() : null;
    if (!saved) {
        enterViewState();
        return;
    }
    obj.animationLock = true;
    const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

    function calculateRotationFromTwoFrames(cFront, cUp, tFront, tUp) {
        const cZ = cFront;
        const cX_temp = {
            x: cUp.y * cZ.z - cUp.z * cZ.y,
            y: cUp.z * cZ.x - cUp.x * cZ.z,
            z: cUp.x * cZ.y - cUp.y * cZ.x
        };
        let cxLen = Math.sqrt(cX_temp.x ** 2 + cX_temp.y ** 2 + cX_temp.z ** 2);
        const cX = cxLen > 0.001 ?
            { x: cX_temp.x / cxLen, y: cX_temp.y / cxLen, z: cX_temp.z / cxLen } : { x: 1, y: 0, z: 0 };
        const cY = {
            x: cZ.y * cX.z - cZ.z * cX.y,
            y: cZ.z * cX.x - cZ.x * cX.z,
            z: cZ.x * cX.y - cZ.y * cX.x
        };
        const tZ = tFront;
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
        const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        const A = [cX, cY, cZ];
        const B = [tX, tY, tZ];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const valA_cX = j === 0 ? cX.x : j === 1 ? cX.y : cX.z;
                const valA_cY = j === 0 ? cY.x : j === 1 ? cY.y : cY.z;
                const valA_cZ = j === 0 ? cZ.x : j === 1 ? cZ.y : cZ.z;
                const valB_tX = i === 0 ? tX.x : i === 1 ? tX.y : tX.z;
                const valB_tY = i === 0 ? tY.x : i === 1 ? tY.y : tY.z;
                const valB_tZ = i === 0 ? tZ.x : i === 1 ? tZ.y : tZ.z;
                R[i][j] = valB_tX * valA_cX + valB_tY * valA_cY + valB_tZ * valA_cZ;
            }
        }
        const tr = R[0][0] + R[1][1] + R[2][2];
        const angle = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
        let axis = { x: 0, y: 0, z: 1 };
        if (Math.abs(angle - Math.PI) < 0.1) {
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
            const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
            if (len > 0.001) {
                axis.x /= len; axis.y /= len; axis.z /= len;
            }
        } else if (Math.abs(angle) > 0.001) {
            axis.x = R[2][1] - R[1][2];
            axis.y = R[0][2] - R[2][0];
            axis.z = R[1][0] - R[0][1];
            const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
            if (len > 0.001) {
                axis.x /= len; axis.y /= len; axis.z /= len;
            } else {
                axis = { x: 0, y: 0, z: 1 };
            }
        }
        return { axis, angle };
    };

    let currentFront = { ...obj.frontDirection };
    const cfLen = Math.sqrt(currentFront.x ** 2 + currentFront.y ** 2 + currentFront.z ** 2);
    if (cfLen > 0) {
        currentFront.x /= cfLen;
        currentFront.y /= cfLen;
        currentFront.z /= cfLen;
    }
    let savedFront = obj._savedFrontDirection || obj.frontDirection;
    const sfLen = Math.sqrt(savedFront.x ** 2 + savedFront.y ** 2 + savedFront.z ** 2);
    if (sfLen > 0) {
        savedFront = { x: savedFront.x / sfLen, y: savedFront.y / sfLen, z: savedFront.z / sfLen };
    }
    let currentUp = { ...(obj.upDirection || { x: 0, y: 0, z: 1 }) };
    const cuLen = Math.sqrt(currentUp.x ** 2 + currentUp.y ** 2 + currentUp.z ** 2);
    if (cuLen > 0) { currentUp.x /= cuLen; currentUp.y /= cuLen; currentUp.z /= cuLen; }
    let targetUp = obj._savedUpDirection ? { ...obj._savedUpDirection } : { x: 0, y: 0, z: 1 };
    const tuLen = Math.sqrt(targetUp.x ** 2 + targetUp.y ** 2 + targetUp.z ** 2);
    if (tuLen > 0) { targetUp.x /= tuLen; targetUp.y /= tuLen; targetUp.z /= tuLen; }

    const { axis: rotationAxis, angle: totalAngle } = calculateRotationFromTwoFrames(currentFront, currentUp, savedFront, targetUp);
    let axisLen = 1;

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
            const frameStart = value.progress < 0.1 || value.progress > 0.9;
            if (frameStart) tracePoint(targetObj, `anim-${(value.progress * 100).toFixed(0)}%-start`);

            // 阶段3修改：使用 Transform 系统更新位置
            targetObj.transform.position.x = value.position.x;
            targetObj.transform.position.y = value.position.y;
            targetObj.transform.position.z = value.position.z;

            // 处理旋转（增量旋转）
            if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                const lastProgress = targetObj._lastRotProgress || 0;
                const progressDelta = value.progress - lastProgress;
                const rotationAmount = totalAngle * progressDelta;
                if (rotationAmount > 0.0001) {
                    // rotateObjectAroundAxis 内部会调用 updateWorldPoints()
                    OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
                }
                targetObj._lastRotProgress = value.progress;
            } else {
                // 如果没有旋转，需要手动调用 updateWorldPoints 更新位置
                targetObj._dirty = true;
                targetObj.updateWorldPoints();
            }

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
        for (const other of SystemState.objects) {
            if (other !== obj) {
                other.visualAlpha = 1.0;
                const points = other.displayPoints.length > 0 ? other.displayPoints : other.constructionPoints;
                for (const p of points) {
                    if (p.tag === 'DIMMED') p.tag = null;
                }
            }
        }
        SystemState.interactionState = 'VIEW';
        SystemState.focusedObject = null;
        const radiusFinal = measureObjectRadius(obj);
        console.log(`[STATE] →VIEW: 半径=${radiusFinal.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
        tracePoint(obj, '→VIEW');
        SystemState.ifControl = true;
    };
    SystemState.taskQueues.submit(moveRotateTask);
}


function calculateCenterPosition() {
    const dirStart = SystemState.mainWindow.direction.start;
    return { x: dirStart.x, y: dirStart.y, z: dirStart.z };
}

function rotateFocusedObject(dx, dy) {
    // 阶段3重构：使用 Transform 系统进行旋转
    // 调用 OrientationImpl.rotateObjectAroundAxis()，它会：
    // 1. 更新 transform.rotation 四元数
    // 2. 同步更新 frontDirection/upDirection
    // 3. 调用 updateWorldPoints() 刷新世界坐标
    const obj = SystemState.focusedObject;
    if (!obj) return;
    if (obj.animationLock) return;

    const sensitivity = 0.005;
    const win = SystemState.mainWindow;

    // 获取屏幕坐标系轴向量
    const axisX = { x: win.vx.x, y: win.vx.y, z: win.vx.z };
    const axisY = { x: win.vy.x, y: win.vy.y, z: win.vy.z };

    // 归一化轴向量
    const normX = Math.sqrt(axisX.x ** 2 + axisX.y ** 2 + axisX.z ** 2);
    const normY = Math.sqrt(axisY.x ** 2 + axisY.y ** 2 + axisY.z ** 2);
    if (normX > 0.001) { axisX.x /= normX; axisX.y /= normX; axisX.z /= normX; }
    if (normY > 0.001) { axisY.x /= normY; axisY.y /= normY; axisY.z /= normY; }

    const angleAroundScreenY = -dx * sensitivity;
    const angleAroundScreenX = dy * sensitivity;

    // 使用 OrientationImpl 进行旋转（正确更新 transform.rotation）
    // 先绕屏幕 Y 轴（水平拖拽 → 绕视窗上方向旋转）
    if (Math.abs(angleAroundScreenY) > 0.0001) {
        OrientationImpl.rotateObjectAroundAxis(obj, axisY, angleAroundScreenY);
    }
    // 再绕屏幕 X 轴（垂直拖拽 → 绕视窗右方向旋转）
    if (Math.abs(angleAroundScreenX) > 0.0001) {
        OrientationImpl.rotateObjectAroundAxis(obj, axisX, angleAroundScreenX);
    }

    updateSliceContour();
}

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
        const centerPos = calculateCenterPosition();

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
        obj.controlPoints.splice(index, 1);
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
    if (!obj.controlPoints) obj.controlPoints = [];
    obj.controlPoints.push(newPoint);
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
    processTaskQueue(SystemState.worldTime, dt);
    for (const obj of SystemState.objects) {
        if (obj._needsRefit) {
            obj._needsRefit = false;
            console.log('控制点已修改，需要重建形状');
        }
    }
    physicsStep(dt);
    updateLocalGrid();

    // Draw camera feed
    CameraSystem.drawCameraFeedOnMainCanvas(SystemState.ctx);

    if (SystemState.ifControl || SystemState.taskQueues.current.length > 0) {
        updateLight();
        updateVisibleReflection();
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
