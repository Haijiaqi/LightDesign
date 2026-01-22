# OverlaySystem 执行方案

## 文档信息
- **创建时间**: 2026-01-22
- **状态**: 待实施
- **预估工作量**: 1.5 小时

---

## 一、概述

引入 `OverlaySystem` 模块，统一管理所有屏幕辅助元素的更新与渲染。

**目标**:
1. 将虚拟鼠标圈（VirtualMouse）从 `main.js` 迁移到 `OverlaySystem`
2. 新增 EDIT 态辅助覆盖层（EditAssist），包含辅助格网和截面轮廓

---

## 二、必须实现

### 2.1 新建文件: `manage/OverlaySystem.js`

#### 2.1.1 Overlay 类

```javascript
class Overlay {
    constructor(name, updateFn) {
        this.name = name;           // string, 调试标识
        this.points = [];           // ScreenPoint[], 产出的屏幕点
        this.visible = true;        // boolean, 开关
        this.zIndex = 0;            // number, 渲染层级
        this._updateFn = updateFn;  // function
    }

    update(win, context) {
        if (!this.visible) {
            this.points.length = 0;
            return;
        }
        this._updateFn(this, win, context);
    }

    clear() {
        this.points.length = 0;
    }

    // 添加屏幕点的辅助方法
    addPoint(xM, yM, xL, xR, yL, yR, tag, light = 1.0) {
        this.points.push({
            space: 'screen',
            tag: tag,
            xM, yM, xL, xR, yL, yR,
            light
        });
    }
}
```

**ScreenPoint 结构** (与现有 `SystemState.screenPoints` 中的点结构一致):
```javascript
{
    space: 'screen',  // 标记这是屏幕空间点
    tag: string,      // 用于渲染器识别颜色/样式
    xM, yM,           // 中心点屏幕坐标 (px)
    xL, xR,           // 左右眼 x 坐标 (px)
    yL, yR,           // 左右眼 y 坐标 (px)
    light: number     // 亮度 0~1
}
```

#### 2.1.2 OverlaySystemImpl 类

```javascript
class OverlaySystemImpl {
    constructor() {
        this.overlays = [];
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
        // 按 zIndex 排序后合并
        return this.overlays
            .filter(o => o.visible)
            .sort((a, b) => a.zIndex - b.zIndex)
            .flatMap(o => o.points);
    }
}

export const OverlaySystem = new OverlaySystemImpl();
```

#### 2.1.3 VirtualMouse 预设

**参考代码**: `main.js` 中的 `updateVirtualMouse()` 函数 (L815-916)

**实现要点**:
1. 从 `context` 中读取: `vmEnabled`, `mouseX`, `mouseY`, `snappedPoint`, `interactionState`, `focusVirtualMouseDepth`
2. 从 `win` 中读取: `DPIx`, `direction`, `direction.start`
3. 根据是否吸附、不同交互状态计算圆心位置和视差
4. 绘制 24 个点组成的圆圈

**照抄逻辑** (从 `main.js::updateVirtualMouse`):
```javascript
// 圆圈参数
const worldRadiusCm = 0.5;
const radiusPx = worldRadiusCm * win.DPIx * perspectiveScale;
const numPoints = 24;

// 绘制圆圈
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
```

**视差计算** (照抄 L860-871):
```javascript
// FOCUS 态时的视差计算
const baseDis = CONFIG.screenDistance - CONFIG.userDistanceFromOrigin;
const vmDepth = baseDis + ctx.focusVirtualMouseDepth;
const perspectiveScale = Math.max(0.1, baseDis / vmDepth);
const eyeD = CONFIG.eyeD;
const halfEyeD = eyeD / 2;
const disparity = halfEyeD * (1 - baseDis / vmDepth) * win.DPIx;
centerXL = mouseX - disparity;
centerXR = mouseX + disparity;
```

#### 2.1.4 EditAssist 预设

**触发条件**: `context.interactionState === 'EDIT'`

**包含两部分**:

##### A. 辅助格网

**参考代码**: `Window.js::createGridObject()` (L721-967) 的虚线生成逻辑

**实现要点**:
1. 从 `EditConfig` 读取: `size`, `spacing`, `halfSize`
2. 格网中心 = 物体屏幕投影中心
3. 格网范围 = `EditConfig.size` (直径), 间距 = `EditConfig.spacing`
4. 生成水平线和垂直线的交点

**简化实现** (不需要虚线，只画交点):
```javascript
const gridHalf = EditConfig.halfSize;
const spacing = EditConfig.spacing;

// 遍历格点
for (let ix = -gridHalf; ix <= gridHalf; ix += spacing) {
    for (let iy = -gridHalf; iy <= gridHalf; iy += spacing) {
        // 将局部坐标转换为屏幕坐标
        // 使用 win.vx, win.vy 作为屏幕坐标系基向量
        const screenX = centerScreenX + ix * win.DPIx;
        const screenY = centerScreenY + iy * win.DPIy;
        me.addPoint(screenX, screenY, screenX, screenX, screenY, screenY, 'EDIT_GRID', 0.4);
    }
}
```

##### B. 截面轮廓

**参考代码**: `main.js::updateSliceContour()` (如有) 或 `Renderer.js::renderScreenPointsHelper()`

**实现要点**:
1. 遍历 `context.focusedObject.displayPoints`
2. 筛选距离屏幕平面足够近的点 (阈值 = `EditConfig.spacing * 0.6`)
3. 使用这些点的屏幕坐标 (`xM`, `yM`) 作为轮廓点

```javascript
const dir = win.direction;
const planePt = dir.start;
const threshold = EditConfig.getLayerSpacingForOrientation(orientationType) * 0.6;

for (const p of obj.displayPoints) {
    const dist = (p.x - planePt.x) * dir.x + 
                 (p.y - planePt.y) * dir.y + 
                 (p.z - planePt.z) * dir.z;
    if (Math.abs(dist) < threshold) {
        me.addPoint(p.xM, p.yM, p.xL, p.xR, p.yL, p.yR, 'SLICE_CONTOUR', 0.8);
    }
}
```

---

### 2.2 修改文件: `main.js`

#### 2.2.1 新增 import

```javascript
import { OverlaySystem } from "./manage/OverlaySystem.js";
```

#### 2.2.2 修改 `render()` 函数

**位置**: L798-813

**当前代码**:
```javascript
function render() {
    ...
    if (SystemState.virtualMouse.enabled) {
        updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
    }
    renderScreenOverlay(pixelData, width, height);
    ...
}
```

**修改为**:
```javascript
function render() {
    ...
    // 准备 Context
    const overlayContext = {
        vmEnabled: SystemState.virtualMouse.enabled,
        mouseX: SystemState.lastMouseX,
        mouseY: SystemState.lastMouseY,
        snappedPoint: SystemState.virtualMouse.snappedTo,
        interactionState: SystemState.interactionState,
        focusedObject: SystemState.focusedObject,
        focusVirtualMouseDepth: SystemState.focusVirtualMouseDepth,
    };
    
    // 更新所有 Overlay
    OverlaySystem.updateAll(SystemState.mainWindow, overlayContext);
    
    // 获取所有 Overlay 点并渲染
    const overlayPoints = OverlaySystem.getAllPoints();
    renderOverlayPoints(pixelData, width, height, overlayPoints);
    ...
}
```

#### 2.2.3 注释掉 `updateVirtualMouse` 调用

**位置**: L808-810

```javascript
// if (SystemState.virtualMouse.enabled) {
//     updateVirtualMouse(SystemState.lastMouseX, SystemState.lastMouseY);
// }
```

#### 2.2.4 新增 `renderOverlayPoints` 函数

**参考代码**: `renderScreenOverlay()` (L917-974)

```javascript
function renderOverlayPoints(pixelData, width, height, points) {
    for (const p of points) {
        if (p.xM < 0 || p.xM >= width || p.yM < 0 || p.yM >= height) continue;
        Renderer.renderScreenPixel(pixelData, width, height, p.xL, p.yL, p.xR, p.yR, p.light, p.tag);
    }
}
```

---

## 三、禁止事项

| 禁止 | 原因 |
|------|------|
| 禁止在 `Overlay` 类中直接引用 `SystemState` | 违反解耦原则，所有状态通过 `context` 参数传递 |
| 禁止在 `OverlaySystem.js` 中 import `main.js` | 会导致循环依赖 |
| 禁止修改 `Renderer.js` 的核心渲染逻辑 | 保持渲染器的稳定性 |
| 禁止在 Overlay 中进行任何状态修改 | Overlay 只读取状态，不修改 |
| 禁止使用类继承来创建不同类型的 Overlay | 使用函数组合，保持简单 |

---

## 四、参考代码索引

| 功能 | 参考位置 | 说明 |
|------|----------|------|
| 虚拟鼠标逻辑 | `main.js` L815-916 `updateVirtualMouse()` | 完整照抄，只改存储位置 |
| 视差计算公式 | `main.js` L860-871 | 3D 深度转屏幕视差 |
| 屏幕点绘制 | `main.js` L917-974 `renderScreenOverlay()` | 参考像素绘制循环 |
| 格网结构 | `Window.js` L721-967 `createGridObject()` | 参考格点生成算法 |
| 切片阈值 | `main.js` L1519 `updateLocalGrid()` | `spacing * 0.6` |
| EditConfig 参数 | `manage/EditConfig.js` | size, spacing, halfSize |

---

## 五、Context 参数规范

`OverlaySystem.updateAll(win, context)` 中的 `context` 对象必须包含:

```javascript
{
    // 虚拟鼠标相关
    vmEnabled: boolean,           // 虚拟鼠标开关
    mouseX: number,               // 鼠标屏幕 X (px)
    mouseY: number,               // 鼠标屏幕 Y (px)
    snappedPoint: Point | null,   // 吸附点 (含 xM/xL/xR 等)
    
    // 交互状态
    interactionState: string,     // 'VIEW' | 'FOCUS' | 'EDIT' | ...
    focusedObject: Object | null, // 当前聚焦物体
    focusVirtualMouseDepth: number, // FOCUS 态虚拟鼠标深度
}
```

---

## 六、zIndex 规范

| Overlay | zIndex | 说明 |
|---------|--------|------|
| EditAssist | 50 | EDIT 态辅助格网/截面 |
| VirtualMouse | 100 | 虚拟鼠标圈 (最上层) |

---

## 七、验证清单

实施完成后需验证:

- [ ] VIEW 态: 虚拟鼠标正常显示，圆圈跟随/吸附
- [ ] FOCUS 态: 虚拟鼠标正常显示，带深度视差
- [ ] EDIT 态: 辅助格网显示，截面轮廓显示
- [ ] 各状态切换: 无残留点、无闪烁
- [ ] 性能: 帧率无明显下降
