---
description: 升级优化方案：FOCUS态物理系统集成与模式切换
---

# 升级优化方案：FOCUS态物理系统集成

## 1. 背景与目标 (Context & Goal)

当前系统已具备物理类 (`PhysicsBridgeImpl`) 和几何类 (`GeometryImpl`) 的核心算法，且能进行控制点的球谐拟合。

**目标**：
1. 在 FOCUS/EDIT 态下打通物理系统的全链路，使物体在用户点击交互下产生物理形变。
2. 根据配置在"效果模式"和"性能模式"间切换。
3. 保证只影响视觉层（临时变量）而不污染固有数据（如控制点状态）。
4. 实现 EDIT 态弹性编辑功能，拖拽控制点时产生"果冻般"的弹性效果。

---

## 2. 核心挑战与对策 (Challenges & Strategy)

| 挑战 | 现状 | 对策 |
| :--- | :--- | :--- |
| **拟合接口固化** | `fitSphericalHarmonics` 硬编码绑定 `this.controlPoints` | **扩展接口**：增加 `sourcePoints` 参数，允许传入物理建构点。 |
| **全量拟合确认** | 需确认是否存在 Householder QR 算法 | **已确认**：`FittingCalculator` 内置 `householderQR` 和 `solveFromQR`，完全支持一次性全量求解。 |
| **数据污染风险** | 拟合结果直接写入 `representation.data` | **临时变量隔离**：在 FOCUS 态使用独立的 `_tempCoefficients` 和 `_tempDisplayPoints`，渲染器优先读取临时数据。 |
| **循环性能压力** | 每帧全量拟合可能导致掉帧 | **双模式设计**：<br>1. **性能模式**：跳过拟合，直接渲染物理建构点。<br>2. **效果模式**：隔帧全量拟合 + 原地更新采样。 |
| **渲染源错位** | Renderer 总是渲染 `displayPoints` | **渲染路由**：在 Renderer 或 Object 内部根据 `SystemState.interactionState` 和物理状态动态切换渲染源。 |
| **GC 压力** | `generateDisplayPoints` 每次创建新数组和对象 | **对象池/原地更新**：复用 `_tempDisplayPoints` 数组，仅更新坐标，禁止在主循环中 `new` 对象。 |
| **瞬变风险** | 物理态退出时直接切换数据会产生视觉跳变 | **混合动画**：退出时使用 300ms 插值动画平滑过渡到固有态。 |

---

## 3. 系统改造方案 (Architecture Upgrade)

### 3.1 数据流重建 (Data Flow)

#### 常规流程 (VIEW/EDIT 静态)
```
ControlPoints -> fitSphericalHarmonics -> Coefficients -> generateDisplayPoints -> DisplayPoints -> Renderer
```

#### FOCUS/EDIT 物理态流程 (Physics State)
```
用户交互 -> 物理力作用于 ConstructionPoints
    |
    v
PhysicsSystem.step() -> 更新粒子位置
    |
    +-- [性能模式] -> 表面粒子直接映射为 _tempDisplayPoints
    |
    +-- [效果模式] -> 坐标转换 -> 隔帧拟合 -> _tempCoefficients
                                              |
                                              v
                                    原地更新采样 -> _tempDisplayPoints
                                              |
                                              v
                                          Renderer
```

### 3.2 模式定义

| 配置项 | 值 | 特点 | 用途 |
|--------|-----|------|------|
| `CONFIG.physicsMode` | `'PERFORMANCE'` | 极速，直接渲染物理粒子 | 物理调试，低端设备 |
| `CONFIG.physicsMode` | `'QUALITY'` | 平滑，保持球谐流形特征 | 最终展示 |
| `CONFIG.shapeMatchingScope` | `'INTERNAL_ONLY'` | 仅内部粒子参与形状匹配 | 柔软表面，刚硬骨架 |
| `CONFIG.shapeMatchingScope` | `'ALL'` | 所有粒子参与形状匹配 | 实心橡胶效果 |

---

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
    
    // 坐标系转换：如果是世界坐标的物理建构点，需转回局部坐标
    const localPositions = points.map(p => worldToLocal(this, p));
    
    // 2. 拟合计算 (ParametricImpl.fitSpherical)
    const result = ParametricImpl.fitSpherical(...);
    
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
 * 生成显示点（增强版，支持原地更新）
 * @param {object} options
 * @param {Array} [options.coefficients] - 自定义系数（默认使用 representation.data）
 * @param {boolean} [options.writeToTemp] - 是否写入临时显示点
 * @param {boolean} [options.inPlace] - 是否原地更新现有点（性能优化）
 */
generateDisplayPoints(options = {}) {
    const coeffs = options.coefficients || this.representation.data.coefficients;
    const targetArray = options.writeToTemp ? this._tempDisplayPoints : this.displayPoints;
    
    // [性能优化] 原地更新模式
    if (options.inPlace && targetArray && targetArray.length > 0) {
        // 直接更新现有 Point 对象的坐标，不创建新对象
        this._updateDisplayPointsInPlace(targetArray, coeffs);
        return { count: targetArray.length, displayPoints: targetArray };
    }
    
    // 首次创建或强制重建
    const samples = GeometryImpl.goldenSpiralSampling(..., radiusCallback);
    const newPoints = samples.map(p => new Point(...));
    
    if (options.writeToTemp) {
        this._tempDisplayPoints = newPoints;
    } else {
        this.displayPoints = newPoints;
    }
}
```

### STEP 2: FOCUS/EDIT 态主循环集成 (main.js)

```javascript
// main.js 伪代码

function physicsStep(dt) {
    // 仅在 FOCUS/EDIT 态运行物理
    if (SystemState.interactionState !== 'FOCUS' && SystemState.interactionState !== 'EDIT') {
        return;
    }
    
    // [互斥] 如果有针对当前对象的动画任务（如归位动画），暂停物理
    const obj = SystemState.focusedObject;
    if (SystemState.taskQueues.current.some(t => t.target === obj)) {
        return;
    }
    
    if (!obj || !obj._isVolumetric) return;
    
    // 1. 物理模拟步 (PBD / Spring)
    PhysicsSystem.step(obj.physicsState, dt);
    
    // 2. 渲染数据更新
    if (CONFIG.physicsMode === 'PERFORMANCE') {
        // [性能模式] 直接复用表面粒子
        // 注意：不要每帧 slice/map，在初始化时建立引用即可
        if (!obj._tempDisplayPointsInitialized) {
            obj._tempDisplayPoints = obj.constructionPoints.slice(0, obj._surfaceBoundary);
            obj._tempDisplayPointsInitialized = true;
        }
        // 粒子位置已由物理系统更新，无需额外操作
        
    } else {
        // [效果模式]
        // A. 隔帧拟合优化（降低 CPU 负载）
        if (SystemState.frameCount % 2 === 0) {
            // 世界坐标 -> 局部坐标
            const localPoints = obj._cachedLocalPositions || new Array(obj.constructionPoints.length);
            for (let i = 0; i < obj.constructionPoints.length; i++) {
                const p = obj.constructionPoints[i];
                const local = worldToLocal(obj, p.position);
                if (!localPoints[i]) localPoints[i] = { x: 0, y: 0, z: 0 };
                localPoints[i].x = local.x;
                localPoints[i].y = local.y;
                localPoints[i].z = local.z;
            }
            obj._cachedLocalPositions = localPoints; // 复用数组
            
            // 拟合
            obj.fitSphericalHarmonics({
                sourcePoints: localPoints,
                order: obj.representation.data.fittedOrder || 4, // 使用物体固有阶数
                useIncremental: false,
                writeToTemp: true
            });
            
            // B. 原地更新采样（避免 new Point）
            obj.generateDisplayPoints({
                coefficients: obj._tempRepresentation.coefficients,
                writeToTemp: true,
                inPlace: true, // 关键：原地更新
                density: 20
            });
        }
    }
    
    // 3. [关键] 强制更新法向量与光照状态
    // 物体形变会导致法向量改变，进而影响反射光和高光
    // 必须在物理步后、渲染前完成更新
    
    // A. 计算法向量 (PhysicsBridgeImpl)
    PhysicsBridgeImpl.computeNormals(
        obj.constructionPoints, 
        PhysicsBridgeImpl.getTriangles(obj), // 需确保有获取三角形的方法
        obj._surfaceBoundary
    );
    
    // B. 标记系统脏状态，驱动 updateVisibleReflection
    // 这将迫使 main.js 在渲染前重算反射向量 (View Vector & Reflection Vector)
    SystemState.lightDirty = true; 
}
```

### STEP 3: Renderer 适配

```javascript
// Renderer.js 或 Window.js (calculate)

// 获取渲染点集的逻辑：
const renderPoints = (obj._tempDisplayPoints && obj._tempDisplayPoints.length > 0) 
    ? obj._tempDisplayPoints 
    : (obj.displayPoints || obj.constructionPoints);
```

---

## 5. 物理与动画系统协同 (Physics & Animation)

### 5.1 冲突分析
- **控制权争夺**：动画系统通过插值修改 `Object.transform`（宏观刚体）。物理系统通过力学计算修改 `ConstructionPoints`（微观形变）。
- **时序问题**：`gameLoop` 中 `physicsStep` 与 `processTaskQueue` 的执行顺序会影响最终状态。

### 5.2 融合策略 (Plan A: 调度层融合)

物理模拟被视为一种**持续运行的逻辑状态**，而非替代动画系统。

1. **分层控制**：
   - **动画 (Animation)**：负责宏观的确定的刚体变换（归位、切层）。**高优先级**。
   - **物理 (Physics)**：负责微观的自然的弹性形变（点击反馈、拖拽拉伸）。**低优先级**。

2. **互斥机制**：
   - 当有**刚体动画**（`MoveTask`, `RotateTask`）运行时，物理系统**暂停**或进入**阻尼消能模式**。
   - 动画结束后，物理系统接管 `ConstructionPoints` 的控制权。

3. **统一调度**（未来可选）：
   - 可将 `physicsStep` 封装为 `ContinuousTask` 放入 `taskQueues`，实现完全统一的生命周期管理。

---

## 6. EDIT 态交互增强：弹性编辑 (Elastic Editing)

利用现有的 `Shape Matching` 约束和物理系统，实现"果冻般"的拖拽手感。

### 6.1 机制原理
用户拖拽**控制点 (ControlPoint)** 时：
1. **锁定**：被拖拽的控制点对应的物理粒子设为 `fixed = true`。
2. **驱动**：每帧将该粒子位置同步到鼠标 3D 坐标。
3. **响应**：
   - **结构弹簧**：拉动邻近粒子。
   - **形状匹配**：整体试图维持原始形状，产生"跟随效果"。
   - **松手回弹**：释放 `fixed`，物体弹性复位。

### 6.2 详细流程

```javascript
// InputManager.js 伪代码

onDragStart(cp) {
    const idx = obj.getParticleIndexForControlPoint(cp);
    const particles = obj.physicsState.particles;
    particles[idx].fixed = true;
    particles[idx].invMass = 0;
    obj._draggedParticleIndex = idx;
}

onDrag(cp, worldPos) {
    const idx = obj._draggedParticleIndex;
    const particles = obj.physicsState.particles;
    const prevPos = { ...particles[idx].position };
    
    particles[idx].position.x = worldPos.x;
    particles[idx].position.y = worldPos.y;
    particles[idx].position.z = worldPos.z;
    
    // 可选：传递速度以产生惯性
    const dt = SystemState.lastDt || 0.016;
    particles[idx].velocity.x = (worldPos.x - prevPos.x) / dt;
    particles[idx].velocity.y = (worldPos.y - prevPos.y) / dt;
    particles[idx].velocity.z = (worldPos.z - prevPos.z) / dt;
}

onDragEnd(cp) {
    const idx = obj._draggedParticleIndex;
    const particles = obj.physicsState.particles;
    particles[idx].fixed = false;
    particles[idx].invMass = 1 / particles[idx].mass;
    obj._draggedParticleIndex = null;
    
    // 物理系统继续运行，阻尼会让其最终静止
}
```

### 6.3 关键约束配置

无需新增约束类型，利用现有的：

| 约束类型 | 作用 | 配置 |
|----------|------|------|
| **Distance/Spring** | 传递局部拉力 | 每条边一个 |
| **Shape Matching** | 传递整体回复力 | 需配置作用范围 |

**Shape Matching 作用范围** (`CONFIG.shapeMatchingScope`)：
- `'INTERNAL_ONLY'` (默认)：仅约束内部骨架粒子。表面较软，骨架较硬。
- `'ALL'`：约束所有粒子（包括表面）。物体表现更像实心橡胶。

需修改 `PhysicsBridgeImpl.buildPhysicsTopology`，根据配置决定传入哪些粒子。

### 6.4 退出过渡 (Exit Transition)

由于物理模拟可能产生微小的累积误差或未完全恢复的弹性形变，直接丢弃临时数据会导致**视觉瞬变 (Popping)**。

**解决方案**：在 `exitFocusState` 中执行**混合动画**：

```javascript
// main.js 伪代码

function exitFocusStateSmooth() {
    const obj = SystemState.focusedObject;
    if (!obj || !obj._tempDisplayPoints) {
        exitFocusStateImmediate();
        return;
    }
    
    // 1. 冻结物理
    obj._physicsEnabled = false;
    
    // 2. 创建混合动画任务
    const tempPoints = obj._tempDisplayPoints;
    const fixedPoints = obj.displayPoints;
    
    // 缓存初始差值
    const deltas = tempPoints.map((tp, i) => {
        const fp = fixedPoints[i] || { x: tp.x, y: tp.y, z: tp.z };
        return {
            dx: tp.x - fp.x,
            dy: tp.y - fp.y,
            dz: tp.z - fp.z
        };
    });
    
    const blendTask = AnimationImpl.createTask({
        id: 'focus_exit_blend_' + Date.now(),
        target: obj,
        duration: 300,
        easing: AnimationImpl.Easing.easeOut,
        compute: (progress) => ({ t: 1 - progress }), // t: 1 -> 0
        apply: (targetObj, { t }) => {
            for (let i = 0; i < tempPoints.length; i++) {
                const fp = fixedPoints[i];
                if (!fp) continue;
                tempPoints[i].x = fp.x + deltas[i].dx * t;
                tempPoints[i].y = fp.y + deltas[i].dy * t;
                tempPoints[i].z = fp.z + deltas[i].dz * t;
            }
        },
        onComplete: () => {
            // 3. 清理临时数据
            obj._tempDisplayPoints = null;
            obj._tempRepresentation = null;
            obj._tempDisplayPointsInitialized = false;
            obj._cachedLocalPositions = null;
            
            SystemState.interactionState = 'VIEW';
        }
    });
    
    SystemState.taskQueues.submit(blendTask);
}
```

---

## 7. 性能优化要点 (Performance Optimization)

### 7.1 已识别的资源浪费风险

| 问题 | 来源 | 影响 | 解决方案 |
|------|------|------|----------|
| **高频对象创建** | `goldenSpiralSampling` 每次返回新数组 | ~60,000 对象/秒，GC 压力 | 原地更新模式 (`inPlace: true`) |
| **重复坐标转换** | 每帧 `worldToLocal` 创建新对象 | 内存抖动 | 复用 `_cachedLocalPositions` 数组 |
| **全量光照重算** | 每帧 `updateVisibleReflection` 遍历全场景 | 性能瓶颈 | **优化**：仅对 Focused Object 进行局部反射更新，或接受高光计算开销作为 Quality 模式成本。 |
| **每帧拟合** | 效果模式每帧全量 QR 分解 | CPU 峰值 | 隔帧拟合 (`frameCount % 2`) |

### 7.2 实施规范

**禁止**：
```javascript
// ❌ 在 physicsStep/render 循环中禁止：
const newArray = points.map(p => ({ x: p.x, y: p.y, z: p.z }));
const newPoint = new Point(x, y, z);
const tempVec = { x: 0, y: 0, z: 0 };
```

**推荐**：
```javascript
// ✅ 在初始化时分配，在循环中复用：
if (!obj._reusableBuffer) {
    obj._reusableBuffer = new Array(expectedSize);
    for (let i = 0; i < expectedSize; i++) {
        obj._reusableBuffer[i] = { x: 0, y: 0, z: 0 };
    }
}

// 循环中仅修改值
for (let i = 0; i < points.length; i++) {
    obj._reusableBuffer[i].x = points[i].x;
    obj._reusableBuffer[i].y = points[i].y;
    obj._reusableBuffer[i].z = points[i].z;
}
```

---

## 8. 验证计划 (Verification)

### 8.1 功能验证

| 步骤 | 验证项 | 预期结果 |
|------|--------|----------|
| 1 | 进入 FOCUS 态 | 物体正确转化为体积网格（ConstructionPoints 生成） |
| 2 | EDIT 态弹性拖拽 | 拖拽控制点时有"整体跟随"+"局部拉伸"效果 |
| 3 | 松手回弹 | 松开鼠标后物体弹性复位（Shape Matching 生效） |
| 4 | 性能模式 | 物理粒子随力学规律运动，帧率稳定 |
| 5 | 效果模式 | 物体表面平滑变形，无高频抖动 |
| 6 | 退出过渡 | 退出 FOCUS/EDIT 时物体平滑过渡到原始形态，无瞬变 |
| 7 | 数据隔离 | 退出后固有数据（controlPoints、coefficients）未被修改 |

### 8.2 性能验证

| 指标 | 目标 | 测试方法 |
|------|------|----------|
| 帧率 | ≥ 55 FPS | Chrome DevTools Performance |
| GC 事件 | ≤ 2次/秒 | Memory Timeline |
| 内存增长 | ≤ 1 MB/分钟 | Heap Snapshot 对比 |

---

## 9. 实施依赖关系 (Dependencies)

```
[STEP 1: Object.js 接口扩展]
    |
    +-- [STEP 2: physicsStep 主循环集成]
    |       |
    |       +-- [STEP 3: Renderer 路由适配]
    |
    +-- [STEP 4: EDIT 态弹性编辑]
            |
            +-- [STEP 5: 退出过渡动画]
```

---

**备注**：此文档仅为方案规划，暂不执行代码修改。
