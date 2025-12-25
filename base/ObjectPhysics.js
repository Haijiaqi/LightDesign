/**
 * ObjectPhysics - 物理约束构建模块
 * 
 * 负责将几何数据翻译为物理引擎可理解的约束。
 * 通过 core 引用访问和修改物理状态。
 * 
 * 职责：
 * 1. 约束工厂（所有 _build...Constraints 方法）
 * 2. 拓扑构建入口（rebuildPhysicsTopology）
 * 3. 辅助功能（fixPoint / unfixPoint）
 * 
 * 设计原则：
 * - ✓ 显式验证所有前提条件（不隐式假设几何完备）
 * - ✓ 可失败的、可诊断的（明确的错误信息）
 * - ✓ 面向未来扩展（hybrid/partial rebuild 安全）
 * 
 * 边界红线：
 * - ✗ 不持有粒子数组的副本（始终操作 core.representation.physicsState）
 * - ✗ 不进行几何算法（如体积、拟合）
 * - ✗ 不尝试修复几何问题（发现问题立即抛出错误）
 * - ✗ 不回退调用 ObjectGeometry（单向依赖）
 */
export class ObjectPhysics {
  /**
   * 构造函数
   * @param {ObjectCore} core - 核心状态容器
   */
  constructor(core) {
    this.core = core;
  }

  // === 物理拓扑构建入口 ===

  /**
   * 重建物理拓扑（唯一合法物理入口）
   * 
   * 清空旧物理数据，重新生成 particles 和 constraints，
   * 强制设置 this.core.mode = 'discrete'，使对象可被物理系统访问。
   * 
   * 支持的类型：cloth, elliptic-fourier-2d, spherical-harmonics, line, points
   * 
   * @param {Object} options
   * @param {Boolean} options.force - 强制重建约束
   * @returns {Object} 重建结果统计
   */
  rebuildPhysicsTopology(options = {}) {
    const force = options.force ?? false;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 前提条件验证（显式化输入要求，拒绝隐式假设）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 1. 检查 surfacePoints 存在且非空
    if (!this.core.surfacePoints) {
      throw new Error(
        `[ObjectPhysics] 前提条件失败：surfacePoints 未定义。\n` +
        `  对象：${this.core.metadata.name}\n` +
        `  原因：几何数据结构不完整\n` +
        `  解决：确保 ObjectCore 正确初始化`
      );
    }

    if (this.core.surfacePoints.length === 0) {
      throw new Error(
        `[ObjectPhysics] 前提条件失败：surfacePoints 为空。\n` +
        `  对象：${this.core.metadata.name}\n` +
        `  原因：未生成几何数据\n` +
        `  解决：先调用几何生成方法\n` +
        `    - generateClothMesh(rows, cols)\n` +
        `    - generateOrganicCloth(boundaryPoints)\n` +
        `    - generateVolumetricMesh(options)`
      );
    }

    // 2. 检查 representation.type 是否为可物理类型
    const type = this.core.representation.type;
    const PHYSICS_COMPATIBLE_TYPES = [
      'cloth',
      'elliptic-fourier-2d',
      'spherical-harmonics',
      'volumetric',
      'line',
      'points'
    ];

    if (!PHYSICS_COMPATIBLE_TYPES.includes(type)) {
      throw new Error(
        `[ObjectPhysics] 前提条件失败：不支持的 representation 类型。\n` +
        `  对象：${this.core.metadata.name}\n` +
        `  当前类型：${type}\n` +
        `  支持类型：${PHYSICS_COMPATIBLE_TYPES.join(', ')}\n` +
        `  原因：该类型无法转换为物理拓扑\n` +
        `  解决：使用支持的几何类型`
      );
    }

    // 3. 检查点结构完整性（验证前几个点）
    const sampleSize = Math.min(3, this.core.surfacePoints.length);
    for (let i = 0; i < sampleSize; i++) {
      const point = this.core.surfacePoints[i];
      if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' || typeof point.z !== 'number') {
        throw new Error(
          `[ObjectPhysics] 前提条件失败：点结构不完整。\n` +
          `  对象：${this.core.metadata.name}\n` +
          `  问题点索引：${i}\n` +
          `  点数据：${JSON.stringify(point)}\n` +
          `  原因：点缺少 x/y/z 坐标\n` +
          `  解决：确保所有点都有有效的 x/y/z 数值坐标`
        );
      }

      // 检查坐标是否为有效数值（非 NaN/Infinity）
      if (!isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
        throw new Error(
          `[ObjectPhysics] 前提条件失败：点坐标包含非法数值。\n` +
          `  对象：${this.core.metadata.name}\n` +
          `  问题点索引：${i}\n` +
          `  坐标：(${point.x}, ${point.y}, ${point.z})\n` +
          `  原因：坐标为 NaN 或 Infinity\n` +
          `  解决：检查几何生成算法，确保坐标计算正确`
        );
      }
    }

    // 4. 检查拓扑数据（对于需要拓扑的类型）
    const needsTopology = ['cloth', 'elliptic-fourier-2d', 'spherical-harmonics', 'volumetric'];
    if (needsTopology.includes(type) && !force) {
      if (!this.core.representation.topology) {
        throw new Error(
          `[ObjectPhysics] 前提条件失败：topology 未定义。\n` +
          `  对象：${this.core.metadata.name}\n` +
          `  类型：${type}\n` +
          `  原因：该类型需要拓扑数据\n` +
          `  解决：确保几何生成方法正确创建了 topology`
        );
      }

      // 如果有拓扑数据，验证其有效性
      if (this.core.representation.topology.triangles && 
          this.core.representation.topology.triangles.length > 0) {
        // 验证三角形索引范围
        const maxIndex = this.core.surfacePoints.length - 1;
        const firstTriangle = this.core.representation.topology.triangles[0];
        
        if (Array.isArray(firstTriangle)) {
          for (let idx of firstTriangle) {
            if (idx < 0 || idx > maxIndex) {
              throw new Error(
                `[ObjectPhysics] 前提条件失败：拓扑索引超出范围。\n` +
                `  对象：${this.core.metadata.name}\n` +
                `  三角形：${JSON.stringify(firstTriangle)}\n` +
                `  索引范围：0-${maxIndex}\n` +
                `  原因：拓扑引用了不存在的点\n` +
                `  解决：重新生成几何和拓扑`
              );
            }
          }
        }
      }
    }

    // 5. 检查 geometry 模块（如果需要材质查询）
    if (!this.core.representation.material.uniform && this.core.representation.material.properties) {
      if (!this.core.geometry) {
        throw new Error(
          `[ObjectPhysics] 前提条件失败：需要 geometry 模块但未初始化。\n` +
          `  对象：${this.core.metadata.name}\n` +
          `  原因：材质非均匀分布，需要通过 geometry.getMaterialAt() 查询\n` +
          `  解决：调用 core.setGeometryModule(new ObjectGeometry(core))`
        );
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 前提条件验证通过，开始构建物理拓扑
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (this.core.verbose) {
      console.log(`[ObjectPhysics] Rebuilding physics topology (type: ${type})`);
    }

    const oldParticleCount = this.core.representation.physicsState?.particles?.length ?? 0;
    const oldConstraintCount = this.core.representation.physicsState?.constraints?.length ?? 0;

    // ⚠️ 关键：保存旧的物理状态（内部粒子数据）
    const oldPhysicsState = this.core.representation.physicsState;
    
    // 清空物理数据
    this.core.representation.physicsState = {
      physicsModel: this.core.physics.model ?? 'pbd',
      particles: [],
      constraints: [],
      surfaceStartIndex: 0,
      internalStartIndex: 0,
      surfaceCount: 0,
      internalCount: 0
    };

    let particles = [];
    let constraints = [];
    const globalMassScale = this.core.physics.mass ?? 1.0;

    if (type === 'cloth' || type === 'elliptic-fourier-2d' || type === 'spherical-harmonics' || type === 'volumetric') {
      
      if (this.core.representation.topology.triangles.length > 0 && !force) {
        const topology = this.core.representation.topology;

        if (this.core._isVolumetric && oldPhysicsState.surfaceCount > 0) {
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // ⭐ 体积网格分支：验证内部粒子数据的可用性
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          
          const surfaceCount = oldPhysicsState.surfaceCount;
          const internalCount = oldPhysicsState.internalCount;

          // 验证 surfaceCount 与当前 surfacePoints 数量一致
          if (surfaceCount !== this.core.surfacePoints.length) {
            throw new Error(
              `[ObjectPhysics] 体积网格数据不一致。\n` +
              `  对象：${this.core.metadata.name}\n` +
              `  oldPhysicsState.surfaceCount：${surfaceCount}\n` +
              `  当前 surfacePoints.length：${this.core.surfacePoints.length}\n` +
              `  原因：几何数据在物理构建后被修改\n` +
              `  解决：使用 force: true 强制完全重建\n` +
              `    obj.rebuildPhysicsTopology({ force: true })`
            );
          }

          // 验证内部粒子数据存在
          if (internalCount > 0) {
            if (!oldPhysicsState.particles || oldPhysicsState.particles.length === 0) {
              throw new Error(
                `[ObjectPhysics] 体积网格内部粒子数据丢失。\n` +
                `  对象：${this.core.metadata.name}\n` +
                `  期望内部粒子数：${internalCount}\n` +
                `  实际粒子数组：${oldPhysicsState.particles ? oldPhysicsState.particles.length : 'undefined'}\n` +
                `  原因：物理状态被意外清空\n` +
                `  解决：使用 force: true 重新生成内部粒子\n` +
                `    obj.rebuildPhysicsTopology({ force: true })`
              );
            }

            const expectedTotalParticles = surfaceCount + internalCount;
            if (oldPhysicsState.particles.length < expectedTotalParticles) {
              throw new Error(
                `[ObjectPhysics] 体积网格粒子数量不足。\n` +
                `  对象：${this.core.metadata.name}\n` +
                `  期望粒子数：${expectedTotalParticles} (${surfaceCount} 表面 + ${internalCount} 内部)\n` +
                `  实际粒子数：${oldPhysicsState.particles.length}\n` +
                `  原因：物理状态数据不完整\n` +
                `  解决：使用 force: true 完全重建`
              );
            }
          }

          const surfaceMass = globalMassScale * 0.6 / surfaceCount;
          const internalMass = globalMassScale * 0.4 / internalCount;

          // 表面粒子
          for (let i = 0; i < surfaceCount; i++) {
            const point = this.core.surfacePoints[i];
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
          const uniformMass = globalMassScale / this.core.surfacePoints.length;

          for (let i = 0; i < this.core.surfacePoints.length; i++) {
            const point = this.core.surfacePoints[i];
            if (!point._physicsData) {
              point._physicsData = {
                position: { x: point.x, y: point.y, z: point.z },
                prevPosition: { x: point.x, y: point.y, z: point.z },
                velocity: { x: 0, y: 0, z: 0 },
                fixed: false
              };
            }

            let particleMass = uniformMass;
            // ⭐ 通过 geometry 获取材质参数（禁止硬编码）
            if (!this.core.representation.material.uniform && this.core.representation.material.properties) {
              const mat = this.core.geometry.getMaterialAt(point);
              if (mat && mat.mass !== undefined) {
                particleMass = mat.mass * globalMassScale / this.core.surfacePoints.length;
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
          this.core.representation.physicsState.particles = particles;
          constraints = this._buildPhysicsConstraints();
        }

      } else {
        // 没有预生成拓扑，简单网格
        const uniformMass = globalMassScale / this.core.surfacePoints.length;

        for (let i = 0; i < this.core.surfacePoints.length; i++) {
          const point = this.core.surfacePoints[i];
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

        this.core.representation.physicsState.particles = particles;
        constraints = this._buildPhysicsConstraints();
      }

    } else if (type === 'line') {
      const uniformMass = globalMassScale / this.core.surfacePoints.length;

      for (let i = 0; i < this.core.surfacePoints.length; i++) {
        const point = this.core.surfacePoints[i];
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
      const uniformMass = globalMassScale / this.core.surfacePoints.length;

      for (let i = 0; i < this.core.surfacePoints.length; i++) {
        const point = this.core.surfacePoints[i];
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
        `[ObjectPhysics] 不支持的 representation 类型：${type}\n` +
        `  支持：cloth, elliptic-fourier-2d, spherical-harmonics, volumetric, line, points`
      );
    }

    // 应用编辑态约束（固定点）
    if (this.core.representation.editState?.constraints) {
      for (const ec of this.core.representation.editState.constraints) {
        if (ec.type === 'fixed') {
          for (const idx of ec.particles) {
            if (idx >= 0 && idx < particles.length) {
              particles[idx].fixed = true;
              particles[idx].invMass = 0;
              if (idx < this.core.surfacePoints.length) {
                this.core.surfacePoints[idx]._physicsData.fixed = true;
              }
            }
          }
        }
      }
    }

    // 更新物理状态
    this.core.representation.physicsState.particles = particles;
    this.core.representation.physicsState.constraints = constraints;
    this.core.representation.physicsState.surfaceCount = this.core.surfacePoints.length;

    // ⚠️ 设置 mode = 'discrete'（唯一入口）
    this.core.mode = 'discrete';

    // 验证约束语义（开发模式）
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
      this._validateConstraintSemantics(constraints);
    }

    if (this.core.verbose) {
      console.log(
        `[ObjectPhysics] Physics rebuilt: ${oldParticleCount}→${particles.length} particles, ` +
        `${oldConstraintCount}→${constraints.length} constraints, mode=${this.core.mode}`
      );
    }

    return {
      particles: particles.length,
      constraints: constraints.length,
      mode: this.core.mode,
      type: this.core.representation.type,
      isVolumetric: this.core._isVolumetric
    };
  }

  // === 约束工厂 ===

  /**
   * 构建物理约束（通用）
   * 
   * 基于拓扑边生成距离约束或弹簧约束
   * ⭐ 通过 core.geometry.getMaterialAt 获取材质参数
   * 
   * @private
   * @returns {Array} 约束数组
   */
  /**
   * 构建物理约束（通用约束工厂）
   * 
   * XPBD 优化策略：
   * 1. 分类生成：structural → shear → bending
   * 2. 权重归一化：根据网格密度调整 compliance
   * 3. 优先级标记：constraintPriority 字段
   * 
   * @private
   * @returns {Array} 约束数组（按优先级排序）
   */
  _buildPhysicsConstraints() {
    const constraints = [];
    
    if (this.core.representation.topology.edges.length === 0) {
      console.warn('[ObjectPhysics] No topology available for physics constraints.');
      return constraints;
    }

    const { edges, triangles } = this.core.representation.topology;
    const physicsModel = this.core.physics.model || 'pbd';
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 网格密度分析（用于权重归一化）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    let avgEdgeLength = 0;
    for (const [i, j] of edges) {
      const p1 = this.core.surfacePoints[i];
      const p2 = this.core.surfacePoints[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      avgEdgeLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    avgEdgeLength /= edges.length;
    
    // 网格密度因子（边长越短，密度越高）
    // 高密度网格需要更软的约束以避免过约束
    const densityFactor = Math.max(0.1, Math.min(1.0, avgEdgeLength / 0.1));
    
    if (this.core.verbose) {
      console.log(`[ObjectPhysics] Mesh density: avgEdgeLength=${avgEdgeLength.toFixed(4)}, densityFactor=${densityFactor.toFixed(3)}`);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 阶段 1: 结构约束（Structural - 最高优先级）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const structuralConstraints = [];
    
    for (const [i, j] of edges) {
      const p1 = this.core.surfacePoints[i];
      const p2 = this.core.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      // ⭐ 从 geometry 获取材质参数（禁止硬编码）
      if (!this.core.representation.material.uniform) {
        const mat1 = this.core.geometry.getMaterialAt(p1);
        const mat2 = this.core.geometry.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const baseCompliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        // ⭐ 权重归一化：高密度网格使用更软的约束
        const normalizedCompliance = baseCompliance * densityFactor;
        
        structuralConstraints.push({
          type: 'distance',
          constraintCategory: 'structural',  // ⭐ 明确分类
          constraintPriority: 1,             // ⭐ 最高优先级
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          compliance: normalizedCompliance
        });
      } else if (physicsModel === 'force') {
        structuralConstraints.push({
          type: 'spring',
          constraintCategory: 'structural',
          constraintPriority: 1,
          i, j,
          particles: [i, j],
          restLength,
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 阶段 2: 剪切约束（Shear - 中等优先级）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const shearConstraints = [];
    
    if (triangles && triangles.length > 0) {
      // 从三角形提取对角线（剪切约束）
      const diagonals = new Set();
      
      for (const triangle of triangles) {
        const [a, b, c] = triangle;
        
        // 三角形的三条边已经在结构约束中
        // 这里只添加额外的对角线（如果有四边形拓扑）
        // 注：对于纯三角网格，剪切约束可能较少
      }
      
      // 对于规则网格，可以添加显式的剪切约束
      // 这里简化处理：剪切刚度为结构的 50%
      for (const [i, j] of edges) {
        // 检查是否存在共同邻居（形成四边形）
        // 简化：跳过，剪切约束在规则布料中更明显
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 阶段 3: 弯曲约束（Bending - 最低优先级）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const bendingConstraints = [];
    
    if (triangles && triangles.length > 0) {
      // 基于二面角的弯曲约束
      const edgeMap = new Map();
      
      // 构建边 → 三角形映射
      for (let triIdx = 0; triIdx < triangles.length; triIdx++) {
        const [a, b, c] = triangles[triIdx];
        const edges_in_tri = [
          [Math.min(a, b), Math.max(a, b)],
          [Math.min(b, c), Math.max(b, c)],
          [Math.min(c, a), Math.max(c, a)]
        ];
        
        for (const edge of edges_in_tri) {
          const key = `${edge[0]},${edge[1]}`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, []);
          }
          edgeMap.get(key).push({ triIdx, vertices: [a, b, c] });
        }
      }
      
      // 为共享边的三角形对添加弯曲约束
      for (const [edgeKey, tris] of edgeMap) {
        if (tris.length === 2) {
          const [i, j] = edgeKey.split(',').map(Number);
          const tri1 = tris[0].vertices;
          const tri2 = tris[1].vertices;
          
          // 找到非共享顶点
          const k = tri1.find(v => v !== i && v !== j);
          const l = tri2.find(v => v !== i && v !== j);
          
          if (k !== undefined && l !== undefined) {
            if (physicsModel === 'pbd') {
              // ⭐ 自适应弯曲刚度：密度越高，刚度越低
              const baseBendingCompliance = 0.01;  // 基准值
              const normalizedBendingCompliance = baseBendingCompliance * Math.pow(densityFactor, 2);
              
              bendingConstraints.push({
                type: 'bending',
                constraintCategory: 'bending',
                constraintPriority: 3,  // ⭐ 最低优先级
                particles: [i, j, k, l],
                compliance: normalizedBendingCompliance
              });
            } else if (physicsModel === 'force') {
              // Force 模式：使用弹簧近似
              const pk = this.core.surfacePoints[k];
              const pl = this.core.surfacePoints[l];
              const dx = pl.x - pk.x;
              const dy = pl.y - pk.y;
              const dz = pl.z - pk.z;
              const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
              
              bendingConstraints.push({
                type: 'spring',
                constraintCategory: 'bending',
                constraintPriority: 3,
                i: k, j: l,
                particles: [k, l],
                restLength,
                stiffness: 50 * densityFactor,  // ⭐ 密度调整
                damping: 5
              });
            }
          }
        }
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 组装约束数组（按优先级排序）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const allConstraints = [
      ...structuralConstraints,  // Priority 1
      ...shearConstraints,       // Priority 2
      ...bendingConstraints      // Priority 3
    ];
    
    if (this.core.verbose) {
      console.log(
        `[ObjectPhysics] Constraints generated: ` +
        `${structuralConstraints.length} structural, ` +
        `${shearConstraints.length} shear, ` +
        `${bendingConstraints.length} bending`
      );
    }
    
    return allConstraints;
  }

  /**
   * 构建线约束（结构 + 弯曲）
   * 
   * XPBD 优化：
   * 1. 明确约束优先级
   * 2. 密度自适应 compliance
   * 
   * @private
   * @returns {Array} 约束数组
   */
  _buildLineConstraints() {
    const constraints = [];
    const { edges } = this.core.representation.topology;
    const physicsModel = this.core.physics.model || 'pbd';
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 网格密度分析
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    let avgEdgeLength = 0;
    for (const [i, j] of edges) {
      const p1 = this.core.surfacePoints[i];
      const p2 = this.core.surfacePoints[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      avgEdgeLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    avgEdgeLength /= edges.length;
    
    const densityFactor = Math.max(0.1, Math.min(1.0, avgEdgeLength / 0.1));
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 阶段 1: 结构约束（沿着边）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    for (const [i, j] of edges) {
      const p1 = this.core.surfacePoints[i];
      const p2 = this.core.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      // ⭐ 从 geometry 获取材质参数
      if (!this.core.representation.material.uniform) {
        const mat1 = this.core.geometry.getMaterialAt(p1);
        const mat2 = this.core.geometry.getMaterialAt(p2);
        avgStiffness = (mat1.stiffness + mat2.stiffness) / 2;
        avgDamping = (mat1.damping + mat2.damping) / 2;
      }
      
      if (physicsModel === 'pbd') {
        const baseCompliance = avgStiffness > 0 ? 1 / avgStiffness : 0;
        const normalizedCompliance = baseCompliance * densityFactor;
        
        constraints.push({
          type: 'distance',
          constraintCategory: 'structural',
          constraintPriority: 1,
          i, j,
          particles: [i, j],
          restLength,
          distance: restLength,
          edgeType: 'structural',
          compliance: normalizedCompliance
        });
      } else if (physicsModel === 'force') {
        constraints.push({
          type: 'spring',
          constraintCategory: 'structural',
          constraintPriority: 1,
          i, j,
          particles: [i, j],
          restLength,
          edgeType: 'structural',
          stiffness: avgStiffness,
          damping: avgDamping
        });
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 阶段 2: 弯曲约束（三点角度）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    for (let i = 0; i < this.core.surfacePoints.length - 2; i++) {
      const p0 = this.core.surfacePoints[i];
      const p1 = this.core.surfacePoints[i + 1];
      const p2 = this.core.surfacePoints[i + 2];
      
      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      
      const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
      const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
      
      if (mag1 > 1e-6 && mag2 > 1e-6) {
        const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
        const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        if (physicsModel === 'pbd') {
          // ⭐ 自适应弯曲刚度
          const baseBendingCompliance = 0.01;
          const normalizedBendingCompliance = baseBendingCompliance * Math.pow(densityFactor, 2);
          
          constraints.push({
            type: 'line_bending',
            constraintCategory: 'bending',
            constraintPriority: 3,
            particles: [i, i + 1, i + 2],
            restAngle,
            compliance: normalizedBendingCompliance
          });
        } else if (physicsModel === 'force') {
          const dx = p2.x - p0.x;
          const dy = p2.y - p0.y;
          const dz = p2.z - p0.z;
          const bendRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          constraints.push({
            type: 'spring',
            constraintCategory: 'bending',
            constraintPriority: 3,
            i: i, j: i + 2,
            particles: [i, i + 2],
            restLength: bendRestLength,
            edgeType: 'bending',
            stiffness: 50 * densityFactor,
            damping: 5
          });
        }
      }
    }
    
    // 闭合线的额外弯曲约束
    if (this.core.representation.isClosed && this.core.surfacePoints.length > 2) {
      const n = this.core.surfacePoints.length;
      
      // 弯曲约束 1: [n-2, n-1, 0]
      {
        const p0 = this.core.surfacePoints[n - 2];
        const p1 = this.core.surfacePoints[n - 1];
        const p2 = this.core.surfacePoints[0];
        
        const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
        const v2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
        
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
        
        if (mag1 > 1e-6 && mag2 > 1e-6) {
          const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
          const restAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
          
          if (physicsModel === 'pbd') {
            const baseBendingCompliance = 0.01;
            const normalizedBendingCompliance = baseBendingCompliance * Math.pow(densityFactor, 2);
            
            constraints.push({
              type: 'line_bending',
              constraintCategory: 'bending',
              constraintPriority: 3,
              particles: [n - 2, n - 1, 0],
              restAngle,
              compliance: normalizedBendingCompliance
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
      
      // 弯曲约束 2: [n-1, 0, 1]
      {
        const p0 = this.core.surfacePoints[n - 1];
        const p1 = this.core.surfacePoints[0];
        const p2 = this.core.surfacePoints[1];
        
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

  /**
   * 从边构建线约束（用于显式边列表）
   * 
   * @private
   * @param {Array} edges - 边列表 [[i,j], ...]
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束数组
   */
  _buildLineConstraintsFromEdges(edges, physicsModel) {
    const constraints = [];
    
    for (const [i, j] of edges) {
      const p1 = this.core.surfacePoints[i];
      const p2 = this.core.surfacePoints[j];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      let avgStiffness = 1000;
      let avgDamping = 10;
      
      // ⭐ 从 geometry 获取材质参数
      if (!this.core.representation.material.uniform) {
        const mat1 = this.core.geometry.getMaterialAt(p1);
        const mat2 = this.core.geometry.getMaterialAt(p2);
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
    
    // 复用 _buildLineConstraints 来添加弯曲约束
    const tempTopology = this.core.representation.topology;
    this.core.representation.topology = { edges };
    const allConstraints = this._buildLineConstraints();
    this.core.representation.topology = tempTopology;
    
    for (const c of allConstraints) {
      if (c.type === 'line_bending' || (c.type === 'spring' && c.edgeType === 'bending')) {
        constraints.push(c);
      }
    }
    
    return constraints;
  }

  /**
   * 构建线邻接关系
   * 
   * @private
   * @param {Array} edges - 边列表
   * @param {Number} vertexCount - 顶点数
   * @returns {Map} 邻接表
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

  // === 固定点管理 ===

  /**
   * 固定点（设置为不可移动）
   * 
   * @param {Number} index - 点索引
   */
  fixPoint(index) {
    if (index < 0 || index >= this.core.surfacePoints.length) {
      throw new Error('[ObjectPhysics] Invalid point index');
    }

    const point = this.core.surfacePoints[index];
    if (point._physicsData) {
      point._physicsData.fixed = true;
    }

    // 如果是布料且有编辑状态，记录到编辑约束
    if (this.core.representation.type === 'cloth' && this.core.representation.editState) {
      let fixedConstraint = this.core.representation.editState.constraints.find(c => c.type === 'fixed');
      
      if (!fixedConstraint) {
        fixedConstraint = {
          type: 'fixed',
          particles: []
        };
        this.core.representation.editState.constraints.push(fixedConstraint);
      }
      
      if (!fixedConstraint.particles.includes(index)) {
        fixedConstraint.particles.push(index);
      }
    }
  }

  /**
   * 解除固定点
   * 
   * @param {Number} index - 点索引
   */
  unfixPoint(index) {
    if (index < 0 || index >= this.core.surfacePoints.length) {
      throw new Error('[ObjectPhysics] Invalid point index');
    }

    const point = this.core.surfacePoints[index];
    if (point._physicsData) {
      point._physicsData.fixed = false;
    }

    // 如果是布料且有编辑状态，从编辑约束中移除
    if (this.core.representation.type === 'cloth' && this.core.representation.editState) {
      const fixedConstraint = this.core.representation.editState.constraints.find(c => c.type === 'fixed');
      
      if (fixedConstraint) {
        const idx = fixedConstraint.particles.indexOf(index);
        if (idx !== -1) {
          fixedConstraint.particles.splice(idx, 1);
        }
        
        // 如果没有固定点了，移除整个约束
        if (fixedConstraint.particles.length === 0) {
          const constraintIdx = this.core.representation.editState.constraints.indexOf(fixedConstraint);
          this.core.representation.editState.constraints.splice(constraintIdx, 1);
        }
      }
    }
  }

  // === 碰撞体管理 ===

  /**
   * 设置碰撞体
   * 
   * @param {Object} collider - 碰撞体对象（需要 containsPoint 方法）
   */
  setCollider(collider) {
    if (!collider.containsPoint || typeof collider.containsPoint !== 'function') {
      throw new Error('[ObjectPhysics] Collider must have containsPoint(x, y, z) method');
    }
    this.core.physics.collider = collider;
  }

  // === 验证 ===

  /**
   * 验证约束语义（开发模式）
   * 
   * 检查约束是否符合物理模型的语义要求：
   * - distance 约束不能有 stiffness/damping
   * - spring 约束不能有 compliance
   * - 同一条边不能同时有 distance 和 spring 约束
   * 
   * @private
   * @param {Array} constraints - 约束数组
   */
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
    
    // 检查边冲突
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
      console.error('[ObjectPhysics] Constraint semantic validation failed:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      throw new Error(`[ObjectPhysics] Found ${errors.length} constraint semantic errors`);
    }
  }
}
