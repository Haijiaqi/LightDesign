
import { SystemState, CONFIG } from "./SystemState.js";
import { StyleImpl } from "./StyleImpl.js";

// ========================
// 10. 渲染系统（阶段2重构：Renderer 对象封装）
// ========================
export const Renderer = {
    // 颜色 LUT 缓存
    LUT: StyleImpl.getLUT(),

    /**
     * 遍历邻接点并执行回调（零内存分配优化）
     * 替代原 getNeighbors 返回数组的方式，消除GC压力
     * @param {number} x - 中心X
     * @param {number} y - 中心Y
     * @param {number} light - 亮度
     * @param {function} callback - (nx, ny, ratio) => void
     */
    forEachNeighbor(x, y, light, callback) {
        // 规则1：light∈(0.6, 1] → 8邻接
        if (light <= 1 && light > 0.6) {
            callback(x, y - 1, 0.707);
            callback(x, y + 1, 0.707);
            callback(x - 1, y, 0.707);
            callback(x + 1, y, 0.707);
            callback(x - 1, y - 1, 0.4);
            callback(x + 1, y - 1, 0.4);
            callback(x - 1, y + 1, 0.4);
            callback(x + 1, y + 1, 0.4);
        }
        // 规则2：light∈(0.3, 0.6] → 8邻接（原逻辑中ratio未用light计算，保持一致）
        else if (light <= 0.6 && light > 0.3) {
            callback(x, y - 1, 0.707);
            callback(x, y + 1, 0.707);
            callback(x - 1, y, 0.707);
            callback(x + 1, y, 0.707);
            callback(x - 1, y - 1, 0.4);
            callback(x + 1, y - 1, 0.4);
            callback(x - 1, y + 1, 0.4);
            callback(x + 1, y + 1, 0.4);
        }
        // 规则3：light≤0.3 → 无邻接
    },

    /**
     * 绘制带颜色的点及其邻接点
     * 优化：移除 params 对象创建，直接传参
     */
    drawColoredPointImpl(ctxData, width, height, x, y, light, colorType, baseLight, maxLutIndex, drawNeighbors) {
        // 1. 跳过无效坐标
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;

        // 2. 绘制主点
        const mainBrightness = light * baseLight;
        // 快速索引计算
        const mainIdx = ((mainBrightness * 10) + 0.5) << 0; // fast round
        const clampedMainIdx = mainIdx < 0 ? 0 : (mainIdx > maxLutIndex ? maxLutIndex : mainIdx);

        // 获取颜色引用（避免解构开销）
        const lut = this.LUT[colorType];
        const color = lut[clampedMainIdx] || lut[0];

        const pixelIdx = (y * width + x) * 4;
        ctxData[pixelIdx] = color[0];
        ctxData[pixelIdx + 1] = color[1];
        ctxData[pixelIdx + 2] = color[2];
        ctxData[pixelIdx + 3] = 255;

        // 3. 绘制邻接点（仅当 drawNeighbors 为 true）
        if (drawNeighbors) {
            this.forEachNeighbor(x, y, light, (nx, ny, ratio) => {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;

                const nbBrightness = light * baseLight * ratio;
                const nbIdx = ((nbBrightness * 10) + 0.5) << 0;
                const clampedNbIdx = nbIdx < 0 ? 0 : (nbIdx > maxLutIndex ? maxLutIndex : nbIdx);

                const nbColor = lut[clampedNbIdx] || lut[0];
                const nbPixelIdx = (ny * width + nx) * 4;

                // 简单且常用的alpha混合或直接覆盖？原逻辑是直接覆盖。
                ctxData[nbPixelIdx] = nbColor[0];
                ctxData[nbPixelIdx + 1] = nbColor[1];
                ctxData[nbPixelIdx + 2] = nbColor[2];
                ctxData[nbPixelIdx + 3] = 255;
            });
        }
    },

    /**
     * 绘制主逻辑
     */
    render(ctx, width, height) {
        // 1. 初始化ImageData
        const imageData = ctx.createImageData(width, height);
        const pixelData = imageData.data;

        const win = SystemState.mainWindow;

        // 2. 遍历 windowObjects
        for (let index = 0; index < win.windowObjects.length; index++) {
            const element = win.windowObjects[index];
            const renderPoints = (element.displayPoints && element.displayPoints.length > 0)
                ? element.displayPoints
                : element.constructionPoints;

            if (!renderPoints || renderPoints.length === 0) continue;

            for (let i = 0; i < renderPoints.length; i++) {
                const p = renderPoints[i];
                if (p.xM !== 0 && p.yM !== 0) {
                    // 绘制紫色点（无视差的2D点），不开启邻接绘制
                    this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 350, false);
                }
            }
        }

        // 3. 遍历 Grid Points
        const is3D = CONFIG.displayMode !== '2D';
        const isLR = CONFIG.displayMode === '3D_LR';
        // 预计算常量
        const leftColor = isLR ? 'red' : 'blue';
        const rightColor = isLR ? 'blue' : 'red';
        const leftBase = isLR ? 35 : 50;
        const rightBase = isLR ? 50 : 35;
        const leftMax = isLR ? 350 : 500;
        const rightMax = isLR ? 500 : 350;

        for (let gridX = 0; gridX < win.grid.length; gridX++) {
            const gridCol = win.grid[gridX];
            for (let gridY = 0; gridY < gridCol.length; gridY++) {
                const pointsInGrid = gridCol[gridY];

                for (const p of pointsInGrid) {
                    // CONTROL 标签特殊渲染
                    if (p.tag === 'CONTROL') {
                        const cx = (p.xM + 0.5) << 0;
                        const cy = (p.yM + 0.5) << 0;
                        for (let dx = -1; dx <= 1; dx++) {
                            for (let dy = -1; dy <= 1; dy++) {
                                const px = cx + dx;
                                const py = cy + dy;
                                if (px < 0 || px >= width || py < 0 || py >= height) continue;
                                const idx = (py * width + px) * 4;
                                pixelData[idx] = 255;
                                pixelData[idx + 1] = 255;
                                pixelData[idx + 2] = 255;
                                pixelData[idx + 3] = 255;
                            }
                        }
                        continue;
                    }

                    if (!is3D) {
                        // 2D Mode
                        if (p.xM !== 0 && p.yM !== 0) {
                            this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 500, true);
                        }
                    } else {
                        // 3D Mode
                        if (Math.abs(p.xL - p.xR) > 0) {
                            const first = (p.xL % 2 === 0); // 简单的交错策略? 

                            // 根据 first 标志决定绘制顺序（原逻辑保留）
                            // 先绘制左眼
                            if (first && p.xL !== 0 && p.yL !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
                            }
                            // 绘制右眼
                            if (p.xR !== 0 && p.yR !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xR, p.yR, p.light, rightColor, rightBase, rightMax, true);
                            }
                            // 后绘制左眼
                            if (!first && p.xL !== 0 && p.yL !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
                            }
                        } else {
                            // 紫色点
                            if (p.xM !== 0 && p.yM !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 500, true);
                            }
                        }
                    }
                }
            }
        }

        return imageData;
    },

    /**
     * 使用固定亮度渲染单个点
     */
    renderPointSimple(p, light, pixelData, width, height) {
        const x = Math.floor(p.xM);
        const y = Math.floor(p.yM);

        if (x < 0 || x >= width || y < 0 || y >= height) return;

        // 使用现有 LUT (Renderer.LUT)
        const baseLight = 50;  // 使用 purple 的 baseLight
        const lutIndex = Math.min(
            Math.floor(light * baseLight * 10),
            this.LUT.purple.length - 1
        );
        const color = this.LUT.purple[Math.max(0, lutIndex)];

        const idx = (y * width + x) * 4;
        pixelData[idx] = color[0];      // R
        pixelData[idx + 1] = color[1];  // G
        pixelData[idx + 2] = color[2];  // B
        pixelData[idx + 3] = 255;       // A
    },

    /**
     * 渲染 screenPoints（截面轮廓等）
     */
    renderScreenPointsHelper(pixelData, width, height) {
        for (const p of SystemState.screenPoints) {
            // 执行投影
            const inverseRate = SystemState.mainWindow.calculateBasePoint(
                SystemState.mainWindow.capital,
                CONFIG.eyeD,
                SystemState.mainWindow.direction,
                p
            );
            if (inverseRate === null) continue;

            if (p.tag === 'SLICE_CONTOUR') {
                this.renderPointSimple(p, 0.8, pixelData, width, height);
            }
        }
    }
};
