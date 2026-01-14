/**
 * OrientationImpl.js - 姿态/旋转计算系统 (96态)
 * 
 * ============================================================================
 * 版本: v1.0
 * 日期: 2026-01-14
 * ============================================================================
 * 
 * 职责：
 * - 96个标准姿态的计算与匹配 (6面×8滚转 + 12棱×4滚转)
 * - 离散姿态状态机 (FACE/EDGE 类型转换)
 * - 物体旋转工具函数
 * - 四元数工具 (自包含)
 * 
 * 依赖：无外部依赖
 * ============================================================================
 */

export class OrientationImpl {

    // ==========================================================================
    // 姿态状态管理
    // ==========================================================================

    /** 当前视窗方向下的 96 个标准姿态列表 */
    static STATES = [];

    /** 缓存上次视窗方向避免重复计算 */
    static _lastViewDir = null;

    // ==========================================================================
    // 视窗相关姿态计算
    // ==========================================================================

    /**
     * 根据当前视窗方向计算所有标准姿态
     * @param {Object} windowDirection - 视窗方向对象 {x, y, z, start}
     */
    static computeStatesForView(windowDirection) {
        if (!windowDirection) {
            // 默认视窗：朝 +Y 看
            this._computeStatesWithViewBasis(
                { x: 1, y: 0, z: 0 },  // viewX
                { x: 0, y: 0, z: 1 },  // viewY (up)
                { x: 0, y: 1, z: 0 }   // viewZ (forward)
            );
            return;
        }

        const dir = windowDirection;
        // 检查是否需要重新计算
        if (this._lastViewDir &&
            Math.abs(this._lastViewDir.x - dir.x) < 0.001 &&
            Math.abs(this._lastViewDir.y - dir.y) < 0.001 &&
            Math.abs(this._lastViewDir.z - dir.z) < 0.001) {
            return; // 视窗方向未变，使用缓存
        }

        // 视窗 Z 轴 = 视线方向 (归一化)
        const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
        const viewZ = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

        // 视窗 Y 轴 = 世界上方 (0,0,1) 去除视线分量
        const worldUp = { x: 0, y: 0, z: 1 };
        const dotUp = worldUp.x * viewZ.x + worldUp.y * viewZ.y + worldUp.z * viewZ.z;
        let viewY = {
            x: worldUp.x - dotUp * viewZ.x,
            y: worldUp.y - dotUp * viewZ.y,
            z: worldUp.z - dotUp * viewZ.z
        };
        const lenY = Math.sqrt(viewY.x ** 2 + viewY.y ** 2 + viewY.z ** 2);
        if (lenY < 0.001) {
            // 视线垂直向上或向下，使用世界 Y 作为备选
            viewY = { x: 0, y: 1, z: 0 };
        } else {
            viewY = { x: viewY.x / lenY, y: viewY.y / lenY, z: viewY.z / lenY };
        }

        // 视窗 X 轴 = Y × Z
        const viewX = {
            x: viewY.y * viewZ.z - viewY.z * viewZ.y,
            y: viewY.z * viewZ.x - viewY.x * viewZ.z,
            z: viewY.x * viewZ.y - viewY.y * viewZ.x
        };

        this._computeStatesWithViewBasis(viewX, viewY, viewZ);
        this._lastViewDir = { x: dir.x, y: dir.y, z: dir.z };
    }

    /**
     * 使用给定的视窗坐标系基向量计算 96 个标准姿态
     * @private
     */
    static _computeStatesWithViewBasis(viewX, viewY, viewZ) {
        this.STATES = [];

        // 从视窗坐标系构建旋转矩阵 -> 四元数
        const viewQ = this._matrixToQuaternion(viewX, viewY, viewZ);

        // 基础 6 面姿态 (相对视窗坐标系的欧拉角)
        const faceOrientations = [
            { axis: 'Front', pitch: 0, yaw: 0 },
            { axis: 'Back', pitch: 0, yaw: 180 },
            { axis: 'Left', pitch: 0, yaw: 90 },
            { axis: 'Right', pitch: 0, yaw: -90 },
            { axis: 'Top', pitch: 90, yaw: 0 },
            { axis: 'Bottom', pitch: -90, yaw: 0 }
        ];

        // 12 条物理棱 (统一类型 EDGE，添加 baseVisual 属性)
        const edgeOrientations = [
            // Top face 4 edges
            { axis: 'Top-Front', pitch: 45, yaw: 0, baseVisual: 'H' },
            { axis: 'Top-Back', pitch: 45, yaw: 180, baseVisual: 'H' },
            { axis: 'Top-Left', pitch: 45, yaw: 90, baseVisual: 'H' },
            { axis: 'Top-Right', pitch: 45, yaw: -90, baseVisual: 'H' },
            // Bottom face 4 edges
            { axis: 'Bottom-Front', pitch: -45, yaw: 0, baseVisual: 'H' },
            { axis: 'Bottom-Back', pitch: -45, yaw: 180, baseVisual: 'H' },
            { axis: 'Bottom-Left', pitch: -45, yaw: 90, baseVisual: 'H' },
            { axis: 'Bottom-Right', pitch: -45, yaw: -90, baseVisual: 'H' },
            // Vertical 4 edges (connecting top to bottom)
            { axis: 'Front-Left', pitch: 0, yaw: 45, baseVisual: 'V' },
            { axis: 'Front-Right', pitch: 0, yaw: -45, baseVisual: 'V' },
            { axis: 'Back-Left', pitch: 0, yaw: 135, baseVisual: 'V' },
            { axis: 'Back-Right', pitch: 0, yaw: -135, baseVisual: 'V' }
        ];

        // 生成 48 个面态 (6 面 × 8 滚转)
        for (const face of faceOrientations) {
            const baseLocalQ = this.eulerToQuaternion(face.pitch, face.yaw, 0);

            for (let rollIdx = 0; rollIdx < 8; rollIdx++) {
                const roll = rollIdx * 45;
                const rollQ = this.eulerToQuaternion(0, 0, roll);
                const localQ = this._multiplyQuaternion(rollQ, baseLocalQ);
                const worldQ = this._multiplyQuaternion(viewQ, localQ);

                this.STATES.push({
                    type: 'FACE',
                    axis: face.axis,
                    roll: roll,
                    euler: [face.pitch, face.yaw, roll],
                    q: worldQ
                });
            }
        }

        // 生成 48 个棱态 (12 棱 × 4 滚转)
        for (const edge of edgeOrientations) {
            const baseLocalQ = this.eulerToQuaternion(edge.pitch, edge.yaw, 0);

            for (let rollIdx = 0; rollIdx < 4; rollIdx++) {
                const roll = rollIdx * 90;
                const isFlipped = (roll === 90 || roll === 270);
                const visualOrientation = isFlipped
                    ? (edge.baseVisual === 'H' ? 'V' : 'H')
                    : edge.baseVisual;

                const rollQ = this.eulerToQuaternion(0, 0, roll);
                const localQ = this._multiplyQuaternion(rollQ, baseLocalQ);
                const worldQ = this._multiplyQuaternion(viewQ, localQ);

                this.STATES.push({
                    type: 'EDGE',
                    axis: edge.axis,
                    roll: roll,
                    baseVisual: edge.baseVisual,
                    visualOrientation: visualOrientation,
                    euler: [edge.pitch, edge.yaw, roll],
                    q: worldQ
                });
            }
        }

        console.log(`OrientationImpl: 计算了 ${this.STATES.length} 个标准姿态 (视窗相对)`);
    }

    // ==========================================================================
    // 姿态匹配
    // ==========================================================================

    /**
     * 找到最近的标准姿态
     * @param {Object} currentQ - 当前四元数 {w, x, y, z}
     * @param {string[]|null} allowedTypes - 允许的类型 ['FACE', 'EDGE']
     * @param {boolean|null} requireRolled - FACE 滚转过滤
     * @param {string|null} requireVisual - EDGE 视觉朝向 'H' 或 'V'
     * @returns {Object|null} 最近的姿态状态
     */
    static getNearestState(currentQ, allowedTypes = null, requireRolled = null, requireVisual = null) {
        // 每次调用都重新计算视窗相对姿态（使用缓存）
        // 注意：需要在调用前确保已调用 computeStatesForView()

        let bestState = null;
        let maxDot = -1;
        const candidates = [];

        for (const state of this.STATES) {
            // 类型过滤
            if (allowedTypes && !allowedTypes.includes(state.type)) {
                continue;
            }

            // FACE 滚转过滤
            if (requireRolled !== null && state.type === 'FACE') {
                const isRolled = (state.roll % 90 !== 0);
                if (requireRolled && !isRolled) continue;
                if (!requireRolled && isRolled) continue;
            }

            // EDGE 视觉朝向过滤
            if (requireVisual !== null && state.type === 'EDGE') {
                if (state.visualOrientation !== requireVisual) continue;
            }

            // 四元数点积衡量相似度
            const dot = Math.abs(
                currentQ.w * state.q.w +
                currentQ.x * state.q.x +
                currentQ.y * state.q.y +
                currentQ.z * state.q.z
            );

            if (dot > maxDot) {
                maxDot = dot;
                bestState = state;
            }

            candidates.push({ state: state, dot: dot });
        }

        // 排序并打印前3个候选
        candidates.sort((a, b) => b.dot - a.dot);
        const top3 = candidates.slice(0, 3);
        const filterMsg = allowedTypes ? ` [Type:${allowedTypes}]` : '';
        const rollMsg = requireRolled !== null ? ` [Roll:${requireRolled ? 'R' : 'Std'}]` : '';
        console.log(`[NearestState] Top matches${filterMsg}${rollMsg}:`);
        top3.forEach((c, i) => {
            const rollStr = (c.state.roll % 90 !== 0) ? `(R ${c.state.roll}°)` : '';
            console.log(`  ${i + 1}. ${c.state.type} ${c.state.axis} ${rollStr} (dot=${c.dot.toFixed(5)})`);
        });

        return bestState;
    }

    /**
     * 状态流转逻辑 (离散旋转)
     * @param {string} key - 按键 ('w', 's', 'a', 'd', 'q', 'e')
     * @param {Object} obj - 物体对象
     * @param {Object} windowDirection - 视窗方向
     * @param {Function} animateCallback - 动画回调函数(obj, axis, angle, duration)
     */
    static transition(key, obj, windowDirection, animateCallback) {
        // 从当前向量推导虚拟四元数
        const currentQ = this.getQuaternionFromVectors(obj.frontDirection, obj.upDirection);

        // 获取当前状态
        let currentState = obj._currentOrientationState;
        if (!currentState) {
            this.computeStatesForView(windowDirection);
            currentState = this.getNearestState(currentQ);
            if (!currentState) return;
            obj._currentOrientationState = currentState;
        }

        const type = currentState.type;
        let axis = null;
        let angle = 0;

        // 计算视窗坐标系基向量
        let viewX, viewY, viewZ;
        if (windowDirection) {
            const dir = windowDirection;
            const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
            viewZ = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

            const worldUp = { x: 0, y: 0, z: 1 };
            const dotUp = worldUp.x * viewZ.x + worldUp.y * viewZ.y + worldUp.z * viewZ.z;
            viewY = {
                x: worldUp.x - dotUp * viewZ.x,
                y: worldUp.y - dotUp * viewZ.y,
                z: worldUp.z - dotUp * viewZ.z
            };
            const lenY = Math.sqrt(viewY.x ** 2 + viewY.y ** 2 + viewY.z ** 2);
            if (lenY < 0.001) {
                viewY = { x: 0, y: 1, z: 0 };
            } else {
                viewY = { x: viewY.x / lenY, y: viewY.y / lenY, z: viewY.z / lenY };
            }

            viewX = {
                x: viewY.y * viewZ.z - viewY.z * viewZ.y,
                y: viewY.z * viewZ.x - viewY.x * viewZ.z,
                z: viewY.x * viewZ.y - viewY.y * viewZ.x
            };
        } else {
            viewX = { x: 1, y: 0, z: 0 };
            viewY = { x: 0, y: 0, z: 1 };
            viewZ = { x: 0, y: 1, z: 0 };
        }

        // 判断状态类型
        const isRolledFace = type === 'FACE' && currentState.roll !== undefined && (currentState.roll % 90 !== 0);
        const isStandardFace = type === 'FACE' && !isRolledFace;
        const isEdgeH = type === 'EDGE' && currentState.visualOrientation === 'H';
        const isEdgeV = type === 'EDGE' && currentState.visualOrientation === 'V';

        let allowedTypes = null;
        let requireRolled = null;
        let requireVisual = null;

        // 规则表
        if (key === 'w') {
            axis = viewX;
            if (isStandardFace) { angle = 45; allowedTypes = ['EDGE']; requireVisual = 'H'; }
            else if (isRolledFace) { angle = 90; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isEdgeH) { angle = 45; allowedTypes = ['FACE']; requireRolled = false; }
            else if (isEdgeV) { angle = 90; allowedTypes = ['FACE']; requireRolled = true; }
        } else if (key === 's') {
            axis = viewX;
            if (isStandardFace) { angle = -45; allowedTypes = ['EDGE']; requireVisual = 'H'; }
            else if (isRolledFace) { angle = -90; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isEdgeH) { angle = -45; allowedTypes = ['FACE']; requireRolled = false; }
            else if (isEdgeV) { angle = -90; allowedTypes = ['FACE']; requireRolled = true; }
        } else if (key === 'a') {
            axis = viewY;
            if (isStandardFace) { angle = 45; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isRolledFace) { angle = 90; allowedTypes = ['EDGE']; requireVisual = 'H'; }
            else if (isEdgeH) { angle = 90; allowedTypes = ['FACE']; requireRolled = true; }
            else if (isEdgeV) { angle = 45; allowedTypes = ['FACE']; requireRolled = false; }
        } else if (key === 'd') {
            axis = viewY;
            if (isStandardFace) { angle = -45; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isRolledFace) { angle = -90; allowedTypes = ['EDGE']; requireVisual = 'H'; }
            else if (isEdgeH) { angle = -90; allowedTypes = ['FACE']; requireRolled = true; }
            else if (isEdgeV) { angle = -45; allowedTypes = ['FACE']; requireRolled = false; }
        } else if (key === 'q') {
            axis = viewZ;
            if (type === 'FACE') { angle = 45; allowedTypes = ['FACE']; }
            else if (isEdgeH) { angle = 90; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isEdgeV) { angle = 90; allowedTypes = ['EDGE']; requireVisual = 'H'; }
        } else if (key === 'e') {
            axis = viewZ;
            if (type === 'FACE') { angle = -45; allowedTypes = ['FACE']; }
            else if (isEdgeH) { angle = -90; allowedTypes = ['EDGE']; requireVisual = 'V'; }
            else if (isEdgeV) { angle = -90; allowedTypes = ['EDGE']; requireVisual = 'H'; }
        }

        if (!axis) return;

        // 执行旋转计算
        const angleRad = angle * Math.PI / 180;
        const halfAngle = angleRad / 2;
        const sinHalf = Math.sin(halfAngle);
        const rotQ = {
            w: Math.cos(halfAngle),
            x: axis.x * sinHalf,
            y: axis.y * sinHalf,
            z: axis.z * sinHalf
        };

        const newQ = this._multiplyQuaternion(rotQ, currentQ);

        // 吸附到最近的标准态
        const nextState = this.getNearestState(newQ, allowedTypes, requireRolled, requireVisual);
        if (nextState) {
            const fromInfo = isRolledFace ? '(R)' : '';
            const toRollInfo = (nextState.roll % 90 !== 0) ? '(R)' : '';
            console.log(`[ROTATE] ${type}${fromInfo} + ${key.toUpperCase()} ${angle}° → ${nextState.type}${toRollInfo} (${nextState.axis})`);

            obj._currentOrientationState = nextState;

            // 归一化轴
            let animAxis = { ...axis };
            const axisLen = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
            if (axisLen > 0.001) {
                animAxis.x /= axisLen; animAxis.y /= axisLen; animAxis.z /= axisLen;
            }

            // 调用动画回调
            if (animateCallback) {
                animateCallback(obj, animAxis, angleRad, 200);
            }
        }
    }

    // ==========================================================================
    // 四元数工具 (自包含)
    // ==========================================================================

    /**
     * 欧拉角转四元数 (度) YXZ 顺序
     */
    static eulerToQuaternion(pitch, yaw, roll) {
        const c1 = Math.cos(pitch * Math.PI / 360);
        const s1 = Math.sin(pitch * Math.PI / 360);
        const c2 = Math.cos(yaw * Math.PI / 360);
        const s2 = Math.sin(yaw * Math.PI / 360);
        const c3 = Math.cos(roll * Math.PI / 360);
        const s3 = Math.sin(roll * Math.PI / 360);

        return {
            w: c1 * c2 * c3 - s1 * s2 * s3,
            x: s1 * c2 * c3 + c1 * s2 * s3,
            y: c1 * s2 * c3 - s1 * c2 * s3,
            z: c1 * c2 * s3 + s1 * s2 * c3
        };
    }

    /**
     * 球面线性插值 (Slerp)
     */
    static slerp(qa, qb, t) {
        let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
        let sign = 1;
        if (dot < 0) {
            dot = -dot;
            sign = -1;
        }

        if (dot > 0.9995) {
            const result = {
                w: qa.w + t * (sign * qb.w - qa.w),
                x: qa.x + t * (sign * qb.x - qa.x),
                y: qa.y + t * (sign * qb.y - qa.y),
                z: qa.z + t * (sign * qb.z - qa.z)
            };
            return this.normalize(result);
        }

        const theta_0 = Math.acos(dot);
        const theta = theta_0 * t;
        const sin_theta = Math.sin(theta);
        const sin_theta_0 = Math.sin(theta_0);

        const s0 = Math.cos(theta) - dot * sin_theta / sin_theta_0;
        const s1 = sin_theta / sin_theta_0;

        return {
            w: s0 * qa.w + s1 * sign * qb.w,
            x: s0 * qa.x + s1 * sign * qb.x,
            y: s0 * qa.y + s1 * sign * qb.y,
            z: s0 * qa.z + s1 * sign * qb.z
        };
    }

    /**
     * 四元数归一化
     */
    static normalize(q) {
        const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
        if (len === 0) return { w: 1, x: 0, y: 0, z: 0 };
        return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
    }

    /**
     * 四元数乘法 a * b
     * @private
     */
    static _multiplyQuaternion(a, b) {
        return {
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
        };
    }

    /**
     * 从正交基向量构建四元数
     * @private
     */
    static _matrixToQuaternion(xAxis, yAxis, zAxis) {
        const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
        const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
        const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;

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

        return this.normalize({ w, x, y, z });
    }

    // ==========================================================================
    // 向量-四元数转换
    // ==========================================================================

    /**
     * 从 frontDirection + upDirection 计算四元数
     */
    static getQuaternionFromVectors(frontDir, upDir) {
        const defaultFront = { x: 0, y: 1, z: 0 };
        const defaultUp = { x: 0, y: 0, z: 1 };

        let front = frontDir ? { ...frontDir } : { ...defaultFront };
        let up = upDir ? { ...upDir } : { ...defaultUp };

        // 归一化
        let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
        if (lenF < 0.001) front = { ...defaultFront };
        else { front.x /= lenF; front.y /= lenF; front.z /= lenF; }

        let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
        if (lenU < 0.001) up = { ...defaultUp };
        else { up.x /= lenU; up.y /= lenU; up.z /= lenU; }

        // 正交化 Right = Front x Up
        let negFront = { x: -front.x, y: -front.y, z: -front.z };
        let colY = negFront;
        let colZ = up;

        let colX = {
            x: colY.y * colZ.z - colY.z * colZ.y,
            y: colY.z * colZ.x - colY.x * colZ.z,
            z: colY.x * colZ.y - colY.y * colZ.x
        };

        let lenX = Math.sqrt(colX.x ** 2 + colX.y ** 2 + colX.z ** 2);
        if (lenX < 0.001) colX = { x: 1, y: 0, z: 0 };
        else { colX.x /= lenX; colX.y /= lenX; colX.z /= lenX; }

        // 重新计算 Y 确保正交
        colY = {
            x: colZ.y * colX.z - colZ.z * colX.y,
            y: colZ.z * colX.x - colZ.x * colX.z,
            z: colZ.x * colX.y - colZ.y * colX.x
        };

        return this._matrixToQuaternion(colX, colY, colZ);
    }

    /**
     * 更新物体的姿态属性 (从四元数推导向量)
     */
    static updateObjectOrientation(obj, q) {
        if (!obj || !q) return;

        obj.quaternion = { ...q };
        const { w, x, y, z } = q;

        // Front (0, -1, 0)
        obj.frontDirection = {
            x: -2 * (x * y - w * z),
            y: -(1 - 2 * (x * x + z * z)),
            z: -2 * (y * z + w * x)
        };

        // Up (0, 0, 1)
        obj.upDirection = {
            x: 2 * (x * z + w * y),
            y: 2 * (y * z - w * x),
            z: 1 - 2 * (x * x + y * y)
        };

        // 归一化
        const norm = (v) => {
            const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            if (len > 0) { v.x /= len; v.y /= len; v.z /= len; }
        };
        norm(obj.frontDirection);
        norm(obj.upDirection);
    }

    // ==========================================================================
    // 物体旋转工具
    // ==========================================================================

    /**
     * 绕指定轴旋转物体
     * @param {Object} obj - 物体对象
     * @param {Object} axis - 旋转轴 {x, y, z}（需归一化）
     * @param {number} amount - 旋转角度（弧度）
     */
    static rotateObjectAroundAxis(obj, axis, amount) {
        const cos = Math.cos(amount);
        const sin = Math.sin(amount);
        const center = obj.center;
        const points = obj.displayPoints.length > 0 ? obj.displayPoints : obj.constructionPoints;

        for (const p of points) {
            const rx = p.x - center.x;
            const ry = p.y - center.y;
            const rz = p.z - center.z;

            const dotAxis = axis.x * rx + axis.y * ry + axis.z * rz;
            const crossX = axis.y * rz - axis.z * ry;
            const crossY = axis.z * rx - axis.x * rz;
            const crossZ = axis.x * ry - axis.y * rx;

            p.x = center.x + rx * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
            p.y = center.y + ry * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
            p.z = center.z + rz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);
        }

        // 同步旋转 frontDirection
        if (obj.frontDirection) {
            const p = obj.frontDirection;
            const px = p.x, py = p.y, pz = p.z;
            const dotAxis = axis.x * px + axis.y * py + axis.z * pz;
            const crossX = axis.y * pz - axis.z * py;
            const crossY = axis.z * px - axis.x * pz;
            const crossZ = axis.x * py - axis.y * px;

            p.x = px * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
            p.y = py * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
            p.z = pz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);

            const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            if (len > 0) { p.x /= len; p.y /= len; p.z /= len; }
        }

        // 同步旋转 upDirection
        if (obj.upDirection) {
            const p = obj.upDirection;
            const px = p.x, py = p.y, pz = p.z;
            const dotAxis = axis.x * px + axis.y * py + axis.z * pz;
            const crossX = axis.y * pz - axis.z * py;
            const crossY = axis.z * px - axis.x * pz;
            const crossZ = axis.x * py - axis.y * px;

            p.x = px * cos + crossX * sin + axis.x * dotAxis * (1 - cos);
            p.y = py * cos + crossY * sin + axis.y * dotAxis * (1 - cos);
            p.z = pz * cos + crossZ * sin + axis.z * dotAxis * (1 - cos);

            const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            if (len > 0) { p.x /= len; p.y /= len; p.z /= len; }
        }
    }

    /**
     * 旋转物体朝向目标方向
     * @param {Object} obj - 物体对象
     * @param {Object} targetFront - 目标前向 {x, y, z}
     * @param {number} amount - 旋转角度（弧度）
     */
    static rotateObjectTowardsFront(obj, targetFront, amount) {
        const current = obj.frontDirection;

        // 计算旋转轴
        const axis = {
            x: current.y * targetFront.z - current.z * targetFront.y,
            y: current.z * targetFront.x - current.x * targetFront.z,
            z: current.x * targetFront.y - current.y * targetFront.x
        };
        const axisLen = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2);
        if (axisLen < 0.001) return;

        axis.x /= axisLen;
        axis.y /= axisLen;
        axis.z /= axisLen;

        this.rotateObjectAroundAxis(obj, axis, amount);
    }

    /**
     * 应用四元数旋转到向量
     * @param {Object} v - 向量 {x, y, z}
     * @param {Object} q - 四元数 {w, x, y, z}
     * @returns {Object} 旋转后的向量
     */
    static applyQuaternion(v, q) {
        const ix = q.w * v.x + q.y * v.z - q.z * v.y;
        const iy = q.w * v.y + q.z * v.x - q.x * v.z;
        const iz = q.w * v.z + q.x * v.y - q.y * v.x;
        const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

        return {
            x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
            y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
            z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
        };
    }

    // ==========================================================================
    // 吸附与对齐
    // ==========================================================================

    /**
     * 自动吸附到最近的规范化姿态
     * @param {Object} obj - 物体对象
     * @param {Object} windowDirection - 视窗方向
     */
    static snapToNearestOrientation(obj, windowDirection) {
        const defaultFront = { x: 0, y: 1, z: 0 };
        const defaultUp = { x: 0, y: 0, z: 1 };

        let front = obj.frontDirection || { ...defaultFront };
        let up = obj.upDirection || { ...defaultUp };

        // 归一化
        let lenF = Math.sqrt(front.x ** 2 + front.y ** 2 + front.z ** 2);
        if (lenF < 0.001) front = { ...defaultFront };
        else front = { x: front.x / lenF, y: front.y / lenF, z: front.z / lenF };

        let lenU = Math.sqrt(up.x ** 2 + up.y ** 2 + up.z ** 2);
        if (lenU < 0.001) up = { ...defaultUp };
        else up = { x: up.x / lenU, y: up.y / lenU, z: up.z / lenU };

        // 正交化
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

        // 构建四元数
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
        obj.quaternion = { w: w / qLen, x: x / qLen, y: y / qLen, z: z / qLen };

        console.log('从 front+up 计算的四元数:', obj.quaternion);

        // 确保使用最新视窗
        this.computeStatesForView(windowDirection);

        const bestState = this.getNearestState(obj.quaternion);
        if (bestState) {
            console.log(`自动吸附到姿态: ${bestState.type} (${bestState.axis})`);

            const currentQ = obj.quaternion;
            const targetQ = bestState.q;

            // 计算 deltaQ
            const invCurrentQ = { w: currentQ.w, x: -currentQ.x, y: -currentQ.y, z: -currentQ.z };
            const deltaQ = this._multiplyQuaternion(targetQ, invCurrentQ);

            // 提取轴角
            const rotAngle = 2 * Math.acos(Math.max(-1, Math.min(1, deltaQ.w)));

            if (Math.abs(rotAngle) > 0.001) {
                const sinHalf = Math.sin(rotAngle / 2);
                let rotAxis;
                if (Math.abs(sinHalf) > 0.001) {
                    rotAxis = {
                        x: deltaQ.x / sinHalf,
                        y: deltaQ.y / sinHalf,
                        z: deltaQ.z / sinHalf
                    };
                } else {
                    rotAxis = { x: 0, y: 0, z: 1 };
                }

                console.log(`旋转轴: (${rotAxis.x.toFixed(2)}, ${rotAxis.y.toFixed(2)}, ${rotAxis.z.toFixed(2)}), 角度: ${(rotAngle * 180 / Math.PI).toFixed(1)}°`);

                this.rotateObjectAroundAxis(obj, rotAxis, rotAngle);
            }

            obj._currentOrientationState = bestState;
            obj.quaternion = { ...bestState.q };

            // 更新 frontDirection
            const defaultFrontVec = { x: 0, y: 1, z: 0 };
            const rotatedFront = this.applyQuaternion(defaultFrontVec, bestState.q);
            obj.frontDirection = { x: rotatedFront.x, y: rotatedFront.y, z: rotatedFront.z };

            console.log('更新后的 frontDirection:', obj.frontDirection);
        }
    }

    /**
     * 将物体中心对齐到最近的格网层
     * @param {Object} obj - 物体对象
     * @param {Object} mainWindow - 主视窗
     * @param {Object} LocalGridConfig - 格网配置
     * @param {Function} animateCallback - 动画回调 (obj, targetX, targetY, targetZ, duration)
     */
    static snapToNearestLayer(obj, mainWindow, LocalGridConfig, animateCallback) {
        if (!mainWindow || !mainWindow.direction) return;

        const dir = mainWindow.direction;
        const planePt = dir.start;

        // 获取当前姿态类型
        const orientationType = obj._currentOrientationState?.type || 'FACE';

        // 获取该姿态下的有效层间距和最大深度
        const layerSpacing = LocalGridConfig.getLayerSpacingForOrientation(orientationType);
        const maxDepth = LocalGridConfig.getMaxDepthForOrientation(orientationType);

        console.log(`[SnapLayer] Type: ${orientationType}, Spacing: ${layerSpacing.toFixed(3)}cm`);

        // 计算当前物体中心到屏幕平面的距离
        const currentDist = (obj.center.x - planePt.x) * dir.x +
            (obj.center.y - planePt.y) * dir.y +
            (obj.center.z - planePt.z) * dir.z;

        // 计算最近的有效层索引
        let nearestLayer = Math.round(currentDist / layerSpacing);

        // 限制层索引
        const maxLayer = Math.floor(maxDepth / layerSpacing);
        nearestLayer = Math.max(-maxLayer, Math.min(maxLayer, nearestLayer));

        // 目标位置
        const nearestLayerDist = nearestLayer * layerSpacing;
        const delta = nearestLayerDist - currentDist;

        if (Math.abs(delta) > 0.001) {
            const targetX = obj.center.x + delta * dir.x;
            const targetY = obj.center.y + delta * dir.y;
            const targetZ = obj.center.z + delta * dir.z;

            if (animateCallback) {
                animateCallback(obj, targetX, targetY, targetZ, 150);
            }

            console.log(`Layer snap (${orientationType}): ${currentDist.toFixed(2)}cm -> Layer ${nearestLayer} (${nearestLayerDist.toFixed(2)}cm)`);
        }
    }
}
