# 物体坐标系重构方案文档 (v1.0)
> 本文档定义了将 `Object` 坐标体系从“直接修改世界坐标”迁移至“局部坐标 + 变换”架构的实施规范。
> **核心原则**：所有几何数据存储在局部空间 (Local Space)，世界状态仅由 Center + Quaternion 驱动。

---

## 1. 核心数据结构变更
### 文件: `base/Object.js`, `base/Point.js`

### 1.1 Point 类变更 (`Point.js`)
*   **增加属性**：
    *   `lx`, `ly`, `lz` (Number): 存储局部坐标 (Local Coordinates)。这是点的**源头真值**。
    *   `x`, `y`, `z` (Number): 存储世界坐标 (World Coordinates)。这是**派生数据**（缓存），仅用于渲染和查询。
*   **构造函数**：
    *   初始化时传入的 `x,y,z` 同时赋值给局部和世界属性。

### 1.2 Object 类变更 (`Object.js`)
*   **增加 Transform 组件**：
    ```javascript
    this.transform = {
        position: { x: 0, y: 0, z: 0 }, // 对应原 center (System of Record)
        rotation: { w: 1, x: 0, y: 0, z: 0 }, // Quaternion (System of Record)
        scale: { x: 1, y: 1, z: 1 }     // 预留
    };
    ```
*   **状态标记**：
    *   `_dirty` (Boolean): 标记世界坐标是否需要重新计算。
*   **核心方法**：
    *   `updateWorldPoints()`: 执行 $P_{world} = Q \cdot P_{local} \cdot S + T$。
    *   **规范**：每次 `updateWorldPoints` 后，必须归一化 `rotation` 四元数。

### 1.3 `updateWorldPoints()` 调用契约（强制）
1.  **Object 内部不得自动懒更新 (No Hidden Lazy)**：不要试图在 getter 中检查 dirty 并更新，这会掩盖性能问题。
2.  **立即一致性**：任意修改以下字段之一，**必须**在同一逻辑帧内（最好是修改后立即）调用 `updateWorldPoints()`：
    *   `transform.position`
    *   `transform.rotation`
    *   任意 `Point.lx / ly / lz`
3.  **消费端禁止更新**：`Renderer` / `HitTest` / `Window` 等系统 **不得**自行调用 `updateWorldPoints()`。它们只能假设 world 数据是“已经更新完成的”。

### 1.4 Scale 说明（强制约束）
*   `scale` 仅为未来预留字段，当前版本：
    *   ❌ **不允许**通过任何交互或代码修改 `scale`。
    *   ❌ **不允许**参与物理、编辑、吸附、Undo。
*   `updateWorldPoints()` 中可以保留 S 的乘法位置，但 `scale` 必须始终保持 `(1, 1, 1)`。

---

## 2. 场景实施规范 (按数据流向)

### 2.1 场景一：物体整体移动 (MOVE)
**涉及文件**: `main.js` (`moveObjectTo`)
*   **修改前**: 遍历 `displayPoints/controlPoints`，逐点 `p.x += dx`。
*   **修改后**:
    1.  更新 `obj.transform.position` (即 center)。
    2.  `Point.lx/ly/lz` **保持不变** (禁止修改)。
    3.  标记 `obj._dirty = true`。
    4.  调用 `obj.updateWorldPoints()`。
*   **系统约束**: 
    > 所有依赖 World Position 的外部系统（如 `Window.grid` 吸附缓存、空间索引）必须监听或在下一帧检查 `_dirty` 状态并刷新缓存，否则会导致“幽灵吸附”。

### 2.2 场景二：物体整体旋转 (ROTATE)
**涉及文件**: `manage/OrientationImpl.js`, `main.js`
*   **修改前**: 遍历点执行旋转矩阵乘法，累积浮点误差。
*   **修改后**:
    1.  通过四元数乘法更新 `obj.transform.rotation`。
    2.  执行 `obj.transform.rotation.normalize()` **(关键)**。
    3.  `Point.lx/ly/lz` **保持不变**。
    4.  标记 `obj._dirty = true` 并调用 `updateWorldPoints()`。
*   **收益**: 即使旋转 100 万次，局部几何形状 (`localPoints`) 永远零无损，彻底根治“椭球化”和“法向漂移”。

### 2.3 场景三：编辑态修改形状 (EDIT)
**涉及文件**: `main.js` (Interactions), `base/Object.js`
*   **流程**:
    1.  **Input**:获取鼠标世界坐标 $P_{mouse}$ 和目标控制点引用 `targetPoint`。
    2.  **Inverse Compute (反算)**:
        $$ P_{local} = Q^{-1} \cdot (P_{mouse} - T) $$
    3.  **Update**: 更新 `targetPoint.lx/ly/lz` 为 $P_{local}$。
    4.  **Dirty**: 标记 `obj._dirty = true`。
    5.  **Refresh**: 调用 `updateWorldPoints()` 刷新世界坐标以供渲染。
*   **关键约束 (3.3-A)**:
    > **编辑参考系必须明确**：吸附 (Snap)、整数网格、对称性约束等操作，必须作用在 **Local Space**。
    > *   错误的例子：在世界空间吸附到 y=0（物体旋转后这没有任何物理意义）。
    > *   正确的例子：在局部空间吸附到 ly=0（即物体的赤道面）。
*   **性能优化 (3.3-B)**:
    > 拖拽过程中允许只更新 `targetPoint` 的世界坐标以提升帧率，但在 `mouseup` (操作结束) 时必须执行一次全量 `updateWorldPoints()` 以保证数据一致性。
*   **强制约束 (3.3-C - EDIT 模式不变量)**:
    > 在 EDIT 态：
    > *   ❌ **禁止**修改 `obj.transform.position`。
    > *   ❌ **禁止**修改 `obj.transform.rotation`。
    > *   **只允许**修改 `Point.lx / ly / lz`。

### 2.4 场景四：物理模拟 (PHYSICS)
**涉及文件**: `base/Object.js` (Physics Integration)
*   **流向区分 (3.4-A)**:
    | 情况 | 修改 Center/Quaternion | 修改 lx/ly/lz |
    | :--- | :--- | :--- |
    | **纯刚体 (Rigid)** | ✅ (物理引擎输出) | ❌ (禁止) |
    | **软体形变 (Soft)** | ❌ (或部分) | ✅ (反算: $Q^{-1}(P_w - T)$) |
    | **混合 (Hybrid)** | ✅ | ✅ |
*   **数值稳定性 (3.4-B)**:
    > 从 Physics Global 回写 Local 时，必须引入**阈值过滤**或**平滑滤波**，防止物理引擎的微小抖动污染局部几何数据的纯洁性。
*   **Local 回写策略 (3.4-C - 推荐)**:
    > Physics → Local 回写时，允许以下策略之一（由实现选择）：
    > 1.  **阈值写入** ( $|Δ| < ε$ 不写)。
    > 2.  **时间平滑** (EMA / critically damped)。
    > 3.  **阶域投影** (仅回写 $l \ge L_{min}$)。
    > *   ❌ **禁止**逐帧无条件覆盖 `lx/ly/lz`（会引入累积误差）。

### 2.5 场景五：Local Grid 更新
**涉及文件**: `base/Object.js` (LocalGrid logic)
*   **规范**:
    *   Local Grid 的点本质是局部坐标 (e.g., $lx \in [-10, 10], ly \in [-10, 10], lz=0$)。
    *   **禁止**单独计算 Local Grid 的世界位置。
    *   **必须**将其纳入 Object 的渲染管线，与其他点一样通过 `updateWorldPoints()` 统一变换到世界空间。
*   **虚拟鼠标约束 (3.5-A)**:
    > 虚拟鼠标可以吸附 Local Grid，但必须基于 Local Grid **变换后** 的世界坐标进行距离检测。

---

## 3. 总线级信息流规范

### 3.1 Undo/Redo 数据层级 (关键)
必须严格区分存储的数据层级，禁止混淆。
*   **EDIT Undo**: 仅存储 **Local Coordinates** (`lx/ly/lz`)。
*   **MOVE/ROTATE Undo**: 仅存储 **Transform** (`center + quaternion`)。
*   **警告**: 永远不要将 World Coordinates (`x/y/z`) 放入 Undo 栈。它们是派生数据，存了就是冗余且会导致不一致。

### 3.2 导出/切片/测量基准
*   **导出 (Export)**:
    *   通常需要 "Bake" (烘焙)：导出前计算一次 $P_{world} = Q \cdot P_{local} + T$，将结果作为文件的顶点坐标。
    *   除非导出格式支持 Transform 节点 (如 glTF)，否则尽量输出烘焙后的世界坐标。
*   **内部逻辑**: 运行时永远保持 `Local + Transform` 分离。

---

## 4. 迁移风险 checklist
*   [ ] **Renderer**: 确认渲染器只读取 `x,y,z`，不读取 `lx,ly,lz`。
*   [ ] **HitTest**: 确认点击检测使用最新的 `x,y,z`。
*   [ ] **Ghosting**: 确认所有移动操作后都清除了旧的空间缓存（如 grid）。
*   [ ] **Identity**: 确认 `Point` 对象在生命周期内保持引用不变，不要在 update 时替换对象。

---
**版本**: 1.0
**状态**: 待排期实施
**优先级**: 高 (High) - 涉及核心数据稳定性
