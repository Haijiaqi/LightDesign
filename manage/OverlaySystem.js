
import { CONFIG } from "./SystemState.js";
import { EditConfig } from "./EditConfig.js";

// =============================================================================
// 模块级缓存 (Module-level Cache)
// =============================================================================
const _gridCache = {
    valid: false,
    type: null,              // 'FACE' | 'EDGE'
    visual: null,            // 'H' | 'V' (EDGE时)
    roll: 0,                 // FACE态的Roll角度
    layerIndex: 0,           // 层级索引 (用于相位计算)
    centerScreenX: 0,
    centerScreenY: 0,
    intersections: [],
    allPixels: [],
};

// =============================================================================
// 虚线格网生成函数 (支持非对称间距、相位偏移、旋转)
// =============================================================================

/**
 * 生成屏幕坐标系的虚线格网
 * @param {object} params
 * @param {number} params.DPIx - 水平 DPI (px/cm)
 * @param {number} params.DPIy - 垂直 DPI (px/cm)
 * @param {number} params.pixelWidth - 屏幕像素宽度
 * @param {number} params.pixelHeight - 屏幕像素高度
 * @param {number} params.centerXcm - 网格中心 X (相对屏幕中心, cm)
 * @param {number} params.centerYcm - 网格中心 Y (相对屏幕中心, cm)
 * @param {number} params.gridSizeX - 网格宽度 (cm)
 * @param {number} params.gridSizeY - 网格高度 (cm)
 * @param {number} params.spacingX - 水平格线间距 (cm)
 * @param {number} params.spacingY - 垂直格线间距 (cm)
 * @param {number} params.phaseX - 水平相位偏移 (0 或 0.5)
 * @param {number} params.phaseY - 垂直相位偏移 (0 或 0.5)
 * @param {number} params.rotation - 整体旋转角度 (弧度)
 * @param {number[]} params.dashPattern - 虚线模式 [实长cm, 虚长cm]
 * @param {number} params.light - 亮度 0~1
 * @returns {{intersections: object[], allPixels: object[]}}
 */
function generateDashedGrid(params) {
    const {
        DPIx, DPIy, pixelWidth, pixelHeight,
        centerXcm, centerYcm, gridSizeX, gridSizeY,
        spacingX, spacingY, phaseX, phaseY,
        rotation = 0,
        dashPattern, light
    } = params;

    const [dashOnCm, dashOffCm] = dashPattern;
    const halfGridX = gridSizeX / 2;
    const halfGridY = gridSizeY / 2;
    const xMinCm = -halfGridX;
    const xMaxCm = halfGridX;
    const yMinCm = -halfGridY;
    const yMaxCm = halfGridY;

    const dashCycleCm = dashOnCm + dashOffCm;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const globalPointMap = new Map();

    // 将局部坐标(相对网格中心)转换为屏幕像素坐标
    const localToPixel = (lx, ly) => {
        // 先旋转
        const rx = lx * cosR - ly * sinR;
        const ry = lx * sinR + ly * cosR;
        // 平移到屏幕中心 + 网格中心偏移
        const xCm = centerXcm + rx;
        const yCm = centerYcm + ry;
        // 转像素
        const px = Math.round(pixelWidth / 2 + xCm * DPIx);
        const py = Math.round(pixelHeight / 2 - yCm * DPIy);
        return { px, py };
    };

    const createUniquePoint = (px, py, isIntersection = false) => {
        const key = `${px},${py}`;
        if (globalPointMap.has(key)) return globalPointMap.get(key);
        const point = {
            space: 'screen',
            tag: isIntersection ? 'EDIT_GRID_INTERSECTION' : 'EDIT_GRID',
            xM: px, yM: py, xL: px, xR: px, yL: py, yR: py,
            light: light,
            isIntersection,
            isAttractable: isIntersection
        };
        globalPointMap.set(key, point);
        return point;
    };

    // 虚线采样：沿着线段从start到end，按dashPattern采样
    function sampleDashedLine(startCm, endCm, onCm, offCm, cycleCm) {
        const points = [];
        if (cycleCm <= 0 || endCm <= startCm) return points;

        let pos = 0; // 从中心开始
        // 正方向
        while (pos <= endCm) {
            const segStart = pos;
            const segEnd = pos + onCm;
            if (segStart <= endCm) {
                points.push({ start: Math.max(segStart, startCm), end: Math.min(segEnd, endCm) });
            }
            pos += cycleCm;
        }
        // 负方向
        pos = -cycleCm;
        while (pos + onCm >= startCm) {
            const segStart = pos;
            const segEnd = pos + onCm;
            if (segEnd >= startCm) {
                points.push({ start: Math.max(segStart, startCm), end: Math.min(segEnd, endCm) });
            }
            pos -= cycleCm;
        }
        return points;
    }

    // 生成线位置 (考虑相位偏移)
    // phase=0: 线在 0, ±spacing, ±2*spacing, ...
    // phase=0.5: 线在 ±0.5*spacing, ±1.5*spacing, ±2.5*spacing, ...
    const verticalLinesX = [];
    const startOffsetX = phaseX * spacingX;
    for (let i = 0; ; i++) {
        const posPlus = startOffsetX + i * spacingX;
        const posMinus = -startOffsetX - i * spacingX;
        let added = false;
        if (posPlus <= xMaxCm) {
            verticalLinesX.push(posPlus);
            added = true;
        }
        // 关键修复：当 phase≠0 时，i=0 也需要添加负向线
        // 当 phase=0 时，posPlus=posMinus=0，避免重复添加
        const isDifferentFromPlus = Math.abs(posPlus - posMinus) > 0.001;
        if (isDifferentFromPlus && posMinus >= xMinCm) {
            verticalLinesX.push(posMinus);
            added = true;
        }
        if (!added) break;
        if (i > 100) break;
    }

    const horizontalLinesY = [];
    const startOffsetY = phaseY * spacingY;
    for (let i = 0; ; i++) {
        const posPlus = startOffsetY + i * spacingY;
        const posMinus = -startOffsetY - i * spacingY;
        let added = false;
        if (posPlus <= yMaxCm) {
            horizontalLinesY.push(posPlus);
            added = true;
        }
        const isDifferentFromPlus = Math.abs(posPlus - posMinus) > 0.001;
        if (isDifferentFromPlus && posMinus >= yMinCm) {
            horizontalLinesY.push(posMinus);
            added = true;
        }
        if (!added) break;
        if (i > 100) break;
    }

    // 画水平线 (Y固定，X变化)
    for (const ly of horizontalLinesY) {
        const ranges = sampleDashedLine(xMinCm, xMaxCm, dashOnCm, dashOffCm, dashCycleCm);
        for (const { start, end } of ranges) {
            // 按像素密度采样
            const stepCm = 1.0 / DPIx;
            for (let lx = start; lx <= end; lx += stepCm) {
                const { px, py } = localToPixel(lx, ly);
                createUniquePoint(px, py);
            }
        }
    }

    // 画竖直线 (X固定，Y变化)
    for (const lx of verticalLinesX) {
        const ranges = sampleDashedLine(yMinCm, yMaxCm, dashOnCm, dashOffCm, dashCycleCm);
        for (const { start, end } of ranges) {
            const stepCm = 1.0 / DPIy;
            for (let ly = start; ly <= end; ly += stepCm) {
                const { px, py } = localToPixel(lx, ly);
                createUniquePoint(px, py);
            }
        }
    }

    // 生成交点
    const intersections = [];
    for (const ly of horizontalLinesY) {
        for (const lx of verticalLinesX) {
            const { px, py } = localToPixel(lx, ly);
            const key = `${px},${py}`;
            let point = globalPointMap.get(key);
            if (!point) {
                point = createUniquePoint(px, py, true);
            } else {
                point.isIntersection = true;
                point.isAttractable = true;
                point.tag = 'EDIT_GRID_INTERSECTION';
            }
            intersections.push(point);
        }
    }

    const allPixels = Array.from(globalPointMap.values());
    return { intersections, allPixels };
}

// =============================================================================
// Overlay 类
// =============================================================================
class Overlay {
    constructor(name, updateFn) {
        this.name = name;
        this.points = [];
        this.visible = true;
        this.zIndex = 0;
        this._updateFn = updateFn;
    }

    update(win, context) {
        if (!this.visible) {
            this.points.length = 0;
            return;
        }
        if (this._updateFn) {
            this._updateFn(this, win, context);
        }
    }

    clear() {
        this.points.length = 0;
    }

    addPoint(xM, yM, xL, xR, yL, yR, tag, light = 1.0) {
        this.points.push({
            space: 'screen', tag, xM, yM, xL, xR, yL, yR, light
        });
    }
}

// =============================================================================
// OverlaySystemImpl 管理器
// =============================================================================
class OverlaySystemImpl {
    constructor() {
        this.overlays = [];
        this._initBuiltins();
    }

    _initBuiltins() {
        // === 1. Virtual Mouse Overlay ===
        const vmOverlay = new Overlay('VirtualMouse', (me, win, ctx) => {
            me.clear();
            if (!ctx.vmEnabled) return;

            let centerX = ctx.mouseX;
            let centerY = ctx.mouseY;
            let centerXL = ctx.mouseX;
            let centerXR = ctx.mouseX;
            let centerYL = ctx.mouseY;
            let centerYR = ctx.mouseY;
            let perspectiveScale = 1;

            const snapped = ctx.snappedPoint;

            if (ctx.interactionState === 'FOCUS' || ctx.interactionState === 'FOCUS_ENTERING') {
                const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
                const vmDepth = baseDis + (ctx.focusVirtualMouseDepth || 0);
                perspectiveScale = Math.max(0.1, baseDis / vmDepth);
                const halfEyeD = CONFIG.eyeD / 2;
                const disparity = halfEyeD * (1 - baseDis / vmDepth) * win.DPIx;
                centerXL = ctx.mouseX - disparity;
                centerXR = ctx.mouseX + disparity;
            } else if (snapped) {
                centerXL = snapped.xL;
                centerXR = snapped.xR;
                centerYL = snapped.yL;
                centerYR = snapped.yR;
                centerX = snapped.xM;
                centerY = snapped.yM;
                const pointDis = snapped.dis || 40;
                const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
                perspectiveScale = Math.max(0.3, Math.min(3.0, baseDis / pointDis));
            }

            const worldRadiusCm = 0.5;
            const radiusPx = worldRadiusCm * win.DPIx * perspectiveScale;
            const numPoints = 24;

            for (let i = 0; i < numPoints; i++) {
                const angle = (i / numPoints) * Math.PI * 2;
                const dx = Math.cos(angle) * radiusPx;
                const dy = Math.sin(angle) * radiusPx;
                me.addPoint(
                    centerX + dx, centerY + dy,
                    centerXL + dx, centerXR + dx,
                    centerYL + dy, centerYR + dy,
                    'VIRTUAL_MOUSE', 0.9
                );
            }
        });
        vmOverlay.zIndex = 100;
        this.add(vmOverlay);

        // === 2. Edit Assist Overlay ===
        const editAssistOverlay = new Overlay('EditAssist', (me, win, ctx) => {
            me.clear();
            if (ctx.interactionState !== 'EDIT') {
                _gridCache.valid = false;
                return;
            }

            const obj = ctx.focusedObject;
            if (!obj) return;

            // 获取姿态状态
            const state = obj._currentOrientationState;
            const type = state?.type || 'FACE';
            const visual = state?.visualOrientation || null;  // 'H' | 'V' (EDGE时)
            const roll = state?.roll || 0;  // FACE态的Roll角度

            // 获取间距缩放
            const { scaleX, scaleY } = EditConfig.getGridSpacingScale(type, visual);
            const layerSpacing = EditConfig.getLayerSpacingForOrientation(type);

            // 获取网格尺寸
            const { width: gridWidth, height: gridHeight } = EditConfig.getGridDimensions(type, visual);

            // 计算层级索引 (用于相位偏移)
            const sliceDepth = ctx.sliceDepth || 0;
            const layerIndex = Math.round(sliceDepth / layerSpacing);
            const isOddLayer = Math.abs(layerIndex) % 2 === 1;

            // 相位偏移：仅EDGE态奇数层偏移
            // 偏移方向垂直于棱的方向：
            // - EDGE_H (棱水平): 棱沿X, 偏移在Y方向
            // - EDGE_V (棱竖直): 棱沿Y, 偏移在X方向
            let phaseX = 0;
            let phaseY = 0;
            if (isOddLayer && type === 'EDGE') {
                if (visual === 'H') {
                    phaseY = 0.5;  // 水平棱态：Y方向偏移（垂直于棱）
                } else {
                    phaseX = 0.5;  // 竖直棱态：X方向偏移（垂直于棱）
                }
            }

            // DEBUG
            console.log(`[Grid] type=${type}, visual=${visual}, sliceDepth=${sliceDepth.toFixed(2)}, layerIndex=${layerIndex}, isOdd=${isOddLayer}, phaseX=${phaseX}, phaseY=${phaseY}`);

            // 旋转角度：FACE态使用Roll，EDGE态Roll归零
            const rotation = (type === 'FACE') ? (roll * Math.PI / 180) : 0;

            // 物体投影中心 (屏幕坐标)
            const objCenterScreenX = obj.center?.xM ?? (win.width / 2);
            const objCenterScreenY = obj.center?.yM ?? (win.height / 2);
            const centerXcm = (objCenterScreenX - win.width / 2) / win.DPIx;
            const centerYcm = -(objCenterScreenY - win.height / 2) / win.DPIy;

            // 检查缓存是否有效
            const cacheKeyChanged =
                _gridCache.type !== type ||
                _gridCache.visual !== visual ||
                _gridCache.roll !== roll ||
                _gridCache.layerIndex !== layerIndex ||
                Math.abs(_gridCache.centerScreenX - objCenterScreenX) > 1 ||
                Math.abs(_gridCache.centerScreenY - objCenterScreenY) > 1;

            if (!_gridCache.valid || cacheKeyChanged) {
                const baseSpacing = EditConfig.spacing;
                const spacingX = baseSpacing * scaleX;
                const spacingY = baseSpacing * scaleY;

                const result = generateDashedGrid({
                    DPIx: win.DPIx,
                    DPIy: win.DPIy,
                    pixelWidth: win.width,
                    pixelHeight: win.height,
                    centerXcm: centerXcm,
                    centerYcm: centerYcm,
                    gridSizeX: gridWidth,
                    gridSizeY: gridHeight,
                    spacingX: spacingX,
                    spacingY: spacingY,
                    phaseX: phaseX,
                    phaseY: phaseY,
                    rotation: rotation,
                    dashPattern: [0.3, 0.2],
                    light: 0.5
                });
                _gridCache.intersections = result.intersections;
                _gridCache.allPixels = result.allPixels;
                _gridCache.type = type;
                _gridCache.visual = visual;
                _gridCache.roll = roll;
                _gridCache.layerIndex = layerIndex;
                _gridCache.centerScreenX = objCenterScreenX;
                _gridCache.centerScreenY = objCenterScreenY;
                _gridCache.valid = true;
            }

            // A. 渲染格网
            for (const p of _gridCache.allPixels) {
                me.points.push(p);
            }

            // B. 截面轮廓
            if (obj.displayPoints && obj.displayPoints.length > 0) {
                const dir = win.direction;
                const planePt = dir.start;
                const threshold = layerSpacing * 0.6;
                const maxPoints = Math.min(obj.displayPoints.length, 2000);

                for (let i = 0; i < maxPoints; i++) {
                    const p = obj.displayPoints[i];
                    const dist = (p.x - planePt.x) * dir.x +
                        (p.y - planePt.y) * dir.y +
                        (p.z - planePt.z) * dir.z;
                    if (Math.abs(dist) < threshold) {
                        me.addPoint(p.xM, p.yM, p.xL, p.xR, p.yL, p.yR, 'SLICE_CONTOUR', 0.8);
                    }
                }
            }
        });
        editAssistOverlay.zIndex = 50;
        this.add(editAssistOverlay);
    }

    add(overlay) {
        this.overlays.push(overlay);
    }

    get(name) {
        return this.overlays.find(o => o.name === name);
    }

    updateAll(win, context) {
        for (const o of this.overlays) {
            o.update(win, context);
        }
    }

    getAllPoints() {
        return this.overlays
            .filter(o => o.visible)
            .sort((a, b) => a.zIndex - b.zIndex)
            .flatMap(o => o.points);
    }

    /**
     * 获取当前 EDIT 态的格网交点 (供吸附使用)
     */
    getEditGridIntersections() {
        return _gridCache.valid ? _gridCache.intersections : [];
    }
}

export const OverlaySystem = new OverlaySystemImpl();
