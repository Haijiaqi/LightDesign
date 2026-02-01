---
description: 物理驱动的交互式旋转控制 (Physics-Driven Interactive Rotation)
---

# 物理驱动的交互式旋转控制 (Interactive Physics Rotation)

## 1. 背景与目标 (Context & Objective)

当前 FOCUS 态的物体旋转（`ROTATE_FOCUSED_OBJECT`）依赖于传统的运动学直接修改 Transform，导致物理状态（粒子位置）与视觉状态（物体姿态）解耦。若开启物理，粒子会瞬间获得极大的虚假速度或产生剧烈震荡。

**目标**：
利用物理引擎的特性，通过用户的鼠标交互（扫动、点击）直接向物体表面的粒子施加**冲量 (Impulse)**，从而自然地驱动物体旋转。这不仅解决了物理一致性问题，还带来了“拨动实体”的沉浸式交互手感。

---

## 2. 交互设计细则 (Interaction Specs)

### A. 鼠标扫动 (Swipe / Tangential Impulse)
*   **触发条件**：
    1.  交互状态为 `FOCUS` 或 `EDIT`。
    2.  鼠标处于移动状态（具有非零速度）。
    3.  鼠标光标与某个**位于当前切片深度平面附近**的粒子重合（Collision）。
*   **物理行为**：
    *   **方向**：平行于屏幕平面，沿鼠标移动向量的方向。
    *   **大小**：正比于鼠标在屏幕上的移动速度。
    *   **频率限制**：对同一粒子，需有冷却时间或相对速度检查，防止能量爆炸。

### B. 鼠标点击 (Poke / Normal Impulse)
*   **触发条件**：
    1.  左键点击 (Click)。
    2.  鼠标射线击中物体表面（最近的可视点）。
*   **物理行为**：
    *   **目标选择**：不需要在当前切片平面上。选择射线投射方向上、距离相机最近的物体表面点。
    *   **方向**：垂直于屏幕平面，指向屏幕内部（Camera Look Direction）。
    *   **大小**：固定值 (Configurable Fixed Impulse)，无蓄力机制。
    *   **范围**：施加 AOE (Area of Effect) 冲量，中心最大，边缘衰减，以产生柔和的扭矩。

---

## 3. 当前代码现状 (Current Status)

| 模块 | 现状描述 | 需修改点 |
| :--- | :--- | :--- |
| **InputManager.js** | 已计算鼠标速度 (`dx`, `dy`)，但目前多用于 View 旋转。`handleEditMouseMove` 仅处理拖拽。 | 需新增 `handleFocusMouseMove`，检测扫动意图并生成 `SWIPE_PHYSICS_IMPULSE`。 |
| **PhysicsSystem.js** | 核心引擎，支持 Verlet 积分。粒子已有 `velocity` 和 `force` 属性。 | 无需修改核心，但需确保在施加冲量时正确处理唤醒和 NaN 检查。 |
| **main.js** | 只能处理 `FOCUS_PHYSICS_TOUCH` (点击)。切片逻辑分散。 | 需新增 `processIntent` 对 `SWIPE_PHYSICS_IMPULSE` 的处理。实现切片平面检测逻辑。优化 `FOCUS_PHYSICS_TOUCH` 的目标选择。 |
| **EditConfig.js** | (需确认) 是否有物理交互参数。 | **新增**：在配置中添加 `InteractionForces` 节，避免硬编码。 |

---

## 4. 实施阶段 (Implementation Stages)

### Phase 0: 配置扩展 (Configuration)

**目标**：将交互参数抽离到配置中，保证可扩展性和可调性。

*   **修改文件**: `manage/EditConfig.js` (或 `Config.js` 如果那是主配置)
*   **新增配置**:
    ```javascript
    InteractionForces: {
        swipeGain: 0.1,          // 鼠标速度 -> 冲量系数
        swipeCooldown: 100,      // 扫动防抖冷却 (ms)
        swipeSliceThreshold: 0.8,// 扫动切片吸附阈值 (cm)
        pokeImpulse: 20.0,       // 点击垂直冲量 (固定值)
        pokeRadius: 5.0,         // 点击 AOE 半径 (cm)
        pokeDecay: 'gaussian'    // 衰减类型
    }
    ```

### Phase 1: 切片检测与意图生成 (Input & Detection)

**目标**：让 `InputManager` 能够识别鼠标是否“扫过”了当前切片层上的点。

*   **修改文件**: `manage/InputManager.js`
*   **新增逻辑**:
    1.  **输入采样**: 利用 `SystemState.lastMouseX/Y` 计算 `mouseVelocity`。
    2.  **命中检测 (Hit Test)**:
        *   **禁止**：遍历所有点。
        *   **采用**：`SystemState.mainWindow.findNearestPoint` (已有的空间哈希或遍历优化)。
        *   **过滤条件**:
            *   点必须属于 `focusedObject`。
            *   **关键**: 点到切片平面的距离必须小于阈值 (`EditConfig.InteractionForces.swipeSliceThreshold`)。
            *   平面定义：以 `SystemState.focusSliceDepth` 为 Z 偏移的视平面。
    3.  **意图生成**:
        *   如果命中且 `mouseSpeed > threshold`，生成 `SWIPE_PHYSICS_IMPULSE` 意图。
        *   Payload: `{ point, velocity: {x, y}, timestamp }`。
*   **妥善处理**: 确保在每帧只触发有限次数的意图，避免事件洪流。

### Phase 2: 冲量施加与防抖 (Physics Logic)

**目标**：在 `main.js` 中处理意图，将屏幕速度转换为物理冲量，并防止数值不稳定。

*   **修改文件**: `main.js`
*   **处理逻辑 (`processIntent`)**:
    1.  **解析意图**: 获取目标点 $P$ 和屏幕速度 $\vec{v}_{screen}$。
    2.  **坐标转换**: 
        *   $\vec{v}_{world} = \vec{v}_{screen} \times (DPI\_Scale) \times (Perspective\_Factor)$。
        *   方向：沿屏幕 X/Y 轴的世界向量（即 `mainWindow.vx` 和 `mainWindow.vy`）。
    3.  **防抖 (Debounce)**:
        *   检查 `P._lastImpulseFrame`。如果等于 `currentFrame`，跳过（防止同帧多次受力）。
        *   **相对速度检查**: 只有当 `dot(v_world, v_particle) < |v_particle|^2` 时才施力。
    4.  **施力 (Verlet Friendly)**:
        *   **注意**: 直接修改 `velocity` 在 Verlet 积分中可能被重置或无法正确传递。
        *   **采用位置偏移法**:
            *   计算每帧位移增量: $\Delta \vec{x} = \vec{v}_{world} \cdot dt \cdot \text{Gain}$。
            *   修改 `oldPosition`: `P.oldPosition -= Δx`。
            *   这等效于赋予粒子瞬时速度，且被 Verlet 积分器自然接纳。
    5.  **质心权重 (Optional)**: 对 Swipe 冲量施加基于距离的权重 `w = clamp(|r| / R_max, 0, 1)`，增强旋转感。
    6.  **唤醒**: `obj._physicsActive = true`。

### Phase 3: 戳击增强 (Poke Enhancement)

**目标**：升级现有的 `FOCUS_PHYSICS_TOUCH`，使其产生更自然的“推击”效果。

*   **修改文件**: `main.js`
*   **优化逻辑**:
    1.  **目标选择**: 利用现有的 `window.findNearestPoint`，**不**应用切片深度过滤。寻找射线上的最近点。
    2.  **方向锁定**: 强制冲量方向为 `SystemState.mainWindow.direction` (Camera Look Dir)。
    3.  **AOE 衰减**:
        *   找到命中点 $P_{hit}$。
        *   **性能优化**: 优先复用 `window.findNearestPoint` 的底层结构 (如 `Window.grid`) 查找邻居，避免 $O(N)$ 遍历。
        *   权重 $w = \exp(-r^2 / \sigma^2)$。
        *   对每个邻居施加 $\vec{I} = \vec{I}_{fixed} \cdot w$ (转换为 `oldPosition` 偏移)。

---

## 5. 约束与禁止 (Restrictions)

1.  **禁止引入新类**: 不要创建 `InteractionManager` 或 `PhysicsInputHandler`。逻辑极其简单，直接在 `processIntent` 中完全展开即可。
2.  **禁止复杂反解**: 不要试图根据鼠标位移反推“应该旋转多少度”然后再用 Torque 逼近。相信正向模拟 (Forward Simulation) —— 给个力，让物理引擎自己算旋转。
3.  **禁止修改 PhysicsSystem**: 不要修改 `PhysicsSystem.step` 的内部积分逻辑。只修改粒子的 `velocity` 属性，这是符合接口规范的。
4.  **状态闭环**: 所有的临时属性（如 `_lastImpulseFrame`）挂载在 `Point` 实例上是允许的，但无需序列化。

---

## 6. 验证方案 (Verification)

1.  **验证扫动**: 进入 FOCUS 态，鼠标横向快速划过物体表面。预期：物体应顺着鼠标方向开始自转。如果鼠标停下，物体应因阻尼逐渐停下。
2.  **验证切片**: 调整切片深度 (`Scroll`)。预期：只有切片平面处的“截面点”能被拨动，其他深度的点对鼠标无反应。
3.  **验证戳击**: 鼠标左击物体边缘。预期：物体应产生围绕质心的旋转，且受击部位有轻微内陷（弹性表现）。

