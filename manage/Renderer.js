import { SystemState, CONFIG } from "./SystemState.js";
import { StyleImpl } from "./StyleImpl.js";
import { OverlaySystem } from "./OverlaySystem.js";

export const Renderer = {
    LUT: StyleImpl.getLUT(),
    forEachNeighbor(x, y, light, radius, callback) {
        // 阈值检查：如果亮度太低，不绘制邻接点
        if (light <= 0.3) return;

        // 预计算半径平方（圆形裁剪）
        // radius + 0.5 是为了让边缘平滑，容纳像素中心
        const radiusSq = (radius + 0.5) ** 2;

        // 遍历 [-radius, +radius] 范围
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;

                // 距离检查
                const distSq = dx * dx + dy * dy;
                if (distSq > radiusSq) continue;

                const dist = Math.sqrt(distSq);
                let ratio;

                // [动态衰减策略]
                // 根据 radius 大小选择不同的亮度分布曲线

                if (radius < 4) {
                    // === 策略 A: 经典模式 (Radius 1~3) ===
                    // 严格保持用户定义的经典衰减，确保原有视觉一致性
                    // 中心: 100%
                    // 正向(1.0): 70% | 对角(1.4): 40%
                    // 次外(2.0): 30% | 最外(>2.0): 15%
                    if (dist <= 1.1) {
                        ratio = 0.7;
                    } else if (dist <= 1.5) {
                        ratio = 0.4;
                    } else if (dist <= 2.1) {
                        ratio = 0.3;
                    } else {
                        ratio = 0.15;
                    }
                } else {
                    // === 策略 C: 饱和光斑 (Radius >= 4) ===
                    // 适用于控制点/强光源
                    // 核心区域饱和，形成明显的实心亮点
                    if (dist <= 1.5) {
                        ratio = 1.0;  // 3x3 核心区域全亮
                    } else if (dist <= 2.5) {
                        ratio = 0.8;  // 5x5 区域高亮
                    } else {
                        // 外围衰减: dist 2.5 -> radius，亮度 0.6 -> 0.05
                        const range = Math.max(0.1, radius - 2.5);
                        const norm = (dist - 2.5) / range;
                        // 使用平滑衰减
                        ratio = 0.6 * (1 - norm * norm);
                    }
                }

                // 钳制最小值，避免负数或无效绘制
                ratio = Math.max(0.05, ratio);

                const nx = x + dx;
                const ny = y + dy;

                callback(nx, ny, ratio);
            }
        }
    },

    drawColoredPointImpl(ctxData, width, height, x, y, light, colorType, baseLight, maxLutIndex, neighborRadius) {
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;

        const mainBrightness = light * baseLight;
        const mainIdx = ((mainBrightness * 10) + 0.5) << 0;
        const clampedMainIdx = mainIdx < 0 ? 0 : (mainIdx > maxLutIndex ? maxLutIndex : mainIdx);

        const lut = this.LUT[colorType];
        const color = lut[clampedMainIdx] || lut[0];

        const pixelIdx = (y * width + x) * 4;

        // 使用叠加模式 (Additive Blending) 实现红蓝叠加变紫
        ctxData[pixelIdx] = Math.min(255, ctxData[pixelIdx] + color[0]);
        ctxData[pixelIdx + 1] = Math.min(255, ctxData[pixelIdx + 1] + color[1]);
        ctxData[pixelIdx + 2] = Math.min(255, ctxData[pixelIdx + 2] + color[2]);
        ctxData[pixelIdx + 3] = 255; // Alpha 始终 255

        if (neighborRadius > 0) {
            this.forEachNeighbor(x, y, light, neighborRadius, (nx, ny, ratio) => {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;

                const nbBrightness = light * baseLight * ratio;
                const nbIdx = ((nbBrightness * 10) + 0.5) << 0;
                const clampedNbIdx = nbIdx < 0 ? 0 : (nbIdx > maxLutIndex ? maxLutIndex : nbIdx);

                const nbColor = lut[clampedNbIdx] || lut[0];
                const nbPixelIdx = (ny * width + nx) * 4;

                // 邻接点也使用叠加模式
                ctxData[nbPixelIdx] = Math.min(255, ctxData[nbPixelIdx] + nbColor[0]);
                ctxData[nbPixelIdx + 1] = Math.min(255, ctxData[nbPixelIdx + 1] + nbColor[1]);
                ctxData[nbPixelIdx + 2] = Math.min(255, ctxData[nbPixelIdx + 2] + nbColor[2]);
                ctxData[nbPixelIdx + 3] = 255;
            });
        }
    },
    render(ctx, width, height) {
        // [OPTIMIZATION A] 复用 ImageData
        let imageData = SystemState.imageData;
        if (!imageData || imageData.width !== width || imageData.height !== height) {
            imageData = ctx.createImageData(width, height);
            SystemState.imageData = imageData;
        } else {
            // 手动清空 buffer (alpha设为0 或 全0)
            // fill(0) 是最快的清空方式
            new Int32Array(imageData.data.buffer).fill(0);
        }

        const pixelData = imageData.data;
        const win = SystemState.mainWindow;
        const displayMode = CONFIG.displayMode;

        // 预渲染：displayPoints（2D/紫色）
        for (let index = 0; index < win.windowObjects.length; index++) {
            const element = win.windowObjects[index];
            const renderPoints = (element.displayPoints && element.displayPoints.length > 0)
                ? element.displayPoints
                : element.constructionPoints;
            if (!renderPoints || renderPoints.length === 0) continue;
            for (let i = 0; i < renderPoints.length; i++) {
                const p = renderPoints[i];
                if (p.xM !== 0 && p.yM !== 0) {
                    const style = StyleImpl.resolvePointStyle({
                        tag: p.tag,
                        light: p.light,
                        displayMode,
                        hasDisparity: false
                    });
                    this.drawColoredPointImpl(
                        pixelData, width, height, p.xM, p.yM,
                        style.effectiveLight,
                        style.mono.colorType,
                        style.mono.base,
                        style.mono.maxIndex,
                        style.neighborRadius
                    );
                }
            }
        }

        // 主渲染：grid 中的点
        for (let gridX = 0; gridX < win.grid.length; gridX++) {
            const gridCol = win.grid[gridX];
            for (let gridY = 0; gridY < gridCol.length; gridY++) {
                const pointsInGrid = gridCol[gridY];
                for (const p of pointsInGrid) {
                    // [FIX] 跳过 light=0 的点（不可见的局部格网点）
                    if (p.light <= 0) continue;

                    const hasDisparity = Math.abs((p.xL || 0) - (p.xR || 0)) > 0;
                    const style = StyleImpl.resolvePointStyle({
                        tag: p.tag,
                        light: p.light,
                        displayMode,
                        hasDisparity
                    });

                    if (style.hasDisparity) {
                        // 立体渲染：左右眼分离，始终先左后右（避免顺序抖动导致闪烁）
                        if (p.xL !== 0 && p.yL !== 0) {
                            this.drawColoredPointImpl(
                                pixelData, width, height, p.xL, p.yL,
                                style.effectiveLight,
                                style.left.colorType,
                                style.left.base,
                                style.left.maxIndex,
                                style.neighborRadius
                            );
                        }
                        if (p.xR !== 0 && p.yR !== 0) {
                            this.drawColoredPointImpl(
                                pixelData, width, height, p.xR, p.yR,
                                style.effectiveLight,
                                style.right.colorType,
                                style.right.base,
                                style.right.maxIndex,
                                style.neighborRadius
                            );
                        }
                    } else {
                        // 单色渲染
                        if (p.xM !== 0 && p.yM !== 0) {
                            this.drawColoredPointImpl(
                                pixelData, width, height, p.xM, p.yM,
                                style.effectiveLight,
                                style.mono.colorType,
                                style.mono.base,
                                style.mono.maxIndex,
                                style.neighborRadius
                            );
                        }
                    }
                }
            }
        }

        // [OPTIMIZATION B] OverlaySystem 直接 Buffer 渲染
        // 在所有 3D 点绘制完毕后，直接叠加辅助格网
        OverlaySystem.renderAllToBuffer(pixelData, width, height, win, SystemState);
        return imageData;
    },
    renderPointSimple(p, light, pixelData, width, height) {
        const x = Math.floor(p.xM);
        const y = Math.floor(p.yM);
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const baseLight = 50;
        const lutIndex = Math.min(
            Math.floor(light * baseLight * 10),
            this.LUT.purple.length - 1
        );
        const color = this.LUT.purple[Math.max(0, lutIndex)];
        const idx = (y * width + x) * 4;
        pixelData[idx] = color[0];
        pixelData[idx + 1] = color[1];
        pixelData[idx + 2] = color[2];
        pixelData[idx + 3] = 255;
    },
    renderScreenPointsHelper(pixelData, width, height) {
        for (const p of SystemState.screenPoints) {
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
    },
    renderScreenPixel(x, y, colorType, light, pixelData, width, height) {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const baseLight = colorType === 'red' ? 35 : 50;
        const lutIndex = Math.min(
            Math.floor(light * baseLight * 10),
            this.LUT[colorType].length - 1
        );
        const color = this.LUT[colorType][Math.max(0, lutIndex)];
        const idx = (y * width + x) * 4;
        pixelData[idx] = color[0];
        pixelData[idx + 1] = color[1];
        pixelData[idx + 2] = color[2];
        pixelData[idx + 3] = 255;
    }
};
