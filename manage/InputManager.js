import { SystemState, CONFIG } from "./SystemState.js";
import * as CursorSystem from "./CursorSystem.js";
import { OrientationImpl } from "./OrientationImpl.js";
import { AnimationImpl } from "./AnimationImpl.js";
import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js";
import { Point } from "../base/Point.js";
import { Vector } from "../base/Vector.js";

// =====================================================
// InputManager: 处理所有输入事件与状态交互逻辑
// =====================================================

// --- Helper: Debug Tracing ---
function tracePoint(obj, label) {
    if (SystemState.debugMode) {
        console.log(`[Trace] ${label}:`, obj.center);
    }
}

function measureObjectRadius(obj) {
    if (!obj.displayPoints || obj.displayPoints.length === 0) return 0;
    let maxR = 0;
    for (const p of obj.displayPoints) {
        const dx = p.x - obj.center.x;
        const dy = p.y - obj.center.y;
        const dz = p.z - obj.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (r > maxR) maxR = r;
    }
    return maxR;
}

// ========================
// 1. 事件监听初始化
// ========================

export function setupEventListeners() {
    window.addEventListener("keydown", (e) => {
        if (e.key) SystemState.keys[e.key.toLowerCase()] = true;
        onInputEvent("onKeyDown", e);
    });
    window.addEventListener("keyup", (e) => {
        if (e.key) SystemState.keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener("mousedown", (e) => onInputEvent("onMouseDown", e));
    window.addEventListener("mousemove", (e) => onInputEvent("onMouseMove", e));
    window.addEventListener("mouseup", (e) => {
        SystemState.isMouseDown = false;
        SystemState.draggingObject = null;
        SystemState.isDragging = false;
        if (SystemState.draggedControlPoint) {
            SystemState.draggedControlPoint = null;
        }
        if (SystemState.longPressTimer) {
            clearTimeout(SystemState.longPressTimer);
            SystemState.longPressTimer = null;
        }
    });
    window.addEventListener("click", (e) => onInputEvent("onClick", e));
    window.addEventListener("wheel", (e) => {
        onInputEvent("onWheel", e);
        if (SystemState.interactionState === 'EDIT') {
            onInputEvent("onWheelSliceDepth", e);
        }
    }, { passive: false });
}

function onInputEvent(handlerName, event) {
    const map = InputMaps[SystemState.interactionState];
    if (map && map[handlerName]) {
        map[handlerName](event);
    }
}

// ========================
// 2. 连续输入处理 (Main Loop Call)
// ========================
export function handleInput() {
    const map = InputMaps[SystemState.interactionState];
    if (map && map.onContinuousInput) {
        map.onContinuousInput();
    }
}

// ========================
// 3. Input Maps
// ========================
export const InputMaps = {
    VIEW: {
        onContinuousInput: () => handleViewContinuousInput(),
        onKeyDown: (e) => handleViewKeyDown(e),
        onMouseDown: (e) => handleViewMouseDown(e),
        onMouseMove: (e) => handleViewMouseMove(e),
        onWheel: (e) => handleViewWheel(e),
        onClick: (e) => handleViewClick(e)
    },
    FOCUS: {
        onContinuousInput: () => handleFocusEdgeRotation(),
        onKeyDown: (e) => handleFocusKeyDown(e),
        onMouseDown: (e) => handleFocusMouseDown(e),
        onMouseMove: (e) => { }, // No op
        onWheel: (e) => handleFocusWheel(e),
        onClick: (e) => handleFocusClick(e)
    },
    FOCUS_ENTERING: {
        onContinuousInput: () => handleFocusEnteringContinuousInput(),
        onKeyDown: () => { },
        onMouseDown: () => { },
        onMouseMove: () => { },
        onWheel: () => { },
        onClick: () => { }
    },
    EDIT: {
        onContinuousInput: () => handleEditContinuousInput(),
        onKeyDown: (e) => handleEditKeyDown(e),
        onMouseDown: (e) => handleEditMouseDown(e),
        onMouseMove: (e) => handleEditMouseMove(e),
        onWheel: (e) => handleEditWheel(e),
        onClick: (e) => handleEditClick(e),
        onWheelSliceDepth: (e) => handleEditWheelSliceDepth(e)
    }
};

// ========================
// 4. Handlers
// ========================

// --- VIEW State ---

function handleViewContinuousInput() {
    const speed = CONFIG.moveSpeed;
    const rotSpeed = 0.05;

    if (SystemState.keys['w']) {
        const dir = SystemState.mainWindow.direction;
        SystemState.mainWindow.capital.x += dir.x * speed;
        SystemState.mainWindow.capital.y += dir.y * speed;
        SystemState.mainWindow.capital.z += dir.z * speed;
        dir.start.x += dir.x * speed;
        dir.start.y += dir.y * speed;
        dir.start.z += dir.z * speed;
        SystemState.ifControl = true;
    }
    if (SystemState.keys['s']) {
        const dir = SystemState.mainWindow.direction;
        SystemState.mainWindow.capital.x -= dir.x * speed;
        SystemState.mainWindow.capital.y -= dir.y * speed;
        SystemState.mainWindow.capital.z -= dir.z * speed;
        dir.start.x -= dir.x * speed;
        dir.start.y -= dir.y * speed;
        dir.start.z -= dir.z * speed;
        SystemState.ifControl = true;
    }

    if (SystemState.keys['a']) userRotate(rotSpeed);
    if (SystemState.keys['d']) userRotate(-rotSpeed);
}

function handleViewKeyDown(e) {
    if (e.key === 'r') resetCameraDistance();
}

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

function handleViewMouseMove(e) {
    if (SystemState.draggingObject) {
        const snapped = SystemState.virtualMouse.snappedTo;
        if (snapped && snapped.isGridPoint) {
            moveObjectTo(SystemState.draggingObject, snapped.x, snapped.y, snapped.z);
        }
    } else if (SystemState.isDragging) {
        // Camera Rotation
        const dx = e.clientX - SystemState.lastMouseX;
        const dy = e.clientY - SystemState.lastMouseY;

        // Horizontal rotation (around Z, but effectively userRotate logic)
        if (dx !== 0) {
            userRotate(dx * CONFIG.dragRotationSpeed);
        }

        // Vertical rotation (Elevation) - Simplified
        // Note: Full constrained elevation logic might need more code,
        // but for now we'll support horizontal at least.

        SystemState.ifControl = true;
    }
    SystemState.lastMouseX = e.clientX;
    SystemState.lastMouseY = e.clientY;
}

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

function handleViewClick(e) {
    const now = Date.now();
    const snapped = SystemState.virtualMouse.snappedTo;
    const target = (snapped && snapped.isObjectCenter && snapped.ownerObject)
        ? snapped.ownerObject
        : null;

    if (target && target === SystemState.lastClickTarget && now - SystemState.lastClickTime < 300) {
        enterFocusState(target);
    }

    SystemState.lastClickTime = now;
    SystemState.lastClickTarget = target;
}

// --- FOCUS State ---

export function handleFocusEdgeRotation() {
    const x = SystemState.lastMouseX;
    const y = SystemState.lastMouseY;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const edgeThreshold = 20;

    const atLeft = x < edgeThreshold;
    const atRight = x > width - edgeThreshold;
    const atTop = y < edgeThreshold;
    const atBottom = y > height - edgeThreshold;

    const isAtEdge = atLeft || atRight || atTop || atBottom;
    const rotState = SystemState.focusRotationState;

    if (isAtEdge) {
        const h = atRight ? 1 : (atLeft ? -1 : 0);
        const v = atTop ? 1 : (atBottom ? -1 : 0);

        if (!rotState.isAtEdge || rotState.edgeDirection.h !== h || rotState.edgeDirection.v !== v) {
            rotState.edgeStartTime = Date.now();
            rotState.edgeDirection = { h, v };
        }
        rotState.isAtEdge = true;

        const elapsed = (Date.now() - rotState.edgeStartTime) / 1000;
        const speedFactor = 1 - Math.exp(-3.0 * elapsed);
        const maxSpeed = 0.03;

        const hSpeed = h * speedFactor * maxSpeed;
        const vSpeed = v * speedFactor * maxSpeed;

        if (hSpeed !== 0 || vSpeed !== 0) {
            rotateFocusedObject(hSpeed * 100, vSpeed * 100);
            SystemState.ifControl = true;
        }
    } else {
        rotState.isAtEdge = false;
        rotState.edgeStartTime = 0;
        rotState.edgeDirection = { h: 0, v: 0 };
    }
}

function handleFocusKeyDown(e) {
    if (e.key === 'Escape') {
        exitFocusState();
        return;
    }

    if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key)) return;

    const obj = SystemState.focusedObject;
    if (!obj) return;

    if (OrientationImpl) {
        OrientationImpl.transition(e.key, obj, SystemState.mainWindow.direction, animateRotation);
    }
}

function handleFocusMouseDown(e) {
    if (e.button === 0) {
        SystemState.isDragging = true;
        SystemState.lastMouseX = e.clientX;
        SystemState.lastMouseY = e.clientY;

        if (SystemState.virtualMouse.snappedTo && SystemState.virtualMouse.snappedTo.tag === 'CHARGE') {
            const p = SystemState.virtualMouse.snappedTo;
            if (p.charge > 0.5) SystemState.chargeHitPoint = p;
            applyTouchImpulse(p.charge);
        }
    }
}

function handleFocusWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.5 : -0.5;
    SystemState.focusSliceDepth += delta;
    SystemState.focusVirtualMouseDepth += delta;
    updateSliceContour();
    SystemState.ifControl = true;
}

function handleFocusClick(e) {
    const now = Date.now();
    if (SystemState.lastClickTarget === 'focus_click' && now - SystemState.lastClickTime < 300) {
        enterEditState();
    }
    SystemState.lastClickTime = now;
    SystemState.lastClickTarget = 'focus_click';
}

function handleFocusEnteringContinuousInput() { }

// --- EDIT State ---

function handleEditContinuousInput() {
    const speed = 0.5;
    const rotSpeed = 0.02;

    if (SystemState.keysPressed['w']) rotateFocusedObject(0, -speed);
    if (SystemState.keysPressed['s']) rotateFocusedObject(0, speed);
    if (SystemState.keysPressed['a']) rotateFocusedObject(-speed, 0);
    if (SystemState.keysPressed['d']) rotateFocusedObject(speed, 0);
    if (SystemState.keysPressed['q']) rotateFocusedObject(0, 0, -rotSpeed);
    if (SystemState.keysPressed['e']) rotateFocusedObject(0, 0, rotSpeed);
}

function handleEditKeyDown(e) {
    if (e.key === 'Escape') exitEditState();
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (SystemState.draggedControlPoint) {
            deleteControlPoint(SystemState.draggedControlPoint);
            SystemState.draggedControlPoint = null;
        }
    }
}

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

function handleEditWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    SystemState.editDepthLayer += delta;
    updateControlPointsDisplay();
    SystemState.ifControl = true;
}

function handleEditWheelSliceDepth(e) {
    e.preventDefault();
    const obj = SystemState.focusedObject;
    if (!obj) return;

    if (typeof SystemState._scrollAccumulator === 'undefined') SystemState._scrollAccumulator = 0;

    SystemState._scrollAccumulator += e.deltaY;
    const TICK_THRESHOLD = 300;

    if (Math.abs(SystemState._scrollAccumulator) >= TICK_THRESHOLD) {
        const sign = Math.sign(SystemState._scrollAccumulator);
        const steps = Math.floor(Math.abs(SystemState._scrollAccumulator) / TICK_THRESHOLD);
        SystemState._scrollAccumulator -= sign * steps * TICK_THRESHOLD;

        const win = SystemState.mainWindow;
        const dir = win.direction;
        const stepSize = 10;

        const targetX = obj.center.x + dir.x * steps * stepSize;
        const targetY = obj.center.y + dir.y * steps * stepSize;
        const targetZ = obj.center.z + dir.z * steps * stepSize;

        animateSliceTransition(obj, targetX, targetY, targetZ, 150);
    }
}

function handleEditClick(e) {
    const now = Date.now();
    if (SystemState.lastClickTarget === 'edit_empty' && now - SystemState.lastClickTime < 300) {
        addControlPointAt(e.clientX, e.clientY);
    }
    const cp = findControlPointAt(e.clientX, e.clientY);
    SystemState.lastClickTime = now;
    SystemState.lastClickTarget = cp ? 'edit_control' : 'edit_empty';
}

// ========================
// 5. Logic / Actions
// ========================

function resetCameraDistance() {
    CONFIG.screenDistance = 50;
}

export function userRotate(angle) {
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

export function applyVelocities(dt) {
    const rotVel = updateLogVelocity(SystemState.velocityState.rotation, dt);
    const moveVel = updateLogVelocity(SystemState.velocityState.moveForward, dt);

    if (Math.abs(rotVel) > 0.0001) {
        userRotate(rotVel);
        SystemState.ifControl = true;
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

// --- State Transitions ---

export function enterViewState() {
    SystemState.interactionState = 'VIEW';
    SystemState.focusedObject = null;
}

export function enterFocusState(obj) {
    if (!obj) return;
    if (SystemState.interactionState !== 'VIEW') return;
    SystemState.focusedObject = obj;
    SystemState.interactionState = 'FOCUS_ENTERING';

    SystemState.screenPoints = SystemState.screenPoints.filter(
        p => p.tag !== 'SLICE_CONTOUR'
    );

    if (obj.savePosition) {
        obj.savePosition();
    }
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
            const lastPos = targetObj._lastAnimPos || fromPos;
            const dx = value.position.x - lastPos.x;
            const dy = value.position.y - lastPos.y;
            const dz = value.position.z - lastPos.z;

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

            if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                const lastProgress = targetObj._lastRotProgress || 0;
                const progressDelta = value.progress - lastProgress;
                const rotationAmount = totalAngle * progressDelta;

                if (rotationAmount > 0.0001) {
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
        obj._lastRotProgress = null;
        SystemState.interactionState = 'FOCUS';
        const radiusAfter = measureObjectRadius(obj);
        console.log(`[STATE] FOCUS entered: 半径=${radiusAfter.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
        tracePoint(obj, 'FOCUS-entered');
    };

    SystemState.taskQueues.submit(moveRotateTask);

    for (const other of SystemState.objects) {
        if (other !== obj) {
            other.visualAlpha = 0.05;
            const points = other.displayPoints.length > 0 ? other.displayPoints : other.constructionPoints;
            for (const p of points) {
                p.tag = 'DIMMED';
            }
        }
    }
    SystemState.ifControl = true;
}

export function exitFocusState() {
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
    const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z }

    function calculateRotationFromTwoFrames(cFront, cUp, tFront, tUp) {
        const cZ = cFront;
        const cX_temp = {
            x: cUp.y * cZ.z - cUp.z * cZ.y,
            y: cUp.z * cZ.x - cUp.x * cZ.z,
            z: cUp.x * cZ.y - cUp.y * cZ.x
        };
        let cxLen = Math.sqrt(cX_temp.x ** 2 + cX_temp.y ** 2 + cX_temp.z ** 2);
        const cX = cxLen > 0.001 ? { x: cX_temp.x / cxLen, y: cX_temp.y / cxLen, z: cX_temp.z / cxLen } : { x: 1, y: 0, z: 0 };
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
        const tX = txLen > 0.001 ? { x: tX_temp.x / txLen, y: tX_temp.y / txLen, z: tX_temp.z / txLen } : { x: 1, y: 0, z: 0 };
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
            if (len > 0.001) { axis.x /= len; axis.y /= len; axis.z /= len; }
        } else if (Math.abs(angle) > 0.001) {
            axis.x = R[2][1] - R[1][2];
            axis.y = R[0][2] - R[2][0];
            axis.z = R[1][0] - R[0][1];
            const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
            if (len > 0.001) { axis.x /= len; axis.y /= len; axis.z /= len; }
            else { axis = { x: 0, y: 0, z: 1 }; }
        }
        return { axis, angle };
    };

    let currentFront = { ...obj.frontDirection };
    const cfLen = Math.sqrt(currentFront.x ** 2 + currentFront.y ** 2 + currentFront.z ** 2);
    if (cfLen > 0) { currentFront.x /= cfLen; currentFront.y /= cfLen; currentFront.z /= cfLen; }

    let savedFront = obj._savedFrontDirection || obj.frontDirection;
    const sfLen = Math.sqrt(savedFront.x ** 2 + savedFront.y ** 2 + savedFront.z ** 2);
    if (sfLen > 0) { savedFront = { x: savedFront.x / sfLen, y: savedFront.y / sfLen, z: savedFront.z / sfLen }; }

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

            if (targetObj.center) {
                const dx = value.position.x - (targetObj._lastAnimPos?.x ?? fromPos.x);
                const dy = value.position.y - (targetObj._lastAnimPos?.y ?? fromPos.y);
                const dz = value.position.z - (targetObj._lastAnimPos?.z ?? fromPos.z);

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

            if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                const lastProgress = targetObj._lastRotProgress || 0;
                const progressDelta = value.progress - lastProgress;
                const rotationAmount = totalAngle * progressDelta;

                if (rotationAmount > 0.0001) {
                    OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
                }
                targetObj._lastRotProgress = value.progress;
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
        enterViewState();
        const radiusFinal = measureObjectRadius(obj);
        console.log(`[STATE] →VIEW: 半径=${radiusFinal.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
        tracePoint(obj, '→VIEW');
        SystemState.ifControl = true;
    };
    SystemState.taskQueues.submit(moveRotateTask);
}

export function enterEditState() {
    if (SystemState.interactionState !== 'FOCUS') return;
    SystemState.interactionState = 'EDIT';
    updateLocalGrid();
}

export function exitEditState() {
    SystemState.interactionState = 'FOCUS';
    hideControlPoints();
    SystemState.localGrid = null;
}

export function rotateFocusedObject(dx, dy) {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    if (obj.animationLock) return;

    const rotSpeed = 0.005; // Sensitivity

    if (dx !== 0) OrientationImpl.rotateObjectAroundAxis(obj, { x: 0, y: 1, z: 0 }, dx * rotSpeed);
    if (dy !== 0) OrientationImpl.rotateObjectAroundAxis(obj, { x: 1, y: 0, z: 0 }, dy * rotSpeed);

    updateLocalGrid();
}

export function updateLocalGrid() {
    const grid = SystemState.localGrid;
    const target = SystemState.focusedObject;
    const win = SystemState.mainWindow;

    if (!grid || !target || !win) return;

    grid.center.x = target.center.x;
    grid.center.y = target.center.y;
    grid.center.z = target.center.z;

    if (target.frontDirection && target.upDirection) {
        grid.quaternion = OrientationImpl.getQuaternionFromVectors(target.frontDirection, target.upDirection);
    } else if (target.quaternion) {
        grid.quaternion = { ...target.quaternion };
    }

    for (const p of grid.displayPoints) {
        if (p._localX === undefined) continue;
        const rotated = OrientationImpl.applyQuaternion({ x: p._localX, y: p._localY, z: p._localZ }, grid.quaternion);
        p.x = grid.center.x + rotated.x;
        p.y = grid.center.y + rotated.y;
        p.z = grid.center.z + rotated.z;
    }
}

export function moveObjectTo(obj, x, y, z) {
    if (!obj || !obj.center) return;
    const dx = x - obj.center.x;
    const dy = y - obj.center.y;
    const dz = z - obj.center.z;

    const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
    for (const p of points) {
        p.x += dx;
        p.y += dy;
        p.z += dz;
    }

    obj.center.x = x;
    obj.center.y = y;
    obj.center.z = z;

    if (obj.centerPoint) {
        obj.centerPoint.x = x;
        obj.centerPoint.y = y;
        obj.centerPoint.z = z;
    }
}

// --- Animations ---

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

        if (t < 1) {
            requestAnimationFrame(animate);
        }
    }
    requestAnimationFrame(animate);
}

function snapToNearestLayer(obj) {
    const win = SystemState.mainWindow;
    const dir = win.direction;
    const planePt = dir.start;
    const currentDepth = (obj.center.x - planePt.x) * dir.x +
        (obj.center.y - planePt.y) * dir.y +
        (obj.center.z - planePt.z) * dir.z;

    const orientationType = obj._currentOrientationState?.type || 'FACE';
    const stepSize = ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(orientationType);
    const currentLayer = Math.round(currentDepth / stepSize);
    const targetDepth = currentLayer * stepSize;
    const delta = targetDepth - currentDepth;

    if (Math.abs(delta) > 0.001) {
        const targetX = obj.center.x + dir.x * delta;
        const targetY = obj.center.y + dir.y * delta;
        const targetZ = obj.center.z + dir.z * delta;
        animateSliceTransition(obj, targetX, targetY, targetZ, 50);
    }
}

function calculateCenterPosition() {
    const dirStart = SystemState.mainWindow.direction.start;
    return { x: dirStart.x, y: dirStart.y, z: dirStart.z };
}

// --- Control Points ---

function findControlPointAt(screenX, screenY) {
    const obj = SystemState.focusedObject;
    if (!obj) return null;
    const points = obj.controlPoints || obj.constructionPoints || [];
    for (const p of points) {
        if (Math.abs(p.xM - screenX) < 10 && Math.abs(p.yM - screenY) < 10) return p;
    }
    return null;
}

function addControlPointAt(screenX, screenY) {
    const obj = SystemState.focusedObject;
    if (!obj) return;
    const center = obj.center;
    const screenCenterX = SystemState.screenWidthPx / 2;
    const screenCenterY = SystemState.screenHeightPx / 2;
    const offsetX = (screenX - screenCenterX) * 0.02;
    const offsetZ = (screenCenterY - screenY) * 0.02;

    const newPoint = new Point(
        center.x + offsetX, center.y, center.z + offsetZ
    );
    if (!obj.controlPoints) obj.controlPoints = [];
    obj.controlPoints.push(newPoint);
    obj._needsRefit = true;
    updateControlPointsDisplay();
}

function moveControlPoint(cp, dx, dy) {
    if (!cp) return;
    const scale = 0.05;
    cp.x += dx * scale;
    cp.z -= dy * scale;
    const obj = SystemState.focusedObject;
    if (obj) obj._needsRefit = true;
}

function deleteControlPoint(cp) {
    const obj = SystemState.focusedObject;
    if (!obj || !obj.controlPoints) return;
    const index = obj.controlPoints.indexOf(cp);
    if (index > -1) {
        obj.controlPoints.splice(index, 1);
        obj._needsRefit = true;
        updateControlPointsDisplay();
    }
}

function hideControlPoints() {
    SystemState.screenPoints = SystemState.screenPoints.filter(p => !p.isControl);
}

function updateControlPointsDisplay() {
    // Rebuild screen points for controls
    // (Implementation placeholder as main.js implementation is coupled with rendering)
}

function updateSliceContour() {
    if (SystemState.interactionState === 'FOCUS_ENTERING') return;

    const obj = SystemState.focusedObject;
    if (!obj) return;

    SystemState.screenPoints = SystemState.screenPoints.filter(
        p => p.tag !== 'SLICE_CONTOUR'
    );

    // Placeholder for future contour sampling
    // console.log('Slice Depth:', SystemState.focusSliceDepth);
}


function calculateImpulse(duration) {
    if (duration < 100) return 0;
    const maxDuration = 2000;
    const t = Math.min(1, (duration - 100) / (maxDuration - 100));
    return t * t * (3 - 2 * t);
}

function applyTouchImpulse(impulse) {
    const hitPoint = SystemState.chargeHitPoint;
    if (!hitPoint) return;

    const obj = SystemState.focusedObject;
    if (!obj) return;

    const physicsState = obj.representation?.physicsState;
    if (!physicsState || !physicsState.particles) {
        console.warn('applyTouchImpulse: No physics state, using simple fallback');
        applyTouchImpulseSimple(impulse);
        return;
    }

    const nx = hitPoint.nx || 0;
    const ny = hitPoint.ny || 0;
    const nz = hitPoint.nz || 0;

    const normalLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (normalLen < 0.001) {
        console.warn('applyTouchImpulse: Invalid normal');
        return;
    }

    const normNx = nx / normalLen;
    const normNy = ny / normalLen;
    const normNz = nz / normalLen;

    const impulseFactor = 5.0;
    const impulseX = -normNx * impulse * impulseFactor;
    const impulseY = -normNy * impulse * impulseFactor;
    const impulseZ = -normNz * impulse * impulseFactor;

    const impactRadius = 2.0;
    const hitX = hitPoint.x;
    const hitY = hitPoint.y;
    const hitZ = hitPoint.z;

    const { particles, surfaceCount } = physicsState;
    let affectedCount = 0;

    for (let i = 0; i < surfaceCount; i++) {
        const p = particles[i];
        if (!p || !p.position || !p.velocity) continue;

        const dx = p.position.x - hitX;
        const dy = p.position.y - hitY;
        const dz = p.position.z - hitZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < impactRadius) {
            const t = 1 - (dist / impactRadius);
            const weight = t * t * (3 - 2 * t);

            p.velocity.x += impulseX * weight;
            p.velocity.y += impulseY * weight;
            p.velocity.z += impulseZ * weight;

            affectedCount++;
        }
    }

    console.log('Applied Impulse:', impulse.toFixed(3), 'Particles:', affectedCount);

    if (!obj.physics.enabled) {
        obj.physics.enabled = true;
        console.log('Physics enabled');
    }
    obj.animationLock = false;
    SystemState.ifControl = true;
}

function applyTouchImpulseSimple(impulse) {
    const hitPoint = SystemState.chargeHitPoint;
    const obj = SystemState.focusedObject;
    if (!hitPoint || !obj) return;

    const nx = hitPoint.nx || 0;
    const ny = hitPoint.ny || 0;
    const nz = hitPoint.nz || 0;
    const normalLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (normalLen < 0.001) return;

    const normNx = nx / normalLen;
    const normNy = ny / normalLen;
    const normNz = nz / normalLen;

    const displaceAmount = impulse * 0.5;
    const dispX = -normNx * displaceAmount;
    const dispY = -normNy * displaceAmount;
    const dispZ = -normNz * displaceAmount;

    const impactRadius = 2.0;
    const hitX = hitPoint.x;
    const hitY = hitPoint.y;
    const hitZ = hitPoint.z;

    const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;
    for (const p of points) {
        const dx = p.x - hitX;
        const dy = p.y - hitY;
        const dz = p.z - hitZ;
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


function applyQuaternionToPoints(obj) {
    // Placeholder as it's not strictly needed if we use OrientationImpl correctly
    // But exitFocusState animation uses it?
    // No, exitFocusState in InputManager uses OrientationImpl.rotateObjectAroundAxis
    // which directly modifies points.
}

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
