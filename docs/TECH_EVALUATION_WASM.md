---
description: 技术评估：WASM与WebWorker在LightDesign项目中的应用可行性
---

# 技术评估：WASM与WebWorker的可行性分析

## 1. 项目现状分析 (Current Architecture)

目前 `LightDesign` 的核心计算模块位于 `math/` 和 `base/` 目录，主要包括：
*   **物理模拟** (`PhysicsSystem.js`, `PhysicsBridgeImpl.js`): CPU 密集型。采用 PBD/XPBD 算法，涉及大量粒子迭代和约束投影。目前基于 JS 对象 (`Array of Objects`) 实现。
*   **参数化拟合** (`SphericalHarmonics.js`, `FittingCalculator.js`): 数值密集型。涉及矩阵构建 ($O(N \cdot L^2)$) 和 QR 分解 ($O(N^3)$)。
*   **几何计算** (`GeometryImpl.js`): 算法密集型。如气泡填充、KNN 搜索。

**当前瓶颈预测**：
1.  **对象内存开销**：物理系统使用大量 JS 对象 (`Particle`, `Constraint`)，导致 GC 压力和缓存命中率低。
2.  **主线程阻塞**：大规模物理模拟或高阶拟合会通过长时间占用主线程导致 UI 卡顿。

---

## 2. WebAssembly (WASM) 评估

**目标**：将计算密集型任务（物理、拟合、几何）迁移至 WASM，利用其近乎原生的性能、SIMD 指令集和紧凑的内存布局。

### 2.1 难度与工作量
*   **难度**：**高 (High)**
    *   需要掌握 Rust 或 C++。
    *   需要重构数据结构：从 JS 的 "Array of Objects" 转向 WASM 的 "Structure of Arrays" (SoA) 或线性内存布局。
    *   JS <-> WASM 边界的数据交互（Marshal）是难点，必须采用 "Zero-Copy" 视图策略，否则拷贝开销会抵消计算收益。
*   **工作量**：**约 4-6 周**
    *   *阶段 1 (环境)*: 设置 Rust/Emscripten 工具链，构建 WASM 加载器 (3天)。
    *   *阶段 2 (物理)*: 重写 `PhysicsSystem` 核心 (2周)。
    *   *阶段 3 (拟合)*: 重写 `FittingCalculator` / `SphericalHarmonics`，引入线性代数库 (nalgebra/Eigen) (1周)。
    *   *阶段 4 (接入)*: 重构 JS 端的 `PhysicsBridgeImpl` 以对接 WASM 内存视图 (1-2周)。

### 2.2 推荐方案 (Rust route)
1.  **技术栈**：Rust + `wasm-bindgen`。
2.  **内存管理**：
    *   物理世界的所有状态（位置、速度、质量）完全驻留在 WASM 线性内存中。
    *   JS 端不持有物理数据的副本，而是通过 `Float32Array(wasm.memory.buffer, ptr, len)` 创建视图，直接传给 WebGL 或 Renderer。
3.  **API 设计**：
    ```rust
    // Rust 伪代码
    struct World {
        positions: Vec<f32>, // FLAT layout: x0, y0, z0, x1, y1, z1...
        // ...
    }
    
    #[wasm_bindgen]
    impl World {
        pub fn step(&mut self, dt: f32) { ... }
        pub fn get_positions_ptr(&self) -> *const f32 { ... }
    }
    ```

### 2.3 收益
*   **性能爆发**：矩阵运算和物理迭代预计提速 **5-10倍**。
*   **GC 消除**：核心循环中不再产生 JS 垃圾对象。

---

## 3. WebWorker 评估

**目标**：将计算任务移出主线程，解决 UI 卡顿问题。

### 3.1 难度与工作量
*   **难度**：**中 (Medium)**
    *   不需要新语言，但需要处理异步编程模型的复杂性。
    *   难点在于**数据同步**：主线程（渲染）和 Worker（物理）需要高频交换大量位置数据。
*   **工作量**：**约 2-3 周**
    *   *阶段 1 (架构)*: 引入 Worker 加载器，设计消息协议 (3天)。
    *   *阶段 2 (重构)*: 将 `PhysicsSystem` 剥离为独立 Worker 模块 (1周)。
    *   *阶段 3 (优化)*: 实现 `SharedArrayBuffer` 机制以避免 `postMessage` 拷贝 (1周)。

### 3.2 推荐方案 (SharedArrayBuffer)
1.  **数据结构改造**：
    *   即便是 JS 实现，也必须放弃现有的 "对象数组" 结构，改用 `Float32Array` + `SharedArrayBuffer`。
    *   原因：对象无法有效地在 Worker 间共享（只能拷贝，太慢）。只有 `SharedArrayBuffer` 是零拷贝的。
    *   这意味着无论是否上 WASM，为了高效 Worker，都必须**重写 `PhysicsSystem` 以操作 `TypedArray`**。
2.  **同步机制**：
    *   主线程与 Worker 需通过 `Atomics` 进行锁同步（虽然渲染通常可以容忍读取旧帧，即“双缓冲”策略）。

### 3.3 收益
*   **流畅度**：主线程仅负责渲染，UI 响应极佳。
*   **计算性能**：**主要瓶颈未解决**。JS 的计算效率未变，仅仅是挪了个位置。如果重构为 TypedArray 会有一定提升，但不如 WASM。

---

## 4. 终极方案：WASM + WebWorker 结合

**目标**：结合两者的优势，实现 **"后台高频计算 + 前台零拷贝渲染"** 的极致架构。

### 4.1 架构设计
这是一个典型的 **Off-screen Physics** 架构：

1.  **Worker 线程 (WASM Loader)**:
    *   加载 `.wasm` 模块。
    *   WASM 模块初始化并管理一段线性内存 (`WebAssembly.Memory`)。
    *   物理模拟死循环 (`while(true)`) 或高频 `setInterval` 运行在 Worker 中。
    *   WASM 直接读写其内部线性内存（Physics State）。

2.  **主线程 (Renderer)**:
    *   **关键点**：`WebAssembly.Memory` 可以基于 `SharedArrayBuffer` 构建。
    *   主线程持有同一个 WASM Memory 的引用（视图）。
    *   每一帧渲染时 (`requestAnimationFrame`)，主线程直接读取 Shared Memory 中的位置数据进行绘制。
    *   **零拷贝，零通信开销**。

### 4.2 优势
*   **计算**：Native 级速度 (Rust/C++)。
*   **调度**：完全不占用主线程 JS 时间，UI 满帧运行。
*   **通信**：通过共享内存实现状态同步，彻底消除 `postMessage` 的序列化/反序列化成本。

### 4.3 挑战与解决
*   **并发安全 (锁)**：
    *   Worker 在写内存，主线程在读内存，可能产生“画面撕裂”（渲染了一半的新数据）。
    *   *解决*：使用 **Double Buffering (双缓冲)**。WASM 计算 Buffer A，完成后原子操作切换指针，渲染器只读 Buffer B。或者在 JS 端使用 `Atomics.wait/notify` 实现简单的读写锁。
*   **浏览器兼容性**：
    *   需要 `Cross-Origin-Opener-Policy` (COOP) 和 `Cross-Origin-Embedder-Policy` (COEP) 响应头才能启用 `SharedArrayBuffer`。这在某些部署环境（如简单的静态服务器）可能受限。

---

## 5. 总结与建议 (Updated)

| 维度 | JS Objects (现状) | JS + WebWorker | WASM (Main Thread) | **WASM + WebWorker** |
| :--- | :--- | :--- | :--- | :--- |
| **性能上限** | low | medium | high | **extreme** |
| **开发重构** | - | 大量 (Array化) | 大量 (Rust化) | **大量 + 并发控制** |
| **UI 流畅度** | 阻塞 | 流畅 | 仍可能阻塞 | **完美** |

**最终路线图建议**：

1.  **Phase 1: 数据结构重构 (Prep)**
    *   不论选哪条路，首要任务是**消灭 JS 对象**。将 `PhysicsSystem` 内部改造为操作 `Float32Array`（即使先不暴露给外部）。
    *   *目标*：`positions[i*3+0]` 代替 `particles[i].position.x`。

2.  **Phase 2: 引入 WASM (Core)**
    *   使用 Rust 重写核心物理循环，编译为 WASM。初版可直接在主线程运行。
    *   *验证*：对比 Phase 1，验证计算性能提升倍数。

3.  **Phase 3: 移入 Worker (Concurrency)**
    *   将构建好的 WASM 模块移入 Worker。
    *   配置 `SharedArrayBuffer` 和 COOP/COEP 头。
    *   实现双缓冲渲染机制。

**结论**：**WASM + WebWorker** 是现代高性能 Web 图形应用的黄金标准方案。虽然工程复杂度较高，但对于 Physics/Lighting 系统而言，其带来的性能红利是决定性的。建议按 Phase 1 -> 2 -> 3 渐进式实施。
