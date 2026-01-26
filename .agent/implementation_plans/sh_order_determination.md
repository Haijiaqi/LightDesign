# 球谐拟合自适应阶数确定方案 (v3.0 结构计数版)

> **状态**: 待评审  
> **日期**: 2026-01-26  
> **版本**: v3.0 (全局结构计数主导)

---

## 〇、核心思想（用户原话复述）

> **多项式类比**：
> 1. 先拟合到最高阶
> 2. 计算拟合多项式的导数
> 3. 数"导数为零（且二阶导不为零）"的点 = 拐点数
> 4. 拐点数 + 1 = 最合适的阶数
>
> **直觉**：如果四次函数也只拐一个弯，还不如用二次函数拟合。

---

## 〇、v3.0 与之前版本的核心区别

| 方面 | v2.4 (旧) | v3.0 (新) |
|------|----------|----------|
| **判阶方式** | 从 L=1 开始，逐阶检查能量/变化是否"低于阈值" | 先拟合 L_max，从完整结果**反推"拐弯次数"** |
| **主判据** | 能量比 R_E < 阈值 | **全局结构计数 S_total → L_direct** |
| **计算顺序** | 低阶 → 高阶（逐阶累积） | **高阶先行，一步到位** |
| **能量/变化判据** | 主判据 | **降级为辅助约束** |

---

## 一、总体原则

1. **先拟合最高阶，再从结果反推阶数**（核心改动）
2. 阶数判定与最终拟合必须分离
3. 最终拟合阶段必须数值稳定
4. 阶段 B（条件数控制）完全不变

---

## 二、算法概述

```
┌─────────────────────────────────────────────────────────────┐
│                    阶段 A：结构判阶（v3.0）                  │
│                                                             │
│  A.1 计算候选最高阶 L_max                                   │
│  A.2 一次性拟合到 L_max（分阶正则）                         │
│  A.3 [核心] 全局角向结构计数 → S_total                      │
│  A.4 [核心] 结构计数 → 阶数映射 → L_direct                  │
│  A.5 [辅助] 能量/变化停阶（降级为约束）                     │
│  A.6 综合 → [L_min_struct, L_max_struct]                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    阶段 B：稳定拟合（不变）                  │
│                                                             │
│  B.1 在 [L_min_struct, L_max_struct] 逐阶拟合               │
│  B.2 主判据：条件数                                         │
│  B.3 → L_final                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、阶段 A：结构判阶（v3.0 详细设计）

### A.1~A.2 不变

（候选 L_max、分阶正则拟合，与 v2.4 相同）

---

### A.3 [核心] 全局角向结构计数

#### 目的

不问"这一阶能量多不多"，而是直接问：
> **"这个函数在球面上到底发生了多少次独立的起伏/弯折？"**

#### 方法：角向符号变化计数

```javascript
/**
 * 计算球面函数的全局角向起伏次数
 * 
 * 思想：在球面上生成规则角网格，沿 θ 和 φ 方向统计符号变化
 * 
 * @param {Float64Array} coeffs_full - 完整系数（到 L_max）
 * @param {object} shInstance - SphericalHarmonics 实例
 * @param {object} options
 *   - thetaSteps: θ方向采样数，默认 64
 *   - phiSteps: φ方向采样数，默认 128
 * @returns {number} S_total - 平均角向起伏次数
 */
function computeGlobalStructureCount(coeffs_full, shInstance, options = {}) {
    const thetaSteps = options.thetaSteps ?? 64;
    const phiSteps = options.phiSteps ?? 128;
    
    // 1. 在规则网格上计算函数值
    const grid = []; // grid[i][j] = r(θ_i, φ_j)
    for (let i = 0; i < thetaSteps; i++) {
        const theta = (i + 0.5) / thetaSteps * Math.PI; // 避免极点
        grid[i] = [];
        for (let j = 0; j < phiSteps; j++) {
            const phi = j / phiSteps * 2 * Math.PI;
            grid[i][j] = shInstance.evaluate(coeffs_full, theta, phi);
        }
    }
    
    // 2. 沿 φ 方向统计符号变化（固定 θ）
    let signChanges_phi = 0;
    for (let i = 0; i < thetaSteps; i++) {
        for (let j = 0; j < phiSteps; j++) {
            const curr = grid[i][j];
            const next = grid[i][(j + 1) % phiSteps]; // φ 周期性
            if (Math.sign(curr) !== 0 && Math.sign(next) !== 0) {
                if (Math.sign(curr) !== Math.sign(next)) {
                    signChanges_phi++;
                }
            }
        }
    }
    
    // 3. 沿 θ 方向统计符号变化（固定 φ）
    let signChanges_theta = 0;
    for (let j = 0; j < phiSteps; j++) {
        for (let i = 0; i < thetaSteps - 1; i++) {
            const curr = grid[i][j];
            const next = grid[i + 1][j];
            if (Math.sign(curr) !== 0 && Math.sign(next) !== 0) {
                if (Math.sign(curr) !== Math.sign(next)) {
                    signChanges_theta++;
                }
            }
        }
    }
    
    // 4. 归一化：平均每圈的符号变化次数
    const avgChanges_phi = signChanges_phi / thetaSteps;  // 每条 θ 线的平均
    const avgChanges_theta = signChanges_theta / phiSteps; // 每条 φ 线的平均
    
    // 5. 合并两个方向（取平均）
    const S_total = (avgChanges_phi + avgChanges_theta) / 2;
    
    return S_total;
}
```

#### 与多项式类比

| 多项式 | 球谐 |
|-------|------|
| 拟合一次 | 拟合到 L_max |
| 求导 | 角向差分 |
| 数拐点（导数=0） | 数符号变化（函数过零） |
| 拐点数 + 1 | **S_total → L_direct** |

---

### A.4 [核心] 结构计数 → 阶数映射

#### 经验规则

球谐阶数 $l$ 大约能表示 $\sim l$ 次角向振荡。

因此：

$$L_{direct} = \lceil S_{total} / c \rceil$$

其中 $c \approx 2 \sim 3$（经验系数，球面双方向平均）。

```javascript
const c = 2.5; // 经验系数
const L_direct = Math.ceil(S_total / c);
```

#### 边界保护

```javascript
L_direct = Math.max(1, Math.min(L_max, L_direct));
```

---

### A.5 [辅助] 能量/变化停阶（降级为约束）

**保留但降级**以下判据：

- 能量谱 E_l
- 归一化变化 Ṽ_l
- 非轴对称能量
- 阶间结构差异

它们的新角色是：**对 L_direct 的合理性约束**，而不是阶数来源。

```javascript
// 从能量判据得到的停阶点（作为参考）
let L_energy_stop = L_max;
let cumulativeEnergy = Math.max(energies[0], 1e-12);

for (let l = 1; l <= L_max; l++) {
    const R_E = energies[l] / cumulativeEnergy;
    if (R_E < threshold_energy) {
        // 连续两次低于阈值
        if (++consecutiveCount >= 2) {
            L_energy_stop = l - 2;
            break;
        }
    } else {
        consecutiveCount = 0;
    }
    cumulativeEnergy += energies[l];
}

// 从变化判据得到的停阶点
// (类似逻辑)
let L_variation_stop = ...;
```

---

### A.6 综合判定

```javascript
// 主判据：结构计数
const L_direct = Math.ceil(S_total / c);

// 辅助约束
const L_energy_stop = ...; // 能量停阶点
const L_variation_stop = ...; // 变化停阶点

// 结构区间
const L_min_struct = Math.min(L_direct, Math.min(L_energy_stop, L_variation_stop));
const L_max_struct = Math.max(L_direct, Math.max(L_energy_stop, L_variation_stop));

// 边界保护
L_min_struct = Math.max(1, L_min_struct);
L_max_struct = Math.min(L_max, L_max_struct);
```

---

## 四、阶段 B：稳定拟合（完全不变）

与 v2.4 完全相同：

1. 在 `[L_min_struct, L_max_struct]` 区间逐阶拟合
2. 主判据：条件数 < 阈值
3. 选择满足条件的最大阶数 → L_final

**一行都不改。**

---

## 五、输出

```javascript
{
    L_direct,      // 来自"全局结构计数"（主判据）
    L_energy_stop, // 能量停阶点（辅助）
    L_variation_stop, // 变化停阶点（辅助）
    structureRange: { min: L_min_struct, max: L_max_struct },
    bestOrder: L_final,
    S_total,       // 全局起伏次数（诊断用）
    diagnostics
}
```

---

## 六、预期效果

| 形状 | S_total | L_direct | 说明 |
|------|---------|----------|------|
| 完美球体 | ~0 | 1 | 几乎无角向振荡 |
| 椭球 | ~2 | 1~2 | 一次起伏 |
| 立方体 | ~8 | 3~4 | 多次棱角 |
| 十字星 | ~12 | 5~6 | 6 个分支 |
| 类圆柱 | ~4 | 2~3 | 两端起伏 |

---

## 七、与 v2.4 的对比

| 方面 | v2.4 | v3.0 |
|------|------|------|
| 计算顺序 | L=1 → L_max | **L_max 先行** |
| 主判据 | 能量比 < 阈值 | **结构计数 → L_direct** |
| 能量/变化 | 主判据 | 辅助约束 |
| 阶段 B | 不变 | 不变 |

---

## 八、待确认事项

1. 经验系数 `c = 2.5` 是否合适？
2. 网格分辨率 `64×128` 是否足够？
3. 是否需要在极点附近加权？

---

**评审确认后开始实施。**
