import { SystemState, CONFIG } from "./SystemState.js";
import { Renderer } from "./Renderer.js";
import { Point } from "../base/Point.js";

/**
 * 检查世界格网点是否被其他物体占用
 * @param {number} gx - grid X 索引
 * @param {number} gy - grid Y 索引
 * @param {Object} gridPoint - 世界格网点
 * @param {Object} draggingObject - 正在拖动的物体（可为null）
 * @returns {boolean} true表示已被占用
 */
export function isGridPointOccupied(gx, gy, gridPoint, draggingObject) {
    const grid = SystemState.mainWindow.grid;
    // 必须进行边界检查
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) return false;
    if (gx < 0 || gx >= grid.length || gy < 0 || gy >= grid[0].length) return false;

    const cell = grid[gx][gy];
    if (!cell) return false;

    // 遍历该cell中的所有点，检查是否有其他物体的中心点
    for (const p of cell) {
        // 检查是否是其他物体的中心点
        if (p.isObjectCenter &&
            p.ownerObject &&
            p.ownerObject !== draggingObject) {

            // 检查该物心是否与格点坐标重合（容差范围内）
            const dx = Math.abs(p.x - gridPoint.x);
            const dy = Math.abs(p.y - gridPoint.y);
            const dz = Math.abs(p.z - gridPoint.z);
            const TOLERANCE = 0.1; // 容差：0.1cm（世界坐标）

            if (dx < TOLERANCE && dy < TOLERANCE && dz < TOLERANCE) {
                return true;  // 格点被占用
            }
        }
    }

    return false;  // 格点空闲
}

export function updateVirtualMouse(mouseX, mouseY) {
    const vm = SystemState.virtualMouse;
    if (!vm.enabled) return;

    const width = SystemState.screenWidthPx;
    const height = SystemState.screenHeightPx;

    // 清除旧的虚拟鼠标点
    SystemState.screenPoints = SystemState.screenPoints.filter(
        p => p.tag !== 'VIRTUAL_MOUSE'
    );

    // 从鼠标位置向外扩展搜索（调用 Window 的方法）
    const win = SystemState.mainWindow;
    let snapped = null;

    if (win && win.findNearestPoint) {
        snapped = win.findNearestPoint(mouseX, mouseY, 0, (p) => {
            // 阶段16新增：EDIT 态只吸附屏幕平面附近的 局部格网点
            if (SystemState.interactionState === 'EDIT') {
                if (p.tag !== 'LOCAL_GRID') return false;
            }

            // Phase 2新增：VIEW态拖动时，跳过已被其他物体占用的格点
            if (SystemState.draggingObject && p.isGridPoint) {
                if (isGridPointOccupied(p.gx, p.gy, p, SystemState.draggingObject)) {
                    return false;
                }
            }
            return true;
        });
    }

    // 阶段1新增: 更新Window的virtualCursor缓存(统一出口)
    if (win && win.virtualCursor) {
        win.virtualCursor.setSnappedPoint(snapped);
    }

    let centerX = mouseX;
    let centerY = mouseY;
    let centerXL = mouseX;  // 左眼圈心
    let centerXR = mouseX;  // 右眼圈心
    let centerYL = mouseY;
    let centerYR = mouseY;
    let perspectiveScale = 1;  // 透视缩放因子（近大远小）

    // FOCUS/FOCUS_ENTERING 态：虚拟鼠标在指定深度平面上自由移动，但仍然要计算透视投影
    if (SystemState.interactionState === 'FOCUS' || SystemState.interactionState === 'FOCUS_ENTERING') {
        // 深度计算：屏幕平面深度 + 虚拟鼠标深度偏移
        // 屏幕到用户的基准距离
        const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;  // 40cm
        // 虚拟鼠标平面到用户的距离
        const vmDepth = baseDis + SystemState.focusVirtualMouseDepth;

        // 透视缩放：1cm 直径在该深度的屏幕投影大小
        perspectiveScale = Math.max(0.1, baseDis / vmDepth);

        // 计算左右眼视差（用于立体显示）
        // 视差 = (eyeD / 2) * (1 - baseDis / vmDepth)
        // 当 vmDepth > baseDis 时，点在屏幕后方（交叉视差）
        // 当 vmDepth < baseDis 时，点在屏幕前方（非交叉视差）
        const eyeD = CONFIG.eyeD;
        const halfEyeD = eyeD / 2;
        const disparity = halfEyeD * (1 - baseDis / vmDepth) * SystemState.mainWindow.DPIx;

        centerX = mouseX;
        centerY = mouseY;
        centerXL = mouseX - disparity;  // 左眼向左偏移
        centerXR = mouseX + disparity;  // 右眼向右偏移
        centerYL = mouseY;
        centerYR = mouseY;
        vm.snappedTo = null;
    } else if (snapped) {
        // 使用吸附点的完整左右眼坐标作为圈心
        // 如果格点严格在屏幕平面上，则 xL == xR == xM，自然无视差
        centerXL = snapped.xL;
        centerXR = snapped.xR;
        centerYL = snapped.yL;
        centerYR = snapped.yR;
        centerX = snapped.xM;
        centerY = snapped.yM;

        // 计算透视缩放：利用点到用户的距离 (dis) 
        const pointDis = snapped.dis || 40;
        const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
        perspectiveScale = Math.max(0.3, Math.min(3.0, baseDis / pointDis));

        vm.snappedTo = snapped;
    } else {
        // 无可吸附点时显示在鼠标位置
        centerX = mouseX;
        centerY = mouseY;
        centerXL = mouseX;
        centerXR = mouseX;
        centerYL = mouseY;
        centerYR = mouseY;
        perspectiveScale = 1;
        vm.snappedTo = null;
    }

    vm.screenPosition = { x: centerX, y: centerY };

    // 生成圈形点（世界空间 1cm 直径，通过透视投影到屏幕）
    // 基础半径 = 0.5cm（世界空间）
    // 屏幕上的像素大小 = 世界空间大小 * DPI * (baseDis / pointDis)
    // 其中 baseDis/pointDis 已经在 perspectiveScale 中计算
    const worldRadiusCm = 0.5;  // 世界空间 0.5cm 半径（直径 1cm）
    const radiusPx = worldRadiusCm * SystemState.mainWindow.DPIx * perspectiveScale;
    const numPoints = 24;

    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const dx = Math.cos(angle) * radiusPx;
        const dy = Math.sin(angle) * radiusPx;

        const sp = new Point(0, 0, 0);
        sp.space = 'screen';
        sp.tag = 'VIRTUAL_MOUSE';

        // 中点坐标（用于 grid 索引，但实际不参与渲染）
        sp.xM = centerX + dx;
        sp.yM = centerY + dy;

        // 左右眼坐标：各自以左右眼圈心为中心画圈
        sp.xL = centerXL + dx;
        sp.xR = centerXR + dx;
        sp.yL = centerYL + dy;
        sp.yR = centerYR + dy;

        sp.light = 0.9;

        SystemState.screenPoints.push(sp);
    }
}

/**
 * 渲染屏幕辅助元素（虚拟鼠标等）
 * 独立于空间点渲染，直接使用屏幕坐标
 */
export function renderScreenOverlay(pixelData, width, height) {
    // 调试：统计虚拟鼠标点数量
    const vmPoints = SystemState.screenPoints.filter(p => p.space === 'screen' && p.tag === 'VIRTUAL_MOUSE');
    if (vmPoints.length > 0 && !SystemState._vmRenderDebugLogged) {
        console.log(`renderScreenOverlay: 找到 ${vmPoints.length} 个虚拟鼠标点, 第一个位置: (${vmPoints[0].xL?.toFixed(0)}, ${vmPoints[0].yL?.toFixed(0)})`);
        SystemState._vmRenderDebugLogged = true;
    }

    for (const p of SystemState.screenPoints) {
        if (p.space !== 'screen') continue;

        if (p.tag === 'VIRTUAL_MOUSE') {
            // 虚拟鼠标：立体渲染
            const isLR = CONFIG.displayMode === '3D_LR';
            const leftColor = isLR ? 'red' : 'blue';
            const rightColor = isLR ? 'blue' : 'red';

            if (Math.abs((p.xL || 0) - (p.xR || 0)) > 0) {
                renderScreenPixel(p.xL, p.yL, leftColor, p.light, pixelData, width, height);
                renderScreenPixel(p.xR, p.yR, rightColor, p.light, pixelData, width, height);
            } else {
                renderScreenPixel(p.xM, p.yM, 'purple', p.light, pixelData, width, height);
            }
        }
    }
}

/**
 * 内部辅助：渲染单个屏幕像素 (代理到 Renderer)
 */
function renderScreenPixel(x, y, colorType, light, pixelData, width, height) {
    x = Math.floor(x);
    y = Math.floor(y);

    const baseLight = colorType === 'red' ? 35 : 50;
    // 调用 Renderer.drawColoredPointImpl
    // drawColoredPointImpl(pixelData, width, height, x, y, light, colorType, baseLight, maxLutIndex, drawNeighbors)
    Renderer.drawColoredPointImpl(
        pixelData,
        width,
        height,
        x,
        y,
        light,
        colorType,
        baseLight,
        350, // maxLutIndex
        false // drawNeighbors
    );
}
