// GeometryImpl.js - 纯几何算法模块
// 职责定位: 纯几何计算，不拥有生命周期，不维护缓存，不决定状态流转
// 严格约束: 通过Object最小接口操作数据，不直接赋值Object状态

import { Point } from "./Point.js";

export class GeometryImpl {
  /**
   * GeometryImpl 构造函数
   * 
   * ⭐ 职责：纯几何算法模块
   * ⚠️ 只接收object，通过object提供的最小接口操作
   * 
   * @param {Object} object - Object实例引用
   */
  constructor(object) {
    this._object = object;
    this._verbose = object.verbose;
    
    // ⚠️ 严格约束：验证Object提供的最小接口
    this._validateObjectInterface();
  }

  /**
   * 验证Object最小接口
   * 
   * ⚠️ 确保Object提供了必需的操作接口
   * 
   * @private
   */
  _validateObjectInterface() {
    const requiredMethods = [
      'replaceSurfacePoints',
      'updateTopology',
      'evaluateSphericalHarmonics'
    ];
    
    for (const method of requiredMethods) {
      if (typeof this._object[method] !== 'function') {
        throw new Error(`[GeometryImpl] Object must provide ${method}() method`);
      }
    }
    
    // 验证必需属性
    if (!this._object.center || typeof this._object.center.x !== 'number') {
      throw new Error('[GeometryImpl] Object must provide center {x, y, z}');
    }
    
    if (!Array.isArray(this._object.surfacePoints)) {
      throw new Error('[GeometryImpl] Object must provide surfacePoints array');
    }
    
    if (!this._object.representation || !this._object.representation.topology) {
      throw new Error('[GeometryImpl] Object must provide representation.topology');
    }
  }

  /**
   * 从球谐系数更新几何（就地更新语义）
   * 
   * ⚠️ 严格约束1：使用稳定球坐标（point._spherical），不推导，不兜底
   * ⚠️ 严格约束2：就地修改Point.x/y/z，但依赖必须显式声明
   * ⚠️ 算法语义：对既有点集进行位置更新，保持拓扑连续性
   * 
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @param {number} resolution - 分辨率（保留参数，未使用）
   * @returns {void}
   */
  updateFromSpherical(coefficients, order, resolution = 32) {
    if (!coefficients || coefficients.length === 0) {
      console.error('[GeometryImpl] Invalid coefficients');
      return;
    }

    // 只读访问surfacePoints（将就地修改）
    const surfacePoints = this._object.surfacePoints;

    if (!surfacePoints || surfacePoints.length === 0) {
      console.error('[GeometryImpl] No surface points to update');
      return;
    }

    // 只读访问center
    const center = this._object.center;

    if (this._verbose) {
      console.log(`[GeometryImpl] Updating ${surfacePoints.length} points from spherical harmonics (order: ${order})`);
    }

    // ⚠️ 严格约束：使用稳定球坐标，防止方向漂移
    // 对每个surfacePoint：
    //   1. 从point._spherical获取稳定的初始方向 (theta, phi)
    //   2. 用球谐求值计算新半径 r
    //   3. 就地更新该点的x/y/z
    for (let i = 0; i < surfacePoints.length; i++) {
      const point = surfacePoints[i];

      // ⚠️ 严格约束：稳定球坐标必须存在，不推导，不兜底
      if (!point._spherical || 
          typeof point._spherical.theta !== 'number' ||
          typeof point._spherical.phi !== 'number') {
        console.error('[GeometryImpl] surfacePoints[' + i + '] missing valid _spherical {theta, phi}');
        console.error('[GeometryImpl] Cannot update from spherical harmonics - would cause direction drift');
        console.error('[GeometryImpl] Object must provide point._spherical when creating surfacePoints');
        console.error('[GeometryImpl] Use object.createSurfacePoint(point, theta, phi) or similar');
        return;
      }

      // 只读使用稳定的初始方向
      const { theta, phi } = point._spherical;

      // 使用球谐求值计算新半径
      const r = this._object.evaluateSphericalHarmonics(theta, phi, coefficients, order);

      // 就地更新point的x/y/z（允许的操作）
      point.x = center.x + r * Math.sin(theta) * Math.cos(phi);
      point.y = center.y + r * Math.sin(theta) * Math.sin(phi);
      point.z = center.z + r * Math.cos(theta);
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Updated ${surfacePoints.length} surface points in-place (topology preserved)`);
    }

    // 不返回任何值，不调用状态更新方法
    // Object负责在调用后触发状态更新
  }

  /**
   * 构建网格拓扑
   * 
   * ⚠️ 严格约束：通过object.updateTopology()接口操作，不直接赋值
   * 
   * @param {Object} options - 配置选项
   * @returns {void}
   */
  buildMeshTopology(options = {}) {
    // 只读访问surfacePoints
    const points = this._object.surfacePoints;

    if (!points || points.length < 3) {
      console.error('[GeometryImpl] Need at least 3 points for mesh');
      return;
    }

    // 简单三角化（假设点已排序）
    const triangles = [];
    const edges = [];
    const edgeSet = new Set();

    // 构建简单扇形三角化
    const center_i = 0;
    for (let i = 1; i < points.length - 1; i++) {
      triangles.push([center_i, i, i + 1]);
    }

    // 从三角形提取边
    for (const tri of triangles) {
      for (let i = 0; i < 3; i++) {
        const v1 = tri[i];
        const v2 = tri[(i + 1) % 3];
        const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;

        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push(v1 < v2 ? [v1, v2] : [v2, v1]);
        }
      }
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Built mesh topology: ${triangles.length} triangles, ${edges.length} edges`);
    }

    // ⚠️ 严格约束：通过Object最小接口更新拓扑，不直接赋值
    this._object.updateTopology({
      triangles,
      edges,
      internalEdges: [],
      adjacency: null,
      degree: null
    });
  }

  /**
   * 生成布料拓扑
   * 
   * ⚠️ 严格约束：语义统一 - 生成新几何并返回
   * ⚠️ 不直接写入Object状态，由Object决定如何使用返回值
   * 
   * @param {Object} options - 配置选项
   * @returns {Object|null} { surfacePoints, topology } 或 null
   */
  generateClothTopology(options = {}) {
    const width = options.width || 10;
    const height = options.height || 10;
    const spacing = options.spacing || 0.1;
    const offsetX = options.offsetX || 0;
    const offsetY = options.offsetY || 0;
    const offsetZ = options.offsetZ || 0;

    if (this._verbose) {
      console.log(`[GeometryImpl] Generating cloth topology (${width}x${height})`);
    }

    // 生成网格点
    const surfacePoints = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const point = new Point(
          offsetX + x * spacing,
          offsetY + y * spacing,
          offsetZ
        );

        // ⚠️ 为新生成的点添加稳定球坐标（显式声明）
        // 布料是平面网格，使用近似球坐标
        const dx = x * spacing - (width - 1) * spacing / 2;
        const dy = y * spacing - (height - 1) * spacing / 2;
        const theta = Math.PI / 2;  // 平面在z=0
        const phi = Math.atan2(dy, dx);

        point._spherical = { theta, phi };

        surfacePoints.push(point);
      }
    }

    // 生成三角形
    const triangles = [];
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const i0 = y * width + x;
        const i1 = i0 + 1;
        const i2 = i0 + width;
        const i3 = i2 + 1;

        // 两个三角形组成一个四边形
        triangles.push([i0, i1, i2]);
        triangles.push([i1, i3, i2]);
      }
    }

    // 生成边
    const edges = [];
    const edgeSet = new Set();

    for (const tri of triangles) {
      for (let i = 0; i < 3; i++) {
        const v1 = tri[i];
        const v2 = tri[(i + 1) % 3];
        const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;

        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push(v1 < v2 ? [v1, v2] : [v2, v1]);
        }
      }
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Generated cloth: ${surfacePoints.length} points, ${triangles.length} triangles, ${edges.length} edges`);
    }

    // ⚠️ 严格约束：语义统一 - 返回新几何，不直接写入Object
    return {
      surfacePoints,
      topology: {
        triangles,
        edges,
        internalEdges: [],
        adjacency: null,
        degree: null
      }
    };
  }

  /**
   * 生成线段拓扑
   * 
   * ⚠️ 严格约束：通过object.updateTopology()接口操作，不直接赋值
   * 
   * @param {boolean} isClosed - 是否闭合
   * @param {Object} options - 配置选项
   * @returns {void}
   */
  generateLineTopology(isClosed, options = {}) {
    // 只读访问surfacePoints
    const points = this._object.surfacePoints;

    if (!points || points.length < 2) {
      console.error('[GeometryImpl] Need at least 2 points for line');
      return;
    }

    const edges = [];

    // 生成顺序连接的边
    for (let i = 0; i < points.length - 1; i++) {
      edges.push([i, i + 1]);
    }

    // 如果是闭合线段，连接首尾
    if (isClosed && points.length > 2) {
      edges.push([points.length - 1, 0]);
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Generated line topology: ${edges.length} edges`);
    }

    // ⚠️ 严格约束：通过Object最小接口更新拓扑，不直接赋值
    this._object.updateTopology({
      triangles: [],
      edges,
      internalEdges: [],
      adjacency: null,
      degree: null
    });
  }

  /**
   * 生成气泡网格（体积网格）
   * 
   * ⚠️ 严格约束：语义统一 - 生成新几何并返回
   * ⚠️ 不直接写入Object状态，由Object决定如何使用返回值
   * 
   * @param {Array} coefficients - 球谐系数
   * @param {number} order - 球谐阶数
   * @param {Object} options - 配置选项
   * @returns {Object|null} { surfacePoints, internalPoints, topology } 或 null
   */
  generateBubbleMesh(coefficients, order, options = {}) {
    const resolution = options.resolution || 16;
    const internalLayers = options.internalLayers || 3;
    const shrinkFactor = options.shrinkFactor || 0.9;

    // 只读访问center
    const center = this._object.center;

    if (this._verbose) {
      console.log(`[GeometryImpl] Generating bubble mesh (resolution: ${resolution}, layers: ${internalLayers})`);
    }

    // 生成表面点
    const surfacePoints = [];
    const thetaSteps = resolution;
    const phiSteps = resolution * 2;
    const thetaStep = Math.PI / thetaSteps;
    const phiStep = (2 * Math.PI) / phiSteps;

    // 记录球坐标（用于生成内部点）
    const sphericalCoords = [];

    for (let theta_i = 0; theta_i <= thetaSteps; theta_i++) {
      for (let phi_i = 0; phi_i < phiSteps; phi_i++) {
        const theta = theta_i * thetaStep;
        const phi = phi_i * phiStep;

        // 通过Object.evaluateSphericalHarmonics访问
        const r = this._object.evaluateSphericalHarmonics(theta, phi, coefficients, order);

        const x = center.x + r * Math.sin(theta) * Math.cos(phi);
        const y = center.y + r * Math.sin(theta) * Math.sin(phi);
        const z = center.z + r * Math.cos(theta);

        const point = new Point(x, y, z);

        // ⚠️ 为新生成的点添加稳定球坐标（显式声明）
        point._spherical = { theta, phi };

        surfacePoints.push(point);
        sphericalCoords.push({ theta, phi, r });
      }
    }

    // 生成内部点（同心层）
    const internalPoints = [];
    for (let layer = 1; layer <= internalLayers; layer++) {
      const layerShrink = Math.pow(shrinkFactor, layer);

      for (let i = 0; i < sphericalCoords.length; i++) {
        const { theta, phi, r } = sphericalCoords[i];
        const r_internal = r * layerShrink;

        const x = center.x + r_internal * Math.sin(theta) * Math.cos(phi);
        const y = center.y + r_internal * Math.sin(theta) * Math.sin(phi);
        const z = center.z + r_internal * Math.cos(theta);

        internalPoints.push(new Point(x, y, z));
      }
    }

    // 生成表面拓扑
    const triangles = [];
    const edges = [];
    const edgeSet = new Set();

    const pointsPerRow = phiSteps;

    for (let theta_i = 0; theta_i < thetaSteps; theta_i++) {
      for (let phi_i = 0; phi_i < phiSteps; phi_i++) {
        const i00 = theta_i * pointsPerRow + phi_i;
        const i01 = theta_i * pointsPerRow + ((phi_i + 1) % phiSteps);
        const i10 = (theta_i + 1) * pointsPerRow + phi_i;
        const i11 = (theta_i + 1) * pointsPerRow + ((phi_i + 1) % phiSteps);

        // 两个三角形
        triangles.push([i00, i01, i10]);
        triangles.push([i01, i11, i10]);

        // 提取边
        const triEdges = [
          [i00, i01], [i01, i10], [i10, i00],
          [i01, i11], [i11, i10]
        ];

        for (const [v1, v2] of triEdges) {
          const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push(v1 < v2 ? [v1, v2] : [v2, v1]);
          }
        }
      }
    }

    // 生成内部边（连接表面到内部层）
    const internalEdges = [];
    const surfaceCount = surfacePoints.length;

    // 径向连接（表面 → 第一层）
    for (let i = 0; i < surfacePoints.length; i++) {
      internalEdges.push([i, surfaceCount + i]);
    }

    // 层间连接
    for (let layer = 0; layer < internalLayers - 1; layer++) {
      const layerStart = surfaceCount + layer * surfacePoints.length;
      const nextLayerStart = surfaceCount + (layer + 1) * surfacePoints.length;

      for (let i = 0; i < surfacePoints.length; i++) {
        internalEdges.push([layerStart + i, nextLayerStart + i]);
      }
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Generated bubble mesh:`);
      console.log(`  - Surface points: ${surfacePoints.length}`);
      console.log(`  - Internal points: ${internalPoints.length}`);
      console.log(`  - Triangles: ${triangles.length}`);
      console.log(`  - Edges: ${edges.length}`);
      console.log(`  - Internal edges: ${internalEdges.length}`);
    }

    // ⚠️ 严格约束：语义统一 - 返回新几何，不直接写入Object
    return {
      surfacePoints,
      internalPoints,
      topology: {
        triangles,
        edges,
        internalEdges,
        adjacency: null,
        degree: null
      }
    };
  }

  /**
   * 生成Delaunay 3D四面体网格
   * 
   * ⚠️ 严格约束：语义统一 - 生成新几何并返回
   * ⚠️ stub实现：添加明确警告
   * 
   * @param {Object} options - 配置选项
   * @returns {Object|null} { tetrahedra, topology } 或 null
   */
  generateDelaunay3D(options = {}) {
    // 明确警告这是stub实现
    console.warn('[GeometryImpl] generateDelaunay3D is a stub implementation');
    console.warn('[GeometryImpl] For production use, integrate a real Delaunay 3D library');

    // 如果要求精确实现，直接拒绝
    if (options.requireExact === true) {
      console.error('[GeometryImpl] generateDelaunay3D: requireExact=true but only stub available');
      return null;
    }

    // 只读访问surfacePoints
    const points = this._object.surfacePoints;

    if (!points || points.length < 4) {
      console.error('[GeometryImpl] Need at least 4 points for Delaunay 3D');
      return null;
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Generating Delaunay 3D (stub) for ${points.length} points`);
    }

    // ⚠️ 简化实现：这里应该调用真正的Delaunay 3D算法
    // 当前只是示例结构
    const tetrahedra = [];
    
    // 示例：生成简单的四面体
    if (points.length >= 4) {
      // 第一个四面体
      tetrahedra.push([0, 1, 2, 3]);
      
      // 可以继续添加更多四面体...
    }

    // 从四面体提取表面三角形
    const surfaceTriangles = [];
    const triangleCount = new Map();

    for (const tet of tetrahedra) {
      // 四面体的4个面
      const faces = [
        [tet[0], tet[1], tet[2]],
        [tet[0], tet[1], tet[3]],
        [tet[0], tet[2], tet[3]],
        [tet[1], tet[2], tet[3]]
      ];

      for (const face of faces) {
        const sorted = [...face].sort((a, b) => a - b);
        const key = sorted.join(',');
        triangleCount.set(key, (triangleCount.get(key) || 0) + 1);
      }
    }

    // 只保留出现一次的面（表面）
    for (const [key, count] of triangleCount) {
      if (count === 1) {
        const indices = key.split(',').map(Number);
        surfaceTriangles.push(indices);
      }
    }

    // 从三角形提取边
    const surfaceEdges = [];
    const edgeSet = new Set();

    for (const tri of surfaceTriangles) {
      for (let i = 0; i < 3; i++) {
        const v1 = tri[i];
        const v2 = tri[(i + 1) % 3];
        const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;

        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          surfaceEdges.push(v1 < v2 ? [v1, v2] : [v2, v1]);
        }
      }
    }

    if (this._verbose) {
      console.log(`[GeometryImpl] Generated Delaunay 3D (stub):`);
      console.log(`  - Tetrahedra: ${tetrahedra.length}`);
      console.log(`  - Surface triangles: ${surfaceTriangles.length}`);
      console.log(`  - Surface edges: ${surfaceEdges.length}`);
    }

    // ⚠️ 严格约束：语义统一 - 返回新几何，不直接写入Object
    return {
      tetrahedra: tetrahedra,
      topology: {
        triangles: surfaceTriangles,
        edges: surfaceEdges,
        internalEdges: [],
        adjacency: null,
        degree: null
      }
    };
  }

  /**
   * 计算体积（基于四面体分解）
   * 
   * ⚠️ 纯函数，参数传入
   * 
   * @param {Array<Point>} points - 表面点集
   * @param {Object} topology - 拓扑结构
   * @param {Object} center - 几何中心 {x, y, z}
   * @returns {number} 体积
   */
  computeVolume(points, topology, center) {
    if (!points || !topology || !topology.triangles || topology.triangles.length === 0) {
      console.error('[GeometryImpl] Invalid parameters for volume computation');
      return 0;
    }

    if (!center || typeof center.x !== 'number') {
      console.error('[GeometryImpl] Invalid center parameter');
      return 0;
    }

    let volume = 0;

    // 使用散度定理：将每个三角形与中心构成四面体
    for (const tri of topology.triangles) {
      const p0 = points[tri[0]];
      const p1 = points[tri[1]];
      const p2 = points[tri[2]];

      // 四面体体积 = |det(p0-center, p1-center, p2-center)| / 6
      const v0 = { x: p0.x - center.x, y: p0.y - center.y, z: p0.z - center.z };
      const v1 = { x: p1.x - center.x, y: p1.y - center.y, z: p1.z - center.z };
      const v2 = { x: p2.x - center.x, y: p2.y - center.y, z: p2.z - center.z };

      const det = v0.x * (v1.y * v2.z - v1.z * v2.y) -
                  v0.y * (v1.x * v2.z - v1.z * v2.x) +
                  v0.z * (v1.x * v2.y - v1.y * v2.x);

      volume += det / 6;
    }

    return Math.abs(volume);
  }

  /**
   * 计算表面积
   * 
   * ⚠️ 纯函数，参数传入
   * 
   * @param {Array<Point>} points - 表面点集
   * @param {Object} topology - 拓扑结构
   * @returns {number} 表面积
   */
  computeSurfaceArea(points, topology) {
    if (!points || !topology || !topology.triangles || topology.triangles.length === 0) {
      console.error('[GeometryImpl] Invalid parameters for surface area computation');
      return 0;
    }

    let area = 0;

    for (const tri of topology.triangles) {
      const p0 = points[tri[0]];
      const p1 = points[tri[1]];
      const p2 = points[tri[2]];

      // 三角形面积 = |cross(p1-p0, p2-p0)| / 2
      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z };

      const cross = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
      };

      const magnitude = Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z);
      area += magnitude / 2;
    }

    return area;
  }
}
