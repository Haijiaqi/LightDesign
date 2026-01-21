import { CONFIG } from "./Config.js";

/**
 * EDIT 态参数配置
 * 基于设备物理尺寸，独立于局部格网对象
 */
export const EditConfig = {
    // ===== 基础参数 (直接设定) =====

    /** 层间距（面向态），厘米 */
    spacing: 2.0,

    // ===== 派生参数 (基于设备尺寸) =====

    /** 编辑区域尺寸 (直径)，厘米 */
    get size() {
        const minDim = Math.min(CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
        return Math.floor(minDim);
    },

    /** 编辑区域半尺寸，厘米 */
    get halfSize() {
        return this.size / 2;
    },

    /** 层数 (派生) */
    get layerCount() {
        return Math.floor(this.halfSize / this.spacing);
    },

    // ===== 姿态适配函数 =====

    /**
     * 根据姿态类型获取层间距
     * @param {string} orientationType - 'FACE_*' 或 'EDGE_*'
     * @returns {number} 层间距 (厘米)
     */
    getLayerSpacingForOrientation(orientationType) {
        if (orientationType && orientationType.includes('EDGE')) {
            return this.spacing / Math.SQRT2;
        }
        return this.spacing;
    },

    /**
     * 根据姿态类型获取最大切片深度
     * @param {string} orientationType - 'FACE_*' 或 'EDGE_*'
     * @returns {number} 最大深度 (厘米)
     */
    getMaxDepthForOrientation(orientationType) {
        if (orientationType && orientationType.includes('EDGE')) {
            return this.halfSize * Math.SQRT2;
        }
        return this.halfSize;
    }
};
