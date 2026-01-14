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

