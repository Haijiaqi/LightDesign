# 光照体系升级优化方案：平行光法向量查找表 (Normal LUT)

## 1. 现有光照体系梳理 (Current Lighting System Analysis)

### 1.1 计算模型
当前系统采用标准的 **Blinn-Phong** 或 **Phong** 光照模型，基于 **点光源 (Point Light)** 进行实时计算。

### 1.2 逐点计算流程 (Per-Point Calculation)
对于场景中的每一个点 $P$，每一帧渲染时都进行以下计算：
1.  **法向量 ($N$)**：物体局部法向量经过旋转矩阵变换为世界坐标法向量 $N_w$。
    *   *现状补全*：系统初始化/重采样(`generateDisplayPoints`)时，生成的局部法向量可能未归一化。**必须**修改 `Object.js`，在生成法向量后立即执行 `normalize`。
    *   *运行时*：在 `updateWorldPoints` 中，旋转后的法向量也**必须**再次归一化。
2.  **光线向量 ($L$)**：计算点光源位置 $L_{pos}$ 到点 $P$ 的向量 $L = L_{pos} - P$并归一化。
3.  **出射/反射向量 ($R$)**：根据反射公式 $R = 2(N \cdot L)N - L$ 计算。
4.  **视线向量 ($V$)**：计算摄像机位置到点 $P$ 的向量并归一化。
5.  **光照强度**：计算环境光 + 漫反射($N \cdot L$) + 高光($R \cdot V$ 或 $N \cdot H$)。

**瓶颈**：当场景点数达到百万级时，逐点计算 `normalize` 和 `reflect` (涉及点积和乘法) 开销巨大。

---

## 2. 优化目标：平行光查找表 (Optimization Goal)

### 2.1 引入平行光模式 (Directional Light Mode)
*   **特性**：光线方向向量 $L_{dir}$ 在整个场景中是恒定的，不随点的位置变化。
*   **优势**：$L$ 是常数，任何法向量 $N$ 对应的反射向量 $R$ 是固定的映射关系 $f(N) \to R$。

### 2.2 核心思想：预计算查找表 (Pre-computed LUT)
*   **空间换时间**：维护一个“法向量空间”的查找表。
*   **预存内容**：表中每个单元代表一个特定的法向量方向，存储该方向在当前平行光下的**出射向量 ($R$)**。
*   **运行时查询**：点 $P$ 无需进行反射向量数学运算，直接用自身的法向量 $N$ 作为索引去查表获取 $R$。

---

## 3. 技术实施方案 (Technical Implementation)

### 3.1 查找表数据结构设计 (LUT Data Structure)

建议使用 **3D 离散网格** 作为索引结构，以实现最快的 O(1) 查找速度，尽管会牺牲一部分空间（约 48% 无效空间）。

*   **结构**：一个三维数组（或 Flat Array 模拟三维） `ReflectTable[Size][Size][Size]`。
*   **分辨率 (Size)**：可配置，建议默认 **64**。
    *   总单元数：$Size^3$。例如 $64^3 = 262,144$。
*   **索引映射算法**：
    将归一化的法向量分量 $n_x, n_y, n_z \in [-1, 1]$ 映射到整数索引 $[0, Size-1]$：
    $$ idx = \lfloor (n + 1) \times 0.5 \times (Size - 1) \rfloor $$
*   **存储内容**：每个单元存储一个 pre-calculated 的 $\{r_x, r_y, r_z\}$ (Float32) 或直接存储打包数据。
*   **优势**：
    *   **算法极简**：仅需加乘和取整，无条件分支。
    *   **连贯内存**：非常适合 JS TypedArray 优化。

### 3.2 类的职责与存取位置 (Class Responsibilities & Location)

为了避免新增文件和类，我们将光照计算逻辑集成到最相关的 **`manage/Renderer.js`** 中。

#### A. `Renderer.Lighting` (扩展 Renderer 对象)
在 `Renderer` 对象中新增 `Lighting` 属性，负责维护 LUT 数据和状态。

*   **状态**：
    *   `lutResolution`: 分辨率配置（默认 64）。
    *   `lutData`: `Float32Array`，存储光照反射向量。
    *   `lastLightDir`: 记录最后一次更新的光照方向，用于脏检查（可选）。

*   **方法**：
    *   `updateLUT(lightDir)`: 重建 LUT 的核心逻辑。
    *   `getReflection(nx, ny, nz)`: 查表获取反射向量。

#### B. 集成点：`updateVisibleReflection` (main.js)
目前 `main.js` 中的 `updateVisibleReflection` 函数负责计算所有可见点的 `rx, ry, rz`。
我们将改造该函数：
1.  **判断模式**：如果是平行光模式。
2.  **查表**：调用 `Renderer.Lighting.getReflection(p.nx, p.ny, p.nz)`。
3.  **回退**：如果是点光源模式，维持原有逐点计算逻辑。

#### C. 刷新时机 (Update Timing)
必须确保 LUT 在以下时刻被刷新：
1.  **系统初始化 (`init`)**：在启动时根据默认平行光方向调用 `Renderer.Lighting.updateLUT`。
2.  **光照方向变更**：当用户修改全局光照方向（如拖动控制、快捷键）时，**立即**调用 `Renderer.Lighting.updateLUT`。

---

## 4. 详细代码变更 (Code Changes)

### 4.1 `manage/Renderer.js`
扩展 `Renderer` 对象：

```javascript
export const Renderer = {
    // ... existing properties ...
    
    // [New] 光照系统
    Lighting: {
        resolution: 64,
        data: null, // Float32Array
        halfSizeMinusOne: 31.5, // (64-1)/2
        
        init(res = 64) {
             this.resolution = res;
             this.halfSizeMinusOne = (res - 1) / 2;
             this.data = new Float32Array(res * res * res * 3);
        },
        
        updateLUT(lightDir) {
             if (!this.data) this.init();
             // ... LUT 重建逻辑 (3D Loop) ...
             console.log('[Renderer] Lighting LUT updated.');
        },
        
        getReflection(nx, ny, nz) {
             // ... 查表逻辑 ...
             // 返回 {x, y, z} 或直接修改传入的 p.rx, p.ry, p.rz
             // 为了减少对象创建，建议设计为: applyReflection(point) { ... point.rx = ... }
        }
    },
    
    // ...
};
```

### 3.3 关键流程说明

#### 场景 1：光照方向改变 (Light Direction Changes)
*   **触发**：用户拖动光源 / 全局光照调整。
*   **操作**：`LightingSystem` 重新计算整个 `ReflectTable`。
*   **开销**：$64^3 = 262,144$ 次简单向量运算。JS 处理此量级非常快（毫秒级），不影响帧率。

#### 场景 2：物体旋转 (Object Rotates)
*   **触发**：用户旋转物体。
*   **操作**：`Object.updateWorldPoints()` 执行：
    *   点的位置 $P_w = M_{rot} \times P_{local}$。
    *   点的法向量 $N_w = M_{rot} \times N_{local}$。
    *   **新增**：归一化 $N_w$。
*   **渲染**：Renderer 使用新的 $N_w$ 去 LUT 查找对应的 $R$。
*   **收益**：省去了每帧百万次级别的 `reflect` 运算，仅保留查表和点积。

---

## 4. 详细算法伪代码 (Algorithm Pseudocode)

### 4.1 初始化/重建 LUT (3D Grid) - 见上文 Renderer.Lighting 实现

### 4.2 `main.js` -> `updateVisibleReflection`
```javascript
function updateVisibleReflection() {
    // 1. 获取光照模式 (假设 SystemState 中有标记，或者根据是否绑定了 LightObject 判断)
    // 这里假设新增 SystemState.lightMode = 'DIRECTIONAL' | 'POINT'
    const isDirectional = SystemState.lightMode === 'DIRECTIONAL';
    
    // 如果是平行光，确保 LUT 已就绪 (通常由事件触发更新，这里只做防御性检查)
    
    const grid = SystemState.mainWindow.grid;
    // ... 遍历 Grid ...
            
                // ... 获取点 p ...
                
                if (isDirectional) {
                    // 查表优化
                    // 假设 Renderer.Lighting.applyReflection(p) 直接修改 p.rx, ry, rz
                    Renderer.Lighting.applyReflection(p); 
                } else {
                    // 原有点光源逻辑
                    // Calculate Vector from Light to Point ...
                    // ...
                }
    // ...
}
```

---

## 5. 预期效果与优劣分析

### 5.1 收益
*   **计算性能**：将复杂的反射向量计算 $R = I - 2(N \cdot I)N$ 替换为数组索引访问，在大量点云渲染时显著降低 CPU 负载。
*   **可扩展性**：LUT 可以进一步扩展，不仅存储 $R$，甚至可以预计算环境贴图采样结果（MatCap），实现极高拟真度的金属/光泽材质渲染。

### 5.2 挑战与代价
*   **精度损失**：由于法向量被离散化到 $64^3$ 的网格，高光边缘可能会出现轻微的阶梯状（Banding）。但在点云渲染中，这种瑕疵通常被点的离散性掩盖，不可见。
*   **内存占用**：$64^3 \times 3 \times 4$ bytes $\approx 3$ MB。完全可接受。
