# EDIT 态控制点切片显示优化方案

## 1. 背景与目标 (Background & Objective)

### 1.1 背景
当前系统在 EDIT 态下，对于普通物体（如球体、立方体等），默认显示所有控制点。当控制点数量较多或物体结构复杂时，全量显示会导致视觉混乱，且难以区分当前编辑平面上的点。

### 1.2 目标
*   **切片显示**：在 EDIT 态下，仅显示“位于当前编辑切片（Slice）附近”的控制点。其他控制点应被隐藏。
*   **非亮度抑制**：不使用将 `light` 设为 0 的方式（这种方式点仍然参与了计算和渲染管线，只是不可见）。
*   **系统级剔除**：在渲染管线的上游（投影/计算阶段）直接剔除不满足条件的点，利用整体处理逻辑实现高效过滤。

### 1.3 约束
*   **例外对象**：局部格网（Local Grid）的控制点（棱点/角点）需要保持**永远显示**（根据前序需求），不受切片深度影响。
*   **普通物体**：受切片深度影响。

---

## 2. 核心实施方案 (Core Implementation Plan)

### 2.1 修改 `base/Window.js` -> `calculate`

**逻辑分析**：
`Window.js` 的 `calculate` 方法负责遍历所有对象，将其点（Display Points 和 Control Points）投影并加入渲染列表 (`this.grid`)。
这是实现“系统级剔除”的最佳位置。如果不在这里调用 `calculateBasePoint`，点就根本不会进入后续的渲染流程。

**修改步骤**：

1.  **获取编辑状态上下文**：
    *   在 `calculate` 函数开始处（或通过参数传入），获取当前的 `SystemState` 信息：
        *   `interactionState` (是否为 'EDIT')
        *   `focusedObject` (当前编辑对象)
        *   `editDepthLayer` (当前切片深度索引)
        *   `EditConfig` (获取层间距 `spacing` 和判定阈值)

2.  **筛选控制点循环**：
    在遍历 `object.controlPoints` 的循环内部加入条件判断：

    ```javascript
    // 伪代码逻辑
    for (let point of object.controlPoints) {
        
        let shouldRender = true;

        // [New Logic] EDIT 态下的切片剔除
        if (SystemState.interactionState === 'EDIT' && object === SystemState.focusedObject) {
            
            // 1. 排除特例：局部格网保持全显
            if (!object.isLocalGrid) {
                
                // 2. 计算点到切片平面的距离
                // 获取点的世界坐标 Z (假设切片是基于 Z 轴或 View Space 的)
                // 注意：这里需要明确切片是 World Space 还是 View Space。
                // 现有的 Edit 逻辑通常是基于 Local Grid 的层 (Layer)。
                
                // 计算逻辑：
                // 面的中心深度 = SystemState.editDepthLayer * EditConfig.spacing
                // 点的局部 Z (或其他轴) = point.lz
                
                // 实际上可以简化为：判断点是否在“高亮显示区”
                // 可以复用 updateLocalGrid 中的距离判断逻辑，或者直接计算：
                
                const layerZ = SystemState.editDepthLayer * EditConfig.spacing;
                // 假设物体的主轴对齐，或者我们需要在 Object Space 进行判断
                const dist = Math.abs(point.lz - layerZ); 
                
                // 3. 阈值判断
                // 阈值通常略大于 0，允许一定的误差，或者等于 displayThreshold
                if (dist > CONFIG.displayThreshold) {
                    shouldRender = false;
                }
            }
        }

        if (shouldRender) {
            this.calculateBasePoint(..., point);
        }
    }
    ```

### 2.2 辅助逻辑 (`manage/Config.js` 或 `SystemState.js`)

*   **配置项**：确保 `CONFIG.displayThreshold` 或 `EditConfig.displayThreshold` 可被 `Window.js` 访问。通常这些已经是全局可访问的。

---

## 3. 详细逻辑推导 (Detailed Logic Derivation)

### 3.1 坐标系问题
*   **Local Grid** 是跟随 Focused Object 的。
*   **Slice Layer** (切片层) 是定义在 Focused Object 的**局部坐标系**中的（通常沿 Z 轴或当前 View 轴）。
*   控制点 `point` 拥有 `lx, ly, lz` (局部坐标)。
*   因此，直接比较 `point.lz` 和 `当前 Layer 的局部 Z 值` 是最直接且准确的方法。

### 3.2 判定公式
*   `LayerDepth = SystemState.editDepthLayer * EditConfig.spacing`
*   `PointDepth = point.lz` (假设编辑是沿 Z 轴切片，后续可扩展支持多轴)
*   `IsVisible = Math.abs(PointDepth - LayerDepth) <= Threshold`

### 3.3 兼容性
*   **VIEW 态**：不做剔除（或者遵循 VIEW 态的规则，通常不显示控制点）。
*   **非 Focused Object**：在 EDIT 态下，背景物体的控制点通常不显示（由现有逻辑控制，或需要确认）。如果设计为显示，则不受切片影响（或受）。**建议**：只有 Focused Object 受切片影响。

---

## 4. 预期效果 (Expected Outcome)

1.  **视觉清晰**：进入 EDIT 态后，用户只能看到当前操作平面上的控制点，背景/前景的控制点消失。
2.  **操作聚焦**：降低了误操作非当前层控制点的风险。
3.  **性能提升**：虽然 JS 逻辑判断增加了微小开销，但减少了大量的投影计算和 Canvas 绘制操作，总体对复杂物体是性能正向的。

## 5. 待确认事项 (Items to Confirm)
*   **多轴支持**：当前系统是否支持切换编辑轴（X/Y/Z）？如果支持，判断逻辑需动态取 `lx`, `ly` 或 `lz`。
    *   *推测*：`SystemState` 中应该有 `orientation` 或 `axis` 状态。需在实施时对接。
