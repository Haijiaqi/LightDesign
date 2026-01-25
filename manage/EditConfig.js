import { CONFIG } from "./Config.js";

/**
 * EDIT 态参数配置
 * 基于设备物理尺寸，独立于局部格网对象
 */
export const EditConfig = {
    // ===== 基础参数 (直接设定) =====

    /** 层间距（面向态），厘米 */
    spacing: 1.0,

    /** 平面高亮阈值（厘米），点到当前编辑平面的垂直距离小于此值时高亮 */
    planeHighlightThreshold: 0.15,

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

    /** 局部格网的实际边长半径 (= layerCount * spacing) */
    get localGridHalfSize() {
        return this.layerCount * this.spacing;
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
     * 根据姿态类型获取最大移动深度（局部格网的实际边界）
     * - 正面向：边长方向半径 = layerCount * spacing
     * - 棱面向：对角方向半径 = layerCount * spacing * √2
     * @param {string} orientationType - 'FACE_*' 或 'EDGE_*'
     * @returns {number} 最大深度 (厘米)
     */
    getMaxDepthForOrientation(orientationType) {
        const baseHalfSize = this.localGridHalfSize;
        if (orientationType && orientationType.includes('EDGE')) {
            return baseHalfSize * Math.SQRT2;
        }
        return baseHalfSize;
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
     * 根据姿态类型和视觉方向获取屏幕辅助格网尺寸
     * 
     * 尺寸应与局部格网匹配：
     * - FACE: 边长 = localGridHalfSize * 2 = layerCount * spacing * 2
     * - EDGE: 对角方向 = localGridHalfSize * √2 * 2
     * 
     * ⚠️ 约束：gridWidth/gridHeight 必须是对应 spacing 的整数倍
     * 
     * @param {string} type - 'FACE' 或 'EDGE'
     * @param {string} visualOrientation - 'H' 或 'V' (仅EDGE态有效)
     * @returns {{width: number, height: number}} 厘米
     */
    getGridDimensions(type, visualOrientation) {
        const s = this.spacing;
        const localHalf = this.localGridHalfSize;  // = layerCount * spacing

        if (type !== 'EDGE') {
            // FACE: 边长 = 局部格网边长
            const size = localHalf * 2;
            return { width: size, height: size };
        }

        // EDGE: 屏幕上看到局部格网的截面是菱形
        // 棱方向：边长 = localHalf * 2
        // 对角方向：= localHalf * √2 * 2
        const edgeSize = localHalf * 2;  // 沿棱方向
        const diagSize = localHalf * Math.SQRT2 * 2;  // 沿对角方向

        if (visualOrientation === 'H') {
            // EDGE-H: X沿棱, Y沿对角
            return { width: edgeSize, height: diagSize };
        }
        // EDGE-V: X沿对角, Y沿棱
        return { width: diagSize, height: edgeSize };
    }
};

