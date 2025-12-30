import { Point } from "./Point.js";

/**
 * SimpleFitCache - 球谐拟合缓存
 * 
 * 用于缓存拟合结果，避免重复计算
 */
class SimpleFitCache {
  constructor() {
    this._cache = null;
  }

  makeKey(context) {
    return `${context.pointVersion}:${context.order ?? 'auto'}`;
  }

  get(context) {
    if (!this._cache) return null;
    const key = this.makeKey(context);
    const cachedKey = this.makeKey(this._cache.context);
    return key === cachedKey ? this._cache.value : null;
  }

  set(context, value) {
    this._cache = { context: { ...context }, value };
  }

  clear() {
    this._cache = null;
  }
}

/**
 * ObjectCore - 对象系统的状态容器和门面
 * 
 * 核心职责（"瘦"设计）：
 * 1. 持有所有状态数据（Source of Truth）
 * 2. 模块编排（Geometry、Physics）
 * 3. 方法转发（Proxy）
 * 4. 模式决策（mode 控制物理访问权限）
 * 
 * Core 只负责"是否允许"，不负责"如何完成"：
 * - ✓ 检查当前 mode
 * - ✓ 决定是否允许调用模块
 * - ✗ 判断几何是否"足够好"
 * - ✗ 推断 Geometry 的内部状态
 * - ✗ 检查数据完整性（由各模块自行保证）
 * 
 * 严格限制：
 * - 不包含任何算法逻辑
 * - 仅负责状态管理和模块协调
 */
export class ObjectCore {
  /**
   * 构造函数
   * 
   * 数据分层架构：
   * 
   * 1. controlPoints（控制点）：
   *    - Source of Truth for Shape Fitting
   *    - 用户编辑的稀疏点集
   *    - 驱动球谐拟合
   * 
   * 2. surfacePoints（表面点）：
   *    - 物理模拟和渲染的密集网格
   *    - 初始时：引用 controlPoints（朴素模式）
   *    - 生成体积后：指向气泡生成的高密度表面
   * 
   * @param {Array} points - 初始点集
   * @param {Object} options - 配置选项
   */
  constructor(points = [], options = {}) {
    // === 核心状态数据 ===
    
    // 控制点（用于拟合）
    if (options.controlPoints && options.controlPoints.length > 0) {
      this.controlPoints = options.controlPoints;
    } else if (points.length > 0) {
      this.controlPoints = points.map(p => new Point(p.x, p.y, p.z));
    } else {
      this.controlPoints = [];
    }
    this._controlPointVersion = 0;
    
    // 表面点（物理/渲染）
    // ⭐ 显式设置策略（不隐含流程假设）
    // 
    // ⚠️ 重要不变量：surfacePoints 和 controlPoints 必须是不同的数组
    // - controlPoints：参数源（驱动拟合）
    // - surfacePoints：可变表示（物理/渲染）
    // - 即使内容相同，也要确保数组独立，避免版本系统失效
    if (options.surfacePoints) {
      // 策略 1：显式提供 surfacePoints
      this.surfacePoints = options.surfacePoints;
    } else if (points.length > 0 && !options.controlPoints) {
      // 策略 2：只提供 points，用作 surfacePoints
      this.surfacePoints = points;
    } else if (this.controlPoints.length > 0) {
      // 策略 3：controlPoints 作为初始 surfacePoints（朴素模式）
      // ⭐ 浅拷贝数组（Point 实例复用，数组独立）
      this.surfacePoints = [...this.controlPoints];
    } else {
      // 策略 4：空对象
      this.surfacePoints = [];
    }
    this._surfacePointVersion = 0;
    
    // 体积网格状态标记
    this._isVolumetric = false;
    
    // 显式状态机：控制物理访问权限
    // 'parametric' - 球谐/拟合/编辑态（不可物理）
    // 'discrete'   - mesh/cloth/line（可物理）
    // 'hybrid'     - 参数参考 + 局部离散（预留）
    this.mode = 'parametric';
    
    // 中心版本号：用于标记 _sphericalCoords 失效
    this._centerVersion = 0;
    
    // 几何中心
    this.center = options.center ?? this._computeCenter(this.controlPoints);
    
    // 中心缓存（用于惰性 getter）
    this._cachedCenter = null;
    
    // 边界盒
    this._boundingBox = null;
    this._boundingBoxDirty = true;

    // === Representation 结构（完整的白皮书定义） ===
    
    this.representation = {
      type: 'points',
      isClosed: false,
      data: null,
      
      // 零拷贝物理状态
      physicsState: {
        physicsModel: options.physicsModel ?? 'pbd',
        particles: [],
        constraints: [],
        surfaceStartIndex: 0,
        internalStartIndex: 0,
        surfaceCount: 0,
        internalCount: 0
      },
      
      topology: {
        triangles: [],
        edges: [],
        internalEdges: [],
        adjacency: null,
        degree: null
      },
      
      editState: null,
      
      geometryCache: {
        volume: null,
        surfaceArea: null,
        sections: new Map()
      },
      
      material: {
        uniform: true,
        properties: null
      },
      
      metadata: {}
    };

    // === 缓存和辅助状态 ===
    
    this._fitCache = new SimpleFitCache();
    this._fitStack = [];  // 增量拟合状态栈

    // === 物理配置 ===
    
    this.physics = {
      enabled: false,
      mass: 1.0,
      velocity: { x: 0, y: 0, z: 0 },
      model: options.physicsModel ?? 'pbd'
    };

    // === 元数据 ===
    
    this.metadata = {
      name: options.name ?? 'Untitled',
      created: Date.now(),
      modified: Date.now()
    };

    // === 调试选项 ===
    
    this.verbose = options.verbose ?? false;

    // === 模块编排（延迟初始化） ===
    
    this.geometry = null;  // 由外部设置：new ObjectGeometry(this)
    this.physicsModule = null;  // 由外部设置：new ObjectPhysics(this)

    // === 初始化回调 ===
    
    if (this.surfacePoints.length > 0) {
      this._onSurfacePointsChanged();
    }
  }

  // === 模块设置方法 ===
  
  /**
   * 设置几何模块
   * @param {ObjectGeometry} geometryModule
   */
  setGeometryModule(geometryModule) {
    this.geometry = geometryModule;
  }
  
  /**
   * 设置物理模块
   * @param {ObjectPhysics} physicsModule
   */
  setPhysicsModule(physicsModule) {
    this.physicsModule = physicsModule;
  }

  // === 状态查询 ===
  
  /**
   * 检查是否处于体积网格模式
   */
  isVolumetric() {
    return this._isVolumetric;
  }
  
  /**
   * 获取当前模式
   */
  getMode() {
    return this.mode;
  }

  // === 状态控制（受控写入） ===
  
  /**
   * 设置体积网格状态（单一写入口）
   * 
   * ⭐ 这是修改 _isVolumetric 的唯一合法入口
   * 
   * 职责：
   * - 设置 _isVolumetric 标志
   * - 检查 mode 合法性
   * - 冻结 surfacePoints 编辑权限
   * 
   * 约束：
   * - Geometry 模块不得直接写 _isVolumetric
   * - 必须通过此方法修改
   * 
   * @param {Boolean} isVolumetric - 是否为体积网格
   * @throws {Error} 当试图在不兼容的 mode 下设置时
   */
  setVolumetricState(isVolumetric) {
    // 类型检查
    if (typeof isVolumetric !== 'boolean') {
      throw new Error('[ObjectCore] setVolumetricState: isVolumetric must be a boolean');
    }
    
    // 如果状态没有变化，直接返回
    if (this._isVolumetric === isVolumetric) {
      return;
    }
    
    // 设置状态
    this._isVolumetric = isVolumetric;
    
    // 更新元数据
    this.metadata.modified = Date.now();
    
    if (this.verbose) {
      console.log(`[ObjectCore] Volumetric state changed: ${isVolumetric}`);
    }
  }
  
  /**
   * 获取几何中心（惰性计算）
   * 
   * ⭐ 这是访问 center 的推荐方式
   * 
   * 职责：
   * - 检测 centerVersion 变化
   * - 必要时重新计算 center
   * - 缓存计算结果
   * 
   * 注意：
   * - 直接访问 this.center 仍然有效（向后兼容）
   * - 但可能获取到过期值
   * - 推荐使用 getCenter() 确保值最新
   * 
   * @returns {Object} { x, y, z }
   */
  getCenter() {
    // 检查是否需要重新计算
    if (!this._cachedCenter || this._cachedCenter.version !== this._centerVersion) {
      // 重新计算 center（基于 controlPoints）
      this.center = this._computeCenter(this.controlPoints);
      
      // 缓存版本
      this._cachedCenter = {
        version: this._centerVersion,
        value: this.center
      };
      
      if (this.verbose) {
        console.log(`[ObjectCore] Center recomputed: (${this.center.x.toFixed(3)}, ${this.center.y.toFixed(3)}, ${this.center.z.toFixed(3)})`);
      }
    }
    
    return this.center;
  }

  // === 内部辅助方法 ===
  
  /**
   * 计算点集的几何中心
   * @private
   */
  _computeCenter(points) {
    if (points.length === 0) {
      return { x: 0, y: 0, z: 0 };
    }
    
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
      sumZ += p.z;
    }
    
    return {
      x: sumX / points.length,
      y: sumY / points.length,
      z: sumZ / points.length
    };
  }
  
  /**
   * 表面点改变回调
   * 
   * 职责：标记状态失效（不执行流程操作）
   * - 标记版本号变化
   * - 标记缓存失效
   * - 标记 center 失效
   * 
   * @private
   */
  _onSurfacePointsChanged() {
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this._fitCache.clear();
    this._centerVersion++;  // ⭐ center 失效
  }

  /**
   * 控制点改变回调
   * 
   * 职责：标记状态失效（不执行流程操作）
   * - 标记版本号变化
   * - 标记缓存失效
   * - 标记 center 失效
   * 
   * @private
   */
  _onControlPointsChanged() {
    this._controlPointVersion++;
    this._boundingBoxDirty = true;
    this._fitCache.clear();
    this._centerVersion++;  // ⭐ center 失效
  }

  // === 几何方法转发（Proxy Methods） ===
  
  /**
   * 拟合球谐函数
   * 
   * 转发给 geometry 模块，调用后更新状态标记
   */
  fitSphericalHarmonics(options = {}) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.fitSphericalHarmonics(options);
    
    // 状态更新
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }
  
  /**
   * 生成体积网格
   * 
   * 转发给 geometry 模块，调用后更新通用状态标记
   * 
   * 注意：_isVolumetric 由 Geometry 模块设置，Core 不假设完成状态
   */
  generateVolumetricMesh(options = {}) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.generateVolumetricMesh(options);
    
    // ⭐ 只更新通用状态（不假设几何完成状态）
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }
  
  /**
   * 生成有机布料
   * 
   * 转发给 geometry 模块，调用后更新通用状态标记
   * 
   * 注意：_isVolumetric 由 Geometry 模块设置，Core 不假设完成状态
   */
  generateOrganicCloth(boundaryPoints, options = {}) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.generateOrganicCloth(boundaryPoints, options);
    
    // ⭐ 只更新通用状态（不假设几何完成状态）
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }
  
  /**
   * 生成布料网格
   * 
   * 转发给 geometry 模块，调用后更新状态标记
   */
  generateClothMesh(rows, cols, options = {}) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.generateClothMesh(rows, cols, options);
    
    // 状态更新
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }
  
  /**
   * 更新控制点
   * 
   * 转发给 geometry 模块，调用后更新状态标记
   */
  updateControlPoint(index, x, y, z, options = {}) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.updateControlPoint(index, x, y, z, options);
    
    // 状态更新
    this._controlPointVersion++;
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }
  
  /**
   * 更新表面点
   * 
   * 转发给 geometry 模块，调用后更新状态标记
   */
  updateSurfacePoint(index, x, y, z) {
    if (!this.geometry) {
      throw new Error('[ObjectCore] Geometry module not initialized');
    }
    
    const result = this.geometry.updateSurfacePoint(index, x, y, z);
    
    // 状态更新
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return result;
  }

  // === 物理方法转发（Proxy Methods） ===
  
  /**
   * 重建物理拓扑
   * 
   * 职责：检查是否允许调用，然后转发给 physics 模块
   * 
   * Core 的职责：
   * - 检查模块是否初始化
   * - 转发调用
   * - 不判断几何是否"足够好"
   * - 不推断 Geometry 的内部状态
   */
  rebuildPhysicsTopology(options = {}) {
    if (!this.physicsModule) {
      throw new Error('[ObjectCore] Physics module not initialized');
    }
    
    // 纯粹的转发，不做任何几何状态判断
    return this.physicsModule.rebuildPhysicsTopology(options);
  }

  // === 物理心跳（Physics Heartbeat） ===
  
  /**
   * 获取物理视图（强约束）
   * 
   * Core 的职责：
   * - 检查当前 mode 是否允许物理访问
   * - 提供零拷贝的物理数据引用
   * - 提供 commit 回调（纯数据同步，无流程假设）
   * 
   * Core 不负责：
   * - 判断数据是否完整（由 Physics 模块保证）
   * - 推断 Geometry 的内部状态
   * - 决定同步后应该做什么（不调用 _updateNormals）
   * 
   * @returns {Object} { particles, constraints, commit }
   * @throws {Error} 当 mode !== 'discrete'
   */
  getPhysicsView() {
    // ⭐ Core 只检查"是否允许"，不检查"是否完整"
    if (this.mode !== 'discrete') {
      throw new Error(
        `[ObjectCore] 非法物理访问：当前 Object 不是可物理对象。\n` +
        `  当前模式：${this.mode}\n` +
        `  要求模式：discrete\n` +
        `  解决方案：调用 rebuildPhysicsTopology()\n` +
        `  对象名称：${this.metadata.name}`
      );
    }

    // 直接返回物理状态的引用（零拷贝）
    const particles = this.representation.physicsState.particles;
    const constraints = this.representation.physicsState.constraints;

    // commit 回调：纯数据同步（不包含流程假设）
    const commit = () => {
      // ⭐ 只负责数据同步，不做任何流程决策
      // 同步粒子位置到表面点
      const syncCount = Math.min(particles.length, this.surfacePoints.length);
      for (let i = 0; i < syncCount; i++) {
        const particle = particles[i];
        const point = this.surfacePoints[i];
        
        point.x = particle.position.x;
        point.y = particle.position.y;
        point.z = particle.position.z;
      }
      
      // ⚠️ 不调用 _updateNormals()
      // 理由：这是流程假设，不是状态同步
      // 如果需要更新法线，应该由调用方显式处理：
      //   const view = obj.getPhysicsView();
      //   physicsSystem.step(view);
      //   view.commit();
      //   obj.geometry._updateNormals();  // ← 调用方决定
    };

    return { particles, constraints, commit };
  }

  // === 渲染数据获取 ===
  
  /**
   * 获取渲染数据
   * 
   * 转发给 geometry 模块
   */
  getRenderData() {
    if (!this.geometry) {
      // 如果 geometry 模块未初始化，返回基本数据
      return {
        surfacePoints: this.surfacePoints,
        triangles: this.representation.topology.triangles,
        edges: this.representation.topology.edges,
        type: this.representation.type
      };
    }
    
    return this.geometry.getRenderData();
  }

  // === 边界盒计算 ===
  
  /**
   * 获取边界盒
   */
  getBoundingBox() {
    if (!this._boundingBoxDirty && this._boundingBox) {
      return this._boundingBox;
    }
    
    if (this.surfacePoints.length === 0) {
      this._boundingBox = {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      };
      this._boundingBoxDirty = false;
      return this._boundingBox;
    }
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const p of this.surfacePoints) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }
    
    this._boundingBox = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
    this._boundingBoxDirty = false;
    
    return this._boundingBox;
  }

  // === 材料查询 ===
  
  /**
   * 获取指定点的材料属性
   * 
   * 转发给 geometry 模块，如果未初始化则返回默认值
   */
  getMaterialAt(point) {
    if (!this.geometry) {
      return { stiffness: 1000, damping: 10, mass: 1.0 };
    }
    
    return this.geometry.getMaterialAt(point);
  }

  // === 点集基本操作 ===
  
  /**
   * 添加表面点
   * 
   * 生命周期限制：
   * - 朴素模式：允许添加
   * - 体积模式：禁止添加（物理网格拓扑固定）
   */
  addSurfacePoint(x, y, z) {
    if (this._isVolumetric) {
      console.error('[ObjectCore] Cannot add surface points in volumetric mode. The physical mesh topology is fixed.');
      return -1;
    }
    
    const point = new Point(x, y, z);
    this.surfacePoints.push(point);
    this._onSurfacePointsChanged();
    return this.surfacePoints.length - 1;
  }
  
  /**
   * 删除表面点
   */
  removeSurfacePoint(index) {
    if (this._isVolumetric) {
      console.error('[ObjectCore] Cannot remove surface points in volumetric mode. The physical mesh topology is fixed.');
      return false;
    }
    
    if (index < 0 || index >= this.surfacePoints.length) {
      return false;
    }
    
    this.surfacePoints.splice(index, 1);
    this._onSurfacePointsChanged();
    return true;
  }
  
  /**
   * 清空所有表面点
   */
  clearSurfacePoints() {
    this.surfacePoints = [];
    this.controlPoints = [];
    this._isVolumetric = false;
    this._onSurfacePointsChanged();
  }
}