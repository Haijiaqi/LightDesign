# 物理系统“首帧跳变”问题排查报告

## 1. 问题摘要
**现象**：
在基于 Verlet 积分的物理系统中，当物体完成静止回正（Settle & Commit）后，下一次通过交互（SWIPE）重新激活物理模拟时，物体会由于内部应力释放产生一次非预期的“整体震颤”或位移（Delta Magnitude ~0.08）。

**现状**：
- Settle 阶段的视觉跳变已彻底解决（通过跳过 Settle 帧物理计算 + 局部坐标拟合）。
- Commit 阶段数据正确（Position = OldPosition = Ideal, Velocity = 0）。
- 问题仅存在于 **物理重新激活的第一帧 (First Step Analysis)**。

---

## 2. 技术架构背景
系统是一个运行在浏览器端的轻量级物理引擎：
1.  **积分方法**：Verlet Integration ($x_{t+1} = 2x_t - x_{t-1} + a \cdot \Delta t^2$)。
2.  **交互方式**：Direct Manipulation。Swipe 操作通过修改被触碰粒子的 `oldPosition` 来注入瞬时速度 ($v \approx x_t - x_{t-1}$)。
3.  **防止塑性形变机制 (Commit)**：
    *   为了防止软体长时间运行后的坍塌或形变，系统在静止（Settle）时执行 `commitPhysicsState()`。
    *   **算法**：使用 Kabsch 算法将当前粒子点云与 `_referenceShape`（参考形状）进行刚体拟合，计算最佳旋转和中心。
    *   **强制归位**：计算出理想刚体位置 `Ideal`，并强制设置 `particle.position = particle.oldPosition = Ideal`。

---

## 3. 详细现象与数据追踪

我们将整个过程的时间轴分解如下：

### 阶段 A: Settle (静止回正) - **✅ 已验证正常**
*   **操作**：检测到平均速度 < 阈值，执行 Commit。
*   **逻辑**：
    1.  计算当前粒子群相对于质心的局部坐标。
    2.  与 `_referenceShape` 进行刚体匹配，得到旋转 $R$ 和中心 $C$。
    3.  强制将所有粒子重置到 $P_{ideal} = C + R \cdot P_{ref\_local}$。
    4.  清零动量：$P_{old} \leftarrow P_{new}$。
*   **状态**：此时物体处于完美的数学刚体状态，无视觉跳变，无初速度。

### 阶段 B: Hibernate (休眠) - **✅ 已验证正常**
*   物理循环停止，渲染直接使用 Commit 后的坐标。
*   日志显示坐标保持恒定。

### 阶段 C: Interaction (交互触发) - **✅ 已验证正常**
*   **操作**：用户 Swipe 某个粒子 $P_i$。
*   **逻辑**：
    *   `_physicsActive = true`。
    *   仅修改被触碰粒子的 `oldPosition`：$P_i.old \leftarrow P_i.old - \text{disp}$。
*   **数据检查**：
    *   被触碰粒子：具有了非零的隐含速度。
    *   未触碰粒子 $P_j$：$P_j.pos == P_j.old$（即初速度严格为 0）。

### 阶段 D: Physics Reactivation (首帧计算) - **❌ 问题所在**
*   **操作**：执行第一次 `PhysicsSystem.step()`。
*   **预期**：只有被触碰的粒子 $P_i$ 开始运动，通过约束逐渐拉动周围粒子。
*   **实际**：
    *   **所有粒子**（包括完全未触碰的远端粒子）在第一帧就产生了显著位移。
    *   日志显示 Delta 约为 0.08 (cm)，肉眼可见一次“抖动”。

---

## 4. 根因分析：几何约束冲突 (Geometric Constraint Conflict)

经过排查，问题定位在 **Commit 产生的“理想刚体形态”与物理系统的“约束静息长度”不一致**。

1.  **拓扑构建时**：
    *   物理约束（Springs/Constraints）的 `restLength` 是基于最初的几何形状创建的。

2.  **Commit 时**：
    *   Kabsch 算法找到的是“最佳拟合”位置，但对于软体或由离散点构成的形状，**拟合后的刚体位置（Ideal Positions）并不一定能完美满足所有的距离约束**。
    *   例如：简单的三角形结构，如果拟合导致顶点位置微调，其边长可能变为 0.99 或 1.01，而约束的 `restLength` 仍为 1.00。

3.  **物理重启时**：
    *   虽然粒子的速度为 0（$pos == oldPos$），但位置本身处于“预加载应力”（Pre-loaded Stress）状态。
    *   $Force_{spring} = k \cdot (distance - restLength)$。
    *   由于 $distance \neq restLength$，Verlet 积分在第一步就会计算出巨大的修正力。
    *   结果：物体在第一帧为了释放这些微小的几何应力，发生了整体震颤。

---

## 5. 解决方案迭代

### 方案 1: 仅位置重置 (Only Position Reset) - **失败**
*   仅强制 `pos = ideal`。
*   结果：由于约束不匹配，第一帧立刻弹开。

### 方案 2 (当前尝试): 重构静息长度 (Re-bake Constraints) - **待专家评估**
*   **思路**：Commit 不仅仅是重置位置，实际上定义了一个新的物理“零势能态”。
*   **实现**：在 `commitPhysicsState` 的最后，遍历所有约束，将 `constraint.restLength` 更新为当前 `ideal` 位置下的实际距离。
    ```javascript
    // Pseudo-code
    for (c in constraints) {
        c.restLength = distance(particleA.idealPos, particleB.idealPos);
    }
    ```
*   **预期效果**：确保物理重启的第一帧 $F_{internal} \approx 0$。

---

## 6. 待咨询问题

1.  **数值稳定性**：在 Kabsch 拟合 -> 强制归位 -> 重设约束长度 这个循环中，是否会导致长期的体积漂移或几何退化？（因为我们将拟合后的误差“烘焙”进了物理属性中）。
2.  **性能考量**：对于包含约 7500 个约束的物体，每隔几秒钟（Settle时）重算一次所有 `restLength` 是否是最佳实践？是否有更低成本的消除首帧应力的方法（例如 Warm Start 或 Damping 技巧）？
3.  **替代方案**：是否应该保留原始的 `restLength`，而在 Commit 时进行更复杂的“约束兼容性拟合”（Constrained Optimization），而不是简单的刚体变换？
