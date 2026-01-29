import { SystemState, CONFIG, EditConfig } from "./SystemState.js";
import { OrientationImpl } from "./OrientationImpl.js";
import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js";

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

        if (keys["f"] || keys["g"]) {
            // 复用 CAMERA_ZOOM 逻辑，直接位移，无惯性
            // 速度稍小一点以适配按键的连续触发
            // [MOD] 方向反转：FG 为向前 (Zoom In) -> Radius 变小 -> Delta 正 (Wait, user said "Still Incorrect", assuming he wants Logic Reversal?)
            // User: "Move camera forward (zoom in)".
            // My Logic: Radius - Speed. So Speed > 0 => Radius Decrease => Forward.
            // User says "Still Incorrect". This implies he felt it was NOT going forward.
            // So he probably wants Radius INCREASE for Forward? No, that's absurd.
            // Or he pressed F and it went Backward?
            // If he pressed F and it went Backward, then Radius was INCREASING?
            // Check previous code: L47 was delta POSITIVE. logic was Radius - Speed.
            // So Radius - Positive = Smaller Radius = Forward.
            // Why did user feel backward? 透视问题?
            // Let's TRY Negative Delta to see if it fixes "User Perception".
            intents.push({ type: 'CAMERA_ZOOM', delta: -CONFIG.moveSpeed * 0.5 });
        }
        else if (keys["v"]) {
            // [MOD] 方向反转
            intents.push({ type: 'CAMERA_ZOOM', delta: CONFIG.moveSpeed * 0.5 });
        }

        // 移除旧的 velocity 设置
        // intents.push({ type: 'SET_MOVE_VELOCITY', target: moveTarget, factor: moveFactor || 1.0 });

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
                console.log('[DEBUG] MouseDown: Snapped to ObjectCenter:', snapped.ownerObject.tag || snapped.ownerObject.metadata?.name);
                intent.payload = {
                    draggingObject: snapped.ownerObject,
                    dragStartCenter: {
                        x: snapped.ownerObject.center.x,
                        y: snapped.ownerObject.center.y,
                        z: snapped.ownerObject.center.z
                    }
                };
                console.log('[DEBUG] START_DRAG_VIEW intent created');
            } else {
                console.log('[DEBUG] MouseDown: Snapped is not valid object center. Snapped:', snapped);
            }
            return intent;
        }
        return null;
    },

    handleViewMouseMove(e) {
        if (SystemState.draggingObject) {
            const snapped = SystemState.virtualMouse.snappedTo;
            if (snapped) {
                // console.log('[DEBUG] MouseMove: Dragging. Snapped:', snapped.tag, 'isGridPoint:', snapped.isGridPoint);
            }
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
        // [MOD] 方向反转：Wheel Up (deltaY < 0) 为 Zoom In (Forward).
        // Since we flipped key logic to Negative for Forward (experimentally),
        // we must flip this too.
        // deltaY < 0 (Up) -> -1. Negative Delta -> Forward?
        const deltaSign = e.deltaY < 0 ? -1 : 1;
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
            // 返回带有屏幕坐标的意图，用于 3D 射线投射和冲量施加
            return {
                type: 'FOCUS_PHYSICS_TOUCH',
                x: e.clientX,
                y: e.clientY,
                vmDepth: SystemState.focusVirtualMouseDepth // 传递虚拟鼠标深度
            };
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
            // 获取当前虚拟鼠标吸附到的格点
            const snapped = SystemState.virtualMouse.snappedTo;

            // 只有吸附到有效的局部格点时才移动控制点
            if (snapped && snapped.tag === 'LOCAL_GRID') {
                // 检查约束条件：
                // 1. 不允许拖到中心点（lx=ly=lz=0）
                const isCenter = (Math.abs(snapped.lx) < 0.01 &&
                    Math.abs(snapped.ly) < 0.01 &&
                    Math.abs(snapped.lz) < 0.01);
                if (isCenter) {
                    // 返回 null 表示不移动，虚拟鼠标仍会更新但控制点不动
                    return null;
                }

                // 2. 检查是否与其他控制点重合（由 Hub 处理）
                return {
                    type: 'SNAP_CONTROL_POINT_TO_GRID',
                    controlPoint: SystemState.draggedControlPoint,
                    gridPoint: snapped,
                    mouseX: e.clientX,
                    mouseY: e.clientY
                };
            }
            // 未吸附到有效格点时，不移动控制点
            // 调试：显示 snapped 状态
            if (snapped) {
                console.log(`[InputManager] 拖拽中但格点 tag=${snapped.tag} 不是 LOCAL_GRID`);
            } else {
                console.log(`[InputManager] 拖拽中但无吸附点`);
            }
        }
        return null;
    },

    handleEditWheel(e) {
        return InputManager.handleEditWheelSliceDepth(e);
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
            const maxDepth = EditConfig.getMaxDepthForOrientation(orientationType);
            const stepSize = EditConfig.getLayerSpacingForOrientation(orientationType);

            console.log(`[Wheel] Type: ${orientationType}, Step: ${stepSize.toFixed(3)}cm`);

            // We will return an intent to SCROLL
            // We update accumulator here to "consumption"
            SystemState._scrollAccumulator -= sign * steps * TICK_THRESHOLD;

            return {
                type: 'SCROLL_SLICE_DEPTH',
                steps: steps * sign,
                stepSize,
                maxDepth,
                currentDepth,
                obj: obj // 关键补充：必须传递 obj
            };
        }
        return null; // Don't return intent until threshold
    },

    handleEditClick(event) {
        const now = Date.now();
        const obj = SystemState.focusedObject;
        if (!obj) return null;

        // 1. 检查是否点击了可见的控制点（屏幕坐标判断）
        let clickedVisibleCP = null;
        const points = obj.controlPoints?.length > 0
            ? obj.controlPoints
            : (obj.constructionPoints || []).slice(0, 20);
        const radius = 15;
        for (const p of points) {
            // 使用 isVisible 判断可见性（tag 现在仅用于样式）
            if (p.isVisible === false) continue;
            if (p.tag !== 'CONTROL') continue;
            const dist = Math.sqrt((p.xM - event.clientX) ** 2 + (p.yM - event.clientY) ** 2);
            if (dist < radius) {
                clickedVisibleCP = p;
                break;
            }
        }

        // 2. 检查是否吸附到局部格点（包括边缘点）
        const snapped = SystemState.virtualMouse.snappedTo;
        const snappedToLocalGrid = snapped && (snapped.tag === 'LOCAL_GRID' || snapped.tag === 'LOCAL_GRID_EDGE');

        // 3. 如果吸附到格点，检查该格点位置是否已有控制点（无论是否可见）
        let existingCPAtGrid = null;
        if (snappedToLocalGrid && obj.controlPoints) {
            const TOLERANCE = 0.1; // 1mm 容差，使用局部坐标比较
            // 使用格点的局部坐标（lx, ly, lz）与控制点比较
            const gridLocalX = snapped.lx ?? snapped._localX ?? 0;
            const gridLocalY = snapped.ly ?? snapped._localY ?? 0;
            const gridLocalZ = snapped.lz ?? snapped._localZ ?? 0;

            for (const cp of obj.controlPoints) {
                const dx = Math.abs(cp.lx - gridLocalX);
                const dy = Math.abs(cp.ly - gridLocalY);
                const dz = Math.abs(cp.lz - gridLocalZ);
                if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
                    existingCPAtGrid = cp;
                    break;
                }
            }
        }

        // 4. 双击判定
        const isDoubleClick = (now - lastClickTime < DOUBLE_CLICK_THRESHOLD);
        let intent = null;

        if (isDoubleClick) {
            if (lastClickTarget === 'control_point' && clickedVisibleCP) {
                // 双击可见控制点 → 删除
                intent = { type: 'DELETE_CONTROL_POINT', controlPoint: clickedVisibleCP };
            } else if (lastClickTarget === 'local_grid' && snappedToLocalGrid) {
                if (existingCPAtGrid) {
                    // 双击格点，但位置已有控制点（可能不可见）→ 删除
                    intent = { type: 'DELETE_CONTROL_POINT', controlPoint: existingCPAtGrid };
                } else {
                    // 双击空的局部格点 → 新增
                    intent = {
                        type: 'ADD_CONTROL_POINT_AT_GRID',
                        gridPoint: snapped
                    };
                }
            }
        }

        // 5. 更新状态
        lastClickTime = now;
        if (clickedVisibleCP) {
            lastClickTarget = 'control_point';
        } else if (snappedToLocalGrid) {
            lastClickTarget = 'local_grid';
        } else {
            lastClickTarget = 'edit_empty';
        }

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
