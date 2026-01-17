# Main.js 第二次重构方案 V2.1

> 基于 V1 拆分完成后（3600行），进一步解耦与抽象  
> V2.1 更新：模块融合优化，减少新增模块数量

---

## 1. 核心理念：配置驱动 + 行为解耦

### 1.1 问题现状

当前代码中，VIEW/FOCUS/EDIT 三种交互状态的逻辑**硬编码**在各个函数中，导致：
- 添加新状态需要修改多处代码
- 状态间行为差异难以一目了然
- 测试困难

### 1.2 目标架构

引入 **交互配置预设 (Interaction Preset)** 模式：

```javascript
// 状态机仅负责切换配置
SystemState.interactionConfig = InteractionPresets[newState];

// 各模块读取配置，无需知道当前状态名
Window.applyBehaviorConfig(SystemState.interactionConfig.camera);
StyleImpl.applyVisibility(objects, SystemState.interactionConfig.visibility);
```

---

## 2. 模块变更总览

### 2.1 变更类型统计

| 类型 | 数量 | 模块 |
|------|------|------|
| **新增** | 3 | `InteractionConfigImpl`, `InputHandlerImpl`, `RenderPipelineImpl` |
| **扩展** | 3 | `Window.js`, `StyleImpl.js`, `AnimationImpl.js` → `TaskSystemImpl.js` |
| **不变** | 3 | `ObjectFactoryImpl`, `OrientationImpl`, `World.js` |

### 2.2 模块职责边界

```
┌─────────────────────────────────────────────────────────────┐
│                   InteractionConfigImpl                      │
│                   (配置预设 - 数据中心)                       │
└─────────────────────────────────────────────────────────────┘
                              ↓ 读取配置
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ InputHandlerImpl │  │    Window.js     │  │   StyleImpl.js   │
│  (输入 → 动作)   │  │ (相机+光标约束)  │  │  (样式+可见性)   │
└────────┬─────────┘  └──────────────────┘  └──────────────────┘
         ↓ 分发动作
┌──────────────────┐  ┌──────────────────┐
│ TaskSystemImpl   │  │ OrientationImpl  │
│ (动画+即时动作)  │  │   (姿态旋转)     │
└──────────────────┘  └──────────────────┘
         ↓ 触发渲染
┌──────────────────┐
│RenderPipelineImpl│
│   (渲染管线)     │
└──────────────────┘
```

---

## 3. 新增模块详细设计

### 3.1 InteractionConfigImpl.js（新增）

**职责**：存储和管理所有交互状态的配置预设

```javascript
export class InteractionConfigImpl {
  static Presets = {
    VIEW: {
      rotation: { mode: 'orbit', sensitivity: 0.005 },
      cursor: { snapTargets: ['grid', 'surface'], wheelBehavior: 'zoom' },
      camera: { movementEnabled: true, orbitEnabled: true },
      visibility: { othersAlpha: 1.0, gridMode: 'world' },
      input: { mouseDragAction: 'cameraOrbit', clickAction: 'selectObject' }
    },
    FOCUS: { /* ... */ },
    EDIT: { /* ... */ }
  };

  static get(stateName) {
    return this.Presets[stateName];
  }

  static resolve(config, context) {
    // 解析 '@focused' 等动态引用
  }
}
```

### 3.2 InputHandlerImpl.js（新增）

**职责**：将原始输入事件转换为语义化动作

```javascript
export class InputHandlerImpl {
  static handleKeyDown(key, config) {
    const action = config.input.keyBindings?.[key];
    if (action) TaskSystemImpl.dispatch(action);
  }

  static handleMouseDrag(dx, dy, config) {
    TaskSystemImpl.dispatch(config.input.mouseDragAction, { dx, dy });
  }

  static handleClick(screenPos, config) {
    TaskSystemImpl.dispatch(config.input.clickAction, { screenPos });
  }

  static handleWheel(delta, config) {
    if (config.cursor.wheelBehavior === 'zoom') {
      TaskSystemImpl.dispatch('cameraZoom', { delta });
    } else if (config.cursor.wheelBehavior === 'elevate') {
      TaskSystemImpl.dispatch('cursorElevate', { delta });
    }
  }
}
```

### 3.3 RenderPipelineImpl.js（新增）

**职责**：分阶段执行渲染流程

```javascript
export class RenderPipelineImpl {
  static render(window, objects, config) {
    // 阶段1：计算屏幕投影
    const screenData = this.computePass(window, objects);
    
    // 阶段2：光栅化到缓冲区
    this.rasterizePass(screenData, config);
    
    // 阶段3：绘制叠加层（控制点、轮廓等）
    this.overlayPass(screenData, config.render);
  }

  static computePass(window, objects) { /* ... */ }
  static rasterizePass(screenData, config) { /* ... */ }
  static overlayPass(screenData, renderConfig) { /* ... */ }
}
```

---

## 4. 现有模块扩展设计

### 4.1 Window.js 扩展（相机行为 + 光标约束）

**新增内容**：

```javascript
class Window {
  // === 新增：行为配置 ===
  _behaviorConfig = null;

  setBehaviorConfig(config) {
    this._behaviorConfig = config;
  }

  // === 新增：相机行为 ===
  orbit(dx, dy) {
    if (!this._behaviorConfig?.orbitEnabled) return;
    // 轨道旋转逻辑
  }

  move(direction, distance) {
    if (!this._behaviorConfig?.movementEnabled) return;
    // 平移逻辑
  }

  lookAt(target) {
    this._behaviorConfig.lookAtTarget = target;
    // 更新视线方向
  }

  // === 新增：光标约束 ===
  constrainCursor(screenPos, cursorConfig) {
    let worldPos = this.screenToWorld(screenPos);

    // 平面约束
    if (cursorConfig.planeConstraint) {
      worldPos = this.projectToPlane(worldPos, cursorConfig.planeConstraint);
    }

    // 吸附
    if (cursorConfig.snapTargets?.length > 0) {
      const snapped = this.findNearestSnap(worldPos, cursorConfig);
      if (snapped) worldPos = snapped;
    }

    return worldPos;
  }

  findNearestSnap(worldPos, cursorConfig) {
    // 根据 snapTargets 过滤可吸附点
  }
}
```

### 4.2 StyleImpl.js 扩展（可见性管理）

**新增内容**：

```javascript
class StyleImpl {
  // === 原有 ===
  static COLOR_LUT = { /* ... */ };

  // === 新增：可见性配置应用 ===
  static applyVisibility(objects, focusedObject, config) {
    for (const obj of objects) {
      if (obj === focusedObject) {
        obj.visualAlpha = config.focusedAlpha;
      } else {
        obj.visualAlpha = config.othersAlpha;
      }
    }
  }

  // === 新增：高亮效果 ===
  static applyHighlight(obj, mode) {
    switch (mode) {
      case 'outline':
        obj._highlightStyle = { type: 'outline', color: '#FFFFFF', width: 2 };
        break;
      case 'glow':
        obj._highlightStyle = { type: 'glow', color: '#FFD700', radius: 5 };
        break;
      default:
        obj._highlightStyle = null;
    }
  }

  // === 新增：格网样式 ===
  static getGridStyle(mode) {
    switch (mode) {
      case 'world': return { color: '#444444', alpha: 0.5 };
      case 'local': return { color: '#666666', alpha: 0.8, layerHighlight: '#FFD700' };
      default: return null;
    }
  }
}
```

### 4.3 AnimationImpl.js → TaskSystemImpl.js（重命名 + 扩展）

**变更说明**：保留原有动画功能，新增即时动作分发

```javascript
export class TaskSystemImpl {
  // === 原有动画功能 ===
  static Easing = { /* ... */ };
  static createTask(options) { /* ... */ }
  static submitAnimation(task) { /* ... */ }

  // === 新增：动作注册与分发 ===
  static _actionHandlers = new Map();

  static registerAction(name, handler) {
    this._actionHandlers.set(name, handler);
  }

  static dispatch(actionName, params = {}) {
    const handler = this._actionHandlers.get(actionName);
    if (handler) {
      handler(params);
    } else {
      console.warn(`Unknown action: ${actionName}`);
    }
  }

  // === 新增：批量注册 ===
  static registerActions(actionMap) {
    for (const [name, handler] of Object.entries(actionMap)) {
      this.registerAction(name, handler);
    }
  }
}
```

---

## 5. 状态机简化

重构后的状态切换逻辑：

```javascript
function transitionTo(newState) {
  const oldState = SystemState.interactionState;

  // 1. 执行退出钩子
  StateHooks.onExit[oldState]?.();

  // 2. 获取并应用新配置
  const config = InteractionConfigImpl.get(newState);
  SystemState.interactionConfig = InteractionConfigImpl.resolve(config, {
    focused: SystemState.focusedObject,
    screenPlane: SystemState.mainWindow.getScreenPlane()
  });

  // 3. 应用配置到各模块
  SystemState.mainWindow.setBehaviorConfig(config.camera);
  StyleImpl.applyVisibility(SystemState.objects, SystemState.focusedObject, config.visibility);

  // 4. 更新状态
  SystemState.interactionState = newState;

  // 5. 执行进入钩子
  StateHooks.onEnter[newState]?.();
}
```

---

## 6. 实施阶段

### 阶段 A：配置系统基础（预计减少 ~100 行）

| 任务 | 说明 |
|------|------|
| A1 | 创建 `InteractionConfigImpl.js`，定义三态预设 |
| A2 | 扩展 `AnimationImpl.js` → `TaskSystemImpl.js`，添加动作分发 |
| A3 | 简化 `main.js` 状态切换逻辑 |

### 阶段 B：输入处理重构（预计减少 ~400 行）

| 任务 | 说明 |
|------|------|
| B1 | 创建 `InputHandlerImpl.js` |
| B2 | 注册所有动作处理器到 `TaskSystemImpl` |
| B3 | 重构 `setupEventListeners`，委托到 `InputHandlerImpl` |

### 阶段 C：Window 扩展（预计减少 ~200 行）

| 任务 | 说明 |
|------|------|
| C1 | 扩展 `Window.js`，添加相机行为方法 |
| C2 | 扩展 `Window.js`，添加光标约束方法 |
| C3 | 迁移 `main.js` 中的相机/光标逻辑 |

### 阶段 D：样式系统扩展（预计减少 ~100 行）

| 任务 | 说明 |
|------|------|
| D1 | 扩展 `StyleImpl.js`，添加可见性管理 |
| D2 | 扩展 `StyleImpl.js`，添加高亮效果 |
| D3 | 迁移 `main.js` 中的可见性逻辑 |

### 阶段 E：渲染管线提取（预计减少 ~300 行）

| 任务 | 说明 |
|------|------|
| E1 | 创建 `RenderPipelineImpl.js` |
| E2 | 提取 `render()` 函数的三个阶段 |
| E3 | 提取叠加层绘制逻辑 |

---

## 7. 预期成果

| 指标 | 当前 | 目标 |
|------|------|------|
| main.js 行数 | ~3600 | ~2500 |
| 状态相关 if-else | ~50处 | ~5处 |
| 新增模块 | - | 3 |
| 扩展模块 | - | 3 |
| 配置可读性 | 低 | 高 |

---

## 8. 附录：完整配置预设示例

```javascript
const InteractionPresets = {
  VIEW: {
    rotation: {
      mode: 'orbit',
      target: null,
      sensitivity: 0.005
    },
    cursor: {
      snapTargets: ['grid', 'surface'],
      planeConstraint: null,
      wheelBehavior: 'zoom',
      snapRadius: 10
    },
    camera: {
      movementEnabled: true,
      orbitEnabled: true,
      lookAtTarget: null,
      zoomRange: [5, 500]
    },
    visibility: {
      focusedAlpha: 1.0,
      othersAlpha: 1.0,
      gridMode: 'world'
    },
    input: {
      keyBindings: {
        'w': 'cameraMoveForward',
        's': 'cameraMoveBackward',
        'a': 'cameraMoveLeft',
        'd': 'cameraMoveRight'
      },
      mouseDragAction: 'cameraOrbit',
      clickAction: 'selectObject'
    },
    render: {
      highlightMode: 'none',
      controlPointScale: 1.0,
      showSliceContour: false
    }
  },

  FOCUS: {
    rotation: {
      mode: 'free',
      target: '@focused',
      sensitivity: 0.01
    },
    cursor: {
      snapTargets: ['surface'],
      planeConstraint: '@screenPlane',
      wheelBehavior: 'zoom',
      snapRadius: 15
    },
    camera: {
      movementEnabled: false,
      orbitEnabled: true,
      lookAtTarget: '@focused.center',
      zoomRange: [10, 200]
    },
    visibility: {
      focusedAlpha: 1.0,
      othersAlpha: 0.3,
      gridMode: 'none'
    },
    input: {
      keyBindings: {
        'w': 'rotatePitchUp',
        's': 'rotatePitchDown',
        'a': 'rotateYawLeft',
        'd': 'rotateYawRight',
        'Escape': 'exitFocus',
        'Enter': 'enterEdit'
      },
      mouseDragAction: 'rotateObjectFree',
      clickAction: 'none'
    },
    render: {
      highlightMode: 'outline',
      controlPointScale: 1.0,
      showSliceContour: false
    }
  },

  EDIT: {
    rotation: {
      mode: 'discrete',
      target: '@focused',
      snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
      animationDuration: 200
    },
    cursor: {
      snapTargets: ['localGrid', 'controlPoint'],
      planeConstraint: '@localGridPlane',
      wheelBehavior: 'elevate',
      snapRadius: 20
    },
    camera: {
      movementEnabled: false,
      orbitEnabled: false,
      lookAtTarget: '@focused.center',
      zoomRange: [20, 100]
    },
    visibility: {
      focusedAlpha: 1.0,
      othersAlpha: 0.0,
      gridMode: 'local'
    },
    input: {
      keyBindings: {
        'w': 'discreteRotatePitchUp',
        's': 'discreteRotatePitchDown',
        'a': 'discreteRotateYawLeft',
        'd': 'discreteRotateYawRight',
        'q': 'discreteRotateRollLeft',
        'e': 'discreteRotateRollRight',
        'Escape': 'exitEdit'
      },
      mouseDragAction: 'moveControlPoint',
      clickAction: 'selectControlPoint'
    },
    render: {
      highlightMode: 'glow',
      controlPointScale: 1.5,
      gridLayerHighlight: '#FFD700',
      showSliceContour: true
    }
  }
};
```

---

*文档版本: V2.2*  
*创建日期: 2026-01-15*  
*更新说明: 新增物理系统影响分析、动画系统统一化方案*

---

## 9. 动画系统统一化

### 9.1 当前问题：双轨并行

当前存在两套动画机制：

| 机制 | 调度方式 | 使用场景 |
|------|----------|----------|
| **TaskQueue + AnimationImpl** | `processTaskQueue()` 每帧统一执行 | FOCUS 进入/退出动画 |
| **独立 requestAnimationFrame** | 函数内自循环 | `animateRotation()`, `animateSliceTransition()` |

**问题**：
- 独立 rAF 动画绕过 `animationLock` 机制
- 无法统一取消或管理
- 可能与物理步进同帧冲突

### 9.2 V2 方案：TaskSystemImpl 统一

```javascript
// 改造前：独立 rAF
function animateRotation(obj, axis, angle, duration) {
  function animate() { requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
}

// 改造后：提交到统一队列
function animateRotation(obj, axis, angle, duration) {
  const task = TaskSystemImpl.createRotationTask(obj, axis, angle, duration);
  SystemState.taskQueues.submit(task);
}
```

**TaskSystemImpl 新增工厂方法**：
- `createRotationTask()` — 替代 `animateRotation()`
- `createSliceTransitionTask()` — 替代 `animateSliceTransition()`

**优势**：
- 所有动画由 `gameLoop` 统一调度
- `animationLock` 自动管理
- 支持取消和优先级

---

## 10. 物理系统影响分析

### 10.1 不受影响的模块

| 模块 | 说明 |
|------|------|
| `PhysicsSystem.js` | PBD/XPBD 求解器，完全独立，**无需修改** |
| `PhysicsBridgeImpl.js` | 粒子/约束构建，**无需修改** |
| `Object.js` 物理接口 | `getPhysicsView()`/`commitPhysics()`，**无需修改** |

### 10.2 需关注的交互点

#### (1) animationLock 机制

```javascript
// physicsStep() 中
if (obj.animationLock) continue; // 动画期间跳过物理
```

**V2 影响**：✅ **正面** — TaskSystemImpl 统一管理动画锁，更健壮

#### (2) gameLoop 调用顺序

```javascript
function gameLoop() {
  processTaskQueue(dt);  // 1. 动画
  physicsStep(dt);       // 2. 物理 ← 顺序不变
  render();              // 3. 渲染
}
```

**V2 影响**：✅ **无变化** — 主循环结构保持不变

#### (3) 独立 rAF 冲突修复

**当前问题**：`animateRotation()` 可能与 `physicsStep()` 同帧修改物体

**V2 修复**：转为 TaskSystem 任务后，通过 `animationLock` 正确隔离

### 10.3 可选增强：物理配置化

可在 InteractionConfig 中添加物理配置：

```javascript
EDIT: {
  physics: {
    enabled: false,       // EDIT 态暂停全局物理
    localPreview: true    // 允许局部弹性预览
  }
}
```

替代当前硬编码的状态判断。

---

## 11. 不变模块说明

以下模块在 V2 重构中**完全不变**：

| 模块 | 职责 | 不变原因 |
|------|------|----------|
| `ObjectFactoryImpl.js` | 几何体创建、格网配置 | V1 已完成迁移 |
| `OrientationImpl.js` | 姿态系统、旋转工具 | V1 已完成迁移 |
| `World.js` | 世界管理 | 职责独立 |
| `PhysicsSystem.js` | PBD 物理求解 | 与动画/状态解耦 |
| `PhysicsBridgeImpl.js` | 物理数据构建 | 仅数据层 |
| `Object.js` | 几何对象基类 | 稳定接口 |
| `Point.js` | 点数据结构 | 纯数据 |

---

## 12. 风险与验证清单

### 实施风险

| 风险 | 缓解措施 |
|------|----------|
| 动画锁遗漏 | TaskSystemImpl 在 `createTask()` 中自动设置 |
| 物理顺序错乱 | `physicsStep()` 调用位置不变 |
| 独立 rAF 残留 | 全局搜索 `requestAnimationFrame` 确认全部迁移 |

### 验证清单

- [ ] `animationLock` 在任务开始时自动设置
- [ ] `animationLock` 在任务完成/取消时自动解除
- [ ] `physicsStep()` 仍在 `processTaskQueue()` 之后调用
- [ ] 无残留的独立 `requestAnimationFrame` 动画
- [ ] EDIT 态物理行为符合预期（暂停或配置化）

---

## 13. 实施风险补充分析

> 本节基于对 `main.js` 全部 3600+ 行代码的逐行核查，补充 V2 方案可能遗漏或过度设计的部分。

### 13.1 遗漏的逻辑模块

以下模块在 V2 文档中**未被提及或仅一笔带过**，如直接按文档实施会导致功能丢失：

| 模块 | 行数估计 | 当前位置 | 建议归属 |
|------|----------|----------|----------|
| **摄像头控制系统** (`initCamera`, `processCamera`, `processQueue`, `updateCameraDisplay`, `drawCameraFeedOnMainCanvas`) | ~150 行 | main.js L221-391, L3503-3575 | 新建 `CameraInputImpl.js` 或作为 `InputHandlerImpl` 子模块 |
| **虚拟鼠标与吸附系统** (`updateVirtualMouse`, `findNearestAttractableExpanding`, `renderScreenOverlay`) | ~250 行 | main.js L950-1197 | **不宜**直接并入 `Window.js`；建议新建 `CursorImpl.js` |
| **蓄力冲量系统** (`calculateImpulse`, `applyTouchImpulse`, `applyTouchImpulseSimple`, `findSurfaceHit`) | ~180 行 | main.js L2565-2787 | 新建 `InteractionImpl.js` 或归入物理系统 |
| **状态机详细逻辑** (`enterViewState`, `enterFocusState`, `exitFocusState`, `enterEditState`, `exitEditState`) | ~400 行 | main.js L1950-2468, L3127-3253 | 状态入口/出口逻辑应保留在 `main.js` 或提取为 `StateMachineImpl.js` |
| **FOCUS 态旋转动画** (`rotateFocusedObject`, `handleFocusEdgeRotation`) | ~150 行 | main.js L1265-1312, L2471-2563 | 归入 `OrientationImpl.js` 扩展 |
| **切片过渡动画** (`animateSliceTransition`, `snapToNearestLayer`) | ~100 行 | main.js L2978-3115 | 应纳入 `TaskSystemImpl` 或保留为独立工具函数 |

> **关键风险**：`animateSliceTransition` 和 `animateRotation` 使用**独立 `requestAnimationFrame`** 绕过 TaskQueue，与 V2 第 9.2 节 "统一到 TaskSystemImpl" 目标矛盾。

---

### 13.2 画蛇添足的设计模式

以下设计在 V2 中被引入，但可能增加复杂度而收益有限：

#### (1) 字符串动态引用解析 (`@focused`, `@screenPlane`)

```javascript
// V2 建议
config.cursor.planeConstraint = '@localGridPlane';
InteractionConfigImpl.resolve(config, context);  // 解析 '@xxx'
```

**问题**：
- 需要编写并维护字符串解析器
- 失去 IDE 代码跳转、参数提示和类型检查能力
- 运行时错误难以调试（拼错字符串不会报错）

**建议**：直接在代码中判断状态，例如：
```javascript
// 更直接的方式
const target = (state === 'FOCUS') ? focusedObject : null;
```

#### (2) 字符串动作分发 (`TaskSystemImpl.dispatch('actionName')`)

```javascript
// V2 建议
TaskSystemImpl.dispatch('cameraZoom', { delta });
```

**问题**：
- 需要预注册所有动作处理器
- 调用时失去函数签名提示
- 重构时无法自动重命名

**建议**：使用直接函数调用：
```javascript
// 更直接的方式
CameraActions.zoom(delta);
```

#### (3) 过度配置化的交互预设

V2 附录中的 `InteractionPresets` 配置对象达 130+ 行，试图将所有行为参数化。但当前 `main.js` 中大部分逻辑是**过程性**的（涉及复杂的条件判断和中间状态），无法简单用配置表达。

**建议**：
- 配置仅用于**真正可变的参数**（如灵敏度、阈值）
- **行为逻辑**保持代码形式，便于调试和扩展

---

### 13.3 SystemState 循环依赖风险

**现状**：`SystemState` 定义在 `main.js` 中，包含：
- `objects`, `focusedObject` — 场景数据
- `mainWindow`, `taskQueues` — 系统实例
- `interactionState`, `virtualMouse` — 交互状态

**问题**：如果新模块（`InputHandlerImpl`, `RenderPipelineImpl` 等）需要访问这些状态，必须 import `main.js`，导致**循环依赖**：

```
main.js → InputHandlerImpl.js → main.js (循环!)
```

**解决方案**：

1. **立即抽离 SystemState**：在任何 Impl 模块创建之前，先将 `SystemState` 提取为独立模块：
   ```
   manage/SystemState.js  // 纯数据容器
   ```

2. **依赖注入模式**：Impl 模块不直接 import SystemState，而是通过函数参数接收：
   ```javascript
   // InputHandlerImpl.js
   static handleKeyDown(key, config, systemState) { ... }
   ```

3. **单例访问器**：如果注入过于繁琐，可提供全局访问器：
   ```javascript
   // manage/SystemState.js
   let _instance = null;
   export function getState() { return _instance; }
   export function initState(state) { _instance = state; }
   ```

---

### 13.4 建议的实施顺序修正

基于上述分析，建议将 V2 第 6 节的阶段顺序调整为：

| 顺序 | 任务 | 说明 |
|------|------|------|
| **0** | 抽离 `SystemState.js` | 打破循环依赖，后续模块可安全 import |
| A | 配置系统基础 | 按 V2 原计划 |
| **A'** | 迁移独立 rAF 动画到 TaskSystem | 处理 `animateSliceTransition`, `animateRotation` |
| B | 输入处理重构 | 按 V2 原计划，但**简化动作分发**为直接调用 |
| **B'** | 抽离摄像头系统 | 新建 `CameraInputImpl.js` |
| C | Window 扩展 | 按 V2 原计划 |
| **C'** | 抽离虚拟鼠标系统 | 新建 `CursorImpl.js`，不并入 Window |
| D | 样式系统扩展 | 按 V2 原计划 |
| E | 渲染管线提取 | 按 V2 原计划 |

---

### 13.5 完整遗漏函数清单

以下函数在 V2 中**未规划去向**，需在实施前明确：

```
main.js 中未被 V2 覆盖的函数：
├── 摄像头系统
│   ├── initCamera()
│   ├── processCamera()
│   ├── processQueue()
│   ├── initCameraDisplay()
│   ├── updateCameraDisplay()
│   └── drawCameraFeedOnMainCanvas()
├── 虚拟鼠标系统
│   ├── updateVirtualMouse()
│   ├── findNearestAttractableExpanding()
│   ├── renderScreenOverlay()
│   └── renderScreenPixel()
├── 状态机与动画
│   ├── enterViewState()
│   ├── enterFocusState()  // ~200 行，含复杂动画逻辑
│   ├── exitFocusState()   // ~150 行，含复杂动画逻辑
│   ├── enterEditState()
│   ├── exitEditState()
│   ├── rotateFocusedObject()
│   ├── handleFocusEdgeRotation()
│   ├── animateSliceTransition()  // 独立 rAF
│   ├── animateRotation()         // 独立 rAF
│   └── snapToNearestLayer()
├── 蓄力/冲量系统
│   ├── findSurfaceHit()
│   ├── calculateImpulse()
│   ├── applyTouchImpulse()
│   └── applyTouchImpulseSimple()
├── 控制点系统
│   ├── showControlPoints()
│   ├── hideControlPoints()
│   ├── findControlPointAt()
│   ├── moveControlPoint()
│   ├── deleteControlPoint()
│   └── addControlPointAt()
├── 局部格网系统
│   └── updateLocalGrid()
├── 双击检测
│   ├── onMouseClick()
│   └── findClickedObjectCenter()
├── 物体操作
│   ├── moveObjectTo()
│   ├── applyQuaternionToPoints()
│   └── calculateCenterPosition()
└── 辅助函数
    ├── userRotate()
    ├── updateLogVelocity()
    ├── applyVelocities()
    ├── updateVisibleReflection()
    ├── resizeCanvas()
    ├── createObjectFromCommand()
    └── updateFromCamera()
```

---

*补充日期: 2026-01-15*
*核查范围: main.js 全部 3608 行*

---

## 14. 功能需求清单

> 本节以**需求形式**列明重构必须满足的约束，确保功能完整、不过度设计、不引入新问题。

---

### 14.1 强制保留的功能 (MUST KEEP)

以下功能在重构后**必须完整保留**，不得丢失或简化：

| 需求 ID | 功能名称 | 当前位置 | 验收标准 |
|---------|----------|----------|----------|
| **FK-01** | 三态状态机 | main.js L163, L1950-2468, L3127-3253 | VIEW/FOCUS/EDIT 三态切换正常，中间态 `FOCUS_ENTERING` 动画正确 |
| **FK-02** | 双击检测 | main.js L2792-2840 | VIEW 双击物心进入 FOCUS；FOCUS 双击进入 EDIT；EDIT 双击空白新增控制点 |
| **FK-03** | 虚拟鼠标吸附 | main.js L950-1144 | 虚拟鼠标吸附到世界格网点（VIEW）、局部格网点（EDIT）、透视圈渲染正确 |
| **FK-04** | 边缘触发旋转 | main.js L1265-1312 | FOCUS 态鼠标移到屏幕边缘触发对数加速旋转 |
| **FK-05** | 96 态离散旋转 | OrientationImpl.js 全部 | EDIT 态 WASD/QE 离散旋转，正确在 FACE/EDGE 态间切换 |
| **FK-06** | 切片深度切换 | main.js L1477-1544, L2978-3115 | EDIT 态滚轮切换切片层，带动画过渡，对齐到精确层位 |
| **FK-07** | 局部格网系统 | main.js L2906-2962, ObjectFactoryImpl L352-500 | EDIT 态显示局部格网，随物体旋转同步，仅屏幕平面附近格点可吸附 |
| **FK-08** | 蓄力冲量系统 | main.js L2565-2787 | FOCUS 态长按表面后释放施加冲量，影响物理粒子速度 |
| **FK-09** | 摄像头头追踪 | main.js L221-391, L3503-3575 | 摄像头实时追踪用户头部位置，调整视窗 Capital |
| **FK-10** | 对数速度系统 | main.js L1379-1424, L188-192 | VIEW 态 WASD 键控速度对数加减速，平滑启停 |
| **FK-11** | 物体拖拽放置 | main.js L1572-1628, L1656-1663 | VIEW 态拖拽物心，物体跟随虚拟鼠标，吸附到格点放置 |
| **FK-12** | 控制点 CRUD | main.js L3188-3411 | EDIT 态可新增、移动、删除控制点 |
| **FK-13** | 物心 centerPoint | Object.js L195-211, main.js renderPoints | 物心作为可吸附点正确投影和渲染 |
| **FK-14** | 窗口 resize 响应 | main.js L1749-1777 | 窗口大小变化后画布和视窗正确重建 |
| **FK-15** | TaskQueue 动画系统 | main.js L122-155, L1840-1853, AnimationImpl 全部 | 动画任务通过队列调度，支持链式 then、取消、锁定 |

---

### 14.2 禁止的操作 (MUST NOT)

以下操作在重构过程中**严格禁止**：

| 需求 ID | 禁止事项 | 原因 |
|---------|----------|------|
| **MN-01** | 禁止删除 `animationLock` 机制 | 动画锁用于隔离动画与物理更新，删除会导致状态冲突 |
| **MN-02** | 禁止在 Impl 模块中直接 import main.js | 会造成循环依赖，必须先抽离 SystemState |
| **MN-03** | 禁止将虚拟鼠标逻辑并入 Window.js | Window.js 已 823 行，再增 250 行会过度膨胀 |
| **MN-04** | 禁止将 `CONFIG` 与 `SystemState` 合并 | CONFIG 是静态配置，SystemState 是运行时状态，混淆会影响可读性 |
| **MN-05** | 禁止使用字符串反射解析配置（如 `@focused`） | 增加复杂度，IDE 支持差，运行时拼写错误难以发现 |
| **MN-06** | 禁止将所有输入处理转为字符串 dispatch | 直接函数调用更安全，重构时可自动追踪引用 |
| **MN-07** | 禁止修改 `gameLoop` 的执行顺序 | input → task → physics → render 顺序固定，改变可能导致帧延迟或物理错误 |
| **MN-08** | 禁止删除 `processCamera` 的节流逻辑 | 必须保持摄像头处理频率限制，否则性能下降 |
| **MN-09** | 禁止将独立 rAF 动画直接删除 | 必须先迁移到 TaskQueue，否则功能丢失 |
| **MN-10** | 禁止在渲染循环中分配大量临时对象 | 当前 render() 约 300 行无大量 new，保持精简避免 GC 压力 |

---

### 14.3 需要清理的重复代码 (CLEANUP)

以下代码存在重复实现，重构时应**合并为单一来源**：

| 需求 ID | 重复项 | 位置 | 处理建议 |
|---------|--------|------|----------|
| **CL-01** | `snapToNearestLayer` | main.js L3070-3115 vs OrientationImpl.js L838-880 | 删除 main.js 版本，统一使用 OrientationImpl |
| **CL-02** | `rotatePointAroundAxis` | main.js L2499-2519 vs OrientationImpl.rotateObjectAroundAxis | 提取公共工具函数到 OrientationImpl，main.js 调用 |
| **CL-03** | `calculateRotationFromTwoFrames` | main.js L2248-2346 (闭包) | 提取为 OrientationImpl 静态方法 |
| **CL-04** | 四元数工具函数 | 散落在 main.js 各处 | 已有 OrientationImpl，确保全部使用 |
| **CL-05** | 坐标转换 cm↔pixel | Window.js L641-646 (闭包) | 提取为 Window 类方法或工具函数 |
| **CL-06** | 点归一化逻辑 | 多处手写 `len = sqrt(...)` | 考虑添加 Vector.normalize() |

---

### 14.4 模块归属约束 (MODULE RULES)

| 需求 ID | 规则 |
|---------|------|
| **MR-01** | 每个 Impl 文件**行数不超过 500 行** |
| **MR-02** | `main.js` 重构后**行数不超过 2000 行** |
| **MR-03** | 新增模块数量**不超过 5 个** |
| **MR-04** | 所有新模块必须放在 `manage/` 目录 |
| **MR-05** | `SystemState` 必须在**阶段 0**抽离为独立模块 |
| **MR-06** | 所有动画必须通过 `TaskQueue` 调度，禁止新增独立 rAF |

---

### 14.5 接口保持约束 (API STABILITY)

以下公开接口在重构后**必须保持兼容**：

| 需求 ID | 接口 | 位置 | 说明 |
|---------|------|------|------|
| **AS-01** | `AnimationImpl.createTask()` | AnimationImpl.js L53-71 | 任务配置格式不变 |
| **AS-02** | `AnimationImpl.Easing.*` | AnimationImpl.js L10-21 | 缓动函数命名不变 |
| **AS-03** | `OrientationImpl.transition()` | OrientationImpl.js L254-386 | 离散旋转接口不变 |
| **AS-04** | `OrientationImpl.rotateObjectAroundAxis()` | OrientationImpl.js L595-655 | 旋转工具函数签名不变 |
| **AS-05** | `ObjectFactoryImpl.create*()` | ObjectFactoryImpl.js | 所有工厂方法签名不变 |
| **AS-06** | `StyleImpl.getLUT()` | StyleImpl.js L33-38 | 颜色 LUT 获取方式不变 |
| **AS-07** | `Window.calculate()` | Window.js L100-226 | 投影计算入口不变 |
| **AS-08** | `Object.savePosition()` / `getSavedPosition()` | Object.js | 位置保存/恢复接口不变 |

---

### 14.6 验证清单 (VERIFICATION)

重构完成后必须通过以下验证：

| 需求 ID | 验证项 | 方法 |
|---------|--------|------|
| **VF-01** | VIEW 态世界格网正常显示 | 手动验证：打开应用，确认 10cm 格点渲染正确 |
| **VF-02** | 双击进入 FOCUS 动画正常 | 手动验证：双击物心，物体居中且正面朝向用户 |
| **VF-03** | FOCUS 态边缘旋转正常 | 手动验证：鼠标移到边缘，物体开始旋转 |
| **VF-04** | EDIT 态 WASD 离散旋转正常 | 手动验证：按 W 键，物体旋转 45°/90° |
| **VF-05** | EDIT 态滚轮切片正常 | 手动验证：滚动三格，物体沿视线方向平移一层 |
| **VF-06** | 局部格网显示且正确旋转 | 手动验证：EDIT 态旋转后，格网跟随物体 |
| **VF-07** | ESC 分层退出正常 | 手动验证：EDIT→FOCUS→VIEW 逐层退出 |
| **VF-08** | 摄像头追踪工作 | 手动验证：开启摄像头后移动头部，视角跟随 |
| **VF-09** | 无控制台未捕获异常 | 自动验证：打开 DevTools Console，无红色错误 |
| **VF-10** | 渲染帧率 ≥ 30fps | 性能验证：使用 DevTools Performance，帧间隔 ≤ 33ms |

---

### 14.7 暂缓实施的功能 (DEFER)

以下功能当前实现不完整或预留，重构时**暂不迁移**，保留在 main.js：

| 需求 ID | 功能 | 位置 | 原因 |
|---------|------|------|------|
| **DF-01** | `createObjectFromCommand()` | main.js L1793-1818 | 预留接口，未实际使用 |
| **DF-02** | `updateFromCamera()` | main.js L1823-1828 | 预留接口，未实际使用 |
| **DF-03** | `rebuildShapeFromControlPoints()` | main.js L3472-3476 (TODO) | 仅为 TODO 注释 |
| **DF-04** | 物理系统 `physicsStep()` | main.js L1860-1887 | 逻辑简单，暂不迁移 |

---

*需求文档版本: 1.0*
*创建日期: 2026-01-15*
*覆盖范围: main.js (3608行) + manage/*.js + base/*.js*