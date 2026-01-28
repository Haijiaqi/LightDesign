# 渲染系统技术分析

## 1. 系统概述

当前渲染系统分为多个层次，从数据准备到最终像素渲染，涉及多个模块协作。

```
┌─────────────────────────────────────────────────────────────────────┐
│                         数据层 (Data Layer)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Object.displayPoints     控制点 constructionPoints 等               │
│  LocalGrid points         局部格网点                                 │
│  OverlaySystem points     屏幕辅助点 (Virtual Mouse 等)              │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       属性设置层 (Property Layer)                    │
├─────────────────────────────────────────────────────────────────────┤
│  main.js::updateLocalGrid()                                         │
│    - 设置 isVisible, isAttractable, light, isPlaneNear             │
│  main.js::showControlPoints() / hideControlPoints()                 │
│    - 设置 tag='CONTROL' / tag=null                                  │
│  ObjectFactoryImpl::createLocalGrid()                               │
│    - 初始化 tag='LOCAL_GRID'/'LOCAL_GRID_EDGE'/'LOCAL_GRID_DASH'    │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       投影计算层 (Projection Layer)                  │
├─────────────────────────────────────────────────────────────────────┤
│  Window.calculate()                                                 │
│    - 过滤 isVisible === false 的点                                   │
│    - 计算屏幕坐标 (xM, yM, xL, xR, yL, yR)                            │
│    - 应用光照衰减 (light *= attenuation)                             │
│    - 将点放入 grid[][] 供渲染                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       样式解析层 (Style Layer)                       │
├─────────────────────────────────────────────────────────────────────┤
│  StyleImpl.resolvePointStyle({ tag, light, displayMode, hasDisparity })
│    - 根据 tag 查找 TAGS 配置                                         │
│    - 计算 effectiveLight (固定亮度 vs 动态光照)                       │
│    - 计算 neighborRadius (glow 半径)                                 │
│    - 返回渲染参数 { colorType, base, maxIndex, neighborRadius, ... }│
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       渲染层 (Render Layer)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Renderer.render()                                                  │
│    - 遍历 Window.grid[][] 中的点                                     │
│    - 跳过 light <= 0 的点                                            │
│    - 调用 StyleImpl.resolvePointStyle() 获取样式                     │
│    - 调用 drawColoredPointImpl() 绘制像素                            │
│  Renderer.renderScreenPixel()                                       │
│    - 简单单像素渲染 (用于 Overlay 点)                                 │
│  OverlaySystem.renderAllToBuffer()                                  │
│    - 渲染格网虚线等 Buffer 直写内容                                   │
│  main.js::renderOverlayPoints()                                     │
│    - 渲染 OverlaySystem 生成的对象点                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 点属性体系

### 2.1 核心属性

| 属性 | 类型 | 来源 | 作用 |
|------|------|------|------|
| `tag` | string | 创建时/动态设置 | 决定渲染样式 (见 StyleImpl.TAGS) |
| `light` | number (0-1+) | 创建时/动态计算 | 亮度强度 |
| `isVisible` | boolean | updateLocalGrid() | 业务可见性 (切片显示) |
| `isAttractable` | boolean | updateLocalGrid() | 是否可被虚拟鼠标吸附 |
| `isPlaneNear` | boolean | updateLocalGrid() | 是否在屏幕平面附近 (预留) |

### 2.2 TAG 体系 (StyleImpl.TAGS)

| TAG | colorMode | lightAffected | neighborRadius | 用途 |
|-----|-----------|---------------|----------------|------|
| `SURFACE` | stereo | true | 1 | 普通物体表面点 |
| `DIMMED` | stereo | false (0.05) | 0 | (已弃用，改用 Object.isVisible) |
| `CONTROL` | stereo | true | 5 | 控制点（受光照影响） |
| `LOCAL_GRID` | stereo | true | 3 | 局部格网主格点 |
| `LOCAL_GRID_DASH` | stereo | true | 0 | 局部格网虚线点 |
| `LOCAL_GRID_EDGE` | stereo | true | 3 | 局部格网棱点 (始终可见) |
| `LIGHT_SOURCE` | stereo | false (3.0) | 5 | 光源 |
| `GRID_LINE` | mono (purple) | false (0.5) | 0 | 网格线 |
| `PLANE_NEAR` | mono (purple) | false (0.95) | 3 | 屏幕平面近点 (预留) |

---

## 3. 显隐控制逻辑

### 3.1 isVisible 属性 (业务可见性)

**设置位置**: `main.js::updateLocalGrid()`

```javascript
// 局部格网点
if (p.tag === 'LOCAL_GRID') {
    p.isVisible = (absDist <= DISPLAY_THRESHOLD);
}

// 控制点
cp.isVisible = (absDist <= DISPLAY_THRESHOLD);
```

**过滤位置**: `Window.js::calculate()`

```javascript
if (point.isVisible === false) continue;  // 投影前过滤
```

### 3.2 light 属性 (亮度/渲染可见性)

**设置位置**: 多处
- `ObjectFactoryImpl`: 初始化 light 值
- `updateLocalGrid()`: 设置 light=0.8/0.4 等
- `Window.calculate()`: 应用光照衰减

**过滤位置**: `Renderer.js::render()`

```javascript
if (p.light <= 0) continue;  // 渲染前过滤
```

---

## 4. 问题分析：耦合度与分散性

### 4.1 当前问题

#### A. 显隐逻辑分散在多处
- `isVisible` 设置: `updateLocalGrid()`, `showControlPoints()`, `hideControlPoints()`
- `light` 设置: `ObjectFactoryImpl`, `updateLocalGrid()`, `Window.calculate()`
- 过滤: `Window.calculate()` (isVisible), `Renderer.render()` (light)

#### B. TAG 设置分散
- `main.js`: `'CONTROL'`, `null`
- `ObjectFactoryImpl`: `'LOCAL_GRID'`, `'LOCAL_GRID_EDGE'`, `'LOCAL_GRID_DASH'`
- `SystemState`: `'DIMMED'`

#### C. 渲染入口分散
- `Renderer.render()`: 主渲染管线
- `main.js::renderOverlayPoints()`: Overlay 点渲染
- `main.js::renderVirtualMouse()`: 虚拟鼠标渲染
- `OverlaySystem._renderToBufferFn()`: Buffer 直写

#### D. 冗余/历史遗留
- `SLICE_CONTOUR`: 已移除但代码中仍有残留过滤
- `PLANE_NEAR`: 已定义但未使用
- `renderScreenPointsHelper()`: 几乎空函数

### 4.2 耦合度分析

| 模块 | 依赖 | 被依赖 | 耦合评估 |
|------|------|--------|----------|
| main.js | Window, Renderer, StyleImpl, OverlaySystem | - | 高 (中心枢纽) |
| Renderer.js | StyleImpl, OverlaySystem, SystemState | main.js | 中 |
| StyleImpl.js | - | Renderer | 低 (纯配置) |
| Window.js | - | Renderer, main.js | 中 |
| OverlaySystem.js | EditConfig, CONFIG | Renderer, main.js | 中 |

---

## 5. 优化建议

### 5.1 短期优化
1. **清理历史遗留代码**: 移除 `SLICE_CONTOUR` 相关过滤、清理空函数
2. **统一渲染入口**: 合并 `renderOverlayPoints` 和 `renderVirtualMouse` 到 Renderer
3. **移除未使用的 TAG**: `PLANE_NEAR` (或标记为 reserved)

### 5.2 中期重构
1. **创建 PointVisibilityManager**: 集中管理所有 isVisible/isAttractable/light 设置
2. **统一 TAG 生命周期**: 所有 tag 设置集中到一个 TagManager
3. **渲染管线标准化**: 定义 RenderPass 概念，统一处理流程

### 5.3 架构目标
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│PointManager    │────▶│ StyleResolver   │────▶│ Renderer        │
│ (visibility)   │     │ (tag → style)   │     │ (pixel output)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 6. 附录：代码位置索引

| 功能 | 文件 | 函数/行号 |
|------|------|-----------|
| isVisible 设置 | main.js | updateLocalGrid() |
| isVisible 过滤 | Window.js | calculate() L150, L214 |
| light 过滤 | Renderer.js | render() L161 |
| TAG 配置 | StyleImpl.js | TAGS (L127-195) |
| 样式解析 | StyleImpl.js | resolvePointStyle() |
| 主渲染 | Renderer.js | render() |
| Overlay 渲染 | main.js | renderOverlayPoints() |
