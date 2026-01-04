/**
 * Object.js - 几何对象协调者
 * 
 * ============================================================================
 * 版本: v4.0 (生产版)
 * 日期: 2026-01-03
 * ============================================================================
 * 
 * 职责：
 * - 管理几何对象的点集（controlPoints、surfacePoints）
 * - 协调参数化曲面拟合（球谐函数）
 * - 协调体积网格生成
 * - 协调物理拓扑构建
 * - 提供几何量计算（体积、表面积、截面）
 * 
 * 依赖：
 * - Point.js: 点类
 * - GeometryImpl.js: 几何计算
 * - ParametricImpl.js: 参数化曲面
 * - PhysicsBridgeImpl.js: 物理桥接
 * 
 * 外部依赖（通过 options 传入）：
 * - fitter: 拟合器类（FittingCalculator）
 * - Matrix: 矩阵库
 * - sphericalHarmonics: 球谐函数实例
 * ============================================================================
 */

import { Point } from "./Point.js";
import { GeometryImpl } from "./GeometryImpl.js";
import { ParametricImpl } from "./ParametricImpl.js";
import { PhysicsBridgeImpl } from "./PhysicsBridgeImpl.js";

// ============================================================================
// SimpleFitCache
// ============================================================================
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

// ============================================================================
// Object 类
// ============================================================================
export class Object {

  constructor(points = [], options = {}) {
    // ━━━ 核心点集 ━━━
    if (options.controlPoints && options.controlPoints.length > 0) {
      // 使用传入的控制点（假设调用者已经创建了 Point 实例）
      this.controlPoints = options.controlPoints;
    } else if (points.length > 0) {
      // 从 points 创建控制点（拷贝）
      this.controlPoints = points.map(p => new Point(p.x, p.y, p.z));
    } else {
      this.controlPoints = [];
    }
    this._controlPointVersion = 0;

    // ━━━ 建构点（统一存储表面+内部）━━━
    // 在 parametric 模式下，constructionPoints 初始指向 controlPoints
    // 在 volumetric 模式下，包含表面建构点和内部建构点
    // 使用 _surfaceBoundary 作为界标：
    //   [0, _surfaceBoundary) = 表面建构点
    //   [_surfaceBoundary, length) = 内部建构点
    this.constructionPoints = this.controlPoints;
    this._surfaceBoundary = this.controlPoints.length;
    this._constructionPointVersion = 0;

    // ━━━ 显示点（用于视觉渲染，独立于建构点）━━━
    this.displayPoints = [];
    this._displayPointVersion = 0;

    // ━━━ 状态标记 ━━━
    this._isVolumetric = false;
    this.mode = 'parametric';
    this._centerVersion = 0;
    this.center = options.center ?? GeometryImpl.computeCenter(this._extractPositions(this.controlPoints));
    this._boundingBox = null;
    this._boundingBoxDirty = true;

    // ━━━ representation ━━━
    this.representation = {
      type: 'points',
      isClosed: false,
      data: null,
      
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
        edgeToTriangles: new Map(),
        adjacency: null,
        degree: null,
        internalEdges: [],
        skinBoneEdges: []
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
      
      clothConfig: null,
      lineConfig: null,
      efdConfig: null,
      fixedIndices: [],
      metadata: {}
    };

    // ━━━ 缓存与拟合 ━━━
    this._fitCache = new SimpleFitCache();
    this._fitStack = [];
    this._fitStackX = [];
    this._fitStackY = [];

    // ━━━ 物理设置 ━━━
    this.physics = {
      enabled: false,
      mass: 1.0,
      velocity: { x: 0, y: 0, z: 0 },
      model: options.physicsModel ?? 'pbd'
    };

    this._collider = null;
    
    // 延迟初始化的拟合器实例
    this._fitterInstance = null;
    this._matrixClass = null;

    this.metadata = {
      name: options.name ?? 'Untitled',
      created: Date.now(),
      modified: Date.now()
    };

    this.verbose = options.verbose ?? false;
  }

  // ==========================================================================
  // 建构点访问器（表面点/内部点视图）
  // ==========================================================================

  /**
   * 获取表面建构点（只读视图）
   * @returns {Point[]}
   */
  get surfacePoints() {
    return this.constructionPoints.slice(0, this._surfaceBoundary);
  }

  /**
   * 获取内部建构点（只读视图）
   * @returns {Point[]}
   */
  get internalPoints() {
    return this.constructionPoints.slice(this._surfaceBoundary);
  }

  /**
   * 获取表面点数量
   * @returns {number}
   */
  get surfaceCount() {
    return this._surfaceBoundary;
  }

  /**
   * 获取内部点数量
   * @returns {number}
   */
  get internalCount() {
    return this.constructionPoints.length - this._surfaceBoundary;
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  _extractPositions(points) {
    return points.map(p => ({ x: p.x, y: p.y, z: p.z }));
  }

  _createPoints(positions) {
    return positions.map(p => new Point(p.x, p.y, p.z));
  }

  // ==========================================================================
  // 点操作 API
  // ==========================================================================

  addControlPoint(x, y, z) {
    const point = new Point(x, y, z);
    this.controlPoints.push(point);
    this._onControlPointsChanged();
    return this.controlPoints.length - 1;
  }

  updateControlPoint(index, x, y, z, options = {}) {
    if (index < 0 || index >= this.controlPoints.length) {
      console.warn(`[Object] Invalid control point index: ${index}`);
      return;
    }

    const autoRefit = options.autoRefit ?? true;
    const updatePhysics = options.updatePhysics ?? true;
    const lastIndex = this.controlPoints.length - 1;

    // Swap-to-End 策略
    if (index !== lastIndex) {
      const temp = this.controlPoints[index];
      this.controlPoints[index] = this.controlPoints[lastIndex];
      this.controlPoints[lastIndex] = temp;
      this.controlPoints[lastIndex].x = x;
      this.controlPoints[lastIndex].y = y;
      this.controlPoints[lastIndex].z = z;
      this._fitStack.length = Math.min(this._fitStack.length, index);
    } else {
      this.controlPoints[index].x = x;
      this.controlPoints[index].y = y;
      this.controlPoints[index].z = z;
      // 截断最后一个状态（基于旧末尾点），但不能增加长度
      this._fitStack.length = Math.min(this._fitStack.length, this.controlPoints.length - 1);
    }

    this._onControlPointsChanged();

    if (autoRefit && this.representation.type === 'sphericalHarmonics') {
      this._autoRefit();
    }
    if (updatePhysics && this._isVolumetric && this.mode === 'discrete') {
      this.updatePhysicsGeometry();
    }
  }

  removeControlPoint(index) {
    if (index < 0 || index >= this.controlPoints.length) {
      return false;
    }
    this.controlPoints.splice(index, 1);
    this._fitStack = [];
    this._onControlPointsChanged();
    return true;
  }

  updateSurfacePoint(index, x, y, z) {
    if (index < 0 || index >= this._surfaceBoundary) {
      console.warn(`[Object] Invalid surface point index: ${index}`);
      return;
    }

    if (!this._isVolumetric) {
      const lastIndex = this._surfaceBoundary - 1;
      if (index !== lastIndex) {
        const temp = this.constructionPoints[index];
        this.constructionPoints[index] = this.constructionPoints[lastIndex];
        this.constructionPoints[lastIndex] = temp;
        this.constructionPoints[lastIndex].x = x;
        this.constructionPoints[lastIndex].y = y;
        this.constructionPoints[lastIndex].z = z;
        this._fitStack.length = Math.min(this._fitStack.length, index);
      } else {
        this.constructionPoints[index].x = x;
        this.constructionPoints[index].y = y;
        this.constructionPoints[index].z = z;
        // 截断最后一个状态，但不能增加长度
        this._fitStack.length = Math.min(this._fitStack.length, this._surfaceBoundary - 1);
      }
      this._boundingBoxDirty = true;
      this.metadata.modified = Date.now();
      return;
    }

    const point = this.constructionPoints[index];
    point.x = x;
    point.y = y;
    point.z = z;

    if (point._physicsData) {
      point._physicsData.position.x = x;
      point._physicsData.position.y = y;
      point._physicsData.position.z = z;
      point._physicsData.prevPosition.x = x;
      point._physicsData.prevPosition.y = y;
      point._physicsData.prevPosition.z = z;
    }

    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
  }

  _onControlPointsChanged() {
    this._controlPointVersion++;
    this._fitCache.clear();
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();

    if (!this._isVolumetric) {
      this._surfacePointVersion++;
      this._clearTopologyAndCache();
    }
  }

  _clearTopologyAndCache() {
    this.representation.topology = {
      triangles: [],
      edges: [],
      edgeToTriangles: new Map(),
      adjacency: null,
      degree: null,
      internalEdges: [],
      skinBoneEdges: []
    };
    this.representation.geometryCache = {
      volume: null,
      surfaceArea: null,
      sections: new Map()
    };
  }

  // ==========================================================================
  // fitSphericalHarmonics
  // ==========================================================================

  fitSphericalHarmonics(options = {}) {
    if (this.controlPoints.length < 4) {
      throw new Error('[Object] fitSphericalHarmonics requires at least 4 control points');
    }

    const FitterClass = options.fitter;
    const Matrix = options.Matrix;
    const sphericalHarmonics = options.sphericalHarmonics;

    if (!FitterClass) throw new Error('[Object] Missing required option: fitter');
    if (!Matrix) throw new Error('[Object] Missing required option: Matrix');
    if (!sphericalHarmonics) throw new Error('[Object] Missing required option: sphericalHarmonics');

    const order = options.order ?? 3;
    const useIncremental = options.useIncremental ?? true;
    const force = options.force ?? false;

    const context = { pointVersion: this._controlPointVersion, order };
    if (!force && !useIncremental) {
      const cached = this._fitCache.get(context);
      if (cached) return cached;
    }

    const positions = this._extractPositions(this.controlPoints);
    const centerPos = GeometryImpl.computeCenter(positions);

    if (!this._fitterInstance) {
      this._fitterInstance = new FitterClass({ Matrix, verbose: this.verbose });
      this._matrixClass = Matrix;
    }

    let result;
    try {
      result = ParametricImpl.fitSpherical(
        positions,
        centerPos.x, centerPos.y, centerPos.z,
        order,
        this._fitStack,
        this._fitterInstance,
        Matrix,
        sphericalHarmonics,
        useIncremental,
        this.verbose
      );
    } catch (err) {
      if (useIncremental) {
        console.warn('[Object] Incremental fit failed, falling back to full fit:', err.message);
        this._fitStack = [];
        result = ParametricImpl.fitSpherical(
          positions,
          centerPos.x, centerPos.y, centerPos.z,
          order,
          this._fitStack,
          this._fitterInstance,
          Matrix,
          sphericalHarmonics,
          false,
          this.verbose
        );
      } else {
        throw err;
      }
    }

    this._fitStack = result.fitStack;

    if (!this.center ||
        this.center.x !== centerPos.x ||
        this.center.y !== centerPos.y ||
        this.center.z !== centerPos.z) {
      this._centerVersion++;
    }
    this.center = { x: centerPos.x, y: centerPos.y, z: centerPos.z };

    this.representation.type = 'sphericalHarmonics';
    this.representation.isClosed = true;
    this.representation.data = {
      coefficients: result.coefficients,
      sphericalHarmonics: sphericalHarmonics
    };

    this.mode = 'parametric';

    if (!useIncremental) {
      this._fitCache.set(context, result);
    }

    return result;
  }

  _autoRefit() {
    if (!this.representation.data?.sphericalHarmonics || !this._fitterInstance) return;

    try {
      const coeffs = this.representation.data.coefficients;
      this.fitSphericalHarmonics({
        order: coeffs ? Math.floor(Math.sqrt(coeffs.length)) - 1 : 3,
        fitter: this._fitterInstance.constructor,
        Matrix: this._matrixClass,
        sphericalHarmonics: this.representation.data.sphericalHarmonics,
        useIncremental: true
      });
    } catch (err) {
      console.error('[Object] Auto-refit failed:', err.message);
    }
  }

  // ==========================================================================
  // fitEllipticFourier（二维椭圆傅里叶拟合，用于布料边界）
  // ==========================================================================

  /**
   * 椭圆傅里叶拟合（用于二维闭合轮廓）
   * 
   * @param {object} options
   * @param {number} options.order - 傅里叶阶数（默认 5）
   * @param {class} options.fitter - 拟合器类（可选，用于增量拟合）
   * @param {class} options.Matrix - 矩阵类（可选）
   * @param {boolean} options.useIncremental - 是否使用增量拟合（默认 true）
   * @param {boolean} options.force - 强制重新拟合
   * @returns {{coeffsX, coeffsY, order, residualX, residualY}}
   */
  fitEllipticFourier(options = {}) {
    if (this.controlPoints.length < 4) {
      throw new Error('[Object] fitEllipticFourier requires at least 4 control points');
    }

    const order = options.order ?? 5;
    const useIncremental = options.useIncremental ?? true;
    const force = options.force ?? false;

    // 检查缓存
    const context = { pointVersion: this._controlPointVersion, order, type: 'efd' };
    if (!force && !useIncremental) {
      const cached = this._fitCache.get(context);
      if (cached) return cached;
    }

    const positions = this._extractPositions(this.controlPoints);

    // 如果提供了 fitter，使用它；否则使用 ParametricImpl 的内置求解
    const fitterInstance = options.fitter ? 
      (this._fitterInstance ?? new options.fitter({ Matrix: options.Matrix, verbose: this.verbose })) : 
      null;

    if (options.fitter && !this._fitterInstance) {
      this._fitterInstance = fitterInstance;
      this._matrixClass = options.Matrix;
    }

    const result = ParametricImpl.fitEllipticFourier(
      positions,
      order,
      this._fitStackX,
      this._fitStackY,
      fitterInstance,
      options.Matrix,
      useIncremental,
      this.verbose
    );

    this._fitStackX = result.fitStackX;
    this._fitStackY = result.fitStackY;

    // 计算边界中心
    const centerPos = GeometryImpl.computeCenter(positions);
    this.center = { x: centerPos.x, y: centerPos.y, z: 0 };

    this.representation.type = 'elliptic-fourier-2d';
    this.representation.isClosed = true;
    this.representation.data = {
      coeffsX: result.coeffsX,
      coeffsY: result.coeffsY,
      order: result.order
    };
    this.representation.efdConfig = {
      order: result.order,
      residualX: result.residualX,
      residualY: result.residualY
    };

    this.mode = 'parametric';

    if (!useIncremental) {
      this._fitCache.set(context, result);
    }

    return result;
  }

  // ==========================================================================
  // generateVolumetricMesh
  // ==========================================================================

  generateVolumetricMesh(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics' || !this.representation.data) {
      throw new Error('[Object] generateVolumetricMesh requires fitSphericalHarmonics first');
    }

    const { coefficients, sphericalHarmonics } = this.representation.data;
    
    // 【新增】验证关键数据完整性
    if (!coefficients || !sphericalHarmonics) {
      throw new Error('[Object] generateVolumetricMesh: coefficients or sphericalHarmonics missing in representation.data');
    }
    
    const spacing = options.spacing ?? GeometryImpl.DEFAULT_SPACING_VOLUMETRIC;
    const knn = options.knn ?? 10;
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';

    this.physics.model = physicsModel;

    // 计算目标点数（基于体积）
    let targetCount = options.targetCount;
    if (targetCount === undefined) {
      // 优先使用体积计算
      const volume = this.getVolume();
      
      if (volume && volume > 0) {
        // 基于体积计算：N ≈ V / d^3
        // 其中 d 是间距，V 是体积
        const estimatedCount = Math.round(volume / Math.pow(spacing, 3));
        const safetyLimit = 5000;
        targetCount = Math.min(estimatedCount, safetyLimit);
        targetCount = Math.max(targetCount, 50);
        
        if (this.verbose) {
          console.log(`[Object] Volume-based targetCount: ${targetCount} (volume=${volume.toFixed(6)}, spacing=${spacing})`);
        }
      } else {
        // 后备方案：使用包围盒
        const bbox = this.getBoundingBox();
        const width = bbox.max.x - bbox.min.x;
        const height = bbox.max.y - bbox.min.y;
        const depth = bbox.max.z - bbox.min.z;
        const D = (width + height + depth) / 3;
        const estimatedCount = Math.round(0.52 * Math.pow(D / spacing, 3));
        const safetyLimit = 2000;
        targetCount = Math.min(estimatedCount, safetyLimit);
        targetCount = Math.max(targetCount, 50);

        if (this.verbose) {
          console.log(`[Object] BBox-based targetCount: ${targetCount} (fallback)`);
        }
      }
    }

    const relaxIterations = options.relaxIterations ?? 25;
    const surfaceRatio = options.surfaceRatio ?? 0.3;

    // 创建回调
    const boundaryCallback = ParametricImpl.createSphericalBoundaryCallback(
      coefficients,
      this.center.x, this.center.y, this.center.z,
      sphericalHarmonics,
      ParametricImpl.SURFACE_THRESHOLD
    );

    const occlusionCallback = ParametricImpl.createOcclusionCallback(
      coefficients,
      this.center.x, this.center.y, this.center.z,
      sphericalHarmonics,
      0.85
    );

    // 计算包围盒
    const boundingRadius = sphericalHarmonics._estimateBoundingRadius
      ? sphericalHarmonics._estimateBoundingRadius(coefficients)
      : this._estimateBoundingRadius();
    const boxSize = boundingRadius * 2.2;

    // 气泡填充
    const packingResult = GeometryImpl.generateBubblePacking(
      targetCount, spacing, relaxIterations, surfaceRatio,
      this.center.x - boxSize / 2, this.center.x + boxSize / 2,
      this.center.y - boxSize / 2, this.center.y + boxSize / 2,
      this.center.z - boxSize / 2, this.center.z + boxSize / 2,
      boundaryCallback,
      false,
      this.verbose
    );

    const surfacePositions = packingResult.surfacePoints;
    const internalPositions = packingResult.internalPoints;

    // 构建表面拓扑
    const surfaceTopology = GeometryImpl.buildSurfaceTopology(
      surfacePositions,
      knn,
      this.center.x, this.center.y, this.center.z,
      occlusionCallback,
      this.verbose
    );

    // 创建表面建构点和内部建构点，统一存储
    const newSurfacePoints = this._createPoints(surfacePositions);
    const newInternalPoints = this._createPoints(internalPositions);

    // 统一存储：[表面点..., 内部点...]
    this.constructionPoints = [...newSurfacePoints, ...newInternalPoints];
    this._surfaceBoundary = newSurfacePoints.length;
    this._isVolumetric = true;

    // 更新拓扑
    this.representation.topology = {
      triangles: surfaceTopology.triangles,
      edges: surfaceTopology.edges,
      edgeToTriangles: surfaceTopology.edgeToTriangles,
      adjacency: surfaceTopology.adjacency,
      degree: null,
      internalEdges: [],
      skinBoneEdges: []
    };

    this.representation.type = 'volumetric';

    // 更新物理状态结构
    this.representation.physicsState = {
      physicsModel,
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: surfacePositions.length,
      surfaceCount: surfacePositions.length,
      internalCount: internalPositions.length
    };

    // 清理缓存
    this._constructionPointVersion++;
    this._boundingBoxDirty = true;
    this.representation.geometryCache = {
      volume: null,
      surfaceArea: null,
      sections: new Map()
    };
    this.metadata.modified = Date.now();

    if (this.verbose) {
      console.log(`[Object] Volumetric mesh generated: ${surfacePositions.length} surface, ${internalPositions.length} internal`);
    }

    return {
      surfacePoints: surfacePositions.length,
      internalPoints: internalPositions.length,
      topology: surfaceTopology,
      autoCalculated: options.targetCount === undefined,
      finalTargetCount: targetCount,
      isVolumetric: this._isVolumetric,
      controlPointsPreserved: this.controlPoints.length,
      mode: this.mode
    };
  }

  // ==========================================================================
  // generateDisplayPoints（黄金螺旋采样，用于视觉渲染）
  // ==========================================================================

  /**
   * 生成显示点（用于视觉渲染）
   * 
   * 使用黄金螺旋算法在曲面上均匀采样，生成独立于建构点的显示点。
   * 这些点仅用于渲染，不参与物理模拟。
   * 
   * @param {object} options
   * @param {number} options.count - 采样点数（默认基于表面积自动计算）
   * @param {number} options.density - 采样密度（点/平方厘米，默认 4）
   * @returns {{count: number, displayPoints: Array}}
   */
  generateDisplayPoints(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric' &&
        this.representation.type !== 'elliptic-fourier-2d' &&
        this.representation.type !== 'cloth') {
      throw new Error('[Object] generateDisplayPoints requires fitted representation');
    }

    const density = options.density ?? 4;  // 点/cm²
    let count = options.count;

    if (this.representation.type === 'elliptic-fourier-2d') {
      // 2D 布料显示点（使用 EFD 边界）
      return this._generateDisplayPoints2D(count, density);
    }

    if (this.representation.type === 'cloth') {
      // 布料显示点
      return this._generateDisplayPointsCloth(count, density);
    }

    // 3D 球谐体显示点
    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) {
      throw new Error('[Object] Missing spherical harmonics data');
    }

    // 自动计算采样点数
    if (count === undefined) {
      const surfaceArea = this.getSurfaceArea();
      if (surfaceArea && surfaceArea > 0) {
        // 表面积单位假设为 m²，转换为 cm²
        count = Math.round(surfaceArea * 10000 * density);
        count = Math.max(100, Math.min(count, 10000));
      } else {
        count = 500;  // 默认值
      }
    }

    // 黄金螺旋采样
    const radiusCallback = (theta, phi) => {
      return sphericalHarmonics.evaluate(coefficients, theta, phi);
    };

    const sampledPositions = GeometryImpl.goldenSpiralSampling(
      count,
      this.center.x, this.center.y, this.center.z,
      radiusCallback
    );

    // 创建显示点
    this.displayPoints = sampledPositions.map(p => new Point(p.x, p.y, p.z));
    this._displayPointVersion++;

    // 计算法向量
    for (let i = 0; i < this.displayPoints.length; i++) {
      const p = this.displayPoints[i];
      const pos = sampledPositions[i];
      
      // 使用球谐函数的梯度计算法向量
      const normal = sphericalHarmonics.computeSurfaceNormal?.(
        coefficients, pos.theta, pos.phi, this.center
      );
      
      if (normal) {
        p.nx = normal.x;
        p.ny = normal.y;
        p.nz = normal.z;
      } else {
        // 后备：径向法向量
        const dx = p.x - this.center.x;
        const dy = p.y - this.center.y;
        const dz = p.z - this.center.z;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (len > 1e-10) {
          p.nx = dx / len;
          p.ny = dy / len;
          p.nz = dz / len;
        }
      }
    }

    if (this.verbose) {
      console.log(`[Object] Display points generated: ${this.displayPoints.length}`);
    }

    return {
      count: this.displayPoints.length,
      displayPoints: this.displayPoints
    };
  }

  _generateDisplayPoints2D(count, density) {
    const { coeffsX, coeffsY } = this.representation.data;
    if (!coeffsX || !coeffsY) {
      throw new Error('[Object] Missing EFD coefficients');
    }

    // 计算包围盒
    const numSamples = 100;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (let i = 0; i < numSamples; i++) {
      const t = (i / numSamples) * 2 * Math.PI;
      const pt = ParametricImpl.evaluateEFD(coeffsX, coeffsY, t);
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    // 自动计算采样点数
    if (count === undefined) {
      const area = (maxX - minX) * (maxY - minY) * 0.7;  // 估算有效面积
      count = Math.round(area * 10000 * density);
      count = Math.max(50, Math.min(count, 5000));
    }

    // 边界回调
    const boundaryCallback = ParametricImpl.createEFDBoundaryCallback(coeffsX, coeffsY, 200);

    // 2D 黄金螺旋采样
    const sampledPositions = GeometryImpl.goldenSpiralSampling2D(
      count, boundaryCallback,
      minX, maxX, minY, maxY
    );

    // 创建显示点
    this.displayPoints = sampledPositions.map(p => {
      const pt = new Point(p.x, p.y, p.z);
      pt.nx = 0;
      pt.ny = 0;
      pt.nz = 1;  // 2D 布料法向量朝 Z
      return pt;
    });
    this._displayPointVersion++;

    if (this.verbose) {
      console.log(`[Object] 2D Display points generated: ${this.displayPoints.length}`);
    }

    return {
      count: this.displayPoints.length,
      displayPoints: this.displayPoints
    };
  }

  _generateDisplayPointsCloth(count, density) {
    // 对于 cloth 类型，使用包围盒内的 2D 采样
    const bbox = this.getBoundingBox();
    const width = bbox.max.x - bbox.min.x;
    const height = bbox.max.y - bbox.min.y;
    
    // 自动计算采样点数
    if (count === undefined) {
      const area = width * height;
      count = Math.round(area * 10000 * density);
      count = Math.max(50, Math.min(count, 5000));
    }

    // 如果是 organic cloth，使用 EFD 边界；否则使用形状判定
    let boundaryCallback;
    
    if (this.representation.clothConfig?.mode === 'organic' && 
        this.representation.clothConfig?.coeffsX && 
        this.representation.clothConfig?.coeffsY) {
      // organic 模式：使用 EFD 边界
      boundaryCallback = ParametricImpl.createEFDBoundaryCallback(
        this.representation.clothConfig.coeffsX,
        this.representation.clothConfig.coeffsY,
        200
      );
    } else {
      // grid 模式：使用形状边界
      const shape = this.representation.clothConfig?.shape;
      if (shape === 'circle') {
        // 圆形布料：使用圆形边界
        const radius = Math.min(width, height) / 2;
        const centerX = (bbox.min.x + bbox.max.x) / 2;
        const centerY = (bbox.min.y + bbox.max.y) / 2;
        boundaryCallback = (x, y, z) => {
          const dx = x - centerX;
          const dy = y - centerY;
          return dx * dx + dy * dy <= radius * radius;
        };
      } else {
        // 矩形布料：所有点都在包围盒内
        boundaryCallback = (x, y, z) => true;
      }
    }

    // 2D 黄金螺旋采样
    const sampledPositions = GeometryImpl.goldenSpiralSampling2D(
      count, boundaryCallback,
      bbox.min.x, bbox.max.x, bbox.min.y, bbox.max.y
    );

    // 创建显示点
    this.displayPoints = sampledPositions.map(p => {
      const pt = new Point(p.x, p.y, p.z);
      pt.nx = 0;
      pt.ny = 0;
      pt.nz = 1;  // 2D 布料法向量朝 Z
      return pt;
    });
    this._displayPointVersion++;

    if (this.verbose) {
      console.log(`[Object] Cloth display points generated: ${this.displayPoints.length}`);
    }

    return {
      count: this.displayPoints.length,
      displayPoints: this.displayPoints
    };
  }

  // ==========================================================================
  // generateCloth（二维布料初始化）
  // ==========================================================================

  /**
   * 生成布料网格
   * 
   * 支持两种模式：
   * 1. 规则网格模式：基于 rows/cols 生成矩形或圆形网格
   * 2. 有机形状模式：基于控制点和 EFD 拟合生成不规则形状
   * 
   * @param {object} options
   * @param {string} options.mode - 'grid' 或 'organic'（默认 'grid'）
   * @param {number} options.width - 宽度（grid 模式）
   * @param {number} options.height - 高度（grid 模式）
   * @param {number} options.rows - 行数（grid 模式，默认基于间距计算）
   * @param {number} options.cols - 列数（grid 模式，默认基于间距计算）
   * @param {string} options.shape - 'rectangle' 或 'circle'（grid 模式，默认 'rectangle'）
   * @param {number} options.spacing - 建构点间距（默认 1.5cm）
   * @param {number} options.efdOrder - EFD 阶数（organic 模式，默认 5）
   * @param {string} options.physicsModel - 'pbd' 或 'force'
   * @returns {{surfacePoints: number, topology: object}}
   */
  generateCloth(options = {}) {
    const mode = options.mode ?? 'grid';
    const spacing = options.spacing ?? GeometryImpl.DEFAULT_SPACING_CLOTH;
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';

    this.physics.model = physicsModel;

    if (mode === 'organic') {
      return this._generateOrganicCloth(options, spacing, physicsModel);
    }

    // Grid 模式
    const width = options.width ?? 0.3;   // 默认 30cm
    const height = options.height ?? 0.3;
    const shape = options.shape ?? 'rectangle';

    // 根据间距计算网格尺寸
    const rows = options.rows ?? Math.max(2, Math.round(height / spacing));
    const cols = options.cols ?? Math.max(2, Math.round(width / spacing));

    // 生成网格点
    const { positions, uvCoords } = GeometryImpl.generateClothGrid(
      width, height, rows, cols, shape
    );

    // 构建拓扑
    const topology = GeometryImpl.buildClothTopology(rows, cols, positions.length);

    // 创建建构点（布料没有内部点）
    this.constructionPoints = this._createPoints(positions);
    this._surfaceBoundary = positions.length;
    this._isVolumetric = false;

    // 更新 representation
    this.representation.type = 'cloth';
    this.representation.isClosed = false;
    this.representation.topology = {
      triangles: topology.triangles,
      edges: topology.edges,
      edgeToTriangles: topology.edgeToTriangles,
      adjacency: topology.adjacency,
      degree: null,
      internalEdges: [],
      skinBoneEdges: []
    };
    this.representation.clothConfig = {
      mode: 'grid',
      width,
      height,
      rows,
      cols,
      shape,
      spacing,
      uvCoords
    };

    // 更新物理状态
    this.representation.physicsState = {
      physicsModel,
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: positions.length,
      surfaceCount: positions.length,
      internalCount: 0
    };

    // 更新中心
    this.center = GeometryImpl.computeCenter(positions);

    this.mode = 'parametric';

    if (this.verbose) {
      console.log(`[Object] Cloth generated: ${positions.length} points, ${topology.triangles.length} triangles`);
    }

    return {
      surfacePoints: positions.length,
      topology: topology,
      rows,
      cols,
      shape
    };
  }

  _generateOrganicCloth(options, spacing, physicsModel) {
    // 使用 EFD 拟合边界
    if (this.controlPoints.length < 4) {
      throw new Error('[Object] Organic cloth requires at least 4 control points');
    }

    const efdOrder = options.efdOrder ?? 5;
    const targetCount = options.targetCount;
    const relaxIterations = options.relaxIterations ?? 20;

    // 执行 EFD 拟合
    this.fitEllipticFourier({ order: efdOrder });

    const { coeffsX, coeffsY } = this.representation.data;

    // 计算包围盒
    const numSamples = 100;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < numSamples; i++) {
      const t = (i / numSamples) * 2 * Math.PI;
      const pt = ParametricImpl.evaluateEFD(coeffsX, coeffsY, t);
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    // 计算目标点数
    let count = targetCount;
    if (count === undefined) {
      const area = (maxX - minX) * (maxY - minY) * 0.7;
      count = Math.round(area / (spacing * spacing));
      count = Math.max(20, Math.min(count, 2000));
    }

    // 边界回调
    const boundaryCallback = ParametricImpl.createEFDBoundaryCallback(coeffsX, coeffsY, 200);

    // 使用气泡算法生成点
    const packingResult = GeometryImpl.generateBubblePacking(
      count, spacing, relaxIterations, 1.0,  // surfaceRatio = 1.0 for 2D
      minX, maxX, minY, maxY, 0, 0,
      boundaryCallback, true,  // is2D = true
      this.verbose
    );

    const positions = packingResult.surfacePoints;

    // 构建 2D 三角化拓扑（使用 Delaunay 或简单 KNN）
    const topology = GeometryImpl.buildSurfaceTopology(
      positions,
      GeometryImpl.KNN_2D,
      this.center.x, this.center.y, 0,
      null,  // 2D 不需要遮挡回调
      this.verbose
    );

    // 创建建构点（布料没有内部点）
    this.constructionPoints = this._createPoints(positions);
    this._surfaceBoundary = positions.length;
    this._isVolumetric = false;

    // 更新 representation
    this.representation.type = 'cloth';
    this.representation.isClosed = true;
    this.representation.topology = {
      triangles: topology.triangles,
      edges: topology.edges,
      edgeToTriangles: topology.edgeToTriangles,
      adjacency: topology.adjacency,
      degree: null,
      internalEdges: [],
      skinBoneEdges: []
    };
    this.representation.clothConfig = {
      mode: 'organic',
      efdOrder,
      spacing,
      coeffsX,
      coeffsY,
      uvCoords: null  // organic 模式无 UV
    };

    // 更新物理状态
    this.representation.physicsState = {
      physicsModel,
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: positions.length,
      surfaceCount: positions.length,
      internalCount: 0
    };

    this.mode = 'parametric';

    if (this.verbose) {
      console.log(`[Object] Organic cloth generated: ${positions.length} points, ${topology.triangles.length} triangles`);
    }

    return {
      surfacePoints: positions.length,
      topology: topology,
      mode: 'organic'
    };
  }

  // ==========================================================================
  // generateLine（线条初始化）
  // ==========================================================================

  /**
   * 生成线条
   * 
   * @param {object} options
   * @param {number} options.segments - 分段数（默认基于长度和间距计算）
   * @param {number} options.length - 线条长度（默认 0.5m）
   * @param {string} options.shape - 'straight', 'circle', 'spiral'（默认 'straight'）
   * @param {boolean} options.isClosed - 是否闭合（默认 shape === 'circle'）
   * @param {number} options.spacing - 建构点间距（默认 1.5cm）
   * @param {string} options.physicsModel - 'pbd' 或 'force'
   * @returns {{pointCount: number, topology: object}}
   */
  generateLine(options = {}) {
    const length = options.length ?? 0.5;  // 默认 50cm
    const shape = options.shape ?? 'straight';
    const spacing = options.spacing ?? GeometryImpl.DEFAULT_SPACING_CLOTH;
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';

    this.physics.model = physicsModel;

    // 根据间距计算分段数
    const segments = options.segments ?? Math.max(2, Math.round(length / spacing));
    const isClosed = options.isClosed ?? (shape === 'circle');

    // 生成线条点
    const { positions, tParams } = GeometryImpl.generateLinePoints(
      segments, length, shape
    );

    // 构建拓扑
    const topology = GeometryImpl.buildLineTopology(positions.length, isClosed);

    // 创建建构点（线条只有表面点，没有内部点）
    this.constructionPoints = this._createPoints(positions);
    this._surfaceBoundary = positions.length;
    this._isVolumetric = false;

    // 更新 representation
    this.representation.type = 'line';
    this.representation.isClosed = isClosed;
    this.representation.topology = {
      triangles: [],
      edges: topology.edges,
      edgeToTriangles: new Map(),
      adjacency: topology.adjacency,
      degree: null,
      internalEdges: [],
      skinBoneEdges: []
    };
    this.representation.lineConfig = {
      length,
      shape,
      segments,
      spacing,
      tParams
    };

    // 更新物理状态
    this.representation.physicsState = {
      physicsModel,
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: positions.length,
      surfaceCount: positions.length,
      internalCount: 0
    };

    // 更新中心
    this.center = GeometryImpl.computeCenter(positions);

    this.mode = 'parametric';

    if (this.verbose) {
      console.log(`[Object] Line generated: ${positions.length} points, ${topology.edges.length} edges`);
    }

    return {
      pointCount: positions.length,
      topology: topology,
      shape,
      isClosed
    };
  }

  _estimateBoundingRadius() {
    // 【修复】使用 GeometryImpl 进行包围半径计算
    const positions = this._extractPositions(this.controlPoints);
    return GeometryImpl.computeBoundingRadius(positions, this.center, 1.2);
  }

  // ==========================================================================
  // rebuildPhysicsTopology
  // ==========================================================================

  rebuildPhysicsTopology(options = {}) {
    if (this._surfaceBoundary === 0) {
      throw new Error('[Object] No surface points for physics topology');
    }
    
    // 【修复】检查类型：sphericalHarmonics 是纯参数化的，没有离散拓扑
    if (this.representation.type === 'sphericalHarmonics') {
      throw new Error('[Object] Cannot build physics topology for sphericalHarmonics type. Call generateVolumetricMesh() first.');
    }
    
    // 【修复】检查类型：points 类型没有拓扑
    if (this.representation.type === 'points') {
      throw new Error('[Object] Cannot build physics topology for points type. Call fitSphericalHarmonics() and generateVolumetricMesh() first.');
    }

    const physicsModel = options.physicsModel ?? this.representation.physicsState.physicsModel ?? this.physics.model ?? 'pbd';
    const spacing = options.spacing ?? GeometryImpl.DEFAULT_SPACING_VOLUMETRIC;
    const knn = options.knn ?? 10;

    // 从 constructionPoints 获取内部点位置
    const internalPointsArray = this.internalPoints;  // 使用 getter
    const internalPositions = this._extractPositions(internalPointsArray);

    const surfacePositions = this._extractPositions(this.surfacePoints);

    // 构建内部拓扑和皮骨拓扑
    if (internalPositions.length > 0) {
      const internalTopology = GeometryImpl.buildInternalTopology(
        internalPositions,
        this._surfaceBoundary,
        spacing * 1.5,
        GeometryImpl.KNN_INTERNAL ?? 8
      );

      const skinBoneTopology = GeometryImpl.buildSkinBoneTopology(
        surfacePositions,
        internalPositions,
        this._surfaceBoundary,
        spacing * 2.0
      );

      this.representation.topology.internalEdges = internalTopology.edges;
      this.representation.topology.skinBoneEdges = skinBoneTopology.edges;
    }

    // 绑定 _physicsData（对所有建构点）
    this._bindPhysicsData(this.constructionPoints);

    // 预计算材料数组
    const coordsArray = this._computeMaterialCoords();
    const { stiffnessArray, dampingArray } = this._precomputeMaterialArrays(coordsArray);

    // 计算球坐标数组
    const sphericalCoordsArray = this._computeSphericalCoordsArray(this.surfacePoints);
    const internalSphericalCoords = internalPositions.length > 0
      ? this._computeSphericalCoordsArrayFromPositions(internalPositions)
      : [];

    // 计算质量分配
    const globalMassScale = this.physics.mass || 1.0;
    const surfaceMass = globalMassScale * 0.6 / this._surfaceBoundary;
    const internalMass = internalPositions.length > 0
      ? globalMassScale * 0.4 / internalPositions.length
      : 0;

    // 构建表面粒子
    const physicsDataArray = this.surfacePoints.map(p => p._physicsData);
    const surfaceParticles = PhysicsBridgeImpl.buildSurfaceParticles(
      physicsDataArray,
      surfaceMass,
      sphericalCoordsArray
    );

    // 构建内部粒子
    const internalParticles = internalPositions.length > 0
      ? PhysicsBridgeImpl.buildInternalParticles(
          internalPositions,
          this._surfaceBoundary,
          internalMass,
          internalSphericalCoords
        )
      : [];

    // 合并粒子
    const particles = [...surfaceParticles, ...internalParticles];

    // 【修复】使用 PhysicsBridgeImpl 初始化内部粒子的形状匹配数据
    if (internalParticles.length > 0) {
      PhysicsBridgeImpl.initShapeMatchingData(internalParticles);
    }

    // 构建约束（传入particles用于形状匹配约束）
    const allPositions = [...surfacePositions, ...internalPositions];
    const constraints = this._buildConstraintsByType(
      physicsModel, 
      allPositions, 
      stiffnessArray, 
      dampingArray,
      particles,  // 新增：传入粒子数组
      this._surfaceBoundary,  // surfaceCount
      internalPositions.length    // internalCount
    );

    // 验证约束语义
    if (this.verbose) {
      const validation = PhysicsBridgeImpl.validateConstraintSemantics(constraints);
      if (!validation.valid) {
        console.error('[Object] Constraint validation failed:', validation.errors);
        throw new Error('Constraint semantic validation failed');
      }
    }

    // 应用固定点
    PhysicsBridgeImpl.applyFixedPoints(particles, this.representation.fixedIndices);

    // 更新物理状态
    this.representation.physicsState = {
      physicsModel,
      particles,
      constraints,
      surfaceStartIndex: 0,
      internalStartIndex: this._surfaceBoundary,
      surfaceCount: this._surfaceBoundary,
      internalCount: internalPositions.length
    };

    // 切换模式
    this.mode = 'discrete';

    // 计算初始法向量
    if (this.representation.topology.triangles.length > 0) {
      PhysicsBridgeImpl.computeNormals(
        particles,
        this.representation.topology.triangles,
        this._surfaceBoundary
      );

      // 同步法向量到 Point（直接操作 constructionPoints）
      const syncCount = Math.min(this._surfaceBoundary, particles.length);
      for (let i = 0; i < syncCount; i++) {
        const n = particles[i].normal;
        if (n) {
          this.constructionPoints[i].nx = n.x;
          this.constructionPoints[i].ny = n.y;
          this.constructionPoints[i].nz = n.z;
        }
      }
    }

    if (this.verbose) {
      console.log(`[Object] Physics topology rebuilt: ${particles.length} particles, ${constraints.length} constraints`);
    }

    return {
      particles: particles.length,
      constraints: constraints.length,
      surfaceCount: this._surfaceBoundary,
      internalCount: internalPositions.length
    };
  }

  _bindPhysicsData(points) {
    for (const p of points) {
      if (!p._physicsData) {
        p._physicsData = {
          position: { x: p.x, y: p.y, z: p.z },
          prevPosition: { x: p.x, y: p.y, z: p.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      } else {
        p._physicsData.position.x = p.x;
        p._physicsData.position.y = p.y;
        p._physicsData.position.z = p.z;
      }
    }
  }

  // ==========================================================================
  // 【修复】约束构建 - 补充 cloth/line 类型
  // ==========================================================================

  _buildConstraintsByType(physicsModel, allPositions, stiffnessArray, dampingArray, particles, surfaceCount, internalCount) {
    const type = this.representation.type;
    const topology = this.representation.topology;

    let constraints = [];

    if (type === 'volumetric') {
      // 表面约束
      const surfaceConstraints = PhysicsBridgeImpl.buildVolumeSurfaceConstraints(
        topology.edges,
        allPositions,
        physicsModel,
        stiffnessArray, dampingArray,
        PhysicsBridgeImpl.DEFAULT_STIFFNESS,
        PhysicsBridgeImpl.DEFAULT_DAMPING
      );
      constraints.push(...surfaceConstraints);

      // 内部约束
      if (topology.internalEdges && topology.internalEdges.length > 0) {
        const internalConstraints = PhysicsBridgeImpl.buildVolumeInternalConstraints(
          topology.internalEdges,
          allPositions,
          physicsModel,
          PhysicsBridgeImpl.INTERNAL_STIFFNESS_MULT,
          PhysicsBridgeImpl.INTERNAL_DAMPING_MULT,
          PhysicsBridgeImpl.DEFAULT_STIFFNESS,
          PhysicsBridgeImpl.DEFAULT_DAMPING
        );
        constraints.push(...internalConstraints);
      }

      // 皮骨约束
      if (topology.skinBoneEdges && topology.skinBoneEdges.length > 0) {
        const skinBoneConstraints = PhysicsBridgeImpl.buildSkinBoneConstraints(
          topology.skinBoneEdges,
          allPositions,
          physicsModel,
          PhysicsBridgeImpl.SKIN_BONE_STIFFNESS_MULT,
          PhysicsBridgeImpl.SKIN_BONE_DAMPING_MULT,
          PhysicsBridgeImpl.DEFAULT_STIFFNESS,
          PhysicsBridgeImpl.DEFAULT_DAMPING
        );
        constraints.push(...skinBoneConstraints);
      }

      // 形状匹配约束（用于形体还原）
      // 【修复】使用传入的particles而非this.representation.physicsState.particles
      if (particles && internalCount > 0) {
        const internalStartIndex = surfaceCount;
        const shapeMatchingConstraint = PhysicsBridgeImpl.buildShapeMatchingConstraint(
          particles,
          internalStartIndex,
          internalCount,
          physicsModel,
          PhysicsBridgeImpl.SHAPE_MATCHING_STIFFNESS ?? PhysicsBridgeImpl.DEFAULT_STIFFNESS * 0.5
        );
        if (shapeMatchingConstraint) {
          constraints.push(shapeMatchingConstraint);
        }
      }
    } else if (type === 'cloth') {
      // 【补充】布料约束
      constraints = PhysicsBridgeImpl.buildClothConstraints(
        topology.edges,
        topology.triangles,
        topology.edgeToTriangles,
        allPositions,
        physicsModel,
        stiffnessArray, dampingArray,
        PhysicsBridgeImpl.DEFAULT_STIFFNESS,
        PhysicsBridgeImpl.DEFAULT_DAMPING,
        PhysicsBridgeImpl.BENDING_COMPLIANCE_CLOTH
      );
    } else if (type === 'line') {
      // 【补充】线约束
      constraints = PhysicsBridgeImpl.buildLineConstraints(
        topology.edges,
        allPositions,
        this.representation.isClosed,
        physicsModel,
        stiffnessArray, dampingArray,
        PhysicsBridgeImpl.DEFAULT_STIFFNESS,
        PhysicsBridgeImpl.DEFAULT_DAMPING,
        PhysicsBridgeImpl.BENDING_COMPLIANCE_LINE
      );
    } else if (type === 'elliptic-fourier-2d') {
      // 2D 有机形状
      const c1 = PhysicsBridgeImpl.build2DStructuralConstraints(
        topology.edges, allPositions, physicsModel,
        stiffnessArray, dampingArray,
        PhysicsBridgeImpl.DEFAULT_STIFFNESS,
        PhysicsBridgeImpl.DEFAULT_DAMPING
      );
      constraints.push(...c1);
    }

    return constraints;
  }

  // ==========================================================================
  // 材料与坐标计算
  // ==========================================================================

  _computeMaterialCoords() {
    const type = this.representation.type;

    if (type === 'volumetric' || type === 'sphericalHarmonics') {
      return this.surfacePoints.map(p => {
        const coords = ParametricImpl.cartesianToSpherical(
          p.x, p.y, p.z,
          this.center.x, this.center.y, this.center.z
        );
        return { coord1: coords.theta, coord2: coords.phi };
      });
    } else if (type === 'cloth' && this.representation.clothConfig) {
      // Grid 模式有 UV 坐标
      if (this.representation.clothConfig.uvCoords) {
        return this.representation.clothConfig.uvCoords.map(uv => ({
          coord1: uv.u, coord2: uv.v
        }));
      }
      // Organic 模式使用位置归一化作为材料坐标
      const bbox = this.getBoundingBox();
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;
      return this.surfacePoints.map(p => ({
        coord1: width > 0 ? (p.x - bbox.min.x) / width : 0,
        coord2: height > 0 ? (p.y - bbox.min.y) / height : 0
      }));
    } else if (type === 'line' && this.representation.lineConfig) {
      return this.representation.lineConfig.tParams.map(t => ({
        coord1: t, coord2: 0
      }));
    } else if (type === 'elliptic-fourier-2d') {
      // 2D EFD 使用位置归一化
      const bbox = this.getBoundingBox();
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;
      return this.surfacePoints.map(p => ({
        coord1: width > 0 ? (p.x - bbox.min.x) / width : 0,
        coord2: height > 0 ? (p.y - bbox.min.y) / height : 0
      }));
    }

    return this.surfacePoints.map(() => ({ coord1: 0, coord2: 0 }));
  }

  _precomputeMaterialArrays(coordsArray) {
    const material = this.representation.material;

    if (!material || material.uniform === true || !material.properties) {
      return { stiffnessArray: null, dampingArray: null };
    }

    const stiffnessArray = [];
    const dampingArray = [];

    for (let i = 0; i < coordsArray.length; i++) {
      const props = material.properties(coordsArray[i].coord1, coordsArray[i].coord2);
      stiffnessArray[i] = props.stiffness ?? PhysicsBridgeImpl.DEFAULT_STIFFNESS;
      dampingArray[i] = props.damping ?? PhysicsBridgeImpl.DEFAULT_DAMPING;
    }

    return { stiffnessArray, dampingArray };
  }

  _computeSphericalCoordsArray(points) {
    return points.map(p => {
      const coords = ParametricImpl.cartesianToSpherical(
        p.x, p.y, p.z,
        this.center.x, this.center.y, this.center.z
      );
      return {
        theta: coords.theta,
        phi: coords.phi,
        centerVersion: this._centerVersion
      };
    });
  }

  _computeSphericalCoordsArrayFromPositions(positions) {
    return positions.map(p => {
      const coords = ParametricImpl.cartesianToSpherical(
        p.x, p.y, p.z,
        this.center.x, this.center.y, this.center.z
      );
      return {
        theta: coords.theta,
        phi: coords.phi,
        centerVersion: this._centerVersion
      };
    });
  }

  // ==========================================================================
  // getPhysicsView
  // ==========================================================================

  getPhysicsView() {
    if (this.mode !== 'discrete') {
      throw new Error(`[Object] Illegal physics access: mode is '${this.mode}', expected 'discrete'. Call rebuildPhysicsTopology() first.`);
    }

    const physicsState = this.representation.physicsState;
    if (!physicsState || !physicsState.particles || physicsState.particles.length === 0) {
      throw new Error('[Object] Physics data incomplete: particles empty');
    }

    const view = PhysicsBridgeImpl.buildPhysicsView(
      physicsState.particles,
      physicsState.constraints
    );

    return {
      particles: view.particles,
      constraints: view.constraints,
      commit: () => this.commitPhysics()
    };
  }

  // ==========================================================================
  // commitPhysics
  // ==========================================================================

  commitPhysics() {
    const physicsState = this.representation.physicsState;
    
    // 【修复】验证 physicsState 有效性
    if (!physicsState || !physicsState.particles || physicsState.particles.length === 0) {
      return;
    }
    
    const particles = physicsState.particles;
    // 【修复】使用实际数组长度的最小值，防止越界
    const surfaceCount = Math.min(physicsState.surfaceCount, this._surfaceBoundary);

    // 同步表面点位置（直接操作 constructionPoints）
    for (let i = 0; i < surfaceCount; i++) {
      const particle = particles[i];
      if (particle && particle.position) {
        this.constructionPoints[i].x = particle.position.x;
        this.constructionPoints[i].y = particle.position.y;
        this.constructionPoints[i].z = particle.position.z;
      }
    }

    // 同步内部点位置（内部点存储在 constructionPoints[_surfaceBoundary..] 中）
    const internalCount = Math.min(
      physicsState.internalCount, 
      this.constructionPoints.length - this._surfaceBoundary
    );
    const internalStart = physicsState.internalStartIndex;
    for (let i = 0; i < internalCount; i++) {
      const particle = particles[internalStart + i];
      const internalPoint = this.constructionPoints[this._surfaceBoundary + i];
      if (particle && particle.position && internalPoint) {
        internalPoint.x = particle.position.x;
        internalPoint.y = particle.position.y;
        internalPoint.z = particle.position.z;
      }
    }

    // 更新法向量
    if (this.representation.topology.triangles.length > 0) {
      PhysicsBridgeImpl.computeNormals(
        particles,
        this.representation.topology.triangles,
        surfaceCount
      );

      // 同步法向量到 Point（直接操作 constructionPoints）
      for (let i = 0; i < surfaceCount; i++) {
        const n = particles[i].normal;
        if (n) {
          this.constructionPoints[i].nx = n.x;
          this.constructionPoints[i].ny = n.y;
          this.constructionPoints[i].nz = n.z;
        }
      }
    }

    this._boundingBoxDirty = true;
  }

  // ==========================================================================
  // updatePhysicsGeometry
  // ==========================================================================

  updatePhysicsGeometry() {
    if (this.mode !== 'discrete') return;
    if (this.representation.type !== 'volumetric' && this.representation.type !== 'sphericalHarmonics') return;

    const physicsState = this.representation.physicsState;
    if (!physicsState || !physicsState.constraints) return;

    const data = this.representation.data;
    if (!data || !data.coefficients || !data.sphericalHarmonics) {
      console.warn('[Object] Missing spherical harmonics data for updatePhysicsGeometry');
      return;
    }

    const { coefficients, sphericalHarmonics } = data;
    const { particles, constraints } = physicsState;

    // 计算每个粒子的理想位置
    const idealPositions = new Array(particles.length);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p || !p.position) {
        idealPositions[i] = null;
        continue;
      }
      
      let theta, phi;
      
      // 使用缓存的球坐标或重新计算
      if (p._sphericalCoords && p._sphericalCoords.centerVersion === this._centerVersion) {
        theta = p._sphericalCoords.theta;
        phi = p._sphericalCoords.phi;
      } else {
        // 【修复】使用 ParametricImpl 进行坐标转换，避免职责侵犯
        const spherical = ParametricImpl.cartesianToSpherical(
          p.position.x, p.position.y, p.position.z,
          this.center.x, this.center.y, this.center.z
        );
        
        if (spherical.r < 1e-10) {
          idealPositions[i] = { x: p.position.x, y: p.position.y, z: p.position.z };
          continue;
        }
        
        theta = spherical.theta;
        phi = spherical.phi;
        
        // 缓存球坐标
        if (!p._sphericalCoords) {
          p._sphericalCoords = {};
        }
        p._sphericalCoords.theta = theta;
        p._sphericalCoords.phi = phi;
        p._sphericalCoords.centerVersion = this._centerVersion;
      }

      const r = sphericalHarmonics.evaluate(coefficients, theta, phi);
      
      // 【修复】验证 evaluate 返回值
      if (!Number.isFinite(r) || r <= 0) {
        idealPositions[i] = { x: p.position.x, y: p.position.y, z: p.position.z };
        continue;
      }

      // 【修复】使用 ParametricImpl 进行坐标转换
      idealPositions[i] = ParametricImpl.sphericalToCartesian(
        r, theta, phi,
        this.center.x, this.center.y, this.center.z
      );
    }

    // 更新约束 restLength
    let updatedCount = 0;
    for (const constraint of constraints) {
      if (constraint.type === 'distance') {
        const i = constraint.i;
        const j = constraint.j;

        if (i !== undefined && j !== undefined && 
            idealPositions[i] && idealPositions[j]) {
          
          const pi = idealPositions[i];
          const pj = idealPositions[j];
          const dx = pj.x - pi.x;
          const dy = pj.y - pi.y;
          const dz = pj.z - pi.z;
          const newRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          constraint.restLength = newRestLength;
          constraint.distance = newRestLength;
          updatedCount++;
        }
      }
    }

    // 【修复】使用 PhysicsBridgeImpl 更新形状匹配数据
    if (physicsState.internalCount > 0) {
      PhysicsBridgeImpl.updateShapeMatchingData(
        particles,
        idealPositions,
        physicsState.internalStartIndex,
        physicsState.internalStartIndex + physicsState.internalCount
      );
    }

    if (this.verbose) {
      console.log(`[Object] Updated physics geometry: ${updatedCount} distance constraints`);
    }

    this.metadata.modified = Date.now();
  }

  // ==========================================================================
  // 固定点
  // ==========================================================================

  fixPoint(index) {
    if (index < 0 || index >= this._surfaceBoundary) {
      throw new Error(`[Object] Invalid point index: ${index}`);
    }

    if (!this.representation.fixedIndices.includes(index)) {
      this.representation.fixedIndices.push(index);
    }

    if (this.mode === 'discrete') {
      const particles = this.representation.physicsState.particles;
      if (particles[index]) {
        particles[index].fixed = true;
        particles[index].invMass = 0;
      }
    }
  }

  unfixPoint(index) {
    if (index < 0 || index >= this._surfaceBoundary) {
      throw new Error(`[Object] Invalid point index: ${index}`);
    }

    this.representation.fixedIndices = this.representation.fixedIndices.filter(i => i !== index);

    if (this.mode === 'discrete') {
      const particles = this.representation.physicsState.particles;
      if (particles[index]) {
        particles[index].fixed = false;
        // 防止除以零
        const mass = particles[index].mass;
        particles[index].invMass = mass > 0 ? 1 / mass : 0;
      }
    }
  }

  // ==========================================================================
  // 几何量
  // ==========================================================================

  /**
   * 获取体积
   * @returns {number|null}
   */
  getVolume() {
    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric') {
      return null;
    }

    if (this.representation.geometryCache.volume !== null) {
      return this.representation.geometryCache.volume;
    }

    if (!this.representation.data) return null;
    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) return null;

    const volume = ParametricImpl.computeVolume(
      coefficients,
      this.center.x, this.center.y, this.center.z,
      sphericalHarmonics
    );

    this.representation.geometryCache.volume = volume;
    return volume;
  }

  /**
   * 获取表面积
   * @returns {number|null}
   */
  getSurfaceArea() {
    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric') {
      return null;
    }

    if (this.representation.geometryCache.surfaceArea !== null) {
      return this.representation.geometryCache.surfaceArea;
    }

    if (!this.representation.data) return null;
    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) return null;

    const area = ParametricImpl.computeSurfaceArea(
      coefficients,
      this.center.x, this.center.y, this.center.z,
      sphericalHarmonics
    );

    this.representation.geometryCache.surfaceArea = area;
    return area;
  }

  /**
   * 获取截面
   * @param {object} plane - 平面定义 { normal: {x,y,z}, point: {x,y,z} }
   * @returns {object|null}
   */
  getSection(plane) {
    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric') {
      return null;
    }

    // 【修复】验证 plane 参数
    if (!plane || !plane.normal || !plane.point) {
      console.warn('[Object] getSection: invalid plane parameter');
      return null;
    }

    if (!this.representation.data) return null;
    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) return null;

    const planeKey = `${plane.normal.x},${plane.normal.y},${plane.normal.z}:${plane.point.x},${plane.point.y},${plane.point.z}`;
    
    if (this.representation.geometryCache.sections.has(planeKey)) {
      return this.representation.geometryCache.sections.get(planeKey);
    }

    const section = ParametricImpl.computeSection(
      coefficients,
      this.center.x, this.center.y, this.center.z,
      plane,
      sphericalHarmonics
    );

    this.representation.geometryCache.sections.set(planeKey, section);
    return section;
  }

  /**
   * 创建碰撞体
   * @returns {object|null}
   */
  createCollider() {
    if (this.representation.type !== 'sphericalHarmonics' && 
        this.representation.type !== 'volumetric') {
      return null;
    }

    if (!this.representation.data) return null;
    const { coefficients, sphericalHarmonics } = this.representation.data;
    if (!coefficients || !sphericalHarmonics) return null;

    if (!this._collider) {
      this._collider = ParametricImpl.createSphericalCollider(
        coefficients,
        this.center.x, this.center.y, this.center.z,
        sphericalHarmonics
      );
    }

    return this._collider;
  }

  getBoundingBox() {
    if (!this._boundingBoxDirty && this._boundingBox) {
      return this._boundingBox;
    }

    const positions = this._extractPositions(this.surfacePoints);
    if (positions.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }

    this._boundingBox = GeometryImpl.computeBoundingBox(positions);
    this._boundingBoxDirty = false;
    return this._boundingBox;
  }

  // ==========================================================================
  // 调试
  // ==========================================================================

  getDebugInfo() {
    const physicsState = this.representation.physicsState;
    return {
      constructionPoints: this.constructionPoints.length,
      surfacePoints: this._surfaceBoundary,
      internalPoints: this.constructionPoints.length - this._surfaceBoundary,
      controlPoints: this.controlPoints.length,
      displayPoints: this.displayPoints.length,
      representation: this.representation.type,
      isClosed: this.representation.isClosed,
      isVolumetric: this._isVolumetric,
      mode: this.mode,
      surfaceBoundary: this._surfaceBoundary,
      topology: {
        triangles: this.representation.topology.triangles.length,
        edges: this.representation.topology.edges.length,
        internalEdges: this.representation.topology.internalEdges?.length ?? 0,
        skinBoneEdges: this.representation.topology.skinBoneEdges?.length ?? 0
      },
      physicsState: {
        particles: physicsState.particles.length,
        constraints: physicsState.constraints.length,
        surfaceStartIndex: physicsState.surfaceStartIndex,
        internalStartIndex: physicsState.internalStartIndex,
        surfaceCount: physicsState.surfaceCount,
        internalCount: physicsState.internalCount
      },
      versions: {
        controlPoint: this._controlPointVersion,
        constructionPoint: this._constructionPointVersion,
        displayPoint: this._displayPointVersion,
        center: this._centerVersion
      }
    };
  }
}
