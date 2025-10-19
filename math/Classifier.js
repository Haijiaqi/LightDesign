import { Object } from '../base/Object.js';
import { Window } from '../base/Window.js';
export class Classifier {
    constructor() {
        this.dataList = [];
    }
    filldata(data, test, width, height) {
        const dirs = [[0,0], [-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
        test.allBluePoints.forEach(p => {
            const x = Math.round(p.x), y = Math.round(p.y);
            dirs.forEach(([dx, dy]) => {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const i = (ny * width + nx) * 4;
                    if (dx === 0 && dy === 0) {
                        data[i] = 0; data[i+1] = 0; data[i+2] = 255; data[i+3] = 255;
                    } else {
                        data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
                    }
                }
            });
        });
        test.allRedPoints.forEach(p => {
            const x = Math.round(p.x), y = Math.round(p.y);
            dirs.forEach(([dx, dy]) => {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const i = (ny * width + nx) * 4;
                    if (dx === 0 && dy === 0) {
                        data[i] = 255; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
                    } else {
                        data[i] = 255; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
                    }
                }
            });
        });
    }
    filldata1(data, test, width) {
        const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        test.allBluePoints.forEach(([x,y]) => {
            const idx = (y * width + x) * 4;
            data[idx] = 0; data[idx+1] = 0; data[idx+2] = 255; data[idx+3] = 255;
            dirs.forEach(([dx,dy]) => {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < data.length / (4 * width)) {
                    const nidx = (ny * width + nx) * 4;
                    data[nidx] = 255; data[nidx+1] = 255; data[nidx+2] = 255; data[nidx+3] = 255;
                }
            });
        });
        test.allRedPoints.forEach(([x,y]) => {
            const idx = (y * width + x) * 4;
            data[idx] = 255; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 255;
            dirs.forEach(([dx,dy]) => {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < data.length / (4 * width)) {
                    const nidx = (ny * width + nx) * 4;
                    data[nidx] = 255; data[nidx+1] = 255; data[nidx+2] = 255; data[nidx+3] = 255;
                }
            });
        });
    }
    updateCameraDisplay(SystemState, test) {
        if (!SystemState.videoDisplayCanvas || !SystemState.videoDisplayCtx || !SystemState.video) {
            // console.warn("摄像头显示画布或视频未就绪，跳过更新。");
            return;
        }

        if (SystemState.video.readyState === SystemState.video.HAVE_ENOUGH_DATA) {
            // 确保显示画布尺寸与视频一致 (以防视频尺寸变化)
            if (SystemState.videoDisplayCanvas.width !== SystemState.video.videoWidth ||
                SystemState.videoDisplayCanvas.height !== SystemState.video.videoHeight) {
                SystemState.videoDisplayCanvas.width = SystemState.video.videoWidth;
                SystemState.videoDisplayCanvas.height = SystemState.video.videoHeight;
            }

            SystemState.videoDisplayCtx.drawImage(SystemState.video, 0, 0, SystemState.videoDisplayCanvas.width, SystemState.videoDisplayCanvas.height);
            // 方式 B: 获取 ImageData 并修改像素 (性能较低，但更灵活)
            const imageData = SystemState.videoDisplayCtx.getImageData(0, 0, SystemState.videoDisplayCanvas.width, SystemState.videoDisplayCanvas.height);
            const data = imageData.data;

            // 例如：将图像左上角 100x100 区域的红色通道设为 255
            const regionWidth = 300;
            const regionHeight = 300;
            for (let y = 0; y < regionHeight; y++) {
                for (let x = 0; x < regionWidth; x++) {
                    const index = (y * SystemState.videoDisplayCanvas.width + x) * 4; // 每个像素4个值 (R, G, B, A)
                    // data[index] = 255; // R
                    // data[index + 1] = 0; // G (可选)
                    // data[index + 2] = 0; // B (可选)
                    // data[index + 3] = 255; // A (可选)
                }
            }
            if (test) {
                // debugger;
                this.filldata(data, test, SystemState.videoDisplayCanvas.width, 480);
            }
            

            // 将修改后的 ImageData 写回 canvas
            SystemState.videoDisplayCtx.putImageData(imageData, 0, 0);
            // 将当前视频帧绘制到摄像头显示画布上
            // console.log("摄像头画面已更新到显示画布。");
        } else {
            // console.debug("视频数据不足，无法更新摄像头画面。");
        }
    }
    /**
     * 处理摄像头图像数据，执行复杂的颜色点搜索和几何计算。
     * @param {Uint8ClampedArray} data - 图像的像素数据 (RGBA 格式)
     * @param {number} width - 图像宽度 (像素)
     * @param {number} height - 图像高度 (像素)
     * @returns {Object|null} 计算结果对象，如果未找到有效模式则返回 null
     */
    processImageFromCamera(data, width, height) {
        console.group("=== processImageFromCamera 开始 ===");
        // console.log("图像尺寸:", width, "x", height);

        // 1. 定义目标颜色 (HSL 范围) 和容差
        // 蓝色 (A色): 色相 ~240, 饱和度高, 亮度中等偏低 (偏暗)
        const BLUE_HUE = 240;
        const BLUE_HUE_TOLERANCE = 100; // 色相容差 ±30
        const BLUE_MIN_SATURATION = 0.5; // 最小饱和度
        const BLUE_MIN_VALUE = 0.00; // 最小亮度 (偏暗)
        const BLUE_MAX_VALUE = 0.45; // 最大亮度

        // 红色 (B色): 色相 ~0 或 360, 饱和度高, 亮度中等偏低 (偏暗)
        const RED_HUE = 0; // 0 和 360 都是红色
        const RED_HUE_TOLERANCE = 70; // 色相容差 ±30
        const RED_MIN_SATURATION = 0.70; // 最小饱和度
        const RED_MIN_VALUE = 0.00; // 最小亮度 (偏暗)
        const RED_MAX_VALUE = 0.5; // 最大亮度

        /**
         * 将 RGB 值转换为 HSV。
         * @param {number} r - 红色分量 (0-255)
         * @param {number} g - 绿色分量 (0-255)
         * @param {number} b - 蓝色分量 (0-255)
         * @returns {{h: number, s: number, v: number}} HSV 对象
         */
        function rgbToHsv(r, g, b) {
            r /= 255;
            g /= 255;
            b /= 255;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const delta = max - min;

            let h = 0, s = 0, v = max;

            if (delta !== 0) {
                s = delta / max;
                if (max === r) {
                    h = ((g - b) / delta) % 6;
                } else if (max === g) {
                    h = (b - r) / delta + 2;
                } else {
                    h = (r - g) / delta + 4;
                }
                h = Math.round(h * 60);
                if (h < 0) h += 360;
            }

            return { h, s, v };
        }
        /**
         * 检查一个像素是否是目标蓝色（同时排除红色条件）
         */
        function isBlue(r, g, b) {
            const hsv = rgbToHsv(r, g, b);
            // 蓝色基础条件
            const hueMatchBlue = Math.abs(hsv.h - BLUE_HUE) <= BLUE_HUE_TOLERANCE || 
                            Math.abs(hsv.h - (BLUE_HUE - 360)) <= BLUE_HUE_TOLERANCE;
            const isBlueBase = hueMatchBlue && 
                            hsv.s >= BLUE_MIN_SATURATION && 
                            hsv.v >= BLUE_MIN_VALUE && 
                            hsv.v <= BLUE_MAX_VALUE;
            if (!isBlueBase) return false;

            // 排除红色条件（直接判断，不调用 isRed）
            const hueDiffRed = Math.min(Math.abs(hsv.h - RED_HUE), Math.abs(hsv.h - 360));
            const hueMatchRed = hueDiffRed <= RED_HUE_TOLERANCE;
            const isRedBase = hueMatchRed && 
                            hsv.s >= RED_MIN_SATURATION && 
                            hsv.v >= RED_MIN_VALUE && 
                            hsv.v <= RED_MAX_VALUE;
            return !isRedBase; // 不是红色才视为有效蓝色
        }

        /**
         * 检查一个像素是否是目标红色（同时排除蓝色条件）
         */
        function isRed(r, g, b) {
            const hsv = rgbToHsv(r, g, b);
            // 红色基础条件
            const hueDiffRed = Math.min(Math.abs(hsv.h - RED_HUE), Math.abs(hsv.h - 360));
            const hueMatchRed = hueDiffRed <= RED_HUE_TOLERANCE;
            const isRedBase = hueMatchRed && 
                            hsv.s >= RED_MIN_SATURATION && 
                            hsv.v >= RED_MIN_VALUE && 
                            hsv.v <= RED_MAX_VALUE;
            if (!isRedBase) return false;

            // 排除蓝色条件（直接判断，不调用 isBlue）
            const hueMatchBlue = Math.abs(hsv.h - BLUE_HUE) <= BLUE_HUE_TOLERANCE || 
                            Math.abs(hsv.h - (BLUE_HUE - 360)) <= BLUE_HUE_TOLERANCE;
            const isBlueBase = hueMatchBlue && 
                            hsv.s >= BLUE_MIN_SATURATION && 
                            hsv.v >= BLUE_MIN_VALUE && 
                            hsv.v <= BLUE_MAX_VALUE;
            return !isBlueBase; // 不是蓝色才视为有效红色
        }

        /**
         * 从像素数据中获取指定坐标的 RGB 值。
         */
        function getPixel(x, y) {
            if (x < 0 || x >= width || y < 0 || y >= height) {
                return { r: 0, g: 0, b: 0, valid: false };
            }
            const index = (y * width + x) * 4;
            return {
                r: data[index],
                g: data[index + 1],
                b: data[index + 2],
                valid: true
            };
        }

        /**
         * 在指定区域内搜索特定颜色的点。
         * @param {number} startX - 起始 X
         * @param {number} startY - 起始 Y
         * @param {number} radius - 搜索半径 (格子数)
         * @param {Function} isTargetColor - 颜色判断函数
         * @param {number} gridWidth - 格子宽度
         * @param {number} gridHeight - 格子高度
         * @returns {{x: number, y: number, gx: number, gy: number}|null} 找到的点或 null
         */
        function searchColorInGrid(startX, startY, radius, isTargetColor, gridWidth, gridHeight) {
            const startGx = Math.floor(startX / gridWidth);
            const startGy = Math.floor(startY / gridHeight);

            // 1. 获取中心像素颜色，计算明暗（灰度值）用于确定起始方向
            const centerPixel = getPixel(startX, startY);
            const gray = centerPixel.valid 
                ? 0.299 * centerPixel.r + 0.587 * centerPixel.g + 0.114 * centerPixel.b  // 灰度公式
                : 128;  // 无效像素默认中间值
            const dirIndex = Math.floor((gray / 255) * 8) % 8;  // 映射灰度到8个方向索引（0-7）

            // 2. 定义8个基础方向（螺旋边界网格的遍历顺序模板）
            const baseDirs = [
                [0, -1],   // 上
                [1, -1],   // 右上
                [1, 0],    // 右
                [1, 1],    // 右下
                [0, 1],    // 下
                [-1, 1],   // 左下
                [-1, 0],   // 左
                [-1, -1]   // 左上
            ];

            // 按螺旋顺序向外搜索
            for (let r = 0; r <= radius; r++) {
                // 3. 生成当前半径r的所有边界网格，并按中心颜色决定的顺序排序
                const boundaryGrids = [];
                for (let d = 0; d < 8; d++) {
                    const [dxBase, dyBase] = baseDirs[(d + dirIndex) % 8];  // 按起始方向偏移
                    // 对非0半径，计算边界网格坐标（r=0时只有中心网格）
                    const dx = r === 0 ? 0 : dxBase * r;
                    const dy = r === 0 ? 0 : dyBase * r;
                    const gx = startGx + dx;
                    const gy = startGy + dy;

                    // 过滤重复网格（r>0时同一网格可能被多个方向生成）
                    if (r === 0 || !boundaryGrids.some(g => g.gx === gx && g.gy === gy)) {
                        boundaryGrids.push({ gx, gy });
                    }
                }

                // 4. 按调整后的顺序遍历当前半径的边界网格
                for (const { gx, gy } of boundaryGrids) {
                    // 检查网格是否在图像范围内
                    if (gx < 0 || gx >= Math.ceil(width / gridWidth) || gy < 0 || gy >= Math.ceil(height / gridHeight)) {
                        continue;
                    }

                    // 检查格子中心点
                    const xStart = gx * gridWidth;
                    const yStart = gy * gridHeight;
                    const centerX = xStart + gridWidth / 2;
                    const centerY = yStart + gridHeight / 2;
                    const cx = Math.round(centerX);
                    const cy = Math.round(centerY);
                    const pixel = getPixel(cx, cy);

                    if (pixel.valid && isTargetColor(pixel.r, pixel.g, pixel.b)) {
                        // console.log(`在格子 (${gx}, ${gy}) 中心点 (${cx}, ${cy}) 找到目标颜色点`);
                        return { x: cx, y: cy, gx, gy };
                    }
                }
            }
            return null;
        }

        /**
         * 沿着指定方向搜索连续的同色点。
         * @param {number} startX - 起始 X
         * @param {number} startY - 起始 Y
         * @param {number} dx - X 方向增量 (-1, 0, 1)
         * @param {number} dy - Y 方向增量 (-1, 0, 1)
         * @param {Function} isTargetColor - 颜色判断函数
         * @returns {{x: number, y: number}} 最远点坐标
         */
        function findFarthestPoint(startX, startY, dx, dy, isTargetColor) {
            let x = startX;
            let y = startY;
            let farthestX = x;
            let farthestY = y;

            while (true) {
                x += dx;
                y += dy;
                const pixel = getPixel(x, y);
                if (!pixel.valid || !isTargetColor(pixel.r, pixel.g, pixel.b)) {
                    break;
                }
                farthestX = x;
                farthestY = y;
            }

            // console.log(`从 (${startX}, ${startY}) 沿方向 (${dx}, ${dy}) 找到最远点 (${farthestX}, ${farthestY})`);
            return { x: farthestX, y: farthestY };
        }

        /**
         * 计算两点间距离。
         */
        function distance(x1, y1, x2, y2) {
            return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        }

        /**
         * 计算向量与 X 轴正方向的夹角（弧度）。
         */
        function vectorAngle(vx, vy) {
            // 处理零向量（方向未定义）
            if (vx === 0 && vy === 0) {
                return NaN;
            }
            return Math.atan2(vy, vx);
        }

        // 2. 定义网格大小
        const GRID_SIZE = 8;
        const GRID_WIDTH = GRID_SIZE;
        const GRID_HEIGHT = GRID_SIZE;
        const MAX_SEARCH_RADIUS = Math.max(Math.ceil(width / GRID_WIDTH), Math.ceil(height / GRID_HEIGHT)) / 2;

        // 3. 从中心开始搜索一级蓝色点
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        // console.log("从中心点开始搜索一级蓝色点:", centerX, centerY);

        const primaryBlue = searchColorInGrid(centerX, centerY, MAX_SEARCH_RADIUS, isBlue, GRID_WIDTH, GRID_HEIGHT);
        if (!primaryBlue) {
            console.log("未找到一级蓝色点，结束搜索。");
            console.groupEnd();
            return null;
        }
        // console.log("找到一级蓝色点:", primaryBlue);

        // 4. 从一级蓝色点所在格子开始搜索一级红色点
        const primaryRed = searchColorInGrid(primaryBlue.x, primaryBlue.y, MAX_SEARCH_RADIUS, isRed, GRID_WIDTH, GRID_HEIGHT);
        if (!primaryRed) {
            console.log("未找到一级红色点，结束搜索。");
            console.groupEnd();
            return {
                allBluePoints: [primaryBlue],
                allRedPoints: [],
                // ... 其他需要的值
            };
        }
        // console.log("找到一级红色点:", primaryRed);

        // 5. 搜索蓝色点的米字八方向最远点（二级蓝色点）
        const directions = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        const secondaryBluePoints = [];
        for (const [dx, dy] of directions) {
            const farthest = findFarthestPoint(primaryBlue.x, primaryBlue.y, dx, dy, isBlue);
            secondaryBluePoints.push(farthest);
        }
        // console.log("二级蓝色点列表:", secondaryBluePoints);

        // 6. 从每个二级蓝色点搜索三级蓝色点
        const tertiaryBluePoints = [];
        for (const point of secondaryBluePoints) {
            for (const [dx, dy] of directions) {
                const farthest = findFarthestPoint(point.x, point.y, dx, dy, isBlue);
                // 避免重复添加起始点
                if (farthest.x !== point.x || farthest.y !== point.y) {
                    tertiaryBluePoints.push(farthest);
                }
            }
        }
        // console.log("三级蓝色点列表:", tertiaryBluePoints);

        // 7. 合并所有蓝色点并计算边界和中心
        const allBluePoints = [primaryBlue, ...secondaryBluePoints, ...tertiaryBluePoints];
        let bminx = Infinity, bmaxx = -Infinity, bminy = Infinity, bmaxy = -Infinity;
        let sumX = 0, sumY = 0;

        for (const p of allBluePoints) {
            bminx = Math.min(bminx, p.x);
            bmaxx = Math.max(bmaxx, p.x);
            bminy = Math.min(bminy, p.y);
            bmaxy = Math.max(bmaxy, p.y);
            sumX += p.x;
            sumY += p.y;
        }

        const bmx = (bmaxx + bminx) / 2;
        const bmy = (bmaxy + bminy) / 2;
        const bdx = bmaxx - bminx;
        const bdy = bmaxy - bminy;
        // console.log("蓝色点边界:", { bminx, bmaxx, bminy, bmaxy });
        // console.log("蓝色中心点:", { bmx, bmy }, "尺寸:", { bdx, bdy });

        let free = false;
        const Sb = bdx * bdy;
        // 8. 判断一级红蓝点距离
        const primaryDistance = distance(primaryBlue.x, primaryBlue.y, primaryRed.x, primaryRed.y);
        const sizeThreshold = 2 * Math.max(bdx, bdy);
        // console.log("一级红蓝点距离:", primaryDistance, "尺寸阈值:", sizeThreshold);

        if (primaryDistance >= sizeThreshold) {
            console.log("一级红蓝点距离大于阈值，结束搜索。");
            console.groupEnd();
            return {
                allBluePoints,
                allRedPoints: [primaryRed],
                // ... 其他需要的值
            };
        }

        // 9. 搜索红色点的米字八方向最远点（二级红色点）
        const secondaryRedPoints = [];
        for (const [dx, dy] of directions) {
            const farthest = findFarthestPoint(primaryRed.x, primaryRed.y, dx, dy, isRed);
            secondaryRedPoints.push(farthest);
        }
        // console.log("二级红色点列表:", secondaryRedPoints);

        // 10. 从每个二级红色点搜索三级红色点
        const tertiaryRedPoints = [];
        for (const point of secondaryRedPoints) {
            for (const [dx, dy] of directions) {
                const farthest = findFarthestPoint(point.x, point.y, dx, dy, isRed);
                if (farthest.x !== point.x || farthest.y !== point.y) {
                    tertiaryRedPoints.push(farthest);
                }
            }
        }
        // console.log("三级红色点列表:", tertiaryRedPoints);

        // 11. 合并所有红色点并计算边界和中心
        const allRedPoints = [primaryRed, ...secondaryRedPoints, ...tertiaryRedPoints];
        let rminx = Infinity, rmaxx = -Infinity, rminy = Infinity, rmaxy = -Infinity;
        let rsumX = 0, rsumY = 0;

        for (const p of allRedPoints) {
            rminx = Math.min(rminx, p.x);
            rmaxx = Math.max(rmaxx, p.x);
            rminy = Math.min(rminy, p.y);
            rmaxy = Math.max(rmaxy, p.y);
            rsumX += p.x;
            rsumY += p.y;
        }

        const rmx = (rmaxx + rminx) / 2;
        const rmy = (rmaxy + rminy) / 2;
        const rdx = rmaxx - rminx;
        const rdy = rmaxy - rminy;
        // console.log("红色点边界:", { rminx, rmaxx, rminy, rmaxy });
        // console.log("红色中心点:", { rmx, rmy }, "尺寸:", { rdx, rdy });
        const Sr = rdx * rdy;

        const bratedXdY = bdx / bdy;
        const rateThreshold = 5.7 / 4.7;
        const rateThresholdRev = 4.7 / 5.7;
        if (Sb > 64 && rateThresholdRev <= bratedXdY && bratedXdY <= rateThreshold) {
            free = true;
        }
        const rateBdBmxRmaxx = 5.7 / 9.7;
        const rateBdBmxRmaxxRev = 9.7 / 5.7;
        const dRmaxxBmx = rmaxx - bmx;
        const rateDrmaxxbmxBdx = bdx / dRmaxxBmx;
        if (free && Sr > 64 && (Sb / Sr) < 2.5 && (rateBdBmxRmaxx / 2) < rateDrmaxxbmxBdx && rateDrmaxxbmxBdx < rateBdBmxRmaxx) {
            console.log("红色豁免生效");
        } else {
            free == false;
            if ((Sb / Sr) > 2 || (Sb / Sr) < 0.5 || Sb < 64 || Sr < 64) {
                console.log("面积相差悬殊，结束搜索。");
                console.groupEnd();
            }
        }
        // 12. 计算各种距离和角度
        const dbmrm = distance(bmx, bmy, rmx, rmy); // 蓝心到红心
        // console.log("蓝心到红心距离 (dbmrm):", dbmrm);

        // 方向向量
        const dirX = rmx - bmx;
        const dirY = rmy - bmy;
        const invDirX = -dirX;
        const invDirY = -dirY;

        // 修复：若dirX=0，改用dirY方向（避免dx=0）
        const redDx = dirX === 0 ? Math.sign(dirY) : Math.sign(dirX);
        const redDy = dirX === 0 ? 0 : Math.sign(dirY); // 原逻辑dy=0，若dirX=0则沿垂直方向
        const farthestRedOutward = findFarthestPoint(rmx, rmy, redDx, redDy, isRed);

        // 12.3: 从蓝心沿红->蓝方向外延找最远蓝点
        const blueDx = invDirX === 0 ? Math.sign(invDirY) : Math.sign(invDirX);
        const blueDy = invDirX === 0 ? 0 : Math.sign(invDirY);
        const farthestBlueOutward = findFarthestPoint(bmx, bmy, blueDx, blueDy, isBlue);
        // 12.4: 外延最远点距离
        const drbr = distance(farthestBlueOutward.x, farthestBlueOutward.y, farthestRedOutward.x, farthestRedOutward.y);
        console.log("外延最远点距离 (drbr):", drbr);
        const estimateDis = 6.21 / (drbr / width);
        const blueInwardDx = dirX !== 0 ? Math.sign(dirX) : Math.sign(dirY);
        const blueInwardDy = dirX !== 0 ? 0 : Math.sign(dirY);
        const farthestBlueInward = findFarthestPoint(bmx, bmy, blueInwardDx, blueInwardDy, isBlue);

        // 12.6: 修复红心方向（优先dx，dx=0则用dy）
        const redInwardDx = invDirX !== 0 ? Math.sign(invDirX) : Math.sign(invDirY);
        const redInwardDy = invDirX !== 0 ? 0 : Math.sign(invDirY);
        const farthestRedInward = findFarthestPoint(rmx, rmy, redInwardDx, redInwardDy, isRed);
        // 12.7: 内部最远点距离
        const dribr = distance(farthestBlueInward.x, farthestBlueInward.y, farthestRedInward.x, farthestRedInward.y);
        // console.log("内部最远点距离 (dribr):", dribr);

        // 12.8: 向量夹角
        const angle = vectorAngle(dirX, dirY);
        // console.log("蓝心->红心向量与X轴夹角 (弧度):", angle);

        // 12.9: 蓝色最远点距离 & 红色最远点距离
        const blueFarthestDistance = distance(farthestBlueOutward.x, farthestBlueOutward.y, farthestBlueInward.x, farthestBlueInward.y);
        const redFarthestDistance = distance(farthestRedOutward.x, farthestRedOutward.y, farthestRedInward.x, farthestRedInward.y);
        // console.log("蓝色最远点距离:", blueFarthestDistance, "红色最远点距离:", redFarthestDistance);
        const ratioBlueRedFarthestDistance = blueFarthestDistance / (redFarthestDistance || 1)
        if (!free) {
            if (ratioBlueRedFarthestDistance < 0.5 || ratioBlueRedFarthestDistance > 2) {
                console.log("镜片检测失败，结束搜索。");
                console.groupEnd();
            }
        }

        // 12.10: 距离比值
        const distanceRatio = redFarthestDistance / (blueFarthestDistance || 1); // 避免除零
        // console.log("红蓝最远点距离比值:", distanceRatio);

        // 12.11: 红蓝中心点的中心
        const centerOfCentersX = (bmx + rmx) / 2;
        const centerOfCentersY = (bmy + rmy) / 2;
        // console.log("红蓝中心点的中心:", { centerOfCentersX, centerOfCentersY });

        // 13. 检查 drbr 与 dbmrm 的倍数关系
        const drbrRatio = drbr / (dbmrm || 1);
        // console.log("drbr / dbmrm 比值:", drbrRatio);

        if (drbrRatio >= 1.25 && drbrRatio <= 1.75) {
            // console.log("drbr/dbmrm 在 1.25-1.75 范围内，进行垂直方向搜索。");

            // 13.1: 计算垂直方向
            const perpDx = -Math.sign(dirY);
            const perpDy = Math.sign(dirX);

            // 以蓝色中心点为基础，计算垂直方向的上下最远蓝色点
            const bluePerpUp = findFarthestPoint(bmx, bmy, 0, perpDy, isBlue);
            const bluePerpDown = findFarthestPoint(bmx, bmy, 0, -perpDy, isBlue);
            const bluePerpDistance = distance(bluePerpUp.x, bluePerpUp.y, bluePerpDown.x, bluePerpDown.y);
            const bluePerpRatio = bluePerpDistance / (drbr || 1);
            const rz1 = bluePerpRatio / 0.376;
            const arccosRz1 = Math.acos(Math.min(1, Math.max(-1, rz1))); // 限制在 [-1, 1]
            console.log("蓝色垂直方向距离比值:", bluePerpRatio, "rz1:", rz1, "arccos(rz1):", arccosRz1);

            // 以红色中心点为基础，计算垂直方向的上下最远红色点
            const redPerpUp = findFarthestPoint(rmx, rmy, 0, perpDy, isRed);
            const redPerpDown = findFarthestPoint(rmx, rmy, 0, -perpDy, isRed);
            const redPerpDistance = distance(redPerpUp.x, redPerpUp.y, redPerpDown.x, redPerpDown.y);
            const redPerpRatio = redPerpDistance / (drbr || 1);
            const rz2 = redPerpRatio / 0.376;
            const arccosRz2 = Math.acos(Math.min(1, Math.max(-1, rz2)));
            console.log("红色垂直方向距离比值:", redPerpRatio, "rz2:", rz2, "arccos(rz2):", arccosRz2);
            const elevation = Math.max(arccosRz1, arccosRz2);
            // 返回最终结果
            const result = {
                dbmrm,
                drbr,
                dribr,
                angle,
                distanceRatio,
                centerOfCentersX,
                centerOfCentersY,
                arccosRz1,
                arccosRz2,
                allBluePoints,
                allRedPoints,
                elevation,
                estimateDis
                // ... 其他需要的值
            };
            console.log("识别成功，返回结果:", result);
            console.groupEnd();
            return result;

        } else {
            console.log("drbr/dbmrm 不在 1.25-1.75 范围内，结束搜索。");
            console.groupEnd();
        }
    }
    
        // this.dataList.push(drbr / width);
        // if (this.dataList.length > 100) this.dataList.shift();
        
        // let sum = this.dataList.reduce((a, b) => a + b, 0);
        // let avg = sum / this.dataList.length;
        
        // for (let i = this.dataList.length - 1; i >= 0; i--) {
        //     if (Math.abs(this.dataList[i] - avg) / avg > 0.1) {
        //         this.dataList.splice(i, 1);
        //     }
        // }
        
        // let newSum = this.dataList.reduce((a, b) => a + b, 0);
        // let newAvg = this.dataList.length ? newSum / this.dataList.length : 0;
        // console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------->", newAvg, this.dataList.length);
        // // 60cm 0.105 50cm 0.127 40cm 0.152 30cm 0.203 20cm 0.302
        // // 12.5: 修复蓝心方向（优先dx，dx=0则用dy）
        
    processImageFromCamera1(data, width, height) {
        console.log("=== 开始处理摄像头图像 ===");
        console.log(`图像尺寸: ${width}x${height}, 像素总数: ${data.length / 4}`);

        // --------------------------
        // 1. 颜色定义（带容差范围）
        // --------------------------
        // A色：偏暗蓝色（RGB范围，容差±30）
        const blueColor = {
            r: 0,    // 基准红色值
            g: 0,    // 基准绿色值
            b: 100,  // 基准蓝色值（偏暗）
            tolerance: 30 // 容差范围
        };
        // B色：偏暗红色（RGB范围，容差±30）
        const redColor = {
            r: 100,  // 基准红色值（偏暗）
            g: 0,    // 基准绿色值
            b: 0,    // 基准蓝色值
            tolerance: 30 // 容差范围
        };
        console.log("颜色定义 - 蓝色基准:", blueColor, "红色基准:", redColor);

        // --------------------------
        // 2. 工具函数
        // --------------------------
        function isColorMatch(r, g, b, target) {
            return Math.abs(r - target.r) <= target.tolerance &&
                Math.abs(g - target.g) <= target.tolerance &&
                Math.abs(b - target.b) <= target.tolerance;
        }

        function getGrid(x, y) {
            const gridWidth = width / 8;
            const gridHeight = height / 8;
            return {
                gx: Math.min(7, Math.floor(x / gridWidth)), // 0-7网格索引
                gy: Math.min(7, Math.floor(y / gridHeight))
            };
        }

        function getGridCenter(gx, gy) {
            const gridWidth = width / 8;
            const gridHeight = height / 8;
            return {
                x: gx * gridWidth + gridWidth / 2,
                y: gy * gridHeight + gridHeight / 2
            };
        }

        function getDistance(x1, y1, x2, y2) {
            return Math.hypot(x2 - x1, y2 - y1);
        }

        function searchMaxPointsIn8Dirs(startX, startY, targetColor) {
            // 米字8方向向量（x增量, y增量）
            const dirs = [
                {dx: 0, dy: -1},  // 上
                {dx: 0, dy: 1},   // 下
                {dx: -1, dy: 0},  // 左
                {dx: 1, dy: 0},   // 右
                {dx: -1, dy: -1}, // 左上
                {dx: 1, dy: -1},  // 右上
                {dx: -1, dy: 1},  // 左下
                {dx: 1, dy: 1}    // 右下
            ];
            const maxPoints = [];

            for (let d = 0; d < dirs.length; d++) {
                const {dx, dy} = dirs[d];
                let currentX = startX;
                let currentY = startY;
                let lastValidX = startX;
                let lastValidY = startY;
                let isContinuous = true;

                while (isContinuous) {
                    // 沿方向移动一步
                    currentX += dx;
                    currentY += dy;

                    // 边界检查
                    if (currentX < 0 || currentX >= width || currentY < 0 || currentY >= height) {
                        break;
                    }

                    // 获取当前像素颜色
                    const index = (Math.floor(currentY) * width + Math.floor(currentX)) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];

                    if (isColorMatch(r, g, b, targetColor)) {
                        lastValidX = currentX;
                        lastValidY = currentY;
                    } else {
                        isContinuous = false; // 颜色不连续，终止该方向搜索
                    }
                }

                maxPoints.push({
                    x: lastValidX,
                    y: lastValidY,
                    dir: d // 记录方向索引
                });
                console.log(`方向${d}最远点: (${lastValidX}, ${lastValidY})`);
            }

            return maxPoints;
        }

        // --------------------------
        // 3. 初始化8x8网格搜索顺序（从中心向外）
        // --------------------------
        const centerGx = 3; // 8x8网格中心索引（0-7）
        const centerGy = 3;
        console.log(`网格中心: (${centerGx}, ${centerGy})`);

        // 生成从中心向外的网格搜索顺序（BFS）
        const gridQueue = [];
        const visitedGrids = new Set();
        gridQueue.push({gx: centerGx, gy: centerGy});
        visitedGrids.add(`${centerGx},${centerGy}`);

        // 网格扩展方向（上下左右+对角线）
        const gridDirs = [[0,1], [0,-1], [1,0], [-1,0], [1,1], [1,-1], [-1,1], [-1,-1]];
        const searchGrids = [];

        while (gridQueue.length > 0) {
            const current = gridQueue.shift();
            searchGrids.push(current);
            // 扩展相邻网格
            for (const [dx, dy] of gridDirs) {
                const newGx = current.gx + dx;
                const newGy = current.gy + dy;
                if (newGx >= 0 && newGx < 8 && newGy >=0 && newGy <8 && !visitedGrids.has(`${newGx},${newGy}`)) {
                    visitedGrids.add(`${newGx},${newGy}`);
                    gridQueue.push({gx: newGx, gy: newGy});
                }
            }
        }
        console.log("网格搜索顺序:", searchGrids.map(g => `(${g.gx},${g.gy})`).join(" -> "));

        // --------------------------
        // 4. 搜索一级蓝色点
        // --------------------------
        let primaryBlue = null; // 一级蓝色点 {x, y, gx, gy}
        gridLoop: for (const grid of searchGrids) {
            const {gx, gy} = grid;
            const gridWidth = width / 8;
            const gridHeight = height / 8;
            const startX = gx * gridWidth;
            const startY = gy * gridHeight;
            const endX = startX + gridWidth;
            const endY = startY + gridHeight;

            // 遍历当前网格内像素
            for (let y = Math.floor(startY); y < Math.floor(endY); y += 2) { // 步长2优化性能
                for (let x = Math.floor(startX); x < Math.floor(endX); x += 2) {
                    const index = (y * width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];

                    if (isColorMatch(r, g, b, blueColor)) {
                        primaryBlue = {
                            x, y,
                            gx, gy
                        };
                        console.log(`找到一级蓝色点: (${x},${y}) 所在网格: (${gx},${gy})`);
                        break gridLoop; // 找到后终止网格搜索
                    }
                }
            }
        }

        if (!primaryBlue) {
            console.log("未找到一级蓝色点，终止搜索");
            return { success: false, reason: "未找到一级蓝色点" };
        }

        // --------------------------
        // 5. 从一级蓝色点网格搜索最近的一级红色点
        // --------------------------
        let primaryRed = null; // 一级红色点 {x, y, gx, gy, distance}
        // 以一级蓝色点网格为中心，向外搜索红色点
        const redSearchGrids = [];
        const redVisited = new Set();
        redSearchGrids.push({gx: primaryBlue.gx, gy: primaryBlue.gy});
        redVisited.add(`${primaryBlue.gx},${primaryBlue.gy}`);

        redGridLoop: while (redSearchGrids.length > 0) {
            const currentGrid = redSearchGrids.shift();
            const {gx, gy} = currentGrid;
            const gridWidth = width / 8;
            const gridHeight = height / 8;
            const startX = gx * gridWidth;
            const startY = gy * gridHeight;
            const endX = startX + gridWidth;
            const endY = startY + gridHeight;

            // 遍历当前网格内像素
            for (let y = Math.floor(startY); y < Math.floor(endY); y += 2) {
                for (let x = Math.floor(startX); x < Math.floor(endX); x += 2) {
                    const index = (y * width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];

                    if (isColorMatch(r, g, b, redColor)) {
                        const distance = getDistance(primaryBlue.x, primaryBlue.y, x, y);
                        primaryRed = {
                            x, y,
                            gx, gy,
                            distance
                        };
                        console.log(`找到一级红色点: (${x},${y}) 距离蓝色点: ${distance.toFixed(2)}px`);
                        break redGridLoop;
                    }
                }
            }

            // 扩展相邻网格
            for (const [dx, dy] of gridDirs) {
                const newGx = gx + dx;
                const newGy = gy + dy;
                if (newGx >= 0 && newGx < 8 && newGy >=0 && newGy <8 && !redVisited.has(`${newGx},${newGy}`)) {
                    redVisited.add(`${newGx},${newGy}`);
                    redSearchGrids.push({gx: newGx, gy: newGy});
                }
            }
        }

        if (!primaryRed) {
            console.log("未找到一级红色点，终止搜索");
            return { success: false, reason: "未找到一级红色点" };
        }

        // --------------------------
        // 6. 搜索蓝色点的二级、三级点
        // --------------------------
        // 二级蓝色点（一级蓝色点的8方向最远点）
        const secondaryBlues = searchMaxPointsIn8Dirs(primaryBlue.x, primaryBlue.y, blueColor);
        console.log(`找到${secondaryBlues.length}个二级蓝色点`);

        // 三级蓝色点（每个二级点的8方向最远点）
        let tertiaryBlues = [];
        secondaryBlues.forEach((sb, idx) => {
            const tb = searchMaxPointsIn8Dirs(sb.x, sb.y, blueColor);
            tertiaryBlues = tertiaryBlues.concat(tb);
            console.log(`二级蓝色点${idx} 找到${tb.length}个三级蓝色点`);
        });
        const allBlues = [primaryBlue, ...secondaryBlues, ...tertiaryBlues];
        console.log(`蓝色点总数: ${allBlues.length}`);

        // 计算蓝色点边界和中心
        const bxs = allBlues.map(p => p.x);
        const bys = allBlues.map(p => p.y);
        const bmaxx = Math.max(...bxs);
        const bminx = Math.min(...bxs);
        const bmaxy = Math.max(...bys);
        const bminy = Math.min(...bys);
        const bmx = bxs.reduce((sum, x) => sum + x, 0) / bxs.length; // 蓝色中心点x
        const bmy = bys.reduce((sum, y) => sum + y, 0) / bys.length; // 蓝色中心点y
        const bdx = bmaxx - bminx;
        const bdy = bmaxy - bminy;
        console.log(`蓝色点统计 - 边界: (${bminx},${bminy})至(${bmaxx},${bmaxy}), 中心: (${bmx.toFixed(2)},${bmy.toFixed(2)}), 宽: ${bdx}, 高: ${bdy}`);

        // --------------------------
        // 7. 判断一级红色点与蓝色中心距离
        // --------------------------
        const distanceBmR = getDistance(bmx, bmy, primaryRed.x, primaryRed.y);
        const maxBd = Math.max(bdx, bdy);
        console.log(`蓝色中心到一级红色点距离: ${distanceBmR.toFixed(2)}px, 2倍max(bd): ${2 * maxBd}`);

        if (distanceBmR > 2 * maxBd || maxBd < 5) {
            console.log("距离大于2倍max(bd)，终止后续计算");
            return {
                success: true,
                primaryBlue,
                primaryRed,
                blueStats: {bmaxx, bminx, bmaxy, bminy, bmx, bmy, bdx, bdy},
                distanceBmR
            };
        }

        // --------------------------
        // 8. 搜索红色点的二级、三级点
        // --------------------------
        // 二级红色点（一级红色点的8方向最远点）
        const secondaryReds = searchMaxPointsIn8Dirs(primaryRed.x, primaryRed.y, redColor);
        console.log(`找到${secondaryReds.length}个二级红色点`);

        // 三级红色点（每个二级点的8方向最远点）
        let tertiaryReds = [];
        secondaryReds.forEach((sr, idx) => {
            const tr = searchMaxPointsIn8Dirs(sr.x, sr.y, redColor);
            tertiaryReds = tertiaryReds.concat(tr);
            console.log(`二级红色点${idx} 找到${tr.length}个三级红色点`);
        });
        const allReds = [primaryRed, ...secondaryReds, ...tertiaryReds];
        console.log(`红色点总数: ${allReds.length}`);

        // 计算红色点边界和中心
        const rxs = allReds.map(p => p.x);
        const rys = allReds.map(p => p.y);
        const rmaxx = Math.max(...rxs);
        const rminx = Math.min(...rxs);
        const rmaxy = Math.max(...rys);
        const rminy = Math.min(...rys);
        const rmx = rxs.reduce((sum, x) => sum + x, 0) / rxs.length; // 红色中心点x
        const rmy = rys.reduce((sum, y) => sum + y, 0) / rys.length; // 红色中心点y
        const rdx = rmaxx - rminx;
        const rdy = rmaxy - rminy;
        console.log(`红色点统计 - 边界: (${rminx},${rminy})至(${rmaxx},${rmaxy}), 中心: (${rmx.toFixed(2)},${rmy.toFixed(2)}), 宽: ${rdx}, 高: ${rdy}`);

        // --------------------------
        // 9. 计算各类距离和角度参数
        // --------------------------
        // 一、蓝红中心距离
        const dbmrm = getDistance(bmx, bmy, rmx, rmy);
        console.log(`蓝红中心距离 dbmrm: ${dbmrm.toFixed(2)}px`);

        // 二、蓝色中心→红色中心方向，红色中心外延的最远红色点
        const dirBr = { dx: rmx - bmx, dy: rmy - bmy }; // 蓝→红方向向量
        const farRedInBrDir = searchMaxPointsIn8Dirs(rmx, rmy, redColor)
            .find(p => Math.abs(p.dir - 3) < 1); // 沿x正方向（近似蓝→红方向）
        console.log(`红色中心外延最远点: (${farRedInBrDir?.x.toFixed(2)},${farRedInBrDir?.y.toFixed(2)})`);

        // 三、红色中心→蓝色中心方向，蓝色中心外延的最远蓝色点
        const dirRb = { dx: bmx - rmx, dy: bmy - rmy }; // 红→蓝方向向量
        const farBlueInRbDir = searchMaxPointsIn8Dirs(bmx, bmy, blueColor)
            .find(p => Math.abs(p.dir - 2) < 1); // 沿x负方向（近似红→蓝方向）
        console.log(`蓝色中心外延最远点: (${farBlueInRbDir?.x.toFixed(2)},${farBlueInRbDir?.y.toFixed(2)})`);

        // 四、最远蓝红外延点距离
        const drbr = farRedInBrDir && farBlueInRbDir 
            ? getDistance(farBlueInRbDir.x, farBlueInRbDir.y, farRedInBrDir.x, farRedInBrDir.y)
            : 0;
        console.log(`最远蓝红外延点距离 drbr: ${drbr.toFixed(2)}px`);

        // 五、蓝色中心→红色中心方向的最远蓝色点
        const farBlueInBrDir = searchMaxPointsIn8Dirs(bmx, bmy, blueColor)
            .find(p => Math.abs(p.dir - 3) < 1);
        // 六、红色中心→蓝色中心方向的最远红色点
        const farRedInRbDir = searchMaxPointsIn8Dirs(rmx, rmy, redColor)
            .find(p => Math.abs(p.dir - 2) < 1);
        // 七、内部最远点距离
        const dribr = farBlueInBrDir && farRedInRbDir
            ? getDistance(farBlueInBrDir.x, farBlueInBrDir.y, farRedInRbDir.x, farRedInRbDir.y)
            : 0;
        console.log(`内部最远点距离 dribr: ${dribr.toFixed(2)}px`);

        // 八、蓝→红向量与x正方向夹角（y正方向为正）
        const angleRad = Math.atan2(dirBr.dy, dirBr.dx); // 弧度制
        const angleDeg = (angleRad * 180 / Math.PI + 360) % 360; // 转换为0-360度
        console.log(`蓝→红向量与x轴夹角: ${angleRad.toFixed(4)}rad (${angleDeg.toFixed(2)}°)`);

        // 九、蓝色/红色最远点距离
        const blueMaxDist = getDistance(bminx, bminy, bmaxx, bmaxy);
        const redMaxDist = getDistance(rminx, rminy, rmaxx, rmaxy);
        // 十、距离比值
        const distRatio = redMaxDist / blueMaxDist || 0;
        console.log(`蓝色最远点距离: ${blueMaxDist.toFixed(2)}, 红色: ${redMaxDist.toFixed(2)}, 比值: ${distRatio.toFixed(4)}`);

        // 十一、红蓝中心的中心点
        const centerOfCenters = {
            x: (bmx + rmx) / 2,
            y: (bmy + rmy) / 2
        };
        console.log(`红蓝中心的中心点: (${centerOfCenters.x.toFixed(2)},${centerOfCenters.y.toFixed(2)})`);

        // --------------------------
        // 10. 处理drbr与dbmrm的倍数关系
        // --------------------------
        const drbrRatio = drbr / dbmrm || 0;
        console.log(`drbr/dbmrm 倍数: ${drbrRatio.toFixed(4)}`);
        const result = {
            success: true,
            primaryBlue,
            primaryRed,
            blueStats: {bmaxx, bminx, bmaxy, bminy, bmx, bmy, bdx, bdy},
            redStats: {rmaxx, rminx, rmaxy, rminy, rmx, rmy, rdx, rdy},
            distances: {dbmrm, drbr, dribr, blueMaxDist, redMaxDist, distRatio},
            angles: {angleRad, angleDeg},
            centers: {centerOfCenters}
        };

        if (drbrRatio >= 1.5 && drbrRatio <= 2) {
            console.log("drbr在1.5-2倍dbmrm范围内，计算rz1和rz2");
            
            // 计算蓝色垂直方向最远点距离
            const bluePerpDist = bdx; // 简化：取宽度作为垂直距离
            const blueRatio = bluePerpDist / dbmrm;
            const rz1 = blueRatio / 0.376;
            const arccosRz1 = Math.acos(Math.min(1, Math.max(-1, rz1))); // 防止超出定义域
            
            // 计算红色垂直方向最远点距离
            const redPerpDist = rdx; // 简化：取宽度作为垂直距离
            const redRatio = redPerpDist / dbmrm;
            const rz2 = redRatio / 0.376;
            const arccosRz2 = Math.acos(Math.min(1, Math.max(-1, rz2)));

            result.perpStats = {
                bluePerpDist, blueRatio, rz1, arccosRz1,
                redPerpDist, redRatio, rz2, arccosRz2
            };
            console.log(`蓝色rz1: ${rz1.toFixed(4)}, arccos: ${arccosRz1.toFixed(4)}rad`);
            console.log(`红色rz2: ${rz2.toFixed(4)}, arccos: ${arccosRz2.toFixed(4)}rad`);
        } else {
            console.log("drbr不在1.5-2倍范围内，不执行额外计算");
        }

        console.log("=== 图像处理完成 ===");
        return result;
    }
}