# EDIT 态截面点云视觉增强方案 (方案二：差异化渲染)

## 1. 背景与目标 (Background & Objective)

### 1.1 背景
在 EDIT 态下，被编辑物体的截面形状（由靠近切片平面的点云构成）显示不够明显，难以与背景点云区分，影响用户对物体剖面的感知。

### 1.2 目标
*   **显著提升**截面点云的视觉明显度。
*   **仅使用渲染样式调整**（方案二），不改变点云密度（不重采样）也不进行几何拓扑连接。
*   **具体样式**：
    *   **颜色**：白色 (White, RGB 255,255,255)，利用红蓝眼镜的融合特性实现高亮。
    *   **半径**：`radius` 设为 **3**（增大点的大小）。
    *   **亮度**：不强制修改 `light` 属性（保持光照计算或原有衰减逻辑），仅通过颜色和半径增强。

---

## 2. 实施方案 (Implementation Plan)

### 2.1 引入新标签系统 (`manage/StyleImpl.js`)

我们需要一种机制来区分“普通点”和“切片上的点”。
目前 `StyleImpl.js` 通过 `TAGS` 定义样式。建议新增一个专门用于切片高亮的 Tag样式，或者复用现有机制。

由于点的 Tag 通常是静态分配的（如 `SURFACE`, `CONTROL`），动态修改 Tag 可能会有副作用。
**更好的做法**：在样式系统中定义一个特殊的“覆盖规则”或新增一个专门的 `SLICE_HIGHLIGHT` Tag，并在每帧计算时动态应用。

**步骤**：
1.  在 `StyleImpl.TAGS` 中新增：
    ```javascript
    SLICE_HIGHLIGHT: {
        colorMode: 'fixed',    // 使用固定颜色
        color: '#FFFFFF',      // 白色
        radius: 3,             // 半径增大
        glowRadius: 3,         // 泛光半径
        neighborRule: 'glow'   // 保持泛光效果
    }
    ```

### 2.2 动态标记切片点 (`main.js` -> `render` 或 `gameLoop`)

我们需要在每帧渲染前，识别出哪些点位于当前切片平面上，并临时赋予它们高亮样式。

**最佳切入点**：`base/Window.js` 的 `calculate` 方法（投影计算阶段）。
但为了不污染底层 `Window.js` 的通用性，且无需每次都重新计算 Tag（Tag 修改是持久的），我们可以在 `main.js` 的逻辑中处理。

然而，`displayPoints` 的坐标是局部的，切片判定需要世界坐标或特定的投影逻辑。
最稳妥的方式是在 `Window.js` 投影时，如果处于 EDIT 态，顺便做这个检测。

**修正策略**：考虑到性能和架构，我们在 **`Window.calculateBasePoint`** 内部或调用处，**根据距离动态决定使用的 Style Key**，而不是修改点本身的 Tag。

**实施步骤 (`base/Window.js`)**:

1.  修改 `calculate` 方法，增加 `sliceConfig` 参数或从全局读取与切片相关的配置（`editDepthLayer` 等）。
2.  在遍历点的循环中：
    ```javascript
    // 伪代码
    for (let point of object.displayPoints) {
        // 计算点到切片平面的距离
        const layerZ = SystemState.editDepthLayer * CONFIG.spacing;
        const dist = Math.abs(point.lz - layerZ);
        
        let renderStyle = point.tag; // 默认使用点的原始 Tag
        
        // [New Logic] 如果非常靠近切片（例如阈值 0.5cm），使用高亮样式
        if (SystemState.interactionState === 'EDIT' && object === SystemState.focusedObject) {
             if (dist < 0.5) { // 阈值需可配
                 renderStyle = 'SLICE_HIGHLIGHT';
             }
        }
        
        // 将 renderStyle 传递给 calculateBasePoint 或直接用于渲染列表
        this.calculateBasePoint(..., point, renderStyle); 
    }
    ```
    
*注意*：`Window.js` 的 `calculateBasePoint` 最终生成的是 `grid` 数据。我们需要在 `grid` 中存储这个临时的样式信息，供 `Renderer.js` 使用。

**或者更简单的侵入式修改**：
在 `calculate` 中，如果满足条件，**临时修改点的 `_tempTag`**，渲染器优先读取 `_tempTag`。渲染结束后（或下一帧开始前）清除？不，这太复杂。

**推荐方案**：
在 `Renderer.js` 中 **后处理**。
渲染器拿到的 `win.grid` 中的点，通常已经丢失了原始 Object 的上下文（只剩下坐标和颜色引用）。
所以必须在 `Window.js` 中处理。

**最终确认路径**：
1.  **修改 `base/Window.js`**: `calculate` 方法增加切片判定逻辑。
2.  对于符合切片条件的点，在将其放入 `this.grid` 时，**覆盖其样式属性**（不是修改原始点，而是修改推入 Grid 的投影点对象，或者 Grid 结构本身）。
    *   当前 Grid 存储的是 `winObj`（包含 `x, y, z, originalPoint`）。
    *   可以在 `originalPoint` (引用) 上不受影响的情况下，给 `winObj` 增加一个 `highlight: true` 标记。
3.  **修改 `manage/Renderer.js`**:
    *   在 `render` 循环中，检查 `winObj.highlight`。
    *   如果为 true，则在绘制时使用白色和 Radius=3，忽略原始 Tag 的颜色/半径。

### 2.3 详细步骤

#### 2.3.1 `base/Window.js`
在 `calculate` 方法中：
*   获取当前 `focusedObject` 和 `editDepthLayer`。
*   遍历点时，计算 `dist = Math.abs(point.lz - layerZ)`。
*   如果 `dist < threshold`，调用 `calculateBasePoint(..., { highlight: true })`。
*   修改 `calculateBasePoint` 接收 `options` 参数，并将 `highlight` 属性附加到生成的屏幕投影对象上。

#### 2.3.2 `manage/Renderer.js`
在 `render` 方法中：
*   遍历 `grid`。
*   在调用 `drawPoint` 或 `drawGlow` 时：
    ```javascript
    // 伪代码
    let color = point.color;
    let radius = style.radius;
    
    if (point.highlight) { // 来自 Window 传递的标记
        color = '#FFFFFF';
        radius = 3;
    }
    // 执行绘制...
    ```

---

## 3. 风险评估

*   **性能**：每帧增加了一次减法和绝对值运算（距离判断），开销忽略不计。
*   **状态污染**：通过在**屏幕投影对象**（瞬态数据）上打标记，而不是修改原始数据点，非常安全，不会污染模型数据。
*   **兼容性**：仅在 EDIT 态生效，不影响 VIEW/FOCUS 态。

## 4. 总结
该方案通过在投影计算阶段识别切片点，并在渲染阶段应用“白色 + 半径3”的覆盖样式，实现了截面视觉增强，且不涉及重采样或复杂的几何计算，符合“方案二”的要求。
