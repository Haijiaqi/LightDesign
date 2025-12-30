// Object.js - 3D几何对象
// 职责：几何状态管理、生命周期控制、协调各Impl模块

import { GeometryImpl } from "./GeometryImpl.js";
import { SphericalImpl } from "./SphericalImpl.js";
import { Point } from "./Point.js";

export class Object {
  /**
   * 构造函数
   * 
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    // ========== 核心状态 ==========
    
    // 几何中心
    this.center = options.center || { x: 0, y: 0, z: 0 };
    
    // 表面点集（所有点必须携带_spherical）
    this.surfacePoints = [];
    
    // 内部点集（用于体积网格）
    this.internalPoints = [];
    
    // 控制点集
    this.controlPoints = [];
    
    // 几何表示类型和拓扑
    this.representation = {
      type: options.representationType || 'mesh', // 'mesh', 'cloth', 'line', 'bubble'
      isClosed: options.isClosed !== false,
      topology: {
        triangles: [],
        edges: [],
        internalEdges: [],
        adjacency: null,
        degree: null
      }
    };
    
    // ========== 元数据 ==========
    
    this.metadata = {
      created: Date.now(),
      modified: Date.now(),
      version: 1
    };
    
    // ========== 配置选项 ==========
    
    this.verbose = options.verbose || false;
    this.id = options.id || this._generateId();
    
    // ========== Impl模块初始化 ==========
    
    // 球谐实现（负责球谐拟合和求值）
    this._sphericalImpl = new SphericalImpl(this);
    
    // 几何实现（负责纯几何计算）
    this.geometry = new GeometryImpl(this);
    
    if (this.verbose) {
      console.log(`[Object] Created object ${this.id}`);
    }
  }

  // ========== GeometryImpl最小接口 ==========

  /**
   * 最小接口1：替换表面点集
   * 
   * ⚠️ GeometryImpl通过此接口替换surfacePoints
   * ⚠️ 自动触发状态更新
   * 
   * @param {Array<Point>} points - 新的表面点集
   */
  replaceSurfacePoints(points) {
    if (!Array.isArray(points)) {
      throw new Error('[Object] replaceSurfacePoints: points must be an array');
    }
    
    // 验证所有点都携带_spherical（可选，但推荐）
    if (this.verbose) {
      const missingSpherical = points.filter(p => !p._spherical).length;
      if (missingSpherical > 0) {
        console.warn(`[Object] ${missingSpherical} points missing _spherical coordinates`);
      }
    }
    
    this.surfacePoints = points;
    
    // 触发状态更新
    this._onSurfacePointsChanged();
  }

  /**
   * 最小接口2：更新拓扑结构
   * 
   * ⚠️ GeometryImpl通过此接口更新topology
   * ⚠️ 自动触发状态更新
   * 
   * @param {Object} topology - 拓扑结构
   */
  updateTopology(topology) {
    if (!topology || typeof topology !== 'object') {
      throw new Error('[Object] updateTopology: topology must be an object');
    }
    
    // 更新拓扑字段（只更新提供的字段）
    if (topology.triangles !== undefined) {
      this.representation.topology.triangles = topology.triangles;
    }
    if (topology.edges !== undefined) {
      this.representation.topology.edges = topology.edges;
    }
    if (topology.internalEdges !== undefined) {
      this.representation.topology.internalEdges = topology.internalEdges;
    }
    if (topology.adjacency !== undefined) {
      this.representation.topology.adjacency = topology.adjacency;
    }
    if (topology.degree !== undefined) {
      this.representation.topology.degree = topology.degree;
    }
    
    // 触发状态更新
    this._onTopologyChanged();
  }

  /**
   * 最小接口3：球谐求值
   * 
   * ⚠️ GeometryImpl通过此接口访问球谐求值
   * ⚠️ 委托给SphericalImpl实现
   * 
   * @param {number} theta - 极角
   * @param {number} phi - 方位角
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @returns {number} 半径
   */
  evaluateSphericalHarmonics(theta, phi, coefficients, order) {
    return this._sphericalImpl.evaluate(theta, phi, coefficients, order);
  }

  // ========== 辅助方法：创建带稳定球坐标的点 ==========

  /**
   * 创建单个带稳定球坐标的表面点
   * 
   * ⚠️ 确保所有surfacePoints都携带_spherical
   * 
   * @param {number} x - x坐标
   * @param {number} y - y坐标
   * @param {number} z - z坐标
   * @param {number} theta - 极角
   * @param {number} phi - 方位角
   * @returns {Point} 创建的点
   */
  createSurfacePoint(x, y, z, theta, phi) {
    const point = new Point(x, y, z);
    point._spherical = { theta, phi };
    this.surfacePoints.push(point);
    return point;
  }

  /**
   * 批量创建带稳定球坐标的表面点
   * 
   * @param {Array} pointsData - 点数据数组 [{x, y, z, theta, phi}, ...]
   */
  createSurfacePoints(pointsData) {
    if (!Array.isArray(pointsData)) {
      throw new Error('[Object] createSurfacePoints: pointsData must be an array');
    }
    
    const points = [];
    for (const data of pointsData) {
      const point = new Point(data.x, data.y, data.z);
      point._spherical = { theta: data.theta, phi: data.phi };
      points.push(point);
    }
    
    this.surfacePoints = points;
    this._onSurfacePointsChanged();
  }

  /**
   * 从球坐标创建表面点
   * 
   * @param {number} theta - 极角
   * @param {number} phi - 方位角
   * @param {number} r - 半径
   * @returns {Point} 创建的点
   */
  createSurfacePointFromSpherical(theta, phi, r) {
    const x = this.center.x + r * Math.sin(theta) * Math.cos(phi);
    const y = this.center.y + r * Math.sin(theta) * Math.sin(phi);
    const z = this.center.z + r * Math.cos(theta);
    
    const point = new Point(x, y, z);
    point._spherical = { theta, phi };
    this.surfacePoints.push(point);
    
    return point;
  }

  // ========== 球坐标投影（辅助方法）==========

  /**
   * 将笛卡尔坐标投影到球坐标
   * 
   * ⚠️ 注意：这是辅助方法，不应在updateFromSpherical中使用
   * ⚠️ 主要用于初始化时计算_spherical
   * 
   * @param {Point|Object} point - 点对象 {x, y, z}
   * @returns {Object} 球坐标 {theta, phi, r}
   */
  projectToSpherical(point) {
    const dx = point.x - this.center.x;
    const dy = point.y - this.center.y;
    const dz = point.z - this.center.z;
    
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const theta = Math.acos(dz / (r + 1e-10)); // 避免除零
    const phi = Math.atan2(dy, dx);
    
    return { theta, phi, r };
  }

  // ========== 状态更新回调 ==========

  /**
   * 表面点集变化回调
   * 
   * @private
   */
  _onSurfacePointsChanged() {
    // 更新元数据
    this.metadata.modified = Date.now();
    this.metadata.version++;
    
    // 清除派生数据缓存（如果有）
    this._boundingBoxDirty = true;
    this._volumeDirty = true;
    this._surfaceAreaDirty = true;
    
    if (this.verbose) {
      console.log(`[Object] Surface points changed: ${this.surfacePoints.length} points`);
    }
  }

  /**
   * 拓扑结构变化回调
   * 
   * @private
   */
  _onTopologyChanged() {
    // 更新元数据
    this.metadata.modified = Date.now();
    this.metadata.version++;
    
    // 清除拓扑相关的派生数据
    this._adjacencyDirty = true;
    this._degreeDirty = true;
    
    if (this.verbose) {
      console.log(`[Object] Topology changed: ${this.representation.topology.triangles.length} triangles, ${this.representation.topology.edges.length} edges`);
    }
  }

  // ========== 高层几何操作 ==========

  /**
   * 从球谐系数更新几何
   * 
   * ⚠️ 使用GeometryImpl.updateFromSpherical就地修改surfacePoints
   * 
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  updateFromSphericalHarmonics(coefficients, order, options = {}) {
    if (!coefficients || coefficients.length === 0) {
      console.error('[Object] Invalid coefficients');
      return false;
    }
    
    if (this.surfacePoints.length === 0) {
      console.error('[Object] No surface points to update');
      return false;
    }
    
    const resolution = options.resolution || 32;
    
    // GeometryImpl会就地修改surfacePoints[i].x/y/z
    this.geometry.updateFromSpherical(coefficients, order, resolution);
    
    // Object负责触发状态更新
    this._onSurfacePointsChanged();
    
    return true;
  }

  /**
   * 从控制点拟合球谐系数并更新几何
   * 
   * @param {Object} options - 配置选项
   * @returns {Object|null} 拟合结果 {coefficients, order, error}
   */
  updateControlPoint(options = {}) {
    if (this.controlPoints.length === 0) {
      console.error('[Object] No control points');
      return null;
    }
    
    // 使用SphericalImpl拟合
    const fitResult = this._sphericalImpl.fit(this.controlPoints, options);
    
    if (!fitResult) {
      console.error('[Object] Spherical harmonics fitting failed');
      return null;
    }
    
    if (this.verbose) {
      console.log(`[Object] Fitted spherical harmonics (order: ${fitResult.order}, error: ${fitResult.error})`);
    }
    
    // 使用拟合结果更新几何
    this.updateFromSphericalHarmonics(fitResult.coefficients, fitResult.order, options);
    
    return fitResult;
  }

  /**
   * 设置表示类型为网格
   * 
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  setRepresentation_Mesh(options = {}) {
    this.representation.type = 'mesh';
    this.representation.isClosed = options.isClosed !== false;
    
    if (this.surfacePoints.length === 0) {
      console.error('[Object] No surface points for mesh');
      return false;
    }
    
    // GeometryImpl会通过updateTopology()接口更新拓扑
    this.geometry.buildMeshTopology(options);
    
    return true;
  }

  /**
   * 设置表示类型为布料
   * 
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  setRepresentation_Cloth(options = {}) {
    this.representation.type = 'cloth';
    this.representation.isClosed = false;
    
    // GeometryImpl返回新几何，Object负责接管生命周期
    const clothResult = this.geometry.generateClothTopology(options);
    
    if (!clothResult) {
      console.error('[Object] Failed to generate cloth topology');
      return false;
    }
    
    // Object通过最小接口更新状态
    this.replaceSurfacePoints(clothResult.surfacePoints);
    this.updateTopology(clothResult.topology);
    
    return true;
  }

  /**
   * 设置表示类型为线段
   * 
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  setRepresentation_Line(options = {}) {
    this.representation.type = 'line';
    this.representation.isClosed = options.isClosed !== false;
    
    if (this.surfacePoints.length < 2) {
      console.error('[Object] Need at least 2 points for line');
      return false;
    }
    
    // GeometryImpl会通过updateTopology()接口更新拓扑
    this.geometry.generateLineTopology(this.representation.isClosed, options);
    
    return true;
  }

  /**
   * 生成体积网格（气泡网格）
   * 
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  generateVolumetricMesh(coefficients, order, options = {}) {
    if (!coefficients || coefficients.length === 0) {
      console.error('[Object] Invalid coefficients');
      return false;
    }
    
    this.representation.type = 'bubble';
    this.representation.isClosed = true;
    
    // GeometryImpl返回新几何，Object负责接管生命周期
    const bubbleResult = this.geometry.generateBubbleMesh(coefficients, order, options);
    
    if (!bubbleResult) {
      console.error('[Object] Failed to generate bubble mesh');
      return false;
    }
    
    // Object通过最小接口更新状态
    this.replaceSurfacePoints(bubbleResult.surfacePoints);
    this.updateTopology(bubbleResult.topology);
    
    // 处理内部点
    if (bubbleResult.internalPoints) {
      this.internalPoints = bubbleResult.internalPoints;
    }
    
    return true;
  }

  /**
   * 从球谐系数初始化几何
   * 
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @param {Object} options - 配置选项
   * @returns {boolean} 是否成功
   */
  initializeFromSphericalHarmonics(coefficients, order, options = {}) {
    const resolution = options.resolution || 32;
    const thetaSteps = resolution;
    const phiSteps = resolution * 2;
    
    // 生成规则采样的表面点（带稳定球坐标）
    this.surfacePoints = [];
    
    const thetaStep = Math.PI / thetaSteps;
    const phiStep = (2 * Math.PI) / phiSteps;
    
    for (let theta_i = 0; theta_i <= thetaSteps; theta_i++) {
      for (let phi_i = 0; phi_i < phiSteps; phi_i++) {
        const theta = theta_i * thetaStep;
        const phi = phi_i * phiStep;
        
        // 球谐求值
        const r = this.evaluateSphericalHarmonics(theta, phi, coefficients, order);
        
        // 创建点（带稳定球坐标）
        this.createSurfacePointFromSpherical(theta, phi, r);
      }
    }
    
    this._onSurfacePointsChanged();
    
    // 根据表示类型构建拓扑
    if (this.representation.type === 'mesh' || this.representation.type === 'bubble') {
      this.setRepresentation_Mesh(options);
    }
    
    if (this.verbose) {
      console.log(`[Object] Initialized from spherical harmonics: ${this.surfacePoints.length} points`);
    }
    
    return true;
  }

  // ========== 几何查询 ==========

  /**
   * 计算体积
   * 
   * @returns {number} 体积
   */
  computeVolume() {
    if (this.surfacePoints.length === 0 || this.representation.topology.triangles.length === 0) {
      return 0;
    }
    
    return this.geometry.computeVolume(
      this.surfacePoints,
      this.representation.topology,
      this.center
    );
  }

  /**
   * 计算表面积
   * 
   * @returns {number} 表面积
   */
  computeSurfaceArea() {
    if (this.surfacePoints.length === 0 || this.representation.topology.triangles.length === 0) {
      return 0;
    }
    
    return this.geometry.computeSurfaceArea(
      this.surfacePoints,
      this.representation.topology
    );
  }

  /**
   * 获取边界框
   * 
   * @returns {Object} 边界框 {min: {x, y, z}, max: {x, y, z}}
   */
  getBoundingBox() {
    if (this.surfacePoints.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      };
    }
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const point of this.surfacePoints) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.z < minZ) minZ = point.z;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
      if (point.z > maxZ) maxZ = point.z;
    }
    
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  // ========== 控制点管理 ==========

  /**
   * 添加控制点
   * 
   * @param {Point|Object} point - 控制点 {x, y, z}
   */
  addControlPoint(point) {
    if (!point || typeof point.x !== 'number') {
      throw new Error('[Object] Invalid control point');
    }
    
    // 如果点没有_spherical，自动计算
    if (!point._spherical) {
      const spherical = this.projectToSpherical(point);
      point._spherical = { theta: spherical.theta, phi: spherical.phi };
    }
    
    this.controlPoints.push(point);
    
    if (this.verbose) {
      console.log(`[Object] Added control point: (${point.x}, ${point.y}, ${point.z})`);
    }
  }

  /**
   * 清除所有控制点
   */
  clearControlPoints() {
    this.controlPoints = [];
    
    if (this.verbose) {
      console.log('[Object] Cleared all control points');
    }
  }

  // ========== 辅助方法 ==========

  /**
   * 生成唯一ID
   * 
   * @private
   * @returns {string} 唯一ID
   */
  _generateId() {
    return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 序列化为JSON
   * 
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      center: this.center,
      surfacePoints: this.surfacePoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        _spherical: p._spherical
      })),
      controlPoints: this.controlPoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        _spherical: p._spherical
      })),
      representation: this.representation,
      metadata: this.metadata
    };
  }

  /**
   * 从JSON恢复
   * 
   * @param {Object} json - JSON对象
   * @returns {Object} Object实例
   */
  static fromJSON(json) {
    const obj = new Object({
      id: json.id,
      center: json.center,
      representationType: json.representation?.type,
      isClosed: json.representation?.isClosed,
      verbose: false
    });
    
    // 恢复表面点（带_spherical）
    if (json.surfacePoints) {
      obj.createSurfacePoints(json.surfacePoints);
    }
    
    // 恢复控制点
    if (json.controlPoints) {
      for (const cp of json.controlPoints) {
        obj.addControlPoint(cp);
      }
    }
    
    // 恢复拓扑
    if (json.representation?.topology) {
      obj.updateTopology(json.representation.topology);
    }
    
    // 恢复元数据
    if (json.metadata) {
      obj.metadata = json.metadata;
    }
    
    return obj;
  }
}