import { Point } from "./Point.js";

/**
 * ObjectGeometry - 几何计算模块
 * 
 * 负责所有形态计算、采样和空间查询。
 * 通过 core 引用访问和修改状态。
 * 
 * 职责：
 * 1. 拟合与缓存（球谐、EFD）
 * 2. 实体化算法（体积网格、布料）
 * 3. 空间查询（材质、碰撞体）
 * 4. 实时交互（法线更新、物理几何更新）
 */
export class ObjectGeometry {
  /**
   * 构造函数
   * @param {ObjectCore} core - 核心状态容器
   */
  constructor(core) {
    this.core = core;
    
    // 缓存 FittingCalculator 实例
    this._fittingCalculator = null;
    this._matrixClass = null;
  }


  // === 核心拟合方法 ===
  
  fitSphericalHarmonics(options = {}) {
    // ⭐ 数据验证：使用控制点而非表面点
    if (this.core.controlPoints.length === 0) {
      throw new Error('No control points to fit');
    }

    const context = {
      pointVersion: this.core._controlPointVersion,  // ⭐ 使用控制点版本
      order: options.order
    };

    // 检查缓存（仅在非增量模式或强制模式下）
    const useIncremental = options.useIncremental ?? true;
    
    if (!useIncremental && !options.force) {
      const cached = this.core._fitCache.get(context);
      if (cached) {
        return cached;
      }
    }

    const FittingCalculator = options.fitter;
    if (!FittingCalculator) {
      throw new Error('FittingCalculator (fitter) required in options');
    }

    // 创建或复用 FittingCalculator 实例
    if (!this._fittingCalculator) {
      this._fittingCalculator = new FittingCalculator({
        Matrix: options.Matrix,
        verbose: this.core.verbose
      });
      
      // 缓存 Matrix 类引用（用于 updateControlPoint）
      this._matrixClass = options.Matrix;
    }

    const fitter = this._fittingCalculator;

    // 获取 SphericalHarmonics 实例
    let sphericalHarmonics = options.sphericalHarmonics;
    
    // 如果没有提供，尝试从之前的表示中获取
    if (!sphericalHarmonics && this.core.representation.data?.sphericalHarmonics) {
      sphericalHarmonics = this.core.representation.data.sphericalHarmonics;
    }
    
    // 如果还没有，需要创建
    if (!sphericalHarmonics) {
      throw new Error('SphericalHarmonics instance required in options or previous representation');
    }

    const order = options.order ?? 3;  // 默认阶数 3

    // ⭐ 计算中心：使用控制点
    const center = this.core._computeCenter(this.core.controlPoints);

    let result;

    // ⭐ 使用增量拟合（基于控制点）
    if (useIncremental) {
      try {
        result = fitter.fitIncrementalSpherical(
          this.core.controlPoints,  // ⭐ 强制使用控制点
          this.core._fitStack,      // ⭐ 状态栈会被自动更新
          center,
          {
            order,
            sphericalHarmonics,
            verbose: this.core.verbose
          }
        );

        if (this.core.verbose) {
          console.log(`[Object] Incremental fit: ${result.metadata.extensionsPerformed} extensions, fitStack size: ${this.core._fitStack.length}`);
        }
      } catch (err) {
        console.error('[Object] Incremental fit failed, falling back to full fit:', err.message);
        
        // 清空状态栈，回退到完整拟合
        this.core._fitStack = [];
        
        // 使用传统的 fit 方法（如果 fitter 支持）
        if (typeof fitter.fit === 'function') {
          result = fitter.fit(this.core.controlPoints, order, center, {});  // ⭐ 使用控制点
        } else {
          throw err;
        }
      }
    } else {
      // 传统拟合模式
      if (typeof fitter.fit === 'function') {
        result = fitter.fit(this.core.controlPoints, order, center, {});  // ⭐ 使用控制点
      } else {
        throw new Error('FittingCalculator does not support non-incremental fit');
      }
    }

    // 更新表示
    this.core.representation = {
      type: 'sphericalHarmonics',
      isClosed: true,
      data: {
        coefficients: result.coefficients,
        order: result.order || order,
        sphericalHarmonics: sphericalHarmonics
      },
      physicsState: this.core.representation.physicsState,
      topology: {
        triangles: [],
        edges: [],
        internalEdges: [],
        adjacency: null,
        degree: null
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
      metadata: {
        residual: result.residual,
        condition: result.condition,
        pointCount: result.metadata?.pointCount || this.core.surfacePoints.length,
        fitMethod: useIncremental ? 'incremental' : 'full',
        stateStackSize: this.core._fitStack.length
      }
    };

    // 更新中心
    this.core.center = center;

    // ⭐ 几何状态改变标记（不直接改变 mode）
    // 拟合后的对象处于参数化状态，如果之前是 discrete 模式，
    // 物理数据已失效，但由 Core 或用户决定是否需要重建物理
    
    // ⚠️ 中心改变，所有粒子上的 _sphericalCoords 失效
    this.core._centerVersion++;

    // 缓存结果（仅在非增量模式下）
    if (!useIncremental) {
      this.core._fitCache.set(context, result);
    }

    return result;
  }


  // === 几何量计算 ===
  


  // === 点集更新 ===

  updateControlPoint(index, x, y, z, options = {}) {
    if (index < 0 || index >= this.core.controlPoints.length) {
      console.warn(`[Object] Invalid control point index: ${index}`);
      return;
    }
    
    const autoRefit = options.autoRefit ?? true;
    const updatePhysics = options.updatePhysics ?? true;
    
    const lastIndex = this.core.controlPoints.length - 1;
    
    // ⭐ Swap-to-End 策略
    if (index !== lastIndex) {
      // 情况 1: 修改的不是最后一个点
      
      // 交换当前点与末尾点
      const temp = this.core.controlPoints[index];
      this.core.controlPoints[index] = this.core.controlPoints[lastIndex];
      this.core.controlPoints[lastIndex] = temp;
      
      // 更新末尾点的坐标
      this.core.controlPoints[lastIndex].x = x;
      this.core.controlPoints[lastIndex].y = y;
      this.core.controlPoints[lastIndex].z = z;
      
      // ⭐ 截断状态栈（index 之后的状态失效）
      this.core._fitStack.length = index;
      
      if (this.core.verbose) {
        console.log(`[Object] Swapped control point ${index} with ${lastIndex}, truncated fitStack to ${index}`);
      }
    } else {
      // 情况 2: 修改的是最后一个点
      
      // 直接更新坐标
      this.core.controlPoints[index].x = x;
      this.core.controlPoints[index].y = y;
      this.core.controlPoints[index].z = z;
      
      // ⭐ 回退状态栈一步
      if (this.core._fitStack.length > 0) {
        this.core._fitStack.length = this.core.controlPoints.length - 1;
      }
      
      if (this.core.verbose) {
        console.log(`[Object] Updated last control point ${index}, truncated fitStack to ${this.core._fitStack.length}`);
      }
    }
    
    // 更新版本号
    this.core._onControlPointsChanged();
    this.core._boundingBoxDirty = true;
    this.core.metadata.modified = Date.now();
    
    // ⭐ 级联更新：控制点 → 球谐系数 → 物理几何
    if (autoRefit && this.core.representation.type === 'sphericalHarmonics') {
      try {
        // 重新拟合球谐（使用增量拟合）
        this.fitSphericalHarmonics({
          order: this.core.representation.data.order,
          fitter: this._fittingCalculator?.constructor,
          Matrix: this._matrixClass,
          sphericalHarmonics: this.core.representation.data.sphericalHarmonics,
          useIncremental: true
        });
        
        // 更新物理几何（如果已生成体积网格）
        if (updatePhysics && this.core._isVolumetric) {
          this.updatePhysicsGeometry();
        }
      } catch (err) {
        console.error('[Object] Failed to update after control point change:', err.message);
      }
    }
  }



  updateSurfacePoint(index, x, y, z) {
    if (index < 0 || index >= this.core.surfacePoints.length) {
      console.warn(`[Object] Invalid surface point index: ${index}`);
      return;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 分支 1: 朴素模式（点云，无物理网格）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!this.core._isVolumetric) {
      const lastIndex = this.core.surfacePoints.length - 1;
      
      // ⭐ Swap-to-End 策略（脏数据后置）
      if (index !== lastIndex) {
        // 情况 1: 修改的不是最后一个点
        
        // 交换当前点与末尾点
        const temp = this.core.surfacePoints[index];
        this.core.surfacePoints[index] = this.core.surfacePoints[lastIndex];
        this.core.surfacePoints[lastIndex] = temp;
        
        // 更新末尾点的坐标（原 index 位置的点）
        this.core.surfacePoints[lastIndex].x = x;
        this.core.surfacePoints[lastIndex].y = y;
        this.core.surfacePoints[lastIndex].z = z;
        
        // ⭐ 截断状态栈（增量拟合复用）
        this.core._fitStack.length = index;
        
        if (this.core.verbose) {
          console.log(`[Object] [Naive Mode] Swapped point ${index} ↔ ${lastIndex}, truncated fitStack to ${index}`);
        }
      } else {
        // 情况 2: 修改的是最后一个点
        
        // 直接更新坐标
        this.core.surfacePoints[index].x = x;
        this.core.surfacePoints[index].y = y;
        this.core.surfacePoints[index].z = z;
        
        // ⭐ 回退状态栈一步
        if (this.core._fitStack.length > 0) {
          this.core._fitStack.length = this.core.surfacePoints.length - 1;
        }
        
        if (this.core.verbose) {
          console.log(`[Object] [Naive Mode] Updated last point ${index}, truncated fitStack to ${this.core._fitStack.length}`);
        }
      }
      
      // 更新边界盒和元数据
      this.core._boundingBoxDirty = true;
      this.core.metadata.modified = Date.now();
      return;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 分支 2: 体积/物理模式（物理网格，拓扑固定）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const point = this.core.surfacePoints[index];
    
    // ⭐ 禁止交换顺序（物理约束依赖索引）
    // 仅更新坐标
    point.x = x;
    point.y = y;
    point.z = z;
    
    // ⭐ 同步物理粒子（如果绑定）
    if (point._physicsData) {
      // 更新物理粒子的位置
      point._physicsData.position.x = x;
      point._physicsData.position.y = y;
      point._physicsData.position.z = z;
      
      // 同步前一帧位置（避免突变产生大速度）
      point._physicsData.prevPosition.x = x;
      point._physicsData.prevPosition.y = y;
      point._physicsData.prevPosition.z = z;
      
      if (this.core.verbose) {
        console.log(`[Object] [Volumetric Mode] Updated surface point ${index} and synced physics particle`);
      }
    }
    
    // ⭐ 同步 physicsState.particles（零拷贝架构）
    if (this.core.representation.physicsState?.particles?.[index]) {
      const particle = this.core.representation.physicsState.particles[index];
      particle.position.x = x;
      particle.position.y = y;
      particle.position.z = z;
      
      // 同步前一帧（避免速度突变）
      particle.prevPosition.x = x;
      particle.prevPosition.y = y;
      particle.prevPosition.z = z;
    }
    
    // ⭐ 禁止操作 _fitStack
    // 原因：_fitStack 属于控制点的增量拟合缓存，表面点变化不应影响
    
    // 更新边界盒和元数据
    this.core._boundingBoxDirty = true;
    this.core.metadata.modified = Date.now();
    
    if (this.core.verbose) {
      console.log(`[Object] [Volumetric Mode] Updated surface point ${index} in-place (no swap, no fitStack change)`);
    }
  }



  // === 物理几何更新 ===

  updatePhysicsGeometry() {
    const physicsState = this.core.representation.physicsState;
    if (!physicsState) {
      console.warn('[Object] No physics state to update');
      return;
    }

    if (this.core.representation.type !== 'sphericalHarmonics' && 
        this.core.representation.type !== 'volumetric') {
      console.warn('[Object] updatePhysicsGeometry only works with spherical harmonics');
      return;
    }

    const { coefficients, sphericalHarmonics } = this.core.representation.data;
    if (!coefficients || !sphericalHarmonics) {
      console.warn('[Object] Missing spherical harmonics data');
      return;
    }

    const { particles, constraints } = physicsState;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 步骤 0: 参数跳变检测（稳健性增强）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let needsReparameterization = false;
    let invalidCoordCount = 0;
    const ANGLE_CHANGE_THRESHOLD = Math.PI / 4;  // 45度阈值
    
    // 采样检查前几个粒子的参数稳定性
    const sampleSize = Math.min(10, particles.length);
    for (let i = 0; i < sampleSize; i++) {
      const p = particles[i];
      
      if (p._sphericalCoords && p._sphericalCoords.centerVersion === this.core._centerVersion) {
        // 验证球坐标是否仍然有效
        const oldTheta = p._sphericalCoords.theta;
        const oldPhi = p._sphericalCoords.phi;
        
        // 计算当前位置的球坐标
        const dx = p.position.x - this.core.center.x;
        const dy = p.position.y - this.core.center.y;
        const dz = p.position.z - this.core.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (r > 1e-10) {
          const newTheta = this._safeAcos(dz / r);
          const newPhi = Math.atan2(dy, dx);
          
          // 检查角度变化（考虑 phi 的周期性）
          const deltaTheta = Math.abs(newTheta - oldTheta);
          let deltaPhi = Math.abs(newPhi - oldPhi);
          if (deltaPhi > Math.PI) {
            deltaPhi = 2 * Math.PI - deltaPhi;  // 处理周期性
          }
          
          if (deltaTheta > ANGLE_CHANGE_THRESHOLD || deltaPhi > ANGLE_CHANGE_THRESHOLD) {
            needsReparameterization = true;
            break;
          }
        }
      } else {
        invalidCoordCount++;
      }
    }
    
    // 如果大部分坐标失效，需要重新参数化
    if (invalidCoordCount > sampleSize * 0.5) {
      needsReparameterization = true;
    }
    
    if (this.core.verbose && needsReparameterization) {
      console.log('[ObjectGeometry] Parameter jump detected, re-parameterizing...');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 步骤 1: 计算每个粒子的新理想位置（基于球坐标）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const idealPositions = new Array(particles.length);
    let degenerateCount = 0;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      let theta, phi;
      
      // 检查是否需要重新计算球坐标
      if (!needsReparameterization && 
          p._sphericalCoords && 
          p._sphericalCoords.centerVersion === this.core._centerVersion) {
        // 角度有效，直接使用
        theta = p._sphericalCoords.theta;
        phi = p._sphericalCoords.phi;
      } else {
        // 角度失效或不存在，需要重新计算（相对于当前 center）
        const dx = p.position.x - this.core.center.x;
        const dy = p.position.y - this.core.center.y;
        const dz = p.position.z - this.core.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (r < 1e-10) {
          // 粒子在中心，保持当前位置
          idealPositions[i] = { x: p.position.x, y: p.position.y, z: p.position.z };
          degenerateCount++;
          continue;
        }
        
        // ⭐ 稳健的球坐标计算
        theta = this._safeAcos(dz / r);
        phi = Math.atan2(dy, dx);
        
        // 更新粒子的球坐标（缓存）
        if (!p._sphericalCoords) {
          p._sphericalCoords = {};
        }
        p._sphericalCoords.theta = theta;
        p._sphericalCoords.phi = phi;
        p._sphericalCoords.centerVersion = this.core._centerVersion;
      }

      // 使用球谐函数计算新的半径
      const r = sphericalHarmonics.evaluate(theta, phi, coefficients);
      
      // ⭐ 稳健性检查：球谐评估结果
      if (!isFinite(r) || r <= 0) {
        // 退化情况：保持当前位置
        idealPositions[i] = { x: p.position.x, y: p.position.y, z: p.position.z };
        degenerateCount++;
        
        if (this.core.verbose) {
          console.warn(`[ObjectGeometry] Degenerate SH evaluation at particle ${i}: r=${r}`);
        }
        continue;
      }

      // 转换为笛卡尔坐标
      const sinTheta = Math.sin(theta);
      idealPositions[i] = {
        x: this.core.center.x + r * sinTheta * Math.cos(phi),
        y: this.core.center.y + r * sinTheta * Math.sin(phi),
        z: this.core.center.z + r * Math.cos(theta)
      };
    }
    
    if (this.core.verbose && degenerateCount > 0) {
      console.log(`[ObjectGeometry] ${degenerateCount}/${particles.length} particles in degenerate positions`);
    }

    // ⭐ 步骤 2: 热更新距离约束的 restLength
    let updatedDistanceConstraints = 0;

    for (const constraint of constraints) {
      if (constraint.type === 'distance') {
        const i = constraint.i;
        const j = constraint.j;

        if (i !== undefined && j !== undefined && 
            idealPositions[i] && idealPositions[j]) {
          
          const pi = idealPositions[i];
          const pj = idealPositions[j];

          // 计算新的理想距离
          const dx = pj.x - pi.x;
          const dy = pj.y - pi.y;
          const dz = pj.z - pi.z;
          const newRestLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // 更新约束的 restLength
          if (constraint.restLength !== undefined) {
            constraint.restLength = newRestLength;
          } else if (constraint.distance !== undefined) {
            constraint.distance = newRestLength;
          }

          updatedDistanceConstraints++;
        }
      }
    }

    // ⭐ 步骤 3: 热更新形状匹配数据（如果存在）
    // 注意：形状匹配数据通常由 PhysicsSystem 管理，这里我们更新 Object 层的引用形状
    
    if (physicsState.internalStartIndex !== undefined && 
        physicsState.internalCount !== undefined) {
      
      const startIdx = physicsState.internalStartIndex;
      const endIdx = startIdx + physicsState.internalCount;

      // 计算新的质心
      let cx = 0, cy = 0, cz = 0;
      let totalMass = 0;

      for (let i = startIdx; i < endIdx; i++) {
        const p = particles[i];
        const ideal = idealPositions[i];
        cx += ideal.x * p.mass;
        cy += ideal.y * p.mass;
        cz += ideal.z * p.mass;
        totalMass += p.mass;
      }

      cx /= totalMass;
      cy /= totalMass;
      cz /= totalMass;

      // 更新相对偏移量（存储在粒子上，供 PhysicsSystem 读取）
      for (let i = startIdx; i < endIdx; i++) {
        const p = particles[i];
        const ideal = idealPositions[i];

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

    if (this.core.verbose) {
      console.log(`[Object] Updated physics geometry: ${updatedDistanceConstraints} distance constraints`);
    }

    this.core.metadata.modified = Date.now();
  }


  // === 体积网格生成（Bubble Packing + Sightline Filtering）===
  
  /**
   * 生成体积网格
   * 
   * ⭐ 指针切换策略（不覆盖控制点）：
   * 
   * 1. controlPoints 保持不变（幽灵句柄）
   * 2. surfacePoints 切换到高密度网格
   * 3. 设置 _isVolumetric = true
   * 
   * 效果：
   * - 控制点驱动形状（拟合）
   * - 表面点驱动渲染（物理）
   * 
   * @param {Object} options - 配置选项
   * @returns {Object} 生成结果


  // === 体积网格生成 ===

  generateVolumetricMesh(options = {}) {
    if (this.core.representation.type !== 'sphericalHarmonics') {
      throw new Error('Volumetric mesh requires spherical harmonics representation');
    }
    
    // ⭐ 自动计算点数
    let targetCount = options.targetCount;
    const spacing = options.spacing ?? 0.1;
    
    if (targetCount === undefined) {
      // 计算包围盒
      const bbox = this.getBoundingBox();
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;
      const depth = bbox.max.z - bbox.min.z;
      
      // 平均直径
      const D = (width + height + depth) / 3;
      
      // 估算公式：N ≈ 0.52 × (D / spacing)³
      // 0.52 是球体填充率（考虑松弛后的实际密度）
      const estimatedCount = Math.round(0.52 * Math.pow(D / spacing, 3));
      
      // 安全上限：防止浏览器崩溃
      const safetyLimit = 2000;
      targetCount = Math.min(estimatedCount, safetyLimit);
      
      // 最小值：确保至少有基本结构
      targetCount = Math.max(targetCount, 50);
      
      if (this.core.verbose || options.verbose) {
        console.log(`[Object] Auto-calculated targetCount: ${targetCount} (estimated: ${estimatedCount}, D: ${D.toFixed(2)}, spacing: ${spacing})`);
      }
    }
    
    const relaxIterations = options.relaxIterations ?? 25;
    const surfaceRatio = options.surfaceRatio ?? 0.3;
    const knn = options.knn ?? 10;
    const physicsModel = options.physicsModel ?? this.core.physics.model ?? 'pbd';
    
    this.core.physics.model = physicsModel;
    
    const { surfacePoints, internalPoints } = this._generateBubblePacking(
      targetCount, spacing, relaxIterations, surfaceRatio
    );
    
    const topology = this._buildSurfaceTopologyByVisibility(surfacePoints, knn);
    
    // ⭐ 关键修改：创建新的表面点数组（不覆盖 controlPoints）
    const newSurfacePoints = surfacePoints.map(sp => 
      new Point(sp.position.x, sp.position.y, sp.position.z)
    );
    
    const globalMassScale = this.core.physics.mass || 1.0;
    const surfaceMass = globalMassScale * 0.6 / surfacePoints.length;
    const internalMass = globalMassScale * 0.4 / internalPoints.length;
    
    const surfaceParticles = newSurfacePoints.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: point.z },
          prevPosition: { x: point.x, y: point.y, z: point.z },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }
      
      // ⭐ 使用稳健的球坐标计算
      const coords = this._robustSphericalCoords(point, this.core.center);
      
      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: surfaceMass,
        invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
        fixed: false,
        _index: index,
        _type: 'surface',
        _sphericalCoords: coords.valid ? { 
          theta: coords.theta, 
          phi: coords.phi, 
          centerVersion: this.core._centerVersion
        } : null  // 退化时不存储球坐标
      };
    });
    
    const internalParticles = internalPoints.map((node, index) => {
      // ⭐ 使用稳健的球坐标计算
      const coords = this._robustSphericalCoords(node.position, this.core.center);
      
      return {
        position: node.position,
        prevPosition: { x: node.position.x, y: node.position.y, z: node.position.z },
        velocity: { x: 0, y: 0, z: 0 },
        mass: internalMass,
        invMass: internalMass > 0 ? 1 / internalMass : 0,
        fixed: false,
        _index: surfacePoints.length + index,
        _type: 'internal',
        _sphericalCoords: coords.valid ? { 
          theta: coords.theta, 
          phi: coords.phi, 
          centerVersion: this.core._centerVersion
        } : null  // 退化时不存储球坐标
      };
    });
    
    const particles = [...surfaceParticles, ...internalParticles];
    
    // ⭐ 几何生成完成，约束由 ObjectPhysics 生成
    // 用户需要调用 obj.rebuildPhysicsTopology() 来构建约束
    
    this.core.representation.physicsState = {
      physicsModel,
      particles,
      constraints: [],  // ⭐ 由 ObjectPhysics.rebuildPhysicsTopology() 填充
      surfaceStartIndex: 0,
      internalStartIndex: surfacePoints.length,
      surfaceCount: surfacePoints.length,
      internalCount: internalPoints.length
    };
    
    this.core.representation.topology = topology;
    this.core.representation.type = 'volumetric';
    
    // ⭐ 指针切换：将 surfacePoints 指向高密度网格
    // controlPoints 保持不变，成为"幽灵句柄"
    this.core.surfacePoints = newSurfacePoints;
    
    this.core._isVolumetric = true;
    
    if (this.core.verbose) {
      console.log(`[ObjectGeometry] Volumetric mesh generated: ${this.core.controlPoints.length} control points → ${this.core.surfacePoints.length} surface points`);
    }
    
    this.core._surfacePointVersion++;
    this.core._boundingBoxDirty = true;
    this.core.representation.geometryCache.volume = null;
    this.core.representation.geometryCache.surfaceArea = null;
    this.core.representation.geometryCache.sections.clear();
    this.core.metadata.modified = Date.now();
    
    return {
      surfacePoints: surfacePoints.length,
      internalPoints: internalPoints.length,
      topology,
      autoCalculated: options.targetCount === undefined,
      finalTargetCount: targetCount,
      isVolumetric: this.core._isVolumetric,
      controlPointsPreserved: this.core.controlPoints.length
    };
  }



  // === 体积网格辅助方法 ===

  _generateBubblePacking(targetCount, spacing, iterations, surfaceRatio) {
    const { coefficients, sphericalHarmonics } = this.core.representation.data;
    const boundingRadius = sphericalHarmonics._estimateBoundingRadius(coefficients);
    const boxSize = boundingRadius * 2.2;
    
    const points = [];
    const cx = this.core.center.x;
    const cy = this.core.center.y;
    const cz = this.core.center.z;
    
    // 初始化随机点
    for (let i = 0; i < targetCount; i++) {
      points.push({
        position: {
          x: cx + (Math.random() - 0.5) * boxSize,
          y: cy + (Math.random() - 0.5) * boxSize,
          z: cz + (Math.random() - 0.5) * boxSize
        },
        isSurface: false
      });
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 松弛迭代 + 稳健的球谐投影
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    let degenerateEvaluations = 0;
    
    for (let iter = 0; iter < iterations; iter++) {
      // 松弛：粒子间排斥
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
        pi.z += fz * damping;
      }
      
      // 投影到球谐表面（稳健版本）
      for (const point of points) {
        // ⭐ 使用稳健的球坐标计算
        const coords = this._robustSphericalCoords(point.position, this.core.center);
        
        if (!coords.valid) {
          // 点在中心，微小扰动
          point.position.x += (Math.random() - 0.5) * spacing * 0.1;
          point.position.y += (Math.random() - 0.5) * spacing * 0.1;
          point.position.z += (Math.random() - 0.5) * spacing * 0.1;
          continue;
        }
        
        const { theta, phi, r: rCart } = coords;
        
        // ⭐ 使用稳健的球谐评估
        const rSH = this._robustSHEvaluate(sphericalHarmonics, coefficients, theta, phi);
        
        if (rSH === null) {
          // 评估失败，保持当前位置
          degenerateEvaluations++;
          continue;
        }
        
        // 投影到表面
        if (rCart > rSH) {
          const scale = rSH / rCart;
          const dx = point.position.x - cx;
          const dy = point.position.y - cy;
          const dz = point.position.z - cz;
          
          point.position.x = cx + dx * scale;
          point.position.y = cy + dy * scale;
          point.position.z = cz + dz * scale;
          point.isSurface = true;
        }
        else if (rCart > rSH * 0.92) {
          // 吸引到表面
          const scale = rSH / rCart;
          const attractionStrength = (rCart - rSH * 0.92) / (rSH * 0.08);
          const dx = point.position.x - cx;
          const dy = point.position.y - cy;
          const dz = point.position.z - cz;
          
          point.position.x = cx + dx * (scale * attractionStrength + (1 - attractionStrength));
          point.position.y = cy + dy * (scale * attractionStrength + (1 - attractionStrength));
          point.position.z = cz + dz * (scale * attractionStrength + (1 - attractionStrength));
          
          if (attractionStrength > 0.5) {
            point.isSurface = true;
          }
        }
      }
    }
    
    if (this.core.verbose && degenerateEvaluations > 0) {
      console.log(`[ObjectGeometry] ${degenerateEvaluations} degenerate SH evaluations during bubble packing`);
    }
    
    // 分离表面点和内部点
    const surfacePoints = points.filter(p => p.isSurface);
    const internalPoints = points.filter(p => !p.isSurface);
    
    // 确保有足够的表面点
    const targetSurfaceCount = Math.floor(targetCount * surfaceRatio);
    if (surfacePoints.length < targetSurfaceCount && internalPoints.length > 0) {
      const deficit = targetSurfaceCount - surfacePoints.length;
      
      // 按到表面的距离排序
      internalPoints.sort((a, b) => {
        const distA = this._distanceToSurface(a.position, coefficients, sphericalHarmonics);
        const distB = this._distanceToSurface(b.position, coefficients, sphericalHarmonics);
        return distA - distB;
      });
      
      // 提升最近的点为表面点
      for (let i = 0; i < Math.min(deficit, internalPoints.length); i++) {
        internalPoints[i].isSurface = true;
        surfacePoints.push(internalPoints[i]);
      }
      
      const finalInternal = internalPoints.filter(p => !p.isSurface);
      return { surfacePoints, internalPoints: finalInternal };
    }
    
    return { surfacePoints, internalPoints };
  }


  _distanceToSurface(position, coefficients, sphericalHarmonics) {
    // ⭐ 使用稳健的球坐标计算
    const coords = this._robustSphericalCoords(position, this.core.center);
    
    if (!coords.valid) {
      return 0;  // 点在中心
    }
    
    const { theta, phi, r: rCart } = coords;
    
    // ⭐ 使用稳健的球谐评估
    const rSH = this._robustSHEvaluate(sphericalHarmonics, coefficients, theta, phi);
    
    if (rSH === null) {
      return Infinity;  // 评估失败，视为无限远
    }
    
    return Math.abs(rCart - rSH);
  }


  _buildSurfaceTopologyByVisibility(surfacePoints, knn) {
    const { coefficients, sphericalHarmonics } = this.core.representation.data;
    
    const triangles = [];
    const triangleSet = new Set();  // 去重
    const edges = new Set();
    const adjacency = new Map();
    
    for (let i = 0; i < surfacePoints.length; i++) {
      adjacency.set(i, []);
    }
    
    for (let i = 0; i < surfacePoints.length; i++) {
      const pi = surfacePoints[i].position;
      
      const neighbors = [];
      for (let j = 0; j < surfacePoints.length; j++) {
        if (i === j) continue;
        
        const pj = surfacePoints[j].position;
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dz = pj.z - pi.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        neighbors.push({ index: j, dist });
      }
      
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNeighbors = neighbors.slice(0, Math.min(knn, neighbors.length));
      
      for (let a = 0; a < kNeighbors.length; a++) {
        for (let b = a + 1; b < kNeighbors.length; b++) {
          const j = kNeighbors[a].index;
          const k = kNeighbors[b].index;
          const tri = [i, j, k];
          
          if (!this._isTriangleOutwardFacing(tri, surfacePoints)) {
            continue;
          }
          
          if (this._isTriangleOccluded(tri, surfacePoints, coefficients, sphericalHarmonics)) {
            continue;
          }
          
          // 去重：生成唯一键
          const sorted = [i, j, k].sort((a, b) => a - b);
          const triKey = `${sorted[0]}-${sorted[1]}-${sorted[2]}`;
          
          if (triangleSet.has(triKey)) {
            continue;  // 已存在，跳过
          }
          
          triangleSet.add(triKey);
          triangles.push(tri);
          this._addEdge(edges, adjacency, i, j);
          this._addEdge(edges, adjacency, j, k);
          this._addEdge(edges, adjacency, i, k);
        }
      }
    }
    
    return {
      triangles,
      edges: Array.from(edges).map(e => e.split('-').map(Number)),
      internalEdges: [],
      adjacency
    };
  }


  _isTriangleOutwardFacing(tri, surfacePoints) {
    const [i, j, k] = tri;
    const pi = surfacePoints[i].position;
    const pj = surfacePoints[j].position;
    const pk = surfacePoints[k].position;
    
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
      x: cx - this.core.center.x,
      y: cy - this.core.center.y,
      z: cz - this.core.center.z
    };
    
    const dot = normal.x * toCenter.x + normal.y * toCenter.y + normal.z * toCenter.z;
    return dot > 0;
  }


  _isTriangleOccluded(tri, surfacePoints, coefficients, sphericalHarmonics) {
    const [i, j, k] = tri;
    const pi = surfacePoints[i].position;
    const pj = surfacePoints[j].position;
    const pk = surfacePoints[k].position;
    
    const cx = (pi.x + pj.x + pk.x) / 3;
    const cy = (pi.y + pj.y + pk.y) / 3;
    const cz = (pi.z + pj.z + pk.z) / 3;
    
    const dx = cx - this.core.center.x;
    const dy = cy - this.core.center.y;
    const dz = cz - this.core.center.z;
    const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (rCart < 1e-10) return false;
    
    const theta = Math.acos(dz / rCart);
    const phi = Math.atan2(dy, dx);
    const rSH = sphericalHarmonics.evaluate(coefficients, theta, phi);
    
    return rCart < rSH * 0.85;
  }


  _addEdge(edges, adjacency, i, j) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    edges.add(key);
    
    if (!adjacency.get(i).includes(j)) {
      adjacency.get(i).push(j);
    }
    if (!adjacency.get(j).includes(i)) {
      adjacency.get(j).push(i);
    }
  }

  // === 规则布料生成 ===

  /**
   * 生成规则网格布料
   * 
   * 创建 rows×cols 的规则矩形或圆形网格
   * 
   * @param {Number} rows - 行数
   * @param {Number} cols - 列数
   * @param {Object} options - 选项
   * @param {Number} options.width - 宽度（默认 1.0）
   * @param {Number} options.height - 高度（默认 1.0）
   * @param {String} options.shape - 形状：'rectangle' 或 'circle'（默认 'rectangle'）
   * @param {String} options.physicsModel - 物理模型：'pbd' 或 'force'（默认 'pbd'）
   * @returns {Object} 生成结果统计
   */
  generateClothMesh(rows, cols, options = {}) {
    const width = options.width ?? 1.0;
    const height = options.height ?? 1.0;
    const shape = options.shape ?? 'rectangle';
    const physicsModel = options.physicsModel ?? 'pbd';
    
    // 步骤 1: 生成控制点网格
    const controlPoints = [];
    
    if (shape === 'rectangle') {
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const u = j / cols;
          const v = i / rows;
          controlPoints.push(new Point(
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
          controlPoints.push(new Point(
            centerX + r * Math.cos(theta),
            centerY + r * Math.sin(theta),
            0
          ));
        }
      }
    } else {
      throw new Error(`Unknown cloth shape: ${shape}`);
    }
    
    // 步骤 2: 生成面（三角形索引）
    const faces = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * (cols + 1) + j;
        // 每个网格单元生成两个三角形
        faces.push([idx, idx + 1, idx + cols + 2]);
        faces.push([idx, idx + cols + 2, idx + cols + 1]);
      }
    }
    
    // 步骤 3: 构建拓扑（边和邻接）
    const topology = this._buildClothTopology(faces, controlPoints.length);
    
    // 步骤 4: 生成 UV 坐标
    const uvCoords = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        uvCoords.push({ u: j / cols, v: i / rows });
      }
    }
    
    // 步骤 5: 创建表面点（从控制点）
    const newSurfacePoints = controlPoints.map(cp => {
      const point = new Point(cp.x, cp.y, cp.z);
      
      // 初始化物理数据占位符
      point._physicsData = {
        position: { x: cp.x, y: cp.y, z: cp.z },
        prevPosition: { x: cp.x, y: cp.y, z: cp.z },
        velocity: { x: 0, y: 0, z: 0 },
        fixed: false
      };
      
      return point;
    });
    
    // 步骤 6: 生成粒子（不生成约束）
    const globalMassScale = this.core.physics.mass || 1.0;
    const totalPointCount = newSurfacePoints.length;
    const surfaceMass = globalMassScale / totalPointCount;
    
    const particles = newSurfacePoints.map((point, index) => ({
      position: point._physicsData.position,
      prevPosition: point._physicsData.prevPosition,
      velocity: point._physicsData.velocity,
      mass: surfaceMass,
      invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
      fixed: false,
      _index: index,
      _type: 'surface'
    }));
    
    // 步骤 7: 写入 core 状态
    this.core.surfacePoints = newSurfacePoints;
    this.core.controlPoints = controlPoints;  // 保留控制点引用
    
    this.core.representation.physicsState = {
      physicsModel,
      particles,
      constraints: [],  // ⭐ 由 ObjectPhysics.rebuildPhysicsTopology() 填充
      surfaceStartIndex: 0,
      internalStartIndex: particles.length,
      surfaceCount: particles.length,
      internalCount: 0,
      // 布料特有数据
      vertices: controlPoints.map(cp => ({ x: cp.x, y: cp.y, z: cp.z })),
      faces,
      uvCoords
    };
    
    this.core.representation.topology = topology;
    this.core.representation.type = 'cloth';
    
    // 步骤 8: 标记布料为体积模式（虽然是 2D，但需要物理系统）
    this.core._isVolumetric = true;
    
    // 步骤 9: 更新版本和缓存
    this.core._surfacePointVersion++;
    this.core._boundingBoxDirty = true;
    this.core.representation.geometryCache.volume = null;
    this.core.representation.geometryCache.surfaceArea = null;
    this.core.representation.geometryCache.sections.clear();
    this.core.metadata.modified = Date.now();
    
    if (this.core.verbose) {
      console.log(`[ObjectGeometry] Cloth mesh generated: ${newSurfacePoints.length} vertices, ${faces.length} faces`);
    }
    
    return {
      vertices: controlPoints.length,
      faces: faces.length,
      triangles: topology.triangles.length,
      edges: topology.edges.length,
      uvCoords: uvCoords.length,
      shape,
      dimensions: { rows, cols, width, height }
    };
  }

  /**
   * 构建布料拓扑
   * 
   * 从三角形面列表构建边和邻接信息
   * 
   * @private
   * @param {Array} faces - 三角形面索引数组 [[i0,i1,i2], ...]
   * @param {Number} vertexCount - 顶点总数
   * @returns {Object} { triangles, edges, adjacency, degree }
   */
  _buildClothTopology(faces, vertexCount) {
    const triangles = faces;
    const edgeSet = new Set();
    const adjacency = new Map();
    
    // 初始化邻接列表
    for (let i = 0; i < vertexCount; i++) {
      adjacency.set(i, []);
    }
    
    // 遍历所有三角形，提取边
    for (const face of faces) {
      const [i0, i1, i2] = face;
      
      // 添加三条边
      this._addEdge(edgeSet, adjacency, i0, i1);
      this._addEdge(edgeSet, adjacency, i1, i2);
      this._addEdge(edgeSet, adjacency, i2, i0);
    }
    
    // 转换 Set 为数组
    const edges = Array.from(edgeSet).map(key => {
      const [i, j] = key.split('-').map(Number);
      return [i, j];
    });
    
    // 计算顶点度数
    const degree = new Map();
    for (const [vertex, neighbors] of adjacency) {
      degree.set(vertex, neighbors.length);
    }
    
    return {
      triangles,
      edges,
      internalEdges: [],  // 布料没有内部边
      adjacency,
      degree
    };
  }

  // === 2D 有机布料生成 ===

  generateOrganicCloth(boundaryPoints, options = {}) {
    if (!boundaryPoints || boundaryPoints.length < 3) {
      throw new Error('At least 3 boundary points are required');
    }

    const order = options.order ?? 5;
    const spacing = options.spacing ?? 0.015;  // 1.5cm
    const relaxIterations = options.relaxIterations ?? 20;
    const surfaceRatio = options.surfaceRatio ?? 0.4;
    const physicsModel = options.physicsModel ?? this.core.physics.model ?? 'pbd';

    const FittingCalculator = options.fitter;
    const Matrix = options.Matrix;

    if (!FittingCalculator) {
      throw new Error('FittingCalculator (fitter) required in options');
    }

    if (!Matrix) {
      throw new Error('Matrix class required in options');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 1: 拟合边界（椭圆傅里叶描述符）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (!this._fittingCalculator) {
      this._fittingCalculator = new FittingCalculator({
        Matrix,
        verbose: this.core.verbose
      });
    }

    const fitter = this._fittingCalculator;

    // ⭐ 使用非增量版本进行首次拟合（完整边界）
    const fitResult = fitter.fit2DEllipticFourier(boundaryPoints, order, {
      verbose: this.core.verbose
    });

    if (this.core.verbose) {
      console.log(`[Object] EFD fit: order=${order}, residualX=${fitResult.residualX.toExponential(3)}, residualY=${fitResult.residualY.toExponential(3)}`);
    }

    // ⭐ 初始化增量拟合状态栈（为未来的边界编辑做准备）
    this._fitStackX = [];
    this._fitStackY = [];

    // 存储 EFD 表示
    this.core.representation = {
      type: 'elliptic-fourier-2d',
      isClosed: true,
      data: {
        coeffsX: fitResult.coeffsX,
        coeffsY: fitResult.coeffsY,
        order: fitResult.order,
        fitResult  // 保留完整结果（包含 evaluate 函数）
      },
      physicsState: this.core.representation?.physicsState ?? {
        physicsModel,
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
        internalEdges: [],
        adjacency: null,
        degree: null
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
      metadata: {}
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 2: 计算目标点数（2D 版本）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let targetCount = options.targetCount;

    if (targetCount === undefined) {
      // 计算边界框
      const bbox = this._compute2DBoundingBox(boundaryPoints);
      const width = bbox.max.x - bbox.min.x;
      const height = bbox.max.y - bbox.min.y;

      // 面积估算
      const area = width * height * 0.7;  // 假设填充率 70%

      // 点数估算：N ≈ Area / spacing²
      const estimatedCount = Math.round(area / (spacing * spacing));

      // 安全上限
      const safetyLimit = 3000;
      targetCount = Math.min(estimatedCount, safetyLimit);

      // 最小值
      targetCount = Math.max(targetCount, 30);

      if (this.core.verbose) {
        console.log(`[Object] Auto-calculated targetCount: ${targetCount} (estimated: ${estimatedCount}, area: ${area.toFixed(4)})`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 3: 2D 气泡填充
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const { surfacePoints, internalPoints } = this._generate2DBubblePacking(
      fitResult,
      targetCount,
      spacing,
      relaxIterations,
      surfaceRatio
    );

    if (this.core.verbose) {
      console.log(`[Object] 2D bubble packing: ${surfacePoints.length} surface, ${internalPoints.length} internal`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 4: 构建拓扑（三角剖分）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const topology = this._build2DTopology(surfacePoints, internalPoints, spacing * 2.5);

    if (this.core.verbose) {
      console.log(`[Object] 2D topology: ${topology.triangles.length} triangles, ${topology.edges.length} edges`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 5: 创建物理粒子
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 更新 surfacePoints（指针切换）
    const newSurfacePoints = surfacePoints.map(sp =>
      new Point(sp.position.x, sp.position.y, 0)  // 2D: z = 0
    );

    const globalMassScale = this.core.physics.mass || 1.0;
    const surfaceMass = globalMassScale * 0.6 / surfacePoints.length;
    const internalMass = globalMassScale * 0.4 / internalPoints.length;

    const surfaceParticles = newSurfacePoints.map((point, index) => {
      if (!point._physicsData) {
        point._physicsData = {
          position: { x: point.x, y: point.y, z: 0 },
          prevPosition: { x: point.x, y: point.y, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          fixed: false
        };
      }

      return {
        position: point._physicsData.position,
        prevPosition: point._physicsData.prevPosition,
        velocity: point._physicsData.velocity,
        mass: surfaceMass,
        invMass: surfaceMass > 0 ? 1 / surfaceMass : 0,
        fixed: false,
        _index: index,
        _type: 'surface'
      };
    });

    const internalParticles = internalPoints.map((node, index) => {
      return {
        position: node.position,
        prevPosition: { x: node.position.x, y: node.position.y, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        mass: internalMass,
        invMass: internalMass > 0 ? 1 / internalMass : 0,
        fixed: false,
        _index: surfacePoints.length + index,
        _type: 'internal'
      };
    });

    const particles = [...surfaceParticles, ...internalParticles];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 步骤 6: 几何生成完成
    // 约束由 ObjectPhysics.rebuildPhysicsTopology() 生成
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 步骤 7: 更新物理状态
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.core.representation.physicsState = {
      physicsModel,
      particles,
      constraints: [],  // ⭐ 由 ObjectPhysics.rebuildPhysicsTopology() 填充
      surfaceStartIndex: 0,
      internalStartIndex: surfacePoints.length,
      surfaceCount: surfacePoints.length,
      internalCount: internalPoints.length
    };

    this.core.representation.topology = topology;

    this.core.surfacePoints = newSurfacePoints;
    this.core._isVolumetric = true;

    this.core._surfacePointVersion++;
    this.core._boundingBoxDirty = true;
    this.core.metadata.modified = Date.now();

    if (this.core.verbose) {
      console.log(`[ObjectGeometry] Organic cloth generated: ${this.core.surfacePoints.length} surface points`);
    }

    return {
      surfacePoints: surfacePoints.length,
      internalPoints: internalPoints.length,
      triangles: topology.triangles.length,
      edges: topology.edges.length,
      fitResult,
      isVolumetric: this.core._isVolumetric,
      controlPointsPreserved: this.core.controlPoints.length
    };
  }


  /**
   * 2D 气泡填充算法
   * 
   * @private
   * @param {Object} fitResult - EFD 拟合结果
   * @param {Number} targetCount - 目标点数
   * @param {Number} spacing - 点间距
   * @param {Number} iterations - 松弛迭代次数
   * @param {Number} surfaceRatio - 表面点比例
   * @returns {Object} { surfacePoints, internalPoints }


  // === 2D 布料辅助方法 ===

  _generate2DBubblePacking(fitResult, targetCount, spacing, iterations, surfaceRatio) {
    // 计算边界框
    const samples = fitResult.sample(100);
    const bbox = this._compute2DBoundingBox(samples);

    const boxWidth = bbox.max.x - bbox.min.x;
    const boxHeight = bbox.max.y - bbox.min.y;

    // 随机撒点
    const points = [];
    const cx = (bbox.min.x + bbox.max.x) / 2;
    const cy = (bbox.min.y + bbox.max.y) / 2;

    for (let i = 0; i < targetCount; i++) {
      const x = cx + (Math.random() - 0.5) * boxWidth;
      const y = cy + (Math.random() - 0.5) * boxHeight;

      // 检查是否在边界内
      if (this._isPointInsideEFD(x, y, fitResult)) {
        points.push({
          position: { x, y, z: 0 },
          isSurface: false
        });
      }
    }

    if (this.core.verbose) {
      console.log(`[Object] 2D bubble packing: ${points.length} points inside boundary`);
    }

    // 松弛迭代（2D 斥力）
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < points.length; i++) {
        const pi = points[i].position;
        let fx = 0, fy = 0;

        for (let j = 0; j < points.length; j++) {
          if (i === j) continue;

          const pj = points[j].position;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < spacing && dist > 1e-6) {
            const force = (spacing - dist) / dist;
            fx += dx * force;
            fy += dy * force;
          }
        }

        // 更新位置
        pi.x += fx * 0.1;
        pi.y += fy * 0.1;

        // 边界约束（保持在 EFD 内部）
        if (!this._isPointInsideEFD(pi.x, pi.y, fitResult)) {
          // 投影到最近的边界点
          const projected = this._projectToEFDBoundary(pi.x, pi.y, fitResult);
          pi.x = projected.x;
          pi.y = projected.y;
        }
      }
    }

    // 标记表面点（距离边界最近的点）
    const surfaceCount = Math.floor(points.length * surfaceRatio);
    const pointsWithDist = points.map(p => ({
      point: p,
      distToBoundary: this._distanceToEFDBoundary(p.position.x, p.position.y, fitResult)
    }));

    // 按距离排序
    pointsWithDist.sort((a, b) => a.distToBoundary - b.distToBoundary);

    // 前 surfaceCount 个标记为表面点
    for (let i = 0; i < surfaceCount; i++) {
      pointsWithDist[i].point.isSurface = true;
    }

    // 吸附表面点到边界
    for (let i = 0; i < surfaceCount; i++) {
      const p = pointsWithDist[i].point.position;
      const projected = this._projectToEFDBoundary(p.x, p.y, fitResult);
      p.x = projected.x;
      p.y = projected.y;
    }

    const surfacePoints = points.filter(p => p.isSurface);
    const internalPoints = points.filter(p => !p.isSurface);

    return { surfacePoints, internalPoints };
  }


  /**
   * 判断点是否在 EFD 边界内（射线法）
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Boolean} 是否在内部
   */
  _isPointInsideEFD(x, y, fitResult) {
    // 射线法：从点发射水平射线，计算与边界的交点数
    // 奇数个交点 → 在内部，偶数个交点 → 在外部

    const samples = fitResult.sample(100);
    let intersections = 0;

    for (let i = 0; i < samples.length; i++) {
      const p1 = samples[i];
      const p2 = samples[(i + 1) % samples.length];

      // 检查线段 (p1, p2) 是否与射线 (x, y) → (+∞, y) 相交
      if ((p1.y > y) !== (p2.y > y)) {
        // 计算交点的 x 坐标
        const xIntersect = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);

        if (xIntersect > x) {
          intersections++;
        }
      }
    }

    return intersections % 2 === 1;
  }


  /**
   * 投影点到 EFD 边界
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Object} { x, y }
   */
  _projectToEFDBoundary(x, y, fitResult) {
    const samples = fitResult.sample(100);
    let minDist = Infinity;
    let closest = null;

    for (const sample of samples) {
      const dx = sample.x - x;
      const dy = sample.y - y;
      const dist = dx * dx + dy * dy;

      if (dist < minDist) {
        minDist = dist;
        closest = sample;
      }
    }

    return closest || { x, y };
  }


  /**
   * 计算点到 EFD 边界的距离
   * 
   * @private
   * @param {Number} x - x 坐标
   * @param {Number} y - y 坐标
   * @param {Object} fitResult - EFD 拟合结果
   * @returns {Number} 距离
   */
  _distanceToEFDBoundary(x, y, fitResult) {
    const projected = this._projectToEFDBoundary(x, y, fitResult);
    const dx = projected.x - x;
    const dy = projected.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }


  /**
   * 构建 2D 拓扑（三角剖分）
   * 
   * 使用简单的"最近邻连接法"：
   * - 对每个点，连接到最近的 K 个邻居
   * - 使用 Delaunay 风格的连接策略
   * 
   * @private
   * @param {Array} surfacePoints - 表面点
   * @param {Array} internalPoints - 内部点
   * @param {Number} maxDist - 最大连接距离
   * @returns {Object} { triangles, edges, adjacency }
   */
  _build2DTopology(surfacePoints, internalPoints, maxDist) {
    const allPoints = [...surfacePoints, ...internalPoints];
    const n = allPoints.length;

    const edges = [];
    const edgeSet = new Set();

    // 为每个点找到最近的 K 个邻居
    const K = 6;  // 2D 网格平均连接数

    for (let i = 0; i < n; i++) {
      const pi = allPoints[i].position;

      // 计算到所有其他点的距离
      const neighbors = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;

        const pj = allPoints[j].position;
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          neighbors.push({ index: j, dist });
        }
      }

      // 按距离排序，取前 K 个
      neighbors.sort((a, b) => a.dist - b.dist);
      const kNearest = neighbors.slice(0, K);

      // 添加边
      for (const neighbor of kNearest) {
        const a = Math.min(i, neighbor.index);
        const b = Math.max(i, neighbor.index);
        const edgeKey = `${a}-${b}`;

        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push([a, b]);
        }
      }
    }

    // 构建三角形（简化版：使用贪心策略）
    const triangles = [];
    const triangleSet = new Set();

    for (let i = 0; i < n; i++) {
      const pi = allPoints[i].position;

      // 找到相邻的点
      const adjacentIndices = [];
      for (const [a, b] of edges) {
        if (a === i) adjacentIndices.push(b);
        if (b === i) adjacentIndices.push(a);
      }

      // 尝试形成三角形
      for (let j = 0; j < adjacentIndices.length; j++) {
        for (let k = j + 1; k < adjacentIndices.length; k++) {
          const idx1 = adjacentIndices[j];
          const idx2 = adjacentIndices[k];

          // 检查 idx1 和 idx2 是否相邻
          const edgeKey = `${Math.min(idx1, idx2)}-${Math.max(idx1, idx2)}`;
          if (edgeSet.has(edgeKey)) {
            // 形成三角形
            const tri = [i, idx1, idx2].sort((a, b) => a - b);
            const triKey = tri.join('-');

            if (!triangleSet.has(triKey)) {
              triangleSet.add(triKey);
              triangles.push(tri);
            }
          }
        }
      }
    }

    // 构建邻接表
    const adjacency = Array(n).fill(null).map(() => []);
    for (const [a, b] of edges) {
      adjacency[a].push(b);
      adjacency[b].push(a);
    }

    return {
      triangles,
      edges,
      adjacency
    };
  }


  /**
   * 构建 2D 结构约束（Structural）
   * 
   * @private
   * @param {Array} edges - 边列表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */

  /**
   * 构建 2D 剪切约束（Shear）
   * 
   * @private
   * @param {Array} triangles - 三角形列表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */

  /**
   * 构建 2D 弯曲约束（Bend）
   * 
   * @private
   * @param {Array} edges - 边列表
   * @param {Array} adjacency - 邻接表
   * @param {String} physicsModel - 物理模型
   * @returns {Array} 约束列表
   */

  /**
   * 计算 2D 边界框
   * 
   * @private
   * @param {Array} points - 点集
   * @returns {Object} { min: {x, y}, max: {x, y} }
   */
  _compute2DBoundingBox(points) {
    if (points.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY }
    };
  }


  // === 材料参数 ===


  // === 规则布料生成 ===




  // === 碰撞体 ===


  // === 法线更新 ===

  _updateNormals() {
    const topology = this.core.representation.topology;
    if (!topology || !topology.triangles) {
      return;  // 没有拓扑信息，跳过
    }

    const particles = this.core.representation.physicsState?.particles;
    if (!particles) {
      return;  // 没有物理粒子，跳过
    }

    const surfaceCount = this.core.representation.physicsState?.surfaceCount || this.core.surfacePoints.length;

    // 步骤 1: 清零所有表面点的法向
    for (let i = 0; i < surfaceCount; i++) {
      const p = particles[i];
      if (!p.normal) {
        p.normal = { x: 0, y: 0, z: 0 };
      } else {
        p.normal.x = 0;
        p.normal.y = 0;
        p.normal.z = 0;
      }
    }

    // 步骤 2 & 3: 遍历三角形，计算并累加面法向
    for (const tri of topology.triangles) {
      const [ia, ib, ic] = tri;

      // 跳过无效索引
      if (ia >= surfaceCount || ib >= surfaceCount || ic >= surfaceCount) {
        continue;
      }

      const pa = particles[ia].position;
      const pb = particles[ib].position;
      const pc = particles[ic].position;

      // 计算边向量
      const abx = pb.x - pa.x;
      const aby = pb.y - pa.y;
      const abz = pb.z - pa.z;

      const acx = pc.x - pa.x;
      const acy = pc.y - pa.y;
      const acz = pc.z - pa.z;

      // 叉积：面法向 = AB × AC
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      // 面法向的模长（面积的两倍）作为权重
      // 不归一化，让大三角形贡献更多权重

      // 累加到三个顶点
      particles[ia].normal.x += nx;
      particles[ia].normal.y += ny;
      particles[ia].normal.z += nz;

      particles[ib].normal.x += nx;
      particles[ib].normal.y += ny;
      particles[ib].normal.z += nz;

      particles[ic].normal.x += nx;
      particles[ic].normal.y += ny;
      particles[ic].normal.z += nz;
    }

    // 步骤 4: 归一化所有顶点法向
    for (let i = 0; i < surfaceCount; i++) {
      const n = particles[i].normal;
      const mag = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);

      if (mag > 1e-10) {
        n.x /= mag;
        n.y /= mag;
        n.z /= mag;
      } else {
        // 退化情况：使用默认法向
        n.x = 0;
        n.y = 1;
        n.z = 0;
      }
    }
  }



  // === 材质查询 ===

  setMaterialProperties(propertyFunc) {
    this.core.representation.material.uniform = false;
    this.core.representation.material.properties = propertyFunc;
  }



  getMaterialAt(point) {
    if (this.core.representation.material.uniform) {
      return { stiffness: 1000, damping: 10, mass: 1.0 };
    }

    const dx = point.x - this.core.center.x;
    const dy = point.y - this.core.center.y;
    const dz = point.z - this.core.center.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (r < 1e-10) {
      return this.getMaterialAt({ x: point.x + 0.01, y: point.y, z: point.z });
    }

    const theta = Math.acos(dz / r);
    const phi = Math.atan2(dy, dx);

    return this.core.representation.material.properties(theta, phi);
  }


  // === 物理拓扑重建 ===

  // === 渲染数据 ===

  getRenderData() {
    return {
      // 控制点（编辑手柄）
      controlPoints: this.core.controlPoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        type: 'control'
      })),
      
      // 表面点（物体渲染）
      surfacePoints: this.core.surfacePoints.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z,
        type: 'surface'
      })),
      
      // 拓扑信息（用于绘制网格）
      topology: {
        triangles: this.core.representation.topology.triangles,
        edges: this.core.representation.topology.edges
      },
      
      // 状态标记
      isVolumetric: this.core._isVolumetric,
      
      // 渲染提示
      renderHints: {
        showControlPoints: this.core._isVolumetric,  // 体积模式下显示控制点手柄
        showSurfaceMesh: true,                   // 始终显示表面网格
        controlPointSize: this.core._isVolumetric ? 0.05 : 0.03,  // 控制点大小
        surfacePointSize: 0.02                   // 表面点大小
      }
    };
  }

  // === 碰撞体生成 ===

  /**
   * 从球谐函数创建碰撞体
   * 
   * 用于高效碰撞检测
   */
  createColliderFromSphericalHarmonics() {
    const data = this.core.representation.data;
    if (!data || !data.coefficients || !data.sphericalHarmonics) {
      return null;
    }
    
    return {
      type: 'spherical-harmonics',
      center: { ...this.core.center },
      coefficients: data.coefficients,
      sphericalHarmonics: data.sphericalHarmonics,
      
      // SDF 评估函数
      signedDistance: (point) => {
        const dx = point.x - this.core.center.x;
        const dy = point.y - this.core.center.y;
        const dz = point.z - this.core.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (r < 1e-10) {
          return -data.sphericalHarmonics.evaluate(0, 0, data.coefficients);
        }
        
        const theta = Math.acos(dz / r);
        const phi = Math.atan2(dy, dx);
        
        const rSH = data.sphericalHarmonics.evaluate(theta, phi, data.coefficients);
        return r - rSH;
      },
      
      // 法线评估函数
      normal: (point) => {
        const dx = point.x - this.core.center.x;
        const dy = point.y - this.core.center.y;
        const dz = point.z - this.core.center.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (r < 1e-10) {
          return { x: 0, y: 1, z: 0 };
        }
        
        return { x: dx / r, y: dy / r, z: dz / r };
      }
    };
  }

  // === 稳健性辅助方法 ===

  /**
   * 安全的 acos 计算（处理数值误差）
   * 
   * 当输入略超出 [-1, 1] 范围时（由于浮点误差），
   * 将其钳制到有效范围内。
   * 
   * @private
   * @param {Number} x - 输入值
   * @returns {Number} acos(x)，范围 [0, π]
   */
  _safeAcos(x) {
    // 钳制到 [-1, 1] 范围
    if (x <= -1) return Math.PI;
    if (x >= 1) return 0;
    return Math.acos(x);
  }

  /**
   * 稳健的球坐标计算
   * 
   * 处理极点附近的数值不稳定性和退化情况。
   * 
   * @private
   * @param {Object} position - 笛卡尔坐标 {x, y, z}
   * @param {Object} center - 中心点 {x, y, z}
   * @returns {Object} { theta, phi, r, valid }
   */
  _robustSphericalCoords(position, center) {
    const dx = position.x - center.x;
    const dy = position.y - center.y;
    const dz = position.z - center.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // 退化：点在中心
    if (r < 1e-10) {
      return {
        theta: 0,
        phi: 0,
        r: 0,
        valid: false
      };
    }
    
    // 计算 theta（使用 _safeAcos）
    const theta = this._safeAcos(dz / r);
    
    // 计算 phi
    // 在极点附近（theta ≈ 0 或 π），phi 不稳定，但实际不影响结果
    const phi = Math.atan2(dy, dx);
    
    return {
      theta,
      phi,
      r,
      valid: true
    };
  }

  /**
   * 稳健的球谐评估
   * 
   * 包装球谐函数评估，添加退化检测和错误处理。
   * 
   * @private
   * @param {Object} sphericalHarmonics - 球谐函数对象
   * @param {Array} coefficients - 系数
   * @param {Number} theta - 极角
   * @param {Number} phi - 方位角
   * @returns {Number} 半径值，退化时返回 null
   */
  _robustSHEvaluate(sphericalHarmonics, coefficients, theta, phi) {
    try {
      const r = sphericalHarmonics.evaluate(theta, phi, coefficients);
      
      // 检查结果有效性
      if (!isFinite(r) || r <= 0) {
        return null;
      }
      
      return r;
    } catch (error) {
      if (this.core.verbose) {
        console.warn('[ObjectGeometry] SH evaluation error:', error.message);
      }
      return null;
    }
  }
}

