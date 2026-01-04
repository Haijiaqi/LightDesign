/**
 * PhysicsBridgeImpl.js - 物理桥接实现层
 * 
 * ============================================================================
 * 版本: v4.0 (生产版)
 * 日期: 2026-01-03
 * ============================================================================
 * 
 * 职责：
 * - 粒子构建（buildSurfaceParticles, buildInternalParticles）
 * - 约束构建（布料、线、体积、皮骨、形状匹配）
 * - 法向量计算（computeNormals）
 * - 约束验证（validateConstraintSemantics）
 * - 物理视图构建（buildPhysicsView）
 * 
 * 无外部依赖
 * ============================================================================
 */

export class PhysicsBridgeImpl {

  // ==========================================================================
  // 常量定义
  // ==========================================================================

  static DEFAULT_STIFFNESS = 1000;
  static DEFAULT_DAMPING = 10;

  static BENDING_COMPLIANCE_CLOTH = 0.1;
  static BENDING_COMPLIANCE_LINE = 0.05;

  static INTERNAL_STIFFNESS_MULT = 5;
  static INTERNAL_DAMPING_MULT = 2;
  static SKIN_BONE_STIFFNESS_MULT = 2;
  static SKIN_BONE_DAMPING_MULT = 1.5;

  static BENDING_STIFFNESS_FORCE = 100;
  static BENDING_DAMPING_FORCE = 5;

  static NORMAL_EPSILON = 1e-10;

  // 形状匹配约束
  static SHAPE_MATCHING_STIFFNESS = 500;  // 形状匹配刚度

  // ==========================================================================
  // 边键工具（与 GeometryImpl 统一）
  // ==========================================================================

  static makeEdgeKey(i, j) {
    return i < j ? `${i},${j}` : `${j},${i}`;
  }

  // ==========================================================================
  // 粒子构建
  // ==========================================================================

  static buildSurfaceParticles(physicsDataArray, massPerParticle, sphericalCoordsArray) {
    const count = physicsDataArray.length;
    if (count === 0) return [];

    const invMass = massPerParticle > 0 ? 1 / massPerParticle : 0;
    const particles = [];

    for (let i = 0; i < count; i++) {
      particles[i] = {
        position: physicsDataArray[i].position,
        prevPosition: physicsDataArray[i].prevPosition,
        velocity: physicsDataArray[i].velocity,
        mass: massPerParticle,
        invMass: invMass,
        fixed: false,
        _index: i,
        _type: 'surface',
        _sphericalCoords: sphericalCoordsArray ? sphericalCoordsArray[i] : null,
        normal: { x: 0, y: 0, z: 0 }
      };
    }

    return particles;
  }

  static buildInternalParticles(internalPositions, surfaceCount, massPerParticle, sphericalCoordsArray) {
    const count = internalPositions.length;
    if (count === 0) return [];

    const invMass = massPerParticle > 0 ? 1 / massPerParticle : 0;
    const particles = [];

    for (let i = 0; i < count; i++) {
      particles[i] = {
        position: { 
          x: internalPositions[i].x, 
          y: internalPositions[i].y, 
          z: internalPositions[i].z 
        },
        prevPosition: { 
          x: internalPositions[i].x, 
          y: internalPositions[i].y, 
          z: internalPositions[i].z 
        },
        velocity: { x: 0, y: 0, z: 0 },
        mass: massPerParticle,
        invMass: invMass,
        fixed: false,
        _index: surfaceCount + i,
        _type: 'internal',
        _sphericalCoords: sphericalCoordsArray ? sphericalCoordsArray[i] : null,
        normal: null
      };
    }

    return particles;
  }

  // ==========================================================================
  // 布料约束构建（利用 edgeToTriangles 优化）
  // ==========================================================================

  static buildClothConstraints(
    edges, triangles, edgeToTriangles,
    positions, physicsModel,
    stiffnessArray, dampingArray,
    defaultStiffness, defaultDamping, bendingCompliance
  ) {
    const constraints = [];

    // 1. 距离/弹簧约束
    for (const [i, j] of edges) {
      const restLength = PhysicsBridgeImpl._distance(positions[i], positions[j]);

      const stiff = stiffnessArray
        ? (stiffnessArray[i] + stiffnessArray[j]) / 2
        : defaultStiffness;
      const damp = dampingArray
        ? (dampingArray[i] + dampingArray[j]) / 2
        : defaultDamping;

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance: stiff > 0 ? 1 / stiff : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: stiff,
          damping: damp
        });
      }
    }

    // 2. 弯曲约束（利用 edgeToTriangles 优化）
    const processedEdges = new Set();

    for (const [i, j] of edges) {
      const edgeKey = PhysicsBridgeImpl.makeEdgeKey(i, j);
      if (processedEdges.has(edgeKey)) continue;
      processedEdges.add(edgeKey);

      // 使用 edgeToTriangles 快速查找共享边的两个三角形
      const triPair = edgeToTriangles?.get(edgeKey);
      if (!triPair || triPair[0] === -1 || triPair[1] === -1) {
        continue; // 边界边，只有一个三角形
      }

      const tri1 = triangles[triPair[0]];
      const tri2 = triangles[triPair[1]];
      
      // 【修复】验证三角形存在
      if (!tri1 || !tri2) {
        continue;
      }

      // 找到对角点
      const c = tri1.find(v => v !== i && v !== j);
      const d = tri2.find(v => v !== i && v !== j);

      if (c !== undefined && d !== undefined) {
        const restAngle = PhysicsBridgeImpl._computeDihedralAngle(
          positions[i], positions[j], positions[c], positions[d]
        );

        if (physicsModel === 'pbd') {
          constraints.push({
            type: 'bending',
            particles: [i, j, c, d],
            restAngle,
            compliance: bendingCompliance
          });
        } else {
          const bendRestLength = PhysicsBridgeImpl._distance(positions[c], positions[d]);
          constraints.push({
            type: 'spring',
            i: c, j: d,
            particles: [c, d],
            restLength: bendRestLength,
            edgeType: 'bending',
            stiffness: PhysicsBridgeImpl.BENDING_STIFFNESS_FORCE,
            damping: PhysicsBridgeImpl.BENDING_DAMPING_FORCE
          });
        }
      }
    }

    return constraints;
  }

  // ==========================================================================
  // 线约束构建
  // ==========================================================================

  static buildLineConstraints(
    edges, positions, isClosed,
    physicsModel, stiffnessArray, dampingArray,
    defaultStiffness, defaultDamping, bendingCompliance
  ) {
    const constraints = [];
    const n = positions.length;

    // 1. 距离/弹簧约束
    for (const [i, j] of edges) {
      const restLength = PhysicsBridgeImpl._distance(positions[i], positions[j]);

      const stiff = stiffnessArray
        ? (stiffnessArray[i] + stiffnessArray[j]) / 2
        : defaultStiffness;
      const damp = dampingArray
        ? (dampingArray[i] + dampingArray[j]) / 2
        : defaultDamping;

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance: stiff > 0 ? 1 / stiff : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: stiff,
          damping: damp
        });
      }
    }

    // 2. 线弯曲约束（连续三点）
    for (let i = 1; i < n - 1; i++) {
      const restAngle = PhysicsBridgeImpl._computeAngle(
        positions[i - 1], positions[i], positions[i + 1]
      );

      constraints.push({
        type: 'line_bending',
        particles: [i - 1, i, i + 1],
        restAngle,
        compliance: bendingCompliance
      });
    }

    // 3. 闭合环的首尾弯曲约束
    if (isClosed && n >= 3) {
      constraints.push({
        type: 'line_bending',
        particles: [n - 2, n - 1, 0],
        restAngle: PhysicsBridgeImpl._computeAngle(positions[n - 2], positions[n - 1], positions[0]),
        compliance: bendingCompliance
      });

      constraints.push({
        type: 'line_bending',
        particles: [n - 1, 0, 1],
        restAngle: PhysicsBridgeImpl._computeAngle(positions[n - 1], positions[0], positions[1]),
        compliance: bendingCompliance
      });
    }

    return constraints;
  }

  // ==========================================================================
  // 体积表面约束
  // ==========================================================================

  static buildVolumeSurfaceConstraints(
    edges, positions,
    physicsModel, stiffnessArray, dampingArray,
    defaultStiffness, defaultDamping
  ) {
    const constraints = [];

    for (const [i, j] of edges) {
      const restLength = PhysicsBridgeImpl._distance(positions[i], positions[j]);

      const stiff = stiffnessArray
        ? (stiffnessArray[i] + stiffnessArray[j]) / 2
        : defaultStiffness;
      const damp = dampingArray
        ? (dampingArray[i] + dampingArray[j]) / 2
        : defaultDamping;

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'surface',
          compliance: stiff > 0 ? 1 / stiff : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'surface',
          stiffness: stiff,
          damping: damp
        });
      }
    }

    return constraints;
  }

  // ==========================================================================
  // 体积内部约束
  // ==========================================================================

  static buildVolumeInternalConstraints(
    internalEdges, allPositions, physicsModel,
    stiffnessMultiplier, dampingMultiplier,
    baseStiffness, baseDamping
  ) {
    const constraints = [];
    const stiffness = baseStiffness * stiffnessMultiplier;
    const damping = baseDamping * dampingMultiplier;

    for (const [i, j] of internalEdges) {
      const restLength = PhysicsBridgeImpl._distance(allPositions[i], allPositions[j]);

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'internal',
          compliance: stiffness > 0 ? 1 / stiffness : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'internal',
          stiffness,
          damping
        });
      }
    }

    return constraints;
  }

  // ==========================================================================
  // 皮骨连接约束
  // ==========================================================================

  static buildSkinBoneConstraints(
    skinBoneEdges, allPositions, physicsModel,
    stiffnessMultiplier, dampingMultiplier,
    baseStiffness, baseDamping
  ) {
    const constraints = [];
    const stiffness = baseStiffness * stiffnessMultiplier;
    const damping = baseDamping * dampingMultiplier;

    for (const [surfaceIdx, internalIdx] of skinBoneEdges) {
      const restLength = PhysicsBridgeImpl._distance(allPositions[surfaceIdx], allPositions[internalIdx]);

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i: surfaceIdx,
          j: internalIdx,
          particles: [surfaceIdx, internalIdx],
          restLength,
          distance: restLength,
          edgeType: 'skinBone',
          compliance: stiffness > 0 ? 1 / stiffness : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i: surfaceIdx,
          j: internalIdx,
          particles: [surfaceIdx, internalIdx],
          restLength,
          edgeType: 'skinBone',
          stiffness,
          damping
        });
      }
    }

    return constraints;
  }

  // ==========================================================================
  // 形状匹配约束（用于球谐体形体还原）
  // ==========================================================================

  /**
   * 初始化内部粒子的形状匹配数据
   * 计算加权质心，然后设置每个粒子的restOffset
   * 
   * @param {Array<Particle>} particles - 内部粒子数组
   * @returns {object|null} 质心位置 {x, y, z} 或 null
   */
  static initShapeMatchingData(particles) {
    if (!particles || particles.length === 0) return null;

    // 计算加权质心
    let cx = 0, cy = 0, cz = 0;
    let totalMass = 0;
    
    for (const p of particles) {
      if (p && p.position && p.mass > 0) {
        cx += p.position.x * p.mass;
        cy += p.position.y * p.mass;
        cz += p.position.z * p.mass;
        totalMass += p.mass;
      }
    }

    if (totalMass <= 0) return null;

    cx /= totalMass;
    cy /= totalMass;
    cz /= totalMass;

    // 设置每个粒子的 restOffset
    for (const p of particles) {
      if (p && p.position) {
        p._shapeMatchingData = {
          restOffset: {
            x: p.position.x - cx,
            y: p.position.y - cy,
            z: p.position.z - cz
          }
        };
      }
    }

    return { x: cx, y: cy, z: cz };
  }

  /**
   * 更新形状匹配数据（基于理想位置）
   * 用于物理几何更新时重新计算restOffset
   * 
   * @param {Array<Particle>} particles - 所有粒子数组
   * @param {Array<{x,y,z}|null>} idealPositions - 理想位置数组
   * @param {number} startIdx - 内部粒子起始索引
   * @param {number} endIdx - 内部粒子结束索引
   */
  static updateShapeMatchingData(particles, idealPositions, startIdx, endIdx) {
    // 计算理想位置的加权质心
    let cx = 0, cy = 0, cz = 0;
    let totalMass = 0;

    for (let i = startIdx; i < endIdx; i++) {
      const p = particles[i];
      const ideal = idealPositions[i];
      if (!p || !ideal) continue;
      
      cx += ideal.x * p.mass;
      cy += ideal.y * p.mass;
      cz += ideal.z * p.mass;
      totalMass += p.mass;
    }

    if (totalMass <= 0) return;

    cx /= totalMass;
    cy /= totalMass;
    cz /= totalMass;

    // 更新 restOffset
    for (let i = startIdx; i < endIdx; i++) {
      const p = particles[i];
      const ideal = idealPositions[i];
      if (!p || !ideal) continue;

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

  /**
   * 构建形状匹配约束
   * 
   * 形状匹配约束用于使变形后的物体恢复到原始形状。
   * 它通过计算当前质心和理想质心的偏移来约束内部粒子。
   * 
   * @param {Array<Particle>} particles - 粒子数组
   * @param {number} internalStartIndex - 内部粒子起始索引
   * @param {number} internalCount - 内部粒子数量
   * @param {string} physicsModel - 'pbd' 或 'force'
   * @param {number} stiffness - 刚度
   * @returns {Object|null} 形状匹配约束
   */
  static buildShapeMatchingConstraint(
    particles, internalStartIndex, internalCount, physicsModel, stiffness
  ) {
    if (internalCount === 0) return null;

    const endIndex = internalStartIndex + internalCount;
    const particleIndices = [];
    const restOffsets = [];

    // 收集内部粒子的 restOffset
    for (let i = internalStartIndex; i < endIndex; i++) {
      const p = particles[i];
      if (p && p._shapeMatchingData && p._shapeMatchingData.restOffset) {
        particleIndices.push(i);
        restOffsets.push({
          x: p._shapeMatchingData.restOffset.x,
          y: p._shapeMatchingData.restOffset.y,
          z: p._shapeMatchingData.restOffset.z
        });
      }
    }

    if (particleIndices.length === 0) return null;

    if (physicsModel === 'pbd') {
      return {
        type: 'shape_matching',
        particles: particleIndices,
        restOffsets,
        compliance: stiffness > 0 ? 1 / stiffness : 0
      };
    } else {
      return {
        type: 'shape_matching',
        particles: particleIndices,
        restOffsets,
        stiffness
      };
    }
  }

  // ==========================================================================
  // 2D 结构约束
  // ==========================================================================

  static build2DStructuralConstraints(
    edges, positions, physicsModel,
    stiffnessArray, dampingArray,
    defaultStiffness, defaultDamping
  ) {
    const constraints = [];

    for (const [i, j] of edges) {
      const restLength = PhysicsBridgeImpl._distance(positions[i], positions[j]);

      const stiff = stiffnessArray
        ? (stiffnessArray[i] + stiffnessArray[j]) / 2
        : defaultStiffness;
      const damp = dampingArray
        ? (dampingArray[i] + dampingArray[j]) / 2
        : defaultDamping;

      if (physicsModel === 'pbd') {
        constraints.push({
          type: 'distance',
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance: stiff > 0 ? 1 / stiff : 0
        });
      } else {
        constraints.push({
          type: 'spring',
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: stiff,
          damping: damp
        });
      }
    }

    return constraints;
  }

  // ==========================================================================
  // 约束语义验证
  // ==========================================================================

  static validateConstraintSemantics(constraints) {
    const errors = [];
    const edgeConstraints = new Map();

    for (let idx = 0; idx < constraints.length; idx++) {
      const c = constraints[idx];

      if (c.type === 'distance') {
        if (c.stiffness !== undefined) {
          errors.push(`Constraint ${idx} (distance): 'stiffness' not allowed`);
        }
        if (c.restLength === undefined && c.distance === undefined) {
          errors.push(`Constraint ${idx} (distance): missing 'restLength'`);
        }
      }

      if (c.type === 'spring') {
        if (c.compliance !== undefined) {
          errors.push(`Constraint ${idx} (spring): 'compliance' not allowed`);
        }
        if (c.stiffness === undefined) {
          errors.push(`Constraint ${idx} (spring): missing 'stiffness'`);
        }
      }

      if (c.type === 'bending' || c.type === 'line_bending') {
        if (c.compliance === undefined) {
          errors.push(`Constraint ${idx} (${c.type}): missing 'compliance'`);
        }
        if (!c.particles || c.particles.length < 3) {
          errors.push(`Constraint ${idx} (${c.type}): 'particles' must have at least 3 elements`);
        }
      }

      // 验证形状匹配约束
      if (c.type === 'shape_matching') {
        if (!c.particles || c.particles.length === 0) {
          errors.push(`Constraint ${idx} (shape_matching): 'particles' cannot be empty`);
        }
        if (!c.restOffsets || c.restOffsets.length !== c.particles?.length) {
          errors.push(`Constraint ${idx} (shape_matching): 'restOffsets' length must match 'particles' length`);
        }
      }

      // 检查同边冲突
      if ((c.type === 'distance' || c.type === 'spring') && c.particles?.length === 2) {
        const key = PhysicsBridgeImpl.makeEdgeKey(c.particles[0], c.particles[1]);
        if (edgeConstraints.has(key)) {
          const existing = edgeConstraints.get(key);
          if (existing !== c.type) {
            errors.push(`Edge [${key}] has both 'distance' and 'spring' constraints`);
          }
        } else {
          edgeConstraints.set(key, c.type);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ==========================================================================
  // 法向量计算
  // ==========================================================================

  static computeNormals(particles, triangles, surfaceCount) {
    // 清零
    for (let i = 0; i < surfaceCount; i++) {
      if (!particles[i].normal) {
        particles[i].normal = { x: 0, y: 0, z: 0 };
      } else {
        particles[i].normal.x = 0;
        particles[i].normal.y = 0;
        particles[i].normal.z = 0;
      }
    }

    // 累加面法向
    for (const tri of triangles) {
      const [i0, i1, i2] = tri;

      if (i0 >= surfaceCount || i1 >= surfaceCount || i2 >= surfaceCount) {
        continue;
      }
      
      // 【修复】验证粒子和位置存在
      if (!particles[i0]?.position || !particles[i1]?.position || !particles[i2]?.position) {
        continue;
      }

      const p0 = particles[i0].position;
      const p1 = particles[i1].position;
      const p2 = particles[i2].position;

      const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
      const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      particles[i0].normal.x += nx;
      particles[i0].normal.y += ny;
      particles[i0].normal.z += nz;

      particles[i1].normal.x += nx;
      particles[i1].normal.y += ny;
      particles[i1].normal.z += nz;

      particles[i2].normal.x += nx;
      particles[i2].normal.y += ny;
      particles[i2].normal.z += nz;
    }

    // 归一化
    for (let i = 0; i < surfaceCount; i++) {
      const n = particles[i].normal;
      const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (len > PhysicsBridgeImpl.NORMAL_EPSILON) {
        n.x /= len;
        n.y /= len;
        n.z /= len;
      } else {
        n.x = 0;
        n.y = 1;
        n.z = 0;
      }
    }
  }

  // ==========================================================================
  // 物理视图
  // ==========================================================================

  static buildPhysicsView(particles, constraints) {
    return { particles, constraints };
  }

  static updateConstraintRestLengths(constraints, positions) {
    let count = 0;
    for (const c of constraints) {
      if (c.type === 'distance' || c.type === 'spring') {
        let i, j;
        if (c.i !== undefined && c.j !== undefined) {
          i = c.i;
          j = c.j;
        } else if (c.particles?.length === 2) {
          i = c.particles[0];
          j = c.particles[1];
        } else {
          continue;
        }

        const pi = positions[i];
        const pj = positions[j];
        if (pi && pj) {
          const newLength = PhysicsBridgeImpl._distance(pi, pj);
          c.restLength = newLength;
          c.distance = newLength;
          count++;
        }
      }
    }
    return count;
  }

  static applyFixedPoints(particles, fixedIndices) {
    for (const idx of fixedIndices) {
      if (idx >= 0 && idx < particles.length) {
        particles[idx].fixed = true;
        particles[idx].invMass = 0;
      }
    }
  }

  // ==========================================================================
  // 内部辅助方法
  // ==========================================================================

  static _computeDihedralAngle(pa, pb, pc, pd) {
    const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
    const ac = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z };
    const ad = { x: pd.x - pa.x, y: pd.y - pa.y, z: pd.z - pa.z };

    const n1 = PhysicsBridgeImpl._cross(ab, ac);
    const n2 = PhysicsBridgeImpl._cross(ab, ad);

    const mag1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
    const mag2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);

    if (mag1 < PhysicsBridgeImpl.NORMAL_EPSILON || mag2 < PhysicsBridgeImpl.NORMAL_EPSILON) {
      return 0;
    }

    n1.x /= mag1; n1.y /= mag1; n1.z /= mag1;
    n2.x /= mag2; n2.y /= mag2; n2.z /= mag2;

    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  static _computeAngle(p0, p1, p2) {
    const v1x = p0.x - p1.x, v1y = p0.y - p1.y, v1z = p0.z - p1.z;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y, v2z = p2.z - p1.z;

    const len1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

    if (len1 < PhysicsBridgeImpl.NORMAL_EPSILON || len2 < PhysicsBridgeImpl.NORMAL_EPSILON) {
      return Math.PI;
    }

    const dot = v1x * v2x + v1y * v2y + v1z * v2z;
    const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
    return Math.acos(cosAngle);
  }

  static _distance(p1, p2) {
    if (!p1 || !p2) return 0;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  static _cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
}
