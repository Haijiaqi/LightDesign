/**
 * HistoryManager - 撤销/重做管理器
 * 
 * 设计原则：
 * - 无继承：命令是包含 { execute(), undo(), description } 的普通对象
 * - 函数式：命令通过工厂函数创建，闭包捕获状态
 * - 独立性：不依赖其他类，仅被其他模块依赖
 * 
 * 使用方式：
 * import { HistoryManager, createMoveCommand } from './HistoryManager.js';
 * HistoryManager.execute(createMoveCommand(obj, fromPos, toPos));
 * HistoryManager.undo();
 * HistoryManager.redo();
 */

// ============================================================================
// HISTORY MANAGER (SINGLETON OBJECT)
// ============================================================================

export const HistoryManager = {
    /** @type {Array<{execute: Function, undo: Function, description: string}>} */
    undoStack: [],

    /** @type {Array<{execute: Function, undo: Function, description: string}>} */
    redoStack: [],

    /** 最大历史记录数 */
    maxSize: 50,

    /**
     * 执行命令并记录到撤销栈
     * @param {{execute: Function, undo: Function, description: string}} command
     */
    execute(command) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // 新操作清空重做栈
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        console.log(`[History] 执行: ${command.description}`);
    },

    /**
     * 撤销上一个操作
     * @returns {boolean} 是否成功撤销
     */
    undo() {
        const cmd = this.undoStack.pop();
        if (cmd) {
            cmd.undo();
            this.redoStack.push(cmd);
            console.log(`[History] 撤销: ${cmd.description}`);
            return true;
        }
        console.log('[History] 无可撤销操作');
        return false;
    },

    /**
     * 重做上一个撤销的操作
     * @returns {boolean} 是否成功重做
     */
    redo() {
        const cmd = this.redoStack.pop();
        if (cmd) {
            cmd.execute();
            this.undoStack.push(cmd);
            console.log(`[History] 重做: ${cmd.description}`);
            return true;
        }
        console.log('[History] 无可重做操作');
        return false;
    },

    /**
     * 是否可以撤销
     */
    canUndo() {
        return this.undoStack.length > 0;
    },

    /**
     * 是否可以重做
     */
    canRedo() {
        return this.redoStack.length > 0;
    },

    /**
     * 清空历史记录
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        console.log('[History] 历史记录已清空');
    },

    /**
     * 获取历史状态信息（用于调试/UI）
     */
    getStatus() {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            lastUndo: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].description : null,
            lastRedo: this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].description : null,
        };
    }
};

// ============================================================================
// COMMAND FACTORY FUNCTIONS
// ============================================================================

/**
 * 创建移动物体命令
 * @param {Object} obj - 物体对象（需要有 transform.position 和 updateWorldPoints）
 * @param {{x: number, y: number, z: number}} fromPos - 原始位置
 * @param {{x: number, y: number, z: number}} toPos - 目标位置
 */
export function createMoveCommand(obj, fromPos, toPos) {
    const name = obj.metadata?.name || '物体';
    return {
        description: `移动 ${name}`,
        execute() {
            if (obj.transform) {
                obj.transform.position.x = toPos.x;
                obj.transform.position.y = toPos.y;
                obj.transform.position.z = toPos.z;
                obj._dirty = true;
                if (obj.updateWorldPoints) obj.updateWorldPoints();
            }
        },
        undo() {
            if (obj.transform) {
                obj.transform.position.x = fromPos.x;
                obj.transform.position.y = fromPos.y;
                obj.transform.position.z = fromPos.z;
                obj._dirty = true;
                if (obj.updateWorldPoints) obj.updateWorldPoints();
            }
        }
    };
}

/**
 * 创建旋转物体命令（记录旋转前后的四元数状态）
 * @param {Object} obj - 物体对象
 * @param {{w: number, x: number, y: number, z: number}} fromQuat - 原始四元数
 * @param {{w: number, x: number, y: number, z: number}} toQuat - 目标四元数
 * @param {{x: number, y: number, z: number}} fromFront - 原始 frontDirection
 * @param {{x: number, y: number, z: number}} toFront - 目标 frontDirection
 * @param {{x: number, y: number, z: number}} fromUp - 原始 upDirection
 * @param {{x: number, y: number, z: number}} toUp - 目标 upDirection
 */
export function createRotateCommand(obj, fromQuat, toQuat, fromFront, toFront, fromUp, toUp) {
    const name = obj.metadata?.name || '物体';
    return {
        description: `旋转 ${name}`,
        execute() {
            if (obj.transform && obj.transform.rotation) {
                Object.assign(obj.transform.rotation, toQuat);
            }
            if (obj.frontDirection) Object.assign(obj.frontDirection, toFront);
            if (obj.upDirection) Object.assign(obj.upDirection, toUp);
            obj._dirty = true;
            if (obj.updateWorldPoints) obj.updateWorldPoints();
        },
        undo() {
            if (obj.transform && obj.transform.rotation) {
                Object.assign(obj.transform.rotation, fromQuat);
            }
            if (obj.frontDirection) Object.assign(obj.frontDirection, fromFront);
            if (obj.upDirection) Object.assign(obj.upDirection, fromUp);
            obj._dirty = true;
            if (obj.updateWorldPoints) obj.updateWorldPoints();
        }
    };
}

/**
 * 创建添加控制点命令
 * @param {Object} obj - 物体对象
 * @param {Object} point - 控制点对象
 * @param {number} index - 插入位置（-1 表示末尾）
 */
export function createAddControlPointCommand(obj, point, index = -1) {
    const name = obj.metadata?.name || '物体';
    let insertedIndex = index;
    return {
        description: `添加控制点到 ${name}`,
        execute() {
            if (!obj.controlPoints) obj.controlPoints = [];
            if (insertedIndex < 0 || insertedIndex >= obj.controlPoints.length) {
                obj.controlPoints.push(point);
                insertedIndex = obj.controlPoints.length - 1;
            } else {
                obj.controlPoints.splice(insertedIndex, 0, point);
            }
            // [FIX] 通知控制点改变，清除拟合缓存
            if (obj._onControlPointsChanged) {
                obj._onControlPointsChanged(); // 添加点需要清除所有缓存
            }
            // [FIX] 更新世界坐标，确保新点能被正确投影
            obj._dirty = true;  // 强制更新
            if (obj.updateWorldPoints) {
                obj.updateWorldPoints();
            }
        },
        undo() {
            if (obj.controlPoints && insertedIndex >= 0 && insertedIndex < obj.controlPoints.length) {
                obj.controlPoints.splice(insertedIndex, 1);
                // [FIX] 撤销添加后也需要通知
                if (obj._onControlPointsChanged) {
                    obj._onControlPointsChanged();
                }
                // 更新世界坐标
                obj._dirty = true;
                if (obj.updateWorldPoints) {
                    obj.updateWorldPoints();
                }
            }
        }
    };
}

/**
 * 创建删除控制点命令
 * @param {Object} obj - 物体对象
 * @param {number} index - 删除位置
 */
export function createDeleteControlPointCommand(obj, index) {
    const name = obj.metadata?.name || '物体';
    let deletedPoint = null;
    return {
        description: `删除 ${name} 的控制点`,
        execute() {
            if (obj.controlPoints && index >= 0 && index < obj.controlPoints.length) {
                deletedPoint = obj.controlPoints[index];
                obj.controlPoints.splice(index, 1);
                // [FIX] 通知控制点改变，清除拟合缓存
                if (obj._onControlPointsChanged) {
                    obj._onControlPointsChanged(); // 删除点需要清除所有缓存
                }
                // 更新世界坐标
                obj._dirty = true;
                if (obj.updateWorldPoints) {
                    obj.updateWorldPoints();
                }
            }
        },
        undo() {
            if (deletedPoint && obj.controlPoints) {
                obj.controlPoints.splice(index, 0, deletedPoint);
                // [FIX] 恢复点后也需要通知
                if (obj._onControlPointsChanged) {
                    obj._onControlPointsChanged();
                }
                // 更新世界坐标
                obj._dirty = true;
                if (obj.updateWorldPoints) {
                    obj.updateWorldPoints();
                }
            }
        }
    };
}

export function createMoveControlPointCommand(obj, controlPoint, fromLocal, toLocal) {
    const name = obj.metadata?.name || '物体';
    return {
        description: `移动 ${name} 控制点`,
        execute() {
            if (controlPoint) {
                controlPoint.lx = toLocal.x;
                controlPoint.ly = toLocal.y;
                controlPoint.lz = toLocal.z;
                obj._dirty = true;
                if (obj.updateWorldPoints) obj.updateWorldPoints();
                obj._needsRefit = true;
            }
        },
        undo() {
            if (controlPoint) {
                controlPoint.lx = fromLocal.x;
                controlPoint.ly = fromLocal.y;
                controlPoint.lz = fromLocal.z;
                obj._dirty = true;
                if (obj.updateWorldPoints) obj.updateWorldPoints();
                obj._needsRefit = true;
            }
        }
    };
}

/**
 * 创建复合命令（多个命令作为单个撤销单元）
 * @param {string} description - 命令描述
 * @param {Array<{execute: Function, undo: Function}>} commands - 子命令数组
 */
export function createCompositeCommand(description, commands) {
    return {
        description,
        execute() {
            for (const cmd of commands) {
                cmd.execute();
            }
        },
        undo() {
            // 逆序撤销
            for (let i = commands.length - 1; i >= 0; i--) {
                commands[i].undo();
            }
        }
    };
}
