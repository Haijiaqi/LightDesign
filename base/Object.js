import { Point } from "./Point.js";

/**
 * ================================================================================
 * Object 类 - 几何对象管理（职责重构版）
 * ================================================================================
 * 
 * 职责（重构后）：
 * 1. 点集管理（控制点、表面采样点、内部虚点）
 * 2. 金刚石网络拓扑生成
 * 3. 拟合接口协调
 * 4. 几何量查询接口（转发给球谐类）
 * 5. 物理接口提供
 * 
 * 不关心：
 * - 球谐函数的数学细节
 * - 积分公式、数值导数
 * - θ/φ 网格、eps/steps 参数
 * 
 * 核心原则：
 * - Object 对"球谐数学"完全无感
 * - 只知道这是一个"参数化闭合体"
 * - 所有几何计算委托给 SphericalHarmonics
 */

/**
 * 简化缓存（仅球谐拟合）
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

// ================================================================================
// Object 类主体
// ================================================================================

/**
 * Object - 通用几何与物理对象
 * 
 * ⚠️ 几何表示语义规则：
 * 
 * 1. sphericalHarmonics 表示：
 *    - ✅ 用途：刚体、静态几何、碰撞参考
 *    - ❌ 禁止：软体形变、布料物理的实时几何更新
 *    - 原因：球谐是参数化表示，不跟踪拓扑变化
 * 
 * 2. 物理形变对象：
 *    - ✅ representation.type 必须为 'mesh' 或 'cloth'
 *    - ✅ 几何属性（体积/面积）基于网格计算
 *    - ❌ 禁止使用球谐几何函数解释形变后的点集
 * 
 * 3. 类型切换：
 *    - 刚体 → 软体：调用 convertToMesh() 或 initClothEditState()
 *    - 软体 → 刚体：重新拟合球谐 fitSphericalHarmonics()
 * 
 * ⚠️ 物理接口迁移：
 * 
 * 现代接口（推荐）：
 * - getPhysicsView() + commit() - 零拷贝，XPBD 友好
 * 
 * 旧接口（已废弃）：
 * - getPhysicsData() + applyPhysicsUpdate() - 拷贝数据，破坏物理状态
 * 
 * 问题对比：
 * | 问题 | 旧接口 | 现代接口 |
 * |------|--------|---------|
 * | GC 压力 | ❌ 每帧 new | ✅ 零拷贝 |
 * | 速度精确 | ❌ 反算覆盖 | ✅ 保留精确值 |
 * | XPBD lambda | ❌ 无法累积 | ✅ 跨帧复用 |
 */
export class Object {
  constructor(points = [], options = {}) {
    // ====================================================
    // 三类点分离
    // ====================================================
    
    // 1️⃣ 控制点（用户编辑、参数化控制）
    this.controlPoints = options.controlPoints ?? [];
    this._controlPointVersion = 0;
    
    // 2️⃣ 表面采样点（主要点集）
    this.surfacePoints = points;
    this._surfacePointVersion = 0;
    
    // 3️⃣ 内部虚点（金刚石网络，临时数据）
    this._internalNodes = null;
    
    // 固定中心
    this.center = options.center ?? this._computeCenter(this.surfacePoints);
    
    // 边界盒
    this._boundingBox = null;
    this._boundingBoxDirty = true;

    // ====================================================
    // 几何表示
    // ====================================================
    
    this.representation = {
      type: 'points',  // 'points' | 'sphericalHarmonics' | 'cloth' | 'springMass'
      isClosed: false,
      
      // 几何数据
      data: null,
      
      // 拓扑数据
      topology: {
        triangles: [],
        edges: [],
        adjacency: null,
        degree: null
      },
      
      // 几何量缓存（可选）
      geometryCache: {
        volume: null,
        surfaceArea: null,
        sections: new Map()  // plane key -> {perimeter, area, points}
      },
      
      // 材料参数（不均质）
      material: {
        uniform: true,
        properties: null  // (theta, phi) => {stiffness, damping, mass}
      },
      
      metadata: {}
    };

    // ====================================================
    // 金刚石网络配置
    // ====================================================
    
    this.diamondConfig = {
      enabled: options.diamondEnabled ?? false,
      spacing: options.diamondSpacing ?? 0.1,
      surfaceThreshold: options.surfaceThreshold ?? 0.05,
      maxDepth: options.maxDepth ?? 10
    };

    // ====================================================
    // 缓存（仅球谐拟合）
    // ====================================================
    
    this._fitCache = new SimpleFitCache();

    // ====================================================
    // 物理状态
    // ====================================================
    
    this.physics = {
      enabled: false,
      mass: 1.0,
      velocity: { x: 0, y: 0, z: 0 },
      
      // ⭐⭐⭐ 物理模式选择 ⭐⭐⭐
      // 'pbd': Position-Based Dynamics (默认)
      //   - 生成 type: 'distance' 约束
      //   - 使用 compliance (XPBD 柔度)
      //   - 时间步无关、无条件稳定
      //   - 适合：刚性结构、布料、几何保持
      // 
      // 'force': Force-Based / Mass-Spring System
      //   - 生成 type: 'spring' 约束
      //   - 使用 stiffness + damping
      //   - 时间步依赖、能量守恒可控
      //   - 适合：弹性器件、软Q弹效果、显式交互
      model: options.physicsModel ?? 'pbd'
    };

    // ====================================================
    // 元数据
    // ====================================================
    
    this.metadata = {
      name: options.name ?? 'Untitled',
      created: Date.now(),
      modified: Date.now()
    };
  }

  // ====================================================
  // 表面点管理
  // ====================================================

  /**
   * 添加表面点
   * ⭐ 增强：确保点对象标准化
   */
  addSurfacePoint(point) {
    // 标准化为 Point 实例
    const normalizedPoint = this._normalizePoint(point);
    this.surfacePoints.push(normalizedPoint);
    this._onSurfacePointsChanged();
  }

  removeSurfacePoint(index) {
    if (index >= 0 && index < this.surfacePoints.length) {
      this.surfacePoints.splice(index, 1);
      this._onSurfacePointsChanged();
    }
  }

  updateSurfacePoint(index, x, y, z) {
    if (index >= 0 && index < this.surfacePoints.length) {
      this.surfacePoints[index].x = x;
      this.surfacePoints[index].y = y;
      this.surfacePoints[index].z = z;
      this._onSurfacePointsChanged();
    }
  }

  /**
   * 替换表面点
   * ⭐ 增强：批量标准化
   */
  replaceSurfacePoints(newPoints) {
    // 标准化所有点
    this.surfacePoints = newPoints.map(p => this._normalizePoint(p));
    this._onSurfacePointsChanged();
  }

  /**
   * ⭐ 新增：标准化点对象
   * 
   * 确保点：
   * 1. 是 Point 实例（如果不是则转换）
   * 2. 有 x, y, z 属性
   * 3. 属性可变（支持物理修改）
   * 
   * @private
   */
  _normalizePoint(point) {
    // 如果已经是 Point 实例，直接返回
    if (point instanceof Point) {
      return point;
    }
    
    // 如果是字面量对象，转换为 Point
    if (point && typeof point === 'object' && 
        'x' in point && 'y' in point && 'z' in point) {
      return new Point(point.x, point.y, point.z);
    }
    
    // 兜底：创建原点
    console.warn('Invalid point object, creating origin point');
    return new Point(0, 0, 0);
  }

  _onSurfacePointsChanged() {
    this._surfacePointVersion++;
    this._fitCache.clear();
    this._boundingBoxDirty = true;
    this._internalNodes = null;
    this.representation.topology.triangles = [];
    
    // 清空几何量缓存
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
    
    this.metadata.modified = Date.now();
  }

  // ====================================================
  // 控制点管理
  // ====================================================

  addControlPoint(point) {
    this.controlPoints.push(point);
    this._onControlPointsChanged();
  }

  updateControlPoint(index, x, y, z) {
    if (index >= 0 && index < this.controlPoints.length) {
      this.controlPoints[index].x = x;
      this.controlPoints[index].y = y;
      this.controlPoints[index].z = z;
      this._onControlPointsChanged();
    }
  }

  _onControlPointsChanged() {
    this._controlPointVersion++;
    this._fitCache.clear();
    this.metadata.modified = Date.now();
  }

  // ====================================================
  // 中心管理
  // ====================================================

  _computeCenter(points) {
    if (points.length === 0) return { x: 0, y: 0, z: 0 };
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const n = points.length;
    return { x: cx / n, y: cy / n, z: cz / n };
  }

  setCenterFixed(x, y, z, adjustPoints = false) {
    if (adjustPoints) {
      const dx = x - this.center.x;
      const dy = y - this.center.y;
      const dz = z - this.center.z;
      
      for (const p of this.surfacePoints) {
        p.x += dx;
        p.y += dy;
        p.z += dz;
      }
      
      this._onSurfacePointsChanged();
    }
    
    this.center = { x, y, z };
  }

  // ====================================================
  // 球谐拟合（适配器）
  // ====================================================

  fitSphericalHarmonics(dependencies, options = {}) {
    const context = {
      pointVersion: this._surfacePointVersion,
      order: options.order,
      criterion: options.criterion ?? 'residual'
    };

    // 检查缓存
    const cached = this._fitCache.get(context);
    if (cached) return cached;

    // 验证依赖
    const { SphericalFitter, SphericalHarmonics, FittingCalculator, Matrix } = dependencies;
    if (!SphericalFitter || !SphericalHarmonics || !FittingCalculator || !Matrix) {
      throw new Error('Missing required dependencies for spherical harmonics fitting');
    }

    // 创建拟合器
    const fitter = new SphericalFitter({
      SphericalHarmonics,
      FittingCalculator,
      Matrix,
      maxOrder: options.maxOrder ?? 10,
      minOrder: options.minOrder ?? 2,
      criterion: options.criterion ?? 'residual',
      verbose: options.verbose ?? false
    });

    // 执行拟合
    const fitOptions = {
      improvementThreshold: options.improvementThreshold ?? 0.02,
      symmetry: options.symmetry ?? 'none',
      optimizeRotation: options.optimizeRotation ?? false
    };

    let result;
    if (options.order !== undefined) {
      result = fitter.fit(this.surfacePoints, options.order, this.center, fitOptions);
    } else {
      result = fitter.autoFit(this.surfacePoints, this.center, fitOptions);
    }

    // 更新表示
    this.representation = {
      type: 'sphericalHarmonics',
      isClosed: true,
      data: {
        coefficients: result.coefficients,
        order: result.order,
        sphericalHarmonics: result.sphericalHarmonics
      },
      topology: {
        triangles: [],
        edges: [],
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
        residual: result.residual,
        condition: result.condition,
        pointCount: result.pointCount
      }
    };

    // 写入缓存
    this._fitCache.set(context, result);

    return result;
  }

  // ====================================================
  // ⭐ 几何量计算（转发接口 - 核心重构）
  // ====================================================

  /**
   * 获取体积
   * @param {Object} options - 计算选项（传递给球谐类）
   * @returns {number}
   */
  getVolume(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Volume computation requires spherical harmonics representation');
    }

    // 检查缓存
    if (this.representation.geometryCache.volume !== null) {
      return this.representation.geometryCache.volume;
    }

    // 委托给球谐类计算
    const { coefficients, sphericalHarmonics } = this.representation.data;
    const volume = sphericalHarmonics.computeVolume(
      coefficients,
      this.center,
      options
    );

    // 缓存结果
    this.representation.geometryCache.volume = volume;

    return volume;
  }

  /**
   * 获取表面积
   * @param {Object} options - 计算选项（传递给球谐类）
   * @returns {number}
   */
  getSurfaceArea(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Surface area computation requires spherical harmonics representation');
    }

    // 检查缓存
    if (this.representation.geometryCache.surfaceArea !== null) {
      return this.representation.geometryCache.surfaceArea;
    }

    // 委托给球谐类计算
    const { coefficients, sphericalHarmonics } = this.representation.data;
    const area = sphericalHarmonics.computeSurfaceArea(
      coefficients,
      this.center,
      options
    );

    // 缓存结果
    this.representation.geometryCache.surfaceArea = area;

    return area;
  }

  /**
   * 获取任意平面截面
   * @param {Object} plane - {normal: {x,y,z}, point: {x,y,z}}
   * @param {Object} options - 计算选项（传递给球谐类）
   * @returns {Object} - {perimeter, area, points}
   */
  getSection(plane, options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Section computation requires spherical harmonics representation');
    }

    // 缓存键（基于平面参数）
    const planeKey = this._makePlaneKey(plane);
    
    // 检查缓存
    if (this.representation.geometryCache.sections.has(planeKey)) {
      return this.representation.geometryCache.sections.get(planeKey);
    }

    // 委托给球谐类计算
    const { coefficients, sphericalHarmonics } = this.representation.data;
    const section = sphericalHarmonics.computeSection(
      coefficients,
      this.center,
      plane,
      options
    );

    // 缓存结果
    this.representation.geometryCache.sections.set(planeKey, section);

    return section;
  }

  /**
   * 生成平面缓存键
   * @private
   */
  _makePlaneKey(plane) {
    const precision = 1000;
    return `${Math.round(plane.normal.x * precision)},${Math.round(plane.normal.y * precision)},${Math.round(plane.normal.z * precision)}:${Math.round(plane.point.x * precision)},${Math.round(plane.point.y * precision)},${Math.round(plane.point.z * precision)}`;
  }

  /**
   * 清空几何量缓存
   */
  clearGeometryCache() {
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
  }

  // ====================================================
  // ⭐ 布料系统（阶段 1: 编辑态）
  // ====================================================

  /**
   * ⭐ 初始化布料编辑态
   * 
   * @param {Object} options
   *   - width: 布料宽度
   *   - height: 布料高度
   *   - rows: UV 行数
   *   - cols: UV 列数
   *   - shape: 'rectangle' | 'circle'
   */
  initClothEditState(options = {}) {
    const width = options.width ?? 1.0;
    const height = options.height ?? 1.0;
    const rows = options.rows ?? 20;
    const cols = options.cols ?? 20;
    const shape = options.shape ?? 'rectangle';
    
    // ⭐ 物理模式（PBD 或 Force）
    const physicsModel = options.physicsModel ?? 'pbd';
    this.physics.model = physicsModel;
    
    // 生成 2D 控制点（展平态）
    const controlPoints = this._generateClothControlPoints(
      width, height, rows, cols, shape
    );
    
    // 更新表示
    this.representation = {
      type: 'cloth',
      isClosed: false,
      
      editState: {
        controlPoints,
        uvGrid: { rows, cols, width, height },
        shape,
        constraints: [],
        preview: null  // ⭐ 预览网格（初始为空）
      },
      
      physicsState: null,
      
      topology: {
        triangles: [],
        edges: [],
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
    
    // ⭐ 修正：立即生成初始预览网格
    this._rebuildEditStatePreview();
    
    this._onSurfacePointsChanged();
    
    return { 
      controlPoints: controlPoints.length, 
      uvGrid: { rows, cols } 
    };
  }

  /**
   * 生成布料控制点（2D）
   * @private
   */
  _generateClothControlPoints(width, height, rows, cols, shape) {
    const points = [];
    
    if (shape === 'rectangle') {
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          
          points.push(new Point(
            (u - 0.5) * width,
            (v - 0.5) * height,
            0
          ));
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
          
          points.push(new Point(
            centerX + r * Math.cos(theta),
            centerY + r * Math.sin(theta),
            0
          ));
        }
      }
    }
    
    return points;
  }

  /**
   * 更新布料控制点（编辑态）
   * 
   * ⭐ 修正：添加实时预览三角网
   */
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
      
      // ⭐ 修正：重建编辑态预览三角网
      this._rebuildEditStatePreview();
      
      this._onControlPointsChanged();
    }
  }

  /**
   * ⭐ 新增：重建编辑态预览三角网
   * 
   * 功能：
   * - 用户移动控制点后，立即重建三角网用于视觉预览
   * - 不生成物理约束（仍在编辑态）
   * - 不切换到物理态
   * 
   * @private
   */
  _rebuildEditStatePreview() {
    if (this.representation.type !== 'cloth') return;
    if (this.representation.metadata.state !== 'edit') return;
    
    const { uvGrid } = this.representation.editState;
    const { rows, cols } = uvGrid;
    
    // 1. 基于控制点生成预览顶点
    const previewVertices = this.controlPoints.map(cp => ({
      x: cp.x,
      y: cp.y,
      z: cp.z
    }));
    
    // 2. 生成预览三角面
    const previewFaces = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;
        previewFaces.push([idx, idx + 1, idx + cols + 2]);
        previewFaces.push([idx, idx + cols + 2, idx + cols + 1]);
      }
    }
    
    // 3. 生成预览边（用于线框渲染）
    const previewEdges = new Set();
    for (const [a, b, c] of previewFaces) {
      const e1 = [Math.min(a, b), Math.max(a, b)];
      const e2 = [Math.min(b, c), Math.max(b, c)];
      const e3 = [Math.min(a, c), Math.max(a, c)];
      
      previewEdges.add(`${e1[0]}-${e1[1]}`);
      previewEdges.add(`${e2[0]}-${e2[1]}`);
      previewEdges.add(`${e3[0]}-${e3[1]}`);
    }
    
    // 4. 存储预览数据（不影响物理态）
    this.representation.editState.preview = {
      vertices: previewVertices,
      faces: previewFaces,
      edges: Array.from(previewEdges).map(e => e.split('-').map(Number))
    };
    
    // 注意：不更新 surfacePoints（编辑态不使用）
    // 注意：不生成约束（仍在编辑态）
    // 注意：不切换状态（仍为 'edit'）
  }

  // ====================================================
  // ⭐ 线形态系统（一维）
  // ====================================================

  /**
   * ⭐ 初始化线形态
   * 
   * 特点：
   * - 一维结构（只有边，无三角面）
   * - 使用 surfacePoints 表示离散点
   * - topology 仅包含 edges
   * - 物理约束：distance + bending
   * - 复用 getPhysicsView / fixPoint / collider
   * 
   * @param {Object} options
   *   - points: Point[] - 初始点数组
   *   - segments: number - 段数（如果不提供 points）
   *   - length: number - 总长度（如果不提供 points）
   *   - shape: 'straight' | 'circle' | 'spiral'
   */
  initLineState(options = {}) {
    let points;
    
    if (options.points) {
      // 使用用户提供的点
      points = options.points.map(p => this._normalizePoint(p));
    } else {
      // 生成线形点
      const segments = options.segments ?? 20;
      const length = options.length ?? 1.0;
      const shape = options.shape ?? 'straight';
      
      points = this._generateLinePoints(segments, length, shape);
    }
    
    // 生成拓扑（仅边）
    const edges = [];
    for (let i = 0; i < points.length - 1; i++) {
      edges.push([i, i + 1]);
    }
    
    // 闭合线（可选）
    if (options.closed) {
      edges.push([points.length - 1, 0]);
    }
    
    // 更新表示
    this.representation = {
      type: 'line',
      isClosed: options.closed ?? false,
      
      topology: {
        triangles: [],  // 线没有三角面
        edges,
        adjacency: this._buildLineAdjacency(edges, points.length),
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
        state: 'physics'  // 线直接进入物理态
      }
    };
    
    this.surfacePoints = points;
    this._onSurfacePointsChanged();
    
    return {
      points: points.length,
      edges: edges.length
    };
  }

  /**
   * 生成线形点
   * @private
   */
  _generateLinePoints(segments, length, shape) {
    const points = [];
    
    if (shape === 'straight') {
      // 直线
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        points.push(new Point(
          t * length - length / 2,
          0,
          0
        ));
      }
    } else if (shape === 'circle') {
      // 圆形
      const radius = length / (2 * Math.PI);
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        points.push(new Point(
          radius * Math.cos(theta),
          radius * Math.sin(theta),
          0
        ));
      }
    } else if (shape === 'spiral') {
      // 螺旋
      const radius = 0.5;
      const height = length;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const theta = t * 4 * Math.PI;
        points.push(new Point(
          radius * Math.cos(theta),
          radius * Math.sin(theta),
          t * height - height / 2
        ));
      }
    }
    
    return points;
  }

  /**
   * 构建线的邻接关系
   * @private
   */
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

  /**
   * 构建线的约束
   * @private
   */
  _buildLineConstraints() {
    const constraints = [];
    const { edges } = this.representation.topology;
    
    // ⭐⭐⭐ 约束生成规范声明 ⭐⭐⭐
    // 根据 physics.model 生成不同类型的约束：
    // - 'pbd': 生成 type === 'distance'（PBD/XPBD 几何约束）
    // - 'force': 生成 type === 'spring'（MSS 力学弹簧）
    
    const physicsModel = this.physics.model || 'pbd';
    
    // 1. 距离约束（沿线）
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      // ⭐ 获取材料属性
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      // ⭐ 根据物理模式生成约束
      if (physicsModel === 'pbd') {
        // ✅ PBD 模式
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        
        constraints.push({
          type: 'distance',           // ⭐ PBD 几何约束
          i, j,                       // ⭐ 主索引
          particles: [i, j],          // 📋 辅助字段
          restLength,
          distance: restLength,
          edgeType: 'structural',     // ⭐ 元数据
          compliance                  // ⭐ XPBD 柔度
          // ❌ 禁止：stiffness, damping
        });
      } else if (physicsModel === 'force') {
        // ✅ Force 模式
        constraints.push({
          type: 'spring',             // ⭐ MSS 力学弹簧
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: avgStiffness,    // ⭐ 弹簧刚度
          damping: avgDamping         // ⭐ 弹簧阻尼
          // ❌ 禁止：compliance
        });
      }
    }
    
    // 2. 弯曲约束（三点共线）
    // 对于线，弯曲约束是三个连续点
    for (let i = 0; i < this.surfacePoints.length - 2; i++) {
      const p0 = this.surfacePoints[i];
      const p1 = this.surfacePoints[i + 1];
      const p2 = this.surfacePoints[i + 2];
      
      // 初始角度
      const v1 = {
        x: p1.x - p0.x,
        y: p1.y - p0.y,
        z: p1.z - p0.z
      };
      const v2 = {
        x: p2.x - p1.x,
        y: p2.y - p1.y,
        z: p2.z - p1.z
      };
      
      const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
      const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
      
      if (mag1 > 1e-6 && mag2 > 1e-6) {
        const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
        const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        // ⭐ 根据物理模式生成弯曲约束
        if (physicsModel === 'pbd') {
          // ✅ PBD 模式：使用 line_bending 约束
          constraints.push({
            type: 'line_bending',       // ⭐ PBD 线弯曲约束
            particles: [i, i + 1, i + 2],
            restAngle,
            compliance: 0.05            // ⭐ 线弯曲通常较软
            // ❌ 禁止：stiffness
          });
        } else if (physicsModel === 'force') {
          // ✅ Force 模式：用软弹簧模拟弯曲
          // 连接 p0 和 p2（跳过中间点）
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
            stiffness: 50,              // ⭐ 弯曲弹簧较软
            damping: 5
          });
        }
      }
    }
    
    // 3. 闭合线：添加首尾弯曲约束
    if (this.representation.isClosed && this.surfacePoints.length > 2) {
      const n = this.surfacePoints.length;
      
      // ⭐ 首尾弯曲约束 1：倒数第二、最后、第一个点
      {
        const p0 = this.surfacePoints[n - 2];
        const p1 = this.surfacePoints[n - 1];
        const p2 = this.surfacePoints[0];
        
        const v1 = {
          x: p1.x - p0.x,
          y: p1.y - p0.y,
          z: p1.z - p0.z
        };
        const v2 = {
          x: p2.x - p1.x,
          y: p2.y - p1.y,
          z: p2.z - p1.z
        };
        
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
      
      // ⭐ 首尾弯曲约束 2：最后、第一、第二个点
      {
        const p1 = this.surfacePoints[n - 1];
        const p2 = this.surfacePoints[0];
        const p3 = this.surfacePoints[1];
        
        const v3 = {
          x: p2.x - p1.x,
          y: p2.y - p1.y,
          z: p2.z - p1.z
        };
        const v4 = {
          x: p3.x - p2.x,
          y: p3.y - p2.y,
          z: p3.z - p2.z
        };
        
        const mag3 = Math.sqrt(v3.x * v3.x + v3.y * v3.y + v3.z * v3.z);
        const mag4 = Math.sqrt(v4.x * v4.x + v4.y * v4.y + v4.z * v4.z);
        
        if (mag3 > 1e-6 && mag4 > 1e-6) {
          const dot2 = (v3.x * v4.x + v3.y * v4.y + v3.z * v4.z) / (mag3 * mag4);
          const restAngle2 = Math.acos(Math.max(-1, Math.min(1, dot2)));
          
          if (physicsModel === 'pbd') {
            constraints.push({
              type: 'line_bending',
              particles: [n - 1, 0, 1],
              restAngle: restAngle2,
              compliance: 0.05
            });
          } else if (physicsModel === 'force') {
            const dx = p3.x - p1.x;
            const dy = p3.y - p1.y;
            const dz = p3.z - p1.z;
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

  /**
   * 添加布料约束（编辑态）
   */
  addClothConstraint(constraint) {
    if (this.representation.type !== 'cloth') {
      throw new Error('Not a cloth object');
    }
    
    this.representation.editState.constraints.push(constraint);
  }

  // ====================================================
  // ⭐ 布料系统（阶段 2: 生成物理态）
  // ====================================================

  /**
   * ⭐ 从编辑态生成物理态
   * 
   * @param {Object} options
   *   - initialPosition: 'flat' | 'custom'
   */
  generateClothPhysicsState(options = {}) {
    if (this.representation.type !== 'cloth') {
      throw new Error('Not a cloth object');
    }
    
    if (this.representation.metadata.state !== 'edit') {
      throw new Error('Already in physics state');
    }
    
    const { controlPoints, uvGrid } = this.representation.editState;
    const { rows, cols } = uvGrid;
    
    // 1. 生成 3D 顶点
    const vertices = controlPoints.map(cp => ({
      x: cp.x,
      y: cp.y,
      z: cp.z
    }));
    
    // 2. 构建三角面
    const faces = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;
        
        // 每个四边形 → 两个三角形
        faces.push([idx, idx + 1, idx + cols + 2]);
        faces.push([idx, idx + cols + 2, idx + cols + 1]);
      }
    }
    
    // 3. 构建拓扑
    const topology = this._buildClothTopology(faces, vertices.length);
    
    // 4. 生成 UV 坐标
    const uvCoords = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        uvCoords.push({
          u: j / cols,
          v: i / rows
        });
      }
    }
    
    // 5. 转换为 surfacePoints
    this.surfacePoints = vertices.map(v => 
      new Point(v.x, v.y, v.z)
    );
    
    // 6. ⭐ 修正：在这里生成约束（只生成一次）
    const constraints = this._buildClothConstraints();
    
    // 7. 更新表示
    this.representation.physicsState = {
      vertices,
      faces,
      uvCoords,
      constraints  // ⭐ 缓存约束
    };
    
    this.representation.topology = topology;
    
    // 8. 切换到物理态
    this.representation.metadata.state = 'physics';
    
    // 手动维护状态
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    this.metadata.modified = Date.now();
    
    return {
      vertices: vertices.length,
      faces: faces.length,
      constraints: constraints.length,
      topology
    };
  }

  /**
   * 构建布料拓扑
   * @private
   */
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
      adjacency,
      degree: Array.from(adjacency.values()).map(n => n.length)
    };
  }

  // ====================================================
  // ⭐ 布料系统（阶段 3: 约束增强）
  // ====================================================

  /**
   * 构建布料约束（距离 + 弯曲）
   * @private
   */
  _buildClothConstraints() {
    const constraints = [];
    
    const { edges, triangles } = this.representation.topology;
    
    // ⭐⭐⭐ 约束生成规范声明 ⭐⭐⭐
    // 根据 physics.model 生成不同类型的约束：
    // - 'pbd': 生成 type === 'distance'（PBD/XPBD 几何约束）
    // - 'force': 生成 type === 'spring'（MSS 力学弹簧）
    
    const physicsModel = this.physics.model || 'pbd';
    
    // 1. 结构边约束
    for (const [i, j] of edges) {
      const p1 = this.surfacePoints[i];
      const p2 = this.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      // ⭐ 获取材料属性
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      if (!this.representation.material.uniform) {
        const mat1 = this.getMaterialAt(p1);
        const mat2 = this.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      // ⭐ 根据物理模式生成约束
      if (physicsModel === 'pbd') {
        // ✅ PBD 模式
        const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        
        constraints.push({
          type: 'distance',           // ⭐ PBD 几何约束
          i, j,                       // ⭐ 主索引
          particles: [i, j],          // 📋 辅助字段
          restLength,
          distance: restLength,
          edgeType: 'structural',     // ⭐ 元数据
          compliance                  // ⭐ XPBD 柔度
          // ❌ 禁止：stiffness, damping
        });
      } else if (physicsModel === 'force') {
        // ✅ Force 模式
        constraints.push({
          type: 'spring',             // ⭐ MSS 力学弹簧
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',     // ⭐ 元数据（可用于调试）
          stiffness: avgStiffness,    // ⭐ 弹簧刚度
          damping: avgDamping         // ⭐ 弹簧阻尼
          // ❌ 禁止：compliance
        });
      }
    }
    
    // 2. 弯曲约束
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
              
              // ⭐ 弯曲约束：通常使用 PBD（更稳定）
              // 注意：Force 模式不支持 bending 类型
              if (physicsModel === 'pbd') {
                constraints.push({
                  type: 'bending',        // ⭐ PBD 弯曲约束
                  particles: [a, b, c, d],
                  restAngle: initialAngle,
                  compliance: 0.1         // ⭐ 弯曲通常更软
                });
              } else {
                // Force 模式：可以用软弹簧模拟弯曲
                // 连接对角顶点 c-d
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
                  stiffness: 100,         // ⭐ 弯曲弹簧较软
                  damping: 5
                });
              }
            }
            
            break;
          }
        }
      }
    }
    
    // 3. ⭐ 修正：不在约束生成中调用 fixPoint
    // 固定点约束作为标记返回，在 getPhysicsView() 中统一解析
    // 这样保持约束生成函数为纯函数
    
    return constraints;
  }

  /**
   * 计算二面角
   * @private
   */
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

  /**
   * 3D 叉乘
   * @private
   */
  _cross3D(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  // ====================================================
  // ⭐ 布料系统（阶段 4: 碰撞体）
  // ====================================================

  /**
   * ⭐ 设置碰撞体
   * 
   * @param {Object} collider
   *   - containsPoint(x, y, z) => boolean
   *   - getNormal(x, y, z) => {x, y, z}
   *   - projectToSurface(x, y, z) => {x, y, z}
   */
  setCollider(collider) {
    if (!collider.containsPoint || typeof collider.containsPoint !== 'function') {
      throw new Error('Collider must have containsPoint(x, y, z) method');
    }
    
    this.physics.collider = collider;
  }

  /**
   * ⭐ 从球谐对象创建碰撞体（高精度版）
   * 
   * ⭐ 改进：使用 SphericalHarmonics 类的高精度几何查询方法
   * 
   * @param {Object} sphericalHarmonicsObject
   * @returns {Object} 标准碰撞体接口
   */
  static createColliderFromSphericalHarmonics(sphericalHarmonicsObject) {
    if (sphericalHarmonicsObject.representation.type !== 'sphericalHarmonics') {
      throw new Error('Object is not a spherical harmonics representation');
    }
    
    const { coefficients, sphericalHarmonics } = sphericalHarmonicsObject.representation.data;
    const center = sphericalHarmonicsObject.center;
    
    return {
      type: 'sphericalHarmonics',
      
      // ⭐ 使用球谐类的高精度符号距离
      containsPoint(x, y, z) {
        const sd = sphericalHarmonics.signedDistance(
          coefficients, x, y, z, center
        );
        return sd < 0;  // 负数 = 内部
      },
      
      // ⭐ 使用球谐类的高精度表面法线（基于梯度）
      // 
      // ⚠️ 当前实现：径向近似法线
      // - 对球体：精确
      // - 对一般球谐体：近似（真实法线 ≠ 径向）
      // 
      // ⚠️ 适用场景：
      // - 实时物理碰撞：✅ 视觉可接受
      // - 精确摩擦/折痕：⚠️ 可能有误差
      // 
      // ⚠️ 后续升级：可基于球谐梯度计算真实表面法线
      // - 使用 sphericalHarmonics.computeSurfaceNormal()
      // - 接口保持不变
      getNormal(x, y, z) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (rCart < 1e-10) {
          return { x: 0, y: 1, z: 0 };
        }
        
        // 计算球坐标
        const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
        const phi = Math.atan2(dy, dx);
        
        // 使用高精度法线计算
        return sphericalHarmonics.computeSurfaceNormal(
          coefficients, theta, phi, center
        );
      },
      
      // ⭐ 使用球谐类的精确投影
      projectToSurface(x, y, z) {
        const proj = sphericalHarmonics.projectToSurface(
          coefficients, x, y, z, center
        );
        return proj.point;
      },
      
      // ⭐ 新增：获取完整投影信息（包括法线、穿透深度）
      getProjectionInfo(x, y, z) {
        return sphericalHarmonics.projectToSurface(
          coefficients, x, y, z, center
        );
      },
      
      // ⭐ 新增：穿透深度查询
      getPenetrationDepth(x, y, z) {
        const proj = sphericalHarmonics.projectToSurface(
          coefficients, x, y, z, center
        );
        return proj.penetration;
      },
      
      // ⭐ 新增：符号距离查询（快速）
      getSignedDistance(x, y, z) {
        return sphericalHarmonics.signedDistance(
          coefficients, x, y, z, center
        );
      }
    };
  }

  /**
   * ⭐ 新增：获取编辑态预览网格
   * 
   * 用途：渲染系统可调用此方法获取实时预览三角网
   * 
   * @returns {Object|null} - { vertices, faces, edges } 或 null
   */
  getEditStatePreview() {
    if (this.representation.type !== 'cloth') return null;
    if (this.representation.metadata.state !== 'edit') return null;
    
    return this.representation.editState.preview;
  }

  // ====================================================
  // ⭐ 布料系统（阶段 5: 状态切换）
  // ====================================================

  /**
   * 切换回编辑态
   * 
   * ⚠️ 警告：会丢失物理模拟的所有变形
   */
  switchToEditState() {
    if (this.representation.type !== 'cloth') {
      throw new Error('Not a cloth object');
    }
    
    if (this.representation.metadata.state === 'edit') {
      console.warn('Already in edit state');
      return;
    }
    
    this.representation.metadata.state = 'edit';
    this.surfacePoints = [];
    this.controlPoints = this.representation.editState.controlPoints;
    
    this.representation.physicsState = null;
    this.representation.topology = {
      triangles: [],
      edges: [],
      adjacency: null,
      degree: null
    };
    
    this._onSurfacePointsChanged();
    
    console.warn('Physics state discarded. All deformations lost.');
  }

  /**
   * 检查当前状态
   */
  isInEditState() {
    return this.representation.type === 'cloth' && 
           this.representation.metadata.state === 'edit';
  }

  isInPhysicsState() {
    return this.representation.type === 'cloth' && 
           this.representation.metadata.state === 'physics';
  }

  // ====================================================
  // 金刚石网络生成（保持不变）
  // ====================================================

  generateDiamondNetwork(options = {}) {
    if (this.representation.type !== 'sphericalHarmonics') {
      throw new Error('Diamond network requires spherical harmonics representation');
    }

    const spacing = options.spacing ?? this.diamondConfig.spacing;
    const threshold = options.surfaceThreshold ?? this.diamondConfig.surfaceThreshold;
    
    // ⭐ 物理模式（PBD 或 Force）
    const physicsModel = options.physicsModel ?? this.physics.model ?? 'pbd';
    this.physics.model = physicsModel;
    
    const { coefficients, sphericalHarmonics } = this.representation.data;

    // 1. 估计体的大小（委托给球谐类）
    const boundingRadius = sphericalHarmonics._estimateBoundingRadius(coefficients);
    const gridSize = Math.ceil(boundingRadius * 2 / spacing) + 2;

    // 2. 生成金刚石晶格
    const lattice = this._generateDiamondLattice(gridSize, spacing);

    // 3. 过滤体内节点
    const internalNodes = [];
    const nodeMap = new Map();

    for (const node of lattice) {
      const dx = node.x - this.center.x;
      const dy = node.y - this.center.y;
      const dz = node.z - this.center.z;
      
      const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (rCart < 1e-10) continue;

      const theta = Math.acos(dz / rCart);
      const phi = Math.atan2(dy, dx);

      // 委托给球谐类评估
      const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);

      if (rCart < rSH - threshold) {
        const idx = internalNodes.length;
        nodeMap.set(this._positionKey(node), idx);
        internalNodes.push({
          position: { x: node.x, y: node.y, z: node.z },
          neighbors: [],
          isSurface: false,
          theta,
          phi,
          rCart,
          rSH
        });
      } else if (rCart >= rSH - threshold && rCart < rSH + threshold) {
        const idx = internalNodes.length;
        nodeMap.set(this._positionKey(node), idx);
        internalNodes.push({
          position: { x: node.x, y: node.y, z: node.z },
          neighbors: [],
          isSurface: true,
          theta,
          phi,
          rCart,
          rSH
        });
      }
    }

    // 4. 构建邻接关系
    this._buildDiamondAdjacency(internalNodes, nodeMap, spacing);

    // 5. 表面补点
    const surfacePoints = this._generateSurfacePoints(
      internalNodes, 
      coefficients, 
      sphericalHarmonics,
      spacing
    );

    // 6. 构建表面三角网
    const topology = this._buildSurfaceTriangulation(surfacePoints);

    // 7. ⭐ 修正：更新状态但不清空拓扑
    this.surfacePoints = surfacePoints.map(sp => 
      new Point(sp.position.x, sp.position.y, sp.position.z)
    );
    
    this._internalNodes = internalNodes;
    this.representation.topology = topology;
    
    // ⭐ 关键修正：手动维护状态，不调用 _onSurfacePointsChanged()
    this._surfacePointVersion++;
    this._boundingBoxDirty = true;
    
    // 清空几何缓存（因为表面重建了）
    this.representation.geometryCache.volume = null;
    this.representation.geometryCache.surfaceArea = null;
    this.representation.geometryCache.sections.clear();
    
    this.metadata.modified = Date.now();
    
    // 注意：不清空 topology（刚刚生成的）
    // 注意：不清空 _fitCache（拟合结果仍有效）

    return {
      surfacePoints,
      topology,
      internalNodes: internalNodes.length
    };
  }

  _generateDiamondLattice(gridSize, spacing) {
    const nodes = [];
    const halfGrid = Math.floor(gridSize / 2);

    const fccBase = [
      [0, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5]
    ];

    for (let i = -halfGrid; i <= halfGrid; i++) {
      for (let j = -halfGrid; j <= halfGrid; j++) {
        for (let k = -halfGrid; k <= halfGrid; k++) {
          for (const [fx, fy, fz] of fccBase) {
            const x = this.center.x + (i + fx) * spacing;
            const y = this.center.y + (j + fy) * spacing;
            const z = this.center.z + (k + fz) * spacing;
            nodes.push({ x, y, z });

            const x2 = x + 0.25 * spacing;
            const y2 = y + 0.25 * spacing;
            const z2 = z + 0.25 * spacing;
            nodes.push({ x: x2, y: y2, z: z2 });
          }
        }
      }
    }

    return nodes;
  }

  /**
   * ⭐ 修正：金刚石邻接关系构建
   * 
   * 问题：节点数据结构不一致
   * - internalNodes 中节点有 .position 字段
   * - 但这里直接访问 node.position 导致错误
   * 
   * 修正：统一使用 node.position
   */
  _buildDiamondAdjacency(nodes, nodeMap, spacing) {
    const bondLength = spacing * Math.sqrt(3) / 4;
    const tolerance = bondLength * 0.1;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      for (let j = i + 1; j < nodes.length; j++) {
        const other = nodes[j];
        
        // ✅ 修正：正确访问 position 字段
        const dx = other.position.x - node.position.x;
        const dy = other.position.y - node.position.y;
        const dz = other.position.z - node.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (Math.abs(dist - bondLength) < tolerance) {
          node.neighbors.push(j);
          other.neighbors.push(i);
        }
      }

      // 限制为4个邻居（金刚石约束）
      if (node.neighbors.length > 4) {
        node.neighbors = node.neighbors.slice(0, 4);
      }
    }
  }

  _generateSurfacePoints(internalNodes, coeffs, sh, spacing) {
    const surfacePoints = [];
    const surfacePointMap = new Map();

    const tetrahedralDirections = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1]
    ];

    for (let i = 0; i < internalNodes.length; i++) {
      const node = internalNodes[i];
      
      if (!node.isSurface) continue;

      const interiorNeighborCount = node.neighbors.filter(nIdx => 
        !internalNodes[nIdx].isSurface
      ).length;

      let surfacePointsToAdd = 0;
      if (interiorNeighborCount === 1) surfacePointsToAdd = 3;
      else if (interiorNeighborCount === 2) surfacePointsToAdd = 2;
      else if (interiorNeighborCount === 3) surfacePointsToAdd = 1;
      else continue;

      const usedDirections = node.neighbors.map(nIdx => {
        const other = internalNodes[nIdx];
        return this._normalizeDirection([
          other.position.x - node.position.x,
          other.position.y - node.position.y,
          other.position.z - node.position.z
        ]);
      });

      const availableDirections = tetrahedralDirections.filter(dir => {
        return !usedDirections.some(used => 
          this._directionsSimilar(dir, used)
        );
      });

      for (let d = 0; d < Math.min(surfacePointsToAdd, availableDirections.length); d++) {
        const dir = availableDirections[d];
        
        // 委托给球谐类
        const surfacePos = this._projectToSurface(
          node.position,
          dir,
          coeffs,
          sh,
          spacing
        );

        if (surfacePos) {
          const key = this._positionKey(surfacePos);
          if (!surfacePointMap.has(key)) {
            const idx = surfacePoints.length;
            surfacePointMap.set(key, idx);
            
            surfacePoints.push({
              position: surfacePos,
              neighbors: [],
              fromNode: i,
              isSurface: true
            });
          }
        }
      }
    }

    this._buildSurfaceAdjacency(surfacePoints, spacing);

    return surfacePoints;
  }

  _projectToSurface(startPos, direction, coeffs, sh, spacing) {
    const [dx, dy, dz] = this._normalizeDirection(direction);
    
    let t = 0;
    const maxSteps = 20;
    const step = spacing * 0.5;

    for (let i = 0; i < maxSteps; i++) {
      t += step;
      const x = startPos.x + t * dx;
      const y = startPos.y + t * dy;
      const z = startPos.z + t * dz;

      const rx = x - this.center.x;
      const ry = y - this.center.y;
      const rz = z - this.center.z;
      const rCart = Math.sqrt(rx * rx + ry * ry + rz * rz);

      if (rCart < 1e-10) continue;

      const theta = Math.acos(rz / rCart);
      const phi = Math.atan2(ry, rx);
      
      // 委托给球谐类
      const rSH = sh.evaluate(coeffs, theta, phi);

      if (rCart >= rSH) {
        return {
          x: this.center.x + rSH * Math.sin(theta) * Math.cos(phi),
          y: this.center.y + rSH * Math.sin(theta) * Math.sin(phi),
          z: this.center.z + rSH * Math.cos(theta)
        };
      }
    }

    return null;
  }

  _buildSurfaceAdjacency(surfacePoints, spacing) {
    const maxDist = spacing * 2;

    for (let i = 0; i < surfacePoints.length; i++) {
      const p = surfacePoints[i];
      
      const distances = [];
      for (let j = 0; j < surfacePoints.length; j++) {
        if (i === j) continue;
        const other = surfacePoints[j];
        const dx = other.position.x - p.position.x;
        const dy = other.position.y - p.position.y;
        const dz = other.position.z - p.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < maxDist) {
          distances.push({ index: j, dist });
        }
      }

      distances.sort((a, b) => a.dist - b.dist);
      p.neighbors = distances.slice(0, 3).map(d => d.index);
    }
  }

  _buildSurfaceTriangulation(surfacePoints) {
    const triangles = [];
    const edges = new Set();
    const adjacency = new Map();

    for (let i = 0; i < surfacePoints.length; i++) {
      const p = surfacePoints[i];
      adjacency.set(i, p.neighbors);

      for (let j = 0; j < p.neighbors.length; j++) {
        const n1 = p.neighbors[j];
        const n2 = p.neighbors[(j + 1) % p.neighbors.length];

        if (surfacePoints[n1].neighbors.includes(n2)) {
          const tri = [i, n1, n2].sort((a, b) => a - b);
          triangles.push(tri);

          edges.add(`${tri[0]}-${tri[1]}`);
          edges.add(`${tri[1]}-${tri[2]}`);
          edges.add(`${tri[0]}-${tri[2]}`);
        }
      }
    }

    const uniqueTriangles = Array.from(
      new Set(triangles.map(t => t.join(',')))
    ).map(s => s.split(',').map(Number));

    return {
      triangles: uniqueTriangles,
      edges: Array.from(edges).map(e => e.split('-').map(Number)),
      adjacency,
      degree: Array.from(adjacency.values()).map(n => n.length)
    };
  }

  // ====================================================
  // 材料参数（不均质）
  // ====================================================

  setMaterialProperties(propertyFunc) {
    this.representation.material.uniform = false;
    this.representation.material.properties = propertyFunc;
  }

  getMaterialAt(point) {
    if (this.representation.material.uniform) {
      return {
        stiffness: 1000,
        damping: 10,
        mass: 1.0
      };
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

  // ====================================================
  // ⭐ 物理接口（PBD 标准）
  // ====================================================

  /**
   * ⭐ 获取物理视图（PBD 标准接口 + 布料增强）
   * 
   * 返回 { particles, constraints, commit }
   * - particles: 包装后的粒子数组（不直接暴露 Point）
   * - constraints: 约束数组（布料：距离 + 弯曲）
   * - commit: 回调函数，用于同步物理结果回 surfacePoints
   * 
   * @returns {Object} - { particles, constraints, commit }
   */
  getPhysicsView() {
    if (this.surfacePoints.length === 0) {
      return {
        particles: [],
        constraints: [],
        commit: () => {}
      };
    }

    // ⭐ 修正：支持不均匀质量密度
    // this.physics.mass 作为全局缩放因子
    const globalMassScale = this.physics.mass;
    const uniformMass = globalMassScale / this.surfacePoints.length;
    
    // ⭐ 创建粒子包装（零拷贝引用）
    const particles = this.surfacePoints.map((point, index) => {
      // 初始化物理属性（如果不存在）
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: point.z },
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      
      // ⭐ 同步 position 到 _physicsData（确保一致）
      point._physicsData.position.x = point.x;
      point._physicsData.position.y = point.y;
      point._physicsData.position.z = point.z;

      // ⭐ 计算粒子质量（支持不均匀密度）
      let particleMass = uniformMass;
      let invMass = particleMass > 0 ? 1 / particleMass : 0;
      
      if (!this.representation.material.uniform && 
          this.representation.material.properties) {
        // 获取该点的材料属性
        const mat = this.getMaterialAt(point);
        
        if (mat && mat.mass !== undefined) {
          // 使用材料指定的质量（相对值）
          // globalMassScale 作为缩放因子
          particleMass = mat.mass * globalMassScale / this.surfacePoints.length;
          invMass = particleMass > 0 ? 1 / particleMass : 0;
        }
      }

      // ⭐ 工程优化：返回粒子包装（零拷贝引用）
      // - position / prevPosition / velocity 直接引用 _physicsData
      // - 不创建新对象（避免 GC）
      return {
        // ✅ 直接引用（零拷贝）
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        
        // ⭐ 质量相关（支持不均匀密度）
        mass: particleMass,
        invMass: invMass,
        
        // 是否固定
        fixed: point._physicsData.fixed,
        
        // 内部索引（用于同步）
        _index: index
      };
    });

    // ⭐ 修正：使用预生成的约束（不重复构建）
    let constraints = [];
    
    if (this.representation.type === 'cloth') {
      // 布料：使用缓存的约束
      if (this.representation.physicsState?.constraints) {
        constraints = this.representation.physicsState.constraints;
      } else {
        console.warn('Cloth constraints not generated. Call generateClothPhysicsState() first.');
      }
      
      // ⭐ 修正：在这里统一解析固定点约束（从编辑态）
      if (this.representation.editState?.constraints) {
        for (const ec of this.representation.editState.constraints) {
          if (ec.type === 'fixed') {
            for (const idx of ec.particles) {
              if (idx >= 0 && idx < particles.length) {
                particles[idx].fixed = true;
                particles[idx].invMass = 0;  // 固定点质量无限大
                
                // 同步到 surfacePoint（保持一致性）
                this.surfacePoints[idx]._physicsData.fixed = true;
              }
            }
          }
        }
      }
    } else if (this.representation.type === 'line') {
      // ⭐ 新增：线形态约束
      constraints = this._buildLineConstraints();
    } else {
      // 其他类型：动态构建
      constraints = this._buildPhysicsConstraints();
    }

    // ⭐⭐⭐ 约束语义验证（开发模式）⭐⭐⭐
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
      this._validateConstraintSemantics(constraints);
    }

    // ⭐ commit 回调 - 只同步位置，不触发拓扑变化
    const commit = () => {
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        const point = this.surfacePoints[i];
        
        // ⭐ 零拷贝优化：
        // - particle.position/prevPosition/velocity 已经是 _physicsData 的引用
        // - 不需要复制，只需同步 point.x/y/z
        
        // ✅ 同步位置到 Point（用于几何计算）
        point.x = particle.position.x;
        point.y = particle.position.y;
        point.z = particle.position.z;
        
        // ✅ _physicsData 已自动更新（因为是引用）
        // - particle.position === point._physicsData.position
        // - particle.prevPosition === point._physicsData.prevPosition
        // - particle.velocity === point._physicsData.velocity
      }
      
      // ⭐ 关键修正：只标记 bounding box dirty，不清空拓扑
      this._onSurfacePositionsUpdated();
    };

    return {
      particles,
      constraints,
      commit
    };
  }

  /**
   * ⭐ 新增：物理位置更新（不影响拓扑）
   * 
   * 与 _onSurfacePointsChanged() 的区别：
   * - 只标记 bounding box dirty
   * - 不清空拓扑
   * - 不清空几何缓存
   * - 不触发重新拟合
   * 
   * @private
   */
  _onSurfacePositionsUpdated() {
    // 只标记边界盒需要更新
    this._boundingBoxDirty = true;
    
    // 更新修改时间
    this.metadata.modified = Date.now();
    
    // 注意：不增加 _surfacePointVersion
    // 注意：不清空 topology
    // 注意：不清空 geometryCache
    // 注意：不清空 _internalNodes
  }

  /**
   * ⭐⭐⭐ 约束语义验证（开发模式）⭐⭐⭐
   * 
   * 验证约束数据是否符合 PhysicsSystem 的双轨语义规范：
   * 
   * 规则 1: type === 'distance' 只允许以下字段
   * - ✅ i, j, particles, restLength, distance, compliance, edgeType
   * - ❌ stiffness, damping, k
   * 
   * 规则 2: type === 'spring' 只允许以下字段
   * - ✅ i, j, particles, restLength, stiffness, damping
   * - ❌ compliance, lambda
   * 
   * 规则 3: type === 'bending' / 'line_bending' 只允许以下字段
   * - ✅ particles, restAngle, compliance
   * - ❌ stiffness, damping
   * 
   * 规则 4: 同一粒子对 (i, j) 不能同时存在 spring 和 distance
   * 
   * @private
   * @param {Array} constraints 
   */
  _validateConstraintSemantics(constraints) {
    const errors = [];
    const warnings = [];
    const edgeMap = new Map();  // 用于检测重复边

    for (let idx = 0; idx < constraints.length; idx++) {
      const c = constraints[idx];
      
      // ⭐ 规则 1: distance 约束字段验证
      if (c.type === 'distance') {
        // 检查禁止字段
        if (c.stiffness !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'stiffness' field is not allowed. Use 'compliance' instead (compliance = 1/stiffness).`);
        }
        if (c.damping !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'damping' field is not allowed. Use global 'airDamping' instead.`);
        }
        if (c.k !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'k' field is not allowed. Use 'compliance' for XPBD.`);
        }
        
        // 检查必需字段
        if (c.restLength === undefined && c.distance === undefined) {
          errors.push(`Constraint ${idx} (distance): Missing 'restLength' or 'distance' field.`);
        }
        
        // 检查索引
        const i = c.i ?? c.particles?.[0];
        const j = c.j ?? c.particles?.[1];
        if (i === undefined || j === undefined) {
          errors.push(`Constraint ${idx} (distance): Missing particle indices (i, j or particles).`);
        } else {
          // 检测重复边
          const edgeKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, []);
          }
          edgeMap.get(edgeKey).push({ type: 'distance', index: idx });
        }
      }
      
      // ⭐ 规则 2: spring 约束字段验证
      else if (c.type === 'spring') {
        // 检查禁止字段
        if (c.compliance !== undefined) {
          errors.push(`Constraint ${idx} (spring): 'compliance' field is not allowed. Use 'stiffness' for force-based springs.`);
        }
        if (c.lambda !== undefined) {
          errors.push(`Constraint ${idx} (spring): 'lambda' field is not allowed (XPBD-only field).`);
        }
        
        // 检查必需字段
        if (c.stiffness === undefined) {
          warnings.push(`Constraint ${idx} (spring): Missing 'stiffness' field. Default stiffness will be used.`);
        }
        
        // 检查索引
        const i = c.i ?? c.particles?.[0];
        const j = c.j ?? c.particles?.[1];
        if (i === undefined || j === undefined) {
          errors.push(`Constraint ${idx} (spring): Missing particle indices (i, j or particles).`);
        } else {
          // 检测重复边
          const edgeKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, []);
          }
          edgeMap.get(edgeKey).push({ type: 'spring', index: idx });
        }
      }
      
      // ⭐ 规则 3: bending / line_bending 约束字段验证
      else if (c.type === 'bending' || c.type === 'line_bending') {
        // 检查禁止字段
        if (c.stiffness !== undefined) {
          errors.push(`Constraint ${idx} (${c.type}): 'stiffness' field is not allowed. Use 'compliance' instead.`);
        }
        if (c.damping !== undefined) {
          errors.push(`Constraint ${idx} (${c.type}): 'damping' field is not allowed. Use global 'airDamping' instead.`);
        }
        
        // 检查必需字段
        if (c.restAngle === undefined) {
          errors.push(`Constraint ${idx} (${c.type}): Missing 'restAngle' field.`);
        }
        if (!c.particles || c.particles.length < 3) {
          errors.push(`Constraint ${idx} (${c.type}): Must have at least 3 particles.`);
        }
        
        // bending 约束不检测重复边（它们涉及多个粒子）
      }
    }
    
    // ⭐ 规则 3: 检测混合约束（同一边同时有 spring 和 distance）
    for (const [edgeKey, constraints] of edgeMap.entries()) {
      if (constraints.length > 1) {
        const types = constraints.map(c => c.type);
        const hasSpring = types.includes('spring');
        const hasDistance = types.includes('distance');
        
        if (hasSpring && hasDistance) {
          errors.push(`Edge ${edgeKey}: Mixed constraint types detected! Same edge has both 'spring' and 'distance' constraints. This causes double solving and instability.`);
          
          // 列出具体约束
          const springIndices = constraints.filter(c => c.type === 'spring').map(c => c.index);
          const distanceIndices = constraints.filter(c => c.type === 'distance').map(c => c.index);
          errors.push(`  - Spring constraints: ${springIndices.join(', ')}`);
          errors.push(`  - Distance constraints: ${distanceIndices.join(', ')}`);
        }
      }
    }
    
    // ⭐ 输出验证结果
    if (errors.length > 0) {
      console.error('❌ Constraint Semantic Validation Failed:');
      errors.forEach(err => console.error(`  ${err}`));
      throw new Error(`Constraint semantic validation failed with ${errors.length} error(s). See console for details.`);
    }
    
    if (warnings.length > 0) {
      console.warn('⚠️ Constraint Semantic Validation Warnings:');
      warnings.forEach(warn => console.warn(`  ${warn}`));
    }
    
    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ Constraint semantic validation passed.');
    }
  }

  /**
   * 构建物理约束（基于拓扑）
   * 
   * ⭐ 重要：此方法依赖稳定的拓扑结构
   * - 必须在 generateDiamondNetwork() 之后调用
   * - 拓扑在物理模拟期间保持稳定
   * 
   * @private
   */
  _buildPhysicsConstraints() {
    const constraints = [];

    // ⭐ 检查拓扑是否存在且有效
    if (!this.representation.topology || 
        !this.representation.topology.edges || 
        this.representation.topology.edges.length === 0) {
      console.warn('No topology available for physics constraints. Call generateDiamondNetwork() first.');
      return constraints;
    }

    // ⭐⭐⭐ 约束生成规范声明 ⭐⭐⭐
    // 根据 physics.model 生成不同类型的约束：
    // - 'pbd': 生成 type === 'distance'（PBD/XPBD 几何约束）
    // - 'force': 生成 type === 'spring'（MSS 力学弹簧）

    const physicsModel = this.physics.model || 'pbd';

    // 基于拓扑边构建约束
    for (const [i, j] of this.representation.topology.edges) {
      if (i < this.surfacePoints.length && j < this.surfacePoints.length) {
        const p1 = this.surfacePoints[i];
        const p2 = this.surfacePoints[j];
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // ⭐ 获取材料属性（支持不均质材料）
        let avgStiffness = 1000;  // 默认刚度
        let avgDamping = 10;      // 默认阻尼
        
        if (!this.representation.material.uniform && 
            this.representation.material.properties) {
          const mat1 = this.getMaterialAt(p1);
          const mat2 = this.getMaterialAt(p2);
          avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
          avgDamping = (mat1.damping + mat2.damping) / 2;
        }
        
        // ⭐ 根据物理模式生成不同约束
        if (physicsModel === 'pbd') {
          // ✅ PBD 模式：生成 distance 约束
          const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
          
          constraints.push({
            type: 'distance',           // ⭐ PBD 几何约束
            i, j,                       // ⭐ 主索引（求解器使用）
            particles: [i, j],          // 📋 辅助字段（序列化）
            restLength,                 // ⭐ 静止长度
            distance: restLength,       // ⭐ 别名（兼容）
            compliance                  // ⭐ XPBD 柔度
            // ❌ 禁止：stiffness, damping（PBD 不使用）
          });
        } else if (physicsModel === 'force') {
          // ✅ Force 模式：生成 spring 约束
          constraints.push({
            type: 'spring',             // ⭐ MSS 力学弹簧
            i, j,                       // ⭐ 主索引（求解器使用）
            particles: [i, j],          // 📋 辅助字段（序列化）
            restLength,                 // ⭐ 静止长度
            stiffness: avgStiffness,    // ⭐ 弹簧刚度
            damping: avgDamping         // ⭐ 弹簧阻尼
            // ❌ 禁止：compliance（Force 不使用）
          });
        } else {
          console.warn(`Unknown physics model: ${physicsModel}, defaulting to 'pbd'`);
          
          // 默认 PBD
          const compliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
          constraints.push({
            type: 'distance',
            i, j,
            particles: [i, j],
            restLength,
            distance: restLength,
            compliance
          });
        }
      }
    }

    return constraints;
  }

  /**
   * 固定特定点（用于物理模拟）
   */
  fixPoint(index, fixed = true) {
    if (index >= 0 && index < this.surfacePoints.length) {
      const point = this.surfacePoints[index];
      if (!point._physicsData) {
        point._physicsData = {
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      point._physicsData.fixed = fixed;
    }
  }

  /**
   * 固定多个点
   */
  fixPoints(indices, fixed = true) {
    for (const index of indices) {
      this.fixPoint(index, fixed);
    }
  }

  /**
   * 获取物理数据（旧接口，保留兼容性）
  /**
   * 启用物理
   */
  enablePhysics(options = {}) {
    this.physics.enabled = true;
    this.physics.mass = options.mass ?? 1.0;
  }

  // ====================================================
  // 辅助工具
  // ====================================================

  _positionKey(pos) {
    const precision = 10000;
    return `${Math.round(pos.x * precision)},${Math.round(pos.y * precision)},${Math.round(pos.z * precision)}`;
  }

  _normalizeDirection(dir) {
    const [x, y, z] = dir;
    const mag = Math.sqrt(x * x + y * y + z * z);
    return mag > 1e-10 ? [x / mag, y / mag, z / mag] : [0, 0, 1];
  }

  _directionsSimilar(dir1, dir2, threshold = 0.9) {
    const dot = dir1[0] * dir2[0] + dir1[1] * dir2[1] + dir1[2] * dir2[2];
    return Math.abs(dot) > threshold;
  }

  getBoundingBox() {
    if (!this._boundingBoxDirty && this._boundingBox) {
      return this._boundingBox;
    }

    if (this.surfacePoints.length === 0) {
      return { min: { ...this.center }, max: { ...this.center } };
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

  // ====================================================
  // 调试
  // ====================================================

  debug() {
    console.log('=== Object Debug Info ===');
    console.log('Name:', this.metadata.name);
    console.log('Type:', this.representation.type);
    console.log('Control Points:', this.controlPoints.length);
    console.log('Surface Points:', this.surfacePoints.length);
    console.log('Internal Nodes:', this._internalNodes ? this._internalNodes.length : 0);
    console.log('Triangles:', this.representation.topology.triangles.length);
    console.log('Edges:', this.representation.topology.edges.length);
    if (this.representation.type === 'sphericalHarmonics') {
      console.log('Geometry Cache:', {
        volume: this.representation.geometryCache.volume,
        surfaceArea: this.representation.geometryCache.surfaceArea,
        sections: this.representation.geometryCache.sections.size
      });
    }
  }
}

export { SimpleFitCache };
