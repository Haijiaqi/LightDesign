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
    // ━━━ 阶段1修改：支持点云/朴素对象 ━━━
    // 传入的 points 作为 displayPoints（用于渲染）
    // 从 displayPoints 提取表层点作为 controlPoints（用于拟合）

    // ━━━ 显示点（用于视觉渲染）━━━
    if (points.length > 0) {
      // 阶段3修复：复制点时保留重要属性（tag, isAttractable, light 等）
      this.displayPoints = points.map(p => {
        const np = new Point(p.x, p.y, p.z);
        // 保留吸附和渲染相关属性
        if (p.tag !== undefined) np.tag = p.tag;
        if (p.isAttractable !== undefined) np.isAttractable = p.isAttractable;
        if (p.isGridPoint !== undefined) np.isGridPoint = p.isGridPoint;
        if (p.light !== undefined) np.light = p.light;
        // 保留局部坐标备份（如果存在）
        if (p._localX !== undefined) np._localX = p._localX;
        if (p._localY !== undefined) np._localY = p._localY;
        if (p._localZ !== undefined) np._localZ = p._localZ;
        // 修复：保留法向量（用于光照计算）
        if (p.nx !== undefined) np.nx = p.nx;
        if (p.ny !== undefined) np.ny = p.ny;
        if (p.nz !== undefined) np.nz = p.nz;
        return np;
      });
    } else {
      this.displayPoints = [];
    }
    this._displayPointVersion = 0;

    // ━━━ 核心点集（控制点）━━━
    if (options.controlPoints && options.controlPoints.length > 0) {
      // 显式传入控制点
      this.controlPoints = options.controlPoints;
    } else if (this.displayPoints.length > 0) {
      // 从点云提取表层点作为控制点（简单算法）
      const controlCount = options.controlPointCount || Math.min(100, this.displayPoints.length);
      this.controlPoints = this._extractSurfacePoints(this.displayPoints, controlCount);
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

    // ━━━ 状态标记 ━━━
    this._isVolumetric = false;
    this.mode = 'parametric';
    this._centerVersion = 0;
    // ━━━ 阶段3新增：变换组件 (System of Record) ━━━
    this.transform = {
      position: options.center ? { ...options.center } : GeometryImpl.computeCenter(this._extractPositions(this.controlPoints)),
      rotation: options.quaternion ? { ...options.quaternion } : { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 } // ⚠️ 预留字段，强制 (1,1,1)，禁止修改
    };
    this._dirty = true;

    // ━━━ 物体级可见性 ━━━
    this.isVisible = true;  // [新增] 控制整个物体是否可见（用于隐藏非聚焦物体）

    // 兼容旧属性 (Deprecating)
    this.center = this.transform.position; // 引用同一个对象
    this.quaternion = this.transform.rotation; // 引用同一个对象
    // ===============================================

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
    // 多阶缓存：Map<order, fitStack[]>，支持不同阶数的独立增量拟合缓存
    this._fitStackMap = new Map();
    // 当前使用的阶数（用于编辑态追踪）
    this._currentFitOrder = null;
    // EFD 拟合缓存（椭圆傅里叶）
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

    // ========== 阶段2新增 ==========
    this.animationLock = false;   // 动画锁：true 时跳过物理更新
    this._savedPosition = null;   // 保存的位置（用于动画恢复）
    this.visualAlpha = 1.0;       // 可见度 (0.0-1.0)，用于淡入淡出效果

    // ========== FOCUS 态增强：正面方向 ==========
    // 单位向量，表示物体的"正面"朝向（世界坐标系）
    // 默认 -Y：初始时物体正面背对用户（用户在 +Y 方向看向原点）
    this.frontDirection = options.frontDirection ?? { x: 0, y: -1, z: 0 };
    // 正上方向，默认 +Z (世界坐标系 Up)
    this.upDirection = options.upDirection ?? { x: 0, y: 0, z: 1 };
    // ==============================================

    this.metadata = {
      name: options.name ?? 'Untitled',
      created: Date.now(),
      modified: Date.now()
    };

    // ========== 阶段10新增：中心点对象 ==========
    // 创建一个代表物心的虚拟点
    this.centerPoint = new Point(this.center.x, this.center.y, this.center.z);
    this.centerPoint.isAttractable = true;
    this.centerPoint.isObjectCenter = true;  // 标记为物心
    this.centerPoint.ownerObject = this;      // 关联到所属物体
    // 物心在局部坐标系中始终为原点
    this.centerPoint.lx = 0;
    this.centerPoint.ly = 0;
    this.centerPoint.lz = 0;
    // ============================================

    this.verbose = options.verbose ?? false;

    // ========== 物理系统集成：临时数据层 (Phase 0) ==========
    // 临时显示点：物理态渲染时使用，不污染固有 displayPoints
    this._tempDisplayPoints = null;
    // 临时球谐表示：物理态拟合结果，不污染固有 representation.data
    this._tempRepresentation = null;
    // 物理启用标记
    this._physicsEnabled = false;
    // 缓存的局部坐标数组（避免每帧 new）
    this._cachedLocalPositions = null;
    // 临时显示点初始化标记
    this._tempDisplayPointsInitialized = false;
    // ========================================================

    // ========== 阶段3修复：初始化局部坐标 ==========
    // 如果 options.center 被显式传入，说明工厂方法已经生成了局部坐标
    // 此时 Point.x/y/z 就是 lx/ly/lz，直接复制即可
    // 如果 center 是从点云计算得出的，需要减去 center 得到局部坐标
    const centerWasExplicit = !!options.center;
    const cx = this.center.x;
    const cy = this.center.y;
    const cz = this.center.z;

    const initLocalCoords = (points) => {
      if (!points) return;
      for (const p of points) {
        if (centerWasExplicit) {
          // 工厂方法已生成局部坐标，直接使用 x/y/z
          p.lx = p.x;
          p.ly = p.y;
          p.lz = p.z;
        } else {
          // 传入的是世界坐标，需要减去计算得出的 center
          p.lx = p.x - cx;
          p.ly = p.y - cy;
          p.lz = p.z - cz;
        }
      }
    };

    initLocalCoords(this.displayPoints);
    initLocalCoords(this.controlPoints);
    // constructionPoints 初始时指向 controlPoints，无需重复处理
    // ================================================

    // 初始化世界坐标
    this.updateWorldPoints();
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

  // ==========================================================================
  // 坐标系统核心方法 (阶段3重构)
  // ==========================================================================

  /**
   * 强制刷新世界坐标
   * System of Record: transform (position, rotation) + local points (lx, ly, lz)
   * Derived: world points (x, y, z)
   * 
   * @param {object} options
   * @param {boolean} options.force - 强制更新即使 dirty 为 false
   */
  updateWorldPoints(options = {}) {
    if (!this._dirty && !options.force) return;

    const tx = this.transform.position.x;
    const ty = this.transform.position.y;
    const tz = this.transform.position.z;

    const qx = this.transform.rotation.x;
    const qy = this.transform.rotation.y;
    const qz = this.transform.rotation.z;
    const qw = this.transform.rotation.w;

    // 归一化四元数 (契约强制)
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 0) {
      this.transform.rotation.x /= len;
      this.transform.rotation.y /= len;
      this.transform.rotation.z /= len;
      this.transform.rotation.w /= len;
    }

    const nqx = this.transform.rotation.x;
    const nqy = this.transform.rotation.y;
    const nqz = this.transform.rotation.z;
    const nqw = this.transform.rotation.w;

    // 定义应用变换的内部函数 (Inline for performance)
    const applyTransform = (points) => {
      if (!points) return;
      for (const p of points) {
        // 1. Quaterion Rotate: P_rot = Q * P_local * Q_inv
        // Local coordinates
        const lx = p.lx;
        const ly = p.ly;
        const lz = p.lz;

        // Quaternion multiplication logic
        const ix = nqw * lx + nqy * lz - nqz * ly;
        const iy = nqw * ly + nqz * lx - nqx * lz;
        const iz = nqw * lz + nqx * ly - nqy * lx;
        const iw = -nqx * lx - nqy * ly - nqz * lz;

        const rx = ix * nqw + iw * -nqx + iy * -nqz - iz * -nqy;
        const ry = iy * nqw + iw * -nqy + iz * -nqx - ix * -nqz;
        const rz = iz * nqw + iw * -nqz + ix * -nqy - iy * -nqx;

        // 2. Translate: P_world = P_rot + T
        p.x = rx + tx;
        p.y = ry + ty;
        p.z = rz + tz;

        // 3. 旋转法向量（如果存在且非零）- 法向量只旋转不平移
        // 保存原始局部法向量用于旋转
        // 关键修复：只有非零法向量才保存和旋转，避免覆盖 calculateNormal 的动态赋值
        const hasLocalNormal = p._lnx !== undefined;
        const hasWorldNormal = (p.nx !== 0 || p.ny !== 0 || p.nz !== 0);

        if (!hasLocalNormal && hasWorldNormal) {
          // 首次调用时保存非零的局部法向量
          p._lnx = p.nx;
          p._lny = p.ny;
          p._lnz = p.nz;
        }

        // 只对有保存的非零局部法向量的点进行旋转
        if (hasLocalNormal && (p._lnx !== 0 || p._lny !== 0 || p._lnz !== 0)) {
          const lnx = p._lnx;
          const lny = p._lny;
          const lnz = p._lnz;

          // 四元数旋转法向量
          const nix = nqw * lnx + nqy * lnz - nqz * lny;
          const niy = nqw * lny + nqz * lnx - nqx * lnz;
          const niz = nqw * lnz + nqx * lny - nqy * lnx;
          const niw = -nqx * lnx - nqy * lny - nqz * lnz;

          p.nx = nix * nqw + niw * -nqx + niy * -nqz - niz * -nqy;
          p.ny = niy * nqw + niw * -nqy + niz * -nqx - nix * -nqz;
          p.nz = niz * nqw + niw * -nqz + nix * -nqy - niy * -nqx;
        }
        // 如果没有保存的局部法向量，保持 calculateNormal 赋予的世界法向量不变
      }
    };

    // 批量更新所有点集
    applyTransform(this.controlPoints);
    applyTransform(this.displayPoints);
    applyTransform(this.constructionPoints); // Includes surface & internal

    // 更新中心点虚拟对象
    if (this.centerPoint) {
      this.centerPoint.x = tx;
      this.centerPoint.y = ty;
      this.centerPoint.z = tz;
      this.centerPoint.lx = 0; // Center in local is always 0,0,0
      this.centerPoint.ly = 0;
      this.centerPoint.lz = 0;
    }

    this._dirty = false;
  }

  _extractPositions(points) {
    return points.map(p => ({ x: p.x, y: p.y, z: p.z }));
  }

  /**
   * 从点云提取表层点（阶段1新增）
   * 简单算法：基于点到质心距离，取最远的一批点作为表层点
   * @param {Point[]} points - 点云
   * @param {number} count - 需要的表层点数量
   * @returns {Point[]} 表层点数组
   */
  _extractSurfacePoints(points, count) {
    if (points.length === 0) return [];
    if (points.length <= count) {
      return points.map(p => new Point(p.x, p.y, p.z));
    }

    // 计算质心
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
      cx += p.x; cy += p.y; cz += p.z;
    }
    cx /= points.length;
    cy /= points.length;
    cz /= points.length;

    // 计算每点到质心距离
    const withDist = points.map(p => ({
      point: p,
      dist: Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2)
    }));

    // 按距离降序排序，取最远的 count 个
    withDist.sort((a, b) => b.dist - a.dist);

    return withDist.slice(0, count).map(d => new Point(d.point.x, d.point.y, d.point.z));
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
      this._truncateAllFitStacks(index);
    } else {
      this.controlPoints[index].x = x;
      this.controlPoints[index].y = y;
      this.controlPoints[index].z = z;
      // 截断最后一个状态（基于旧末尾点），但不能增加长度
      this._truncateAllFitStacks(this.controlPoints.length - 1);
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
    this._clearAllFitStacks();
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
        this._truncateAllFitStacks(index);
      } else {
        this.constructionPoints[index].x = x;
        this.constructionPoints[index].y = y;
        this.constructionPoints[index].z = z;
        // 截断最后一个状态，但不能增加长度
        this._truncateAllFitStacks(this._surfaceBoundary - 1);
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

  /**
   * 控制点改变时的回调
   * @param {number} [editedIndex] - 被编辑的控制点索引（可选）
   *   - 如果提供，只截断该索引之后的增量拟合缓存
   *   - 如果未提供，清除所有缓存（保守策略，用于删除/添加点等场景）
   */
  _onControlPointsChanged(editedIndex) {
    this._controlPointVersion++;
    this._fitCache.clear();
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();

    // 根据 editedIndex 决定缓存清理策略
    if (typeof editedIndex === 'number' && editedIndex >= 0) {
      // 精确截断：只清除被编辑点及之后的缓存
      this._truncateAllFitStacks(editedIndex);
    } else {
      // 保守策略：清除所有缓存
      this._clearAllFitStacks();
    }

    if (!this._isVolumetric) {
      this._surfacePointVersion++;
      this._clearTopologyAndCache();
    }

    // 触发重拟合标记
    this._needsRefit = true;
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
  // 多阶拟合缓存管理
  // ==========================================================================

  /**
   * 获取指定阶数的 fitStack
   * 如果不存在则创建空数组
   * @param {number} order - SH 阶数
   * @returns {Array} fitStack
   */
  _getFitStack(order) {
    if (!this._fitStackMap.has(order)) {
      this._fitStackMap.set(order, []);
    }
    return this._fitStackMap.get(order);
  }

  /**
   * 设置指定阶数的 fitStack
   * @param {number} order - SH 阶数
   * @param {Array} stack - fitStack 数组
   */
  _setFitStack(order, stack) {
    this._fitStackMap.set(order, stack);
    this._currentFitOrder = order;
  }

  /**
   * 截断所有阶数的 fitStack 到指定索引
   * 用于控制点修改时保持缓存一致性
   * @param {number} index - 截断到的索引位置
   */
  _truncateAllFitStacks(index) {
    for (const [order, stack] of this._fitStackMap) {
      stack.length = Math.min(stack.length, index);
    }
  }

  /**
   * 清空所有阶数的 fitStack
   * 用于控制点删除或大规模变更
   */
  _clearAllFitStacks() {
    this._fitStackMap.clear();
    this._currentFitOrder = null;
  }

  /**
   * 获取当前缓存的阶数列表
   * @returns {number[]} 已缓存的阶数数组
   */
  _getCachedOrders() {
    return Array.from(this._fitStackMap.keys());
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
    // Phase 1: 新增参数
    const sourcePoints = options.sourcePoints; // Array<{x,y,z}> | undefined
    const writeToTemp = options.writeToTemp ?? false;

    const context = { pointVersion: this._controlPointVersion, order };
    if (!force && !useIncremental) {
      const cached = this._fitCache.get(context);
      if (cached) return cached;
    }

    // [修改] 使用局部坐标进行拟合
    // 局部中心始终为 (0,0,0)
    // Phase 1: 支持外部传入 sourcePoints
    const positions = sourcePoints
      ? sourcePoints
      : this.controlPoints.map(p => ({ x: p.lx, y: p.ly, z: p.lz }));
    const centerPos = { x: 0, y: 0, z: 0 };

    // [新增] 自动计算阶数（如果没有手动指定）
    if (options.order === undefined) {
      // 不留冗余，使用最大可能阶数
      const maxOrder = ParametricImpl.computeMaxOrder(positions.length);
      // options.order 是 const 不能修改，使用局部变量覆盖
      // 注意：上面的 const order = ... 已经定义了，这里需要处理一下逻辑流
    }

    // 重新定义 order 逻辑
    let targetOrder = options.order;
    let structureRange = null;

    if (targetOrder === undefined) {
      // 确保 fitter 已初始化 (保持为了后续拟合使用)
      if (!this._fitterInstance) {
        this._fitterInstance = new FitterClass({ Matrix, verbose: this.verbose });
        this._matrixClass = Matrix;
      }

      // [修改] 使用区间定阶 (基于点数 N 直接查表)
      // 替代原有的 determineOptimalOrder (基于条件数判定)
      targetOrder = ParametricImpl.computeEditOrder(positions.length);
      structureRange = null; // 区间定阶暂无结构范围信息

      if (this.verbose) {
        console.log(`[Object] Interval-based order determination: N=${positions.length} -> L=${targetOrder}`);
      }

      // 旧逻辑已注释：
      /*
      // 使用 v2.4 两阶段自适应阶数确定
      const orderResult = ParametricImpl.determineOptimalOrder(
        positions,
        sphericalHarmonics,
        this._fitterInstance,
        Matrix,
        {
          maxOrder: sphericalHarmonics.maxOrder ?? 15,
          verbose: this.verbose
        }
      );

      targetOrder = orderResult.bestOrder;
      structureRange = orderResult.structureRange;
      */

      // 允许 bestOrder = 0，但 fallback 到 1
      if (targetOrder < 1) {
        console.warn('[Object] No valid SH order found, using order=1 as fallback');
        targetOrder = 1;
      }

      if (this.verbose) {
        console.log(`[Object] Auto-determined order: ${targetOrder}, structure range: [${structureRange?.min}, ${structureRange?.max}]`);
      }
    } else {
      // 限制最大阶数不超过球谐实例支持的阶数
      if (sphericalHarmonics.maxOrder && targetOrder > sphericalHarmonics.maxOrder) {
        targetOrder = sphericalHarmonics.maxOrder;
      }
    }

    if (!this._fitterInstance) {
      this._fitterInstance = new FitterClass({ Matrix, verbose: this.verbose });
      this._matrixClass = Matrix;
    }

    // 最终拟合：使用增量拟合 + 多阶缓存机制
    const fitStack = this._getFitStack(targetOrder);
    let result;
    try {
      result = ParametricImpl.fitSpherical(
        positions,
        centerPos.x, centerPos.y, centerPos.z, // (0,0,0)
        targetOrder,
        fitStack,
        this._fitterInstance,
        Matrix,
        sphericalHarmonics,
        useIncremental,  // 最终拟合时启用增量拟合
        this.verbose
      );
    } catch (err) {
      if (useIncremental) {
        console.warn('[Object] Incremental fit failed, falling back to full fit:', err.message);
        // 清空该阶数的缓存后重试
        const emptyStack = [];
        result = ParametricImpl.fitSpherical(
          positions,
          centerPos.x, centerPos.y, centerPos.z,
          targetOrder,
          emptyStack,
          this._fitterInstance,
          Matrix,
          sphericalHarmonics,
          false,
          this.verbose
        );
        // 更新缓存为新的空栈结果
        this._setFitStack(targetOrder, result.fitStack);
      } else {
        throw err;
      }
    }

    this._setFitStack(targetOrder, result.fitStack);

    // Phase 1: 根据 writeToTemp 路由结果存储
    if (writeToTemp) {
      // 写入临时表示，不污染固有数据
      this._tempRepresentation = {
        coefficients: result.coefficients,
        sphericalHarmonics: sphericalHarmonics,
        coordinateSystem: 'local',
        fittedOrder: targetOrder
      };
    } else {
      // 原有逻辑：写入固有表示
      this.representation.type = 'sphericalHarmonics';
      this.representation.isClosed = true;
      this.representation.data = {
        coefficients: result.coefficients,
        sphericalHarmonics: sphericalHarmonics,
        coordinateSystem: 'local',
        fittedOrder: targetOrder,
        structureRange: structureRange  // v2.4: 保存结构区间
      };

      this.mode = 'parametric';

      if (!useIncremental) {
        this._fitCache.set(context, result);
      }
    }

    return result;
  }

  _autoRefit() {
    if (!this.representation.data?.sphericalHarmonics || !this._fitterInstance) return;

    try {
      // 使用编辑态快速阶数计算（基于控制点数量）
      const N = this.controlPoints.length;

      // 编辑时使用边界判断模式：只有越过当前阶的边界才升降阶
      const currentOrder = this._currentFitOrder ?? this.representation.data.fittedOrder;
      const editOrder = currentOrder !== undefined
        ? ParametricImpl.computeEditOrder(N, { currentOrder })
        : ParametricImpl.computeEditOrder(N);

      this.fitSphericalHarmonics({
        order: editOrder,
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
   * @param {Array} options.coefficients - Phase 2: 自定义系数（默认使用 representation.data）
   * @param {boolean} options.writeToTemp - Phase 2: 是否写入临时显示点
   * @param {boolean} options.inPlace - Phase 2: 是否原地更新现有点（性能优化）
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
    // Phase 2: 新增参数
    const writeToTemp = options.writeToTemp ?? false;
    const inPlace = options.inPlace ?? false;
    const customCoefficients = options.coefficients;

    if (this.representation.type === 'elliptic-fourier-2d') {
      // 2D 布料显示点（使用 EFD 边界）
      return this._generateDisplayPoints2D(count, density);
    }

    if (this.representation.type === 'cloth') {
      // 布料显示点
      return this._generateDisplayPointsCloth(count, density);
    }

    // 3D 球谐体显示点
    // Phase 2: 优先使用传入的 coefficients，否则用固有数据
    const coefficients = customCoefficients || this.representation.data?.coefficients;
    const sphericalHarmonics = this.representation.data?.sphericalHarmonics;
    if (!coefficients || !sphericalHarmonics) {
      throw new Error('[Object] Missing spherical harmonics data');
    }

    // Phase 2: 确定目标数组
    const targetArray = writeToTemp ? this._tempDisplayPoints : this.displayPoints;

    // Phase 2: inPlace 模式 - 原地更新现有点坐标
    if (inPlace && targetArray && targetArray.length > 0) {
      this._updateDisplayPointsInPlace(targetArray, coefficients, sphericalHarmonics);
      return { count: targetArray.length, displayPoints: targetArray };
    }

    // 自动计算采样点数
    if (count === undefined) {
      const surfaceArea = this.getSurfaceArea();
      if (surfaceArea && surfaceArea > 0) {
        // 表面积单位为 cm²，直接乘以密度
        count = Math.round(surfaceArea * density);
        // 允许更低的点数下限，以便于调试稀疏采样
        count = Math.max(10, Math.min(count, 10000));
      } else {
        count = 500;  // 默认值
      }
    }

    // 黄金螺旋采样
    const radiusCallback = (theta, phi) => {
      return sphericalHarmonics.evaluate(coefficients, theta, phi);
    };

    // [修改] 在局部坐标系进行采样 (中心 0,0,0)
    const sampledPositions = GeometryImpl.goldenSpiralSampling(
      count,
      0, 0, 0, // 局部中心
      radiusCallback
    );

    // 创建显示点
    const newPoints = sampledPositions.map(p => {
      const pt = new Point(0, 0, 0); // 世界坐标稍后计算
      // 设置局部坐标
      pt.lx = p.x;
      pt.ly = p.y;
      pt.lz = p.z;
      // [FIX] 设置默认渲染属性，确保新生成的点能被渲染
      pt.tag = 'SURFACE';
      pt.light = 0.8;
      return pt;
    });

    // 计算法向量 (局部坐标系)
    const centerZero = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < newPoints.length; i++) {
      const p = newPoints[i];
      const pos = sampledPositions[i];

      // 使用球谐函数的梯度计算法向量
      const normal = sphericalHarmonics.computeSurfaceNormal?.(
        coefficients, pos.theta, pos.phi, centerZero
      );

      if (normal) {
        // 设置世界法向量初始值 (将被 updateWorldPoints 旋转)
        p.nx = normal.x;
        p.ny = normal.y;
        p.nz = normal.z;
        // 保存局部法向量，确保 updateWorldPoints 能正确旋转它
        p._lnx = normal.x;
        p._lny = normal.y;
        p._lnz = normal.z;
      } else {
        // 后备：径向法向量
        const len = Math.sqrt(p.lx * p.lx + p.ly * p.ly + p.lz * p.lz);
        if (len > 1e-10) {
          const nx = p.lx / len;
          const ny = p.ly / len;
          const nz = p.lz / len;
          p.nx = nx; p.ny = ny; p.nz = nz;
          p._lnx = nx; p._lny = ny; p._lnz = nz;
        }
      }
    }

    // Phase 2: 根据 writeToTemp 路由存储
    if (writeToTemp) {
      this._tempDisplayPoints = newPoints;
    } else {
      this.displayPoints = newPoints;
      this._displayPointVersion++;
      // [新增] 立即更新世界坐标
      this._dirty = true;
      this.updateWorldPoints({ force: true });
    }

    if (this.verbose) {
      console.log(`[Object] Display points generated: ${newPoints.length}, writeToTemp=${writeToTemp}`);
    }

    return {
      count: newPoints.length,
      displayPoints: newPoints
    };
  }

  /**
   * Phase 2: 原地更新显示点坐标（避免 GC）
   * @private
   */
  _updateDisplayPointsInPlace(points, coefficients, sphericalHarmonics) {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const numSamples = points.length;

    for (let i = 0; i < numSamples; i++) {
      // Fibonacci lattice 公式
      const y = 1 - (2 * i + 1) / numSamples;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i;

      // 球坐标
      const phi = Math.acos(Math.max(-1, Math.min(1, y)));
      const thetaNorm = theta % (2 * Math.PI);

      // 获取实际半径
      const r = sphericalHarmonics.evaluate(coefficients, phi, thetaNorm);

      // 笛卡尔坐标
      const sinPhi = Math.sin(phi);
      const p = points[i];
      p.lx = r * sinPhi * Math.cos(thetaNorm);
      p.ly = r * sinPhi * Math.sin(thetaNorm);
      p.lz = r * Math.cos(phi);

      // 计算法向量
      const normal = sphericalHarmonics.computeSurfaceNormal?.(
        coefficients, phi, thetaNorm, { x: 0, y: 0, z: 0 }
      );
      if (normal) {
        p.nx = normal.x;
        p.ny = normal.y;
        p.nz = normal.z;
        p._lnx = normal.x;
        p._lny = normal.y;
        p._lnz = normal.z;
      } else {
        const len = Math.sqrt(p.lx * p.lx + p.ly * p.ly + p.lz * p.lz);
        if (len > 1e-10) {
          p.nx = p.lx / len;
          p.ny = p.ly / len;
          p.nz = p.lz / len;
          p._lnx = p.nx;
          p._lny = p.ny;
          p._lnz = p.nz;
        }
      }
    }
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

      // 阶段1修改：同步法向量到 Point（直接使用 nx/ny/nz）
      const syncCount = Math.min(this._surfaceBoundary, particles.length);
      for (let i = 0; i < syncCount; i++) {
        this.constructionPoints[i].nx = particles[i].nx;
        this.constructionPoints[i].ny = particles[i].ny;
        this.constructionPoints[i].nz = particles[i].nz;
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
        // [Fix] 严格的 NaN 检查，防止污染渲染数据
        if (isNaN(particle.position.x) || isNaN(particle.position.y) || isNaN(particle.position.z)) {
          continue;
        }
        const cp = this.constructionPoints[i];
        cp.x = particle.position.x;
        cp.y = particle.position.y;
        cp.z = particle.position.z;
        // [Fix] 同时更新局部坐标（渲染器可能依赖 lx/ly/lz）
        cp.lx = particle.position.x - this.center.x;
        cp.ly = particle.position.y - this.center.y;
        cp.lz = particle.position.z - this.center.z;
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
        // [Fix] 严格的 NaN 检查
        if (isNaN(particle.position.x) || isNaN(particle.position.y) || isNaN(particle.position.z)) {
          continue;
        }
        internalPoint.x = particle.position.x;
        internalPoint.y = particle.position.y;
        internalPoint.z = particle.position.z;
        // [Fix] 同步局部坐标
        internalPoint.lx = particle.position.x - this.center.x;
        internalPoint.ly = particle.position.y - this.center.y;
        internalPoint.lz = particle.position.z - this.center.z;
      }
    }

    // 更新法向量
    if (this.representation.topology.triangles.length > 0) {
      PhysicsBridgeImpl.computeNormals(
        particles,
        this.representation.topology.triangles,
        surfaceCount
      );

      // 阶段1修改：同步法向量到 Point（直接使用 nx/ny/nz）
      for (let i = 0; i < surfaceCount; i++) {
        this.constructionPoints[i].nx = particles[i].nx;
        this.constructionPoints[i].ny = particles[i].ny;
        this.constructionPoints[i].nz = particles[i].nz;
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

  // ==========================================================================
  // 位置保存/恢复（阶段2新增）
  // ==========================================================================

  /**
   * 保存当前中心位置
   * 用于动画开始前保存状态，便于恢复或过渡
   */
  savePosition() {
    this._savedPosition = {
      x: this.center.x,
      y: this.center.y,
      z: this.center.z
    };
  }

  /**
   * 获取保存的位置
   * @returns {Object|null} 保存的位置 {x, y, z}，若未保存则返回 null
   */
  getSavedPosition() {
    if (this._savedPosition) {
      return { ...this._savedPosition };
    }
    return null;
  }

  /**
   * 清除保存的位置
   */
  clearSavedPosition() {
    this._savedPosition = null;
  }
}
