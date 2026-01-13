/**
 * GeometryImpl.js - 几何计算实现层
 * 
 * ============================================================================
 * 版本: v4.0 (生产版)
 * 日期: 2026-01-03
 * ============================================================================
 * 
 * 职责：
 * - 气泡填充算法（generateBubblePacking）
 * - 表面拓扑构建（buildSurfaceTopology）
 * - 内部拓扑构建（buildInternalTopology）
 * - 皮骨拓扑构建（buildSkinBoneTopology）
 * - 包围盒计算（computeBoundingBox）
 * - 中心点计算（computeCenter）
 * 
 * 无外部依赖
 * ============================================================================
 */

export class GeometryImpl {

  // ==========================================================================
  // 常量定义
  // ==========================================================================

  static EPSILON = 1e-10;
  static KNN_3D = 10;
  static KNN_2D = 6;
  static KNN_INTERNAL = 8;

  // 默认建构点间距
  static DEFAULT_SPACING_VOLUMETRIC = 0.02;  // 球谐体默认间距 2cm
  static DEFAULT_SPACING_CLOTH = 0.015;      // 布料默认间距 1.5cm

  // ==========================================================================
  // 边键工具（统一格式）
  // ==========================================================================

  /**
   * 生成规范化的边键（统一使用逗号分隔）
   */
  static makeEdgeKey(i, j) {
    return i < j ? `${i},${j}` : `${j},${i}`;
  }

  /**
   * 解析边键为索引数组
   */
  static parseEdgeKey(key) {
    const parts = key.split(',');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }

  // ==========================================================================
  // 气泡填充
  // ==========================================================================

  // 表面层阈值（与 ParametricImpl.SURFACE_THRESHOLD 保持一致）
  static SURFACE_THRESHOLD = 0.92;

  static generateBubblePacking(
    targetCount, spacing, iterations, surfaceRatio,
    minX, maxX, minY, maxY, minZ, maxZ,
    boundaryCallback, is2D, verbose
  ) {
    const boxSizeX = maxX - minX;
    const boxSizeY = maxY - minY;
    const boxSizeZ = is2D ? 0 : (maxZ - minZ);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = is2D ? 0 : (minZ + maxZ) / 2;

    // 步骤 1: 撒点（不过滤）
    const points = [];
    for (let i = 0; i < targetCount; i++) {
      points.push({
        position: {
          x: centerX + (Math.random() - 0.5) * boxSizeX,
          y: centerY + (Math.random() - 0.5) * boxSizeY,
          z: is2D ? 0 : centerZ + (Math.random() - 0.5) * boxSizeZ
        },
        isSurface: false
      });
    }

    // 步骤 2: 迭代松弛
    for (let iter = 0; iter < iterations; iter++) {
      // 2a. 点间斥力
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
        if (!is2D) pi.z += fz * damping;
      }

      // 2b. 边界约束
      for (const point of points) {
        const pos = point.position;
        const result = boundaryCallback(pos.x, pos.y, pos.z);

        if (!result.isInside) {
          pos.x = result.projectedPoint.x;
          pos.y = result.projectedPoint.y;
          pos.z = is2D ? 0 : result.projectedPoint.z;
          point.isSurface = true;
        } else if (result.distanceRatio > GeometryImpl.SURFACE_THRESHOLD) {
          const attractionStrength = (result.distanceRatio - GeometryImpl.SURFACE_THRESHOLD) / (1 - GeometryImpl.SURFACE_THRESHOLD);
          const proj = result.projectedPoint;
          pos.x = pos.x * (1 - attractionStrength) + proj.x * attractionStrength;
          pos.y = pos.y * (1 - attractionStrength) + proj.y * attractionStrength;
          if (!is2D) {
            pos.z = pos.z * (1 - attractionStrength) + proj.z * attractionStrength;
          }
          if (attractionStrength > 0.5) {
            point.isSurface = true;
          }
        }

        if (is2D) pos.z = 0;
      }
    }

    // 步骤 3: 分类
    let surfacePoints = points.filter(p => p.isSurface);
    let internalPoints = points.filter(p => !p.isSurface);

    // 步骤 4: 补充表面点
    const targetSurfaceCount = Math.floor(targetCount * surfaceRatio);
    if (surfacePoints.length < targetSurfaceCount && internalPoints.length > 0) {
      const deficit = targetSurfaceCount - surfacePoints.length;

      internalPoints.sort((a, b) => {
        const resultA = boundaryCallback(a.position.x, a.position.y, a.position.z);
        const resultB = boundaryCallback(b.position.x, b.position.y, b.position.z);
        return resultB.distanceRatio - resultA.distanceRatio;
      });

      for (let i = 0; i < Math.min(deficit, internalPoints.length); i++) {
        internalPoints[i].isSurface = true;
        surfacePoints.push(internalPoints[i]);
      }

      internalPoints = internalPoints.filter(p => !p.isSurface);
    }

    if (verbose) {
      console.log(`[GeometryImpl] Bubble packing: ${surfacePoints.length} surface, ${internalPoints.length} internal`);
    }

    return {
      surfacePoints: surfacePoints.map(p => p.position),
      internalPoints: internalPoints.map(p => p.position)
    };
  }

  // ==========================================================================
  // 表面拓扑构建
  // ==========================================================================

  static buildSurfaceTopology(surfacePoints, knn, centerX, centerY, centerZ, occlusionCallback, verbose) {
    const triangles = [];
    const triangleSet = new Set();
    const edgeSet = new Set();
    const adjacency = new Map();

    for (let i = 0; i < surfacePoints.length; i++) {
      adjacency.set(i, []);
    }

    for (let i = 0; i < surfacePoints.length; i++) {
      const pi = surfacePoints[i];

      // K近邻搜索
      const neighbors = [];
      for (let j = 0; j < surfacePoints.length; j++) {
        if (i === j) continue;
        const pj = surfacePoints[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        neighbors.push({ index: j, dist });
      }
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNeighbors = neighbors.slice(0, Math.min(knn, neighbors.length));

      // 尝试组成三角形
      for (let a = 0; a < kNeighbors.length; a++) {
        for (let b = a + 1; b < kNeighbors.length; b++) {
          const j = kNeighbors[a].index;
          const k = kNeighbors[b].index;
          const tri = [i, j, k];

          if (!GeometryImpl._isTriangleOutwardFacing(tri, surfacePoints, centerX, centerY, centerZ)) {
            continue;
          }

          if (occlusionCallback) {
            const pj = surfacePoints[j];
            const pk = surfacePoints[k];
            const cx = (pi.x + pj.x + pk.x) / 3;
            const cy = (pi.y + pj.y + pk.y) / 3;
            const cz = (pi.z + pj.z + pk.z) / 3;
            if (occlusionCallback(cx, cy, cz)) {
              continue;
            }
          }

          // 去重
          const sorted = [i, j, k].sort((x, y) => x - y);
          const triKey = `${sorted[0]},${sorted[1]},${sorted[2]}`;
          if (triangleSet.has(triKey)) continue;

          triangleSet.add(triKey);
          triangles.push(tri);

          // 添加边（使用统一格式）
          GeometryImpl._addEdge(edgeSet, adjacency, i, j);
          GeometryImpl._addEdge(edgeSet, adjacency, j, k);
          GeometryImpl._addEdge(edgeSet, adjacency, i, k);
        }
      }
    }

    // 转换边为数组格式
    const edges = Array.from(edgeSet).map(key => GeometryImpl.parseEdgeKey(key));

    // 构建 edgeToTriangles 映射
    const edgeToTriangles = new Map();
    for (const key of edgeSet) {
      edgeToTriangles.set(key, [-1, -1]);
    }

    for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
      const [a, b, c] = triangles[triIndex];
      const keys = [
        GeometryImpl.makeEdgeKey(a, b),
        GeometryImpl.makeEdgeKey(b, c),
        GeometryImpl.makeEdgeKey(a, c)
      ];

      for (const key of keys) {
        const pair = edgeToTriangles.get(key);
        if (pair) {
          if (pair[0] === -1) pair[0] = triIndex;
          else if (pair[1] === -1) pair[1] = triIndex;
        }
      }
    }

    if (verbose) {
      console.log(`[GeometryImpl] Surface topology: ${triangles.length} triangles, ${edges.length} edges`);
    }

    return {
      triangles,
      edges,
      adjacency,
      edgeToTriangles
    };
  }

  static _isTriangleOutwardFacing(tri, surfacePoints, centerX, centerY, centerZ) {
    const [i, j, k] = tri;
    const pi = surfacePoints[i];
    const pj = surfacePoints[j];
    const pk = surfacePoints[k];

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
      x: cx - centerX,
      y: cy - centerY,
      z: cz - centerZ
    };

    const dot = normal.x * toCenter.x + normal.y * toCenter.y + normal.z * toCenter.z;
    return dot > 0;
  }

  static _addEdge(edgeSet, adjacency, i, j) {
    const key = GeometryImpl.makeEdgeKey(i, j);
    edgeSet.add(key);

    if (!adjacency.get(i).includes(j)) {
      adjacency.get(i).push(j);
    }
    if (!adjacency.get(j).includes(i)) {
      adjacency.get(j).push(i);
    }
  }

  // ==========================================================================
  // 内部拓扑构建
  // ==========================================================================

  static buildInternalTopology(internalPositions, surfaceCount, maxDistance, knn) {
    const edges = [];
    const edgeSet = new Set();
    const adjacency = new Map();

    for (let i = 0; i < internalPositions.length; i++) {
      adjacency.set(surfaceCount + i, []);
    }

    for (let i = 0; i < internalPositions.length; i++) {
      const pi = internalPositions[i];
      const neighbors = [];

      for (let j = 0; j < internalPositions.length; j++) {
        if (i === j) continue;
        const pj = internalPositions[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < maxDistance) {
          neighbors.push({ index: j, dist });
        }
      }

      neighbors.sort((a, b) => a.dist - b.dist);
      const kNeighbors = neighbors.slice(0, Math.min(knn, neighbors.length));

      for (const neighbor of kNeighbors) {
        if (i >= neighbor.index) continue;

        const iGlobal = surfaceCount + i;
        const jGlobal = surfaceCount + neighbor.index;
        const edgeKey = GeometryImpl.makeEdgeKey(iGlobal, jGlobal);

        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push([iGlobal, jGlobal]);
          adjacency.get(iGlobal).push(jGlobal);
          adjacency.get(jGlobal).push(iGlobal);
        }
      }
    }

    return { edges, adjacency };
  }

  // ==========================================================================
  // 皮骨拓扑构建（只用距离阈值，不用K近邻）
  // ==========================================================================

  static buildSkinBoneTopology(surfacePositions, internalPositions, surfaceCount, maxDistance) {
    const edges = [];
    const edgeSet = new Set();

    for (let si = 0; si < surfacePositions.length; si++) {
      const sp = surfacePositions[si];

      for (let ii = 0; ii < internalPositions.length; ii++) {
        const ip = internalPositions[ii];
        const dx = ip.x - sp.x;
        const dy = ip.y - sp.y;
        const dz = ip.z - sp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < maxDistance) {
          const surfaceIndex = si;
          const internalIndex = surfaceCount + ii;
          const edgeKey = GeometryImpl.makeEdgeKey(surfaceIndex, internalIndex);

          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push([surfaceIndex, internalIndex]);
          }
        }
      }
    }

    return { edges };
  }

  // ==========================================================================
  // 布料网格
  // ==========================================================================

  static generateClothGrid(width, height, rows, cols, shape) {
    const positions = [];
    const uvCoords = [];

    if (shape === 'rectangle') {
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          positions.push({
            x: (u - 0.5) * width,
            y: (v - 0.5) * height,
            z: 0
          });
          uvCoords.push({ u, v });
        }
      }
    } else if (shape === 'circle') {
      const radius = Math.min(width, height) / 2;
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          const theta = u * Math.PI * 2;
          const r = v * radius;
          positions.push({
            x: r * Math.cos(theta),
            y: r * Math.sin(theta),
            z: 0
          });
          uvCoords.push({ u, v });
        }
      }
    }

    return { positions, uvCoords };
  }

  static buildClothTopology(rows, cols, vertexCount) {
    const triangles = [];
    const edgeSet = new Set();
    const adjacency = new Map();

    for (let i = 0; i < vertexCount; i++) {
      adjacency.set(i, []);
    }

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;

        const tri1 = [idx, idx + 1, idx + cols + 2];
        const tri2 = [idx, idx + cols + 2, idx + cols + 1];

        triangles.push(tri1);
        triangles.push(tri2);

        for (const tri of [tri1, tri2]) {
          GeometryImpl._addEdge(edgeSet, adjacency, tri[0], tri[1]);
          GeometryImpl._addEdge(edgeSet, adjacency, tri[1], tri[2]);
          GeometryImpl._addEdge(edgeSet, adjacency, tri[0], tri[2]);
        }
      }
    }

    const edges = Array.from(edgeSet).map(key => GeometryImpl.parseEdgeKey(key));

    // 构建 edgeToTriangles
    const edgeToTriangles = new Map();
    for (const key of edgeSet) {
      edgeToTriangles.set(key, [-1, -1]);
    }

    for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
      const [a, b, c] = triangles[triIndex];
      for (const key of [
        GeometryImpl.makeEdgeKey(a, b),
        GeometryImpl.makeEdgeKey(b, c),
        GeometryImpl.makeEdgeKey(a, c)
      ]) {
        const pair = edgeToTriangles.get(key);
        if (pair) {
          if (pair[0] === -1) pair[0] = triIndex;
          else if (pair[1] === -1) pair[1] = triIndex;
        }
      }
    }

    return { triangles, edges, adjacency, edgeToTriangles };
  }

  // ==========================================================================
  // 线拓扑
  // ==========================================================================

  static generateLinePoints(segments, length, shape) {
    const positions = [];
    const tParams = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      tParams.push(t);

      if (shape === 'straight') {
        positions.push({ x: (t - 0.5) * length, y: 0, z: 0 });
      } else if (shape === 'circle') {
        const theta = t * Math.PI * 2;
        const radius = length / (2 * Math.PI);
        positions.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: 0 });
      } else if (shape === 'spiral') {
        const theta = t * Math.PI * 4;
        const radius = length / (4 * Math.PI) * (1 + t);
        positions.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: t * length * 0.2 });
      }
    }

    return { positions, tParams };
  }

  static buildLineTopology(pointCount, isClosed) {
    const edges = [];
    const adjacency = new Map();

    for (let i = 0; i < pointCount; i++) {
      adjacency.set(i, []);
    }

    for (let i = 0; i < pointCount - 1; i++) {
      edges.push([i, i + 1]);
      adjacency.get(i).push(i + 1);
      adjacency.get(i + 1).push(i);
    }

    if (isClosed && pointCount > 2) {
      edges.push([pointCount - 1, 0]);
      adjacency.get(pointCount - 1).push(0);
      adjacency.get(0).push(pointCount - 1);
    }

    return { edges, adjacency };
  }

  // ==========================================================================
  // 包围盒与中心
  // ==========================================================================

  static computeBoundingBox(positions) {
    if (positions.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of positions) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  }

  /**
   * 计算点集相对于中心的包围半径
   * @param {Array<{x,y,z}>} positions - 位置数组
   * @param {object} center - 中心点 {x, y, z}
   * @param {number} margin - 边距倍数（默认1.2）
   * @returns {number} 包围半径
   */
  static computeBoundingRadius(positions, center, margin = 1.2) {
    if (positions.length === 0) return 0;

    let maxR = 0;
    for (const p of positions) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > maxR) maxR = r;
    }

    return maxR * margin;
  }

  static computeCenter(positions) {
    if (positions.length === 0) {
      return { x: 0, y: 0, z: 0 };
    }

    let sumX = 0, sumY = 0, sumZ = 0;
    for (const p of positions) {
      sumX += p.x;
      sumY += p.y;
      sumZ += p.z;
    }

    const n = positions.length;
    return { x: sumX / n, y: sumY / n, z: sumZ / n };
  }

  // ==========================================================================
  // 黄金螺旋采样（用于生成显示点）
  // ==========================================================================

  /**
   * 黄金螺旋球面采样
   * 
   * 基于 Fibonacci lattice 的均匀球面采样算法，
   * 生成在球面上均匀分布的采样点。
   * 
   * @param {number} numSamples - 采样点数
   * @param {number} centerX - 中心 X
   * @param {number} centerY - 中心 Y
   * @param {number} centerZ - 中心 Z
   * @param {function} radiusCallback - 半径回调 (theta, phi) => r
   * @returns {Array<{x,y,z,theta,phi}>}
   */
  static goldenSpiralSampling(numSamples, centerX, centerY, centerZ, radiusCallback) {
    if (numSamples <= 0) {
      return [];
    }

    const points = [];
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const goldenAngle = 2 * Math.PI / (goldenRatio * goldenRatio);

    for (let i = 0; i < numSamples; i++) {
      // Fibonacci lattice 公式
      const y = 1 - (2 * i + 1) / numSamples;  // y ∈ [-1, 1]
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i;

      // 球坐标
      const phi = Math.acos(Math.max(-1, Math.min(1, y)));  // [0, π]
      const thetaNorm = theta % (2 * Math.PI);  // [0, 2π]

      // 获取实际半径
      const r = radiusCallback(phi, thetaNorm);

      // 笛卡尔坐标
      const sinPhi = Math.sin(phi);
      points.push({
        x: centerX + r * sinPhi * Math.cos(thetaNorm),
        y: centerY + r * sinPhi * Math.sin(thetaNorm),
        z: centerZ + r * Math.cos(phi),
        theta: phi,
        phi: thetaNorm
      });
    }

    return points;
  }

  /**
   * 2D 黄金螺旋采样（用于布料显示）
   * 
   * @param {number} numSamples - 采样点数
   * @param {function} boundaryCallback - 边界回调 (x, y) => boolean（true表示在内部）
   * @param {number} minX, maxX, minY, maxY - 包围盒
   * @returns {Array<{x,y,z}>}
   */
  static goldenSpiralSampling2D(numSamples, boundaryCallback, minX, maxX, minY, maxY) {
    const points = [];
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // 使用 Fibonacci 格点在矩形内采样
    let attempts = 0;
    const maxAttempts = numSamples * 10;

    for (let i = 0; points.length < numSamples && attempts < maxAttempts; i++) {
      attempts++;
      
      // Fibonacci 格点
      const fx = (i / goldenRatio) % 1;
      const fy = (i / (goldenRatio * goldenRatio)) % 1;
      
      const x = minX + fx * width;
      const y = minY + fy * height;

      if (boundaryCallback(x, y, 0)) {
        points.push({ x, y, z: 0 });
      }
    }

    return points;
  }
}
