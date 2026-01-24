
import { CONFIG } from "./SystemState.js";
import { EditConfig } from "./EditConfig.js";


// =============================================================================
// 静态格网缓存 (Static Grid Cache)
// 使用 Int16Array 存储相对于中心的像素坐标 (Model Space Cache)
// =============================================================================
const _staticCache = {
    valid: false,
    DPIx: 0,
    DPIy: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    gridSizeX: 0,
    gridSizeY: 0,
    spacingX: 0,
    spacingY: 0,

    // 缓存池：Key = `${ type }_${ visual }_${ isOddLayer ? 'ODD' : 'EVEN' } `
    // Value = { lines: Int16Array, intersections: Int16Array }
    pool: new Map(),

    // 临时存储当前帧变换后的交点，供吸附使用
    currentIntersectionsTransformed: []
};

// =============================================================================
// 静态点云生成函数 (生成 Int16Array)
// =============================================================================
function generateStaticPointClouds(params) {
    const {
        DPIx, DPIy,
        gridSizeX, gridSizeY,
        spacingX, spacingY,
        phaseX, phaseY,
        dashPattern
    } = params;

    const [dashOnCm, dashOffCm] = dashPattern;
    const dashCycleCm = dashOnCm + dashOffCm;

    // 预估最大点数以分配 Buffer (保守估计)
    // 假设每 cm 约 DPI 个点，总长 (gridSizeX/spacingY * gridSizeY + ...)
    // 直接使用动态数组然后转 Int16Array 更简单安全
    const linesPoints = [];
    const intersectionsPoints = [];

    // 辅助：添加点到数组 (相对于中心，单位 Pixel)
    const addPixel = (array, xCm, yCm) => {
        const px = Math.round(xCm * DPIx);
        const py = Math.round(-yCm * DPIy); // Y轴向上为正，屏幕向下为正
        array.push(px, py);
    };

    // 1. 生成对称虚线段 (返回相对于线中心的 cm 偏移)
    function sampleSymmetricLineLocs(maxExtentCm, onCm, offCm, cycleCm) {
        const locs = [];
        if (cycleCm <= 0) return locs;

        // 正向
        let pos = 0;
        while (pos < maxExtentCm) {
            const segStart = pos;
            const segEnd = Math.min(pos + onCm, maxExtentCm);
            if (segEnd > segStart) {
                // 按像素步进采样
                const stepCm = 1.0 / Math.max(DPIx, DPIy);
                for (let v = segStart; v <= segEnd; v += stepCm) {
                    locs.push(v);
                }
            }
            pos += cycleCm;
        }
        // 负向
        pos = 0;
        while (pos > -maxExtentCm) {
            const segEnd = pos;
            const segStart = Math.max(pos - onCm, -maxExtentCm);
            if (segEnd > segStart) {
                const stepCm = 1.0 / Math.max(DPIx, DPIy);
                for (let v = segEnd; v >= segStart; v -= stepCm) {
                    locs.push(v);
                }
            }
            pos -= cycleCm;
        }
        return locs;
    }

    // 2. 生成网格线
    function generateLines(axisLength, lineLength, phase, spacing, isVertical) {
        const halfAxis = axisLength / 2;
        const halfLine = lineLength / 2;
        const startOffset = phase * spacing;

        for (let i = 0; ; i++) {
            const basePos = startOffset + i * spacing;
            if (basePos > halfAxis) break;

            const isCenterLine = (i === 0 && phase === 0);
            const linePositions = [];
            if (basePos <= halfAxis) linePositions.push(basePos);
            if (!isCenterLine && -basePos >= -halfAxis) linePositions.push(-basePos);

            // 获取该线的虚线采样 (一次采样，多次复用)
            // 注意：这里简化为假设 X/Y DPI 接近，使用统一采样以免逻辑过于复杂
            // 严格来说应该区分 DPIx/DPIy，但视觉上差异可忽略
            const lineSamples = sampleSymmetricLineLocs(halfLine, dashOnCm, dashOffCm, dashCycleCm);

            for (const linePos of linePositions) {
                for (const val of lineSamples) {
                    if (isVertical) {
                        addPixel(linesPoints, linePos, val); // X=LinePos, Y=Val
                    } else {
                        addPixel(linesPoints, val, linePos); // X=Val, Y=LinePos
                    }
                }
            }
            if (i > 100) break;
        }
    }

    generateLines(gridSizeX, gridSizeY, phaseX, spacingX, true);  // 竖线
    generateLines(gridSizeY, gridSizeX, phaseY, spacingY, false); // 横线

    // 3. 生成交点 (只生成用于吸附的关键点)
    const vLines = [];
    for (let i = 0; ; i++) {
        const p = phaseX * spacingX + i * spacingX;
        if (p > gridSizeX / 2) break;
        if (i === 0 && phaseX === 0) vLines.push(p);
        else { vLines.push(p); vLines.push(-p); }
        if (i > 100) break;
    }
    const hLines = [];
    for (let i = 0; ; i++) {
        const p = phaseY * spacingY + i * spacingY;
        if (p > gridSizeY / 2) break;
        if (i === 0 && phaseY === 0) hLines.push(p);
        else { hLines.push(p); hLines.push(-p); }
        if (i > 100) break;
    }

    // 中心点放第一个 (优化吸附优先级)
    addPixel(intersectionsPoints, 0, 0); // 总是尝试添加中心，后续去重或逻辑保证

    // 添加其他交点
    for (const ly of hLines) {
        for (const lx of vLines) {
            if (lx === 0 && ly === 0) continue; // 跳过中心
            addPixel(intersectionsPoints, lx, ly);
        }
    }

    return {
        lines: new Int16Array(linesPoints),
        intersections: new Int16Array(intersectionsPoints)
    };
}

// =============================================================================
// Overlay 类
// =============================================================================
class Overlay {
    constructor(name, updateFn) {
        this.name = name;
        this.points = []; // 兼容旧逻辑
        this.visible = true;
        this.zIndex = 0;
        this._updateFn = updateFn;
        // 优化接口：直接渲染回调
        this._renderToBufferFn = null;
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

    // 新增：渲染到 Buffer 接口
    renderToBuffer(pixelData, width, height, win, context) {
        if (!this.visible || !this._renderToBufferFn) return;
        this._renderToBufferFn(this, pixelData, width, height, win, context);
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
        // === 1. Virtual Mouse Overlay === (保持不变，仍使用对象点)
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


        // === 2. Edit Assist Overlay (经过深度优化) ===
        const editAssistOverlay = new Overlay('EditAssist', (me, win, ctx) => {
            // Update 阶段只计算必要的参数，不生成点
            // 但需要生成 slice contour (截面轮廓保留为对象点，因为它是动态的且点少)
            me.clear();
            if (ctx.interactionState !== 'EDIT') return;

            const obj = ctx.focusedObject;
            if (!obj) return;

            // B. 截面轮廓 (Slice Contour) - 保持动态生成
            if (obj.displayPoints && obj.displayPoints.length > 0) {
                const type = obj._currentOrientationState?.type || 'FACE';
                const layerSpacing = EditConfig.getLayerSpacingForOrientation(type);
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

        // 核心优化：直接渲染到 Buffer
        editAssistOverlay._renderToBufferFn = (me, pixelData, width, height, win, ctx) => {
            if (ctx.interactionState !== 'EDIT') return;
            const obj = ctx.focusedObject;
            if (!obj) return;

            // 1. 获取状态 Key
            const state = obj._currentOrientationState;
            const type = state?.type || 'FACE';
            const visual = state?.visualOrientation || null;
            const roll = state?.roll || 0;
            const sliceDepth = ctx.sliceDepth ?? ctx.focusSliceDepth ?? 0;
            const layerSpacing = EditConfig.getLayerSpacingForOrientation(type);
            const layerIndex = Math.round(sliceDepth / layerSpacing);
            const isOddLayer = Math.abs(layerIndex) % 2 === 1;

            // 缓存 Key
            const cacheKey = `${type}_${visual}_${isOddLayer ? 'ODD' : 'EVEN'} `;

            // 2. 检查静态缓存是否可用
            // 如果 DPI 或 grid size 变了，全清
            const dims = EditConfig.getGridDimensions(type, visual);
            if (!_staticCache.valid ||
                Math.abs(_staticCache.DPIx - win.DPIx) > 1 ||
                Math.abs(_staticCache.DPIy - win.DPIy) > 1 ||
                Math.abs(_staticCache.gridSizeX - dims.width) > 0.1 ||
                Math.abs(_staticCache.gridSizeY - dims.height) > 0.1) {
                _staticCache.pool.clear();
                _staticCache.valid = true;
                _staticCache.DPIx = win.DPIx;
                _staticCache.DPIy = win.DPIy;
                _staticCache.pixelWidth = win.width;
                _staticCache.pixelHeight = win.height;
                _staticCache.gridSizeX = dims.width;
                _staticCache.gridSizeY = dims.height;
            }

            // 3. 从 Pool 获取或生成点云
            let cloud = _staticCache.pool.get(cacheKey);
            if (!cloud) {
                // 生成新点云
                const { scaleX, scaleY } = EditConfig.getGridSpacingScale(type, visual);
                const baseSpacing = EditConfig.spacing;
                const { width: gw, height: gh } = EditConfig.getGridDimensions(type, visual);

                let phaseX = 0, phaseY = 0;
                if (isOddLayer && type === 'EDGE') {
                    if (visual === 'H') phaseY = 0.5;
                    else phaseX = 0.5;
                }

                cloud = generateStaticPointClouds({
                    DPIx: win.DPIx, DPIy: win.DPIy,
                    gridSizeX: gw, gridSizeY: gh,
                    spacingX: baseSpacing * scaleX,
                    spacingY: baseSpacing * scaleY,
                    phaseX, phaseY,
                    dashPattern: [0.3, 0.2]
                });
                _staticCache.pool.set(cacheKey, cloud);
            }

            // 4. 计算刚体变换 (2D Affine Transform)
            // [Fix] 使用垂直投影 (Orthographic Projection) 计算屏幕位置
            // 确保网格锁定在屏幕平面，不随透视深度变化而移动
            let objCenterScreenX = width / 2;
            let objCenterScreenY = height / 2;

            if (win.vx && win.vy && win.direction) {
                const dx = obj.center.x - win.direction.start.x;
                const dy = obj.center.y - win.direction.start.y;
                const dz = obj.center.z - win.direction.start.z;

                // 投影到屏幕基向量 (vx, vy)
                // offX = V dot vx
                const offX = dx * win.vx.x + dy * win.vx.y + dz * win.vx.z;
                // offY = V dot vy
                const offY = dx * win.vy.x + dy * win.vy.y + dz * win.vy.z;

                // 转屏幕像素 (遵循 Window.js 坐标系: X向右, Y向下, 原点左上)
                // Window.js: x = xlength/2 + offX (vx投影)
                // Window.js: y = ylength/2 - offY (vy投影)
                objCenterScreenX = width / 2 + offX * win.DPIx;
                objCenterScreenY = height / 2 - offY * win.DPIy;
            } else {
                // Fallback if window vectors are missing (unlikely)
                objCenterScreenX = obj.centerPoint?.xM ?? (width / 2);
                objCenterScreenY = obj.centerPoint?.yM ?? (height / 2);
            }

            // 旋转：FACE 态用 roll，EDGE 态为 0
            const rotation = (type === 'FACE') ? (roll * Math.PI / 180) : 0;
            const cosR = Math.cos(rotation);
            const sinR = Math.sin(rotation);

            // 5. 极速渲染循环 (Direct Pixel Access)
            // 颜色：紫色 (128, 0, 128) 叠加模式
            const R = 128, G = 0, B = 128;

            const drawPoints = (points) => {
                const len = points.length;
                for (let i = 0; i < len; i += 2) {
                    const lx = points[i];
                    const ly = points[i + 1];

                    // 旋转
                    const rx = lx * cosR - ly * sinR;
                    const ry = lx * sinR + ly * cosR;

                    // 平移 + 整数化
                    const px = (objCenterScreenX + rx + 0.5) | 0;
                    const py = (objCenterScreenY + ry + 0.5) | 0;

                    // 边界检查 & 写入
                    if (px >= 0 && px < width && py >= 0 && py < height) {
                        const idx = (py * width + px) * 4;
                        // Additive Blending (简单叠加)
                        pixelData[idx] = Math.min(255, pixelData[idx] + R);
                        pixelData[idx + 1] = Math.min(255, pixelData[idx + 1] + G);
                        pixelData[idx + 2] = Math.min(255, pixelData[idx + 2] + B);
                        pixelData[idx + 3] = 255;
                    }
                }
            };

            // 绘制虚线点
            drawPoints(cloud.lines);

            // 绘制交点 (加亮)
            // drawPoints(cloud.intersections); // 暂时不额外绘制交点，只用于吸附

            // TODO: 如何让交点对 `getEditGridIntersections` 可见？
            // 我们需要把变换后的交点存下来供 `InputManager` 使用
            // 这里为了性能，只在需要吸附时（InputManager调用）计算，或者简单缓存这一帧的变换结果
            // 暂存到 `_staticCache` 的临时字段
            _staticCache.currentIntersectionsTransformed = [];
            const intersections = cloud.intersections;
            const len = intersections.length;
            for (let i = 0; i < len; i += 2) {
                const lx = intersections[i];
                const ly = intersections[i + 1];
                const rx = lx * cosR - ly * sinR;
                const ry = lx * sinR + ly * cosR;
                const px = objCenterScreenX + rx;
                const py = objCenterScreenY + ry;
                // 构造伪 Point 对象供 InputManager 使用
                _staticCache.currentIntersectionsTransformed.push({
                    xM: px, yM: py, xL: px, xR: px, yL: py, yR: py,
                    isAttractable: true, isIntersection: true
                });
            }
        };

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

    // 仅获取普通 Overlay 的点 (VM, SliceContour)
    getAllPoints() {
        return this.overlays
            .filter(o => o.visible)
            .sort((a, b) => a.zIndex - b.zIndex)
            .flatMap(o => o.points);
    }

    // 新增：执行直接 buffer 渲染
    renderAllToBuffer(pixelData, width, height, win, context) {
        for (const o of this.overlays) {
            o.renderToBuffer(pixelData, width, height, win, context);
        }
    }

    /**
     * 获取当前 EDIT 态的格网交点 (供吸附使用)
     */
    getEditGridIntersections() {
        return _staticCache.currentIntersectionsTransformed || [];
    }
}

export const OverlaySystem = new OverlaySystemImpl();
