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

    /** 编辑区域尺寸 (直径)，厘米 - 最接近的整十厘米 */
    get size() {
        const minDim = Math.min(CONFIG.screenXLengthCm, CONFIG.screenYLengthCm);
        return Math.floor(minDim / 10) * 10;  // 向下取整到10的倍数
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
    },

    /**
     * 根据姿态类型和视觉方向获取格网间距缩放
     * 
     * ⚠️ 几何来源：ℤ³ 与编辑平面的交集
     * - 轴向步进: spacing = baseSpacing (scale = 1.0)
     * - 对角步进: spacing = baseSpacing × √2 (scale = √2)
     * 
     * @param {string} type - 'FACE' 或 'EDGE'
     * @param {string} visualOrientation - 'H' 或 'V' (仅EDGE态有效)
     * @returns {{scaleX: number, scaleY: number}}
     */
    getGridSpacingScale(type, visualOrientation) {
        if (type !== 'EDGE') {
            return { scaleX: 1.0, scaleY: 1.0 };
        }
        // EDGE-H: X轴沿棱(单位步进), Y轴沿对角(√2步进)
        if (visualOrientation === 'H') {
            return { scaleX: 1.0, scaleY: Math.SQRT2 };
        }
        // EDGE-V: X轴沿对角(√2步进), Y轴沿棱(单位步进)
        return { scaleX: Math.SQRT2, scaleY: 1.0 };
    },

    /**
     * 根据姿态类型和视觉方向获取格网尺寸
     * 
     * ⚠️ 约束：gridWidth/gridHeight 必须是对应 spacing 的整数倍
     * - FACE: 均为 baseSpacing 的整数倍
     * - EDGE-H: width = n × baseSpacing, height = m × (√2 × baseSpacing)
     * - EDGE-V: width = n × (√2 × baseSpacing), height = m × baseSpacing
     * 
     * @param {string} type - 'FACE' 或 'EDGE'
     * @param {string} visualOrientation - 'H' 或 'V' (仅EDGE态有效)
     * @returns {{width: number, height: number}} 厘米
     */
    getGridDimensions(type, visualOrientation) {
        const base = this.size;
        const s = this.spacing; // baseSpacing

        if (type !== 'EDGE') {
            // FACE: 均为 baseSpacing 的整数倍
            const w = Math.floor(base / s) * s;
            const h = Math.floor(base / s) * s;
            return { width: w, height: h };
        }

        if (visualOrientation === 'H') {
            // EDGE-H: width = n × s, height = m × (√2 × s)
            const w = Math.floor(base / s) * s;
            const hSpacing = s * Math.SQRT2;
            const h = Math.floor((base * Math.SQRT2) / hSpacing) * hSpacing;
            return { width: w, height: h };
        }

        // EDGE-V: width = n × (√2 × s), height = m × s
        const wSpacing = s * Math.SQRT2;
        const w = Math.floor((base * Math.SQRT2) / wSpacing) * wSpacing;
        const h = Math.floor(base / s) * s;
        return { width: w, height: h };
    }
};
