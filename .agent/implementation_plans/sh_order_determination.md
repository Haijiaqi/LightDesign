# 球谐拟合自适应阶数确定方案 (v2.4)

> **状态**: 待评审  
> **日期**: 2026-01-26  
> **版本**: v2.4 (正则分阶衰减、判据角色调整、结构事件判据)

---

## 〇、版本演进记录

| 版本 | 核心变化 |
|------|---------|
| v2.0 | 两阶段框架 |
| v2.1 | 整改：非轴对称、回退策略 |
| v2.2 | 补充：角向变化、局部性、覆盖度 |
| v2.3 | 优化：尺度归一化、阶间差异、区间输出 |
| **v2.4** | 调整：正则分阶、判据角色、结构事件判据 |

---

## 〇、v2.4 调整摘要

| # | 调整内容 | 说明 |
|---|---------|------|
| 1 | λ_structure 分阶衰减 | 高 l 强正则，低 l 弱正则 |
| 2 | Ṽ_l 降级为辅助主判据 | 不得单独否决，必须与 R_E 联合 |
| 3 | Δr_l 联合零交叉判据 | 拓扑复杂度指标 |
| 4 | **新增结构事件判据** | "这一阶有没有引入新的角向事件？" |

---

## 一、必须保留（不可删除）

- ✅ 两阶段结构（A 判阶 + B 稳定拟合）
- ✅ 一次性高阶拟合
- ✅ 能量谱 E_l
- ✅ 结构区间 `{ min, max }` 而非单值
- ✅ Stage B 条件数主导
- ✅ 非轴对称能量判据

---

## 二、算法概述

```
┌─────────────────────────────────────────────────────────────┐
│                    阶段 A：结构判阶                          │
│                                                             │
│  A.0 计算角向覆盖度 → effectiveN                            │
│  A.1 计算候选最高阶 L_max                                   │
│  A.2 [v2.4] 分阶正则拟合（λ 随 l 衰减）                     │
│  A.3 计算各阶能量谱 E_l                                     │
│  A.4 计算归一化角向变化 Ṽ_l                                 │
│  A.5 计算阶间结构差异 Δr_l                                  │
│  A.6 [v2.4 新增] 计算结构事件判据                           │
│  A.7 综合判据 → { L_min, L_max }                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    阶段 B：稳定拟合（不变）                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、阶段 A：结构判阶

### A.2 [v2.4 修正] 分阶正则拟合

#### 问题

v2.3 使用固定 λ_structure = 1e-5：
- 低阶被过度正则 → 能量被压缩
- 高阶正则不够 → 数值不稳定

#### 修正：分阶衰减正则

**核心思想**：让正则强度随阶数调整，低阶弱正则（保留真实能量），高阶强正则（抑制数值爆炸）。

**公式**：

$$\lambda(l) = \lambda_{base} \cdot \left(1 + \alpha \cdot l^2\right)$$

其中：
- `λ_base = 1e-7`（基础正则）
- `α = 0.01`（增长系数）

**效果**：
| l | λ(l) |
|---|------|
| 0 | 1e-7 |
| 5 | 3.5e-7 |
| 10 | 1.1e-6 |
| 15 | 3.2e-6 |

**实现**：

```javascript
/**
 * 分阶正则拟合
 * 对每一阶使用不同的 λ，然后合并系数
 */
function fitWithGradedRegularization(positions, shInstance, fitterInstance, L_max, options = {}) {
    const lambda_base = options.lambda_base ?? 1e-7;
    const alpha = options.alpha ?? 0.01;
    const center = { x: 0, y: 0, z: 0 };
    
    // 仍然一次性拟合，但使用分阶权重矩阵
    // 实现方式：对 A^T A 的对角块施加不同的 λ
    
    const design = shInstance.buildDesignMatrix(positions, center, { order: L_max });
    const A = ParametricImpl._designToRowArray(design);
    const b = Array.from(design.b);
    const m = A.length;
    const n = A[0].length;
    
    // 构建 A^T A
    const ATA = [];
    for (let i = 0; i < n; i++) {
        ATA[i] = new Array(n).fill(0);
    }
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            let sum = 0;
            for (let k = 0; k < m; k++) {
                sum += A[k][i] * A[k][j];
            }
            ATA[i][j] = sum;
        }
    }
    
    // 分阶添加正则项
    let coeffIdx = 0;
    for (let l = 0; l <= L_max; l++) {
        const lambda_l = lambda_base * (1 + alpha * l * l);
        const numCoeffsInLevel = 2 * l + 1;
        
        for (let m = 0; m < numCoeffsInLevel; m++) {
            ATA[coeffIdx][coeffIdx] += lambda_l;
            coeffIdx++;
        }
    }
    
    // 构建 A^T b 并求解
    const ATb = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < m; k++) {
            ATb[i] += A[k][i] * b[k];
        }
    }
    
    const coefficients = fitterInstance._choleskySolve(ATA, ATb, n);
    
    return { coefficients };
}
```

---

### A.4/A.5 判据角色调整

#### [v2.4] 判据分类

| 判据 | 角色 | v2.3 | v2.4 |
|------|------|------|------|
| 能量比 R_E | **主判据** | ✓ | ✓ |
| 归一化变化比 R_V | 主判据 | ✓ | **辅助主判据** |
| 非轴对称比 | 辅助否决 | ✓ | ✓ |
| 阶间结构差异 | 辅助否决 | ✓ | **联合零交叉** |
| **结构事件判据** | — | — | **新增** |

#### R_V 降级说明

v2.3 中 R_V 与 R_E 并列为主判据，存在问题：
- V_l 仍有采样依赖（即使归一化）
- 单独使用可能误判

**v2.4 调整**：
- R_V **不得单独否决**
- 必须与 R_E 联合判断
- 逻辑：`(R_E < threshold) AND (R_V < threshold)` → 可能停阶

---

### A.6 [v2.4 新增] 结构事件判据

#### 设计目标

明确回答：**"这一阶有没有引入新的角向事件？"**

#### "角向事件"定义

| 事件类型 | 数学定义 | 物理意义 |
|---------|---------|---------|
| 零交叉 | r_l(θ,φ) = 0 的次数 | 正负交替次数 |
| 极值点 | ∇r_l = 0 的点数 | 凸起/凹陷数量 |
| 拓扑变化 | 等高线拓扑复杂度 | 形状复杂度 |

#### 工程实现：零交叉计数

```javascript
/**
 * 计算阶 l 在球面采样点上的零交叉次数
 * 
 * "零交叉"：相邻采样点的 r_l 符号改变
 * 
 * @returns {number} 零交叉次数（归一化到采样点数）
 */
function computeZeroCrossings(coeffs_full, l, sphericalCache, shInstance) {
    if (l === 0) return 0;
    
    // 1. 提取阶 l 的系数
    const startIdx = l * l;
    const endIdx = (l + 1) * (l + 1);
    const coeffs_l = new Array(endIdx).fill(0);
    for (let i = startIdx; i < endIdx; i++) {
        coeffs_l[i] = coeffs_full[i];
    }
    
    // 2. 在采样点上计算该阶的重建值
    const r_l = sphericalCache.map(({ theta, phi }) => 
        shInstance.evaluate(coeffs_l, theta, phi)
    );
    
    // 3. 统计相邻点的符号变化
    const K = 6; // 每个点检查 K 个邻居
    let zeroCrossings = 0;
    
    for (let i = 0; i < sphericalCache.length; i++) {
        const neighbors = findKNearestOnSphere(sphericalCache, i, K);
        const sign_i = Math.sign(r_l[i]);
        
        if (sign_i === 0) {
            zeroCrossings += K; // 恰好为零，算作多次交叉
        } else {
            for (const j of neighbors) {
                if (Math.sign(r_l[j]) !== sign_i) {
                    zeroCrossings++;
                }
            }
        }
    }
    
    // 归一化：除以总邻居对数
    return zeroCrossings / (sphericalCache.length * K);
}

/**
 * 结构事件判据
 * 
 * @returns {boolean} true = 该阶引入了新的角向事件
 */
function hasStructuralEvent(coeffs_full, l, sphericalCache, shInstance, options = {}) {
    const threshold_zc = options.threshold_zeroCrossing ?? 0.05;
    
    // 计算零交叉率
    const zc_l = computeZeroCrossings(coeffs_full, l, sphericalCache, shInstance);
    
    // 计算累积零交叉（前 l-1 阶）
    let zc_cumulative = 0;
    for (let k = 1; k < l; k++) {
        zc_cumulative += computeZeroCrossings(coeffs_full, k, sphericalCache, shInstance);
    }
    
    // 判断：该阶是否显著增加了零交叉
    const zc_ratio = zc_cumulative > 1e-10 ? zc_l / zc_cumulative : (zc_l > 0 ? 1 : 0);
    
    return zc_ratio >= threshold_zc;
}
```

---

### A.7 综合判据逻辑（v2.4 最终版）

```javascript
// 阈值
const threshold_energy = 1e-4;
const threshold_variation = 1e-4;
const threshold_nonaxial = 1e-5;
const threshold_zeroCrossing = 0.05;
const minConsecutive = 2;

// 初始化
let L_max_struct = 0;
let L_min_struct = null;
let cumulativeEnergy = energies[0];
let cumulativeVariation = normalizedVariations[0];
let consecutiveBelowThreshold = 0;

for (let l = 1; l <= L_max; l++) {
    // ========== 主判据（必须联合满足）==========
    
    // 能量比
    const R_E = cumulativeEnergy > 1e-15 ? energies[l] / cumulativeEnergy : 0;
    
    // 归一化变化比（辅助主判据，不得单独否决）
    const R_V = cumulativeVariation > 1e-15 ? normalizedVariations[l] / cumulativeVariation : 0;
    
    // 主判据结果：能量 AND 变化 都低于阈值
    // 注意：R_V 不得单独否决，但可以阻止停阶
    const primaryBelowThreshold = (R_E < threshold_energy) && (R_V < threshold_variation);
    
    // ========== 辅助判据（任一触发则延迟停阶）==========
    
    // 非轴对称能量
    const E_nonaxial = computeNonAxialEnergy(coeffs_structure, l);
    const R_nonaxial = cumulativeEnergy > 1e-15 ? E_nonaxial / cumulativeEnergy : 0;
    const nonAxialVeto = (R_nonaxial >= threshold_nonaxial);
    
    // 阶间结构差异 + 零交叉联合判据
    const { hasStructure: interOrderStructure } = computeInterOrderDelta(coeffs_structure, l, sphericalCache, shInstance);
    const hasEvent = hasStructuralEvent(coeffs_structure, l, sphericalCache, shInstance, { threshold_zeroCrossing });
    const structuralVeto = interOrderStructure || hasEvent;
    
    // ========== 综合判定 ==========
    
    // 记录第一次辅助否决触发的位置
    if ((nonAxialVeto || structuralVeto) && L_min_struct === null) {
        L_min_struct = l;
    }
    
    // 是否停阶
    if (primaryBelowThreshold && !nonAxialVeto && !structuralVeto) {
        consecutiveBelowThreshold++;
        if (consecutiveBelowThreshold >= minConsecutive) {
            L_max_struct = l - minConsecutive;
            break;
        }
    } else {
        consecutiveBelowThreshold = 0;
        L_max_struct = l;
    }
    
    cumulativeEnergy += energies[l];
    cumulativeVariation += normalizedVariations[l];
}

// 边界处理
L_max_struct = Math.max(1, L_max_struct);
L_min_struct = L_min_struct ?? 1;
L_min_struct = Math.min(L_min_struct, L_max_struct);

return { min: L_min_struct, max: L_max_struct };
```

---

## 四、判据角色总结（v2.4 最终）

```
主判据（必须联合满足才可能停阶）
├── 能量比 R_E < 1e-4                    [主]
└── 归一化变化比 R_V < 1e-4              [辅助主，不得单独否决]

辅助否决（任一触发则延迟停阶）
├── 非轴对称能量比 R_nonaxial ≥ 1e-5
└── 结构性判据（联合）
    ├── 阶间结构差异 hasStructure
    └── 结构事件判据 hasEvent (零交叉)    [v2.4新增]

输出
└── structureRange = { min, max }
```

---

## 五、新增/修改方法清单

| 方法 | 位置 | 变化 |
|------|------|------|
| `fitWithGradedRegularization()` | `ParametricImpl` | **v2.4新增** |
| `computeZeroCrossings()` | `ParametricImpl` | **v2.4新增** |
| `hasStructuralEvent()` | `ParametricImpl` | **v2.4新增** |
| 其他 v2.3 方法 | - | 保持不变 |

---

## 六、预期效果（v2.4）

| 形状 | 问题场景 | v2.3 结果 | v2.4 修正 |
|------|---------|----------|----------|
| 类圆柱 | 端部有零交叉 | 可能漏判 | **结构事件捕捉** |
| 香肠 | 两头高频 | [2, 8] | **更准确的区间** |
| 局部凸起 | 单侧凸起=符号变化 | 可能漏判 | **零交叉检测** |
| 球体 | 无事件 | [1, 1] | [1, 1] |

---

## 七、禁止事项

- ❌ R_V 不得单独否决（必须与 R_E 联合）
- ❌ 不得使用固定 λ（必须分阶衰减）
- ❌ 不得仅用 Δr_l（必须联合零交叉）
- ❌ 阶段A失败时不得直接返回 L=1
- ❌ 阶数确定过程中禁止使用增量拟合

---

## 八、待确认事项

1. `α = 0.01` 正则增长系数是否合适？
2. `threshold_zeroCrossing = 0.05` 是否过于敏感？
3. 是否需要缓存各阶的零交叉计算结果？

---

**评审确认后开始实施。**
