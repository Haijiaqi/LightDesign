/**
 * AnimationImpl - 动画实现类
 * 管理动画任务的创建和执行
 * 
 * 阶段 4: 基础版（仅类定义，不集成主循环）
 * 阶段 5: 集成主循环
 */
export class AnimationImpl {
    // ========== 缓动函数库 ==========
    static Easing = {
        /** 线性 */
        linear: t => t,
        /** 慢入：开始慢，逐渐加速 */
        easeIn: t => t * t,
        /** 慢出：开始快，逐渐减速 */
        easeOut: t => 1 - (1 - t) * (1 - t),
        /** 慢入慢出：开始和结束都慢 */
        easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
        /** 平滑阶跃 */
        smoothstep: t => t * t * (3 - 2 * t)
    };

    // ========== 任务 ID 生成 ==========
    static _idCounter = 0;

    /**
     * 生成唯一任务 ID
     * @returns {string} 格式: task_{counter}_{timestamp}
     */
    static generateId() {
        return `task_${++this._idCounter}_${Date.now()}`;
    }

    // ========== 任务创建 ==========

    /**
     * 创建任务对象
     * @param {Object} config 任务配置
     * @param {string} [config.id] 任务 ID（不传则自动生成）
     * @param {string} [config.type='finite'] 任务类型：'finite'(终结性) | 'continuous'(持续性)
     * @param {Object} [config.target] 目标对象
     * @param {string} [config.property] 目标属性名
     * @param {number} [config.duration=1000] 持续时间（毫秒），仅 finite 类型有效
     * @param {Function} config.compute 计算函数 (progress, worldTime, dt) => value
     * @param {Function} [config.apply] 应用函数 (target, value) => void
     * @param {Function} [config.easing] 缓动函数，默认 easeOut
     * @param {Function} [config.onStart] 开始回调 (task) => void
     * @param {Function} [config.onComplete] 完成回调 (task) => void
     * @param {Function} [config.onCancel] 取消回调 (task) => void
     * @param {Object} [config.then] 后续任务（完成后自动执行）
     * @returns {Object} 任务对象
     */
    static createTask(config) {
        return {
            id: config.id || this.generateId(),
            type: config.type || 'finite',
            target: config.target || null,
            property: config.property || null,
            duration: config.duration || 1000,
            compute: config.compute,
            apply: config.apply,
            easing: config.easing || this.Easing.easeOut,
            startTime: null,
            _started: false,
            _cancelled: false,
            onStart: config.onStart || null,
            onComplete: config.onComplete || null,
            onCancel: config.onCancel || null,
            then: config.then || null
        };
    }

    // ========== 任务执行 ==========

    /**
     * 执行单个任务
     * @param {Object} task 任务对象
     * @param {number} worldTime 当前世界时间（毫秒）
     * @param {number} dt 帧间隔（毫秒）
     * @returns {boolean} true = 任务完成或已取消，false = 任务继续
     */
    static executeTask(task, worldTime, dt) {
        // 已取消的任务直接返回完成
        if (task._cancelled) {
            if (task.onCancel) task.onCancel(task);
            return true;
        }

        // 首次执行：记录开始时间并触发回调
        if (!task._started) {
            task.startTime = worldTime;
            task._started = true;
            if (task.onStart) task.onStart(task);
        }

        const elapsed = worldTime - task.startTime;

        // 持续性任务：永不结束
        if (task.type === 'continuous') {
            const value = task.compute(0, worldTime, dt);
            if (task.apply) task.apply(task.target, value);
            return false;
        }

        // 终结性任务：计算进度
        const rawProgress = Math.min(1, elapsed / task.duration);
        const progress = task.easing(rawProgress);
        const value = task.compute(progress, worldTime, dt);

        if (task.apply) task.apply(task.target, value);

        // 检查是否完成
        if (rawProgress >= 1) {
            if (task.onComplete) task.onComplete(task);
            return true;
        }
        return false;
    }

    // ========== 预置任务工厂 ==========

    /**
     * 创建移动任务
     * @param {Object} target 目标对象（需有 center 属性）
     * @param {Object} from 起始位置 {x, y, z}
     * @param {Object} to 目标位置 {x, y, z}
     * @param {number} duration 持续时间（毫秒）
     * @param {Function} [easing] 缓动函数
     * @returns {Object} 任务对象
     */
    static createMoveTask(target, from, to, duration, easing) {
        // 记录上一帧的位置，用于计算增量
        let lastValue = { x: from.x, y: from.y, z: from.z };

        return this.createTask({
            type: 'finite',
            target,
            property: 'center',
            duration,
            easing: easing || this.Easing.easeOut,
            compute: (progress) => ({
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress,
                z: from.z + (to.z - from.z) * progress
            }),
            apply: (obj, value) => {
                // 计算本帧移动增量
                const dx = value.x - lastValue.x;
                const dy = value.y - lastValue.y;
                const dz = value.z - lastValue.z;

                // 平移所有点（displayPoints 和 constructionPoints）
                const allPoints = [
                    ...(obj.displayPoints || []),
                    ...(obj.constructionPoints || [])
                ];
                for (const p of allPoints) {
                    p.x += dx;
                    p.y += dy;
                    p.z += dz;
                }

                // 更新 center
                obj.center.x = value.x;
                obj.center.y = value.y;
                obj.center.z = value.z;

                // 更新 centerPoint（如果存在）
                if (obj.centerPoint) {
                    obj.centerPoint.x = value.x;
                    obj.centerPoint.y = value.y;
                    obj.centerPoint.z = value.z;
                }

                // 记录当前位置，用于下一帧计算增量
                lastValue = { x: value.x, y: value.y, z: value.z };
            }
        });
    }

    /**
     * 创建淡入淡出任务
     * @param {Object} target 目标对象（需有 visualAlpha 属性）
     * @param {number} fromAlpha 起始透明度 (0-1)
     * @param {number} toAlpha 目标透明度 (0-1)
     * @param {number} duration 持续时间（毫秒）
     * @param {Function} [easing] 缓动函数
     * @returns {Object} 任务对象
     */
    static createFadeTask(target, fromAlpha, toAlpha, duration, easing) {
        return this.createTask({
            type: 'finite',
            target,
            property: 'visualAlpha',
            duration,
            easing: easing || this.Easing.easeOut,
            compute: (progress) => this.lerp(fromAlpha, toAlpha, progress),
            apply: (obj, value) => {
                obj.visualAlpha = value;
            }
        });
    }

    // ========== 工具函数 ==========

    /**
     * 线性插值
     * @param {number} a 起始值
     * @param {number} b 目标值
     * @param {number} t 进度 (0-1)
     * @returns {number} 插值结果
     */
    static lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * 三维向量线性插值
     * @param {Object} a 起始向量 {x, y, z}
     * @param {Object} b 目标向量 {x, y, z}
     * @param {number} t 进度 (0-1)
     * @returns {Object} 插值结果 {x, y, z}
     */
    static lerpVec3(a, b, t) {
        return {
            x: this.lerp(a.x, b.x, t),
            y: this.lerp(a.y, b.y, t),
            z: this.lerp(a.z, b.z, t)
        };
    }
}
