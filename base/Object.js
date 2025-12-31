import { Point } from "./Point.js";

// SimpleFitCache - 球谐拟合缓存
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

// Object - 几何对象与物理管理
export class Object {
  /**
   * Object 构造函数
   * 
   * ⭐ 数据分层架构：
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
    // ⭐ 核心驱动源：控制点（用于拟合）
    // 兼容性逻辑：如果未提供 controlPoints，则复制 points
    if (options.controlPoints && options.controlPoints.length > 0) {
      this.controlPoints = options.controlPoints;
    } else if (points.length > 0) {
      // 深度复制：避免外部修改影响内部状态
      this.controlPoints = points.map(p => new Point(p.x, p.y, p.z));
    } else {
      this.controlPoints = [];
    }
    this._controlPointVersion = 0;
    
    // ⭐ 物理/渲染表面点
    // 初始时：引用 controlPoints（朴素模式，避免内存浪费）
    // 生成体积后：指向高密度网格（与 controlPoints 分离）
    if (points.length > 0 && (!options.controlPoints || options.controlPoints.length === 0)) {
      // 朴素模式：直接使用传入的 points
      this.surfacePoints = points;
    } else if (this.controlPoints.length > 0) {
      // 如果有独立的 controlPoints，表面点也初始化为控制点
      this.surfacePoints = this.controlPoints;
    } else {
      this.surfacePoints = [];
    }
    this._surfacePointVersion = 0;
    
    // ⭐ 状态标记：是否已生成体积网格
    // true: surfacePoints 已与 controlPoints 分离（高密度网格）
    // false: surfacePoints 引用 controlPoints（朴素模式）
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
    
    // 边界盒
    this._boundingBox = null;
    this._boundingBoxDirty = true;

    // 几何表示
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

    // 缓存
    this._fitCache = new SimpleFitCache();
    
    // ⭐ 增量拟合状态栈（用于断点续传）
    this._fitStack = [];

    // 物理状态
    this.physics = {
      enabled: false,
      mass: 1.0,
      velocity: { x: 0, y: 0, z: 0 },
      model: options.physicsModel ?? 'pbd'
    };

    // 元数据
    this.metadata = {
      name: options.name ?? 'Untitled',
      created: Date.now(),
      modified: Date.now()
    };

    // 调试选项
    this.verbose = options.verbose ?? false;

    if (this.surfacePoints.length > 0) {
      this._onSurfacePointsChanged();
    }
  }

  // === 点集管理 ===
  
  /**
   * 添加表面点
   * 
   * ⭐ 生命周期限制：
   * - 朴素模式：允许添加
   * - 体积模式：禁止添加（物理网格拓扑固定）
   * 
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Number} z - z 坐标
   * @returns {Number} 新点的索引，如果失败返回 -1
   */
  addSurfacePoint(x, y, z) {
    // ⭐ 体积模式检查
    if (this._isVolumetric) {
      console.error('[Object] Cannot add surface points in volumetric mode. The physical mesh topology is fixed.');
      console.error('[Object] To modify the mesh, either:');
      console.error('[Object]   1. Use updateSurfacePoint() to move existing points');
      console.error('[Object]   2. Use updateControlPoint() to reshape via spherical harmonics');
      console.error('[Object]   3. Regenerate the volumetric mesh with generateVolumetricMesh()');
      return -1;
    }
    
    const point = new Point(x, y, z);
    this.surfacePoints.push(point);
    this._onSurfacePointsChanged();
    return this.surfacePoints.length - 1;
  }

  /**
   * 删除表面点
   * 
   * ⭐ 生命周期限制：
   * - 朴素模式：允许删除
   * - 体积模式：禁止删除（物理网格拓扑固定）
   * 
   * @param {Number} index - 点索引
   * @returns {Boolean} 是否成功删除
   */
  removeSurfacePoint(index) {
    // ⭐ 体积模式检查
    if (this._isVolumetric) {
      console.error('[Object] Cannot remove surface points in volumetric mode. The physical mesh topology is fixed.');
      console.error('[Object] To modify the mesh, either:');
      console.error('[Object]   1. Use updateSurfacePoint() to move existing points');
      console.error('[Object]   2. Use updateControlPoint() to reshape via spherical harmonics');
      console.error('[Object]   3. Regenerate the volumetric mesh with generateVolumetricMesh()');
      return false;
    }
    
    if (index >= 0 && index < this.surfacePoints.length) {
      this.surfacePoints.splice(index, 1);
      this._onSurfacePointsChanged();
      return true;
    }
    
    return false;
  }

  /**
   * 更新表面点坐标
   * 
   * ⭐ 生命周期分支：
   * 
   * 【朴素模式】(!this._isVolumetric)
   * - surfacePoints 与 controlPoints 引用相同
   * - 使用 Swap-to-End 策略
   * - 操作 _fitStack（增量拟合）
   * - 允许交换顺序（点云无拓扑）
   * 
   * 【体积模式】(this._isVolumetric)
   * - surfacePoints 是物理网格（索引绑定约束）
   * - 禁止交换顺序（破坏物理拓扑）
   * - 禁止操作 _fitStack（属于控制点）
   * - 仅更新坐标 + 同步物理粒子
   * 
   * @param {Number} index - 点索引
   * @param {Number} x - 新的 x 坐标
   * @param {Number} y - 新的 y 坐标
   * @param {Number} z - 新的 z 坐标
   */
  updateSurfacePoint(index, x, y, z) {
    if (index < 0 || index >= this.surfacePoints.length) {
      console.warn(`[Object] Invalid surface point index: ${index}`);
      return;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 分支 1: 朴素模式（点云，无物理网格）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!this._isVolumetric) {
      const lastIndex = this.surfacePoints.length - 1;
      
      // ⭐ Swap-to-End 策略（脏数据后置）
      if (index !== lastIndex) {
        // 情况 1: 修改的不是最后一个点
        
        // 交换当前点与末尾点
        const temp = this.surfacePoints[index];
        this.surfacePoints[index] = this.surfacePoints[lastIndex];
        this.surfacePoints[lastIndex] = temp;
        
        // 更新末尾点的坐标（原 index 位置的点）
        this.surfacePoints[lastIndex].x = x;
        this.surfacePoints[lastIndex].y = y;
        this.surfacePoints[lastIndex].z = z;
        
        // ⭐ 截断状态栈（增量拟合复用）
        this._fitStack.length = index;
        
        if (this.verbose) {
          console.log(`[Object] [Naive Mode] Swapped point ${index} ↔ ${lastIndex}, truncated fitStack to ${index}`);
        }
      } else {
        // 情况 2: 修改的是最后一个点
        
        // 直接更新坐标
        this.surfacePoints[index].x = x;
        this.surfacePoints[index].y = y;
        this.surfacePoints[index].z = z;
        
        // ⭐ 回退状态栈一步
        if (this._fitStack.length > 0) {
          this._fitStack.length = this.surfacePoints.length - 1;
        }
        
        if (this.verbose) {
          console.log(`[Object] [Naive Mode] Updated last point ${index}, truncated fitStack to ${this._fitStack.length}`);
        }
      }
      
      // 更新边界盒和元数据
      this._boundingBoxDirty = true;
      this.metadata.modified = Date.now();
      return;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 分支 2: 体积/物理模式（物理网格，拓扑固定）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const point = this.surfacePoints[index];
    
    // ⭐ 禁止交换顺序（物理约束依赖索引）
    // 仅更新坐标
    point.x = x;
    point.y = y;
    point.z = z;
    
    // ⭐ 同步物理粒子（如果绑定）
    if (point._physicsData) {
      // 更新物理粒子的位置
      point._physicsData.position.x = x;
      point._physicsData.position.y = y;
      point._physicsData.position.z = z;
      
      // 同步前一帧位置（避免突变产生大速度）
      point._physicsData.prevPosition.x = x;
      point._physicsData.prevPosition.y = y;
      point._physicsData.prevPosition.z = z;
      
      if (this.verbose) {
        console.log(`[Object] [Volumetric Mode] Updated surface point ${index} and synced physics particle`);
      }
    }
    
    // ⭐ 同步 physicsState.particles（零拷贝架构）
    if (this.representation.physicsState?.particles?.[index]) {
      const particle = this.representation.physicsState.particles[index];
      particle.position.x = x;
      particle.position.y = y;
      particle.position.z = z;
      
      // 同步前一帧（避免速度突变）
      particle.prevPosition.x = x;
      particle.prevPosition.y = y;
      particle.prevPosition.z = z;
    }
    
    // ⭐ 禁止操作 _fitStack
    // 原因：_fitStack 属于控制点的增量拟合缓存，表面点变化不应影响
    
    // 更新边界盒和元数据
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    if (this.verbose) {
      console.log(`[Object] [Volumetric Mode] Updated surface point ${index} in-place (no swap, no fitStack change)`);
    }
  }

  addControlPoint(x, y, z) {
    const point = new Point(x, y, z);
    this.controlPoints.push(point);
    this._onControlPointsChanged();
    return this.controlPoints.length - 1;
  }

  /**
   * 更新控制点坐标
   * 
   * ⭐ Swap-to-End 策略（脏数据后置）：
   * - 将被修改的点移动到数组末尾
   * - 保持前缀不变，便于增量拟合复用
   * 
   * ⭐ 级联更新：
   * - 修改控制点 → 重新拟合球谐 → 更新物理几何
   * 
   * @param {Number} index - 控制点索引
   * @param {Number} x - 新的 x 坐标
   * @param {Number} y - 新的 y 坐标
   * @param {Number} z - 新的 z 坐标
   * @param {Object} options - 选项
   * @param {Boolean} options.autoRefit - 是否自动重新拟合（默认 true）
   * @param {Boolean} options.updatePhysics - 是否更新物理几何（默认 true）
   */
  updateControlPoint(index, x, y, z, options = {}) {
    if (index < 0 || index >= this.controlPoints.length) {
      console.warn(`[Object] Invalid control point index: ${index}`);
      return;
    }
    
    const autoRefit = options.autoRefit ?? true;
    const updatePhysics = options.updatePhysics ?? true;
    
    const lastIndex = this.controlPoints.length - 1;
    
    // ⭐ Swap-to-End 策略
    if (index !== lastIndex) {
      // 情况 1: 修改的不是最后一个点
      
      // 交换当前点与末尾点
      const temp = this.controlPoints[index];
      this.controlPoints[index] = this.controlPoints[lastIndex];
      this.controlPoints[lastIndex] = temp;
      
      // 更新末尾点的坐标
      this.controlPoints[lastIndex].x = x;
      this.controlPoints[lastIndex].y = y;
      this.controlPoints[lastIndex].z = z;
      
      // ⭐ 截断状态栈（index 之后的状态失效）
      this._fitStack.length = index;
      
      if (this.verbose) {
        console.log(`[Object] Swapped control point ${index} with ${lastIndex}, truncated fitStack to ${index}`);
      }
    } else {
      // 情况 2: 修改的是最后一个点
      
      // 直接更新坐标
      this.controlPoints[index].x = x;
      this.controlPoints[index].y = y;
      this.controlPoints[index].z = z;
      
      // ⭐ 回退状态栈一步
      if (this._fitStack.length > 0) {
        this._fitStack.length = this.controlPoints.length - 1;
      }
      
      if (this.verbose) {
        console.log(`[Object] Updated last control point ${index}, truncated fitStack to ${this._fitStack.length}`);
      }
    }
    
    // 更新版本号
    this._onControlPointsChanged();
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    // ⭐ 级联更新：控制点 → 球谐系数 → 物理几何
    if (autoRefit && this.representation.type === 'sphericalHarmonics') {
      try {
        // 重新拟合球谐（使用增量拟合）
        this.fitSphericalHarmonics({
          order: this.representation.data.order,
          fitter: this._fittingCalculator?.constructor,
          Matrix: this._matrixClass,
          sphericalHarmonics: this.representation.data.sphericalHarmonics,
          useIncremental: true
        });
        
        // 更新物理几何（如果已生成体积网格）
        if (updatePhysics && this._isVolumetric) {
          this.updatePhysicsGeometry();
        }
      } catch (err) {
        console.error('[Object] Failed to update after control point change:', err.message);
      }
    }
  }

  _onSurfacePointsChanged() {
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this._fitCache.clear();
    
    // ⭐ 清空增量拟合状态栈（结构变化，全量重算）
    this._fitStack = [];
    
    this.representation.topology = {
      triangles: [],
      edges: [],
      internalEdges: [],
      adjacency: null,
      degree: null
    };
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
    this.metadata.modified = Date.now();
  }

  _onControlPointsChanged() {
    this._controlPointVersion++;
    this.metadata.modified = Date.now();
  }

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

  getBoundingBox() {
    if (!this._boundingBoxDirty && this._boundingBox) {
      return this._boundingBox;
    }

    if (this.surfacePoints.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
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

  // === 球谐拟合 ===
  
  /**
   * 拟合球谐函数
   * 
   * ⭐ 增量拟合策略：
   * - 使用 FittingCalculator.fitIncrementalSpherical
   * - 自动复用 this._fitStack 中的状态
   * - 只计算新增或变化的点
   * 
   * @param {Object} options - 拟合选项
   * @param {Number} options.order - 球谐阶数（可选，不指定则自动确定）
   * @param {Object} options.fitter - FittingCalculator 实例（必需）
   * @param {Boolean} options.force - 是否强制重新拟合（忽略缓存）
   * @param {Boolean} options.useIncremental - 是否使用增量拟合（默认 true）
   * @returns {Object} 拟合结果
   */
  /**
   * 拟合球谐函数
   * 
   * ⭐ 强制数据源：永远使用 this.controlPoints
   * 
   * 核心原则：
   * - 控制点是形状拟合的 Source of Truth
   * - 禁止使用 surfacePoints 进行拟合（除非朴素模式）
   * - 增量拟合自动复用 _fitStack
   * 
   * @param {Object} options - 拟合选项
   * @returns {Object} 拟合结果
   */
  fitSphericalHarmonics(options = {}) {
    // ⭐ 数据验证：使用控制点而非表面点
    if (this.controlPoints.length === 0) {
      throw new Error('No control points to fit');
    }

    const context = {
      pointVersion: this._controlPointVersion,  // ⭐ 使用控制点版本
      order: options.order
    };

    // 检查缓存（仅在非增量模式或强制模式下）
    const useIncremental = options.useIncremental ?? true;
    
    if (!useIncremental && !options.force) {
      const cached = this._fitCache.get(context);
      if (cached) {
        return cached;
      }
    }

    const FittingCalculator = options.fitter;
    if (!FittingCalculator) {
      throw new Error('FittingCalculator (fitter) required in options');
    }

    // 创建或复用 FittingCalculator 实例
    if (!this._fittingCalculator) {
      this._fittingCalculator = new FittingCalculator({
        Matrix: options.Matrix,
        verbose: this.verbose
      });
      
      // 缓存 Matrix 类引用（用于 updateControlPoint）
      this._matrixClass = options.Matrix;
    }

    const fitter = this._fittingCalculator;

    // 获取 SphericalHarmonics 实例
    let sphericalHarmonics = options.sphericalHarmonics;
    
    // 如果没有提供，尝试从之前的表示中获取
    if (!sphericalHarmonics && this.representation.data?.sphericalHarmonics) {
      sphericalHarmonics = this.representation.data.sphericalHarmonics;
    }
    
    // 如果还没有，需要创建
    if (!sphericalHarmonics) {
      throw new Error('SphericalHarmonics instance required in options or previous representation');
    }

    const order = options.order ?? 3;  // 默认阶数 3

    // ⭐ 计算中心：使用控制点
    const center = this._computeCenter(this.controlPoints);

    let result;

    // ⭐ 使用增量拟合（基于控制点）
    if (useIncremental) {
      try {
        result = fitter.fitIncrementalSpherical(
          this.controlPoints,  // ⭐ 强制使用控制点
          this._fitStack,      // ⭐ 状态栈会被自动更新
          center,
          {
            order,
            sphericalHarmonics,
            verbose: this.verbose
          }
        );

        if (this.verbose) {
          console.log(`[Object] Incremental fit: ${result.metadata.extensionsPerformed} extensions, fitStack size: ${this._fitStack.length}`);
        }
      } catch (err) {
        console.error('[Object] Incremental fit failed, falling back to full fit:', err.message);
        
        // 清空状态栈，回退到完整拟合
        this._fitStack = [];
        
        // 使用传统的 fit 方法（如果 fitter 支持）
        if (typeof fitter.fit === 'function') {
          result = fitter.fit(this.controlPoints, order, center, {});  // ⭐ 使用控制点
        } else {
          throw err;
        }
      }
    } else {
      // 传统拟合模式
      if (typeof fitter.fit === 'function') {
        result = fitter.fit(this.controlPoints, order, center, {});  // ⭐ 使用控制点
      } else {
        throw new Error('FittingCalculator does not support non-incremental fit');
      }
    }

    // 更新表示
    this.representation = {
      type: 'sphericalHarmonics',
      isClosed: true,
      data: {
        coefficients: result.coefficients,
        order: result.order || order,
        sphericalHarmonics: sphericalHarmonics
      },
      physicsState: this.representation.physicsState,
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
      metadata: {
        residual: result.residual,
        condition: result.condition,
        pointCount: result.metadata?.pointCount || this.surfacePoints.length,
        fitMethod: useIncremental ? 'incremental' : 'full',
        stateStackSize: this._fitStack.length
      }
    };

    // 更新中心
    this.center = center;

    // 拟合后进入编辑态（不可物理）
    this.mode = 'parametric';
    
    // ⚠️ 中心改变，所有粒子上的 _sphericalCoords 失效
    this._centerVersion++;

    // 缓存结果（仅在非增量模式下）
    if (!useIncremental) {
      this._fitCache.set(context, result);
    }

    return result;
  }

  // === 几何量计算 ===
  
  getVolume(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Volume requires spherical harmonics');
    }

    if (this.representation.geometryCache.volume !== null) {
      return this.representation.geometryCache.volume;
    }

    const { coefficients, sphericalHarmonics } = this.representation.data;
    const volume = sphericalHarmonics.computeVolume(coefficients, this.center, options);
    this.representation.geometryCache.volume = volume;
    return volume;
  }

  getSurfaceArea(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Surface area requires spherical harmonics');
    }

    if (this.representation.geometryCache.surfaceArea !== null) {
      return this.representation.geometryCache.surfaceArea;
    }

    const { coefficients, sphericalHarmonics } = this.representation.data;
    const area = sphericalHarmonics.computeSurfaceArea(coefficients, this.center, options);
    this.representation.geometryCache.surfaceArea = area;
    return area;
  }

  getSection(plane, options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Section requires spherical harmonics');
    }

    const planeKey = this._makePlaneKey(plane);
    
    if (this.representation.geometryCache.sections.has(planeKey)) {
      return this.representation.geometryCache.sections.get(planeKey);
    }

    const { coefficients, sphericalHarmonics } = this.representation.data;
    const section = sphericalHarmonics.computeSection(coefficients, this.center, plane, options);
    this.representation.geometryCache.sections.set(planeKey, section);
    return section;
  }

  _makePlaneKey(plane) {
    const precision = 1000;
    return `${Math.round(plane.normal.x * precision)},${Math.round(plane.normal.y * precision)},${Math.round(plane.normal.z * precision)}:${Math.round(plane.point.x * precision)},${Math.round(plane.point.y * precision)},${Math.round(plane.point.z * precision)}`;
  }

  clearGeometryCache() {
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
  }

  // === 布料系统 ===
  
  initClothEditState(options = {}) {
    const width = options.width ?? 1.0;
    const height = options.height ?? 1.0;
    const rows = options.rows ?? 20;
    const cols = options.cols ?? 20;
    const shape = options.shape ?? 'rectangle';
    const physicsModel = options.physicsModel ?? 'pbd';
    
    this.physics.model = physicsModel;
    
    const controlPoints = this._generateClothControlPoints(width, height, rows, cols, shape);
    
    this.representation = {
      type: 'cloth',
      isClosed: false,
      data: null,
      
      editState: {
        controlPoints,
        uvGrid: { rows, cols, width, height },
        shape,
        constraints: [],
        preview: null
      },
      
      physicsState: {
        physicsModel,
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
      
      geometryCache: {
        volume: null,
        surfaceArea: null,
        sections: new Map()
      },
      
      material: {
        uniform: true,
        properties: null
      },
      
      metadata: {
        state: 'edit'
      }
    };
    
    this.controlPoints = controlPoints;
    this._rebuildEditStatePreview();
    this._onSurfacePointsChanged();
    
    return { controlPoints: controlPoints.length, uvGrid: { rows, cols } };
  }

  _generateClothControlPoints(width, height, rows, cols, shape) {
    const points = [];
    
    if (shape === 'rectangle') {
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          points.push(new Point((u - 0.5) * width, (v - 0.5) * height, 0));
        }
      }
    } else if (shape === 'circle') {
      const centerX = 0;
      const centerY = 0;
      const radius = Math.min(width, height) / 2;
      
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          const theta = u * Math.PI * 2;
          const r = v * radius;
          points.push(new Point(centerX + r * Math.cos(theta), centerY + r * Math.sin(theta), 0));
        }
      }
    }
    
    return points;
  }

  updateClothControlPoint(index, x, y, z = 0) {
    if (this.representation.type !== 'cloth') {
      throw new Error('Not a cloth object');
    }
    
    if (this.representation.metadata.state !== 'edit') {
      throw new Error('Cannot edit in physics state');
    }
    
    if (index >= 0 && index < this.controlPoints.length) {
      this.controlPoints[index].x = x;
      this.controlPoints[index].y = y;
      this.controlPoints[index].z = z;
      this._rebuildEditStatePreview();
      this._onControlPointsChanged();
    }
  }

  _rebuildEditStatePreview() {
    if (this.representation.type !== 'cloth') return;
    if (this.representation.metadata.state !== 'edit') return;
    
    const { uvGrid } = this.representation.editState;
    const { rows, cols } = uvGrid;
    
    const previewVertices = this.controlPoints.map(cp => ({ x: cp.x, y: cp.y, z: cp.z }));
    
    const previewFaces = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;
        previewFaces.push([idx, idx + 1, idx + cols + 2]);
        previewFaces.push([idx, idx + cols + 2, idx + cols + 1]);
      }
    }
    
    const previewEdges = new Set();
    for (const [a, b, c] of previewFaces) {
      const e1 = [Math.min(a, b), Math.max(a, b)];
      const e2 = [Math.min(b, c), Math.max(b, c)];
      const e3 = [Math.min(a, c), Math.max(a, c)];
      previewEdges.add(`${e1[0]}-${e1[1]}`);
      previewEdges.add(`${e2[0]}-${e2[1]}`);
      previewEdges.add(`${e3[0]}-${e3[1]}`);
    }
    
    this.representation.editState.preview = {
      vertices: previewVertices,
      faces: previewFaces,
      edges: Array.from(previewEdges).map(e => e.split('-').map(Number))
    };
  }

  // === 线系统 ===
  
  initLineState(options = {}) {
    let points;
    
    if (options.points) {
      points = options.points.map(p => this._normalizePoint(p));
    } else {
      const segments = options.segments ?? 20;
      const length = options.length ?? 1.0;
      const shape = options.shape ?? 'straight';
      points = this._generateLinePoints(segments, length, shape);
    }
    
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';
    this.physics.model = physicsModel;
    
    const edges = [];
    for (let i = 0; i < points.length - 1; i++) {
      edges.push([i, i + 1]);
    }
    
    if (options.closed) {
      edges.push([points.length - 1, 0]);
    }
    
    this.surfacePoints = points;
    
    const globalMassScale = this.physics.mass || 1.0;
    const uniformMass = globalMassScale / points.length;
    
    const particles = points.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: point.z },
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      
      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: uniformMass,
        invMass: uniformMass > 0 ? 1 / uniformMass : 0,
        fixed: false,
        _index: index
      };
    });
    
    const constraints = this._buildLineConstraintsFromEdges(edges, physicsModel);
    
    this.representation = {
      type: 'line',
      isClosed: options.closed ?? false,
      data: null,
      
      physicsState: {
        physicsModel,
        particles,
        constraints,
        surfaceStartIndex: 0,
        internalStartIndex: particles.length,
        surfaceCount: particles.length,
        internalCount: 0
      },
      
      topology: {
        triangles: [],
        edges,
        internalEdges: [],
        adjacency: this._buildLineAdjacency(edges, points.length),
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
      
      metadata: {
        state: 'physics'
      }
    };
    
    this._onSurfacePointsChanged();
    
    return {
      points: points.length,
      edges: edges.length,
      constraints: constraints.length
    };
  }

  _generateLinePoints(segments, length, shape) {
    const points = [];
    
    if (shape === 'straight') {
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        points.push(new Point(t * length - length / 2, 0, 0));
      }
    } else if (shape === 'circle') {
      const radius = length / (2 * Math.PI);
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        points.push(new Point(radius * Math.cos(theta), radius * Math.sin(theta), 0));
      }
    } else if (shape === 'spiral') {
      const radius = 0.5;
      const height = length;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const theta = t * 4 * Math.PI;
        points.push(new Point(radius * Math.cos(theta), radius * Math.sin(theta), t * height - height / 2));
      }
    }
    
    return points;
  }

  _normalizePoint(p) {
    if (p instanceof Point) {
      return p;
    }
    return new Point(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  }

  _buildLineAdjacency(edges, vertexCount) {
    const adjacency = new Map();
    
    for (let i = 0; i < vertexCount; i++) {
      adjacency.set(i, []);
    }
    
    for (const [a, b] of edges) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    
    return adjacency;
  }

  _buildLineConstraintsFromEdges(edges, physicsModel) {
    const constraints = [];
    
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    const tempTopology = this.representation.topology;
    this.representation.topology = { edges };
    const allConstraints = this._buildLineConstraints();
    this.representation.topology = tempTopology;
    
    for (const c of allConstraints) {
      if (c.type === 'line_bending' || (c.type === 'spring' && c.edgeType === 'bending')) {
        constraints.push(c);
      }
    }
    
    return constraints;
  }

  _buildLineConstraints() {
    const constraints = [];
    const { edges } = this.representation.topology;
    const physicsModel = this.physics.model || 'pbd';
    
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    for (let i = 0; i < this.surfacePoints.length - 2; i++) {
      const p0 = this.surfacePoints[i];
      const p1 = this.surfacePoints[i + 1];
      const p2 = this.surfacePoints[i + 2];
      
      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      
      const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
      const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
      
      if (mag1 > 1e-6 && mag2 > 1e-6) {
        const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
        const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        if (physicsModel === 'pbd') {
          constraints.push({
            type: 'line_bending',
            particles: [i, i + 1, i + 2],
            restAngle,
            compliance: 0.05
          });
        } else if (physicsModel === 'force') {
          const dx = p2.x - p0.x;
          const dy = p2.y - p0.y;
          const dz = p2.z - p0.z;
          const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          constraints.push({
            type: 'spring',
            i: i, j: i + 2,
            particles: [i, i + 2],
            restLength: bendRestLength,
            edgeType: 'bending',
            stiffness: 50,
            damping: 5
          });
        }
      }
    }
    
    if (this.representation.isClosed && this.surfacePoints.length > 2) {
      const n = this.surfacePoints.length;
      
      {
        const p0 = this.surfacePoints[n - 2];
        const p1 = this.surfacePoints[n - 1];
        const p2 = this.surfacePoints[0];
        
        const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
        const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
        
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
        
        if (mag1 > 1e-6 && mag2 > 1e-6) {
          const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
          const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
          
          if (physicsModel === 'pbd') {
            constraints.push({
              type: 'line_bending',
              particles: [n - 2, n - 1, 0],
              restAngle,
              compliance: 0.05
            });
          } else if (physicsModel === 'force') {
            const dx = p2.x - p0.x;
            const dy = p2.y - p0.y;
            const dz = p2.z - p0.z;
            const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            constraints.push({
              type: 'spring',
              i: n - 2, j: 0,
              particles: [n - 2, 0],
              restLength: bendRestLength,
              edgeType: 'bending',
              stiffness: 50,
              damping: 5
            });
          }
        }
      }
      
      {
        const p0 = this.surfacePoints[n - 1];
        const p1 = this.surfacePoints[0];
        const p2 = this.surfacePoints[1];
        
        const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
        const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
        
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
        
        if (mag1 > 1e-6 && mag2 > 1e-6) {
          const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
          const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
          
          if (physicsModel === 'pbd') {
            constraints.push({
              type: 'line_bending',
              particles: [n - 1, 0, 1],
              restAngle,
              compliance: 0.05
            });
          } else if (physicsModel === 'force') {
            const dx = p2.x - p0.x;
            const dy = p2.y - p0.y;
            const dz = p2.z - p0.z;
            const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            constraints.push({
              type: 'spring',
              i: n - 1, j: 1,
              particles: [n - 1, 1],
              restLength: bendRestLength,
              edgeType: 'bending',
              stiffness: 50,
              damping: 5
            });
          }
        }
      }
    }
    
    return constraints;
  }

  // === 布料物理态生成 ===
  
  generateClothPhysicsState(options = {}) {
    if (this.representation.type !== 'cloth') {
      throw new Error('Not a cloth object');
    }
    
    if (this.representation.metadata.state !== 'edit') {
      throw new Error('Already in physics state');
    }
    
    const { controlPoints, uvGrid } = this.representation.editState;
    const { rows, cols } = uvGrid;
    
    const vertices = controlPoints.map(cp => ({ x: cp.x, y: cp.y, z: cp.z }));
    
    const faces = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;
        faces.push([idx, idx + 1, idx + cols + 2]);
        faces.push([idx, idx + cols + 2, idx + cols + 1]);
      }
    }
    
    const topology = this._buildClothTopology(faces, vertices.length);
    
    const uvCoords = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        uvCoords.push({ u: j / cols, v: i / rows });
      }
    }
    
    this.surfacePoints = vertices.map(v => new Point(v.x, v.y, v.z));
    
    const globalMassScale = this.physics.mass || 1.0;
    const totalPointCount = this.surfacePoints.length;
    const surfaceMass = globalMassScale / totalPointCount;
    
    const particles = this.surfacePoints.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: point.z },
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      
      let particleMass = surfaceMass;
      if (!this.representation.material.uniform && this.representation.material.properties) {
        const mat = this.getMaterialAt(point);
        if (mat && mat.mass !== undefined) {
          particleMass = mat.mass * globalMassScale / totalPointCount;
        }
      }
      
      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: particleMass,
        invMass: particleMass > 0 ? 1 / particleMass : 0,
        fixed: false,
        _index: index,
        _type: 'surface'
      };
    });
    
    const constraints = this._buildClothConstraints();
    
    this.representation.physicsState = {
      physicsModel: this.physics.model || 'pbd',
      particles,
      constraints,
      surfaceStartIndex: 0,
      internalStartIndex: particles.length,
      surfaceCount: particles.length,
      internalCount: 0,
      vertices,
      faces,
      uvCoords
    };
    
    this.representation.topology = topology;
    this.representation.metadata.state = 'physics';
    
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return {
      vertices: vertices.length,
      faces: faces.length,
      constraints: constraints.length,
      topology,
      mode: this.mode
    };
  }

  _buildClothTopology(faces, vertexCount) {
    const edges = new Set();
    const adjacency = new Map();
    
    for (let i = 0; i < vertexCount; i++) {
      adjacency.set(i, []);
    }
    
    for (const [a, b, c] of faces) {
      const e1 = [Math.min(a, b), Math.max(a, b)];
      const e2 = [Math.min(b, c), Math.max(b, c)];
      const e3 = [Math.min(a, c), Math.max(a, c)];
      
      edges.add(`${e1[0]}-${e1[1]}`);
      edges.add(`${e2[0]}-${e2[1]}`);
      edges.add(`${e3[0]}-${e3[1]}`);
      
      if (!adjacency.get(a).includes(b)) adjacency.get(a).push(b);
      if (!adjacency.get(b).includes(a)) adjacency.get(b).push(a);
      if (!adjacency.get(b).includes(c)) adjacency.get(b).push(c);
      if (!adjacency.get(c).includes(b)) adjacency.get(c).push(b);
      if (!adjacency.get(a).includes(c)) adjacency.get(a).push(c);
      if (!adjacency.get(c).includes(a)) adjacency.get(c).push(a);
    }
    
    return {
      triangles: faces,
      edges: Array.from(edges).map(e => e.split('-').map(Number)),
      internalEdges: [],
      adjacency,
      degree: Array.from(adjacency.values()).map(n => n.length)
    };
  }

  _buildClothConstraints() {
    const constraints = [];
    const { edges, triangles } = this.representation.topology;
    const physicsModel = this.physics.model || 'pbd';
    
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    const processedEdges = new Set();
    
    for (const tri1 of triangles) {
      for (let i = 0; i < 3; i++) {
        const a = tri1[i];
        const b = tri1[(i + 1) % 3];
        const edgeKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
        
        if (processedEdges.has(edgeKey)) continue;
        processedEdges.add(edgeKey);
        
        for (const tri2 of triangles) {
          if (tri1 === tri2) continue;
          
          if ((tri2.includes(a) && tri2.includes(b))) {
            const c = tri1.find(v => v !== a && v !== b);
            const d = tri2.find(v => v !== a && v !== b);
            
            if (c !== undefined && d !== undefined) {
              const initialAngle = this._computeDihedralAngle(
                this.surfacePoints[a],
                this.surfacePoints[b],
                this.surfacePoints[c],
                this.surfacePoints[d]
              );
              
              if (physicsModel === 'pbd') {
                constraints.push({
                  type: 'bending',
                  particles: [a, b, c, d],
                  restAngle: initialAngle,
                  compliance: 0.1
                });
              } else {
                const pc = this.surfacePoints[c];
                const pd = this.surfacePoints[d];
                const dx = pd.x - pc.x;
                const dy = pd.y - pc.y;
                const dz = pd.z - pc.z;
                const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
                
                constraints.push({
                  type: 'spring',
                  i: c, j: d,
                  particles: [c, d],
                  restLength: bendRestLength,
                  edgeType: 'bending',
                  stiffness: 100,
                  damping: 5
                });
              }
            }
            
            break;
          }
        }
      }
    }
    
    return constraints;
  }

  _computeDihedralAngle(pa, pb, pc, pd) {
    const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
    const ac = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z };
    const ad = { x: pd.x - pa.x, y: pd.y - pa.y, z: pd.z - pa.z };
    
    const n1 = this._cross3D(ab, ac);
    const n2 = this._cross3D(ab, ad);
    
    const mag1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
    const mag2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);
    
    if (mag1 < 1e-6 || mag2 < 1e-6) return 0;
    
    n1.x /= mag1; n1.y /= mag1; n1.z /= mag1;
    n2.x /= mag2; n2.y /= mag2; n2.z /= mag2;
    
    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  _cross3D(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  // === 碰撞体 ===
  
  setCollider(collider) {
    if (!collider.containsPoint || typeof collider.containsPoint !== 'function') {
      throw new Error('Collider must have containsPoint(x, y, z) method');
    }
    this.physics.collider = collider;
  }

  static createColliderFromSphericalHarmonics(sphericalHarmonicsObject) {
    if (sphericalHarmonicsObject.representation.type !== 'sphericalHarmonics') {
      throw new Error('Object is not a spherical harmonics representation');
    }

    const { coefficients, sphericalHarmonics } = sphericalHarmonicsObject.representation.data;
    const center = sphericalHarmonicsObject.center;

    return {
      containsPoint(x, y, z) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (rCart < 1e-10) return true;

        const theta = Math.acos(dz / rCart);
        const phi = Math.atan2(dy, dx);
        const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);

        return rCart <= rSH;
      },

      getNormal(x, y, z) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (rCart < 1e-10) {
          return { x: 0, y: 1, z: 0 };
        }

        const theta = Math.acos(dz / rCart);
        const phi = Math.atan2(dy, dx);

        const gradient = sphericalHarmonics.computeGradient(coefficients, theta, phi);

        const radial = { x: dx / rCart, y: dy / rCart, z: dz / rCart };
        const gradMag = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y + gradient.z * gradient.z);

        if (gradMag < 1e-10) {
          return radial;
        }

        const nx = radial.x - gradient.x / gradMag;
        const ny = radial.y - gradient.y / gradMag;
        const nz = radial.z - gradient.z / gradMag;
        const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);

        return mag > 1e-10 ? { x: nx / mag, y: ny / mag, z: nz / mag } : radial;
      },

      projectToSurface(x, y, z) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (rCart < 1e-10) {
          return { x: center.x + 0.1, y: center.y, z: center.z };
        }

        const theta = Math.acos(dz / rCart);
        const phi = Math.atan2(dy, dx);
        const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);

        const scale = rSH / rCart;
        return {
          x: center.x + dx * scale,
          y: center.y + dy * scale,
          z: center.z + dz * scale
        };
      }
    };
  }

  // === 固定点与约束 ===
  
  fixPoint(index) {
    if (index < 0 || index >= this.surfacePoints.length) {
      throw new Error('Invalid point index');
    }

    const point = this.surfacePoints[index];
    if (point._physicsData) {
      point._physicsData.fixed = true;
    }

    if (this.representation.type === 'cloth' && this.representation.editState) {
      let fixedConstraint = this.representation.editState.constraints.find(c => c.type === 'fixed');
      
      if (!fixedConstraint) {
        fixedConstraint = {
          type: 'fixed',
          particles: []
        };
        this.representation.editState.constraints.push(fixedConstraint);
      }
      
      if (!fixedConstraint.particles.includes(index)) {
        fixedConstraint.particles.push(index);
      }
    }
  }

  unfixPoint(index) {
    if (index < 0 || index >= this.surfacePoints.length) {
      throw new Error('Invalid point index');
    }

    const point = this.surfacePoints[index];
    if (point._physicsData) {
      point._physicsData.fixed = false;
    }

    if (this.representation.type === 'cloth' && this.representation.editState) {
      const fixedConstraint = this.representation.editState.constraints.find(c => c.type === 'fixed');
      
      if (fixedConstraint) {
        const idx = fixedConstraint.particles.indexOf(index);
        if (idx !== -1) {
          fixedConstraint.particles.splice(idx, 1);
        }
        
        if (fixedConstraint.particles.length === 0) {
          const constraintIdx = this.representation.editState.constraints.indexOf(fixedConstraint);
          this.representation.editState.constraints.splice(constraintIdx, 1);
        }
      }
    }
  }

  /**
   * 更新物理几何（实时物理编辑）
   * 
   * 触发时机：
   * - 控制点被拖拽后
   * - fitSphericalHarmonics 更新球谐系数后
   * 
   * 核心原则：
   * - 严禁重置粒子的 position 和 velocity（保留动量）
   * - 只更新约束的理想长度和形状匹配的参考形状
   * - 物理引擎会自然地将粒子拉向新形状
   * 
   * 效果：
   * - Q弹的过渡动画
   * - 保持物理惯性
   * - 平滑的形变
   */
  updatePhysicsGeometry() {
    const physicsState = this.representation.physicsState;
    if (!physicsState) {
      console.warn('[Object] No physics state to update');
      return;
    }

    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric') {
      console.warn('[Object] updatePhysicsGeometry only works with spherical harmonics');
      return;
    }

    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) {
      console.warn('[Object] Missing spherical harmonics data');
      return;
    }

    const { particles, constraints } = physicsState;

    // 步骤 1: 计算每个粒子的新理想位置（基于球坐标）
    const idealPositions = new Array(particles.length);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      let theta, phi;
      
      // ⚠️ 关键修复：检查球坐标是否有效
      if (p._sphericalCoords && p._sphericalCoords.centerVersion === this._centerVersion) {
        // 角度有效，直接使用
        theta = p._sphericalCoords.theta;
        phi = p._sphericalCoords.phi;
      } else {
        // 角度失效或不存在，需要重新计算（相对于当前 center）
        const dx = p.position.x - this.center.x;
        const dy = p.position.y - this.center.y;
        const dz = p.position.z - this.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (r < 1e-10) {
          // 粒子在中心，保持当前位置
          idealPositions[i] = { x: p.position.x, y: p.position.y, z: p.position.z };
          continue;
        }
        
        theta = Math.acos(dz / r);
        phi = Math.atan2(dy, dx);
        
        // 更新粒子的球坐标（缓存）
        if (!p._sphericalCoords) {
          p._sphericalCoords = {};
        }
        p._sphericalCoords.theta = theta;
        p._sphericalCoords.phi = phi;
        p._sphericalCoords.centerVersion = this._centerVersion;
      }

      // 使用球谐函数计算新的半径
      const r = sphericalHarmonics.evaluate(theta, phi, coefficients);

      // ⚠️ 关键修复：转换为笛卡尔坐标时，加上当前 center
      const sinTheta = Math.sin(theta);
      idealPositions[i] = {
        x: this.center.x + r * sinTheta * Math.cos(phi),
        y: this.center.y + r * sinTheta * Math.sin(phi),
        z: this.center.z + r * Math.cos(theta)
      };
    }

    // ⭐ 步骤 2: 热更新距离约束的 restLength
    let updatedDistanceConstraints = 0;

    for (const constraint of constraints) {
      if (constraint.type === 'distance') {
        const i = constraint.i;
        const j = constraint.j;

        if (i !== undefined && j !== undefined && 
            idealPositions[i] && idealPositions[j]) {
          
          const pi = idealPositions[i];
          const pj = idealPositions[j];

          // 计算新的理想距离
          const dx = pj.x - pi.x;
          const dy = pj.y - pi.y;
          const dz = pj.z - pi.z;
          const newRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // 更新约束的 restLength
          if (constraint.restLength !== undefined) {
            constraint.restLength = newRestLength;
          } else if (constraint.distance !== undefined) {
            constraint.distance = newRestLength;
          }

          updatedDistanceConstraints++;
        }
      }
    }

    // ⭐ 步骤 3: 热更新形状匹配数据（如果存在）
    // 注意：形状匹配数据通常由 PhysicsSystem 管理，这里我们更新 Object 层的引用形状
    
    if (physicsState.internalStartIndex !== undefined && 
        physicsState.internalCount !== undefined) {
      
      const startIdx = physicsState.internalStartIndex;
      const endIdx = startIdx + physicsState.internalCount;

      // 计算新的质心
      let cx = 0, cy = 0, cz = 0;
      let totalMass = 0;

      for (let i = startIdx; i < endIdx; i++) {
        const p = particles[i];
        const ideal = idealPositions[i];
        cx += ideal.x * p.mass;
        cy += ideal.y * p.mass;
        cz += ideal.z * p.mass;
        totalMass += p.mass;
      }

      cx /= totalMass;
      cy /= totalMass;
      cz /= totalMass;

      // 更新相对偏移量（存储在粒子上，供 PhysicsSystem 读取）
      for (let i = startIdx; i < endIdx; i++) {
        const p = particles[i];
        const ideal = idealPositions[i];

        if (!p._shapeMatchingData) {
          p._shapeMatchingData = {};
        }

        p._shapeMatchingData.restOffset = {
          x: ideal.x - cx,
          y: ideal.y - cy,
          z: ideal.z - cz
        };
      }
    }

    if (this.verbose) {
      console.log(`[Object] Updated physics geometry: ${updatedDistanceConstraints} distance constraints`);
    }

    this.metadata.modified = Date.now();
  }

  // === 体积网格生成（Bubble Packing + Sightline Filtering）===
  
  /**
   * 生成体积网格
   * 
   * ⭐ 指针切换策略（不覆盖控制点）：
   * 
   * 1. controlPoints 保持不变（幽灵句柄）
   * 2. surfacePoints 切换到高密度网格
   * 3. 设置 _isVolumetric = true
   * 
   * 效果：
   * - 控制点驱动形状（拟合）
   * - 表面点驱动渲染（物理）
   * 
   * @param {Object} options - 配置选项
   * @returns {Object} 生成结果
   */
  generateVolumetricMesh(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Volumetric mesh requires spherical harmonics representation');
    }
    
    // ⭐ 自动计算点数
    let targetCount = options.targetCount;
    const spacing = options.spacing ?? 0.1;
    
    if (targetCount === undefined) {
      // 计算包围盒
      const bbox = this.getBoundingBox();
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;
      const depth = bbox.max.z - bbox.min.z;
      
      // 平均直径
      const D = (width + height + depth) / 3;
      
      // 估算公式：N ≈ 0.52 × (D / spacing)³
      // 0.52 是球体填充率（考虑松弛后的实际密度）
      const estimatedCount = Math.round(0.52 * Math.pow(D / spacing, 3));
      
      // 安全上限：防止浏览器崩溃
      const safetyLimit = 2000;
      targetCount = Math.min(estimatedCount, safetyLimit);
      
      // 最小值：确保至少有基本结构
      targetCount = Math.max(targetCount, 50);
      
      if (this.verbose || options.verbose) {
        console.log(`[Object] Auto-calculated targetCount: ${targetCount} (estimated: ${estimatedCount}, D: ${D.toFixed(2)}, spacing: ${spacing})`);
      }
    }
    
    const relaxIterations = options.relaxIterations ?? 25;
    const surfaceRatio = options.surfaceRatio ?? 0.3;
    const knn = options.knn ?? 10;
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';
    
    this.physics.model = physicsModel;
    
    const { surfacePoints, internalPoints } = this._generateBubblePacking(
      targetCount, spacing, relaxIterations, surfaceRatio
    );
    
    const topology = this._buildSurfaceTopologyByVisibility(surfacePoints, knn);
    
    // ⭐ 关键修改：创建新的表面点数组（不覆盖 controlPoints）
    const newSurfacePoints = surfacePoints.map(sp => 
      new Point(sp.position.x, sp.position.y, sp.position.z)
    );
    
    const globalMassScale = this.physics.mass || 1.0;
    const surfaceMass = globalMassScale * 0.6 / surfacePoints.length;
    const internalMass = globalMassScale * 0.4 / internalPoints.length;
    
    const surfaceParticles = newSurfacePoints.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: point.z },
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      
      // ⚠️ 关键修复：计算相对于当前 center 的球坐标
      const dx = point.x - this.center.x;
      const dy = point.y - this.center.y;
      const dz = point.z - this.center.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const theta = Math.atan2(Math.sqrt(dx * dx + dy * dy), dz);
      const phi = Math.atan2(dy, dx);
      
      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: surfaceMass,
        invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
        fixed: false,
        _index: index,
        _type: 'surface',
        _sphericalCoords: { 
          theta, 
          phi, 
          centerVersion: this._centerVersion  // 绑定中心版本
        }
      };
    });
    
    const internalParticles = internalPoints.map((node, index) => {
      // ⚠️ 关键修复：计算相对于当前 center 的球坐标
      const pos = node.position;
      const dx = pos.x - this.center.x;
      const dy = pos.y - this.center.y;
      const dz = pos.z - this.center.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const theta = Math.atan2(Math.sqrt(dx * dx + dy * dy), dz);
      const phi = Math.atan2(dy, dx);
      
      return {
        position: node.position,
        prevPosition: { x: node.position.x, y: node.position.y, z: node.position.z },
        velocity: { x: 0, y: 0, z: 0 },
        mass: internalMass,
        invMass: internalMass > 0 ? 1 / internalMass : 0,
        fixed: false,
        _index: surfacePoints.length + index,
        _type: 'internal',
        _sphericalCoords: { 
          theta, 
          phi, 
          centerVersion: this._centerVersion  // 绑定中心版本
        }
      };
    });
    
    const particles = [...surfaceParticles, ...internalParticles];
    
    const surfaceConstraints = this._buildBubbleSurfaceConstraints(topology.edges, newSurfacePoints, physicsModel);
    const internalConstraints = this._buildBubbleInternalConstraints(
      internalPoints, surfacePoints.length, spacing * 1.5, knn, physicsModel
    );
    const skinBoneConstraints = this._buildSkinBoneConstraints(
      surfacePoints, internalPoints, surfacePoints.length, spacing * 2.0, physicsModel
    );
    
    const constraints = [...surfaceConstraints, ...internalConstraints, ...skinBoneConstraints];
    
    this.representation.physicsState = {
      physicsModel,
      particles,
      constraints,
      surfaceStartIndex: 0,
      internalStartIndex: surfacePoints.length,
      surfaceCount: surfacePoints.length,
      internalCount: internalPoints.length
    };
    
    this.representation.topology = topology;
    this.representation.type = 'volumetric';
    
    // ⭐ 指针切换：将 surfacePoints 指向高密度网格
    // controlPoints 保持不变，成为"幽灵句柄"
    this.surfacePoints = newSurfacePoints;
    
    this._isVolumetric = true;
    
    if (this.verbose) {
      console.log(`[Object] Volumetric mesh: controlPoints (${this.controlPoints.length}) → surfacePoints (${this.surfacePoints.length}) (mode=${this.mode}, call rebuildPhysicsTopology() to enable physics)`);
    }
    
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
    this.metadata.modified = Date.now();
    
    return {
      surfacePoints: surfacePoints.length,
      internalPoints: internalPoints.length,
      surfaceConstraints: surfaceConstraints.length,
      internalConstraints: internalConstraints.length,
      skinBoneConstraints: skinBoneConstraints.length,
      topology,
      autoCalculated: options.targetCount === undefined,
      finalTargetCount: targetCount,
      isVolumetric: this._isVolumetric,
      controlPointsPreserved: this.controlPoints.length,
      mode: this.mode
    };
  }

  _generateBubblePacking(targetCount, spacing, iterations, surfaceRatio) {
    const { coefficients, sphericalHarmonics } = this.representation.data;
    const boundingRadius = sphericalHarmonics._estimateBoundingRadius(coefficients);
    const boxSize = boundingRadius * 2.2;
    
    const points = [];
    const cx = this.center.x;
    const cy = this.center.y;
    const cz = this.center.z;
    
    for (let i = 0; i < targetCount; i++) {
      points.push({
        position: {
          x: cx + (Math.random() - 0.5) * boxSize,
          y: cy + (Math.random() - 0.5) * boxSize,
          z: cz + (Math.random() - 0.5) * boxSize
        },
        isSurface: false
      });
    }
    
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < points.length; i++) {
        const pi = points[i].position;
        let fx = 0, fy = 0, fz = 0;
        
        for (let j = 0; j < points.length; j++) {
          if (i === j) continue;
          
          const pj = points[j].position;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dz = pi.z - pj.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          if (dist < spacing && dist > 1e-6) {
            const force = (spacing - dist) / dist;
            fx += dx * force;
            fy += dy * force;
            fz += dz * force;
          }
        }
        
        const damping = 0.5;
        pi.x += fx * damping;
        pi.y += fy * damping;
        pi.z += fz * damping;
      }
      
      for (const point of points) {
        const dx = point.position.x - cx;
        const dy = point.position.y - cy;
        const dz = point.position.z - cz;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (rCart < 1e-10) continue;
        
        const theta = Math.acos(dz / rCart);
        const phi = Math.atan2(dy, dx);
        const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);
        
        if (rCart > rSH) {
          const scale = rSH / rCart;
          point.position.x = cx + dx * scale;
          point.position.y = cy + dy * scale;
          point.position.z = cz + dz * scale;
          point.isSurface = true;
        }
        else if (rCart > rSH * 0.92) {
          const scale = rSH / rCart;
          const attractionStrength = (rCart - rSH * 0.92) / (rSH * 0.08);
          point.position.x = cx + dx * (scale * attractionStrength + (1 - attractionStrength));
          point.position.y = cy + dy * (scale * attractionStrength + (1 - attractionStrength));
          point.position.z = cz + dz * (scale * attractionStrength + (1 - attractionStrength));
          
          if (attractionStrength > 0.5) {
            point.isSurface = true;
          }
        }
      }
    }
    
    const surfacePoints = points.filter(p => p.isSurface);
    const internalPoints = points.filter(p => !p.isSurface);
    
    const targetSurfaceCount = Math.floor(targetCount * surfaceRatio);
    if (surfacePoints.length < targetSurfaceCount && internalPoints.length > 0) {
      const deficit = targetSurfaceCount - surfacePoints.length;
      
      internalPoints.sort((a, b) => {
        const distA = this._distanceToSurface(a.position, coefficients, sphericalHarmonics);
        const distB = this._distanceToSurface(b.position, coefficients, sphericalHarmonics);
        return distA - distB;
      });
      
      for (let i = 0; i < Math.min(deficit, internalPoints.length); i++) {
        internalPoints[i].isSurface = true;
        surfacePoints.push(internalPoints[i]);
      }
      
      const finalInternal = internalPoints.filter(p => !p.isSurface);
      return { surfacePoints, internalPoints: finalInternal };
    }
    
    return { surfacePoints, internalPoints };
  }

  _distanceToSurface(position, coefficients, sphericalHarmonics) {
    const dx = position.x - this.center.x;
    const dy = position.y - this.center.y;
    const dz = position.z - this.center.z;
    const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (rCart < 1e-10) return 0;
    
    const theta = Math.acos(dz / rCart);
    const phi = Math.atan2(dy, dx);
    const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);
    
    return Math.abs(rCart - rSH);
  }

  _buildSurfaceTopologyByVisibility(surfacePoints, knn) {
    const { coefficients, sphericalHarmonics } = this.representation.data;
    
    const triangles = [];
    const triangleSet = new Set();  // 去重
    const edges = new Set();
    const adjacency = new Map();
    
    for (let i = 0; i < surfacePoints.length; i++) {
      adjacency.set(i, []);
    }
    
    for (let i = 0; i < surfacePoints.length; i++) {
      const pi = surfacePoints[i].position;
      
      const neighbors = [];
      for (let j = 0; j < surfacePoints.length; j++) {
        if (i === j) continue;
        
        const pj = surfacePoints[j].position;
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        neighbors.push({ index: j, dist });
      }
      
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNeighbors = neighbors.slice(0, Math.min(knn, neighbors.length));
      
      for (let a = 0; a < kNeighbors.length; a++) {
        for (let b = a + 1; b < kNeighbors.length; b++) {
          const j = kNeighbors[a].index;
          const k = kNeighbors[b].index;
          const tri = [i, j, k];
          
          if (!this._isTriangleOutwardFacing(tri, surfacePoints)) {
            continue;
          }
          
          if (this._isTriangleOccluded(tri, surfacePoints, coefficients, sphericalHarmonics)) {
            continue;
          }
          
          // 去重：生成唯一键
          const sorted = [i, j, k].sort((a, b) => a - b);
          const triKey = `${sorted[0]}-${sorted[1]}-${sorted[2]}`;
          
          if (triangleSet.has(triKey)) {
            continue;  // 已存在，跳过
          }
          
          triangleSet.add(triKey);
          triangles.push(tri);
          this._addEdge(edges, adjacency, i, j);
          this._addEdge(edges, adjacency, j, k);
          this._addEdge(edges, adjacency, i, k);
        }
      }
    }
    
    return {
      triangles,
      edges: Array.from(edges).map(e => e.split('-').map(Number)),
      internalEdges: [],
      adjacency
    };
  }

  _isTriangleOutwardFacing(tri, surfacePoints) {
    const [i, j, k] = tri;
    const pi = surfacePoints[i].position;
    const pj = surfacePoints[j].position;
    const pk = surfacePoints[k].position;
    
    const e1 = { x: pj.x - pi.x, y: pj.y - pi.y, z: pj.z - pi.z };
    const e2 = { x: pk.x - pi.x, y: pk.y - pi.y, z: pk.z - pi.z };
    const normal = {
      x: e1.y * e2.z - e1.z * e2.y,
      y: e1.z * e2.x - e1.x * e2.z,
      z: e1.x * e2.y - e1.y * e2.x
    };
    
    const cx = (pi.x + pj.x + pk.x) / 3;
    const cy = (pi.y + pj.y + pk.y) / 3;
    const cz = (pi.z + pj.z + pk.z) / 3;
    
    const toCenter = {
      x: cx - this.center.x,
      y: cy - this.center.y,
      z: cz - this.center.z
    };
    
    const dot = normal.x * toCenter.x + normal.y * toCenter.y + normal.z * toCenter.z;
    return dot > 0;
  }

  _isTriangleOccluded(tri, surfacePoints, coefficients, sphericalHarmonics) {
    const [i, j, k] = tri;
    const pi = surfacePoints[i].position;
    const pj = surfacePoints[j].position;
    const pk = surfacePoints[k].position;
    
    const cx = (pi.x + pj.x + pk.x) / 3;
    const cy = (pi.y + pj.y + pk.y) / 3;
    const cz = (pi.z + pj.z + pk.z) / 3;
    
    const dx = cx - this.center.x;
    const dy = cy - this.center.y;
    const dz = cz - this.center.z;
    const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (rCart < 1e-10) return false;
    
    const theta = Math.acos(dz / rCart);
    const phi = Math.atan2(dy, dx);
    const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);
    
    return rCart < rSH * 0.85;
  }

  _addEdge(edges, adjacency, i, j) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    edges.add(key);
    
    if (!adjacency.get(i).includes(j)) {
      adjacency.get(i).push(j);
    }
    if (!adjacency.get(j).includes(i)) {
      adjacency.get(j).push(i);
    }
  }

  _buildBubbleSurfaceConstraints(edges, points, physicsModel) {
    const constraints = [];
    
    for (const [i, j] of edges) {
      const p1 = points[i];
      const p2 = points[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      const avgStiffness = 1000;
      const avgDamping = 10;
      
      if (physicsModel === 'pbd') {
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'surface',
          compliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'surface',
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    return constraints;
  }

  _buildBubbleInternalConstraints(internalPoints, surfaceCount, maxDist, knn, physicsModel) {
    const constraints = [];
    
    for (let i = 0; i < internalPoints.length; i++) {
      const pi = internalPoints[i].position;
      
      const neighbors = [];
      for (let j = 0; j < internalPoints.length; j++) {
        if (i === j) continue;
        
        const pj = internalPoints[j].position;
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < maxDist) {
          neighbors.push({ index: j, dist });
        }
      }
      
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNeighbors = neighbors.slice(0, Math.min(knn, neighbors.length));
      
      for (const { index: j, dist: restLength } of kNeighbors) {
        if (i >= j) continue;
        
        const globalI = surfaceCount + i;
        const globalJ = surfaceCount + j;
        
        // 使用材料刚度，内部骨架刚度为表面的 5 倍
        let baseStiffness = 1000;
        let baseDamping = 10;
        
        if (!this.representation.material.uniform && this.representation.material.properties) {
          const mat = this.getMaterialAt(pi);
          baseStiffness = mat.stiffness;
          baseDamping = mat.damping;
        }
        
        const internalStiffness = baseStiffness * 5;
        const internalDamping = baseDamping * 2;
        
        if (physicsModel === 'pbd') {
          const compliance = internalStiffness > 0 ? 1 / internalStiffness : 0;
          constraints.push({
            type: 'distance',
            i: globalI,
            j: globalJ,
            particles: [globalI, globalJ],
            restLength,
            distance: restLength,
            edgeType: 'internal',
            compliance
          });
        } else if (physicsModel === 'force') {
          constraints.push({
            type: 'spring',
            i: globalI,
            j: globalJ,
            particles: [globalI, globalJ],
            restLength,
            edgeType: 'internal',
            stiffness: internalStiffness,
            damping: internalDamping
          });
        }
      }
    }
    
    return constraints;
  }

  _buildSkinBoneConstraints(surfacePoints, internalPoints, surfaceCount, maxDist, physicsModel) {
    const constraints = [];
    
    for (let i = 0; i < surfacePoints.length; i++) {
      const pi = surfacePoints[i].position;
      
      // 获取表面点的材料属性
      let baseStiffness = 1000;
      let baseDamping = 10;
      
      if (!this.representation.material.uniform && this.representation.material.properties) {
        const mat = this.getMaterialAt(pi);
        baseStiffness = mat.stiffness;
        baseDamping = mat.damping;
      }
      
      // 皮骨连接刚度为表面的 2 倍
      const skinBoneStiffness = baseStiffness * 2;
      const skinBoneDamping = baseDamping * 1.5;
      
      for (let j = 0; j < internalPoints.length; j++) {
        const pj = internalPoints[j].position;
        
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < maxDist) {
          const globalJ = surfaceCount + j;
          
          if (physicsModel === 'pbd') {
            const compliance = skinBoneStiffness > 0 ? 1 / skinBoneStiffness : 0;
            constraints.push({
              type: 'distance',
              i: i,
              j: globalJ,
              particles: [i, globalJ],
              restLength: dist,
              distance: dist,
              edgeType: 'skinBone',
              compliance
            });
          } else if (physicsModel === 'force') {
            constraints.push({
              type: 'spring',
              i: i,
              j: globalJ,
              particles: [i, globalJ],
              restLength: dist,
              edgeType: 'skinBone',
              stiffness: skinBoneStiffness,
              damping: skinBoneDamping
            });
          }
        }
      }
    }
    
    return constraints;
  }

  // === 2D 有机布料生成 ===

  /**
   * 生成 2D 有机布料（基于椭圆傅里叶描述符）
   * 
   * ⭐ 核心流程：
   * 1. 拟合边界：使用 EFD 获取闭合曲线参数方程
   * 2. 2D 气泡填充：在边界内生成均匀分布的点
   * 3. 构建拓扑：三角剖分生成网格
   * 4. 物理状态：生成约束（Structural, Shear, Bend）
   * 
   * ⭐ 增量拟合支持：
   * - 初始化 this._fitStackX 和 this._fitStackY
   * - 未来可支持边界控制点拖拽编辑
   * 
   * @param {Array} boundaryPoints - 边界点集 [{x, y}, ...]（有序，闭合）
   * @param {Object} options - 配置选项
   * @param {Number} options.order - EFD 阶数（默认 5）
   * @param {Number} options.spacing - 点间距（默认 0.015，1.5cm）
   * @param {Number} options.targetCount - 目标点数（可选，自动计算）
   * @param {Number} options.relaxIterations - 松弛迭代次数（默认 20）
   * @param {Number} options.surfaceRatio - 表面点比例（默认 0.4）
   * @param {String} options.physicsModel - 物理模型（默认 'pbd'）
   * @param {Object} options.fitter - FittingCalculator 类
   * @param {Object} options.Matrix - Matrix 类
   * @returns {Object} 生成结果
   * 
   * @example
   * const boundaryPoints = [
   *   { x: 0, y: 0 },
   *   { x: 1, y: 0 },
   *   { x: 1, y: 1 },
   *   { x: 0, y: 1 }
   * ];
   * 
   * const result = obj.generateOrganicCloth(boundaryPoints, {
   *   order: 5,
   *   spacing: 0.015,
   *   fitter: FittingCalculator,
   *   Matrix: Matrix
   * });
   */
  generateOrganicCloth(boundaryPoints, options = {}) {
    if (!boundaryPoints || boundaryPoints.length < 3) {
      throw new Error('At least 3 boundary points are required');
    }

    const order = options.order ?? 5;
    const spacing = options.spacing ?? 0.015;  // 1.5cm
    const relaxIterations = options.relaxIterations ?? 20;
    const surfaceRatio = options.surfaceRatio ?? 0.4;
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';

    const FittingCalculator = options.fitter;
    const Matrix = options.Matrix;

    if (!FittingCalculator) {
      throw new Error('FittingCalculator (fitter) required in options');
    }

    if (!Matrix) {
      throw new Error('Matrix class required in options');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 1: 拟合边界（椭圆傅里叶描述符）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (!this._fittingCalculator) {
      this._fittingCalculator = new FittingCalculator({
        Matrix,
        verbose: this.verbose
      });
    }

    const fitter = this._fittingCalculator;

    // ⭐ 使用非增量版本进行首次拟合（完整边界）
    const fitResult = fitter.fit2DEllipticFourier(boundaryPoints, order, {
      verbose: this.verbose
    });

    if (this.verbose) {
      console.log(`[Object] EFD fit: order=${order}, residualX=${fitResult.residualX.toExponential(3)}, residualY=${fitResult.residualY.toExponential(3)}`);
    }

    // ⭐ 初始化增量拟合状态栈（为未来的边界编辑做准备）
    this._fitStackX = [];
    this._fitStackY = [];

    // 存储 EFD 表示
    this.representation = {
      type: 'elliptic-fourier-2d',
      isClosed: true,
      data: {
        coeffsX: fitResult.coeffsX,
        coeffsY: fitResult.coeffsY,
        order: fitResult.order,
        fitResult  // 保留完整结果（包含 evaluate 函数）
      },
      physicsState: this.representation?.physicsState ?? {
        physicsModel,
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

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 2: 计算目标点数（2D 版本）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let targetCount = options.targetCount;

    if (targetCount === undefined) {
      // 计算边界框
      const bbox = this._compute2DBoundingBox(boundaryPoints);
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;

      // 面积估算
      const area = width * height * 0.7;  // 假设填充率 70%

      // 点数估算：N ≈ Area / spacing²
      const estimatedCount = Math.round(area / (spacing * spacing));

      // 安全上限
      const safetyLimit = 3000;
      targetCount = Math.min(estimatedCount, safetyLimit);

      // 最小值
      targetCount = Math.max(targetCount, 30);

      if (this.verbose) {
        console.log(`[Object] Auto-calculated targetCount: ${targetCount} (estimated: ${estimatedCount}, area: ${area.toFixed(4)})`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 3: 2D 气泡填充
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const { surfacePoints, internalPoints } = this._generate2DBubblePacking(
      fitResult,
      targetCount,
      spacing,
      relaxIterations,
      surfaceRatio
    );

    if (this.verbose) {
      console.log(`[Object] 2D bubble packing: ${surfacePoints.length} surface, ${internalPoints.length} internal`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 4: 构建拓扑（三角剖分）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const topology = this._build2DTopology(surfacePoints, internalPoints, spacing * 2.5);

    if (this.verbose) {
      console.log(`[Object] 2D topology: ${topology.triangles.length} triangles, ${topology.edges.length} edges`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 5: 创建物理粒子
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 更新 surfacePoints（指针切换）
    const newSurfacePoints = surfacePoints.map(sp =>
      new Point(sp.position.x, sp.position.y, 0)  // 2D: z = 0
    );

    const globalMassScale = this.physics.mass || 1.0;
    const surfaceMass = globalMassScale * 0.6 / surfacePoints.length;
    const internalMass = globalMassScale * 0.4 / internalPoints.length;

    const surfaceParticles = newSurfacePoints.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: 0 },
          prevPosition: { x: point.x, y: point.y, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }

      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: surfaceMass,
        invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
        fixed: false,
        _index: index,
        _type: 'surface'
      };
    });

    const internalParticles = internalPoints.map((node, index) => {
      return {
        position: node.position,
        prevPosition: { x: node.position.x, y: node.position.y, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        mass: internalMass,
        invMass: internalMass > 0 ? 1 / internalMass : 0,
        fixed: false,
        _index: surfacePoints.length + index,
        _type: 'internal'
      };
    });

    const particles = [...surfaceParticles, ...internalParticles];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 6: 构建约束
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const structuralConstraints = this._build2DStructuralConstraints(topology.edges, physicsModel);
    const shearConstraints = this._build2DShearConstraints(topology.triangles, physicsModel);
    const bendConstraints = this._build2DBendConstraints(topology.edges, topology.adjacency, physicsModel);

    const constraints = [...structuralConstraints, ...shearConstraints, ...bendConstraints];

    if (this.verbose) {
      console.log(`[Object] 2D constraints: ${structuralConstraints.length} structural, ${shearConstraints.length} shear, ${bendConstraints.length} bend`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 7: 更新物理状态
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.representation.physicsState = {
      physicsModel,
      particles,
      constraints,
      surfaceStartIndex: 0,
      internalStartIndex: surfacePoints.length,
      surfaceCount: surfacePoints.length,
      internalCount: internalPoints.length
    };

    this.representation.topology = topology;

    this.surfacePoints = newSurfacePoints;
    this._isVolumetric = true;

    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();

    if (this.verbose) {
      console.log(`[Object] Organic cloth generated: ${this.surfacePoints.length} surface points (mode=${this.mode}, call rebuildPhysicsTopology() to enable physics)`);
    }

    return {
      surfacePoints: surfacePoints.length,
      internalPoints: internalPoints.length,
      structuralConstraints: structuralConstraints.length,
      shearConstraints: shearConstraints.length,
      bendConstraints: bendConstraints.length,
      triangles: topology.triangles.length,
      edges: topology.edges.length,
      fitResult,
      isVolumetric: this._isVolumetric,
      controlPointsPreserved: this.controlPoints.length,
      mode: this.mode
    };
  }

  /**
   * 2D 气泡填充算法
   * 
   * @private
   * @param {Object} fitResult - EFD 拟合结果
   * @param {Number} targetCount - 目标点数
   * @param {Number} spacing - 点间距
   * @param {Number} iterations - 松弛迭代次数
   * @param {Number} surfaceRatio - 表面点比例
   * @returns {Object} { surfacePoints, internalPoints }
   */
  _generate2DBubblePacking(fitResult, targetCount, spacing, iterations, surfaceRatio) {
    // 计算边界框
    const samples = fitResult.sample(100);
    const bbox = this._compute2DBoundingBox(samples);

    const boxWidth = bbox.max.x - bbox.min.x;
    const boxHeight = bbox.max.y - bbox.min.y;

    // 随机撒点
    const points = [];
    const cx = (bbox.min.x + bbox.max.x) / 2;
    const cy = (bbox.min.y + bbox.max.y) / 2;

    for (let i = 0; i < targetCount; i++) {
      const x = cx + (Math.random() - 0.5) * boxWidth;
      const y = cy + (Math.random() - 0.5) * boxHeight;

      // 检查是否在边界内
      if (this._isPointInsideEFD(x, y, fitResult)) {
        points.push({
          position: { x, y, z: 0 },
          isSurface: false
        });
      }
    }

    if (this.verbose) {
      console.log(`[Object] 2D bubble packing: ${points.length} points inside boundary`);
    }

    // 松弛迭代（2D 斥力）
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < points.length; i++) {
        const pi = points[i].position;
        let fx = 0, fy = 0;

        for (let j = 0; j < points.length; j++) {
          if (i === j) continue;

          const pj = points[j].position;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < spacing && dist > 1e-6) {
            const force = (spacing - dist) / dist;
            fx += dx * force;
            fy += dy * force;
          }
        }

        // 更新位置
        pi.x += fx * 0.1;
        pi.y += fy * 0.1;

        // 边界约束（保持在 EFD 内部）
        if (!this._isPointInsideEFD(pi.x, pi.y, fitResult)) {
          // 投影到最近的边界点
          const projected = this._projectToEFDBoundary(pi.x, pi.y, fitResult);
          pi.x = projected.x;
          pi.y = projected.y;
        }
      }
    }

    // 标记表面点（距离边界最近的点）
    const surfaceCount = Math.floor(points.length * surfaceRatio);
    const pointsWithDist = points.map(p => ({
      point: p,
      distToBoundary: this._distanceToEFDBoundary(p.position.x, p.position.y, fitResult)
    }));

    // 按距离排序
    pointsWithDist.sort((a, b) => a.distToBoundary - b.distToBoundary);

    // 前 surfaceCount 个标记为表面点
    for (let i = 0; i < surfaceCount; i++) {
      pointsWithDist[i].point.isSurface = true;
    }

    // 吸附表面点到边界
    for (let i = 0; i < surfaceCount; i++) {
      const p = pointsWithDist[i].point.position;
      const projected = this._projectToEFDBoundary(p.x, p.y, fitResult);
      p.x = projected.x;
      p.y = projected.y;
    }

    const surfacePoints = points.filter(p => p.isSurface);
    const internalPoints = points.filter(p => !p.isSurface);

    return { surfacePoints, internalPoints };
  }

  /**
   * 判断点是否在 EFD 边界内（射线法）
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Boolean} 是否在内部
   */
  _isPointInsideEFD(x, y, fitResult) {
    // 射线法：从点发射水平射线，计算与边界的交点数
    // 奇数个交点 → 在内部，偶数个交点 → 在外部

    const samples = fitResult.sample(100);
    let intersections = 0;

    for (let i = 0; i < samples.length; i++) {
      const p1 = samples[i];
      const p2 = samples[(i + 1) % samples.length];

      // 检查线段 (p1, p2) 是否与射线 (x, y) → (+∞, y) 相交
      if ((p1.y > y) !== (p2.y > y)) {
        // 计算交点的 x 坐标
        const xIntersect = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);

        if (xIntersect > x) {
          intersections++;
        }
      }
    }

    return intersections % 2 === 1;
  }

  /**
   * 投影点到 EFD 边界
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Object} { x, y }
   */
  _projectToEFDBoundary(x, y, fitResult) {
    const samples = fitResult.sample(100);
    let minDist = Infinity;
    let closest = null;

    for (const sample of samples) {
      const dx = sample.x - x;
      const dy = sample.y - y;
      const dist = dx * dx + dy * dy;

      if (dist < minDist) {
        minDist = dist;
        closest = sample;
      }
    }

    return closest || { x, y };
  }

  /**
   * 计算点到 EFD 边界的距离
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Number} 距离
   */
  _distanceToEFDBoundary(x, y, fitResult) {
    const projected = this._projectToEFDBoundary(x, y, fitResult);
    const dx = projected.x - x;
    const dy = projected.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 构建 2D 拓扑（三角剖分）
   * 
   * 使用简单的"最近邻连接法"：
   * - 对每个点，连接到最近的 K 个邻居
   * - 使用 Delaunay 风格的连接策略
   * 
   * @private
   * @param {Array} surfacePoints - 表面点
   * @param {Array} internalPoints - 内部点
   * @param {Number} maxDist - 最大连接距离
   * @returns {Object} { triangles, edges, adjacency }
   */
  _build2DTopology(surfacePoints, internalPoints, maxDist) {
    const allPoints = [...surfacePoints, ...internalPoints];
    const n = allPoints.length;

    const edges = [];
    const edgeSet = new Set();

    // 为每个点找到最近的 K 个邻居
    const K = 6;  // 2D 网格平均连接数

    for (let i = 0; i < n; i++) {
      const pi = allPoints[i].position;

      // 计算到所有其他点的距离
      const neighbors = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;

        const pj = allPoints[j].position;
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          neighbors.push({ index: j, dist });
        }
      }

      // 按距离排序，取前 K 个
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNearest = neighbors.slice(0, K);

      // 添加边
      for (const neighbor of kNearest) {
        const a = Math.min(i, neighbor.index);
        const b = Math.max(i, neighbor.index);
        const edgeKey = `${a}-${b}`;

        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push([a, b]);
        }
      }
    }

    // 构建三角形（简化版：使用贪心策略）
    const triangles = [];
    const triangleSet = new Set();

    for (let i = 0; i < n; i++) {
      const pi = allPoints[i].position;

      // 找到相邻的点
      const adjacentIndices = [];
      for (const [a, b] of edges) {
        if (a === i) adjacentIndices.push(b);
        if (b === i) adjacentIndices.push(a);
      }

      // 尝试形成三角形
      for (let j = 0; j < adjacentIndices.length; j++) {
        for (let k = j + 1; k < adjacentIndices.length; k++) {
          const idx1 = adjacentIndices[j];
          const idx2 = adjacentIndices[k];

          // 检查 idx1 和 idx2 是否相邻
          const edgeKey = `${Math.min(idx1, idx2)}-${Math.max(idx1, idx2)}`;
          if (edgeSet.has(edgeKey)) {
            // 形成三角形
            const tri = [i, idx1, idx2].sort((a, b) => a - b);
            const triKey = tri.join('-');

            if (!triangleSet.has(triKey)) {
              triangleSet.add(triKey);
              triangles.push(tri);
            }
          }
        }
      }
    }

    // 构建邻接表
    const adjacency = Array(n).fill(null).map(() => []);
    for (const [a, b] of edges) {
      adjacency[a].push(b);
      adjacency[b].push(a);
    }

    return {
      triangles,
      edges,
      adjacency
    };
  }

  /**
   * 构建 2D 结构约束（Structural）
   * 
   * @private
   * @param {Array} edges - 边列表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */
  _build2DStructuralConstraints(edges, physicsModel) {
    const constraints = [];
    const stiffness = physicsModel === 'pbd' ? 1.0 : 1000.0;

    for (const [a, b] of edges) {
      constraints.push({
        type: 'distance',
        particleA: a,
        particleB: b,
        restLength: null,  // 将在首次物理步中计算
        stiffness,
        edgeType: 'structural'
      });
    }

    return constraints;
  }

  /**
   * 构建 2D 剪切约束（Shear）
   * 
   * @private
   * @param {Array} triangles - 三角形列表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */
  _build2DShearConstraints(triangles, physicsModel) {
    const constraints = [];
    const stiffness = physicsModel === 'pbd' ? 1.0 : 500.0;

    // 对每个三角形，添加对角线约束
    for (const [a, b, c] of triangles) {
      // 添加 a-b, b-c, c-a 的对角线（如果不是结构边）
      // 简化：直接添加所有三条边的约束
      constraints.push({
        type: 'distance',
        particleA: a,
        particleB: b,
        restLength: null,
        stiffness,
        edgeType: 'shear'
      });

      constraints.push({
        type: 'distance',
        particleA: b,
        particleB: c,
        restLength: null,
        stiffness,
        edgeType: 'shear'
      });

      constraints.push({
        type: 'distance',
        particleA: c,
        particleB: a,
        restLength: null,
        stiffness,
        edgeType: 'shear'
      });
    }

    return constraints;
  }

  /**
   * 构建 2D 弯曲约束（Bend）
   * 
   * @private
   * @param {Array} edges - 边列表
   * @param {Array} adjacency - 邻接表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */
  _build2DBendConstraints(edges, adjacency, physicsModel) {
    const constraints = [];
    const stiffness = physicsModel === 'pbd' ? 0.5 : 200.0;

    // 对每条边，找到相邻的两个三角形，添加弯曲约束
    for (const [a, b] of edges) {
      // 找到 a 和 b 的共同邻居
      const neighborsA = new Set(adjacency[a]);
      const neighborsB = new Set(adjacency[b]);

      const commonNeighbors = [...neighborsA].filter(n => neighborsB.has(n) && n !== a && n !== b);

      if (commonNeighbors.length >= 2) {
        // 添加弯曲约束：连接对角顶点
        const c = commonNeighbors[0];
        const d = commonNeighbors[1];

        constraints.push({
          type: 'distance',
          particleA: c,
          particleB: d,
          restLength: null,
          stiffness,
          edgeType: 'bend'
        });
      }
    }

    return constraints;
  }

  /**
   * 计算 2D 边界框
   * 
   * @private
   * @param {Array} points - 点集
   * @returns {Object} { min: {x, y}, max: {x, y} }
   */
  _compute2DBoundingBox(points) {
    if (points.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY }
    };
  }

  // === 材料参数 ===
  
  setMaterialProperties(propertyFunc) {
    this.representation.material.uniform = false;
    this.representation.material.properties = propertyFunc;
  }

  getMaterialAt(point) {
    if (this.representation.material.uniform) {
      return { stiffness: 1000, damping: 10, mass: 1.0 };
    }

    const dx = point.x - this.center.x;
    const dy = point.y - this.center.y;
    const dz = point.z - this.center.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (r < 1e-10) {
      return this.getMaterialAt({ x: point.x + 0.01, y: point.y, z: point.z });
    }

    const theta = Math.acos(dz / r);
    const phi = Math.atan2(dy, dx);

    return this.representation.material.properties(theta, phi);
  }

  // === 物理拓扑重建 ===

  /**
   * 重建物理拓扑（唯一合法物理入口）
   * 
   * 清空旧物理数据，重新生成 particles 和 constraints，
   * 强制设置 this.mode = 'discrete'，使对象可被物理系统访问。
   * 
   * 支持的类型：cloth, elliptic-fourier-2d, spherical-harmonics, line, points
   * 
   * @param {Object} options
   * @param {Boolean} options.force - 强制重建约束
   * @returns {Object} 重建结果统计
   */
  rebuildPhysicsTopology(options = {}) {
    const force = options.force ?? false;

    if (this.surfacePoints.length === 0) {
      throw new Error(
        `[Object] 无法重建物理拓扑：surfacePoints 为空。\n` +
        `  请先调用生成方法：generateClothMesh/generateOrganicCloth/generateVolumetricMesh/defineLineTopology\n` +
        `  对象：${this.metadata.name}`
      );
    }

    if (this.verbose) {
      console.log(`[Object] Rebuilding physics topology (type: ${this.representation.type})`);
    }

    const oldParticleCount = this.representation.physicsState?.particles?.length ?? 0;
    const oldConstraintCount = this.representation.physicsState?.constraints?.length ?? 0;

    // ⚠️ 关键：保存旧的物理状态（内部粒子数据）
    const oldPhysicsState = this.representation.physicsState;
    
    // 清空物理数据
    this.representation.physicsState = {
      physicsModel: this.physics.model ?? 'pbd',
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: 0,
      surfaceCount: 0,
      internalCount: 0
    };

    const type = this.representation.type;
    let particles = [];
    let constraints = [];
    const globalMassScale = this.physics.mass ?? 1.0;

    if (type === 'cloth' || type === 'elliptic-fourier-2d' || type === 'spherical-harmonics') {
      
      if (this.representation.topology.triangles.length > 0 && !force) {
        const topology = this.representation.topology;

        if (this._isVolumetric && oldPhysicsState.surfaceCount > 0) {
          // 体积网格：表面点 + 内部点
          const surfaceCount = oldPhysicsState.surfaceCount;
          const internalCount = oldPhysicsState.internalCount;

          const surfaceMass = globalMassScale * 0.6 / surfaceCount;
          const internalMass = globalMassScale * 0.4 / internalCount;

          // 表面粒子
          for (let i = 0; i < surfaceCount; i++) {
            const point = this.surfacePoints[i];
            if (!point._physicsData) {
              point._physicsData = {
                position: { x: point.x, y: point.y, z: point.z },
                prevPosition: { x: point.x, y: point.y, z: point.z },
                velocity: { x: 0, y: 0, z: 0 },
                fixed: false
              };
            }

            const newParticle = {
              position: point._physicsData.position,
              prevPosition: point._physicsData.prevPosition,
              velocity: point._physicsData.velocity,
              mass: surfaceMass,
              invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
              fixed: point._physicsData.fixed,
              _index: i,
              _type: 'surface'
            };
            
            // 保留旧粒子的 _sphericalCoords（如果存在且有效）
            const oldParticle = oldPhysicsState.particles?.[i];
            if (oldParticle && oldParticle._sphericalCoords) {
              newParticle._sphericalCoords = oldParticle._sphericalCoords;
            }
            
            particles.push(newParticle);
          }

          // 内部粒子：从旧状态恢复
          if (internalCount > 0 && oldPhysicsState.particles) {
            const internalStartIdx = oldPhysicsState.internalStartIndex;
            for (let i = 0; i < internalCount; i++) {
              const oldParticle = oldPhysicsState.particles[internalStartIdx + i];
              if (oldParticle) {
                const newParticle = {
                  position: oldParticle.position,
                  prevPosition: oldParticle.prevPosition,
                  velocity: oldParticle.velocity,
                  mass: internalMass,
                  invMass: internalMass > 0 ? 1 / internalMass : 0,
                  fixed: false,
                  _index: surfaceCount + i,
                  _type: 'internal'
                };
                
                // 保留旧粒子的 _sphericalCoords（如果存在）
                if (oldParticle._sphericalCoords) {
                  newParticle._sphericalCoords = oldParticle._sphericalCoords;
                }
                
                particles.push(newParticle);
              }
            }
          }
        } else {
          // 非体积网格：只有表面点
          const uniformMass = globalMassScale / this.surfacePoints.length;

          for (let i = 0; i < this.surfacePoints.length; i++) {
            const point = this.surfacePoints[i];
            if (!point._physicsData) {
              point._physicsData = {
                position: { x: point.x, y: point.y, z: point.z },
                prevPosition: { x: point.x, y: point.y, z: point.z },
                velocity: { x: 0, y: 0, z: 0 },
                fixed: false
              };
            }

            let particleMass = uniformMass;
            if (!this.representation.material.uniform && this.representation.material.properties) {
              const mat = this.getMaterialAt(point);
              if (mat && mat.mass !== undefined) {
                particleMass = mat.mass * globalMassScale / this.surfacePoints.length;
              }
            }

            particles.push({
              position: point._physicsData.position,
              prevPosition: point._physicsData.prevPosition,
              velocity: point._physicsData.velocity,
              mass: particleMass,
              invMass: particleMass > 0 ? 1 / particleMass : 0,
              fixed: point._physicsData.fixed,
              _index: i,
              _type: 'surface'
            });
          }
        }

        // 生成约束：如果有预生成的约束，复用它们
        if (oldPhysicsState.constraints && oldPhysicsState.constraints.length > 0 && !force) {
          constraints = oldPhysicsState.constraints;
        } else if (topology.edges.length > 0) {
          // 临时设置 particles 以便约束构建方法使用
          this.representation.physicsState.particles = particles;
          constraints = this._buildPhysicsConstraints();
        }

      } else {
        // 没有预生成拓扑，简单网格
        const uniformMass = globalMassScale / this.surfacePoints.length;

        for (let i = 0; i < this.surfacePoints.length; i++) {
          const point = this.surfacePoints[i];
          if (!point._physicsData) {
            point._physicsData = {
              position: { x: point.x, y: point.y, z: point.z },
              prevPosition: { x: point.x, y: point.y, z: point.z },
              velocity: { x: 0, y: 0, z: 0 },
              fixed: false
            };
          }

          particles.push({
            position: point._physicsData.position,
            prevPosition: point._physicsData.prevPosition,
            velocity: point._physicsData.velocity,
            mass: uniformMass,
            invMass: uniformMass > 0 ? 1 / uniformMass : 0,
            fixed: point._physicsData.fixed,
            _index: i
          });
        }

        this.representation.physicsState.particles = particles;
        constraints = this._buildPhysicsConstraints();
      }

    } else if (type === 'line') {
      const uniformMass = globalMassScale / this.surfacePoints.length;

      for (let i = 0; i < this.surfacePoints.length; i++) {
        const point = this.surfacePoints[i];
        if (!point._physicsData) {
          point._physicsData = {
            position: { x: point.x, y: point.y, z: point.z },
            prevPosition: { x: point.x, y: point.y, z: point.z },
            velocity: { x: 0, y: 0, z: 0 },
            fixed: false
          };
        }

        particles.push({
          position: point._physicsData.position,
          prevPosition: point._physicsData.prevPosition,
          velocity: point._physicsData.velocity,
          mass: uniformMass,
          invMass: uniformMass > 0 ? 1 / uniformMass : 0,
          fixed: point._physicsData.fixed,
          _index: i
        });
      }

      constraints = this._buildLineConstraints();

    } else if (type === 'points') {
      const uniformMass = globalMassScale / this.surfacePoints.length;

      for (let i = 0; i < this.surfacePoints.length; i++) {
        const point = this.surfacePoints[i];
        if (!point._physicsData) {
          point._physicsData = {
            position: { x: point.x, y: point.y, z: point.z },
            prevPosition: { x: point.x, y: point.y, z: point.z },
            velocity: { x: 0, y: 0, z: 0 },
            fixed: false
          };
        }

        particles.push({
          position: point._physicsData.position,
          prevPosition: point._physicsData.prevPosition,
          velocity: point._physicsData.velocity,
          mass: uniformMass,
          invMass: uniformMass > 0 ? 1 / uniformMass : 0,
          fixed: point._physicsData.fixed,
          _index: i
        });
      }

      constraints = [];

    } else {
      throw new Error(
        `[Object] 不支持的 representation 类型：${type}\n` +
        `  支持：cloth, elliptic-fourier-2d, spherical-harmonics, line, points`
      );
    }

    // 应用编辑态约束（固定点）
    if (this.representation.editState?.constraints) {
      for (const ec of this.representation.editState.constraints) {
        if (ec.type === 'fixed') {
          for (const idx of ec.particles) {
            if (idx >= 0 && idx < particles.length) {
              particles[idx].fixed = true;
              particles[idx].invMass = 0;
              if (idx < this.surfacePoints.length) {
                this.surfacePoints[idx]._physicsData.fixed = true;
              }
            }
          }
        }
      }
    }

    // 更新物理状态
    this.representation.physicsState.particles = particles;
    this.representation.physicsState.constraints = constraints;
    this.representation.physicsState.surfaceCount = this.surfacePoints.length;

    // ⚠️ 设置 mode = 'discrete'（唯一入口）
    this.mode = 'discrete';

    // 验证约束语义（开发模式）
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
      this._validateConstraintSemantics(constraints);
    }

    if (this.verbose) {
      console.log(
        `[Object] Physics rebuilt: ${oldParticleCount}→${particles.length} particles, ` +
        `${oldConstraintCount}→${constraints.length} constraints, mode=${this.mode}`
      );
    }

    return {
      particles: particles.length,
      constraints: constraints.length,
      mode: this.mode,
      type: this.representation.type,
      isVolumetric: this._isVolumetric
    };
  }

  // === 物理接口（零拷贝）===

  /**
   * 获取物理视图（强约束）
   * 
   * 只有 mode === 'discrete' 的对象才能被物理系统访问。
   * 非 discrete 模式直接抛出 Error。
   * 
   * @returns {Object} { particles, constraints, commit }
   * @throws {Error} 当 mode !== 'discrete'
   */
  getPhysicsView() {
    if (this.mode !== 'discrete') {
      throw new Error(
        `[Object] 非法物理访问：当前 Object 不是可物理对象。\n` +
        `  当前模式：${this.mode}\n` +
        `  要求模式：discrete\n` +
        `  解决方案：\n` +
        `    1. 如果是 mesh/cloth/line，调用 rebuildPhysicsTopology()\n` +
        `    2. 如果是球谐/拟合对象，不能进入物理系统\n` +
        `  对象名称：${this.metadata.name}`
      );
    }

    const particles = this.representation.physicsState.particles;
    const constraints = this.representation.physicsState.constraints;

    if (!particles || particles.length === 0) {
      throw new Error(
        `[Object] 物理数据不完整：particles 为空。\n` +
        `  这通常意味着 rebuildPhysicsTopology() 未正确执行。\n` +
        `  对象名称：${this.metadata.name}`
      );
    }

    if (!constraints) {
      throw new Error(
        `[Object] 物理数据不完整：constraints 未定义。\n` +
        `  这通常意味着 rebuildPhysicsTopology() 未正确执行。\n` +
        `  对象名称：${this.metadata.name}`
      );
    }

    const commit = () => {
      for (let i = 0; i < particles.length && i < this.surfacePoints.length; i++) {
        const particle = particles[i];
        const point = this.surfacePoints[i];
        
        point.x = particle.position.x;
        point.y = particle.position.y;
        point.z = particle.position.z;
      }
      
      this._onSurfacePositionsUpdated();
    };

    return { particles, constraints, commit };
  }

  _onSurfacePositionsUpdated() {
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    // ⭐ 更新法向量（用于渲染）
    this._updateNormals();
  }

  /**
   * 更新表面法向量（用于渲染）
   * 
   * 算法：加权面法向累加法 (Weighted Face Normal Accumulation)
   * 
   * 步骤：
   * 1. 清零所有表面点的法向
   * 2. 遍历三角形，计算面法向
   * 3. 将面法向累加到三个顶点
   * 4. 归一化所有顶点法向
   * 
   * 优势：
   * - 考虑三角形面积权重
   * - 自动处理共享顶点
   * - 平滑的法向过渡
   * 
   * @private
   */
  _updateNormals() {
    const topology = this.representation.topology;
    if (!topology || !topology.triangles) {
      return;  // 没有拓扑信息，跳过
    }

    const particles = this.representation.physicsState?.particles;
    if (!particles) {
      return;  // 没有物理粒子，跳过
    }

    const surfaceCount = this.representation.physicsState?.surfaceCount || this.surfacePoints.length;

    // 步骤 1: 清零所有表面点的法向
    for (let i = 0; i < surfaceCount; i++) {
      const p = particles[i];
      if (!p.normal) {
        p.normal = { x: 0, y: 0, z: 0 };
      } else {
        p.normal.x = 0;
        p.normal.y = 0;
        p.normal.z = 0;
      }
    }

    // 步骤 2 & 3: 遍历三角形，计算并累加面法向
    for (const tri of topology.triangles) {
      const [ia, ib, ic] = tri;

      // 跳过无效索引
      if (ia >= surfaceCount || ib >= surfaceCount || ic >= surfaceCount) {
        continue;
      }

      const pa = particles[ia].position;
      const pb = particles[ib].position;
      const pc = particles[ic].position;

      // 计算边向量
      const abx = pb.x - pa.x;
      const aby = pb.y - pa.y;
      const abz = pb.z - pa.z;

      const acx = pc.x - pa.x;
      const acy = pc.y - pa.y;
      const acz = pc.z - pa.z;

      // 叉积：面法向 = AB × AC
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      // 面法向的模长（面积的两倍）作为权重
      // 不归一化，让大三角形贡献更多权重

      // 累加到三个顶点
      particles[ia].normal.x += nx;
      particles[ia].normal.y += ny;
      particles[ia].normal.z += nz;

      particles[ib].normal.x += nx;
      particles[ib].normal.y += ny;
      particles[ib].normal.z += nz;

      particles[ic].normal.x += nx;
      particles[ic].normal.y += ny;
      particles[ic].normal.z += nz;
    }

    // 步骤 4: 归一化所有顶点法向
    for (let i = 0; i < surfaceCount; i++) {
      const n = particles[i].normal;
      const mag = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);

      if (mag > 1e-10) {
        n.x /= mag;
        n.y /= mag;
        n.z /= mag;
      } else {
        // 退化情况：使用默认法向
        n.x = 0;
        n.y = 1;
        n.z = 0;
      }
    }
  }

  _validateConstraintSemantics(constraints) {
    const errors = [];
    const edgeMap = new Map();

    for (let idx = 0; idx < constraints.length; idx++) {
      const c = constraints[idx];
      
      if (c.type === 'distance') {
        if (c.stiffness !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'stiffness' not allowed. Use 'compliance'.`);
        }
        if (c.damping !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'damping' not allowed.`);
        }
        if (c.k !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'k' not allowed. Use 'compliance'.`);
        }
        
        if (c.restLength === undefined && c.distance === undefined) {
          errors.push(`Constraint ${idx} (distance): Missing 'restLength' or 'distance'.`);
        }
        
        const i = c.i ?? c.particles?.[0];
        const j = c.j ?? c.particles?.[1];
        if (i === undefined || j === undefined) {
          errors.push(`Constraint ${idx} (distance): Missing particle indices.`);
        } else {
          const edgeKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, []);
          }
          edgeMap.get(edgeKey).push({ type: 'distance', index: idx });
        }
      }
      
      else if (c.type === 'spring') {
        if (c.compliance !== undefined) {
          errors.push(`Constraint ${idx} (spring): 'compliance' not allowed. Use 'stiffness'.`);
        }
        if (c.lambda !== undefined) {
          errors.push(`Constraint ${idx} (spring): 'lambda' not allowed.`);
        }
        
        if (c.stiffness === undefined) {
          errors.push(`Constraint ${idx} (spring): Missing 'stiffness'.`);
        }
        
        const i = c.i ?? c.particles?.[0];
        const j = c.j ?? c.particles?.[1];
        if (i === undefined || j === undefined) {
          errors.push(`Constraint ${idx} (spring): Missing particle indices.`);
        } else {
          const edgeKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, []);
          }
          edgeMap.get(edgeKey).push({ type: 'spring', index: idx });
        }
      }
      
      else if (c.type === 'bending' || c.type === 'line_bending') {
        if (c.stiffness !== undefined) {
          errors.push(`Constraint ${idx} (${c.type}): 'stiffness' not allowed. Use 'compliance'.`);
        }
        if (c.damping !== undefined) {
          errors.push(`Constraint ${idx} (${c.type}): 'damping' not allowed.`);
        }
        
        if (c.compliance === undefined) {
          errors.push(`Constraint ${idx} (${c.type}): Missing 'compliance'.`);
        }
        
        if (!c.particles || c.particles.length < 3) {
          errors.push(`Constraint ${idx} (${c.type}): Invalid 'particles' array.`);
        }
      }
    }
    
    for (const [edgeKey, constraintList] of edgeMap) {
      if (constraintList.length > 1) {
        const types = constraintList.map(c => c.type);
        const hasDistance = types.includes('distance');
        const hasSpring = types.includes('spring');
        
        if (hasDistance && hasSpring) {
          errors.push(`Edge ${edgeKey} has both 'distance' and 'spring' constraints.`);
        }
      }
    }

    if (errors.length > 0) {
      console.error('Constraint semantic validation failed:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      throw new Error(`Found ${errors.length} constraint semantic errors`);
    }
  }

  _buildPhysicsConstraints() {
    const constraints = [];
    
    if (this.representation.topology.edges.length === 0) {
      console.warn('No topology available for physics constraints.');
      return constraints;
    }

    const { edges } = this.representation.topology;
    const physicsModel = this.physics.model || 'pbd';
    
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          compliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    return constraints;
  }

  _positionKey(pos) {
    const precision = 1000;
    return `${Math.round(pos.x * precision)},${Math.round(pos.y * precision)},${Math.round(pos.z * precision)}`;
  }

  // === 调试 ===
  
  getDebugInfo() {
    return {
      surfacePoints: this.surfacePoints.length,
      controlPoints: this.controlPoints.length,
      representation: this.representation.type,
      isClosed: this.representation.isClosed,
      isVolumetric: this._isVolumetric,
      topology: {
        triangles: this.representation.topology.triangles.length,
        edges: this.representation.topology.edges.length
      },
      physicsState: {
        particles: this.representation.physicsState?.particles?.length ?? 0,
        constraints: this.representation.physicsState?.constraints?.length ?? 0,
        surfaceCount: this.representation.physicsState?.surfaceCount ?? 0,
        internalCount: this.representation.physicsState?.internalCount ?? 0
      }
    };
  }

  /**
   * 获取渲染数据（视觉分层）
   * 
   * ⭐ 数据分层：
   * - controlPoints: 用于绘制编辑手柄
   * - surfacePoints: 用于绘制物体本身
   * 
   * 朴素模式：两者相同
   * 体积模式：两者分离
   * 
   * @returns {Object} 渲染数据
   */
  getRenderData() {
    return {
      // 控制点（编辑手柄）
      controlPoints: this.controlPoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        type: 'control'
      })),
      
      // 表面点（物体渲染）
      surfacePoints: this.surfacePoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        type: 'surface'
      })),
      
      // 拓扑信息（用于绘制网格）
      topology: {
        triangles: this.representation.topology.triangles,
        edges: this.representation.topology.edges
      },
      
      // 状态标记
      isVolumetric: this._isVolumetric,
      
      // 渲染提示
      renderHints: {
        showControlPoints: this._isVolumetric,  // 体积模式下显示控制点手柄
        showSurfaceMesh: true,                   // 始终显示表面网格
        controlPointSize: this._isVolumetric ? 0.05 : 0.03,  // 控制点大小
        surfacePointSize: 0.02                   // 表面点大小
      }
    };
  }
}
