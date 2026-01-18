import { SystemState, CONFIG } from "./SystemState.js";
import { OrientationImpl } from "./OrientationImpl.js";
import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js"; // Needed for LocalGridConfig

// [MIGRATE]
// 瞬态变量，移动到模块作用域
let lastClickTime = 0;
let lastClickTarget = null;
const DOUBLE_CLICK_THRESHOLD = 300;

export const InputManager = {
    // VIEW STATE HANDLERS
    handleViewContinuousInput() {
        const keys = SystemState.keys;
        const intents = [];

        // Rotation intents
        let rotTarget = 0;
        let rotFactor = 0;

        if (keys["z"]) { rotTarget = CONFIG.rotationSpeed; rotFactor = 1.0; }
        else if (keys["x"]) { rotTarget = CONFIG.rotationSpeed; rotFactor = 0.5; }
        else if (keys["c"]) { rotTarget = CONFIG.rotationSpeed; rotFactor = 0.25; }
        else if (keys["b"]) { rotTarget = -CONFIG.rotationSpeed; rotFactor = 0.25; }
        else if (keys["n"]) { rotTarget = -CONFIG.rotationSpeed; rotFactor = 0.5; }
        else if (keys["m"]) { rotTarget = -CONFIG.rotationSpeed; rotFactor = 1.0; }

        if (SystemState.mouseEdge === -1) {
            rotTarget = CONFIG.rotationSpeed;
            rotFactor = 0.25;
        } else if (SystemState.mouseEdge === 1) {
            rotTarget = -CONFIG.rotationSpeed;
            rotFactor = 0.25;
        }

        // Always update velocity target, even if 0, to ensure decay happens
        intents.push({ type: 'SET_ROTATION_VELOCITY', target: rotTarget, factor: rotFactor || 0.25 }); // Default factor if 0

        // Move intents
        let moveTarget = 0;
        let moveFactor = 0;

        if (keys["f"] || keys["g"]) { moveTarget = CONFIG.moveSpeed; moveFactor = 1.0; }
        else if (keys["v"]) { moveTarget = -CONFIG.moveSpeed; moveFactor = 1.0; }

        intents.push({ type: 'SET_MOVE_VELOCITY', target: moveTarget, factor: moveFactor || 1.0 });

        // Light control intents
        if (keys["arrowleft"]) intents.push({ type: 'ADJUST_LIGHT_ANGLE', delta: -CONFIG.rotationSpeed });
        if (keys["arrowright"]) intents.push({ type: 'ADJUST_LIGHT_ANGLE', delta: CONFIG.rotationSpeed });
        if (keys["arrowup"]) intents.push({ type: 'ADJUST_LIGHT_ELEVATION', delta: CONFIG.rotationSpeed });
        if (keys["arrowdown"]) intents.push({ type: 'ADJUST_LIGHT_ELEVATION', delta: -CONFIG.rotationSpeed });

        return intents.length > 0 ? intents : null;
    },

    handleViewKeyDown(e) {
        if (e.key === 'Escape') {
            const hasPendingTasks = (SystemState.taskQueues.current?.length > 0) ||
                (SystemState.taskQueues.next?.length > 0);
            if (hasPendingTasks) {
                console.log('[STATE] VIEW ESC: 有动画进行中，忽略');
                return null;
            }
            return { type: 'RESET_CAMERA_DISTANCE' };
        }
        return null;
    },

    handleViewMouseDown(e) {
        if (e.button === 0) {
            const snapped = SystemState.virtualMouse.snappedTo;
            const intent = { type: 'START_DRAG_VIEW', x: e.clientX, y: e.clientY };

            if (snapped && snapped.isObjectCenter && snapped.ownerObject) {
                intent.payload = {
                    draggingObject: snapped.ownerObject,
                    dragStartCenter: {
                        x: snapped.ownerObject.center.x,
                        y: snapped.ownerObject.center.y,
                        z: snapped.ownerObject.center.z
                    }
                };
                console.log('开始拖拽物体');
            }
            return intent;
        }
        return null;
    },

    handleViewMouseMove(e) {
        if (SystemState.draggingObject) {
            const snapped = SystemState.virtualMouse.snappedTo;
            if (snapped && snapped.isGridPoint) {
                return {
                    type: 'MOVE_OBJECT',
                    object: SystemState.draggingObject,
                    x: snapped.x,
                    y: snapped.y,
                    z: snapped.z
                };
            }
        }
        return null;
    },

    handleViewWheel(e) {
        e.preventDefault();
        const speed = CONFIG.moveSpeed * 2;
        // Calculate logical delta
        // Note: direction vector logic is handled in Hub, here we just say "zoom in/out"
        // But original logic depended on SystemState.mainWindow.direction directly in the handler.
        // To respect INTENT-ONLY, we should pass the intent to move camera.
        // However, the original logic calculates new position based on direction * speed * sign.

        // We can return a specific intent like 'CAMERA_ZOOM'
        const deltaSign = e.deltaY < 0 ? 1 : -1;
        return { type: 'CAMERA_ZOOM', delta: deltaSign * speed };
    },

    handleViewClick(event) {
        const now = Date.now();
        const snapped = SystemState.virtualMouse.snappedTo;
        const target = (snapped && snapped.isObjectCenter && snapped.ownerObject)
            ? snapped.ownerObject
            : null;

        let intent = null;
        if (target && target === lastClickTarget && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            intent = { type: 'ENTER_FOCUS_STATE', object: target };
        }

        lastClickTime = now;
        lastClickTarget = target;
        return intent;
    },

    // FOCUS STATE HANDLERS
    handleFocusEdgeRotation() {
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

            // We need to return an intent to update rotation state in SystemState
            // AND potentially rotate the object if speed > 0

            // The original function modifies internal state of rotState directly AND calls rotateFocusedObject
            // For strict Intent architecture, we should return intents to update state or perform rotation.

            // Since this is called every frame (continuous), we can return a ROTATE_FOCUSED_OBJECT intent
            // The state update logic (edgeStartTime etc) seems tightly coupled here.
            // We will calculate the speed here and emit an intent to rotate.

            if (!rotState.isAtEdge || rotState.edgeDirection.h !== h || rotState.edgeDirection.v !== v) {
                // This side-effect modifies SystemState. We should ideally return an intent to update this state,
                // but since SystemState is imported, we might just update it?
                // NO. main_structure.js says: "MIGRATE -> manage/InputManager.js", "禁止直接调用 rotateFocusedObject"
                // It implies we should calculate the rotation needed.

                rotState.edgeStartTime = Date.now();
                rotState.edgeDirection = { h, v };
            }
            rotState.isAtEdge = true;

            const elapsed = (Date.now() - rotState.edgeStartTime) / 1000;
            const accelRate = 3.0;
            const maxSpeed = 0.03;
            const speedFactor = 1 - Math.exp(-accelRate * elapsed);
            const hSpeed = h * speedFactor * maxSpeed;
            const vSpeed = v * speedFactor * maxSpeed;

            if (hSpeed !== 0 || vSpeed !== 0) {
                return { type: 'ROTATE_FOCUSED_OBJECT', dx: hSpeed * 100, dy: vSpeed * 100 };
            }
        } else {
            if (rotState.isAtEdge) {
                rotState.isAtEdge = false;
                rotState.edgeStartTime = 0;
                rotState.edgeDirection = { h: 0, v: 0 };
            }
        }
        return null;
    },

    handleFocusKeyDown(e) {
        if (e.key === 'Escape') {
            const obj = SystemState.focusedObject;
            if (obj && obj.animationLock) {
                console.log('[STATE] FOCUS ESC: 物体动画进行中，忽略');
                return null;
            }
            const hasPendingTasks = (SystemState.taskQueues.current?.length > 0) ||
                (SystemState.taskQueues.next?.length > 0);
            if (hasPendingTasks) {
                console.log('[STATE] FOCUS ESC: 有动画进行中，忽略');
                return null;
            }
            return { type: 'EXIT_FOCUS_STATE' };
        }
        return null;
    },

    handleFocusMouseDown(e) {
        if (e.button === 0) {
            return { type: 'START_DRAG_FOCUS', x: e.clientX, y: e.clientY };
        }
        return null;
    },

    handleFocusWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.5 : -0.5;
        return { type: 'ADJUST_SLICE_DEPTH', delta };
    },

    handleFocusClick(event) {
        const now = Date.now();
        let intent = null;
        if (lastClickTarget === 'focus_click' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            intent = { type: 'ENTER_EDIT_STATE' };
        }
        lastClickTime = now;
        lastClickTarget = 'focus_click';
        return intent;
    },

    // EDIT STATE HANDLERS
    handleEditKeyDown(e) {
        if (e.key === 'Escape') {
            return { type: 'EXIT_EDIT_STATE' };
        }
        const obj = SystemState.focusedObject;
        if (obj) {
            const key = e.key.toLowerCase();
            if (['w', 's', 'a', 'd', 'q', 'e'].includes(key)) {
                const now = performance.now();
                const cooldownMs = 300;
                if (!SystemState._lastRotationTime || (now - SystemState._lastRotationTime) > cooldownMs) {
                    SystemState._lastRotationTime = now;
                    // Return intent to trigger transition
                    return { type: 'EDIT_ROTATE_TRANSITION', key, object: obj };
                }
            }
        }
        return null;
    },

    handleEditMouseDown(e) {
        if (e.button === 0) {
            // Need to find control point. Can we call findControlPointAt?
            // main_structure.js says: "禁止直接调用 findControlPointAt"
            // But InputManager needs to know IF we clicked a control point to generate the correct intent.
            // We can emit a 'CHECK_CONTROL_POINTas_CLICK' intent? No, real-time feedback needed?
            // Actually, we can assume the Hub handles the logic. 
            // We can just emit 'EDIT_MOUSE_DOWN' with coords, and Hub decides if it hit something.

            return { type: 'EDIT_MOUSE_DOWN', x: e.clientX, y: e.clientY };
        }
        return null;
    },

    handleEditMouseMove(e) {
        if (SystemState.draggedControlPoint) {
            const dx = e.clientX - SystemState.lastMouseX;
            const dy = e.clientY - SystemState.lastMouseY;
            if (dx !== 0 || dy !== 0) {
                return {
                    type: 'MOVE_CONTROL_POINT',
                    controlPoint: SystemState.draggedControlPoint, // Hub needs to validate this
                    dx,
                    dy,
                    mouseX: e.clientX,
                    mouseY: e.clientY
                };
            }
        }
        return null;
    },

    handleEditWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        return { type: 'CHANGE_DEPTH_LAYER', delta };
    },

    handleEditWheelSliceDepth(e) {
        e.preventDefault();
        const obj = SystemState.focusedObject;
        if (!obj) return null;

        // Logic for scroll accumulator.
        // Ideally this logic should also be in Hub or extracted, but it's pure logic relying on state.
        // We can keep the accumulator logic here OR return the raw wheel event intent.
        // Let's keep common logic here to return a "high level" intent like "SCROLL_SLICE" only when threshold met.

        if (typeof SystemState._scrollAccumulator === 'undefined') {
            SystemState._scrollAccumulator = 0;
        }
        SystemState._scrollAccumulator += e.deltaY;
        const TICK_THRESHOLD = 300;

        if (Math.abs(SystemState._scrollAccumulator) >= TICK_THRESHOLD) {
            const sign = Math.sign(SystemState._scrollAccumulator);
            const steps = Math.floor(Math.abs(SystemState._scrollAccumulator) / TICK_THRESHOLD);

            // Need to calculate target depth to check limits vs LocalGridConfig
            // This requires ObjectFactoryImpl.LocalGridConfig (imported)

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
            // targetLayer calculation ...

            // We will return an intent to SCROLL
            // We update accumulator here to "consumption"
            SystemState._scrollAccumulator -= sign * steps * TICK_THRESHOLD;

            return {
                type: 'SCROLL_SLICE_DEPTH',
                steps: steps * sign,
                stepSize,
                maxDepth,
                currentDepth
            };
        }
        return null;
    },

    handleEditClick(event) {
        const now = Date.now();
        let intent = null;
        if (lastClickTarget === 'edit_empty' && now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
            intent = { type: 'ADD_CONTROL_POINT', x: event.clientX, y: event.clientY };
        }

        // We need to know if we clicked a control point to set lastClickTarget correctly.
        // This implies READ access to scene state (findControlPointAt).
        // Hub can pass this info? Or we return a GENERIC click intent and Hub processes it?
        // Let's return logic-rich intent or a request to check.

        // To strictly follow "InputManager doesn't call scene logic", 
        // we should return: { type: 'EDIT_CLICK', x:clientX, y:clientY }
        // And let Hub update lastClickTarget?
        // But lastClickTarget is local to this module (top of file).

        // Compromise: We need to know what we clicked.
        // In `handleViewClick`, we used `SystemState.virtualMouse.snappedTo`.
        // In `handleEditClick`, we need `findControlPointAt`.
        // We can't import `findControlPointAt` from main.js (circular).
        // It should be moved to a helper or just implemented here as pure logic given `SystemState.focusedObject`.
        // Let's replicate the pure logic of `findControlPointAt` here since it only reads SystemState.

        const obj = SystemState.focusedObject;
        let clickedCP = null;
        if (obj) {
            const points = obj.controlPoints && obj.controlPoints.length > 0
                ? obj.controlPoints
                : (obj.constructionPoints || []).slice(0, 20);
            const radius = 15;
            for (const p of points) {
                if (p.tag !== 'CONTROL') continue;
                const dist = Math.sqrt((p.xM - event.clientX) ** 2 + (p.yM - event.clientY) ** 2);
                if (dist < radius) {
                    clickedCP = p;
                    break;
                }
            }
        }

        lastClickTime = now;
        lastClickTarget = clickedCP ? 'edit_control' : 'edit_empty';

        return intent;
    },

    // Mapping
    getHandlers(interactionState) {
        const map = {
            VIEW: {
                onContinuousInput: this.handleViewContinuousInput,
                onKeyDown: this.handleViewKeyDown,
                onMouseDown: this.handleViewMouseDown,
                onMouseMove: this.handleViewMouseMove,
                onWheel: this.handleViewWheel,
                onClick: this.handleViewClick
            },
            FOCUS: {
                onContinuousInput: this.handleFocusEdgeRotation,
                onKeyDown: this.handleFocusKeyDown,
                onMouseDown: this.handleFocusMouseDown,
                onMouseMove: () => null,
                onWheel: this.handleFocusWheel,
                onClick: this.handleFocusClick
            },
            FOCUS_ENTERING: { return: null }, // No input
            EDIT: {
                onContinuousInput: () => null,
                onKeyDown: this.handleEditKeyDown,
                onMouseDown: this.handleEditMouseDown,
                onMouseMove: this.handleEditMouseMove,
                onWheel: this.handleEditWheel,
                onClick: this.handleEditClick,
                onWheelSliceDepth: this.handleEditWheelSliceDepth
            }
        };
        return map[interactionState] || {};
    }
};
