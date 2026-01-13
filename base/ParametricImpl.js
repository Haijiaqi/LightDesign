/**
 * ParametricImpl.js - 参数化曲面实现层
 * 
 * ============================================================================
 * 版本: v2.0 (生产版)
 * 日期: 2026-01-03
 * ============================================================================
 * 
 * 职责：
 * - 球谐函数拟合计算（fitSpherical）
 * - 坐标转换（cartesianToSpherical, sphericalToCartesian）
 * - 边界回调生成（createSphericalBoundaryCallback）
 * - 遮挡回调生成（createOcclusionCallback）
 * - 几何量计算（computeVolume, computeSurfaceArea, computeSection）
 * - 碰撞体构建（createSphericalCollider）
 * 
 * 外部依赖（通过参数传入）：
 * - shInstance: 球谐函数实例
 * - fitter: 拟合器实例
 * - Matrix: 矩阵库
 * ============================================================================
 */

export class ParametricImpl {

  // ==========================================================================
  // 常量定义
  // ==========================================================================

  static EPSILON = 1e-10;
  static SURFACE_THRESHOLD = 0.92;  // distanceRatio >= 0.92 为表面层

  // ==========================================================================
  // 2.1 球谐拟合
  // 【照抄原始逻辑】从 Object.js fitSphericalHarmonics (第566-715行)
  // 注意：核心算法在 FittingCalculator 中，这里只做参数转换和调用
  // ==========================================================================

  /**
   * 球谐拟合
   * 
   * @param {Array<{x,y,z}>} positions - 控制点位置
   * @param {number} centerX, centerY, centerZ - 几何中心
   * @param {number} order - 球谐阶数
   * @param {object[]} fitStack - 增量拟合状态栈（会被更新）
   * @param {object} fitterInstance - FittingCalculator 实例
   * @param {class} Matrix - Matrix 类
   * @param {object} shInstance - SphericalHarmonics 实例
   * @param {boolean} useIncremental - 是否使用增量模式
   * @param {boolean} verbose
   * @returns {{coefficients, order, residual, condition, fitStack}}
   */
  static fitSpherical(
    positions,
    centerX, centerY, centerZ,
    order,
    fitStack,
    fitterInstance, Matrix, shInstance,
    useIncremental, verbose
  ) {
    /*
     * 设计原则：
     * 1. ParametricImpl 负责构建设计矩阵（调用 SphericalHarmonics）
     * 2. FittingCalculator 只做通用线性求解（不知道拟合什么）
     * 
     * fitStack 结构（新版）：
     * - fitStack[n] = 前 n+1 个点的 QR 状态
     * - fitStack.meta = { center, cols } 元数据
     * 
     * 增量拟合通路：
     * - SphericalHarmonics.buildDesignMatrix() → A, b
     * - fitter.fitIncremental1D(A, b, fitStack) → coefficients
     */

    const center = { x: centerX, y: centerY, z: centerZ };
    const cols = (order + 1) * (order + 1);

    // 初始化 fitStack.meta
    if (!fitStack.meta) {
      fitStack.meta = { center: null, cols: 0 };
    }

    // 检查中心是否变化（需要重建）
    if (useIncremental && fitStack.meta.center) {
      const oldCenter = fitStack.meta.center;
      if (oldCenter.x !== centerX || oldCenter.y !== centerY || oldCenter.z !== centerZ) {
        if (verbose) {
          console.log('[ParametricImpl] Center changed, rebuilding...');
        }
        fitStack.length = 0;
        fitStack.meta = { center: null, cols: 0 };
      }
    }

    // 检查阶数是否变化（需要重建）
    // 注意：列数检查已经在 FittingCalculator 中进行，这里只更新 meta
    if (useIncremental && fitStack.meta.cols !== cols && fitStack.meta.cols !== 0) {
      if (verbose) {
        console.log('[ParametricImpl] Order changed, rebuilding...');
      }
      fitStack.length = 0;
      fitStack.meta = { center: null, cols: 0 };
    }

    // 1. 构建设计矩阵
    const design = shInstance.buildDesignMatrix(positions, center, { order });
    
    // 2. 转换为行数组格式（FittingCalculator 期望的格式）
    //    SphericalHarmonics 返回行主序：data[row * cols + col]
    const m = design.rows;
    const n = design.cols;
    const A = [];
    for (let i = 0; i < m; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        row.push(design.data[i * n + j]);
      }
      A.push(row);
    }
    const b = Array.from(design.b);

    // 3. 调用通用拟合接口
    let result;
    if (useIncremental) {
      result = fitterInstance.fitIncremental1D(A, b, fitStack, { verbose });
      
      // 更新元数据
      fitStack.meta.center = { ...center };
      fitStack.meta.cols = cols;
      
      if (verbose) {
        console.log(`[ParametricImpl] Incremental fit complete, stack size: ${fitStack.length}`);
      }
    } else {
      // 全量拟合
      result = fitterInstance.fitLinear(A, b, { verbose });
    }

    return {
      coefficients: result.coefficients,
      order,
      residual: result.residual ?? 0,
      condition: result.condition ?? 1,
      fitStack: fitStack
    };
  }

  // ==========================================================================
  // 2.2 坐标变换
  // ==========================================================================

  /**
   * 笛卡尔坐标转球坐标
   */
  static cartesianToSpherical(x, y, z, centerX, centerY, centerZ) {
    const dx = x - centerX;
    const dy = y - centerY;
    const dz = z - centerZ;

    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (r < ParametricImpl.EPSILON) {
      return { r: 0, theta: 0, phi: 0 };
    }

    const theta = Math.acos(Math.max(-1, Math.min(1, dz / r)));  // [0, π]
    const phi = Math.atan2(dy, dx);  // [-π, π]

    return { r, theta, phi };
  }

  /**
   * 球坐标转笛卡尔坐标
   */
  static sphericalToCartesian(r, theta, phi, centerX, centerY, centerZ) {
    const sinTheta = Math.sin(theta);
    return {
      x: centerX + r * sinTheta * Math.cos(phi),
      y: centerY + r * sinTheta * Math.sin(phi),
      z: centerZ + r * Math.cos(theta)
    };
  }

  // ==========================================================================
  // 2.3 边界回调生成
  // 【照抄原始逻辑】从 Object.js _generateBubblePacking 中的边界判定逻辑
  // ==========================================================================

  /**
   * 创建球谐边界回调
   * 
   * @param {number[]} coefficients
   * @param {number} centerX, centerY, centerZ
   * @param {object} shInstance
   * @param {number} surfaceThreshold - 表面判定阈值，默认 0.92
   * @returns {function} (x,y,z) => BoundaryCallbackResult
   */
  static createSphericalBoundaryCallback(coefficients, centerX, centerY, centerZ, shInstance, surfaceThreshold) {
    const threshold = surfaceThreshold ?? ParametricImpl.SURFACE_THRESHOLD;

    return (x, y, z) => {
      // 1. 计算球坐标
      const dx = x - centerX;
      const dy = y - centerY;
      const dz = z - centerZ;
      const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (rCart < ParametricImpl.EPSILON) {
        // 在中心点
        return {
          isInside: true,
          projectedPoint: { x: centerX, y: centerY, z: centerZ },
          isSurface: false,
          distanceRatio: 0
        };
      }

      const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
      const phi = Math.atan2(dy, dx);

      // 2. 评估球谐函数得到理想半径
      const rSH = shInstance.evaluate(coefficients, theta, phi);
      
      // 【修复】验证 rSH 有效性
      if (!Number.isFinite(rSH) || rSH <= 0) {
        // 返回默认值：假设在外部
        return {
          isInside: false,
          projectedPoint: { x, y, z },
          isSurface: false,
          distanceRatio: Infinity
        };
      }

      // 3. 计算距离比
      const distanceRatio = rCart / rSH;

      // 4. 判断内外
      const isInside = distanceRatio <= 1.0;

      // 5. 判断是否为表面层
      const isSurface = distanceRatio >= threshold;

      // 6. 计算投影点（表面上的点）
      const scale = rSH / rCart;
      const projectedPoint = {
        x: centerX + dx * scale,
        y: centerY + dy * scale,
        z: centerZ + dz * scale
      };

      return {
        isInside,
        projectedPoint,
        isSurface,
        distanceRatio
      };
    };
  }

  // ==========================================================================
  // 2.4 遮挡回调生成
  // 【照抄原始逻辑】从 Object.js _isTriangleOccluded (第2319-2341行)
  // ==========================================================================

  /**
   * 创建遮挡判定回调
   * 
   * @param {number[]} coefficients
   * @param {number} centerX, centerY, centerZ
   * @param {object} shInstance
   * @param {number} threshold - 遮挡阈值，默认 0.85
   * @returns {function} (cx,cy,cz) => boolean
   */
  static createOcclusionCallback(coefficients, centerX, centerY, centerZ, shInstance, threshold) {
    const occlusionThreshold = threshold ?? 0.85;

    return (cx, cy, cz) => {
      // 计算三角形中心到几何中心的距离
      const dx = cx - centerX;
      const dy = cy - centerY;
      const dz = cz - centerZ;
      const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (rCart < ParametricImpl.EPSILON) {
        return false;  // 在中心，不遮挡
      }

      const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
      const phi = Math.atan2(dy, dx);
      const rSH = shInstance.evaluate(coefficients, theta, phi);
      
      // 【修复】验证 rSH 有效性
      if (!Number.isFinite(rSH) || rSH <= 0) {
        return false;  // 无效值，不遮挡
      }

      // 如果三角形中心距离小于表面距离的 threshold 倍，则被遮挡
      return rCart < rSH * occlusionThreshold;
    };
  }

  // ==========================================================================
  // 2.5 几何量计算
  // 【照抄原始逻辑】从 Object.js getVolume, getSurfaceArea, getSection
  // 注意：核心算法在 SphericalHarmonics 中
  // ==========================================================================

  /**
   * 计算体积
   */
  static computeVolume(coefficients, centerX, centerY, centerZ, shInstance) {
    // 委托给 SphericalHarmonics 实例
    return shInstance.computeVolume(coefficients, { x: centerX, y: centerY, z: centerZ });
  }

  /**
   * 计算表面积
   */
  static computeSurfaceArea(coefficients, centerX, centerY, centerZ, shInstance) {
    return shInstance.computeSurfaceArea(coefficients, { x: centerX, y: centerY, z: centerZ });
  }

  /**
   * 计算截面
   */
  static computeSection(coefficients, centerX, centerY, centerZ, plane, shInstance) {
    return shInstance.computeSection(coefficients, { x: centerX, y: centerY, z: centerZ }, plane);
  }

  // ==========================================================================
  // 2.6 碰撞体创建
  // 【照抄原始逻辑】从 Object.js createColliderFromSphericalHarmonics (第1601-1677行)
  // ==========================================================================

  /**
   * 创建球谐碰撞体
   */
  static createSphericalCollider(coefficients, centerX, centerY, centerZ, shInstance) {
    return {
      /**
       * 判断点是否在内部
       */
      containsPoint(x, y, z) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dz = z - centerZ;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (rCart < ParametricImpl.EPSILON) return true;

        const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
        const phi = Math.atan2(dy, dx);
        const rSH = shInstance.evaluate(coefficients, theta, phi);
        
        // 【修复】验证 rSH 有效性
        if (!Number.isFinite(rSH) || rSH <= 0) return false;

        return rCart <= rSH;
      },

      /**
       * 获取表面法向量
       */
      getNormal(x, y, z) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dz = z - centerZ;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (rCart < ParametricImpl.EPSILON) {
          return { x: 0, y: 1, z: 0 };
        }

        const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
        const phi = Math.atan2(dy, dx);

        // 计算梯度（如果 shInstance 支持）
        if (typeof shInstance.evaluateGradient === 'function') {
          const gradient = shInstance.evaluateGradient(coefficients, theta, phi);
          const radial = { x: dx / rCart, y: dy / rCart, z: dz / rCart };
          const gradMag = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y + gradient.z * gradient.z);

          if (gradMag < ParametricImpl.EPSILON) {
            return radial;
          }

          const nx = radial.x - gradient.x / gradMag;
          const ny = radial.y - gradient.y / gradMag;
          const nz = radial.z - gradient.z / gradMag;
          const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);

          return mag > ParametricImpl.EPSILON
            ? { x: nx / mag, y: ny / mag, z: nz / mag }
            : radial;
        }

        // 默认返回径向方向
        return { x: dx / rCart, y: dy / rCart, z: dz / rCart };
      },

      /**
       * 将点投影到表面
       */
      projectToSurface(x, y, z) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dz = z - centerZ;
        const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (rCart < ParametricImpl.EPSILON) {
          // 在中心，返回任意表面点
          const rSH = shInstance.evaluate(coefficients, 0, 0);
          // 【修复】验证 rSH 有效性
          const safeR = (Number.isFinite(rSH) && rSH > 0) ? rSH : 1.0;
          return { x: centerX, y: centerY, z: centerZ + safeR };
        }

        const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
        const phi = Math.atan2(dy, dx);
        const rSH = shInstance.evaluate(coefficients, theta, phi);
        
        // 【修复】验证 rSH 有效性
        if (!Number.isFinite(rSH) || rSH <= 0) {
          return { x, y, z };  // 返回原点
        }

        const scale = rSH / rCart;
        return {
          x: centerX + dx * scale,
          y: centerY + dy * scale,
          z: centerZ + dz * scale
        };
      }
    };
  }

  // ==========================================================================
  // 2.7 EFD 拟合
  // 椭圆傅里叶描述符（Elliptic Fourier Descriptors）用于二维闭合轮廓拟合
  // ==========================================================================

  /**
   * 椭圆傅里叶拟合
   * 
   * EFD将闭合轮廓表示为：
   * x(t) = a0 + Σ(an*cos(nt) + bn*sin(nt))
   * y(t) = c0 + Σ(cn*cos(nt) + dn*sin(nt))
   * 
   * @param {Array<{x,y,z}>} boundaryPoints - 边界点（z被忽略）
   * @param {number} order - 傅里叶阶数
   * @param {object[]} fitStackX - X方向增量拟合栈
   * @param {object[]} fitStackY - Y方向增量拟合栈
   * @param {object} fitterInstance - 拟合器实例
   * @param {class} Matrix - 矩阵类
   * @param {boolean} useIncremental - 是否使用增量拟合
   * @param {boolean} verbose
   * @returns {{coeffsX, coeffsY, order, residualX, residualY, fitStackX, fitStackY}}
   */
  static fitEllipticFourier(
    boundaryPoints, order,
    fitStackX, fitStackY,
    fitterInstance, Matrix,
    useIncremental, verbose
  ) {
    if (boundaryPoints.length < 4) {
      throw new Error('[ParametricImpl] EFD requires at least 4 boundary points');
    }

    // 计算轮廓周长和弧长参数化
    const n = boundaryPoints.length;
    const arcLengths = [0];
    let totalLength = 0;

    for (let i = 1; i <= n; i++) {
      const p0 = boundaryPoints[i - 1];
      const p1 = boundaryPoints[i % n];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
      arcLengths.push(totalLength);
    }

    // 【修复】检查轮廓周长是否为零
    if (totalLength < 1e-10) {
      throw new Error('[ParametricImpl] EFD requires non-degenerate boundary (totalLength ≈ 0)');
    }

    // 归一化弧长到 [0, 2π]
    const tParams = arcLengths.map(s => (s / totalLength) * 2 * Math.PI);

    // 构建设计矩阵 A 和目标向量 bX, bY
    // A[i] = [1, cos(t), sin(t), cos(2t), sin(2t), ..., cos(order*t), sin(order*t)]
    const numCoeffs = 1 + 2 * order;
    const A = [];
    const bX = [];
    const bY = [];

    for (let i = 0; i < n; i++) {
      const t = tParams[i];
      const row = [1];
      for (let k = 1; k <= order; k++) {
        row.push(Math.cos(k * t));
        row.push(Math.sin(k * t));
      }
      A.push(row);
      bX.push(boundaryPoints[i].x);
      bY.push(boundaryPoints[i].y);
    }

    // 使用最小二乘求解
    let coeffsX, coeffsY;
    let residualX = 0, residualY = 0;

    if (useIncremental && fitterInstance && fitterInstance.fitIncremental1D) {
      // 增量拟合（如果 fitter 支持）
      const resultX = fitterInstance.fitIncremental1D(A, bX, fitStackX, { order, verbose });
      const resultY = fitterInstance.fitIncremental1D(A, bY, fitStackY, { order, verbose });
      coeffsX = resultX.coefficients;
      coeffsY = resultY.coefficients;
      residualX = resultX.residual ?? 0;
      residualY = resultY.residual ?? 0;
    } else {
      // 全量拟合：使用法方程 (A^T A) x = A^T b
      const AT = ParametricImpl._transpose(A);
      const ATA = ParametricImpl._matMul(AT, A);
      const ATbX = ParametricImpl._matVecMul(AT, bX);
      const ATbY = ParametricImpl._matVecMul(AT, bY);

      // 使用 Cholesky 分解或直接求逆
      coeffsX = ParametricImpl._solveLinear(ATA, ATbX);
      coeffsY = ParametricImpl._solveLinear(ATA, ATbY);

      // 计算残差
      for (let i = 0; i < n; i++) {
        let predX = coeffsX[0], predY = coeffsY[0];
        const t = tParams[i];
        for (let k = 1; k <= order; k++) {
          predX += coeffsX[2*k-1] * Math.cos(k*t) + coeffsX[2*k] * Math.sin(k*t);
          predY += coeffsY[2*k-1] * Math.cos(k*t) + coeffsY[2*k] * Math.sin(k*t);
        }
        residualX += (predX - bX[i]) ** 2;
        residualY += (predY - bY[i]) ** 2;
      }
      residualX = Math.sqrt(residualX / n);
      residualY = Math.sqrt(residualY / n);
    }

    if (verbose) {
      console.log(`[ParametricImpl] EFD fit: order=${order}, residualX=${residualX.toFixed(6)}, residualY=${residualY.toFixed(6)}`);
    }

    return {
      coeffsX,
      coeffsY,
      order,
      residualX,
      residualY,
      fitStackX,
      fitStackY
    };
  }

  /**
   * 根据 EFD 系数计算轮廓点
   * @param {number[]} coeffsX - X 方向系数 [a0, a1, b1, a2, b2, ...]
   * @param {number[]} coeffsY - Y 方向系数 [c0, c1, d1, c2, d2, ...]
   * @param {number} t - 参数 [0, 2π]
   * @returns {{x: number, y: number}}
   */
  static evaluateEFD(coeffsX, coeffsY, t) {
    const order = (coeffsX.length - 1) / 2;
    let x = coeffsX[0];
    let y = coeffsY[0];

    for (let k = 1; k <= order; k++) {
      const cos_kt = Math.cos(k * t);
      const sin_kt = Math.sin(k * t);
      x += coeffsX[2*k-1] * cos_kt + coeffsX[2*k] * sin_kt;
      y += coeffsY[2*k-1] * cos_kt + coeffsY[2*k] * sin_kt;
    }

    return { x, y };
  }

  /**
   * 创建 EFD 边界回调（使用射线法判断内外）
   * @param {number[]} coeffsX
   * @param {number[]} coeffsY
   * @param {number} numSamples - 边界采样数
   * @returns {function(x,y,z): boolean} - 返回 true 表示点在边界内
   */
  static createEFDBoundaryCallback(coeffsX, coeffsY, numSamples) {
    // 预采样边界点
    const boundaryPoints = [];
    for (let i = 0; i < numSamples; i++) {
      const t = (i / numSamples) * 2 * Math.PI;
      const pt = ParametricImpl.evaluateEFD(coeffsX, coeffsY, t);
      boundaryPoints.push(pt);
    }

    // 计算边界的包围盒
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of boundaryPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return (x, y, z) => {
      // 快速包围盒排除
      if (x < minX || x > maxX || y < minY || y > maxY) {
        return false;
      }

      // 射线法：从点 (x, y) 向右发射射线，计算与边界的交点数
      let crossings = 0;
      const n = boundaryPoints.length;

      for (let i = 0; i < n; i++) {
        const p0 = boundaryPoints[i];
        const p1 = boundaryPoints[(i + 1) % n];

        // 检查射线是否穿过边 p0-p1
        if ((p0.y <= y && p1.y > y) || (p1.y <= y && p0.y > y)) {
          // 计算交点的 x 坐标
          const t = (y - p0.y) / (p1.y - p0.y);
          const xIntersect = p0.x + t * (p1.x - p0.x);
          if (x < xIntersect) {
            crossings++;
          }
        }
      }

      // 奇数交点表示在内部
      return (crossings % 2) === 1;
    };
  }

  // ==========================================================================
  // 辅助矩阵运算（用于 EFD 求解）
  // ==========================================================================

  static _transpose(A) {
    const rows = A.length;
    const cols = A[0].length;
    const result = [];
    for (let j = 0; j < cols; j++) {
      const row = [];
      for (let i = 0; i < rows; i++) {
        row.push(A[i][j]);
      }
      result.push(row);
    }
    return result;
  }

  static _matMul(A, B) {
    const rowsA = A.length;
    const colsA = A[0].length;
    const colsB = B[0].length;
    const result = [];
    for (let i = 0; i < rowsA; i++) {
      const row = [];
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < colsA; k++) {
          sum += A[i][k] * B[k][j];
        }
        row.push(sum);
      }
      result.push(row);
    }
    return result;
  }

  static _matVecMul(A, v) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
      let sum = 0;
      for (let j = 0; j < A[i].length; j++) {
        sum += A[i][j] * v[j];
      }
      result.push(sum);
    }
    return result;
  }

  static _solveLinear(A, b) {
    // Gauss-Jordan 消元法
    const n = A.length;
    const augmented = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      // 选主元
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
          maxRow = row;
        }
      }
      [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

      // 消元
      const pivot = augmented[col][col];
      if (Math.abs(pivot) < 1e-12) {
        throw new Error('[ParametricImpl] Singular matrix in EFD solve');
      }

      for (let j = col; j <= n; j++) {
        augmented[col][j] /= pivot;
      }

      for (let row = 0; row < n; row++) {
        if (row !== col) {
          const factor = augmented[row][col];
          for (let j = col; j <= n; j++) {
            augmented[row][j] -= factor * augmented[col][j];
          }
        }
      }
    }

    return augmented.map(row => row[n]);
  }
}
