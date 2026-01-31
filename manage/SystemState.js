import { ObjectFactoryImpl } from "./ObjectFactoryImpl.js";
import { AnimationImpl } from "./AnimationImpl.js";
import { OrientationImpl } from "./OrientationImpl.js";
import { CONFIG } from "./Config.js";

// Re-export CONFIG so other modules don't break
export { CONFIG };
export { EditConfig } from "./EditConfig.js";


/**
 * SystemStateClass - 全局运行时状态管理器
 * 
 * 分区索引:
 * - 场景数据 (Scene Data)
 * - 渲染系统 (Rendering System)
 * - 摄像头系统 (Camera System)
 * - 动画/任务系统 (Animation/Task System)
 * - 交互状态 (Interaction State)
 * - 输入状态 (Input State)
 * - 虚拟鼠标 (Virtual Mouse)
 * - 状态转换方法 (State Transition Methods)
 */
class SystemStateClass {
    constructor() {
        // ========== 场景数据 (Scene Data) ==========
        this.objects = ObjectFactoryImpl.createTestScene();
        this.otherObjects = [];
        this.screenPoints = [];
        this.worldGrid = null;
        this.lightObject = null;

        // ========== 渲染系统 (Rendering System) ==========
        this.canvas = null;
        this.ctx = null;
        this.debugDiv = null;
        this.screenWidthPx = window.innerWidth;
        this.screenHeightPx = window.innerHeight;
        this.hiddenWindow = null;
        this.lightWindow = null;
        this.mainWindow = null;
        this.rotationCenter = null;

        // ========== 摄像头系统 (Camera System) ==========
        this.video = null;
        this.videoCanvas = null;
        this.videoCtx = null;
        this.videoDisplayCanvas = null;
        this.videoDisplayCtx = null;
        this.cameraActive = false;
        this.targetPosition = { x: 0, y: 0 };
        this.lastDetectionTime = 0;
        this.detectionInterval = 20;
        this.smoothingListDis = [];
        this.smoothingListHeight = [];
        this.smoothingListX = [];

        // ========== 动画/任务系统 (Animation/Task System) ==========
        this.worldTime = 0;
        this.lastTimestamp = 0;
        this.taskQueues = {
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
        };

        // ========== 交互状态 (Interaction State) ==========
        this.interactionState = 'VIEW';
        this.focusedObject = null;
        this.focusSliceDepth = 0;
        this.focusVirtualMouseDepth = 0;
        this.editDepthLayer = 0;
        this.draggedControlPoint = null;
        this.focusRotationState = {
            edgeStartTime: 0,
            isAtEdge: false,
            edgeDirection: { h: 0, v: 0 }
        };

        // ========== 输入状态 (Input State) ==========
        this.ifControl = true;
        this.isDragging = false;
        this.draggingObject = null;
        this.dragStartCenter = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.keys = {};
        this.mouseEdge = 0;
        this.isCharging = false;
        this.chargeStartTime = 0;
        this.chargePosition = { x: 0, y: 0 };
        this.chargeHitPoint = null;
        this.longPressTimer = null;
        this.longPressTarget = null;
        this.velocityState = {
            rotation: { current: 0, target: 0, factor: 0 },
            moveForward: { current: 0, target: 0, factor: 0 },
        };

        // ========== 虚拟鼠标 (Virtual Mouse) ==========
        this.virtualMouse = {
            enabled: true,
            screenPosition: { x: 0, y: 0 },
            snappedTo: null,
        };

        // ========== 调试 (Debug) ==========
        this.debugCenterPoint = false;
        this.movementConstraints = null;

        // ========== 外部依赖注入 (Dependency Injection) ==========
        // 用于打破循环依赖，由 main.js 注入
        this._helpers = {
            measureObjectRadius: null,
            tracePoint: null,
            updateSliceContour: null,
        };

        // ========== 优化 (Optimization) ==========
        this.imageData = null; // 缓存图像数据
        this.sceneDirty = true; // 场景脏标记
        this.lightDirty = true; // 光照脏标记
    }

    // ========== 依赖注入 ==========
    setHelpers(helpers) {
        Object.assign(this._helpers, helpers);
    }

    // ========== 状态转换方法 (State Transition Methods) ==========

    /**
     * 进入 VIEW 状态
     */
    enterView() {
        this.interactionState = 'VIEW';
        this.focusedObject = null;
        for (const obj of this.objects) {
            obj.visualAlpha = 1.0;
            obj.isVisible = true;  // [修改] 恢复所有物体可见性
        }
    }

    /**
     * 进入 FOCUS 状态
     * @param {Object} obj - 要聚焦的物体
     */
    enterFocus(obj) {
        if (!obj) {
            console.warn('enterFocus: 物体不能为空');
            return;
        }

        this.interactionState = 'FOCUS_ENTERING';
        this.focusedObject = obj;

        const radiusBefore = this._helpers.measureObjectRadius?.(obj) || 0;
        console.log(`[STATE] VIEW→FOCUS: 物体=${obj.metadata?.name || 'Obj'}, 半径=${radiusBefore.toFixed(3)}cm`);
        this._helpers.tracePoint?.(obj, 'VIEW→FOCUS');

        this.screenPoints = this.screenPoints.filter(p => p.tag !== 'SLICE_CONTOUR');

        if (obj.savePosition) obj.savePosition();

        const originalFront = { ...obj.frontDirection };
        obj._savedFrontDirection = originalFront;
        const originalUp = obj.upDirection ? { ...obj.upDirection } : { x: 0, y: 0, z: 1 };
        obj._savedUpDirection = originalUp;

        const targetPos = this.calculateCenterPosition();
        const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

        const dir = this.mainWindow.direction;
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

        const self = this;
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
                targetObj.transform.position.x = value.position.x;
                targetObj.transform.position.y = value.position.y;
                targetObj.transform.position.z = value.position.z;

                if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                    const lastProgress = targetObj._lastRotProgress || 0;
                    const progressDelta = value.progress - lastProgress;
                    const rotationAmount = totalAngle * progressDelta;
                    if (rotationAmount > 0.0001) {
                        OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
                    }
                    targetObj._lastRotProgress = value.progress;
                } else {
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
            self.interactionState = 'FOCUS';
            self._helpers.tracePoint?.(obj, 'FOCUS-entered');

            // Phase 9: 物理准备（延迟启用）
            // 只标记物理就绪，实际启用等待用户左击触发
            if (obj) {
                console.log(`[STATE] FOCUS: 物理就绪，等待用户交互 (${CONFIG.defaultPhysicsModel})`);
                obj._physicsReady = true;  // 标记可以启用物理
                obj.physics.model = CONFIG.defaultPhysicsModel; // 'force'

                // 预设合理的刚度和阻尼
                if (!obj.physics.stiffness || obj.physics.stiffness < 0.1) {
                    obj.physics.stiffness = 100.0;
                }
                if (!obj.physics.damping || obj.physics.damping < 0.01) {
                    obj.physics.damping = 5.0;
                }

                // 确保物理未启用（保持固有显示）
                obj.physics.enabled = false;
                obj._inPhysicsWorld = false;
                obj._physicsActive = false;
            }
        };

        this.taskQueues.submit(moveRotateTask);

        for (const other of this.objects) {
            if (other !== obj) {
                other.visualAlpha = 0.05;
                other.isVisible = false;  // [修改] 直接隐藏非聚焦物体
            }
        }

        this.ifControl = true;
    }

    /**
     * 退出 FOCUS 状态，返回 VIEW
     */
    exitFocus() {
        const obj = this.focusedObject;
        if (!obj) {
            this.enterView();
            return;
        }

        const saved = obj.getSavedPosition ? obj.getSavedPosition() : null;
        if (!saved) {
            this.enterView();
            return;
        }

        obj.animationLock = true;
        const fromPos = { x: obj.center.x, y: obj.center.y, z: obj.center.z };

        // 内部辅助函数：计算两个坐标系之间的旋转
        const calculateRotationFromTwoFrames = (cFront, cUp, tFront, tUp) => {
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
        const axisLen = 1;

        const self = this;
        const moveRotateTask = AnimationImpl.createTask({
            id: 'focus_exit_' + Date.now(),
            target: obj,
            duration: 500,
            easing: AnimationImpl.Easing.easeOut,
            compute: (progress) => ({
                progress: progress,
                position: AnimationImpl.lerpVec3(fromPos, saved, progress)
            }),
            apply: (targetObj, value) => {
                targetObj.transform.position.x = value.position.x;
                targetObj.transform.position.y = value.position.y;
                targetObj.transform.position.z = value.position.z;

                if (value.progress > 0 && value.progress <= 1 && totalAngle > 0.001 && axisLen > 0.001) {
                    const lastProgress = targetObj._lastRotProgress || 0;
                    const progressDelta = value.progress - lastProgress;
                    const rotationAmount = totalAngle * progressDelta;
                    if (rotationAmount > 0.0001) {
                        OrientationImpl.rotateObjectAroundAxis(targetObj, rotationAxis, rotationAmount);
                    }
                    targetObj._lastRotProgress = value.progress;
                } else {
                    targetObj._dirty = true;
                    targetObj.updateWorldPoints();
                }

                targetObj._lastAnimPos = { ...value.position };
            }
        });

        moveRotateTask.onComplete = () => {
            obj.animationLock = false;
            obj.clearSavedPosition?.();
            obj._savedFrontDirection = null;
            obj._restoreRotationTarget = null;
            obj._lastAnimPos = null;
            obj._lastRotProgress = null;

            // Phase 8: 清理物理临时状态
            obj._tempDisplayPoints = null;
            obj._tempRepresentation = null;
            obj._tempDisplayPointsInitialized = false;
            obj._cachedLocalPositions = null;
            obj._physicsEnabled = false;

            for (const other of self.objects) {
                if (other !== obj) {
                    other.visualAlpha = 1.0;
                    other.isVisible = true;  // [修改] 恢复所有物体可见性
                }
            }

            self.interactionState = 'VIEW';
            self.focusedObject = null;

            const radiusFinal = self._helpers.measureObjectRadius?.(obj) || 0;
            console.log(`[STATE] →VIEW: 半径=${radiusFinal.toFixed(3)}cm, center.y=${obj.center.y.toFixed(2)}`);
            self._helpers.tracePoint?.(obj, '→VIEW');
            self.ifControl = true;
        };

        this.taskQueues.submit(moveRotateTask);
    }

    /**
     * 计算屏幕中心的世界坐标
     */
    calculateCenterPosition() {
        const dirStart = this.mainWindow.direction.start;
        return { x: dirStart.x, y: dirStart.y, z: dirStart.z };
    }

    /**
     * 在 FOCUS 状态下旋转物体
     */
    rotateFocusedObject(dx, dy) {
        const obj = this.focusedObject;
        if (!obj) return;
        if (obj.animationLock) return;

        const sensitivity = 0.005;
        const win = this.mainWindow;

        const axisX = { x: win.vx.x, y: win.vx.y, z: win.vx.z };
        const axisY = { x: win.vy.x, y: win.vy.y, z: win.vy.z };

        const normX = Math.sqrt(axisX.x ** 2 + axisX.y ** 2 + axisX.z ** 2);
        const normY = Math.sqrt(axisY.x ** 2 + axisY.y ** 2 + axisY.z ** 2);
        if (normX > 0.001) { axisX.x /= normX; axisX.y /= normX; axisX.z /= normX; }
        if (normY > 0.001) { axisY.x /= normY; axisY.y /= normY; axisY.z /= normY; }

        const angleAroundScreenY = -dx * sensitivity;
        const angleAroundScreenX = dy * sensitivity;

        if (Math.abs(angleAroundScreenY) > 0.0001) {
            OrientationImpl.rotateObjectAroundAxis(obj, axisY, angleAroundScreenY);
        }
        if (Math.abs(angleAroundScreenX) > 0.0001) {
            OrientationImpl.rotateObjectAroundAxis(obj, axisX, angleAroundScreenX);
        }

        this._helpers.updateSliceContour?.();
    }
}

// 导出单例实例
export const SystemState = new SystemStateClass();
