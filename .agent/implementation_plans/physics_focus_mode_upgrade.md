---
description: 升级优化方案：FOCUS态物理系统集成与模式切换
---

# 升级优化方案：FOCUS态物理系统集成

## 1. 背景与目标 (Context & Goal)
当前系统已具备物理类 (`PhysicsBridgeImpl`) 和几何类 (`GeometryImpl`) 的核心算法，且能进行控制点的球谐拟合。
**目标**：在 FOCUS 态下打通物理系统的全链路，使物体在用户点击交互下产生物理形变，并根据配置在“效果模式”和“性能模式”间切换，同时保证只影响视觉层（临时变量）而不污染固有数据（如控制点状态）。

## 2. 核心挑战与对策 (Challenges & Strategy)

| 挑战 | 现状 | 对策 |
| :--- | :--- | :--- |
| **拟合接口固化** | `fitSphericalHarmonics` 硬编码绑定 `this.controlPoints` | **扩展接口**：增加 `sourcePoints` 参数，允许传入物理建构点。 |
| **全量拟合确认** | 需确认是否存在 Householder QR 算法 | **已确认**：`FittingCalculator` 内置 `householderQR` 和 `solveFromQR`，完全支持一次性全量求解。 |
| **数据污染风险** | 拟合结果直接写入 `representation.data` | **临时变量隔离**：在 FOCUS 态使用独立的 `_tempCoefficients` 和 `_tempDisplayPoints`，渲染器优先读取临时数据。 |
| **循环性能压力** | 每帧全量拟合可能导致掉帧 | **双模式设计**：<br>1. **性能模式**：跳过拟合，直接渲染物理建构点（调试/低配）。<br>2. **效果模式**：每帧（或隔帧）一次性全量拟合 + 采样。 |
| **渲染源错位** | Renderer 总是渲染 `displayPoints` | **渲染路由**：在 Renderer 或 Object 内部根据 `SystemState.interactionState` 和物理状态动态切换渲染源。 |

## 3. 系统改造方案 (Architecture Upgrade)

### 3.1 数据流重建 (Data Flow)

#### 常规流程 (VIEW/EDIT)
`ControlPoints` -> `fitSphericalHarmonics` -> `Coefficients` -> `generateDisplayPoints` -> `DisplayPoints` -> `Renderer`

#### FOCUS 物理态流程 (Physics State)
1.  **输入**：用户点击/交互 -> 物理力作用于 `ConstructionPoints` (表面+内部)。
2.  **物理步**：`PhysicsBridgeImpl` 更新 `ConstructionPoints` 位置 (使用 PBD/Spring)。
3.  **分支处理**：
    *   **分支 A (性能模式)**：直接将 `ConstructionPoints` (仅表面) 作为 `_tempDisplayPoints`。
    *   **分支 B (效果模式)**：
        1.  `fitSphericalHarmonics(source: ConstructionPoints, useIncremental: false)` -> `_tempCoefficients`
        2.  `generateDisplayPoints(coeffs: _tempCoefficients)` -> `_tempDisplayPoints`
4.  **渲染**：Renderer 读取 `_tempDisplayPoints` 进行绘制。

### 3.2 模式定义

*   **Mode 1: Performance (性能模式)**
    *   **特点**：极速，直接看到物理模拟的离散点。
    *   **用途**：物理调试，低端设备运行。
    *   **实现**：`Renderer` 直接绘制物理粒子。

*   **Mode 2: Quality (效果模式)**
    *   **特点**：平滑，保持球谐流形特征，使用形状匹配。
    *   **用途**：最终展示。
    *   **实现**：物理粒子 -> 实时重拟合 -> 采样 -> 渲染。

## 4. 详细实施步骤 (Implementation Details)

### STEP 1: Object.js 接口扩展

改造 `fitSphericalHarmonics` 和 `generateDisplayPoints` 以支持临时数据和自定义源。

```javascript
// Object.js 伪代码示例

/**
 * 球谐拟合（增强版）
 * @param {object} options
 * @param {Array} [options.sourcePoints] - 自定义源点集（默认使用 controlPoints）
 * @param {boolean} [options.writeToTemp] - 是否写入临时系数而不更新固有状态
 * @returns {object} 拟合结果 { coefficients, ... }
 */
fitSphericalHarmonics(options = {}) {
    // 1. 确定源数据
    const points = options.sourcePoints || this.controlPoints;
    
    // ... (中间参数准备逻辑保持不变) ...
    // 注意：如果是 sourcePoints，需确保坐标系一致（通常物理建构点已经是局部或世界坐标，需注意转换）
    // 物理建构点如果是世界坐标，需转回局部坐标 (lx, ly, lz) 才能拟合。
    
    // 2. 拟合计算 (ParametricImpl.fitSpherical)
    const result = ParametricImpl.fitSpherical(..., useIncremental: options.useIncremental);
    
    // 3. 结果存储路由
    if (options.writeToTemp) {
        this._tempRepresentation = {
            coefficients: result.coefficients,
            // ...
        };
    } else {
        // 原有逻辑：更新 representation.data
    }
    return result;
}

/**
 * 生成显示点（增强版）
 * @param {object} options
 * @param {Array} [options.coefficients] - 自定义系数（默认使用 representation.data）
 * @param {boolean} [options.writeToTemp] - 是否写入临时显示点
 */
generateDisplayPoints(options = {}) {
    // 1. 确定系数源
    const coeffs = options.coefficients || this.representation.data.coefficients;
    
    // 2. 采样计算 (GeometryImpl.goldenSpiralSampling)
    const samples = GeometryImpl.goldenSpiralSampling(..., radiusCallback);
    
    // 3. 结果存储路由
    const newPoints = samples.map(p => new Point(...));
    if (options.writeToTemp) {
        this._tempDisplayPoints = newPoints;
    } else {
        this.displayPoints = newPoints;
    }
}
```

### STEP 2: FOCUS 态主循环集成 (main.js)

在 `gameLoop` 或 `processTaskQueue` 中集成物理更新逻辑。

```javascript
// main.js 伪代码

function physicsStep(dt) {
    if (SystemState.interactionState !== 'FOCUS') return;
    
    const obj = SystemState.focusedObject;
    if (!obj || !obj._isVolumetric) return; // 仅对已体素化的物体进行模拟
    
    // 1. 物理模拟步 (PBD / Spring)
    // 更新 obj.constructionPoints 位置
    PhysicsBridgeImpl.simulate(obj.constructionPoints, dt, ...);
    
    // 2. 渲染数据更新
    if (CONFIG.physicsMode === 'PERFORMANCE') {
        // [性能模式]
        // 直接引用表面建构点作为临时显示点
        // 需浅拷贝或映射，因为 displayPoints 需要是 Point 类型且带渲染属性
        obj._tempDisplayPoints = obj.constructionPoints
            .slice(0, obj._surfaceBoundary)
            .map(p => { p.tag = 'PHYSICS_NODE'; return p; }); 
            // 优化：最好不要每帧 map，而是直接复用对象，只更新位置
            
    } else {
        // [效果模式]
        // A. 形状匹配约束 (Shape Matching) - 可选，维持整体形态
        
        // B. 实时拟合 (One-Shot Fit)
        // 注意：需先将建构点转为局部坐标，因为 SH 是局部定义的
        const localPoints = obj.constructionPoints.map(p => toLocal(p));
        
        obj.fitSphericalHarmonics({
            sourcePoints: localPoints,
            order: 4, // 物理态可能使用较低阶数以保证性能
            useIncremental: false, // 必须全量
            writeToTemp: true
        });
        
        // C. 重新采样
        obj.generateDisplayPoints({
            coefficients: obj._tempRepresentation.coefficients,
            writeToTemp: true,
            density: 20 // 物理态可能降低采样密度
        });
    }
}
```

### STEP 3: Renderer 适配

确保 Renderer 能够优先读取临时显示点。

```javascript
// Renderer.js 或 Window.js (calculate)

// 获取渲染点集的逻辑：
const renderPoints = (obj._tempDisplayPoints && obj._tempDisplayPoints.length > 0) 
    ? obj._tempDisplayPoints 
    : (obj.displayPoints || obj.constructionPoints);
```

## 5. 物理与动画系统协同 (Physics & Animation)

经过调查，物理类与动画系统需谨慎配合：

### 5.1 冲突分析
- **控制权争夺**：动画系统（`processTaskQueue`）通常通过插值修改 `Object.position/rotation`。物理系统通过力学计算修改 `ConstructionPoints`（微观）甚至物体中心（宏观）。
- **时序问题**：`gameLoop` 中 `physicsStep` 与 `applyVelocities` / `processTaskQueue` 的执行顺序会影响最终位置。

### 5.2 协同策略
1.  **FOCUS 态主导权**：在 FOCUS 态，物理系统应拥有**微观形变**的主导权。
2.  **动画互斥**：当 `SystemState.taskQueues` 中存在针对当前 Focused Object 的动画任务（如“进入/退出 FOCUS”的过渡动画）时，**必须暂停物理模拟**。防止物理力与插值路径冲突。
3.  **Kinematic 模式**：如果用户拖拽物体（宏观移动），物理粒子应表现为被拖拽的弹性体（添加鼠标弹簧约束），而不是简单的被动画系统瞬移，否则会产生剧烈的惯性力。

### 5.3 建议实现
在 `physicsStep` 中增加检查：
```javascript
function physicsStep(dt) {
    // 1. 如果有动画正在运行，暂停物理
    if (SystemState.taskQueues.current.length > 0) return;
    
    // 2. 如果正在拖拽（InputManager），应用鼠标弹簧力
    if (SystemState.isDragging && SystemState.dragTarget === obj) {
        PhysicsBridgeImpl.applyMouseSpring(obj, ...);
    }
    
    // ... 正常物理步 ...
}
```

## 6. 验证计划 (Verification)

1.  **静态检查**：进入 FOCUS 态，确认物体是否正确转化为体积网格（ConstructionPoints 生成）。
2.  **性能模式**：开启 Performance 模式，拖拽/点击物体，观察建构点是否随物理规律运动。确认无明显掉帧。
3.  **效果模式**：开启 Quality 模式，观察物体表面是否平滑变形。检查拟合是否稳定（无高频抖动）。
4.  **退出检查**：退出 FOCUS 态，确认物体是否恢复到进入前的固有状态（控制点、原拟合系数），无数据残留。

---
**备注**：此文档仅为方案规划，暂不执行代码修改。
