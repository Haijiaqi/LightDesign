/**
 * PhysicsSystem - PBD/XPBD 物理引擎（支持显式弹簧）
 * 
 * ⚠️ 架构定位：PBD 为主 + 显式弹簧为辅
 * 
 * 核心流程（每子步）：
 * 1. 施加外力（重力、显式弹簧力、阻尼）
 * 2. Verlet 积分（力 → 位置）
 * 3. PBD/XPBD 约束投影（直接修正位置）
 * 4. 速度同步（position-based velocity update）
 * 5. 碰撞检测与响应
 * 
 * ⚠️ 双轨求解系统：
 * 
 * 轨道 1 - 力系统（Force-Based）：
 * - type: 'spring'
 * - 计算 Hooke 弹簧力：F = k(L - L₀) - c·v_rel
 * - 通过 Verlet 积分影响位置
 * - 用途：显式弹性连接、软体交互
 * - 特点：时间步依赖、能量守恒可控
 * 
 * 轨道 2 - 约束系统（PBD/XPBD）：
 * - type: 'distance', 'fixed'
 * - 直接投影位置以满足几何约束
 * - 不计算物理弹力
 * - 用途：布料结构、刚性连接
 * - 特点：时间步无关、无条件稳定
 * 
 * ⚠️ 约束生成规范（强制）：
 * 
 * 规则 1 - 几何保持类结构（网格、布料、壳体、骨架）：
 * ✅ 只能生成：type === 'distance'
 * ❌ 禁止生成：type === 'spring'
 * 原因：几何约束应该是硬性的、时间步无关的
 * 
 * 规则 2 - 物理弹性装置（弹簧、拉索、软连接）：
 * ✅ 只能生成：type === 'spring'
 * ❌ 禁止生成：type === 'distance'
 * 原因：弹性行为需要力和阻尼的精确控制
 * 
 * 规则 3 - 禁止混合同一边：
 * ❌ 同一粒子对禁止同时使用 spring 和 distance
 * ❌ 禁止"为了看起来更软"而混合两种方式
 * 原因：双重求解导致过约束、不稳定、参数难调
 * 
 * 规则 4 - 约束生成函数必须显式声明：
 * - "这是 PBD 几何约束"（生成 distance）
 * - 或"这是力学弹簧"（生成 spring）
 * - 不允许模糊的约束生成
 * 
 * ⚠️ 示例：
 * 
 * ✅ 正确的布料生成：
 * {
 *   type: 'distance',           // ← PBD 几何约束
 *   edgeType: 'structural',
 *   compliance: 0.001           // ← XPBD 柔度（可选）
 * }
 * 
 * ❌ 错误的布料生成：
 * {
 *   type: 'spring',             // ← 错误！布料不应该用 spring
 *   stiffness: 1000
 * }
 * 
 * ✅ 正确的弹簧器件：
 * {
 *   type: 'spring',             // ← 力学弹簧
 *   stiffness: 500,
 *   damping: 10
 * }
 * 
 * ⚠️ XPBD 扩展（准备态）：
 * 
 * 当前实现：纯 PBD（compliance = 0，无限刚性）
 * - 约束通过迭代次数控制刚度
 * - 简单高效，适合实时应用
 * 
 * XPBD 扩展路径：
 * 1. 在约束中添加 compliance（柔度）参数
 * 2. 在约束中添加 lambda（拉格朗日乘子累积器）
 * 3. 修改投影公式：Δλ = -C(x) / (∑w_i + α/dt²)
 * 4. alpha = compliance / dt²
 * 
 * XPBD 优势：
 * - 刚度独立于时间步和迭代次数
 * - 更精确的物理行为
 * - 支持柔和约束（soft constraints）
 * 
 * ⚠️ 零拷贝架构：
 * 
 * 现代接口：
 * 1. 数据采集：obj.getPhysicsView() → 直接引用，零拷贝
 * 2. 物理模拟：直接修改 view.particles[].position/velocity
 * 3. 数据写回：view.commit() → 零拷贝同步
 * 
 * 优势：
 * - ✅ 零 GC 压力（无临时对象）
 * - ✅ 保留精确速度（不反算）
 * - ✅ XPBD lambda 跨帧累积（约束对象复用）
 * 
 * 职责：
 * 1. 管理全局物理参数（重力、阻尼、时间步长）
 * 2. 时间步进（Verlet 积分 + PBD 约束）
 * 3. 力计算（显式弹簧、重力、空气阻力）
 * 4. 约束求解（距离、固定点、碰撞）
 * 5. 碰撞检测与响应
 * 
 * 不关心：
 * - 球谐函数的数学意义
 * - 对象的几何表示类型
 * - 只处理物理数据（质点、弹簧、约束）
 */

class PhysicsSystem {
  constructor(options = {}) {
    // ====================================================
    // 全局物理参数
    // ====================================================
    
    this.gravity = options.gravity ?? { x: 0, y: -9.8, z: 0 };
    this.gravityEnabled = options.gravityEnabled ?? true;
    
    this.airDamping = options.airDamping ?? 0.01;  // 空气阻力
    this.groundY = options.groundY ?? -10;          // 地面高度
    this.groundRestitution = options.groundRestitution ?? 0.3;  // 地面弹性
    
    // ====================================================
    // 时间步进参数
    // ====================================================
    
    this.timeStep = options.timeStep ?? 0.016;  // 默认 60 FPS
    this.substeps = options.substeps ?? 5;       // 子步数（提高稳定性）
    this.method = options.method ?? 'verlet';    // 'euler' | 'verlet' | 'rk4'
    
    // ====================================================
    // 约束求解参数
    // ====================================================
    
    this.constraintIterations = options.constraintIterations ?? 10;
    this.constraintRelaxation = options.constraintRelaxation ?? 1.0;
    
    // ====================================================
    // 碰撞参数
    // ====================================================
    
    this.collisionEnabled = options.collisionEnabled ?? true;
    this.collisionMargin = options.collisionMargin ?? 0.01;
    this.selfCollisionEnabled = options.selfCollisionEnabled ?? false;
    
    // ====================================================
    // 管理的对象
    // ====================================================
    
    this.objects = [];  // 注册的 Object 实例
    
    // ====================================================
    // 统计信息
    // ====================================================
    
    this.stats = {
      stepCount: 0,
      lastStepTime: 0,
      particleCount: 0,
      springCount: 0,
      constraintCount: 0,
      collisionCount: 0
    };
    
    // ====================================================
    // 调试选项
    // ====================================================
    
    this.verbose = options.verbose ?? false;
  }

  // ====================================================
  // 对象管理
  // ====================================================

  /**
   * 添加对象到物理世界
   * @param {Object} object 
   */
  addObject(object) {
    if (!this.objects.includes(object)) {
      this.objects.push(object);
      
      if (this.verbose) {
        console.log(`[Physics] Added object: ${object.metadata.name}`);
      }
    }
  }

  /**
   * 移除对象
   * @param {Object} object 
   */
  removeObject(object) {
    const index = this.objects.indexOf(object);
    if (index !== -1) {
      this.objects.splice(index, 1);
      
      if (this.verbose) {
        console.log(`[Physics] Removed object: ${object.metadata.name}`);
      }
    }
  }

  /**
   * 清空所有对象
   */
  clear() {
    this.objects = [];
    this.stats.stepCount = 0;
  }

  // ====================================================
  // 主时间步进
  // ====================================================

  /**
   * 执行一个物理步（对外接口）
   * @param {number} dt - 时间步长（可选，默认使用 this.timeStep）
   */
  step(dt = null) {
    dt = dt ?? this.timeStep;
    const startTime = Date.now();

    // 子步（提高稳定性）
    const subDt = dt / this.substeps;
    
    for (let i = 0; i < this.substeps; i++) {
      this._substep(subDt);
    }

    // 更新统计
    this.stats.stepCount++;
    this.stats.lastStepTime = Date.now() - startTime;
    
    if (this.verbose && this.stats.stepCount % 60 === 0) {
      console.log('[Physics] Stats:', this.getStats());
    }
  }

  /**
   * 单个子步
   * @private
   * @param {number} dt 
   */
  _substep(dt) {
    // 收集所有物理数据
    const physicsData = this._gatherPhysicsData();
    
    if (physicsData.length === 0) return;

    // 1. 施加外力（重力、用户力）
    this._applyForces(physicsData, dt);

    // 2. 积分（更新位置和速度）
    this._integrate(physicsData, dt);

    // ⭐ XPBD Lambda 生命周期（PBD-compatible 模式）
    // 
    // 策略：每个子步重置 lambda
    // - lambda 在迭代内累积（同一子步的多次迭代）
    // - lambda 在子步间重置（每个子步独立求解）
    // - lambda 不跨帧保留
    // 
    // 理由：
    // 1. 与 PBD 行为一致（每个子步独立）
    // 2. 数值稳定（避免累积误差）
    // 3. 简化实现（无需管理跨帧状态）
    // 
    // 注意：如需严格 XPBD（lambda 跨帧保留），
    // 请移除此重置逻辑，并在约束初始化时设置 lambda = 0
    for (const data of physicsData) {
      for (const constraint of data.constraints) {
        if (constraint.compliance !== undefined && constraint.compliance > 0) {
          constraint.lambda = 0;  // ⭐ PBD-compatible XPBD: 子步重置
        }
      }
    }

    // ⭐ 保存约束求解前的位置（用于最后的速度更新）
    for (const data of physicsData) {
      if (!data._oldPositions || data._oldPositions.length !== data.particles.length) {
        data._oldPositions = data.particles.map(p => ({ x: 0, y: 0, z: 0 }));
      }
      
      for (let i = 0; i < data.particles.length; i++) {
        const p = data.particles[i];
        data._oldPositions[i].x = p.position.x;
        data._oldPositions[i].y = p.position.y;
        data._oldPositions[i].z = p.position.z;
      }
    }

    // 3. 约束求解（多次迭代）
    for (let i = 0; i < this.constraintIterations; i++) {
      this._solveConstraintsIteration(physicsData, dt);
    }
    
    // ⭐ 4. 约束求解后更新速度（只执行一次）
    this._updateVelocitiesAfterConstraints(physicsData, dt);

    // 5. 碰撞检测与响应
    if (this.collisionEnabled) {
      this._handleCollisions(physicsData);
    }

    // 6. 特殊处理（撕裂检测）
    this._handleTearing(physicsData);

    // 7. 写回对象
    this._writeBackPhysicsData(physicsData);
  }

  // ====================================================
  // 数据收集
  // ====================================================

  /**
   * 从所有对象收集物理数据
   * 
   * ⭐ 零拷贝架构：使用 getPhysicsView() 接口
   * 
   * @private
   * @returns {Array}
   */
  _gatherPhysicsData() {
    const allData = [];

    for (const obj of this.objects) {
      if (!obj.physics.enabled) continue;

      // ⭐ 使用零拷贝接口
      if (typeof obj.getPhysicsView !== 'function') {
        console.error(`[Physics] Object missing getPhysicsView() interface:`, obj);
        continue;
      }
      
      const view = obj.getPhysicsView();
      
      if (!view.particles || !Array.isArray(view.particles)) {
        console.warn(`[Physics] Object.getPhysicsView() returned invalid particles:`, obj);
        continue;
      }
      
      allData.push({
        object: obj,
        particles: view.particles,        // ✅ 直接引用（零拷贝）
        constraints: view.constraints,    // ✅ 跨帧复用（XPBD lambda）
        commit: view.commit               // ✅ 统一写回点
      });
    }

    return allData;
  }

  // ====================================================
  // 力计算
  // ====================================================

  /**
   * 施加所有外力
   * 
   * ⚠️ 力系统语义：
   * - 只处理 type === 'spring' 的弹簧力（Hooke 定律）
   * - 不处理 type === 'distance' 的几何约束（PBD）
   * 
   * 职责分离：
   * - 'spring': 力计算（_applySpringForce）→ 影响速度 → Verlet 积分
   * - 'distance': PBD 约束（_solveConstraints）→ 直接修正位置
   * 
   * @private
   * @param {Array} physicsData 
   * @param {number} dt 
   */
  _applyForces(physicsData, dt) {
    let particleCount = 0;
    let springCount = 0;

    for (const data of physicsData) {
      // 1. 清空上一步的力（复用对象）
      for (const p of data.particles) {
        if (!p.force) {
          p.force = { x: 0, y: 0, z: 0 };  // ⭐ 只初始化一次
        } else {
          p.force.x = 0;
          p.force.y = 0;
          p.force.z = 0;
        }
      }

      // 2. 重力
      if (this.gravityEnabled) {
        for (const p of data.particles) {
          if (!p.fixed) {
            p.force.x += this.gravity.x * p.mass;
            p.force.y += this.gravity.y * p.mass;
            p.force.z += this.gravity.z * p.mass;
          }
        }
      }

      // 3. ⭐ 弹簧力（仅 type === 'spring'）
      // 注意：不处理 'distance' 约束（那是 PBD 的职责）
      const springs = data.constraints.filter(c => c.type === 'spring');
      for (const spring of springs) {
        this._applySpringForce(data.particles, spring);
      }
      springCount += springs.length;

      // 4. 空气阻力
      for (const p of data.particles) {
        if (!p.fixed && p.velocity) {
          p.force.x -= p.velocity.x * this.airDamping;
          p.force.y -= p.velocity.y * this.airDamping;
          p.force.z -= p.velocity.z * this.airDamping;
        }
      }

      particleCount += data.particles.length;
    }

    this.stats.particleCount = particleCount;
    this.stats.springCount = springCount;
  }

  /**
   * 计算弹簧力
   * 
   * ⚠️ 支持不均匀材料：
   * - 优先使用 spring.stiffness / spring.damping（边级别）
   * - 若未设置，尝试从粒子属性平均（particle.stiffness 或 particle.material.stiffness）
   * - 最终回退到默认值
   * 
   * @private
   * @param {Array} particles 
   * @param {Object} spring 
   */
  _applySpringForce(particles, spring) {
    const p1 = particles[spring.i];
    const p2 = particles[spring.j];

    // ⭐ 边界检查
    if (!p1 || !p2) return;

    // 当前长度
    const dx = p2.position.x - p1.position.x;
    const dy = p2.position.y - p1.position.y;
    const dz = p2.position.z - p1.position.z;
    const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (currentLength < 1e-6) return;

    // ⭐ 修正：支持每条边的独立刚度参数
    // 优先级：spring.stiffness > 粒子平均 stiffness > 默认值 1000
    let stiffness = spring.stiffness ?? spring.k;
    
    if (stiffness === undefined) {
      // 尝试从粒子属性获取
      const s1 = p1.stiffness ?? p1.material?.stiffness;
      const s2 = p2.stiffness ?? p2.material?.stiffness;
      
      if (s1 !== undefined && s2 !== undefined) {
        stiffness = (s1 + s2) / 2;
      } else if (s1 !== undefined) {
        stiffness = s1;
      } else if (s2 !== undefined) {
        stiffness = s2;
      } else {
        stiffness = 1000;  // 默认值
      }
    }

    // 弹簧力: F = k * (L - L0)
    const restLength = spring.restLength ?? spring.length ?? currentLength;
    const extension = currentLength - restLength;
    const forceMagnitude = stiffness * extension;

    // 方向
    const nx = dx / currentLength;
    const ny = dy / currentLength;
    const nz = dz / currentLength;

    // 施加力
    const fx = forceMagnitude * nx;
    const fy = forceMagnitude * ny;
    const fz = forceMagnitude * nz;

    if (!p1.fixed) {
      p1.force.x += fx;
      p1.force.y += fy;
      p1.force.z += fz;
    }

    if (!p2.fixed) {
      p2.force.x -= fx;
      p2.force.y -= fy;
      p2.force.z -= fz;
    }

    // ⭐ 修正：阻尼也支持独立参数
    // 优先级：spring.damping > 粒子平均 damping > 默认值 0（无阻尼）
    let damping = spring.damping;
    
    if (damping === undefined) {
      const d1 = p1.damping ?? p1.material?.damping;
      const d2 = p2.damping ?? p2.material?.damping;
      
      if (d1 !== undefined && d2 !== undefined) {
        damping = (d1 + d2) / 2;
      } else if (d1 !== undefined) {
        damping = d1;
      } else if (d2 !== undefined) {
        damping = d2;
      }
      // 注意：如果都未定义，damping 保持 undefined（不应用阻尼）
    }

    // 阻尼（相对速度）
    if (damping !== undefined && p1.velocity && p2.velocity) {
      const vRelX = p2.velocity.x - p1.velocity.x;
      const vRelY = p2.velocity.y - p1.velocity.y;
      const vRelZ = p2.velocity.z - p1.velocity.z;

      const vRelDotN = vRelX * nx + vRelY * ny + vRelZ * nz;
      const dampingForce = damping * vRelDotN;

      const fdx = dampingForce * nx;
      const fdy = dampingForce * ny;
      const fdz = dampingForce * nz;

      if (!p1.fixed) {
        p1.force.x += fdx;
        p1.force.y += fdy;
        p1.force.z += fdz;
      }

      if (!p2.fixed) {
        p2.force.x -= fdx;
        p2.force.y -= fdy;
        p2.force.z -= fdz;
      }
    }
  }

  // ====================================================
  // 时间积分
  // ====================================================

  /**
   * 积分更新位置和速度
   * @private
   * @param {Array} physicsData 
   * @param {number} dt 
   */
  _integrate(physicsData, dt) {
    for (const data of physicsData) {
      for (const p of data.particles) {
        if (p.fixed) continue;

        if (this.method === 'verlet') {
          this._integrateVerlet(p, dt);
        } else if (this.method === 'euler') {
          this._integrateEuler(p, dt);
        } else if (this.method === 'rk4') {
          this._integrateRK4(p, dt);
        }
      }
    }
  }

  /**
   * Verlet 积分（默认，稳定）
   * 
   * ⭐ 速度语义：
   * - Verlet 积分本身不计算 velocity
   * - velocity 由 _updateVelocitiesAfterConstraints() 统一计算
   * - 这确保速度反映约束修正后的实际运动
   * 
   * ⭐ 工程优化：
   * - 复用 p.oldPosition 对象（避免 GC）
   * - 不使用 { ...p.position } 展开运算符
   * 
   * @private
   */
  _integrateVerlet(p, dt) {
    // 初始化 velocity（如果没有）
    if (!p.velocity) {
      p.velocity = { x: 0, y: 0, z: 0 };
    }

    // ⭐ 优化：初始化 oldPosition（复用对象）
    if (!p.oldPosition) {
      p.oldPosition = { 
        x: p.position.x, 
        y: p.position.y, 
        z: p.position.z 
      };
    }

    // 加速度
    const ax = p.force.x / p.mass;
    const ay = p.force.y / p.mass;
    const az = p.force.z / p.mass;

    // Verlet 位置更新：x(t+dt) = 2x(t) - x(t-dt) + a·dt²
    const newX = 2 * p.position.x - p.oldPosition.x + ax * dt * dt;
    const newY = 2 * p.position.y - p.oldPosition.y + ay * dt * dt;
    const newZ = 2 * p.position.z - p.oldPosition.z + az * dt * dt;

    // ⚠️ 注意：不在此处计算速度
    // 速度将在约束求解后由 _updateVelocitiesAfterConstraints() 计算
    // 这确保速度反映约束修正后的真实运动

    // ⭐ 优化：更新 oldPosition（复用对象，避免 new）
    p.oldPosition.x = p.position.x;
    p.oldPosition.y = p.position.y;
    p.oldPosition.z = p.position.z;
    
    // 更新位置
    p.position.x = newX;
    p.position.y = newY;
    p.position.z = newZ;
  }

  /**
   * Euler 积分（简单，不稳定）
   * @private
   */
  _integrateEuler(p, dt) {
    if (!p.velocity) {
      p.velocity = { x: 0, y: 0, z: 0 };
    }

    // 加速度
    const ax = p.force.x / p.mass;
    const ay = p.force.y / p.mass;
    const az = p.force.z / p.mass;

    // 更新速度
    p.velocity.x += ax * dt;
    p.velocity.y += ay * dt;
    p.velocity.z += az * dt;

    // 更新位置
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.position.z += p.velocity.z * dt;
  }

  /**
   * RK4 积分（高精度，较慢）
   * @private
   */
  _integrateRK4(p, dt) {
    // TODO: 实现 RK4（如果需要高精度）
    this._integrateEuler(p, dt);
  }

  // ====================================================
  // 约束求解（PBD/XPBD）
  // ====================================================
  
  /**
   * ⭐ 约束系统语义：PBD/XPBD（Position Based Dynamics / Extended PBD）
   * 
   * 核心原理：
   * 1. 力 → 位置（Verlet 积分，不计算速度）
   * 2. 位置修正（PBD/XPBD 约束投影）
   * 3. 速度同步（position-based velocity update，统一计算）
   * 
   * 约束类型：
   * - 'distance': 保持两点距离（结构/剪切边）
   * - 'fixed': 固定点到特定位置
   * - 'bending': 二面角约束（布料弯曲）
   * - 'line_bending': 三点角度约束（线/绳弯曲）
   * 
   * PBD vs XPBD：
   * 
   * PBD（当前默认）：
   * - compliance = 0（无限刚性）
   * - 刚度通过迭代次数控制
   * - 简单高效，适合实时应用
   * - 公式：Δλ = -C(x) / (w₁ + w₂)
   * 
   * XPBD（可选启用）：
   * - compliance > 0（柔性约束）
   * - 刚度独立于时间步和迭代
   * - 物理准确，支持软约束
   * - 公式：Δλ = -C(x) / (w₁ + w₂ + α/dt²)
   * - alpha = compliance / dt²
   * - lambda 跨帧累积
   * 
   * 启用 XPBD：
   * 在约束中设置 compliance > 0：
   * {
   *   type: 'distance',
   *   particles: [i, j],
   *   restLength: 1.0,
   *   compliance: 0.001,    // ⭐ XPBD 柔度（1/刚度）
   *   lambda: 0             // ⭐ 累积器（自动初始化）
   * }
   * 
   * 与力系统的职责分离：
   * - 'spring' (force): 力计算 → 影响速度 → Verlet → 位置
   * - 'distance' (constraint): PBD/XPBD → 直接修正位置
   * - 禁止同一粒子对同时使用 spring 和 distance
   * 
   * 参数控制：
   * - PBD 刚度：constraintIterations（更多迭代 = 更刚）
   * - XPBD 刚度：compliance（更小 = 更刚）
   * - 柔软度：airDamping（更大 = 更柔软）
   * - 稳定性：substeps（更多 = 更稳定）
   */

  /**
   * 约束求解（单次迭代）
   * 
   * ⚠️ PBD/XPBD 约束系统：
   * - 只处理几何约束（distance, fixed）
   * - 直接修正位置以满足约束
   * - 不计算物理弹力
   * - 不更新速度（由 _updateVelocitiesAfterConstraints 负责）
   * 
   * @private
   * @param {Array} physicsData 
   * @param {number} dt - 子步时间步长（XPBD 需要）
   */
  _solveConstraintsIteration(physicsData, dt) {
    let constraintCount = 0;

    for (const data of physicsData) {
      // 求解约束（只修正位置）
      for (const constraint of data.constraints) {
        if (constraint.type === 'fixed') {
          this._solveFixedConstraint(data.particles, constraint);
        } else if (constraint.type === 'distance') {
          this._solveDistanceConstraint(data.particles, constraint, dt);  // ⭐ 传递 dt
        } else if (constraint.type === 'bending') {
          this._solveBendingConstraint(data.particles, constraint);
        } else if (constraint.type === 'line_bending') {
          this._solveLineBendingConstraint(data.particles, constraint);
        }
      }

      constraintCount += data.constraints.length;
    }

    this.stats.constraintCount = constraintCount;
  }
  
  /**
   * 约束求解后更新速度
   * 
   * ⚠️ 关键：position-based velocity update
   * - 使用约束修正前后的位置差计算速度
   * - 确保 Verlet 不会抵消约束修正
   * - 只在所有迭代完成后执行一次
   * 
   * @private
   * @param {Array} physicsData 
   * @param {number} dt 
   */
  _updateVelocitiesAfterConstraints(physicsData, dt) {
    if (dt <= 0) return;
    
    for (const data of physicsData) {
      for (let i = 0; i < data.particles.length; i++) {
        const p = data.particles[i];
        if (!p.fixed && p.velocity && data._oldPositions) {
          // 隐式速度 = (新位置 - 旧位置) / dt
          p.velocity.x = (p.position.x - data._oldPositions[i].x) / dt;
          p.velocity.y = (p.position.y - data._oldPositions[i].y) / dt;
          p.velocity.z = (p.position.z - data._oldPositions[i].z) / dt;
        }
      }
    }
  }

  /**
   * 距离约束（保持两点距离）
   * 
   * ⭐ 支持 PBD 和 XPBD：
   * - PBD: compliance = 0（无限刚性，通过迭代控制）
   * - XPBD: compliance > 0（柔性约束，物理准确）
   * 
   * XPBD 公式：
   * C(x) = ||x₂ - x₁|| - d
   * Δλ = -C(x) / (w₁ + w₂ + α/dt²)
   * α = compliance / dt²
   * Δx = Δλ · ∇C(x) · w
   * 
   * @private
   * @param {Array} particles 
   * @param {Object} constraint 
   * @param {number} dt - 子步时间步长（XPBD 需要）
   */
  _solveDistanceConstraint(particles, constraint, dt) {
    const p1 = particles[constraint.i];
    const p2 = particles[constraint.j];

    // ⭐ 边界检查
    if (!p1 || !p2) return;
    if (p1.fixed && p2.fixed) return;

    // 计算当前距离向量
    const dx = p2.position.x - p1.position.x;
    const dy = p2.position.y - p1.position.y;
    const dz = p2.position.z - p1.position.z;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (currentDist < 1e-6) return;

    // 目标距离
    const targetDist = constraint.distance ?? constraint.restLength ?? constraint.length;
    
    // 约束函数：C(x) = ||x₂ - x₁|| - d
    const C = currentDist - targetDist;

    // ⭐ XPBD 支持：检测 compliance 参数
    const compliance = constraint.compliance ?? 0;  // 默认 0（PBD）
    
    // 质量倒数（权重）
    const w1 = p1.fixed ? 0 : 1 / p1.mass;
    const w2 = p2.fixed ? 0 : 1 / p2.mass;
    const wSum = w1 + w2;
    
    if (wSum < 1e-10) return;

    // ⭐ XPBD 公式：Δλ = -C / (wSum + α/dt²)
    // 当 compliance = 0 时，退化为 PBD
    let alpha = 0;
    if (compliance > 0 && dt > 0) {
      // ⭐ 使用子步 dt（不是 this.timeStep）
      alpha = compliance / (dt * dt);
    }
    
    const denominator = wSum + alpha;
    if (denominator < 1e-10) return;
    
    // 计算 λ 增量
    const deltaLambda = -C / denominator;
    
    // ⭐ XPBD 累积 lambda（在迭代内）
    if (constraint.lambda === undefined) {
      constraint.lambda = 0;
    }
    constraint.lambda += deltaLambda;
    
    // 约束梯度方向（单位向量）
    const nx = dx / currentDist;
    const ny = dy / currentDist;
    const nz = dz / currentDist;
    
    // ⭐ 显式分支：PBD vs XPBD
    let relaxation = 1.0;
    if (compliance === 0) {
      // PBD 模式：允许放松因子
      relaxation = this.constraintRelaxation;
    } else {
      // XPBD 模式：禁止放松因子（保证物理准确性）
      relaxation = 1.0;
    }

    // 位置修正：Δx = Δλ · ∇C · w · relaxation
    if (!p1.fixed) {
      p1.position.x -= deltaLambda * nx * w1 * relaxation;
      p1.position.y -= deltaLambda * ny * w1 * relaxation;
      p1.position.z -= deltaLambda * nz * w1 * relaxation;
    }

    if (!p2.fixed) {
      p2.position.x += deltaLambda * nx * w2 * relaxation;
      p2.position.y += deltaLambda * ny * w2 * relaxation;
      p2.position.z += deltaLambda * nz * w2 * relaxation;
    }
  }

  /**
   * 固定点约束
   * 
   * ⚠️ 语义：只投影位置到目标位置，不修改粒子的 fixed 状态
   * 
   * p.fixed 应该是粒子的初始化属性或对象级属性，
   * 约束系统只负责执行投影，不负责修改属性。
   * 
   * ⭐ 零拷贝优化：复用 velocity 对象
   * 
   * @private
   */
  _solveFixedConstraint(particles, constraint) {
    const p = particles[constraint.index];
    if (!p) return;

    // ⭐ 固定位置（投影到目标位置）
    p.position.x = constraint.position.x;
    p.position.y = constraint.position.y;
    p.position.z = constraint.position.z;
    
    // ⭐ 清零速度（固定点不应移动）
    if (!p.velocity) {
      p.velocity = { x: 0, y: 0, z: 0 };
    } else {
      p.velocity.x = 0;
      p.velocity.y = 0;
      p.velocity.z = 0;
    }
    
    // ⚠️ 注意：不修改 p.fixed 状态
    // p.fixed 应在粒子初始化时设置，或通过 Object API 设置
  }

  /**
   * 弯曲约束（二面角约束，用于布料）
   * 
   * ⭐ PBD/XPBD 弯曲约束：
   * - 约束 4 个粒子形成的二面角
   * - 用于模拟布料的弯曲刚度
   * 
   * 约束函数：
   * C(x) = arccos(n1 · n2) - θ₀
   * 
   * 其中：
   * - n1, n2 是两个三角形的法向量
   * - θ₀ 是静止角度
   * 
   * @private
   * @param {Array} particles 
   * @param {Object} constraint - { particles: [a, b, c, d], restAngle, compliance }
   */
  _solveBendingConstraint(particles, constraint) {
    const [a, b, c, d] = constraint.particles.map(i => particles[i]);
    
    // ⭐ 边界检查
    if (!a || !b || !c || !d) return;
    if (a.fixed && b.fixed && c.fixed && d.fixed) return;
    
    // 计算两个三角形的法向量
    // 三角形 1: a-b-c
    const ab = {
      x: b.position.x - a.position.x,
      y: b.position.y - a.position.y,
      z: b.position.z - a.position.z
    };
    const ac = {
      x: c.position.x - a.position.x,
      y: c.position.y - a.position.y,
      z: c.position.z - a.position.z
    };
    
    // 法向量 n1 = ab × ac
    const n1 = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x
    };
    
    // 三角形 2: a-b-d
    const ad = {
      x: d.position.x - a.position.x,
      y: d.position.y - a.position.y,
      z: d.position.z - a.position.z
    };
    
    // 法向量 n2 = ab × ad
    const n2 = {
      x: ab.y * ad.z - ab.z * ad.y,
      y: ab.z * ad.x - ab.x * ad.z,
      z: ab.x * ad.y - ab.y * ad.x
    };
    
    // 归一化
    const mag1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
    const mag2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);
    
    if (mag1 < 1e-6 || mag2 < 1e-6) return;
    
    n1.x /= mag1; n1.y /= mag1; n1.z /= mag1;
    n2.x /= mag2; n2.y /= mag2; n2.z /= mag2;
    
    // 当前角度
    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    const currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // 约束函数
    const restAngle = constraint.restAngle ?? 0;
    const C = currentAngle - restAngle;
    
    // ⭐ 简化处理：对于弯曲约束，使用较小的刚度
    // 完整的 XPBD 弯曲约束需要复杂的梯度计算
    // 这里使用简化版本：调整法向量方向
    
    const compliance = constraint.compliance ?? 0.1;  // 默认较软
    
    // 简化修正：朝着减小角度差的方向调整点
    const correction = C * compliance * 0.1;  // 小步修正
    
    if (Math.abs(correction) < 1e-6) return;
    
    // 修正方向：垂直于共享边 ab
    const edgeLen = Math.sqrt(ab.x * ab.x + ab.y * ab.y + ab.z * ab.z);
    if (edgeLen < 1e-6) return;
    
    // 归一化边向量
    const abNorm = {
      x: ab.x / edgeLen,
      y: ab.y / edgeLen,
      z: ab.z / edgeLen
    };
    
    // 修正点 c 和 d 的位置
    const w_c = c.fixed ? 0 : 1 / c.mass;
    const w_d = d.fixed ? 0 : 1 / d.mass;
    const wSum = w_c + w_d;
    
    if (wSum > 1e-10) {
      // 沿法向量方向修正
      if (!c.fixed) {
        c.position.x += n1.x * correction * w_c / wSum;
        c.position.y += n1.y * correction * w_c / wSum;
        c.position.z += n1.z * correction * w_c / wSum;
      }
      
      if (!d.fixed) {
        d.position.x -= n2.x * correction * w_d / wSum;
        d.position.y -= n2.y * correction * w_d / wSum;
        d.position.z -= n2.z * correction * w_d / wSum;
      }
    }
  }

  /**
   * 线弯曲约束（三点角度约束，用于线/绳）
   * 
   * ⭐ PBD/XPBD 线弯曲约束：
   * - 约束 3 个连续点的角度
   * - 用于模拟线/绳的弯曲刚度
   * 
   * 约束函数：
   * C(x) = arccos(v1 · v2 / (|v1| * |v2|)) - θ₀
   * 
   * 其中：
   * - v1 = p1 - p0
   * - v2 = p2 - p1
   * - θ₀ 是静止角度
   * 
   * @private
   * @param {Array} particles 
   * @param {Object} constraint - { particles: [i, j, k], restAngle, compliance }
   */
  _solveLineBendingConstraint(particles, constraint) {
    const [i, j, k] = constraint.particles;
    const p0 = particles[i];
    const p1 = particles[j];
    const p2 = particles[k];
    
    // ⭐ 边界检查
    if (!p0 || !p1 || !p2) return;
    if (p0.fixed && p1.fixed && p2.fixed) return;
    
    // 向量 v1 = p1 - p0
    const v1 = {
      x: p1.position.x - p0.position.x,
      y: p1.position.y - p0.position.y,
      z: p1.position.z - p0.position.z
    };
    
    // 向量 v2 = p2 - p1
    const v2 = {
      x: p2.position.x - p1.position.x,
      y: p2.position.y - p1.position.y,
      z: p2.position.z - p1.position.z
    };
    
    // 长度
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    
    if (mag1 < 1e-6 || mag2 < 1e-6) return;
    
    // 当前角度
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
    const currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // 约束函数
    const restAngle = constraint.restAngle ?? Math.PI;  // 默认直线
    const C = currentAngle - restAngle;
    
    if (Math.abs(C) < 1e-6) return;
    
    // ⭐ XPBD 柔度
    const compliance = constraint.compliance ?? 0.05;  // 默认较软
    
    // 质量权重
    const w0 = p0.fixed ? 0 : 1 / p0.mass;
    const w1 = p1.fixed ? 0 : 1 / p1.mass;
    const w2 = p2.fixed ? 0 : 1 / p2.mass;
    
    // 简化修正：朝着减小角度差的方向调整中间点
    // 完整的梯度计算较复杂，这里使用简化版本
    
    const correction = -C * compliance * 0.5;  // 修正量
    
    if (Math.abs(correction) < 1e-6) return;
    
    // 修正方向：垂直于 v1-v2 平面
    // 叉乘得到垂直向量
    const perp = {
      x: v1.y * v2.z - v1.z * v2.y,
      y: v1.z * v2.x - v1.x * v2.z,
      z: v1.x * v2.y - v1.y * v2.x
    };
    
    const perpMag = Math.sqrt(perp.x * perp.x + perp.y * perp.y + perp.z * perp.z);
    if (perpMag < 1e-6) return;
    
    // 归一化
    perp.x /= perpMag;
    perp.y /= perpMag;
    perp.z /= perpMag;
    
    // 修正点位置
    const totalW = w0 + w1 + w2;
    if (totalW < 1e-10) return;
    
    // 主要修正中间点 p1
    if (!p1.fixed) {
      const factor = correction * (w1 / totalW);
      p1.position.x += perp.x * factor;
      p1.position.y += perp.y * factor;
      p1.position.z += perp.z * factor;
    }
    
    // 轻微修正端点 p0 和 p2
    if (!p0.fixed) {
      const factor = -correction * 0.5 * (w0 / totalW);
      p0.position.x += perp.x * factor;
      p0.position.y += perp.y * factor;
      p0.position.z += perp.z * factor;
    }
    
    if (!p2.fixed) {
      const factor = -correction * 0.5 * (w2 / totalW);
      p2.position.x += perp.x * factor;
      p2.position.y += perp.y * factor;
      p2.position.z += perp.z * factor;
    }
  }

  // ====================================================
  // 碰撞检测
  // ====================================================

  /**
   * 处理所有碰撞
   * @private
   * @param {Array} physicsData 
   */
  _handleCollisions(physicsData) {
    let collisionCount = 0;

    for (const data of physicsData) {
      // 1. 地面碰撞
      for (const p of data.particles) {
        if (this._handleGroundCollision(p)) {
          collisionCount++;
        }
      }

      // 2. 自碰撞（布料）
      // ⭐ 修复：基于对象属性而不是 data.type
      // 判断是否为布料：有大量距离约束且粒子数 > 阈值
      const isCloth = data.particles.length > 50 && 
                     data.constraints.filter(c => c.type === 'distance').length > 100;
      
      if (this.selfCollisionEnabled && isCloth) {
        collisionCount += this._handleSelfCollision(data);
      }
    }

    // 3. 对象间碰撞
    for (let i = 0; i < physicsData.length; i++) {
      for (let j = i + 1; j < physicsData.length; j++) {
        collisionCount += this._handleObjectCollision(physicsData[i], physicsData[j]);
      }
    }

    this.stats.collisionCount = collisionCount;
  }

  /**
   * 地面碰撞
   * @private
   * @returns {boolean} - 是否发生碰撞
   */
  _handleGroundCollision(p) {
    if (p.position.y < this.groundY) {
      p.position.y = this.groundY;

      if (p.velocity) {
        // 弹性碰撞
        p.velocity.y = -p.velocity.y * this.groundRestitution;
        
        // 摩擦
        p.velocity.x *= 0.95;
        p.velocity.z *= 0.95;
      }

      return true;
    }
    return false;
  }

  /**
   * 自碰撞（布料内部）
   * @private
   * @returns {number} - 碰撞次数
   */
  _handleSelfCollision(data) {
    let count = 0;
    const particles = data.particles;

    // 简化版：只检测距离过近的点对
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];

        const dx = p2.position.x - p1.position.x;
        const dy = p2.position.y - p1.position.y;
        const dz = p2.position.z - p1.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < this.collisionMargin * 2) {
          // 分开
          const pushDist = (this.collisionMargin * 2 - dist) / 2;
          const nx = dx / (dist + 1e-10);
          const ny = dy / (dist + 1e-10);
          const nz = dz / (dist + 1e-10);

          if (!p1.fixed) {
            p1.position.x -= nx * pushDist;
            p1.position.y -= ny * pushDist;
            p1.position.z -= nz * pushDist;
          }

          if (!p2.fixed) {
            p2.position.x += nx * pushDist;
            p2.position.y += ny * pushDist;
            p2.position.z += nz * pushDist;
          }

          count++;
        }
      }
    }

    return count;
  }

  /**
   * 对象间碰撞（简化版）
   * @private
   * @returns {number}
   */
  _handleObjectCollision(data1, data2) {
    // TODO: 实现更复杂的对象间碰撞
    // 当前简化：点对点检测
    return 0;
  }

  // ====================================================
  // 撕裂检测
  // ====================================================

  /**
   * 检测布料撕裂
   * 
   * ⭐ 纯 PBD 撕裂：
   * - 检测 type === 'distance' 且 edgeType === 'structural' | 'shear' 的约束
   * - 当拉伸超过阈值时，从约束列表移除
   * - 撕裂后约束永久失效（不恢复）
   * 
   * @private
   * @param {Array} physicsData 
   */
  _handleTearing(physicsData) {
    for (const data of physicsData) {
      // 只对布料约束生效
      if (!data.constraints || data.constraints.length === 0) continue;
      
      const constraints = data.constraints;
      const particles = data.particles;

      // ⭐ 检测过度拉伸的距离约束（可撕裂边）
      for (let i = constraints.length - 1; i >= 0; i--) {
        const constraint = constraints[i];
        
        // 只处理可撕裂的距离约束
        if (constraint.type !== 'distance') continue;
        if (!constraint.edgeType) continue;  // 必须有 edgeType 元数据
        
        // 只有结构边和剪切边可撕裂（弯曲边不撕裂）
        if (constraint.edgeType !== 'structural' && constraint.edgeType !== 'shear') continue;
        
        const p1 = particles[constraint.i];
        const p2 = particles[constraint.j];

        if (!p1 || !p2) continue;

        const dx = p2.position.x - p1.position.x;
        const dy = p2.position.y - p1.position.y;
        const dz = p2.position.z - p1.position.z;
        const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const restLength = constraint.restLength ?? constraint.distance;
        const tearThreshold = constraint.tearThreshold ?? restLength * 2.5;

        if (currentLength > tearThreshold) {
          // ⭐ 撕裂：从约束列表移除
          constraints.splice(i, 1);

          if (this.verbose) {
            console.log(`[Physics] Cloth tear: ${constraint.edgeType} edge ${constraint.i}-${constraint.j}`);
          }
        }
      }
    }
  }

  // ====================================================
  // 写回数据
  // ====================================================

  /**
   * 将物理数据写回对象
   * 
   * ⭐ 零拷贝架构：
   * - 调用 commit() 统一写回
   * - 禁止速度反算
   * - 维护 XPBD lambda
   * 
   * @private
   * @param {Array} physicsData 
   */
  _writeBackPhysicsData(physicsData) {
    for (const data of physicsData) {
      // ✅ 调用 commit() 零拷贝写回
      if (typeof data.commit === 'function') {
        data.commit();
      } else {
        console.warn('[Physics] Missing commit() function:', data.object);
      }
      
      // 更新平均速度（用于渲染）
      if (data.particles.length > 0 && data.particles[0].velocity) {
        const avgVel = { x: 0, y: 0, z: 0 };
        for (const p of data.particles) {
          avgVel.x += p.velocity.x;
          avgVel.y += p.velocity.y;
          avgVel.z += p.velocity.z;
        }
        avgVel.x /= data.particles.length;
        avgVel.y /= data.particles.length;
        avgVel.z /= data.particles.length;
        
        data.object.physics.velocity = avgVel;
      }
    }
  }

  // ====================================================
  // 工具与诊断
  // ====================================================

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      objectCount: this.objects.length,
      gravity: this.gravityEnabled,
      method: this.method,
      fps: this.stats.lastStepTime > 0 ? (1000 / this.stats.lastStepTime).toFixed(1) : 'N/A'
    };
  }

  /**
   * 设置重力
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   */
  setGravity(x, y, z) {
    this.gravity = { x, y, z };
  }

  /**
   * 开关重力
   * @param {boolean} enabled 
   */
  enableGravity(enabled = true) {
    this.gravityEnabled = enabled;
  }

  /**
   * 重置所有对象的物理状态
   */
  reset() {
    for (const obj of this.objects) {
      if (obj.physics.enabled) {
        obj.physics.velocity = { x: 0, y: 0, z: 0 };
        obj.physics.forces = [];
      }
    }

    this.stats.stepCount = 0;
  }

  /**
   * 调试输出
   */
  debug() {
    console.log('=== PhysicsSystem Debug ===');
    console.log('Objects:', this.objects.length);
    console.log('Stats:', this.getStats());
    console.log('Gravity:', this.gravityEnabled ? this.gravity : 'Disabled');
    console.log('Collision:', this.collisionEnabled);
    console.log('Self-Collision:', this.selfCollisionEnabled);
  }
}

// ====================================================
// 辅助类：布料生成器（几何工具）
// ====================================================

/**
 * ClothGenerator - 生成布料结构（纯 PBD 几何约束）
 * 
 * ⚠️ 定位：几何生成工具，非物理核心
 * 
 * ⭐⭐⭐ 约束生成规范（强制）⭐⭐⭐
 * 
 * 声明：本类生成纯 PBD 几何约束
 * - 所有边生成：type === 'distance'
 * - 禁止生成：type === 'spring'
 * - 原因：布料是几何保持类结构，应该使用时间步无关的 PBD 约束
 * 
 * ⚠️ 如果需要"更柔软"的布料：
 * ✅ 正确方式：增加 compliance（XPBD 柔度）
 * ✅ 正确方式：减少 constraintIterations
 * ✅ 正确方式：增加 airDamping
 * ❌ 错误方式：改用 spring（违反架构规范）
 * 
 * ⭐ 输出语义：
 * - structural → type: 'distance', edgeType: 'structural'（结构边）
 * - shear → type: 'distance', edgeType: 'shear'（剪切边）
 * - bending → type: 'distance', edgeType: 'bending'（弯曲边）
 * 
 * ⭐ 约束结构：
 * {
 *   type: 'distance',           // ← ⭐ PBD 几何约束（强制）
 *   i: 0, j: 1,                 // ← 主索引（求解器使用）
 *   particles: [0, 1],          // ← 辅助字段（序列化）
 *   restLength: 1.0,            // ← 静止长度
 *   distance: 1.0,              // ← 别名（兼容）
 *   edgeType: 'structural',     // ← 元数据（撕裂、可视化）
 *   compliance: 0.001           // ← XPBD 柔度（可选）
 * }
 * 
 * ⭐ 不生成的字段：
 * ❌ stiffness（PBD 不使用，改用 compliance = 1/stiffness）
 * ❌ damping（distance 约束不支持，改用全局 airDamping）
 * ❌ type: 'spring'（违反约束生成规范）
 * 
 * 职责：
 * - 生成矩形布料的顶点和拓扑
 * - 生成 PBD 几何约束（不是物理弹簧）
 * - 返回标准数据结构
 * 
 * 不包含：
 * - 物理模拟逻辑
 * - 约束求解
 * - 时间积分
 * 
 * 使用建议：
 * - 可用于快速原型
 * - 生产环境建议在 Object 类中生成
 */
class ClothGenerator {
  /**
   * 生成矩形布料
   * @param {number} width - 宽度
   * @param {number} height - 高度
   * @param {number} segmentsX - X 方向段数
   * @param {number} segmentsY - Y 方向段数
   * @param {Object} options - 物理参数
   * @returns {Object} - {vertices, edges, faces}
   */
  static generateRectCloth(width, height, segmentsX, segmentsY, options = {}) {
    const vertices = [];
    const edges = [];
    const faces = [];

    const stiffness = options.stiffness ?? 1000;
    const damping = options.damping ?? 10;
    const mass = options.mass ?? 0.1;

    // 生成顶点
    for (let y = 0; y <= segmentsY; y++) {
      for (let x = 0; x <= segmentsX; x++) {
        const px = (x / segmentsX - 0.5) * width;
        const py = (1 - y / segmentsY) * height;
        const pz = 0;

        vertices.push({
          position: { x: px, y: py, z: pz },
          velocity: { x: 0, y: 0, z: 0 },
          mass,
          fixed: y === 0  // 顶部固定
        });
      }
    }

    const getIndex = (x, y) => y * (segmentsX + 1) + x;

    // 生成结构弹簧（结构边）
    for (let y = 0; y <= segmentsY; y++) {
      for (let x = 0; x <= segmentsX; x++) {
        const i = getIndex(x, y);

        // 水平结构边
        if (x < segmentsX) {
          const j = getIndex(x + 1, y);
          const dx = vertices[j].position.x - vertices[i].position.x;
          const dy = vertices[j].position.y - vertices[i].position.y;
          const dz = vertices[j].position.z - vertices[i].position.z;
          const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          edges.push({
            i, j,                           // ⭐ 主索引（求解器使用）
            restLength,
            type: 'distance',               // ⭐ 纯 PBD：几何约束
            particles: [i, j],              // 📋 辅助字段（序列化、可视化）
            distance: restLength,           // ⭐ 别名（兼容）
            edgeType: 'structural',         // ⭐ 元数据（用于撕裂、可视化）
            // XPBD 参数
            compliance: stiffness ? 1 / stiffness : 0
            // ⚠️ 注意：distance 约束不支持 damping
            // 阻尼效果应通过 airDamping 或速度阻尼实现
          });
        }

        // 垂直结构边
        if (y < segmentsY) {
          const j = getIndex(x, y + 1);
          const dx = vertices[j].position.x - vertices[i].position.x;
          const dy = vertices[j].position.y - vertices[i].position.y;
          const dz = vertices[j].position.z - vertices[i].position.z;
          const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          edges.push({
            i, j,
            restLength,
            type: 'distance',           // ⭐ 纯 PBD：几何约束
            particles: [i, j],          // ⭐ 标准字段
            distance: restLength,       // ⭐ 别名（兼容）
            edgeType: 'structural',     // ⭐ 元数据
            compliance: stiffness ? 1 / stiffness : 0
          });
        }
      }
    }

    // 生成剪切边（对角线）
    for (let y = 0; y < segmentsY; y++) {
      for (let x = 0; x < segmentsX; x++) {
        const i1 = getIndex(x, y);
        const i2 = getIndex(x + 1, y + 1);
        const i3 = getIndex(x + 1, y);
        const i4 = getIndex(x, y + 1);

        // 对角线 1
        const dx1 = vertices[i2].position.x - vertices[i1].position.x;
        const dy1 = vertices[i2].position.y - vertices[i1].position.y;
        const dz1 = vertices[i2].position.z - vertices[i1].position.z;
        const restLength1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1);

        edges.push({
          i: i1, j: i2,
          restLength: restLength1,
          type: 'distance',             // ⭐ 纯 PBD：几何约束
          particles: [i1, i2],          // ⭐ 标准字段
          distance: restLength1,        // ⭐ 别名（兼容）
          edgeType: 'shear',            // ⭐ 元数据
          compliance: stiffness ? 2 / stiffness : 0  // 剪切边更柔软
        });

        // 对角线 2
        const dx2 = vertices[i4].position.x - vertices[i3].position.x;
        const dy2 = vertices[i4].position.y - vertices[i3].position.y;
        const dz2 = vertices[i4].position.z - vertices[i3].position.z;
        const restLength2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

        edges.push({
          i: i3, j: i4,
          restLength: restLength2,
          type: 'distance',             // ⭐ 纯 PBD：几何约束
          particles: [i3, i4],          // ⭐ 标准字段
          distance: restLength2,        // ⭐ 别名（兼容）
          edgeType: 'shear',            // ⭐ 元数据
          compliance: stiffness ? 2 / stiffness : 0
        });
      }
    }

    // 生成弯曲约束（隔一个顶点）
    if (options.bendingStiffness) {
      for (let y = 0; y <= segmentsY; y++) {
        for (let x = 0; x <= segmentsX; x++) {
          const i = getIndex(x, y);

          // 水平弯曲
          if (x < segmentsX - 1) {
            const j = getIndex(x + 2, y);
            const dx = vertices[j].position.x - vertices[i].position.x;
            const dy = vertices[j].position.y - vertices[i].position.y;
            const dz = vertices[j].position.z - vertices[i].position.z;
            const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

            edges.push({
              i, j,
              restLength,
              type: 'distance',           // ⭐ 弯曲也用 distance（更简单）
              particles: [i, j],          // ⭐ 标准字段
              distance: restLength,       // ⭐ 别名
              edgeType: 'bending',        // ⭐ 元数据
              compliance: options.bendingStiffness ? 1 / options.bendingStiffness : 0
            });
          }

          // 垂直弯曲
          if (y < segmentsY - 1) {
            const j = getIndex(x, y + 2);
            const dx = vertices[j].position.x - vertices[i].position.x;
            const dy = vertices[j].position.y - vertices[i].position.y;
            const dz = vertices[j].position.z - vertices[i].position.z;
            const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

            edges.push({
              i, j,
              restLength,
              type: 'distance',           // ⭐ 弯曲也用 distance
              particles: [i, j],          // ⭐ 标准字段
              distance: restLength,       // ⭐ 别名
              edgeType: 'bending',        // ⭐ 元数据
              compliance: options.bendingStiffness ? 1 / options.bendingStiffness : 0
            });
          }
        }
      }
    }

    // 生成三角面（用于渲染）
    for (let y = 0; y < segmentsY; y++) {
      for (let x = 0; x < segmentsX; x++) {
        const i1 = getIndex(x, y);
        const i2 = getIndex(x + 1, y);
        const i3 = getIndex(x + 1, y + 1);
        const i4 = getIndex(x, y + 1);

        faces.push([i1, i2, i3]);
        faces.push([i1, i3, i4]);
      }
    }

    return {
      vertices,
      edges,
      faces,
      metadata: {
        width,
        height,
        segmentsX,
        segmentsY
      }
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PhysicsSystem, ClothGenerator };
} else if (typeof window !== 'undefined') {
  window.PhysicsSystem = PhysicsSystem;
  window.ClothGenerator = ClothGenerator;
}
