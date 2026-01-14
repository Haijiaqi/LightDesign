# main.js 代码拆分方案 V1

**版本**: 1.0  
**日期**: 2026-01-14  
**状态**: 待评审

---

## 1. 概述

### 1.1 目标
- 将 `main.js` (5169行) 拆分为更易维护的模块
- 拆出无状态/弱状态部分为 `XxxImpl.js`
- 复用 `math/` 和 `base/` 已有实现
- 保持 `SystemState` 全局对象模式
- 保持 `CONFIG` 在 main.js 中

### 1.2 拆分后预期规模

| 文件 | 拆分前 | 拆分后 |
|------|--------|--------|
| main.js | 5169 行 | ~3400 行 |
| ObjectFactoryImpl.js | - | ~550 行 |
| OrientationImpl.js | - | ~800 行 |
| **总计** | 5169 行 | ~4750 行 |

> 代码总量略有增加（约50行声明和导入），但 main.js 减少约 34%

---

## 2. 底层模块调查结果

### 2.1 math/Matrix.js 分析

**现有功能**:
- `Matrix` 类：矩阵基本操作
- `householderQR()`: Householder QR 分解
- `givensQR()`: Givens QR 分解
- `solveFromQR()`: QR 回代求解

**缺失功能** (OrientationImpl 需要):
- ❌ 四元数乘法 (`multiplyQuaternion`)
- ❌ 欧拉角转四元数 (`eulerToQuaternion`)
- ❌ 四元数球面插值 (`slerp`)
- ❌ 四元数归一化 (`normalize`)
- ❌ 旋转矩阵转四元数 (`matrixToQuaternion`)

**结论**: Matrix.js 专注于线性代数求解，无四元数支持，**无法复用**

### 2.2 base/GeometryImpl.js 分析

**现有功能**:
- 气泡填充算法 (`generateBubblePacking`)
- 拓扑构建 (`buildSurfaceTopology`, `buildInternalTopology`)
- 包围盒/中心计算 (`computeBoundingBox`, `computeCenter`)
- 黄金螺旋采样 (`goldenSpiralSampling`)

**向量运算** (可复用):
- ✅ 叉积计算 (分散在 `_isTriangleOutwardFacing` 内部)
- ✅ 点积计算 (分散在多个函数内)
- ❌ 没有独立的向量工具函数导出

**缺失功能**:
- ❌ 四元数相关函数
- ❌ 罗德里格斯旋转公式
- ❌ 欧拉角转换

**结论**: GeometryImpl 专注于几何拓扑，向量运算未抽取为独立函数，**无法直接复用**

### 2.3 base/Vector.js 分析

**现有功能**:
- `Vector` 类：有状态的几何直线对象（带 `start` 起点）
- 已有方法: `cross()`, `projL()`, `addV()`, `timesLV()`, `getPoint()`
- 已有属性: `l` (长度), `ll` (长度平方), `dirAngle`

**缺失功能** (可扩展):
- ⚠️ 纯点积方法 (`dot()`) - 现有 `projL()` 返回投影长度
- ⚠️ 不可变归一化 (`normalized()`) - 现有 `normalInit()` 会修改自身
- ⚠️ 动态长度计算 (`length()`) - 现有 `this.l` 仅在构造时更新

**结论**: Vector.js 是向量工具的正确归属地，建议扩展实例方法

### 2.4 最终策略

| 功能 | 当前处理方式 | 未来优化（实施底层增扩后） |
|------|-------------|--------------------------|
| 四元数乘法、归一化、slerp | OrientationImpl 自包含 | 调用 `QuaternionUtils` |
| 欧拉角转四元数 | OrientationImpl 自包含 | 调用 `QuaternionUtils` |
| 旋转矩阵转四元数 | OrientationImpl 自包含 | 调用 `QuaternionUtils` |
| 罗德里格斯旋转 | OrientationImpl 自包含 | 调用 `QuaternionUtils.rotateVector` |
| 向量点积/归一化 | 内联实现 | 调用 `Vector` 实例方法 |

---

## 3. 新增文件规范

### 3.1 manage/ObjectFactoryImpl.js

**职责**: 几何对象创建 + 局部格网系统

**依赖**:
```javascript
import { Point } from "../base/Point.js";
import { Object } from "../base/Object.js";
```

**导出**:
```javascript
export class ObjectFactoryImpl {
  // === 基础几何体创建 ===
  static createCube(size, pointsPerFace, x, y, z, alpha, ifEntity)
  static createPlane(width, height, pointsPerFace, x, y, z, alpha, ifEntity)
  static createSphere(x0, y0, z0, radius, numPoints)
  static createSphereWithMeridians(x0, y0, z0, radius, numMeridians, pointsPerCircle)
  
  // === 特殊对象创建 ===
  static createWorldGrid(spacing, radius)
  static createIntegerGridObject(cx, cy, cz, size, spacing)
  static createTestScene()
  
  // === 局部格网系统 ===
  static LocalGridConfig = { ... }  // 配置对象
  static createLocalGridObject(targetObj)
}
```

**迁移内容** (从 main.js):

| 行号范围 | 函数/内容 |
|----------|-----------|
| 69-152 | `createCube()` |
| 153-208 | `createPlane()` |
| 209-223 | `createSphere()` |
| 225-285 | `createSphereWithMeridians()` |
| 293-323 | `createWorldGrid()` |
| 337-375 | `createIntegerGridObject()` |
| 381-387 | `createTestScene()` |
| 3359-3395 | `LocalGridConfig` 配置对象 |
| 3401-3505 | `createLocalGridObject()` |

**预估行数**: ~550 行

---

### 3.2 manage/OrientationImpl.js

**职责**: 姿态/旋转计算系统 (96态)

**依赖**:
```javascript
// 无外部依赖，全自包含
```

**导出**:
```javascript
export class OrientationImpl {
  // === 姿态状态管理 ===
  static STATES = []           // 当前视窗的96个标准姿态
  static _lastViewDir = null   // 缓存
  
  // === 视窗相关姿态计算 ===
  static computeStatesForView(mainWindowDirection)
  static _computeStatesWithViewBasis(viewX, viewY, viewZ)
  
  // === 姿态匹配与转换 ===
  static getNearestState(currentQ, allowedTypes, requireRolled, requireVisual)
  static transition(key, obj, mainWindowDirection)
  
  // === 四元数工具 (自包含) ===
  static eulerToQuaternion(pitch, yaw, roll)
  static slerp(qa, qb, t)
  static normalize(q)
  static _multiplyQuaternion(a, b)
  static _matrixToQuaternion(xAxis, yAxis, zAxis)
  
  // === 向量-四元数转换 ===
  static getQuaternionFromVectors(frontDir, upDir)
  static updateObjectOrientation(obj, q)
  
  // === 物体旋转工具 ===
  static rotateObjectAroundAxis(obj, axis, angle)
  static rotateObjectTowardsFront(obj, targetFront, amount)
  static applyQuaternionToPoints(obj)
  static applyQuaternion(v, q)
  
  // === 吸附与对齐 ===
  static snapToNearestOrientation(obj, mainWindowDirection)
  static snapToNearestLayer(obj, mainWindow, LocalGridConfig)
}
```

**迁移内容** (从 main.js):

| 行号范围 | 函数/内容 |
|----------|-----------|
| 2471-2541 | `rotateObjectTowardsFront()` |
| 2546-2602 | `rotateObjectAroundAxis()` |
| 2608-2644 | `applyQuaternionToPoints()` |
| 3580-3591 | `applyQuaternion()` 辅助函数 |
| 3645-3685 | `animateRotation()` (部分逻辑) |
| 3697-3742 | `snapToNearestLayer()` |
| 3748-4524 | `OrientationUtils` 全部内容 |
| 4531-4682 | `snapToNearestOrientation()` |

**预估行数**: ~800 行

---

## 4. main.js 修改计划

### 4.1 新增导入
```javascript
// 文件顶部新增
import { ObjectFactoryImpl } from "./manage/ObjectFactoryImpl.js";
import { OrientationImpl } from "./manage/OrientationImpl.js";
```

### 4.2 替换调用方式

| 原调用 | 新调用 |
|--------|--------|
| `createCube(...)` | `ObjectFactoryImpl.createCube(...)` |
| `createSphere(...)` | `ObjectFactoryImpl.createSphere(...)` |
| `createWorldGrid(...)` | `ObjectFactoryImpl.createWorldGrid(...)` |
| `createLocalGridObject(obj)` | `ObjectFactoryImpl.createLocalGridObject(obj)` |
| `LocalGridConfig.xxx` | `ObjectFactoryImpl.LocalGridConfig.xxx` |
| `OrientationUtils.xxx` | `OrientationImpl.xxx` |
| `rotateObjectAroundAxis(...)` | `OrientationImpl.rotateObjectAroundAxis(...)` |
| `snapToNearestOrientation(obj)` | `OrientationImpl.snapToNearestOrientation(obj, SystemState.mainWindow.direction)` |
| `snapToNearestLayer(obj)` | `OrientationImpl.snapToNearestLayer(obj, SystemState.mainWindow, ObjectFactoryImpl.LocalGridConfig)` |

### 4.3 保留在 main.js 的内容

- `CONFIG` 配置对象
- `SystemState` 全局状态
- 所有事件监听器 (`setupEventListeners`)
- 状态机函数 (`enterFocusState`, `exitFocusState`, `enterEditState`, `exitEditState`)
- 渲染系统 (`render`, `renderScreenPoints`, `renderScreenOverlay`)
- 输入处理 (`handleInput`, `handleFocusEdgeRotation`)
- 虚拟鼠标系统 (`updateVirtualMouse`, `findNearestAttractableExpanding`)
- 任务队列 (`processTaskQueue`)
- 物理步进 (`physicsStep`)
- 主循环 (`gameLoop`)
- 摄像头处理 (`initCamera`, `processCamera`)
- 动画辅助 (`animateSliceTransition`)
- EDIT 态操作 (`showControlPoints`, `moveControlPoint`, etc.)

---

## 5. 接口设计细节

### 5.1 OrientationImpl 视窗参数传递

为避免 OrientationImpl 直接访问 `SystemState`，所有需要视窗信息的函数都接收参数：

```javascript
// 原 main.js 调用方式
OrientationUtils.computeStatesForView()

// 新调用方式（传入视窗方向）
OrientationImpl.computeStatesForView(SystemState.mainWindow.direction)

// 原 main.js 调用方式
OrientationUtils.transition(key, obj)

// 新调用方式
OrientationImpl.transition(key, obj, SystemState.mainWindow.direction)
```

### 5.2 LocalGridConfig 访问

```javascript
// 原方式
LocalGridConfig.getLayerSpacingForOrientation(type)

// 新方式（通过 ObjectFactoryImpl 访问）
ObjectFactoryImpl.LocalGridConfig.getLayerSpacingForOrientation(type)
```

### 5.3 跨模块依赖

```
main.js
├── imports ObjectFactoryImpl (创建对象)
├── imports OrientationImpl (旋转计算)
│
ObjectFactoryImpl.js
├── imports Point, Object (base)
│
OrientationImpl.js
└── 无外部依赖 (自包含四元数工具)
```

---

## 6. 底层类修改增扩方案（暂不实施）

### 6.1 设计哲学

| 模块 | 定位 | 操作 |
|------|------|------|
| `base/Vector.js` | 三维几何向量对象（有状态，带起点） | ✅ 扩展实例方法 |
| `math/QuaternionUtils.js` | 四元数纯数学工具（无状态） | ✅ **新建** |
| `math/Matrix.js` | 线性代数求解器（QR分解） | ❌ 不增扩 |
| `base/GeometryImpl.js` | 几何拓扑构建器 | ❌ 不增扩 |

**原则**: 各司其职，逻辑清爽

---

### 6.2 建议扩展 base/Vector.js

**现有设计分析**:
- `Vector` 是有状态的几何直线类（带 `start` 起点）
- 已有方法: `cross()`, `projL()`, `addV()`, `timesLV()`, `getPoint()`
- 已有属性: `l` (长度), `ll` (长度平方), `dirAngle`

**建议新增实例方法**:

```javascript
export class Vector {
  // ... 现有代码 ...
  
  /**
   * 点积（与另一个向量或 {x,y,z} 对象）
   * 注: 现有 projL() 返回的是投影长度，此方法返回纯点积值
   * @param {Vector|{x,y,z}} v
   * @returns {number}
   */
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  
  /**
   * 归一化（返回新向量，不修改自身）
   * 注: 现有 normalInit() 会修改自身，此方法为不可变版本
   * @returns {Vector}
   */
  normalized() {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (len < 1e-10) return new Vector(0, 0, 0);
    return new Vector(this.x / len, this.y / len, this.z / len);
  }
  
  /**
   * 动态计算长度
   * 注: 现有 this.l 仅在构造/normalInit时更新，此方法确保实时准确
   * @returns {number}
   */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  
  /**
   * 动态计算长度平方（避免开方，用于比较）
   * @returns {number}
   */
  lengthSquared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
}
```

**兼容性**: 新增方法，不破坏现有 API

---

### 6.3 建议新建 math/QuaternionUtils.js

**定位**: 四元数纯数学工具类（全静态方法，无状态）

**设计**: 罗德里格斯旋转通过四元数实现（不单独实现公式）

```javascript
/**
 * QuaternionUtils - 四元数数学工具
 * 
 * 四元数格式: { w, x, y, z }
 * 向量格式: { x, y, z }
 * 
 * 约定:
 * - 四元数乘法顺序: multiply(a, b) = a * b (先 b 后 a)
 * - 欧拉角顺序: YXZ (Yaw-Pitch-Roll)
 * - 旋转方向: 右手法则
 */
export class QuaternionUtils {
  
  // =====================
  // 创建
  // =====================
  
  /** 单位四元数 */
  static identity() {
    return { w: 1, x: 0, y: 0, z: 0 };
  }
  
  /**
   * 从轴角创建四元数
   * @param {{x,y,z}} axis - 旋转轴（需归一化）
   * @param {number} angle - 旋转角度（弧度）
   */
  static fromAxisAngle(axis, angle) {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);
    return {
      w: Math.cos(halfAngle),
      x: axis.x * s,
      y: axis.y * s,
      z: axis.z * s
    };
  }
  
  /**
   * 从欧拉角创建四元数 (YXZ 顺序)
   * @param {number} pitch - 绕 X 轴旋转（度）
   * @param {number} yaw - 绕 Y 轴旋转（度）
   * @param {number} roll - 绕 Z 轴旋转（度）
   */
  static fromEulerYXZ(pitch, yaw, roll) {
    const c1 = Math.cos(pitch * Math.PI / 360);
    const s1 = Math.sin(pitch * Math.PI / 360);
    const c2 = Math.cos(yaw * Math.PI / 360);
    const s2 = Math.sin(yaw * Math.PI / 360);
    const c3 = Math.cos(roll * Math.PI / 360);
    const s3 = Math.sin(roll * Math.PI / 360);
    return {
      w: c1 * c2 * c3 - s1 * s2 * s3,
      x: s1 * c2 * c3 + c1 * s2 * s3,
      y: c1 * s2 * c3 - s1 * c2 * s3,
      z: c1 * c2 * s3 + s1 * s2 * c3
    };
  }
  
  /**
   * 从旋转矩阵创建四元数		
   * @param {{x,y,z}} xAxis - 矩阵第一列（新 X 轴）
   * @param {{x,y,z}} yAxis - 矩阵第二列（新 Y 轴）
   * @param {{x,y,z}} zAxis - 矩阵第三列（新 Z 轴）
   */
  static fromRotationMatrix(xAxis, yAxis, zAxis) {
    // 矩阵列向量 -> 四元数
    const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
    const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
    const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;
    
    const trace = m00 + m11 + m22;
    let w, x, y, z;
    
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      w = 0.25 / s;
      x = (m21 - m12) * s;
      y = (m02 - m20) * s;
      z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
      w = (m21 - m12) / s;
      x = 0.25 * s;
      y = (m01 + m10) / s;
      z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
      w = (m02 - m20) / s;
      x = (m01 + m10) / s;
      y = 0.25 * s;
      z = (m12 + m21) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
      w = (m10 - m01) / s;
      x = (m02 + m20) / s;
      y = (m12 + m21) / s;
      z = 0.25 * s;
    }
    
    return QuaternionUtils.normalize({ w, x, y, z });
  }
  
  // =====================
  // 运算
  // =====================
  
  /**
   * 四元数乘法 a * b
   * 语义: 先应用 b，再应用 a
   */
  static multiply(a, b) {
    return {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    };
  }
  
  /** 共轭 */
  static conjugate(q) {
    return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
  }
  
  /** 逆 (假设已归一化) */
  static inverse(q) {
    return QuaternionUtils.conjugate(q);
  }
  
  /** 归一化 */
  static normalize(q) {
    const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
    if (len < 1e-10) return { w: 1, x: 0, y: 0, z: 0 };
    return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
  }
  
  /**
   * 球面线性插值 (Slerp)
   * @param {number} t - 插值参数 [0, 1]
   */
  static slerp(qa, qb, t) {
    let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
    
    // 走短路径
    let sign = 1;
    if (dot < 0) {
      dot = -dot;
      sign = -1;
    }
    
    // 接近时用线性插值
    if (dot > 0.9995) {
      const result = {
        w: qa.w + t * (sign * qb.w - qa.w),
        x: qa.x + t * (sign * qb.x - qa.x),
        y: qa.y + t * (sign * qb.y - qa.y),
        z: qa.z + t * (sign * qb.z - qa.z)
      };
      return QuaternionUtils.normalize(result);
    }
    
    const theta_0 = Math.acos(dot);
    const theta = theta_0 * t;
    const sin_theta = Math.sin(theta);
    const sin_theta_0 = Math.sin(theta_0);
    
    const s0 = Math.cos(theta) - dot * sin_theta / sin_theta_0;
    const s1 = sin_theta / sin_theta_0;
    
    return {
      w: s0 * qa.w + s1 * sign * qb.w,
      x: s0 * qa.x + s1 * sign * qb.x,
      y: s0 * qa.y + s1 * sign * qb.y,
      z: s0 * qa.z + s1 * sign * qb.z
    };
  }
  
  // =====================
  // 应用
  // =====================
  
  /**
   * 旋转向量 (罗德里格斯旋转的四元数实现)
   * @param {{x,y,z}} v - 输入向量
   * @param {{w,x,y,z}} q - 旋转四元数
   * @returns {{x,y,z}} 旋转后的向量
   */
  static rotateVector(v, q) {
    // v' = q * v * q^(-1)
    // 优化实现，避免完整四元数乘法
    const ix = q.w * v.x + q.y * v.z - q.z * v.y;
    const iy = q.w * v.y + q.z * v.x - q.x * v.z;
    const iz = q.w * v.z + q.x * v.y - q.y * v.x;
    const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    
    return {
      x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
    };
  }
  
  /**
   * 绕轴旋转向量（罗德里格斯公式的封装）
   * @param {{x,y,z}} v - 输入向量
   * @param {{x,y,z}} axis - 旋转轴（需归一化）
   * @param {number} angle - 旋转角度（弧度）
   * @returns {{x,y,z}}
   */
  static rotateVectorAroundAxis(v, axis, angle) {
    const q = QuaternionUtils.fromAxisAngle(axis, angle);
    return QuaternionUtils.rotateVector(v, q);
  }
  
  /**
   * 提取轴角
   * @returns {{ axis: {x,y,z}, angle: number }}
   */
  static toAxisAngle(q) {
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, q.w)));
    const sinHalf = Math.sin(angle / 2);
    
    if (Math.abs(sinHalf) < 1e-10) {
      return { axis: { x: 0, y: 0, z: 1 }, angle: 0 };
    }
    
    return {
      axis: { x: q.x / sinHalf, y: q.y / sinHalf, z: q.z / sinHalf },
      angle: angle
    };
  }
}
```

---

### 6.4 不增扩的模块

| 模块 | 原因 |
|------|------|
| `math/Matrix.js` | 专注 QR 分解与线性求解，与旋转/四元数语义不同 |
| `base/GeometryImpl.js` | 专注几何拓扑构建，向量工具应归属 Vector.js |

---

### 6.5 修改优先级

| 优先级 | 建议 | 影响范围 | 工作量 |
|--------|------|----------|--------|
| **高** | 新建 `math/QuaternionUtils.js` | OrientationImpl 可直接调用 | ~200 行 |
| **中** | 扩展 `base/Vector.js` | 多模块可复用 | ~30 行 |

---

### 6.6 实施后的模块依赖

实施底层增扩后，OrientationImpl 可简化为：

```javascript
// 实施前: OrientationImpl 自包含四元数工具
export class OrientationImpl {
  static eulerToQuaternion(...) { /* 自包含实现 */ }
  static slerp(...) { /* 自包含实现 */ }
  // ...
}

// 实施后: OrientationImpl 调用 QuaternionUtils
import { QuaternionUtils } from "../math/QuaternionUtils.js";

export class OrientationImpl {
  static eulerToQuaternion(p, y, r) {
    return QuaternionUtils.fromEulerYXZ(p, y, r);
  }
  // 其他四元数操作直接调用 QuaternionUtils
}
```

**代码减少**: OrientationImpl 约减少 150 行四元数工具代码

---

## 7. 实施步骤

### 阶段 1：创建新文件（不修改 main.js）

1. 创建 `manage/ObjectFactoryImpl.js`
   - 从 main.js 复制相关函数
   - 添加 import/export
   - 确保独立可运行

2. 创建 `manage/OrientationImpl.js`
   - 从 main.js 复制 OrientationUtils 及相关函数
   - 修改为接收参数而非访问全局状态
   - 添加 import/export

### 阶段 2：修改 main.js

1. 添加新的 import 语句
2. 删除已迁移的代码
3. 替换所有调用点
4. 运行测试验证

### 阶段 3：验证与测试

1. 确保所有交互状态 (VIEW/FOCUS/EDIT) 正常工作
2. 验证 96 态旋转系统
3. 验证对象创建与格网功能

---

## 8. 风险与注意事项

### 8.1 主要风险

| 风险 | 缓解措施 |
|------|----------|
| 循环依赖 | ObjectFactoryImpl 不依赖 OrientationImpl |
| 全局状态访问 | OrientationImpl 通过参数接收视窗信息 |
| 动画回调 | `animateRotation` 回调仍在 main.js 中 |

### 8.2 注意事项

1. **LocalGridConfig 访问路径变化**
   - 所有 `LocalGridConfig.xxx` 需改为 `ObjectFactoryImpl.LocalGridConfig.xxx`
   - 影响约 15 处调用

2. **OrientationUtils 改名**
   - 所有 `OrientationUtils.xxx` 需改为 `OrientationImpl.xxx`
   - 影响约 20 处调用

3. **updateLocalGrid 保留在 main.js**
   - 该函数密集访问 `SystemState`，不适合迁移
   - 但可调用 `ObjectFactoryImpl.LocalGridConfig`

---

## 9. 审批检查清单

- [ ] ObjectFactoryImpl 包含所有对象创建函数
- [ ] OrientationImpl 包含完整的 96 态系统
- [ ] 所有四元数函数在 OrientationImpl 自包含
- [ ] main.js 保留 CONFIG 和 SystemState
- [ ] 接口设计支持参数传递（非全局访问）
- [ ] 底层类修改方案已记录（暂不实施）

---

## 10. 附录：代码行数统计

### main.js 迁移代码明细

| 目标文件 | 源行号范围 | 行数 | 类型 |
|----------|-----------|------|------|
| ObjectFactoryImpl | 69-152 | 84 | createCube |
| ObjectFactoryImpl | 153-208 | 56 | createPlane |
| ObjectFactoryImpl | 209-223 | 15 | createSphere |
| ObjectFactoryImpl | 225-285 | 61 | createSphereWithMeridians |
| ObjectFactoryImpl | 293-323 | 31 | createWorldGrid |
| ObjectFactoryImpl | 337-375 | 39 | createIntegerGridObject |
| ObjectFactoryImpl | 381-387 | 7 | createTestScene |
| ObjectFactoryImpl | 3359-3395 | 37 | LocalGridConfig |
| ObjectFactoryImpl | 3401-3505 | 105 | createLocalGridObject |
| **小计** | - | **435** | - |
| OrientationImpl | 2471-2541 | 71 | rotateObjectTowardsFront |
| OrientationImpl | 2546-2602 | 57 | rotateObjectAroundAxis |
| OrientationImpl | 2608-2644 | 37 | applyQuaternionToPoints |
| OrientationImpl | 3580-3591 | 12 | applyQuaternion |
| OrientationImpl | 3697-3742 | 46 | snapToNearestLayer |
| OrientationImpl | 3748-4524 | 777 | OrientationUtils |
| OrientationImpl | 4531-4682 | 152 | snapToNearestOrientation |
| **小计** | - | **1152** | - |
| **总计迁移** | - | **1587** | - |

> 注：实际拆分后行数会因添加导入/导出声明、注释等略有增加
