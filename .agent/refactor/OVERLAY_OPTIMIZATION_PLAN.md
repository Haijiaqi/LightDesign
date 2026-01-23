# 覆盖层系统 (Overlay System) 性能优化方案 V6

---

## ⚠️ 第零章：系统级几何公理（不可违背）

> **本章定义的公理是所有几何参数的唯一合法来源。任何无法从本章直接推导的参数均为非法，必须删除。**

### 0.1 唯一几何定义

**所有编辑网格均定义为：三维整数格点 $\mathbb{Z}^3$ 与某一平面族的交集。**

$$
\text{EditGrid} = \mathbb{Z}^3 \cap \Pi_k
$$

其中 $\Pi_k$ 是由 `sliceIndex` $k$ 确定的平面。

### 0.2 spacingX / spacingY 的严格定义

> ⚠️ **spacingX / spacingY 不是屏幕像素间距，也不是投影结果。**

它们严格定义为：

**编辑平面自身 2D 参数坐标系中，相邻 $\mathbb{Z}^3$ 格点在该平面上的真实几何距离。**

所有 spacing 的来源只能是：
- $\mathbb{Z}^3$ 的整数步进向量在编辑平面内的长度
- 例如向量 $(0,1,1)$ 在平面内的长度为 $\sqrt{2} \times \text{baseSpacing}$

### 0.3 完全禁止的概念

以下概念 **严禁** 出现在任何几何或参数推导中：

| 禁止概念 | 说明 |
|:---|:---|
| 屏幕像素间距 | spacing 是平面内几何距离，非屏幕距离 |
| 投影 | 无投影变换，网格是真实 3D 交集 |
| 视角 | 观察角度不影响网格几何 |
| $\cos(45°)$, $\sin(45°)$ | 禁止用三角函数推导 spacing |
| 视觉压缩 / 透视 | 网格不因观察而变形 |
| $1/\sqrt{2}$ 作为 spacing 缩放 | 这是投影假设的产物，必须移除 |

### 0.4 $\mathbb{Z}^3$ 格点场定义

三维整数格点场：
$$
\text{Lattice} = \{ (x, y, z) \mid x, y, z \in \mathbb{Z} \} \times \text{baseSpacing}
$$

所有格点的世界坐标为 $(x \cdot s, y \cdot s, z \cdot s)$，其中 $s = \text{baseSpacing}$。

### 0.5 平面族定义

| 模式 | 平面族方程 | 法向量 | 是否正交于坐标轴 |
|:---|:---|:---|:---:|
| **FACE** | $x = k$, $y = k$, 或 $z = k$ | $(1,0,0)$, $(0,1,0)$, 或 $(0,0,1)$ | ✅ |
| **EDGE-H** | $y - z = k$ | $(0, 1, -1)$ | ❌ |
| **EDGE-V** | $x - z = k$ | $(1, 0, -1)$ | ❌ |

其中 $k \in \mathbb{Z}$ 即为 `sliceIndex`。

### 0.6 gridWidth / gridHeight 整数倍约束

> **gridWidth / gridHeight 必须是对应 spacing 的整数倍。**

| 模式 | gridWidth 约束 | gridHeight 约束 |
|:---|:---|:---|
| **FACE** | $n \times \text{baseSpacing}$, $n \in \mathbb{Z}$ | $m \times \text{baseSpacing}$, $m \in \mathbb{Z}$ |
| **EDGE-H** | $n \times \text{baseSpacing}$, $n \in \mathbb{Z}$ | $m \times \sqrt{2} \times \text{baseSpacing}$, $m \in \mathbb{Z}$ |
| **EDGE-V** | $n \times \sqrt{2} \times \text{baseSpacing}$, $n \in \mathbb{Z}$ | $m \times \text{baseSpacing}$, $m \in \mathbb{Z}$ |

这确保了网格边界始终落在整数格点上。

---

## 第一章：EDGE 网格参数真值（由 $\mathbb{Z}^3$ 唯一决定）

### 1.1 EDGE 平面内的基方向

EDGE 平面内存在两个正交基方向，由 $\mathbb{Z}^3$ 的整数解结构唯一决定：

| 基方向 | 几何含义 | 步进向量 | 步进长度（平面内距离） |
|:---|:---|:---|:---|
| **轴向** | 沿某一坐标轴 | $(1,0,0)$ 或 $(0,1,0)$ | $1 \times \text{baseSpacing}$ |
| **对角向** | 沿两轴对角线 | $(0,1,1)$ 或 $(1,0,1)$ | $\sqrt{2} \times \text{baseSpacing}$ |

### 1.2 EDGE-H 参数表 ($y - z = k$)

| 参数 | 数值 | 几何来源 |
|:---|:---|:---|
| `spacingX` | `baseSpacing` | $\mathbb{Z}^3$ 在 $x$ 方向的单位步进，平面内长度 = 1 |
| `spacingY` | `baseSpacing × √2` | $\mathbb{Z}^3$ 在 $(0,1,1)$ 方向的步进，平面内长度 = $\sqrt{2}$ |
| `layerSpacing` | `baseSpacing / √2` | 相邻平面 $y-z=k$ 与 $y-z=k+1$ 的法向距离 |
| `phaseX` | `0` | 轴向无偏移 |
| `phaseY` | `isOdd ? 0.5 : 0` | 奇数层对角向半格偏移 |

### 1.3 EDGE-V 参数表 ($x - z = k$)

| 参数 | 数值 | 几何来源 |
|:---|:---|:---|
| `spacingX` | `baseSpacing × √2` | $\mathbb{Z}^3$ 在 $(1,0,1)$ 方向的步进，平面内长度 = $\sqrt{2}$ |
| `spacingY` | `baseSpacing` | $\mathbb{Z}^3$ 在 $y$ 方向的单位步进，平面内长度 = 1 |
| `layerSpacing` | `baseSpacing / √2` | 相邻平面法向距离 |
| `phaseX` | `isOdd ? 0.5 : 0` | 奇数层对角向半格偏移 |
| `phaseY` | `0` | 轴向无偏移 |

### 1.4 奇偶层判定

```javascript
const isOdd = Math.abs(sliceIndex) % 2 === 1;
```

**奇数层效应（仅允许）**：
- 在对角方向产生 `phase = 0.5` 的平移

**奇数层禁止**：
- ❌ 改变 spacing
- ❌ 改变格点数量
- ❌ 改变拓扑结构

---

## 第二章：FACE 网格参数真值

### 2.1 FACE 参数表 (以 $z = k$ 为例)

| 参数 | 数值 | 几何来源 |
|:---|:---|:---|
| `spacingX` | `baseSpacing` | $\mathbb{Z}^3$ 在 $x$ 方向的单位步进，平面内长度 = 1 |
| `spacingY` | `baseSpacing` | $\mathbb{Z}^3$ 在 $y$ 方向的单位步进，平面内长度 = 1 |
| `layerSpacing` | `baseSpacing` | 相邻平面 $z=k$ 与 $z=k+1$ 的距离 |
| `phaseX` | `0` | 正交平面无偏移 |
| `phaseY` | `0` | 正交平面无偏移 |

---

## 第三章：一致性校验标准

### 3.1 模式内一致性（必须满足）

> 在同一编辑模式内部（FACE 内部或 EDGE 内部）：

| 允许变化 | 禁止变化 |
|:---|:---|
| `sliceIndex` 变化引入 phase 偏移 | 改变 spacing |
| 视口裁剪导致可见格点减少 | 改变格点数量（同等范围下） |
| | 改变拓扑结构 |

### 3.2 跨模式不要求一致

FACE 与 EDGE 属于不同平面族，其格点数量与分布：
- **不要求一致**
- **不应强制一致**

### 3.3 旋转不变性

| 操作 | 几何效果 | 禁止行为 |
|:---|:---|:---|
| Q/E 旋转 | 网格刚体旋转 | 任何缩放、压缩、spacing 改变 |
| 物体旋转 | 网格随编辑平面刚体旋转 | 任何缩放、压缩、spacing 改变 |

---

## 第四章：代码修复指令（✅ 已实施 2026-01-23）

### 4.1 EditConfig.js 现状（错误代码）

```javascript
// ❌ 当前错误实现
getGridSpacingScale(type, visualOrientation) {
    if (type !== 'EDGE') return { scaleX: 1.0, scaleY: 1.0 };
    if (visualOrientation === 'H') {
        return { scaleX: 1.0 / Math.SQRT2, scaleY: 1.0 };  // ❌ 非法：使用 1/√2
    }
    return { scaleX: 1.0, scaleY: 1.0 / Math.SQRT2 };      // ❌ 非法：使用 1/√2
}
```

### 4.2 错误根因

当前代码假设 spacing 是"屏幕投影压缩"的结果，使用 $1/\sqrt{2}$ 缩放。

**这违反了第零章公理**：
- spacing 是编辑平面内的真实几何距离
- 不是屏幕像素间距
- 不是投影结果

### 4.3 修正后代码（暂不实施）

```javascript
// ✅ 正确实现
getGridSpacingScale(type, visualOrientation) {
    if (type !== 'EDGE') {
        return { scaleX: 1.0, scaleY: 1.0 };
    }
    // EDGE-H: X轴沿棱(单位步进), Y轴沿对角(√2步进)
    if (visualOrientation === 'H') {
        return { scaleX: 1.0, scaleY: Math.SQRT2 };
    }
    // EDGE-V: X轴沿对角(√2步进), Y轴沿棱(单位步进)
    return { scaleX: Math.SQRT2, scaleY: 1.0 };
}
```

### 4.4 getGridDimensions 需同步修正（暂不实施）

需确保 gridWidth/gridHeight 为对应 spacing 的整数倍：

```javascript
// ✅ 正确实现
getGridDimensions(type, visualOrientation) {
    const base = this.size;
    const s = this.spacing; // baseSpacing
    
    if (type !== 'EDGE') {
        // FACE: 均为 baseSpacing 的整数倍
        const w = Math.floor(base / s) * s;
        const h = Math.floor(base / s) * s;
        return { width: w, height: h };
    }
    
    if (visualOrientation === 'H') {
        // EDGE-H: width = n × s, height = m × (√2 × s)
        const w = Math.floor(base / s) * s;
        const hSpacing = s * Math.SQRT2;
        const h = Math.floor((base * Math.SQRT2) / hSpacing) * hSpacing;
        return { width: w, height: h };
    }
    
    // EDGE-V: width = n × (√2 × s), height = m × s
    const wSpacing = s * Math.SQRT2;
    const w = Math.floor((base * Math.SQRT2) / wSpacing) * wSpacing;
    const h = Math.floor(base / s) * s;
    return { width: w, height: h };
}
```

---

## 第五章：缓存模式定义

### 5.1 五种静态缓存模式

| Index | Key | Spacing ($X \times Y$) | Phase ($X, Y$) |
|:---:|:---|:---|:---|
| 0 | `FACE` | $1.0 \times 1.0$ | $(0, 0)$ |
| 1 | `EDGE_H_EVEN` | $1.0 \times \sqrt{2}$ | $(0, 0)$ |
| 2 | `EDGE_H_ODD` | $1.0 \times \sqrt{2}$ | $(0, 0.5)$ |
| 3 | `EDGE_V_EVEN` | $\sqrt{2} \times 1.0$ | $(0, 0)$ |
| 4 | `EDGE_V_ODD` | $\sqrt{2} \times 1.0$ | $(0.5, 0)$ |

> Spacing 单位为 baseSpacing 的倍数。

### 5.2 缓存 Key 选择逻辑

```javascript
function getCacheKey(type, visualOrientation, sliceIndex) {
    if (type === 'FACE') return 'FACE';
    
    const isOdd = Math.abs(sliceIndex) % 2 === 1;
    
    if (visualOrientation === 'H') {
        return isOdd ? 'EDGE_H_ODD' : 'EDGE_H_EVEN';
    }
    return isOdd ? 'EDGE_V_ODD' : 'EDGE_V_EVEN';
}
```

---

## 第六章：性能优化实施

### 6.1 渲染约束

- **禁止** Canvas 2D Primitives (`moveTo`, `lineTo`, `arc`)
- **必须** 使用 `ImageData` 直接操作像素缓冲区

### 6.2 预计算阶段

1. 在 DPI 变化或初始化时，生成 5 种缓存模式的静态点云
2. 点云存储为 `Int16Array`（相对于网格中心的像素偏移）
3. 同时缓存 `intersections` 数组用于吸附

### 6.3 每帧渲染

1. 根据 `(type, visualOrientation, sliceIndex)` 选择缓存 Key
2. 计算刚体变换参数：`(cx, cy, rotation)`
3. 遍历缓存点云，应用 2D 仿射变换，写入 `ImageData`

### 6.4 吸附逻辑

- `OverlaySystem.getEditGridIntersections()` 返回变换后的交点列表
- 吸附点与渲染点空间绝对重合

---

## 第七章：验证清单

- [ ] EDGE-H 态网格 spacingY / spacingX = $\sqrt{2}$
- [ ] EDGE-V 态网格 spacingX / spacingY = $\sqrt{2}$
- [ ] 切换 `sliceIndex` 时，奇数层产生半格 Phase 偏移，spacing 不变
- [ ] Q/E 旋转后，网格仅刚体旋转，无变形，spacing 不变
- [ ] 同一模式内，格点数量随 `sliceIndex` 保持稳定
- [ ] gridWidth / gridHeight 均为对应 spacing 的整数倍

