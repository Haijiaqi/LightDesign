// PhysicsBridgeImpl.js - 物理数据桥接模块
// 职责定位: 数据桥接（几何 → 物理），不执行物理求解

export class PhysicsBridgeImpl {
  /**
   * PhysicsBridgeImpl 构造函数
   * 
   * ⭐ 职责：
   *   1. 保存 this._object = object
   *   2. this._verbose = object.verbose
   *   3. 不初始化 physicsState（由 Object 构造函数初始化）
   * 
   * @param {Object} object - Object 实例的引用
   */
  constructor(object) {
    this._object = object;
    this._verbose = object.verbose;
  }

  /**
   * 重建物理拓扑
   * 
   * ⭐ 职责：从几何重建物理数据结构（particles + constraints）
   * ⚠️ 规则1：只读取几何数据，只写入 physicsState
   * ⚠️ 规则2：创建粒子时深拷贝坐标
   * 
   * ⭐ 支持物理状态复用（保留速度、固定点）
   * ⚠️ 简化策略：仅基于粒子数量一致性判断是否复用
   * 
   * @param {Object} options - { force: boolean }
   * @returns {Object} 重建结果信息
   */
  rebuildPhysicsTopology(options = {}) {
    if (this._verbose) {
      console.log('[PhysicsBridgeImpl] Rebuilding physics topology');
    }

    const force = options.force || false;

    // 【步骤1：读取几何数据】
    // ⚠️ 规则1：只读取，不修改
    const surfacePoints = this._object.surfacePoints;
    const topology = this._object.representation.topology;
    const physicsModel = this._object.physics.model || 'pbd';
    const internalPoints = this._object.representation.data?.internalPoints;
    const editStateConstraints = this._object.representation.editState?.constraints || [];

    // ⚠️ 问题1修复：topology 语义校验（防护性检查，不自动修复）
    // 检查1：edges 存在但 surfacePoints 为空 → 拒绝
    if (topology.edges && topology.edges.length > 0 && surfacePoints.length === 0) {
      const errorMsg = '[PhysicsBridgeImpl] Invalid topology: edges exist but surfacePoints is empty';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // 检查2：internalEdges 存在但 internalPoints 不存在 → 拒绝
    if (topology.internalEdges && topology.internalEdges.length > 0 && !internalPoints) {
      const errorMsg = '[PhysicsBridgeImpl] Invalid topology: internalEdges exist but internalPoints is missing';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // 检查3：triangles 存在但 isClosed === false → 警告（不抛异常）
    if (topology.triangles && topology.triangles.length > 0 && this._object.representation.isClosed === false) {
      console.warn('[PhysicsBridgeImpl] Warning: triangles exist but representation.isClosed is false. This may indicate a modeling inconsistency.');
    }

    // 读取旧的物理状态（用于复用）
    const oldPhysicsState = this._object.representation.physicsState;
    const oldParticles = oldPhysicsState?.particles || [];

    // 【步骤2：创建粒子】
    // ⚠️ 问题2修复：particles 与 surfacePoints 通过 index 绑定
    // 关键语义：
    //   - particles[i] 对应 surfacePoints[i]（表面粒子）
    //   - particles[surfaceCount + i] 对应 internalPoints[i]（内部粒子）
    //   - editStateConstraints 使用的 index 直接对应 particles 数组索引
    //   - 不使用 pointId / uuid 等机制，完全依赖索引稳定性
    const particles = [];

    // 质量计算
    const globalMassScale = this._object.physics.mass || 1.0;
    const surfaceCount = surfacePoints.length;
    const internalCount = internalPoints?.length || 0;
    const totalParticleCount = surfaceCount + internalCount;

    // ⚠️ 修正1：收紧粒子复用条件（稳健优先）
    // 必须同时满足：
    //   1. 非强制重建
    //   2. 总粒子数一致
    //   3. surfaceCount 与 internalCount 分别一致
    //   4. surfaceCount > 0（问题2修复：禁止空几何复用）
    // 否则不复用，避免静默错误
    const oldSurfaceCount = oldPhysicsState?.surfaceCount || 0;
    const oldInternalCount = oldPhysicsState?.internalCount || 0;
    
    const canReuseParticleState = !force && 
                                   oldParticles.length === totalParticleCount &&
                                   oldSurfaceCount === surfaceCount &&
                                   oldInternalCount === internalCount &&
                                   totalParticleCount > 0 &&
                                   surfaceCount > 0;  // 问题2修复：禁止空几何复用

    if (this._verbose && canReuseParticleState) {
      console.log('[PhysicsBridgeImpl] Reusing particle state (surface/internal count matches)');
    } else if (this._verbose && !canReuseParticleState && oldParticles.length > 0) {
      console.log(`[PhysicsBridgeImpl] Cannot reuse particle state (surface: ${oldSurfaceCount}→${surfaceCount}, internal: ${oldInternalCount}→${internalCount})`);
    }

    // 表面粒子质量
    const uniformSurfaceMass = globalMassScale / totalParticleCount;

    // 表面粒子
    for (let i = 0; i < surfaceCount; i++) {
      const p = surfacePoints[i];

      // 尝试从旧粒子复用物理状态
      let velocity = { x: 0, y: 0, z: 0 };
      let prevPosition = { x: p.x, y: p.y, z: p.z };
      let fixed = false;

      if (canReuseParticleState && i < oldParticles.length) {
        const oldParticle = oldParticles[i];
        if (oldParticle) {
          velocity = { ...oldParticle.velocity };
          prevPosition = { ...oldParticle.prevPosition };
          fixed = oldParticle.fixed || false;
        }
      }

      // 从 Point._physicsData 读取状态（如果存在）
      if (p._physicsData) {
        velocity = { ...p._physicsData.velocity };
        prevPosition = { ...p._physicsData.prevPosition };
        fixed = p._physicsData.fixed || false;
      }

      // 计算质量
      let particleMass = uniformSurfaceMass;
      if (!this._object.representation.material.uniform) {
        // 非均匀材料
        if (typeof this._object.getMaterialAt === 'function') {
          const mat = this._object.getMaterialAt(p);
          if (mat && mat.mass !== undefined) {
            particleMass = mat.mass * globalMassScale / totalParticleCount;
          }
        }
      } else if (this._object.representation.material.properties?.mass !== undefined) {
        // 均匀材料的质量属性
        particleMass = this._object.representation.material.properties.mass * globalMassScale / totalParticleCount;
      }

      // ⚠️ 规则2：深拷贝坐标，防止引用泄漏
      particles.push({
        position: { x: p.x, y: p.y, z: p.z },
        prevPosition,
        velocity,
        force: { x: 0, y: 0, z: 0 },
        mass: particleMass,
        invMass: particleMass > 0 ? 1.0 / particleMass : 0,
        fixed,
        _index: i,
        _type: 'surface'
      });
    }

    // 内部粒子（如果存在）
    if (internalPoints && internalPoints.length > 0) {
      // ⚠️ 修正4：内部粒子质量逻辑说明
      // 当前实现：内部粒子质量 = 总质量 / 总粒子数
      // 即：内部粒子质量 = 表面粒子质量
      // 这是简化模型，不代表真实物理（真实物理应考虑体积/密度）
      // 但对于大多数 PBD/Force 模拟已足够稳定
      const uniformInternalMass = globalMassScale / totalParticleCount;

      for (let i = 0; i < internalPoints.length; i++) {
        const p = internalPoints[i];

        // 尝试从旧粒子复用物理状态
        let velocity = { x: 0, y: 0, z: 0 };
        let prevPosition = { x: p.x, y: p.y, z: p.z };
        let fixed = false;

        const oldIdx = surfaceCount + i;
        if (canReuseParticleState && oldIdx < oldParticles.length) {
          const oldParticle = oldParticles[oldIdx];
          if (oldParticle) {
            velocity = { ...oldParticle.velocity };
            prevPosition = { ...oldParticle.prevPosition };
            fixed = oldParticle.fixed || false;
          }
        }

        // 从 Point._physicsData 读取状态（如果存在）
        if (p._physicsData) {
          velocity = { ...p._physicsData.velocity };
          prevPosition = { ...p._physicsData.prevPosition };
          fixed = p._physicsData.fixed || false;
        }

        // ⚠️ 规则2：深拷贝坐标
        particles.push({
          position: { x: p.x, y: p.y, z: p.z },
          prevPosition,
          velocity,
          force: { x: 0, y: 0, z: 0 },
          mass: uniformInternalMass,
          invMass: uniformInternalMass > 0 ? 1.0 / uniformInternalMass : 0,
          fixed,
          _index: surfaceCount + i,
          _type: 'internal'
        });
      }
    }

    if (this._verbose) {
      console.log(`[PhysicsBridgeImpl] Created ${surfaceCount} surface particles, ${internalCount} internal particles`);
    }

    // 【步骤3：应用编辑态固定点约束】
    if (editStateConstraints.length > 0) {
      for (const ec of editStateConstraints) {
        if (ec.type === 'fixed') {
          for (const idx of ec.particles) {
            if (idx >= 0 && idx < particles.length) {
              particles[idx].fixed = true;
              particles[idx].invMass = 0;  // 固定点的关键：invMass = 0

              // 同步到 Point._physicsData（如果存在）
              if (idx < surfaceCount && surfacePoints[idx]._physicsData) {
                surfacePoints[idx]._physicsData.fixed = true;
              }

              if (this._verbose) {
                console.log(`[PhysicsBridgeImpl] Fixed particle ${idx}`);
              }
            }
          }
        }
      }
    }

    // 【步骤4：构建约束】
    let constraints = [];
    let reusedConstraints = false;

    // ⚠️ 修正2：收紧约束复用条件（更保守）
    // 必须同时满足：
    //   1. 边数和三角形数一致
    //   2. physicsState 明确标记"拓扑未变"
    // 避免仅凭数量相等就复用
    const oldEdgeCount = oldPhysicsState?._edgeCount || 0;
    const oldTriangleCount = oldPhysicsState?._triangleCount || 0;
    const oldTopologyUnchangedFlag = oldPhysicsState?._topologyUnchanged || false;
    
    const currentEdgeCount = topology.edges?.length || 0;
    const currentTriangleCount = topology.triangles?.length || 0;
    
    const countMatches = (oldEdgeCount === currentEdgeCount) && 
                         (oldTriangleCount === currentTriangleCount);
    
    // 只有当数量一致 且 上次明确标记未变 时才复用
    const topologyUnchanged = countMatches && oldTopologyUnchangedFlag;

    if (!force && oldPhysicsState?.constraints && oldPhysicsState.constraints.length > 0 && topologyUnchanged) {
      // 拓扑未变，复用约束
      constraints = oldPhysicsState.constraints;
      reusedConstraints = true;

      if (this._verbose) {
        console.log('[PhysicsBridgeImpl] Reusing existing constraints (topology explicitly unchanged)');
      }
    } else {
      // 拓扑改变或强制重建，重建约束
      constraints = this._buildPhysicsConstraints(
        topology,
        surfaceCount,
        internalCount,
        physicsModel
      );

      if (this._verbose) {
        if (!countMatches) {
          console.log(`[PhysicsBridgeImpl] Rebuilt constraints (topology changed: edges ${oldEdgeCount}→${currentEdgeCount}, triangles ${oldTriangleCount}→${currentTriangleCount})`);
        } else {
          console.log('[PhysicsBridgeImpl] Rebuilt constraints');
        }
      }
    }

    if (this._verbose) {
      console.log(`[PhysicsBridgeImpl] Built ${constraints.length} constraints`);
    }

    // 【步骤5：写入physicsState】
    // ⚠️ 规则1：只写入 physicsState，不修改几何
    
    // 防御性检查
    const physicsState = this._object.representation.physicsState;
    if (!physicsState) {
      const errorMsg = '[PhysicsBridgeImpl] physicsState is null or undefined. Object.representation.physicsState must be initialized before calling rebuildPhysicsTopology.';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    physicsState.particles = particles;
    physicsState.constraints = constraints;
    physicsState.surfaceStartIndex = 0;
    physicsState.internalStartIndex = surfaceCount;
    physicsState.surfaceCount = surfaceCount;
    physicsState.internalCount = internalCount;
    physicsState.physicsModel = physicsModel;

    // 记录拓扑信息（用于下次判断）
    physicsState._edgeCount = currentEdgeCount;
    physicsState._triangleCount = currentTriangleCount;
    
    // ⚠️ 修正2：明确标记拓扑是否改变
    // 只有当数量一致时才标记为"未变"
    // 首次构建或强制重建时标记为"已变"
    physicsState._topologyUnchanged = countMatches && !force && oldPhysicsState?._topologyUnchanged !== undefined;

    // 空间语义标记
    physicsState.coordinateSpace = 'as-is';

    // ⚠️ 修正3：同步 physicsState 到 Point._physicsData
    // 保证 rebuild 完成后状态一致，避免多次 rebuild 后状态漂移
    for (let i = 0; i < surfaceCount; i++) {
      const point = surfacePoints[i];
      const particle = particles[i];
      
      if (point._physicsData) {
        // 同步当前粒子状态到 Point._physicsData
        point._physicsData.velocity = { ...particle.velocity };
        point._physicsData.prevPosition = { ...particle.prevPosition };
        point._physicsData.fixed = particle.fixed;
      }
    }

    if (this._verbose) {
      console.log('[PhysicsBridgeImpl] Physics topology rebuilt');
    }

    // 返回重建结果信息
    return {
      particles: particles.length,
      constraints: constraints.length,
      surfaceCount,
      internalCount,
      reusedParticleState: canReuseParticleState,
      reusedConstraints,
      physicsModel
    };
  }

  /**
   * 获取物理视图
   * 
   * ⭐ 职责：返回物理求解器需要的数据（零拷贝）
   * ⚠️ 规则3：返回直接引用，不复制数据
   */
  getPhysicsView() {
    const physicsState = this._object.representation.physicsState;

    // ⚠️ 规则3：零拷贝设计，返回直接引用
    return {
      particles: physicsState.particles,
      constraints: physicsState.constraints,
      surfaceStartIndex: physicsState.surfaceStartIndex,
      surfaceCount: physicsState.surfaceCount,
      internalStartIndex: physicsState.internalStartIndex,
      internalCount: physicsState.internalCount,
      physicsModel: physicsState.physicsModel
    };
  }

  /**
   * 构建物理约束
   * 参考原始Object.js L1141-1227, L2355-2520
   * 
   * ⭐ 职责：从拓扑构建物理约束（结构+弯曲+内部）
   * ⚠️ 纯计算方法，不修改 Object
   */
  _buildPhysicsConstraints(topology, surfaceCount, internalCount, physicsModel) {
    const constraints = [];
    const { triangles, edges, internalEdges } = topology;

    // 【步骤1：结构约束（从edges）】
    if (edges && edges.length > 0) {
      for (const [i, j] of edges) {
        const p1 = this._object.surfacePoints[i];
        const p2 = this._object.surfacePoints[j];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // 获取材料属性
        // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
        // 默认值：stiffness = 1000, damping = 10
        // 这些是简化物理模型的经验值，适用于大多数场景
        // 原始 Object.js 支持更细粒度的材料控制（per-vertex, per-edge）
        // 当前实现优先保证稳定性和性能
        let stiffness = 1000;  // 默认刚度（简化模型）
        let damping = 10;      // 默认阻尼（简化模型）

        if (!this._object.representation.material.uniform) {
          // 非均匀材料
          if (typeof this._object.getMaterialAt === 'function') {
            const mat1 = this._object.getMaterialAt(p1);
            const mat2 = this._object.getMaterialAt(p2);
            stiffness = (mat1.stiffness + mat2.stiffness) / 2;
            damping = (mat1.damping + mat2.damping) / 2;
          }
        } else if (this._object.representation.material.properties) {
          // 均匀材料
          stiffness = this._object.representation.material.properties.stiffness || 1000;
          damping = this._object.representation.material.properties.damping || 10;
        }

        if (physicsModel === 'pbd') {
          const compliance = stiffness > 0 ? 1 / stiffness : 0;
          constraints.push({
            type: 'distance',
            particles: [i, j],
            restLength,
            distance: restLength,
            edgeType: 'structural',
            compliance
          });
        } else if (physicsModel === 'force') {
          constraints.push({
            type: 'spring',
            particles: [i, j],
            restLength,
            edgeType: 'structural',
            stiffness,
            damping
          });
        }
      }
    }

    // 【步骤2：弯曲约束（从triangles）】
    if (triangles && triangles.length > 0) {
      // 构建边-三角形邻接
      const edgeTriangles = new Map();

      for (let ti = 0; ti < triangles.length; ti++) {
        const tri = triangles[ti];
        for (let i = 0; i < 3; i++) {
          const v1 = tri[i];
          const v2 = tri[(i + 1) % 3];
          const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;

          if (!edgeTriangles.has(key)) {
            edgeTriangles.set(key, []);
          }
          edgeTriangles.get(key).push(ti);
        }
      }

      // 对于每条共享边，创建弯曲约束
      for (const [edgeKey, tris] of edgeTriangles) {
        if (tris.length === 2) {
          const [i, j] = edgeKey.split(',').map(Number);
          const tri1 = triangles[tris[0]];
          const tri2 = triangles[tris[1]];

          // 找到对边顶点
          const k = tri1.find(v => v !== i && v !== j);
          const l = tri2.find(v => v !== i && v !== j);

          if (k !== undefined && l !== undefined) {
            // 计算初始二面角
            const pk = this._object.surfacePoints[k];
            const pl = this._object.surfacePoints[l];
            const pi = this._object.surfacePoints[i];
            const pj = this._object.surfacePoints[j];

            // 计算两个三角形的法向量
            const e1_1 = { x: pi.x - pk.x, y: pi.y - pk.y, z: pi.z - pk.z };
            const e2_1 = { x: pj.x - pk.x, y: pj.y - pk.y, z: pj.z - pk.z };
            const n1 = {
              x: e1_1.y * e2_1.z - e1_1.z * e2_1.y,
              y: e1_1.z * e2_1.x - e1_1.x * e2_1.z,
              z: e1_1.x * e2_1.y - e1_1.y * e2_1.x
            };

            const e1_2 = { x: pi.x - pl.x, y: pi.y - pl.y, z: pi.z - pl.z };
            const e2_2 = { x: pj.x - pl.x, y: pj.y - pl.y, z: pj.z - pl.z };
            const n2 = {
              x: e1_2.y * e2_2.z - e1_2.z * e2_2.y,
              y: e1_2.z * e2_2.x - e1_2.x * e2_2.z,
              z: e1_2.x * e2_2.y - e1_2.y * e2_2.x
            };

            // 归一化
            const len1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
            const len2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);

            let restAngle = 0;
            if (len1 > 1e-6 && len2 > 1e-6) {
              n1.x /= len1; n1.y /= len1; n1.z /= len1;
              n2.x /= len2; n2.y /= len2; n2.z /= len2;

              const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
              restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
            }

            if (physicsModel === 'pbd') {
              // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
              // compliance = 0.01（弯曲柔顺度）
              // 这是经验值，适用于布料/软体模拟
              // 原始 Object.js 支持更细粒度的弯曲控制
              constraints.push({
                type: 'bending',
                particles: [k, i, j, l],
                restAngle,
                compliance: 0.01,  // 简化模型：经验弯曲柔顺度
                edgeType: 'bending'
              });
            } else if (physicsModel === 'force') {
              // Force模型：使用k-l之间的弹簧约束
              const dx = pl.x - pk.x;
              const dy = pl.y - pk.y;
              const dz = pl.z - pk.z;
              const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

              // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
              // stiffness = 100, damping = 5（弯曲约束参数）
              // 这些值比结构约束更柔软，适用于弯曲行为
              // 原始 Object.js 支持更细粒度的弯曲控制
              constraints.push({
                type: 'spring',
                particles: [k, l],
                restLength,
                edgeType: 'bending',
                stiffness: 100,  // 简化模型：弯曲刚度（比结构约束更柔软）
                damping: 5       // 简化模型：弯曲阻尼
              });
            }
          }
        }
      }
    }

    // 【步骤3：线段弯曲约束（如果是line拓扑）】
    if (edges && edges.length > 0 && (!triangles || triangles.length === 0)) {
      // 这是线段拓扑，需要构建线段弯曲约束

      // 从 edges 构建邻接关系
      const adjacency = new Map();
      for (let i = 0; i < this._object.surfacePoints.length; i++) {
        adjacency.set(i, []);
      }
      for (const [a, b] of edges) {
        adjacency.get(a).push(b);
        adjacency.get(b).push(a);
      }

      // 构建顶点顺序（如果是简单链或环）
      const vertexOrder = this._buildVertexOrder(edges, adjacency);

      if (vertexOrder.length > 0) {
        // 使用顶点顺序构建弯曲约束
        for (let i = 0; i < vertexOrder.length - 2; i++) {
          const idx0 = vertexOrder[i];
          const idx1 = vertexOrder[i + 1];
          const idx2 = vertexOrder[i + 2];

          const p0 = this._object.surfacePoints[idx0];
          const p1 = this._object.surfacePoints[idx1];
          const p2 = this._object.surfacePoints[idx2];

          const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
          const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };

          const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
          const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

          if (mag1 > 1e-6 && mag2 > 1e-6) {
            const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
            const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));

            if (physicsModel === 'pbd') {
              // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
              // compliance = 0.05（线段弯曲柔顺度）
              // 比面片弯曲更柔软，适用于绳索/线缆模拟
              // 原始 Object.js 支持更细粒度的线段控制
              constraints.push({
                type: 'line_bending',
                particles: [idx0, idx1, idx2],
                restAngle,
                compliance: 0.05  // 简化模型：线段弯曲柔顺度
              });
            } else if (physicsModel === 'force') {
              const dx = p2.x - p0.x;
              const dy = p2.y - p0.y;
              const dz = p2.z - p0.z;
              const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

              // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
              // stiffness = 50, damping = 5（线段弯曲参数）
              // 比结构约束更柔软，适用于线段弯曲行为
              // 原始 Object.js 支持更细粒度的线段控制
              constraints.push({
                type: 'spring',
                particles: [idx0, idx2],
                restLength: bendRestLength,
                edgeType: 'bending',
                stiffness: 50,  // 简化模型：线段弯曲刚度
                damping: 5      // 简化模型：线段弯曲阻尼
              });
            }
          }
        }

        // 闭合线段的额外弯曲约束
        if (this._object.representation.isClosed && vertexOrder.length > 2) {
          const n = vertexOrder.length;

          // n-2, n-1, 0
          {
            const idx0 = vertexOrder[n - 2];
            const idx1 = vertexOrder[n - 1];
            const idx2 = vertexOrder[0];

            const p0 = this._object.surfacePoints[idx0];
            const p1 = this._object.surfacePoints[idx1];
            const p2 = this._object.surfacePoints[idx2];

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
                  particles: [idx0, idx1, idx2],
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
                  particles: [idx0, idx2],
                  restLength: bendRestLength,
                  edgeType: 'bending',
                  stiffness: 50,
                  damping: 5
                });
              }
            }
          }

          // n-1, 0, 1
          {
            const idx0 = vertexOrder[n - 1];
            const idx1 = vertexOrder[0];
            const idx2 = vertexOrder[1];

            const p0 = this._object.surfacePoints[idx0];
            const p1 = this._object.surfacePoints[idx1];
            const p2 = this._object.surfacePoints[idx2];

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
                  particles: [idx0, idx1, idx2],
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
                  particles: [idx0, idx2],
                  restLength: bendRestLength,
                  edgeType: 'bending',
                  stiffness: 50,
                  damping: 5
                });
              }
            }
          }
        }
      }
    }

    // 【步骤4：内部约束（如果有内部边）】
    if (internalEdges && internalEdges.length > 0) {
      for (const [i, j] of internalEdges) {
        // 索引规范验证
        if (i < 0 || i >= surfaceCount + internalCount || j < 0 || j >= surfaceCount + internalCount) {
          console.error(`[PhysicsBridgeImpl] Invalid internalEdge index: [${i}, ${j}], valid range: [0, ${surfaceCount + internalCount})`);
          continue;
        }

        // 内部边连接的可能是表面点+内部点，或内部点+内部点
        let pi, pj;

        if (i < surfaceCount) {
          pi = this._object.surfacePoints[i];
        } else if (this._object.representation.data?.internalPoints) {
          const internalIdx = i - surfaceCount;
          pi = this._object.representation.data.internalPoints[internalIdx];
        }

        if (j < surfaceCount) {
          pj = this._object.surfacePoints[j];
        } else if (this._object.representation.data?.internalPoints) {
          const internalIdx = j - surfaceCount;
          pj = this._object.representation.data.internalPoints[internalIdx];
        }

        if (pi && pj) {
          const dx = pj.x - pi.x;
          const dy = pj.y - pi.y;
          const dz = pj.z - pi.z;
          const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // ⚠️ 问题3修复：硬编码值说明（简化物理模型）
          // internalStiffness = 5000, internalDamping = 20
          // 内部约束使用更高的刚度（5倍于结构约束）
          // 确保体积模型的稳定性和刚性
          // 原始 Object.js 支持更细粒度的内部约束控制
          const internalStiffness = 5000;  // 简化模型：内部约束高刚度
          const internalDamping = 20;      // 简化模型：内部约束高阻尼

          if (physicsModel === 'pbd') {
            const compliance = internalStiffness > 0 ? 1 / internalStiffness : 0;
            constraints.push({
              type: 'distance',
              particles: [i, j],
              restLength,
              distance: restLength,
              edgeType: 'internal',
              compliance
            });
          } else if (physicsModel === 'force') {
            constraints.push({
              type: 'spring',
              particles: [i, j],
              restLength,
              edgeType: 'internal',
              stiffness: internalStiffness,
              damping: internalDamping
            });
          }
        }
      }
    }

    return constraints;
  }

  /**
   * 构建顶点顺序（从边）
   * ⚠️ 辅助方法，用于线段弯曲约束
   * 
   * @returns {Array<number>} 顶点索引顺序
   */
  _buildVertexOrder(edges, adjacency) {
    if (edges.length === 0) return [];

    // 简单策略：从度为1的顶点开始（链的端点），或任意顶点（环）
    let startVertex = -1;

    // 查找度为1的顶点（链的端点）
    for (const [v, neighbors] of adjacency) {
      if (neighbors.length === 1) {
        startVertex = v;
        break;
      }
    }

    // 如果没有度为1的顶点，说明是环，从任意顶点开始
    if (startVertex === -1) {
      startVertex = edges[0][0];
    }

    // 遍历构建顺序
    const order = [startVertex];
    const visited = new Set([startVertex]);
    let current = startVertex;

    while (true) {
      const neighbors = adjacency.get(current);
      let next = -1;

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          next = neighbor;
          break;
        }
      }

      if (next === -1) break;

      order.push(next);
      visited.add(next);
      current = next;
    }

    return order;
  }
}
