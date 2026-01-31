---
description: 物理驱动的旋转控制与 Kabsch/Q-method 姿态反解 (Phase 17)
---

# 物理驱动的旋转控制与姿态反解 (阶段 17)

## 1. 核心理念 (Philosophy)

**"物理优先交互" (Physics-First Manipulation)**

当前 FOCUS 态的旋转控制直接修改对象 Transform，这会导致物理粒子瞬间"瞬移"，产生巨大的虚假速度和能量爆发。我们将转向物理驱动方案：

1.  **交互 (Interaction)**：用户输入产生**冲量 (Impulse)**，使用现有机制。
2.  **模拟 (Simulation)**：物体遵循物理规律（惯性、阻尼）进行运动和旋转。
3.  **结算 (Settlement)**：物体静止后，使用 **Q-Method (Kabsch 改进版)** 算法从粒子云中反解出最佳旋转姿态，烘焙到参数化对象中，并重置粒子位置。

这确保了：交互的重量感、零塑性形变（形状完美还原）、以及物理与交互的完美统一。

---

## 2. 实施阶段 (Implementation Phases)

### Phase 17.1: 数学核心 (FittingCalculator 增强)

**目标**：在不引入新文件的情况下，赋予系统计算"两组点之间最佳旋转"的能力。

*   **目标文件**: `math/FittingCalculator.js`
*   **做什么**:
    *   实现 `fitRigidTransform(sourcePoints, targetPoints)` 方法。
    *   实现 **Davenport's q-method** 算法（求解 4x4 对称矩阵的最大特征值对应的特征向量）。
    *   **必须**实现为纯函数：不修改类实例状态，不依赖外部状态。
*   **禁止什么**:
    *   禁止引入 `Alignment.js` 或其他新文件。
    *   禁止使用 SVD（因为还需要实现复杂的 SVD 算法），直接使用特征值求解闭式解或简易迭代。
*   **检查点 (交付标准)**:
    *   编写一个临时测试：生成一组点，将其旋转 45 度。调用函数，确认返回的四元数对应 45 度旋转（误差 < 1e-6）。

### Phase 17.2: 对象状态增强 (Shape Restoration)

**目标**：实现"物理状态 -> 参数化状态"的闭环同步，消除积分误差。

*   **目标文件**: `base/Object.js`
*   **做什么**:
    *   **缓存原始形状**: 在 `rebuildPhysicsTopology` 增加 `_referenceShape`（存储粒子相对于中心的原始局部坐标）。
    *   **实现提交逻辑**: `commitPhysicsState()`。
        1. 收集当前粒子位置。
        2. 调用 `FittingCalculator.fitRigidTransform` 求解 $(Position, Quaternion)$。
        3. 更新 `this.center` 和 `this.quaternion`。
        4. **强制重置**: 根据新的 $C, Q$ 和 `_referenceShape`，计算完美的粒子位置，可以直接复用 `rebuildPhysicsTopology` 中的逻辑或新写辅助函数。
        5. 覆盖 `p.position` 和 `p.oldPosition`。
*   **要照抄什么**:
    *   照抄 `rebuildPhysicsTopology` 中计算世界坐标的逻辑用于重置粒子。
*   **检查点 (交付标准)**:
    *   手动拖拽物体使其变形，调用 `obj.commitPhysicsState()`，物体瞬间恢复完美形状但保持当前位置，且物理速度归零。

---

## 3. 具体执行步骤 (Step-by-Step)

### Step 1: `math/FittingCalculator.js` 扩展

1.  **添加 `fitRigidTransform(sourcePoints, targetPoints)`**
    *   **输入**: 两组点集（Float64Array 或 {x,y,z} 数组），必须等长。
    *   **预处理**: 计算两组点的质心 $C_s, C_t$，并将点集中心化：$P'_s = P_s - C_s$, $P'_t = P_t - C_t$。
    *   **计算协方差矩阵**: $H = \sum (P'_s \cdot {P'_t}^T)$ (3x3 矩阵)。
    *   **Davenport's q-method**: 求解 4x4 对称矩阵的最大特征值对应的特征向量（即最佳旋转四元数）。
    *   **反射修正 (Reflection Correction)**: 检查并修正镜像翻转。

### Step 2: `base/Object.js` 状态增强

1.  **`rebuildPhysicsTopology` 修改**:
    *   保存 **Rest Shape** 到 `this._referenceShape`。
    *   存储内容：粒子相对于物体中心的**局部坐标**。
    *   $P_{ref} = Quat^{-1} \cdot (P_{world} - Center)$。

2.  **实现 `commitPhysicsState()`**:
    *   **拟合**: `const { rotation, center } = FittingCalculator.fitRigidTransform(_referenceShape, currentPoints)`。
    *   **硬提交 (Hard Commit)**:
        *   更新 `this.center` 和 `this.quaternion`。
        *   **重置**: 计算 $P_{ideal} = center + rotation \cdot P_{ref}$。
        *   强制将所有粒子的 `position` 和 `oldPosition` 设为 `P_{ideal}`，清零 `velocity`。

### Step 3: 接入与调用 (Integration)

1.  **调用位置**: `main.js` 的 `physicsStep` 函数，**第 2650 行附近**。
2.  **逻辑**:
    ```javascript
    // main.js:2649-2662 (静止检测逻辑内部)
    if (avgVelSq < CONFIG.physicsDisplay.settleVelocityThreshold) {
        obj._physicsActive = false;

        // [Phase 17 新增] 当物理静止时，固化姿态并重置形状
        if (obj.commitPhysicsState) {
            obj.commitPhysicsState();
        }

        // 根据 revertOnSettle 决定是否恢复固有显示
        if (CONFIG.physicsDisplay.revertOnSettle) {
            obj._tempDisplayPoints = null;
            obj._tempDisplayPointsInitialized = false;
        }
        // ...
    }
    ```
    这确保了每次物理震荡结束后，物体的 center 和 quaternion 被更新，粒子形状被精确重置。

---

## 4. 建构点连接详情 (Topology Details)

### 当前实现

| 类型 | 连接方式 | 参数 | 代码位置 |
|------|---------|------|----------|
| **表面点** | KNN 三角化 + 遮挡过滤 | `KNN_3D = 10` | GeometryImpl.js:28 |
| **内部点** | KNN + 距离阈值 | `KNN_INTERNAL = 8` | GeometryImpl.js:30 |
| **皮骨连接** | 距离阈值 (无 KNN 限制) | `maxDistance` | buildSkinBoneTopology |

### 遮挡法 (Occlusion Callback)

**已实现**：`ParametricImpl.createOcclusionCallback` (Line 503-528)

**原理**：判断三角形中心是否在球谐表面内部（$r_{cart} < r_{SH} \times threshold$）。如果三角形中心"陷入"物体内部，则认为该三角形被遮挡，不建立连接。

**特点**：这是**基于参数化曲面的隐式遮挡判定**，计算高效，无需 Ray Casting。

### 优化空间

*   可以将 `KNN_3D` 从 10 降至 **6-8**。
*   可以将 `KNN_INTERNAL` 从 8 降至 **4-5**。
*   **风险**：连接数过低会导致剪切刚度不足（物体变形时容易"滑动"而非"弹回"）。
*   **建议**：先实验，观察效果后再调整。

---

## 特别说明 (Special Notes)

1.  **交互解耦**: 本阶段使用现有冲量机制，不新增 Torque API。具体交互层逻辑延后实施。
2.  **坐标系一致性**: `_referenceShape` 必须是 Body Space 坐标。若未正确剥离当前旋转，会导致 Kabsch 算法计算出的旋转包含"历史旋转"与"新旋转"的混合，导致姿态错乱。

**[Status: Ready for Phase 17]**
