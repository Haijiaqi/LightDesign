import { SystemState, CONFIG } from "./SystemState.js";
import { StyleImpl } from "./StyleImpl.js";

export const Renderer = {
    LUT: StyleImpl.getLUT(),
    forEachNeighbor(x, y, light, callback) {
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
    },
    drawColoredPointImpl(ctxData, width, height, x, y, light, colorType, baseLight, maxLutIndex, drawNeighbors) {
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;
        const mainBrightness = light * baseLight;
        const mainIdx = ((mainBrightness * 10) + 0.5) << 0;
        const clampedMainIdx = mainIdx < 0 ? 0 : (mainIdx > maxLutIndex ? maxLutIndex : mainIdx);
        const lut = this.LUT[colorType];
        const color = lut[clampedMainIdx] || lut[0];
        const pixelIdx = (y * width + x) * 4;
        ctxData[pixelIdx] = color[0];
        ctxData[pixelIdx + 1] = color[1];
        ctxData[pixelIdx + 2] = color[2];
        ctxData[pixelIdx + 3] = 255;
        if (drawNeighbors) {
            this.forEachNeighbor(x, y, light, (nx, ny, ratio) => {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
                const nbBrightness = light * baseLight * ratio;
                const nbIdx = ((nbBrightness * 10) + 0.5) << 0;
                const clampedNbIdx = nbIdx < 0 ? 0 : (nbIdx > maxLutIndex ? maxLutIndex : nbIdx);
                const nbColor = lut[clampedNbIdx] || lut[0];
                const nbPixelIdx = (ny * width + nx) * 4;
                ctxData[nbPixelIdx] = nbColor[0];
                ctxData[nbPixelIdx + 1] = nbColor[1];
                ctxData[nbPixelIdx + 2] = nbColor[2];
                ctxData[nbPixelIdx + 3] = 255;
            });
        }
    },
    render(ctx, width, height) {
        const imageData = ctx.createImageData(width, height);
        const pixelData = imageData.data;
        const win = SystemState.mainWindow;
        for (let index = 0; index < win.windowObjects.length; index++) {
            const element = win.windowObjects[index];
            const renderPoints = (element.displayPoints && element.displayPoints.length > 0)
                ? element.displayPoints
                : element.constructionPoints;
            if (!renderPoints || renderPoints.length === 0) continue;
            for (let i = 0; i < renderPoints.length; i++) {
                const p = renderPoints[i];
                if (p.xM !== 0 && p.yM !== 0) {
                    this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 350, false);
                }
            }
        }
        const is3D = CONFIG.displayMode !== '2D';
        const isLR = CONFIG.displayMode === '3D_LR';
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
                        if (p.xM !== 0 && p.yM !== 0) {
                            this.drawColoredPointImpl(pixelData, width, height, p.xM, p.yM, p.light, 'purple', 50, 500, true);
                        }
                    } else {
                        if (Math.abs(p.xL - p.xR) > 0) {
                            const first = (p.xL % 2 === 0);
                            if (first && p.xL !== 0 && p.yL !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
                            }
                            if (p.xR !== 0 && p.yR !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xR, p.yR, p.light, rightColor, rightBase, rightMax, true);
                            }
                            if (!first && p.xL !== 0 && p.yL !== 0) {
                                this.drawColoredPointImpl(pixelData, width, height, p.xL, p.yL, p.light, leftColor, leftBase, leftMax, true);
                            }
                        } else {
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
