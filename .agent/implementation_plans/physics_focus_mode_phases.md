---
description: FOCUS态物理系统集成 - 分阶段执行方案
---

# FOCUS态物理系统集成 - 分阶段执行方案

## 前置审核结论

### 方案与代码一致性检查

| 检查项 | 方案假设 | 代码实际 | 状态 |
|--------|----------|----------|------|
| 阶数存储路径 | `obj.representation.data.order` | `obj.representation.data.fittedOrder` | ❌ **需修正** |
| 临时显示点 | `obj._tempDisplayPoints` | 代码中不存在此属性 | ⚠️ **需新增** |
| 物理状态 | `obj.physicsState` | 代码中不存在此属性 | ⚠️ **需新增** |
| 建构点 | `obj.constructionPoints` | ✅ 已存在 (L116) | ✅ |
| 表面边界 | `obj._surfaceBoundary` | ✅ 已存在 (L117) | ✅ |
| 体积化标记 | `obj._isVolumetric` | ✅ 已存在 (L121) | ✅ |
| `physicsStep` 函数 | 在 main.js 中调用 | 代码中不存在 | ⚠️ **需新增** |
| `fitSphericalHarmonics` 接口 | 需支持 `sourcePoints`, `writeToTemp` | 当前不支持 | ⚠️ **需扩展** |
| `generateDisplayPoints` 接口 | 需支持 `coefficients`, `inPlace`, `writeToTemp` | 当前不支持 | ⚠️ **需扩展** |

### 需在方案中修正的错误

1. **阶数路径**：`obj.representation.data.order` → `obj.representation.data.fittedOrder`
2. **坐标访问**：物理建构点应使用 `p.position` (如果是 Particle) 或 `{x: p.lx, y: p.ly, z: p.lz}` (如果是 Point)

---

## 约束声明 (Constraints)

### 必须遵守
1. **临时数据绝不污染固有数据**：任何 `_temp*` 属性的写入都必须有对应有清理路径。
2. **Renderer 行为可预测、可回退**：渲染路由的改动必须有开关，可在运行时禁用。
3. **物理/几何/动画职责清晰**：
   - **物理**：仅修改 `constructionPoints` 或 `_temp*` 中的粒子位置。
   - **几何**：仅在明确调用时执行拟合/采样。
   - **动画**：仅修改 `Object.transform` 或协调过渡效果。
4. **无新系统引入**：不引入 ECS、全新调度器等。
5. **无"顺便优化"**：每个阶段仅完成声明的目标。

---

## Phase 0: 数据层准备 (Data Layer Preparation)

**目标**：在 `Object.js` 中声明并初始化所有物理/临时相关的属性，不改变任何现有行为。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `Object.js` 构造函数 | `Object.js` 任何方法体 | 声明 `_tempDisplayPoints`, `_tempRepresentation`, `_physicsEnabled`, `_cachedLocalPositions` 属性 | 1. 所有现有测试通过<br>2. 新属性初始化为 `null`<br>3. Console 无报错 |
| | `main.js` | | |
| | `Window.js` | | |
| | `PhysicsBridgeImpl.js` | | |
| | `PhysicsSystem.js` | | |

### 具体变更
```javascript
// Object.js 构造函数末尾新增
this._tempDisplayPoints = null;
this._tempRepresentation = null;
this._physicsEnabled = false;
this._cachedLocalPositions = null;
this._tempDisplayPointsInitialized = false;
```

---

## Phase 1: 接口扩展 - fitSphericalHarmonics (Interface Extension)

**目标**：扩展 `fitSphericalHarmonics` 支持 `sourcePoints` 和 `writeToTemp` 参数，保持原有默认行为不变。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `Object.js:fitSphericalHarmonics` | `main.js` | 新增 `options.sourcePoints`、`options.writeToTemp` 参数 | 1. 无参调用行为不变<br>2. `writeToTemp: true` 时数据写入 `_tempRepresentation`<br>3. `representation.data` 未被修改 |
| | `Window.js` | | |
| | 拟合核心逻辑 (`ParametricImpl`) | | |

### 接口签名变更
```javascript
fitSphericalHarmonics(options = {}) {
    // 新增参数
    const sourcePoints = options.sourcePoints; // Array<{x,y,z}> | undefined
    const writeToTemp = options.writeToTemp ?? false;
    
    // 确定源数据
    const points = sourcePoints 
        ? sourcePoints 
        : this.controlPoints.map(p => ({ x: p.lx, y: p.ly, z: p.lz }));
    
    // ... 拟合逻辑不变 ...
    
    // 结果路由
    if (writeToTemp) {
        this._tempRepresentation = {
            coefficients: result.coefficients,
            sphericalHarmonics: sphericalHarmonics,
            fittedOrder: targetOrder
        };
        // 不更新 this.representation
    } else {
        // 原有逻辑
        this.representation.data = { ... };
    }
}
```

### 验收测试
1. 调用 `obj.fitSphericalHarmonics()` → 行为与修改前完全一致。
2. 调用 `obj.fitSphericalHarmonics({ writeToTemp: true })` → `_tempRepresentation` 有值，`representation.data` 未变。

---

## Phase 2: 接口扩展 - generateDisplayPoints (Interface Extension)

**目标**：扩展 `generateDisplayPoints` 支持 `coefficients`、`writeToTemp`、`inPlace` 参数。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `Object.js:generateDisplayPoints` | `main.js` | 新增参数，保持默认行为 | 1. 无参调用行为不变<br>2. `writeToTemp: true` 时写入 `_tempDisplayPoints`<br>3. `inPlace: true` 时复用现有数组 |
| 新增 `Object.js:_updateDisplayPointsInPlace` | `Window.js` | 原地更新辅助方法 | |

### 接口签名变更
```javascript
generateDisplayPoints(options = {}) {
    const coefficients = options.coefficients;
    const writeToTemp = options.writeToTemp ?? false;
    const inPlace = options.inPlace ?? false;
    
    const coeffs = coefficients || this.representation.data.coefficients;
    const sh = this.representation.data.sphericalHarmonics;
    
    const targetArray = writeToTemp ? this._tempDisplayPoints : this.displayPoints;
    
    if (inPlace && targetArray && targetArray.length > 0) {
        this._updateDisplayPointsInPlace(targetArray, coeffs, sh);
        return { count: targetArray.length, displayPoints: targetArray };
    }
    
    // ... 原有采样逻辑 ...
    
    if (writeToTemp) {
        this._tempDisplayPoints = newPoints;
    } else {
        this.displayPoints = newPoints;
    }
}
```

### 验收测试
1. 调用 `obj.generateDisplayPoints()` → 行为与修改前完全一致。
2. 调用 `obj.generateDisplayPoints({ writeToTemp: true })` → `_tempDisplayPoints` 有值。
3. 连续调用 `inPlace: true` → 无新 Point 对象创建（通过 Memory Snapshot 验证）。

---

## Phase 3: 渲染路由 (Renderer Routing)

**目标**：让 `Window.js` 在计算时优先读取 `_tempDisplayPoints`（如存在），否则回落到 `displayPoints`。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `Window.js:calculate` 中读取点的逻辑 | `main.js` | 渲染源动态切换 | 1. `_tempDisplayPoints = null` 时渲染 `displayPoints`<br>2. `_tempDisplayPoints` 有值时渲染临时点<br>3. 可通过 `CONFIG.usePhysicsRendering = false` 禁用 |
| `manage/Config.js` | 拟合/物理逻辑 | 新增配置开关 | |

### 变更点
```javascript
// Window.js calculate 方法中，原来遍历 obj.displayPoints 的位置
const renderPoints = (CONFIG.usePhysicsRendering && obj._tempDisplayPoints?.length > 0)
    ? obj._tempDisplayPoints
    : (obj.displayPoints || []);
```

### 验收测试
1. 设置 `CONFIG.usePhysicsRendering = false` → 始终渲染 `displayPoints`。
2. 手动设置 `obj._tempDisplayPoints = [...]` → 渲染临时点。

---

## Phase 4: 物理主循环桩 (Physics Step Stub)

**目标**：在 `main.js` 的 `gameLoop` 中加入 `physicsStep` 占位函数，但内部逻辑为空（或仅打印日志）。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:gameLoop` | `Object.js` | 在正确时机调用 `physicsStep(dt)` | 1. Console 可见调用日志<br>2. 帧率无下降<br>3. 渲染结果无变化 |
| 新增 `main.js:physicsStep` | `Window.js` | | |
| | `PhysicsSystem.js` (暂不调用) | | |

### 变更点
```javascript
// main.js

function physicsStep(dt) {
    if (SystemState.interactionState !== 'FOCUS' && SystemState.interactionState !== 'EDIT') {
        return;
    }
    
    const obj = SystemState.focusedObject;
    if (!obj) return;
    
    // 阶段4：仅日志，无实际物理
    if (CONFIG.physicsDebug) {
        console.log('[physicsStep] dt=', dt.toFixed(4), 'obj=', obj.id);
    }
}

// gameLoop 中调用（在 processTaskQueue 之后，render 之前）
physicsStep(dt);
```

### 验收测试
1. 进入 FOCUS 态，Console 显示 `[physicsStep]` 日志。
2. 帧率与修改前相同。

---

## Phase 5: 性能模式物理渲染 (Performance Mode)

**目标**：在 `physicsStep` 中实现"性能模式"：直接将表面 `constructionPoints` 映射为 `_tempDisplayPoints`。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:physicsStep` | `Object.js` 现有方法 | 性能模式下点映射 | 1. FOCUS 态可见物体显示为建构点<br>2. 帧率稳定 ≥55 FPS<br>3. 退出 FOCUS 后恢复原渲染 |
| `Object.js` (仅 `_tempDisplayPoints` 赋值) | 拟合逻辑 | | |
| `manage/Config.js` | `Window.js` | | |

### 变更点
```javascript
// main.js physicsStep

if (CONFIG.physicsMode === 'PERFORMANCE') {
    if (!obj._tempDisplayPointsInitialized) {
        // 创建引用（不是拷贝）
        // 注意：这里只是数组容器拷贝，点对象仍归 constructionPoints 所有
        // 渲染器不得修改除 tag 之外的属性
        obj._tempDisplayPoints = obj.constructionPoints.slice(0, obj._surfaceBoundary);
        for (const p of obj._tempDisplayPoints) {
            p.tag = p.tag || 'PHYSICS_NODE';
        }
        obj._tempDisplayPointsInitialized = true;
    }
    // 位置已由 constructionPoints 持有，无需额外操作
}
```

### Invariant – Phase 5
`_tempDisplayPoints` 在 PERFORMANCE 模式下：
1. 只是 `constructionPoints` 的“渲染视图”（引用相同点对象）。
2. **不拥有**点对象的生命周期。
3. **禁止**写入除 `tag` 之外的任何字段（尤其是位置/法向，应由 PhysicSystem 拥有）。

### 验收测试
1. 设置 `CONFIG.physicsMode = 'PERFORMANCE'`，进入 FOCUS 态。
2. 物体显示为表面建构点（可能比 displayPoints 稀疏）。
3. 退出 FOCUS 后恢复正常渲染。

---

## Phase 6: 效果模式每帧拟合 (Quality Mode)

**目标**：实现"效果模式"：每帧进行拟合和采样更新。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:physicsStep` | `PhysicsSystem.js` (此阶段不启动物理引擎) | 效果模式下的拟合与采样 | 1. 每帧拟合（通过日志验证）<br>2. 渲染平滑<br>3. 固有数据未变 |
| `Object.js` (调用新接口) | | | |

### Phase 6 约束补充
1. **禁止**任何自动定阶 / 阶数调整逻辑。
2. `order` 必须等于进入 FOCUS 态时的固有阶数快照。
3. 任何基于点数、能量、误差的阶数推断均不允许在本阶段出现。

### 关键逻辑
```javascript
// main.js physicsStep（效果模式分支）

if (CONFIG.physicsMode === 'QUALITY') {
    if (SystemState.frameCount % 2 === 0) {
        // ... (坐标转换逻辑不变) ...
        obj._cachedLocalPositions = localPoints;
        
        // 拟合（严格使用固有阶数，禁止自动降级/升级）
        const lockedOrder = obj.representation.data.fittedOrder || 4;
        obj.fitSphericalHarmonics({
            sourcePoints: localPoints,
            order: lockedOrder,
            useIncremental: false,
            writeToTemp: true,
            // 需传入依赖
            fitter: FitterClass,
            Matrix: Matrix,
            sphericalHarmonics: obj.representation.data.sphericalHarmonics
        });
        
        // ... (采样逻辑不变) ...
    }
}
```

### 验收测试
1. 设置 `CONFIG.physicsMode = 'QUALITY'`，进入 FOCUS 态。
2. Console 日志显示每帧拟合。
3. `obj.representation.data.coefficients` 未被修改。

---

## Phase 7: 法向量与光照更新 (Normal & Lighting)

**目标**：在 `physicsStep` 结束后、渲染前，强制更新法向量并触发光照重算。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:physicsStep` | `PhysicsBridgeImpl` 核心逻辑 | 法向量更新 + `lightDirty` 标记 | 1. 物体表面光照正确<br>2. 高光随形变更新 |
| `PhysicsBridgeImpl.computeNormals` | | | |

### 法向量更新规则
* **PERFORMANCE 模式**：法向量仅用于调试或展示粗略光照，允许不精确（甚至可以为零）。使用 `constructionPoints` 拓扑。
* **QUALITY 模式**：必须基于规则球谐采样拓扑（`_tempDisplayPoints` 语义），保证高光正确。

### 变更点
```javascript
// main.js physicsStep 末尾

// 明确法向量数据源
const normalSource = (CONFIG.physicsMode === 'QUALITY' && obj._tempDisplayPoints)
    ? obj._tempDisplayPoints
    : obj.constructionPoints;

// 更新法向量
// 注意：PhysicsBridgeImpl.computeNormals 需能够根据传入点的类型（Grid vs Mesh）选择正确的拓扑计算方式
// Phase 7 必须处理这里的拓扑差异风险
PhysicsBridgeImpl.computeNormals(
    normalSource,
    obj._surfaceTriangles, // 对于 QUALITY 模式，这里可能需要球谐采样的拓扑而非建构点拓扑
    obj._surfaceBoundary // 仅对 constructionPoints 有效
);
// [注：若 QUALITY 模式下 _tempDisplayPoints 是规则网格，computeNormals 可能需适配或使用 SH 自带法向量]

// 触发反射更新
SystemState.lightDirty = true;
```

### 验收测试
1. 物体在物理态下表面光照正常。
2. 旋转物体，高光位置正确变化。

---

## Phase 8: 退出过渡动画 (Exit Transition)

**目标**：实现退出 FOCUS/EDIT 态时的平滑过渡，避免视觉瞬变。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:exitFocusState` 或 `SystemState.exitFocus` | 动画系统核心 | 平滑混合动画 | 1. 退出时物体平滑回到原位<br>2. 无视觉跳变 |
| `manage/AnimationImpl.js` (调用) | | | |

### 验收测试
1. 进入 FOCUS 态，使物体发生形变（Phase 5/6 模拟）。
2. 退出 FOCUS 态，观察物体平滑恢复到进入前的形态。
3. `obj._tempDisplayPoints` 在动画结束后为 `null`。

---

## Phase 9: 物理引擎激活 (Physics Engine Activation)

**目标**：在 `physicsStep` 中激活真正的物理模拟（`PhysicsSystem.step`）。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `main.js:physicsStep` | 拟合逻辑 | 调用物理引擎 | 1. 物体受重力下落（测试用）<br>2. 碰撞/约束正常 |
| `PhysicsSystem.js` (调用) | | | |
| `PhysicsBridgeImpl.js` (调用) | | | |

### 验收测试
1. 进入 FOCUS 态，物体自然下落（如果启用重力）。
2. 禁用重力后物体静止。
3. 帧率稳定。

---

## Phase 10: EDIT 态弹性编辑 (Elastic Editing)

**Phase 10 非目标（Out of Scope）**
*   不实现真实材料模型（Neo-Hookean / FEM）。
*   不引入新的物理状态变量。
*   不改变 Phase 9 中 PhysicsSystem 的积分方式。
*   EDIT 态仅是“受限粒子 + 弹性恢复”的交互外壳。

**目标**：实现拖拽控制点时的弹性响应。

| 允许修改 | 禁止修改 | 目标 | 验收条件 |
|----------|----------|------|----------|
| `manage/InputManager.js` (拖拽逻辑) | 物理核心 | 粒子锁定/解锁 | 1. 拖拽时有弹性跟随效果<br>2. 松手后物体回弹 |
| `main.js` (协调) | | | |

### 验收测试
1. 进入 EDIT 态，拖拽控制点。
2. 观察物体整体弹性跟随。
3. 松手后物体弹性恢复。

---

## 阶段依赖图

```
Phase 0: 数据层准备
    |
    +-- Phase 1: fitSphericalHarmonics 扩展
    |       |
    |       +-- Phase 2: generateDisplayPoints 扩展
    |               |
    |               +-- Phase 6: 效果模式每帧拟合
    |
    +-- Phase 3: 渲染路由
            |
            +-- Phase 4: 物理主循环桩
                    |
                    +-- Phase 5: 性能模式物理渲染
                    |       |
                    |       +-- Phase 7: 法向量与光照更新
                    |
                    +-- Phase 8: 退出过渡动画
                            |
                            +-- Phase 9: 物理引擎激活
                                    |
                                    +-- Phase 10: EDIT 态弹性编辑
```

---

## 风险控制

### 回滚策略
每个 Phase 完成后创建 Git Tag：`physics-phase-N`。如果后续阶段出现问题，可快速回滚。

### 功能开关
| 开关 | 位置 | 作用 |
|------|------|------|
| `CONFIG.usePhysicsRendering` | `Config.js` | 禁用后回落到原渲染路径 |
| `CONFIG.physicsMode` | `Config.js` | `'OFF'` / `'PERFORMANCE'` / `'QUALITY'` |
| `CONFIG.physicsDebug` | `Config.js` | 打印调试日志 |

---

**备注**：此文档仅为分阶段执行规划，暂不执行代码修改。
