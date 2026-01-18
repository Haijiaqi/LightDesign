# 重构验收标准 (SOT): main.js

本文档作为 `main.js` 重构行为的**唯一事实来源 (Source of Truth)**。任何重构代码必须严格遵守这些标准，以确保零功能回退。

## 1. 系统状态与流转 (System States & Transitions)

应用程序由一个包含三个主要状态和两个过渡状态的状态机驱动。重构必须严格维持这些边界。

### 1.1 状态定义

| 状态 (State) | 描述 | 相机行为 | 物体可见性 | 辅助网格 / 鼠标 |
| :--- | :--- | :--- | :--- | :--- |
| **VIEW** (观察态) | 漫游模式。用户可以在场景中自由飞行。 | 自由移动 (WASD/方向键)，距离可缩放。 | 所有物体可见 (visualAlpha=1.0)。 | 世界网格 (World Grid): **可见**。<br>虚拟鼠标: **激活** (吸附到世界网格)。 |
| **FOCUS** (聚焦态) | 物体检查模式。选中特定物体并居中。 | 锁定至逻辑中心 (屏幕平面)。用户旋转物体。 | **聚焦物体**: 屏幕居中，正面朝向用户。<br>**其他**: 变暗 (visualAlpha=0.05)。 | 世界网格: **可见** (变暗)。<br>虚拟鼠标: **激活** (吸附到表面/网格)。<br>切片轮廓: **可见** (若调整了深度)。 |
| **EDIT** (编辑态) | 几何修改模式。操作控制点。 | 锁定。用户修改形状。 | **聚焦物体**: 居中。<br>**其他**: 变暗。 | 世界网格: **隐藏**。<br>局部网格 (Local Grid): **可见** (跟随物体旋转)。<br>控制点: **可见**。<br>虚拟鼠标: **激活** (吸附到局部网格)。 |

### 1.2 状态流转逻辑

*   **VIEW -> FOCUS**: 触发条件：**双击 (Double Click)** 物体。
    *   **执行动作**:
        1.  保存当前物体位置 (`savePosition`) 和朝向 (`_savedFrontDirection`, `_savedUpDirection`)。
        2.  **动画**: 500ms, `Easing.easeOut`。目标位置: `calculateCenterPosition` (即 `direction.start`)。
        3.  **动画**: 旋转物体使其 `Front` 正面朝向用户 (对齐到 `-direction`)，使用 `calculateRotationFromTwoFrames` 计算最短路径。
        4.  设置 `obj.animationLock = true`。
        5.  降低其他物体的透明度 (visualAlpha: 0.05, tag: 'DIMMED')。
*   **FOCUS -> VIEW**: 触发条件：**ESC 键**。
    *   **执行动作**:
        1.  **动画**: 500ms, `Easing.easeOut`。将物体移回 `getSavedPosition()`。
        2.  **动画**: 将物体旋转回保存的朝向 (`_savedFrontDirection`, `_savedUpDirection`)。
        3.  恢复其他物体的可见度 (visualAlpha: 1.0)。
        4.  解除 `obj.animationLock`，清除 `focusedObject`。
*   **FOCUS -> EDIT**: 触发条件：**双击** (再次双击) 或特定按键。
    *   **执行动作**:
        1.  **姿态吸附**: 检查 `OrientationImpl.getNearestState`。
            *   若旋转角 > 0.01弧度: 触发 **250ms** `easeOut` 旋转动画 (`OrientationImpl.rotateObjectAroundAxis`)。
            *   路径优化: 检查四元数点积 (deltaQ.w < 0) 确保走最短路径。
        2.  **对齐平面**: 移动物体使 `center` 在视线方向上的投影深度归零 (对齐 `direction.start`)。
        3.  创建局部网格 (`ObjectFactoryImpl.createLocalGridObject`)。
        4.  显示控制点: 遍历 `controlPoints` (or slice(0,20) constructionPoints)，设置 `tag = null`，`isAttractable = true`。<br>            **注意**: Renderer 通过 `tag === 'CONTROL'` 渲染控制点白色圆环 (代码目前使用 `tag = null`)。
*   **EDIT -> FOCUS**: 触发条件：**ESC 键**。
    *   **执行动作**:
        1.  隐藏控制点 (`tag = null`，**注意**: `isAttractable` 当前未重置)。
        2.  销毁/隐藏局部网格。
        3.  显示世界网格。
        4.  状态返回至 FOCUS (保留 `focusedObject`)。

---

### 1.3 SystemState 关键字段 (Critical Fields)

> 以下字段在运行时动态使用，重构时必须保留：

#### 核心渲染/窗口
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `objects` | Array | 场景物体集合 (由 `ObjectFactoryImpl.createTestScene()` 初始化) |
| `otherObjects` | Array | 辅助物体集合 (如光源球) |
| `screenPoints` | Array | 屏幕空间点集合 (用于渲染覆盖层) |
| `hiddenWindow` | Window | 隐藏窗口 (法向量估算用) |
| `lightWindow` | Window | 光源窗口 |
| `mainWindow` | Window | 主渲染窗口 |
| `canvas` | HTMLCanvas | 主画布 |
| `ctx` | Context2D | 画布上下文 |
| `screenWidthPx` / `screenHeightPx` | number | 屏幕像素尺寸 |
| `rotationCenter` | Point | 相机旋转中心 |

#### 交互状态
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `interactionState` | string | 'VIEW' \| 'FOCUS' \| 'FOCUS_ENTERING' \| 'EDIT' \| 'EDIT_ENTERING' |
| `focusedObject` | Object \| null | 当前聚焦的物体引用 |
| `draggingObject` | Object \| null | 当前拖拽的物体引用 |
| `dragStartCenter` | Point \| null | 拖拽开始时物体中心 |
| `isDragging` | boolean | 是否正在拖拽 |
| `draggedControlPoint` | Point \| null | 当前拖拽的控制点 |

#### 输入状态
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `keys` | object | 按键状态字典 `{ [key]: boolean }`。**注意**: 键名使用 `e.key.toLowerCase()` 存储，必须小写匹配！ |
| `mouseEdge` | number | 鼠标边缘状态 (-1=左, 0=中, 1=右) |
| `lastMouseX` / `lastMouseY` | number | 上次鼠标位置 (**必须由 mousemove 全局更新**，供持续逻辑使用) |
| `longPressTimer` | Timer \| null | 长按定时器 |
| `longPressTarget` | Point \| null | 长按目标控制点 |
| `_lastRotationTime` | number | EDIT 态离散旋转冷却计时 (动态添加) |

#### FOCUS/EDIT 态专用
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `focusSliceDepth` | number | FOCUS 态切片深度 |
| `focusVirtualMouseDepth` | number | FOCUS 态虚拟鼠标深度 |
| `editDepthLayer` | number | EDIT 态深度层 |
| `_scrollAccumulator` | number | EDIT 态滚轮累积值 (动态添加) |
| `focusRotationState` | object | FOCUS 态边缘旋转状态 `{ edgeStartTime, isAtEdge, edgeDirection }` |

#### 速度/动画/物理
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `velocityState` | object | VIEW 态速度状态 `{ rotation, moveForward }` |
| `taskQueues` | object | 动画任务队列 `{ current[], next[], swap(), submit(), cancel() }` |
| `worldTime` | number | 世界时间 (ms, 来自 timestamp) |
| `lastTimestamp` | number | 上帧时间戳 |
| `ifControl` | boolean | 控制变化标记 (true 时触发渲染) |

#### 网格/虚拟鼠标
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `worldGrid` | Object | 世界网格物体引用 |
| `localGrid` | Object \| null | 局部网格物体引用 (EDIT 态) |
| `virtualMouse` | object | 虚拟鼠标状态 `{ enabled, screenPosition, snappedTo }` |
| `movementConstraints` | object | 相机移动约束 `{ initialY, range }` |

#### 摄像头系统
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `video` | HTMLVideoElement \| null | 摄像头视频元素 |
| `videoCanvas` | HTMLCanvas \| null | 摄像头处理画布 |
| `videoCtx` | Context2D \| null | 摄像头画布上下文 |
| `cameraActive` | boolean | 摄像头是否激活 |
| `lastDetectionTime` | number | 上次检测时间 |
| `detectionInterval` | number | 检测间隔 (20ms) |
| `smoothingListDis/Height/X` | Array | 摄像头平滑数据队列 |

#### 蓄力系统 (部分未使用)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `isCharging` | boolean | 是否正在蓄力 |
| `chargeStartTime` | number | 蓄力开始时间 |
| `chargePosition` | object | 蓄力位置 `{ x, y }` |
| `chargeHitPoint` | Point \| null | 蓄力命中点 |

#### 光源控制 (动态添加)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `lightAngle` | number | 光源角度 (**需确认初始化**) |
| `lightElevation` | number | 光源仰角 (**需确认初始化**) |

#### 调试
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `debugDiv` | HTMLElement | 调试信息显示元素 |
| `debugCenterPoint` | boolean | 是否调试中心点 |

---

### 1.4 CONFIG 常量字段 (Configuration Constants)

> 以下配置在初始化时设置，重构时必须保留且不可修改默认值：

| 字段 | 值 | 说明 |
| :--- | :--- | :--- |
| `screenXLengthCm` / `screenYLengthCm` | 31.0 / 17.4 | 屏幕物理尺寸 (cm) |
| `screenWidth` / `screenHeight` | 1920 / 1080 | 屏幕像素尺寸 |
| `eyeD` | 6.3 | 眼间距 (cm) |
| `displayMode` | '3D_LR' | 显示模式 ('3D_LR' \| '3D_RL' \| '2D') |
| `userEyeHeight` | 8.7 | 用户眼睛高度 (cm) |
| `screenCenterHeight` | 0 | 屏幕中心高度 (cm) |
| `userDistanceFromOrigin` | 10 | 用户到原点距离 (cm) |
| `screenDistance` | 50 | 屏幕距离 (动态计算) |
| `lightX` / `lightY` / `lightZ` | 5 / 15 / 0 | 光源位置 (cm) |
| `rotationSpeed` | 0.05 | 旋转速度 |
| `moveSpeed` | 0.5 | 移动速度 |
| `minElevation` / `maxElevation` | -π/2+0.1 / π/2-0.1 | 仰角限制 |
| `cameraControl.enabled` | false | 摄像头控制开关 |

### 1.5 模块级变量 (Module-Level Variables)

> 以下变量不在 SystemState 或 CONFIG 中，但对功能至关重要：

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `lastClickTime` | number | 上次点击时间 (用于双击检测) |
| `lastClickTarget` | any | 上次点击目标 (用于双击检测) |
| `DOUBLE_CLICK_THRESHOLD` | 300 | 双击检测阈值 (ms) |
| `C` | Classifier | 摄像头分类器实例 |
| `Renderer` | object | 渲染器对象 (含 LUT、render 方法) |
| `InputMaps` | object | 输入映射表 (VIEW/FOCUS/EDIT 态) |

### 1.6 物体动态属性 (Object Dynamic Properties)

> 以下属性在运行时动态添加到物体 (`obj`) 上，重构时必须保留：

| 属性 | 类型 | 说明 |
| :--- | :--- | :--- |
| `animationLock` | boolean | 动画锁定标志 (true 时禁止物理/输入干扰) |
| `visualAlpha` | number | 可见度 (1.0=完全可见, 0.05=变暗) |
| `frontDirection` | {x,y,z} | 物体正面朝向 |
| `upDirection` | {x,y,z} | 物体上方向 |
| `_savedFrontDirection` | {x,y,z} | 进入 FOCUS 时保存的正面朝向 |
| `_savedUpDirection` | {x,y,z} | 进入 FOCUS 时保存的上方向 |
| `_currentOrientationState` | object | EDIT 态当前姿态状态 (`{ type, q }`) |
| `_needsRefit` | boolean | 控制点修改后需要重建形状 |
| `quaternion` | {w,x,y,z} | 物体旋转四元数 |
| `savePosition()` | function | 保存当前位置 (方法) |
| `getSavedPosition()` | function | 获取保存的位置 (方法) |
| `clearSavedPosition()` | function | 清除保存的位置 (方法) |
| `physics` | object | 物理状态配置 `{ enabled: boolean, ... }` |
| `displayPoints` | Array | 显示点集合 (优先用于渲染) |
| `constructionPoints` | Array | 构造点集合 (displayPoints 为空时回退使用) |
| `controlPoints` | Array | 控制点集合 (EDIT 态编辑用) |
| `center` | {x,y,z} | 物体中心坐标 |
| `centerPoint` | Point | 物体中心点对象 (可选，调试用) |

### 1.7 关键调试日志 (Key Debug Logs)
> 重构应保留以下关键操作的日志输出 (或等效的 Logger 实现)：
*   状态转换 (VIEW→FOCUS, FOCUS→EDIT, etc.)
*   控制点增删
*   切片层级跳转
*   蓄力/冲量释放

### 1.8 点标签系统 (Point Tag System)

> 以下标签用于标识点的类型和渲染行为：

| 标签 | 用途 | 设置位置 |
| :--- | :--- | :--- |
| `'CONTROL'` | 控制点 (白色圆环渲染) | **应该**由 `showControlPoints` 设置，**但当前设为 null (Bug)** |
| `'SLICE_CONTOUR'` | 切片轮廓点 | `updateSliceContour` |
| `'VIRTUAL_MOUSE'` | 虚拟鼠标点 | `updateVirtualMouse` |
| `'DIMMED'` | 变暗的物体点 | `enterFocusState` (其他物体) |
| `'LOCAL_GRID'` | 局部网格点 | `ObjectFactoryImpl.createLocalGridObject` |
| `null` | 默认/清除 | 多处 |

> 点的 `space` 属性：
> - `'screen'` - 屏幕空间点 (如虚拟鼠标、切片轮廓)
> - 无/undefined - 世界空间点 (默认)

> 点的坐标属性 (用于 3D 立体渲染)：
> - `x/y/z` - 世界坐标
> - `xM/yM` - 屏幕中心坐标 (2D 模式)
> - `xL/yL` - 左眼屏幕坐标 (3D 模式)
> - `xR/yR` - 右眼屏幕坐标 (3D 模式)
> - `light` - 光照强度 (0-1)
> - `dis` - 到相机的距离

---

## 2. 输入处理规范 (Input Handling Specification)


重构必须通过纯函数调用来实现 `InputHandlerImpl`，并映射以下需求。任何有输入活动时，`SystemState` 的 `ifControl` 标记必须设为 true。

### 2.1 VIEW 态输入

| 输入 | 动作 | 参数/细节 |
| :--- | :--- | :--- |
| **滚轮 (Wheel)** | 前后移动相机 | 速度: `CONFIG.moveSpeed * 2`。<br>范围: `CONFIG.screenXLengthCm * 0.5`。<br>约束: `initialY` ± range。 |
| **左键按下 (Mouse Down)** | **开始拖拽物体** | **仅响应 `e.button === 0` (左键)**。<br>条件: 虚拟鼠标吸附到 `isObjectCenter` 点。<br>效果: 设置 `draggingObject`。 |
| **鼠标移动 (Mouse Move)** | **拖拽物体** | 条件: `draggingObject` 已设置。<br>逻辑: 将物体中心吸附到光标下的世界网格点。<br>冲突检测: `isGridPointOccupied` (容差: 0.1cm)。 |
| **左键抬起 (Mouse Up)** | **全局清理** | 1. 清除 `draggedControlPoint` 并调用 `updateControlPointsDisplay`。<br>2. 清除 `longPressTimer` 和 `longPressTarget`。<br>3. 若 `draggingObject` 存在，将物体放置到吸附点并清除。<br>4. 设置 `isDragging = false`。 |
| **双击 (Double Click)** | **进入 FOCUS 态** | 目标: 虚拟鼠标下的物体 `snapped.ownerObject`。 |
| **按键 (WASD/Arrows)** | **相机 / 光源控制** | `Z/X/C` (左转), `B/N/M` (右转)。<br>`F/G` (前进), `V` (后退)。<br>`ArrowLeft/Right` (lightAngle ±)。<br>`ArrowUp/Down` (lightElevation ±, 受 minElevation/maxElevation 限制)。 |
| **鼠标边缘 (Mouse Edge)** | **屏幕边缘旋转** | 光标 `clientX <= 0` 或 `clientX >= screenWidth - 1` 时触发自动旋转 (VIEW态)。 |
| **P 键** | **切换摄像头控制** | 切换 `CONFIG.cameraControl.enabled`，开启时调用 `initCamera()`。 |
| **ESC 键** | **重置相机距离** | 若无动画进行中，将相机位置 (`capital`) 重置回 `initialY`。<br>函数: `resetCameraDistance`。 |

### 2.2 FOCUS 态输入

| 输入 | 动作 | 参数/细节 |
| :--- | :--- | :--- |
| **滚轮 (Wheel)** | **切片深度调节** | 步长: `±0.5` (deltaY > 0 则 +0.5，否则 -0.5)。<br>修改: `focusSliceDepth` & `focusVirtualMouseDepth`。<br>视觉: `updateSliceContour`。 |
| **鼠标边缘** | **持续旋转** | **依赖**: `lastMouseX/Y` (非事件触发，而是持续查询)。<br>**阈值**: `edgeThreshold = 20px`。<br>**对数加速** (`accelRate = 3.0`, `maxSpeed = 0.03`)。<br>状态: `focusRotationState { edgeStartTime, isAtEdge, edgeDirection: {h, v} }`。 |
| **双击 (Double Click)** | **进入 EDIT 态** | 触发: `enterEditState()` (依赖 `focus_click` 目标记录)。 |
| **ESC 键** | **返回 VIEW 态** | 触发: `exitFocusState()`。 |

### 2.3 EDIT 态输入

| 输入 | 动作 | 参数/细节 |
| :--- | :--- | :--- |
| **鼠标点击** | **选择控制点** | 半径: 15px (屏幕像素)。`findControlPointAt`。 |
| **左键拖拽** | **移动控制点** | `scale = 0.05`。<br>修改点的坐标 (`p.x` += dx * scale, `p.z` -= dy * scale)。<br>设置 `obj._needsRefit = true`。 |
| **双击 (Double Click)** | **新增控制点** | 点击空白处 (`edit_empty`) 触发 `addControlPointAt`。 |
| **长按 (Long Press)** | **删除控制点** | 时长: **1000ms**。<br>在控制点上长按: `deleteControlPoint`。<br>清除 `longPressTarget`、`draggedControlPoint`。 |
| **滚轮 (Wheel)** | **并发执行 (Concurrent)** | **动作 A**: 切换深度层 (`editDepthLayer` ±1, updateDisplay)。<br>**动作 B**: 切片滚动 (`accum += deltaY`, 阈值300触发 `animateSliceTransition`)。<br>**注意**: 当前代码同时监听了两个 wheel 事件，二者同时触发。 |
| **按键 (WASD/QE)** | **离散旋转** | `WASD/QE` 触发离散旋转 (使用 `OrientationImpl.transition`)。<br>**冷却时间**: 300ms (`_lastRotationTime`)。 |
| **ESC 键** | **返回 FOCUS 态** | 触发: `exitEditState()`。 |

---

## 3. 关键算法与逻辑 (Critical Algorithms & Logic)

以下逻辑块较为复杂，移植时必须并在保持原有行为。

### 3.1 虚拟鼠标与视差 (Virtual Mouse & Disparity)
*   **逻辑**: 基于相对于屏幕平面的 Z-depth 计算 `perspectiveScale`。
*   **参数**: `worldRadiusCm = 0.5` (直径 1cm)。 `numPoints = 24`。
*   **立体模式**: `baseDis = screenDistance - userDistanceFromOrigin`。`disparity = halfEyeD * (1 - baseDis / vmDepth) * DPI`。
*   **吸附 (Snapping)**:
    *   **VIEW**: 遍历并过滤 `isGridPointOccupied` (tolerance 0.1)。
    *   **EDIT**: 过滤 `p.tag === 'LOCAL_GRID'`。

### 3.2 冲量/蓄力系统 (Impulse / Charging)
*   **实现**: `calculateImpulse` 函数。
*   **公式**: `maxDuration = 2000`; `t = (duration - 100) / (maxDuration - 100)`。 (100ms - 2000ms 范围)。
*   **平滑**: `impulse = smoothstep(t) = t*t*(3-2t)`。
*   **状态**: 目前仅有计算函数，业务逻辑未挂载 (Dead Code 待修复/移除)。

### 3.3 对数平滑运动 (Logarithmic Motion)
*   **函数**: `updateLogVelocity(state, dt, k=3.0)`。
*   **加速公式**: `current += (target * factor - current) * (1 - exp(-k * dt / 1000))`。
*   **衰减公式**: 当 `target === 0` 时，`current *= exp(-k * dt / 1000)`，且 `|current| < 0.001` 时归零。
*   **应用**: 用于相机移动和边缘旋转的平滑过渡。

### 3.4 局部网格与切片 (Local Grid & Slicing)
*   **创建**: `ObjectFactoryImpl.createLocalGridObject(obj)`。
*   **层级**: 由 `LocalGridConfig` 决定 `layerSpacing`。
*   **切片滚轮**: 累积 `deltaY`，每 300 触发一次层级跳转。跳转时移动物体 `center`。

---

⚠️ 阶段裁决：
- requestAnimationFrame → TaskSystem 的迁移
- 属于 Phase 3
- Phase 2 仅做“标记 + 保留”
- 禁止提前修改实现

## 4. 实施约束 (Implementation Constraints - "Must Nots")

1.  **禁止独立的 `requestAnimationFrame`**:
    *   现有代码中 `animateSliceTransition` 和 `animateRotation` 使用了独立的 `rAF` 循环。
    *   **重构要求**: 必须转换为 `AnimationImpl.createTask` 并提交给 `TaskSystem` 统一管理。
2.  **输入映射器中禁止状态逻辑**:
    *   `InputHandlerImpl` 应仅负责 "事件 -> 函数指令" 的映射。它**不应**在处理函数内部包含 `if (state === VIEW)` 这样的状态判断逻辑 (应由多态或独立的处理器处理)。
3.  **禁止直接字符串反射**:
    *   避免使用魔法字符串如 `obj['@focused']`。请使用显式的属性或 WeakMap。
4.  **保持几何一致性**:
    *   旋转物体时，`frontDirection` 和 `upDirection` 必须与 `displayPoints` 同步旋转。`LocalGrid` 严格依赖这些向量。
5.  **同步 `centerPoint`**:
    *   在移动或旋转物体 (`moveObjectTo`, `rotateFocusedObject`, `applyQuaternionToPoints`) 时，若物体存在 `centerPoint` 属性，必须同步更新其坐标。这是调试和特定渲染所需的。

## 5. 风险登记 (Risk Register - Top 3)

1.  **循环依赖 (`SystemState`)**: `SystemState` 目前是一个被到处引用的上帝对象。
    *   **缓解措施**: 立即将 `SystemState` 提取为 `manage/SystemState.js` (纯数据模块)。
2.  **动画/物理冲突**: 物理引擎每帧运行 (`physicsStep`)，动画系统也会修改位置。
    *   **缓解措施**: 物理引擎必须严格遵守 `obj.animationLock` 标志。
3.  **渲染循环 GC 压力**: `Renderer.forEachNeighbor` 使用回调函数以避免数组分配。
    *   **缓解措施**: 在新的 `RenderPipelineImpl` 中必须保留这种"零分配 (Zero-Allocation)"模式。

---

## 6. 补充验收项 (Additional Acceptance Criteria)

### 6.1 窗口 resize 处理

*   **事件**: `window.addEventListener("resize", ...)`
*   **行为**:
    1.  调用 `resizeCanvas()`（修改 canvas 尺寸）
    2.  重建 `hiddenWindow` 和 `lightWindow`
    3.  调用 `mainWindow.resizeRefresh()` 更新主窗口
*   **验收**: 调整浏览器窗口大小后，渲染正常无错误

### 6.2 过渡态定义

| 过渡态 | 起点 | 终点 | 行为 |
| :--- | :--- | :--- | :--- |
| `FOCUS_ENTERING` | VIEW | FOCUS | 动画进行中，所有输入被忽略 |
| `EDIT_ENTERING` | FOCUS | EDIT | 姿态吸附动画进行中，所有输入被忽略 |

### 6.3 已知 Bug / 待修复项

| Bug | 代码位置 | 说明 |
| :--- | :--- | :--- |
| **控制点 tag 逻辑矛盾** | L2250, L2324 | `showControlPoints` 设置 `tag = null`，但 `findControlPointAt` 检查 `p.tag !== 'CONTROL'` 会跳过。**控制点永远无法被选中！** |
| **addControlPointAt 坐标简化** | L2362-2363 | 使用固定 scale `0.02`，未考虑相机距离 |

### 6.4 未使用代码清单 (Dead Code)

| 函数 | 代码位置 | 说明 |
| :--- | :--- | :--- |
| `rotateEditObject` | L2284-2309 | 未在 InputMaps 中调用 |
| `findClickedObjectCenter` | L1946-1977 | 未被任何代码调用 |
| `onMouseClick` | L1940-1944 | 未绑定到事件 |
| `createObjectFromCommand` | L1269-1294 | 预留命令接口，未使用 |
| `updateFromCamera` | L1295-1297 | 预留摄像头接口，未使用 |
| `findSurfaceHit` | L1803-1832 | 查找表面命中点，未调用 |
| `applyTouchImpulse` / `applyTouchImpulseSimple` | L1840-1936 | 虽被 mouseup 调用，但 `isCharging` 从未被设为 true |
| `initCameraDisplay` | L2422-2447 | 摄像头显示初始化，未调用 |
| `updateCameraDisplay` | L2448-2450 | 摄像头显示更新，未调用 |

### 6.5 关键核心函数清单 (Must Preserve)

> 重构后必须保留的核心函数及其职责：

| 函数 | 职责 |
| :--- | :--- |
| `init()` | 初始化画布、窗口、世界网格、事件监听 |
| `gameLoop(timestamp)` | 主循环，调度所有子系统 |
| `render()` | 调用 updateCamera 和 Renderer |
| `updateCamera()` | 调用 mainWindow.calculate() |
| `updateVirtualMouse(x, y)` | 更新虚拟鼠标位置和吸附 |
| `updateLocalGrid()` | 同步局部网格位置和旋转 |
| `enterFocusState(obj)` | VIEW→FOCUS 状态转换 |
| `exitFocusState()` | FOCUS→VIEW 状态转换 |
| `enterEditState()` | FOCUS→EDIT 状态转换 |
| `exitEditState()` | EDIT→FOCUS 状态转换 |
| `moveObjectTo(obj, x, y, z)` | 移动物体及其所有点 |
| `userRotate(angle)` | 绕中心旋转相机 |

### 6.6 游戏循环关键调用顺序

重构后必须保持 `gameLoop` 中以下调用顺序不变：

```
1. handleInput()
2. applyVelocities(dt)
3. processTaskQueue(worldTime, dt)
4. _needsRefit 检查
5. physicsStep(dt)
6. updateLocalGrid()
7. drawCameraFeedOnMainCanvas()
8. 条件渲染: updateLight() → updateVisibleReflection() → render()
9. requestAnimationFrame(gameLoop)
```

### 6.7 外部依赖清单

| 模块 | 来源 | 用途 |
| :--- | :--- | :--- |
| `Window` | `base/Window.js` | 视窗/投影计算 |
| `Object` | `base/Object.js` | 场景物体 |
| `Point` | `base/Point.js` | 3D 点 |
| `Vector` | `base/Vector.js` | 方向向量 |
| `Classifier` | `math/Classifier.js` | 摄像头图像分类 (C) |
| `StyleImpl` | `manage/StyleImpl.js` | LUT 颜色表 |
| `AnimationImpl` | `manage/AnimationImpl.js` | 动画任务系统 |
| `ObjectFactoryImpl` | `manage/ObjectFactoryImpl.js` | 物体工厂 |
| `OrientationImpl` | `manage/OrientationImpl.js` | 姿态/旋转计算 |

#### Window 类关键接口
> 重构代码依赖 `mainWindow` 的以下属性/方法：

| 属性/方法 | 说明 |
| :--- | :--- |
| `capital` | 相机位置 (Point) |
| `direction` | 视线方向 (Vector, 含 start/x/y/z) |
| `DPIx` | 水平 DPI (视差计算用) |
| `grid` | 空间网格 (二维数组) |
| `gridsize` | 网格单元大小 |
| `windowObjects` | 当前窗口物体列表 |
| `calculate(...)` | 投影计算 |
| `findNearestPoint(...)` | 查找最近点 |
| `calculateBasePoint(...)` | 计算基准点 |
| `resizeRefresh(...)` | 窗口尺寸更新 |
| `virtualCursor` | 虚拟光标对象 (含 `setSnappedPoint()`) |

### 6.8 浏览器事件配置

> 以下事件配置对正确行为至关重要：

| 事件 | 配置 | 原因 |
| :--- | :--- | :--- |
| `wheel` | `{ passive: false }` | 允许 `e.preventDefault()` 阻止页面滚动 |
| 所有 `wheel` 处理函数 | 开头调用 `e.preventDefault()` | 阻止浏览器默认滚动 |
