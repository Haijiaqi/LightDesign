# 局部格网棱点与显示优化实施方案

## 1. 背景与目标 (Background & Objective)

### 1.1 背景
当前系统处于 EDIT 态时，会生成一个局部格网（Local Grid）辅助用户操作。
*   **棱上点/角点**：目前作为“控制点 (Control Points)”存储，依赖控制点的渲染机制，在 EDIT 态下始终显示。Tag 为 `LOCAL_GRID_CONTROL`。
*   **普通点**：作为“显示点 (Display Points)”存储，Tag 为 `LOCAL_GRID`。仅在靠近屏幕平面（Slice）时显示。

### 1.2 目标
用户希望对局部格网的属性和显示逻辑进行改造：
1.  **属性转换**：棱上点**不再**作为控制点存储（移出 `controlPoints` 数组），转为普通的显示点。
2.  **保持常显**：棱上点虽然转为普通点，但需保持在 EDIT 态下**永远显示**（不被 Slice 深度裁剪）。
3.  **视觉增强**：所有允许显示的局部格网点（包括普通点和棱点），其显示半径（Radius）需统一调整为 **3**，以提高明显程度。

---

## 2. 现状分析 (Current State Analysis)

### 2.1 创建逻辑 (`manage/ObjectFactoryImpl.js`)
*   函数 `createLocalGridObject(targetObj)` 负责创建格网。
*   通过 `edgeCount >= 2` 判断点是否在棱/角上。
*   **现状**：
    *   棱点：`p.tag = 'LOCAL_GRID_CONTROL'`, `controlPoints.push(p)`, `points.push(p)`。
    *   普通点：`p.tag = 'LOCAL_GRID'`, `points.push(p)`。

### 2.2 更新逻辑 (`main.js` -> `updateLocalGrid`)
*   该函数负责每帧更新格网点的 `light` (亮度/可见性) 和 `isAttractable` 属性。
*   **现状**：
    *   遍历 `grid.displayPoints`。
    *   计算 `absDist` (点到屏幕平面的距离)。
    *   如果 `absDist <= Threshold`，则 `light = 0.8`。
    *   **遗漏**：目前代码对棱点（作为 `controlPoints`）的显示主要是因为它们在 `controlPoints` 列表里，Window 渲染器默认会绘制所有控制点。`updateLocalGrid` 主要是在处理 `LOCAL_GRID` 和 `LOCAL_GRID_DASH`。

### 2.3 样式系统 (`manage/StyleImpl.js`)
*   定义了不同 Tag 的渲染样式（颜色、半径等）。
*   **现状**：
    *   `LOCAL_GRID`: 可能使用默认半径（通常较小）。
    *   `LOCAL_GRID_CONTROL`: `glowRadius: 3` (之前的修改)。

---

## 3. 改造实施方案 (Implementation Plan)

### 3.1 步骤一：重构格网对象创建 (Refactor Object Creation)

**文件**: `manage/ObjectFactoryImpl.js`

1.  **修改 Tag 命名**：
    *   为了消除歧义，将棱上点的 Tag 从 `LOCAL_GRID_CONTROL` 修改为 **`LOCAL_GRID_EDGE`**。
    *   这明确了它们是“棱点”，而不是“控制点”。

2.  **移除 Control Point 存储**：
    *   在 `createLocalGridObject` 中，**不再**执行 `controlPoints.push(p)`。
    *   棱点仅保留在 `points` (即 displayPoints) 数组中。

3.  **配置初始属性**：
    *   `LOCAL_GRID_EDGE`: `isAttractable = true`。
    *   `LOCAL_GRID`: `isAttractable = true` (保持现状)。

### 3.2 步骤二：更新显示逻辑 (Update Visibility Logic)

**文件**: `main.js`

1.  **修改 `updateLocalGrid` 函数**：
    *   增加对新 Tag `LOCAL_GRID_EDGE` 的处理。
    *   **逻辑分支**：
        *   **If Point is `LOCAL_GRID_EDGE`**:
            *   **始终可见**：忽略距离裁剪逻辑（不将其 light 设为 0）。
            *   设置 `p.isAttractable = true` (始终可吸附)。
        *   **If Point is `LOCAL_GRID`**:
            *   **条件显示**：保持现有的 `absDist <= CONFIG.displayThreshold` 判断。
            *   可见时 `p.isAttractable = true`。

### 3.3 步骤三：调整视觉样式 (Adjust Visual Styles)

**文件**: `manage/StyleImpl.js`

1.  **定义/更新 `LOCAL_GRID_EDGE` 样式**：
    *   继承原 `LOCAL_GRID` 或 `CONTROL` 的颜色属性。
    *   关键设置：`glowRadius: 3` (根据用户要求)。

2.  **更新 `LOCAL_GRID` 样式**：
    *   调整普通格点的样式。
    *   关键设置：`glowRadius: 3` (用户要求所有普通点提高明显程度)。

---

## 4. 依赖与风险 (Dependencies & Risks)

### 4.1 吸附行为 (Snapping)
*   **风险**：原逻辑可能依赖 `obj.controlPoints` 来查找吸附目标？
*   **确认**：不管是 Control Point 还是 Display Point，只要 `isAttractable = true`，`InputManager` 中的虚拟鼠标逻辑（基于 Window 格网索引）应该都能捕捉到。Local Grid 的点会被注入到 `Window.grid` 中，因此吸附应当正常工作。
*   **验证**：实施后重点测试将控制点拖拽到棱点上是否仍能吸附。

### 4.2 渲染性能
*   棱点数量相对较少，强制显示不会带来明显的性能负担。
*   普通点的 Radius 变大可能会轻微增加光栅化开销，但在可接受范围内。

### 4.3 交互冲突
*   原逻辑中，棱点作为 `controlPoints` 可能具有某些特殊的交互优先级。
*   改造后，它们只是普通的背景参考点（不可拖拽），这符合 Local Grid 的定位（它是参考系，不是被编辑对象）。用户的编辑对象只有 Focused Object 的控制点。
