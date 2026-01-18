import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js";

import { CONFIG } from "./Config.js";

// Re-export CONFIG so other modules don't break (optional, but good for compatibility if others import from here)
export { CONFIG };

export const SystemState = {
    ifControl: true,
    objects: ObjectFactoryImpl.createTestScene(),
    otherObjects: [],
    screenPoints: [],
    hiddenWindow: null,
    lightWindow: null,
    mainWindow: null,
    rotationCenter: null,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    keys: {},
    mouseEdge: 0,
    canvas: null,
    ctx: null,
    debugDiv: null,
    screenWidthPx: window.innerWidth,
    screenHeightPx: window.innerHeight,
    video: null,
    videoCanvas: null,
    videoCtx: null,
    cameraActive: false,
    targetPosition: { x: 0, y: 0 },
    lastDetectionTime: 0,
    detectionInterval: 20,
    smoothingListDis: [],
    smoothingListHeight: [],
    smoothingListX: [],
    taskQueues: {
        current: [],
        next: [],
        swap() {
            this.current = this.next;
            this.next = [];
        },
        submit(task) {
            this.next.push(task);
        },
        cancel(taskId) {
            const findAndCancel = (arr) => {
                const task = arr.find(t => t.id === taskId);
                if (task) task._cancelled = true;
            };
            findAndCancel(this.current);
            findAndCancel(this.next);
        }
    },
    worldTime: 0,
    lastTimestamp: 0,
    interactionState: 'VIEW',
    focusedObject: null,
    focusSliceDepth: 0,
    focusVirtualMouseDepth: 0,
    debugCenterPoint: false,
    isCharging: false,
    chargeStartTime: 0,
    chargePosition: { x: 0, y: 0 },
    chargeHitPoint: null,
    editDepthLayer: 0,
    draggedControlPoint: null,
    longPressTimer: null,
    longPressTarget: null,
    velocityState: {
        rotation: { current: 0, target: 0, factor: 0 },
        moveForward: { current: 0, target: 0, factor: 0 },
    },
    focusRotationState: {
        edgeStartTime: 0,
        isAtEdge: false,
        edgeDirection: { h: 0, v: 0 }
    },
    worldGrid: null,
    virtualMouse: {
        enabled: true,
        screenPosition: { x: 0, y: 0 },
        snappedTo: null,
    },
    draggingObject: null,
    dragStartCenter: null,
    // 摄像头显示画布
    videoDisplayCanvas: null,
    videoDisplayCtx: null,
};
