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

  /**
   * 计算最大可能的球谐阶数
   * 公式：(L+1)² ≤ N  =>  L ≤ sqrt(N) - 1
   * 为数值稳定性，返回最高阶 - 1
   * @param {number} numControlPoints
   * @returns {number} 安全阶数 (>= 1)
   */
  static computeMaxOrder(numControlPoints) {
    // 理论最大阶: floor(sqrt(N)) - 1
    // 安全阶数: 最高阶 - 1 = floor(sqrt(N)) - 2
    const safeL = Math.floor(Math.sqrt(numControlPoints)) - 2;
    return Math.max(1, safeL);
  }

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
          predX += coeffsX[2 * k - 1] * Math.cos(k * t) + coeffsX[2 * k] * Math.sin(k * t);
          predY += coeffsY[2 * k - 1] * Math.cos(k * t) + coeffsY[2 * k] * Math.sin(k * t);
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
      x += coeffsX[2 * k - 1] * cos_kt + coeffsX[2 * k] * sin_kt;
      y += coeffsY[2 * k - 1] * cos_kt + coeffsY[2 * k] * sin_kt;
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

  // ==========================================================================
  // 自适应阶数确定 (v2.4 两阶段版)
  // ==========================================================================

  /**
   * 两阶段自适应确定最优球谐阶数 (v2.4)
   * 
   * 阶段A：结构判阶 - 高阶分阶正则拟合，确定结构区间
   * 阶段B：稳定拟合 - 在结构区间内找到条件数稳定的最终阶数
   * 
   * @param {Array<{x,y,z}>} positions - 控制点位置（局部坐标）
   * @param {object} shInstance - SphericalHarmonics 实例
   * @param {object} fitterInstance - FittingCalculator 实例
   * @param {class} Matrix - Matrix 类
   * @param {object} options
   * @returns {object}
   *   - L_direct: 来自全局结构计数的阶数（主判据）
   *   - S_total: 全局起伏次数
   *   - structureRange: { min, max } 结构阶数区间
   *   - bestOrder: 最终使用阶数 (= L_final)
   *   - diagnostics: { stageA, stageB }
   */
  static determineOptimalOrder(positions, shInstance, fitterInstance, Matrix, options = {}) {
    const verbose = options.verbose ?? false;
    const N = positions.length;
    const center = { x: 0, y: 0, z: 0 };

    // 配置
    const condThreshold = options.conditionThreshold ?? 1e7;
    const lambda_base = options.lambda_base ?? 1e-7;
    const alpha = options.alpha ?? 0.01;
    const lambda_final = options.lambda_final ?? 1e-7;
    const structureCoeff = options.structureCoeff ?? 1.5; // 结构计数→阶数系数

    // 计算 L_max: (L_max + 1)² ≤ 0.8 * N （正则化可保证不爆）
    const theoreticalMax = Math.floor(Math.sqrt(1 * N)) - 1;
    const L_max = Math.min(shInstance.maxOrder ?? 15, Math.max(1, theoreticalMax));

    if (verbose) console.log(`[SH-v3] N=${N} | L_max=${L_max}`);

    const diagnostics = { stageA: [], stageB: [] };

    // ========== 阶段 A：结构判阶（v3.0 核心） ==========

    // A.1 缓存球坐标
    const sphericalCache = ParametricImpl._buildSphericalCache(positions, shInstance, center);

    // A.2 一次性拟合到 L_max（分阶正则）
    let coeffs_full;
    try {
      const fitResult = ParametricImpl._fitWithGradedRegularization(
        positions, shInstance, fitterInstance, L_max, center, lambda_base, alpha
      );
      coeffs_full = fitResult.coefficients;
    } catch (err) {
      if (verbose) console.log(`[SH-v3] High-order fit failed, fallback`);
      return ParametricImpl._fallbackConservative(positions, shInstance, fitterInstance, center, options);
    }

    // A.3 [核心] 全局角向结构计数（数拐点，非零点）
    const S_total = ParametricImpl._computeGlobalTurningPoints(coeffs_full, shInstance);

    if (verbose) console.log(`[SH-v3] S_total (turning points) = ${S_total.toFixed(2)}`);

    // A.4 [核心] 结构计数 → 阶数映射
    // L_struct = ceil(S_total / c)，其中 c ≈ 2~3
    let L_struct = Math.ceil(S_total / structureCoeff);
    L_struct = Math.max(1, Math.min(L_max, L_struct));

    if (verbose) console.log(`[SH-v3] L_struct = ceil(${S_total.toFixed(2)} / ${structureCoeff}) = ${L_struct}`);

    // A.5 记录能量谱（仅诊断用）
    for (let l = 0; l <= L_max; l++) {
      const energy = shInstance.computeLevelEnergy(coeffs_full, l);
      diagnostics.stageA.push({ order: l, energy });
    }

    // ========== 阶段 B：直接拟合 L_struct（简化） ==========

    let L_final = L_struct;

    // 尝试用 L_struct 拟合，如果条件数过大则降阶
    for (let L = L_struct; L >= 1; L--) {
      const design = shInstance.buildDesignMatrix(positions, center, { order: L });
      const A = ParametricImpl._designToRowArray(design);
      const b = Array.from(design.b);

      let fitResult;
      try {
        fitResult = fitterInstance.fitWithRegularization(A, b, lambda_final);
      } catch (err) {
        if (verbose) console.log(`[SH-Fit] L=${L}: Fit failed, try lower`);
        continue;
      }

      if (fitResult.conditionUnregularized > condThreshold) {
        if (verbose) console.log(`[SH-Fit] L=${L}: cond=${fitResult.conditionUnregularized.toExponential(1)} too high, try lower`);
        continue;
      }

      const err = ParametricImpl._computeReconstructionErrorCached(sphericalCache, fitResult.coefficients, shInstance);
      diagnostics.stageB.push({ order: L, condition: fitResult.conditionUnregularized, error: err });

      if (verbose) console.log(`[SH-Fit] L=${L} | cond=${fitResult.conditionUnregularized.toExponential(1)} ✓`);

      L_final = L;
      break; // 找到第一个稳定的阶数就停止
    }

    return {
      L_struct,      // 结构计数推导的阶数
      S_total,       // 全局拐点数
      bestOrder: L_final,
      diagnostics
    };
  }

  /**
   * [v3.0 核心] 计算球面函数的全局拐点数（差分符号变化）
   * 
   * 思想：r(θ,φ) 对于 star-shaped 始终为正，所以不能数零点
   * 改为数"一阶差分的符号变化" = 极值点 = 拐点
   * 
   * 这对应多项式的"导数为零"判据
   * 
   * @private
   */
  static _computeGlobalTurningPoints(coeffs_full, shInstance, options = {}) {
    const thetaSteps = options.thetaSteps ?? 32;
    const phiSteps = options.phiSteps ?? 64;

    // 1. 在规则网格上计算函数值
    const grid = [];
    for (let i = 0; i < thetaSteps; i++) {
      const theta = (i + 0.5) / thetaSteps * Math.PI;
      grid[i] = [];
      for (let j = 0; j < phiSteps; j++) {
        const phi = j / phiSteps * 2 * Math.PI;
        grid[i][j] = shInstance.evaluate(coeffs_full, theta, phi);
      }
    }

    // 2. 沿 φ 方向统计一阶差分符号变化（固定 θ）
    // 差分符号变化 = 极值点 = 拐点
    let turningPoints_phi = 0;
    for (let i = 0; i < thetaSteps; i++) {
      for (let j = 0; j < phiSteps; j++) {
        const prev = grid[i][(j - 1 + phiSteps) % phiSteps];
        const curr = grid[i][j];
        const next = grid[i][(j + 1) % phiSteps];

        const diff1 = curr - prev; // 左差分
        const diff2 = next - curr; // 右差分

        // 如果差分符号变化，说明有极值点
        if (Math.sign(diff1) !== 0 && Math.sign(diff2) !== 0) {
          if (Math.sign(diff1) !== Math.sign(diff2)) {
            turningPoints_phi++;
          }
        }
      }
    }

    // 3. 沿 θ 方向统计一阶差分符号变化（固定 φ）
    let turningPoints_theta = 0;
    for (let j = 0; j < phiSteps; j++) {
      for (let i = 1; i < thetaSteps - 1; i++) {
        const prev = grid[i - 1][j];
        const curr = grid[i][j];
        const next = grid[i + 1][j];

        const diff1 = curr - prev;
        const diff2 = next - curr;

        if (Math.sign(diff1) !== 0 && Math.sign(diff2) !== 0) {
          if (Math.sign(diff1) !== Math.sign(diff2)) {
            turningPoints_theta++;
          }
        }
      }
    }

    // 4. 归一化：平均每圈的拐点数
    const avgTurning_phi = turningPoints_phi / thetaSteps;
    const avgTurning_theta = turningPoints_theta / phiSteps;

    // 5. 取两个方向的平均
    const S_total = (avgTurning_phi + avgTurning_theta) / 2;

    return S_total;
  }

  /**
   * [v3.0 核心] 计算球面函数的全局角向起伏次数
   * 
   * 思想：在球面规则网格上沿 θ 和 φ 方向统计符号变化
   * 
   * @private
   */
  static _computeGlobalStructureCount(coeffs_full, shInstance, options = {}) {
    const thetaSteps = options.thetaSteps ?? 32;
    const phiSteps = options.phiSteps ?? 64;

    // 1. 在规则网格上计算函数值
    const grid = [];
    for (let i = 0; i < thetaSteps; i++) {
      const theta = (i + 0.5) / thetaSteps * Math.PI; // 避免极点
      grid[i] = [];
      for (let j = 0; j < phiSteps; j++) {
        const phi = j / phiSteps * 2 * Math.PI;
        grid[i][j] = shInstance.evaluate(coeffs_full, theta, phi);
      }
    }

    // 2. 沿 φ 方向统计符号变化（固定 θ）
    let signChanges_phi = 0;
    for (let i = 0; i < thetaSteps; i++) {
      for (let j = 0; j < phiSteps; j++) {
        const curr = grid[i][j];
        const next = grid[i][(j + 1) % phiSteps];
        if (Math.sign(curr) !== 0 && Math.sign(next) !== 0) {
          if (Math.sign(curr) !== Math.sign(next)) {
            signChanges_phi++;
          }
        }
      }
    }

    // 3. 沿 θ 方向统计符号变化（固定 φ）
    let signChanges_theta = 0;
    for (let j = 0; j < phiSteps; j++) {
      for (let i = 0; i < thetaSteps - 1; i++) {
        const curr = grid[i][j];
        const next = grid[i + 1][j];
        if (Math.sign(curr) !== 0 && Math.sign(next) !== 0) {
          if (Math.sign(curr) !== Math.sign(next)) {
            signChanges_theta++;
          }
        }
      }
    }

    // 4. 归一化：平均每圈的符号变化次数
    const avgChanges_phi = signChanges_phi / thetaSteps;
    const avgChanges_theta = signChanges_theta / phiSteps;

    // 5. 合并两个方向
    const S_total = (avgChanges_phi + avgChanges_theta) / 2;

    return S_total;
  }

  /**
   * 构建球坐标缓存
   * @private
   */
  static _buildSphericalCache(positions, shInstance, center) {
    const design = shInstance.buildDesignMatrix(positions, center, { order: 0 });
    const cache = [];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const r = design.b[i];
      if (r < 1e-10) {
        cache.push({ theta: 0, phi: 0, r: 0 });
      } else {
        const theta = Math.acos(Math.max(-1, Math.min(1, (p.z - center.z) / r)));
        const phi = Math.atan2(p.y - center.y, p.x - center.x);
        cache.push({ theta, phi, r });
      }
    }
    return cache;
  }

  /**
   * 分阶正则拟合 (v2.4)
   * λ(l) = λ_base * (1 + α * l²)
   * @private
   */
  static _fitWithGradedRegularization(positions, shInstance, fitterInstance, L_max, center, lambda_base, alpha) {
    const design = shInstance.buildDesignMatrix(positions, center, { order: L_max });
    const A = ParametricImpl._designToRowArray(design);
    const b = Array.from(design.b);
    const m = A.length;
    const n = A[0].length;

    // 构建 A^T A
    const ATA = [];
    for (let i = 0; i < n; i++) {
      ATA[i] = new Array(n).fill(0);
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < m; k++) {
          sum += A[k][i] * A[k][j];
        }
        ATA[i][j] = sum;
      }
    }

    // 分阶添加正则项
    let coeffIdx = 0;
    for (let l = 0; l <= L_max; l++) {
      const lambda_l = lambda_base * (1 + alpha * l * l);
      const numCoeffsInLevel = 2 * l + 1;
      for (let mm = 0; mm < numCoeffsInLevel; mm++) {
        ATA[coeffIdx][coeffIdx] += lambda_l;
        coeffIdx++;
      }
    }

    // 构建 A^T b
    const ATb = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < m; k++) {
        ATb[i] += A[k][i] * b[k];
      }
    }

    // Cholesky 求解
    const coefficients = fitterInstance._choleskySolve(ATA, ATb, n);
    return { coefficients };
  }

  /**
   * 计算归一化角向变化量 (v2.4)
   * Ṽ_l = V_l / l(l+1)
   * @private
   */
  static _computeNormalizedVariation(coeffs_full, l, sphericalCache, shInstance) {
    if (l === 0) return 0;

    // 提取阶 l 的系数
    const startIdx = l * l;
    const endIdx = (l + 1) * (l + 1);
    const coeffs_l = new Array(endIdx).fill(0);
    for (let i = startIdx; i < endIdx; i++) {
      coeffs_l[i] = coeffs_full[i];
    }

    // 计算该阶的重建值
    const r_l = sphericalCache.map(({ theta, phi }) => shInstance.evaluate(coeffs_l, theta, phi));

    // 自适应 K
    const N = sphericalCache.length;
    const K = Math.max(4, Math.min(12, Math.floor(Math.sqrt(N) / Math.max(1, l))));

    // 计算 Total Variation
    let totalVariation = 0;
    for (let i = 0; i < N; i++) {
      const neighbors = ParametricImpl._findKNearestOnSphere(sphericalCache, i, K);
      for (const j of neighbors) {
        const diff = r_l[i] - r_l[j];
        totalVariation += diff * diff;
      }
    }

    const V_l = totalVariation / N;
    return V_l / (l * (l + 1)); // 尺度归一化
  }

  /**
   * 计算非轴对称能量 (m≠0)
   * @private
   */
  static _computeNonAxialEnergy(coeffs, l) {
    const startIdx = l * l;
    const m0Idx = startIdx + l; // m=0 的索引
    let energy = 0;
    for (let i = startIdx; i < (l + 1) * (l + 1); i++) {
      if (i !== m0Idx && i < coeffs.length) {
        energy += coeffs[i] * coeffs[i];
      }
    }
    return energy;
  }

  /**
   * 结构事件判据（零交叉）
   * @private
   */
  static _hasStructuralEvent(coeffs_full, l, sphericalCache, shInstance, threshold) {
    if (l === 0) return false;

    // 提取阶 l 的系数
    const startIdx = l * l;
    const endIdx = (l + 1) * (l + 1);
    const coeffs_l = new Array(endIdx).fill(0);
    for (let i = startIdx; i < endIdx; i++) {
      if (i < coeffs_full.length) coeffs_l[i] = coeffs_full[i];
    }

    // 计算重建值
    const r_l = sphericalCache.map(({ theta, phi }) => shInstance.evaluate(coeffs_l, theta, phi));

    // 统计零交叉
    const K = 6;
    let zeroCrossings = 0;
    const N = sphericalCache.length;

    for (let i = 0; i < N; i++) {
      const neighbors = ParametricImpl._findKNearestOnSphere(sphericalCache, i, K);
      const sign_i = Math.sign(r_l[i]);
      if (sign_i === 0) {
        zeroCrossings += K;
      } else {
        for (const j of neighbors) {
          if (Math.sign(r_l[j]) !== sign_i) {
            zeroCrossings++;
          }
        }
      }
    }

    const zcRate = zeroCrossings / (N * K);
    return zcRate >= threshold;
  }

  /**
   * 球面 K 近邻搜索
   * @private
   */
  static _findKNearestOnSphere(sphericalCache, idx, k) {
    const p = sphericalCache[idx];
    const distances = [];

    for (let j = 0; j < sphericalCache.length; j++) {
      if (j === idx) continue;
      const q = sphericalCache[j];
      const cosAngle = Math.sin(p.theta) * Math.sin(q.theta) * Math.cos(p.phi - q.phi)
        + Math.cos(p.theta) * Math.cos(q.theta);
      distances.push({ j, dist: 1 - cosAngle });
    }

    distances.sort((a, b) => a.dist - b.dist);
    return distances.slice(0, k).map(d => d.j);
  }

  /**
   * 保守回退方案
   * @private
   */
  static _fallbackConservative(positions, shInstance, fitterInstance, center, options) {
    const lambda = options.lambda_final ?? 1e-7;
    const condThreshold = options.conditionThreshold ?? 1e7;
    const L_max_fallback = Math.min(shInstance.maxOrder ?? 15, Math.floor(Math.sqrt(positions.length)) - 2);

    let L_final = 1;

    for (let L = 1; L <= L_max_fallback; L++) {
      try {
        const design = shInstance.buildDesignMatrix(positions, center, { order: L });
        const A = ParametricImpl._designToRowArray(design);
        const b = Array.from(design.b);
        const fitResult = fitterInstance.fitWithRegularization(A, b, lambda);

        if (fitResult.conditionUnregularized > condThreshold) break;
        L_final = L;
      } catch (err) {
        break;
      }
    }

    return {
      structureRange: { min: 1, max: L_final },
      bestOrder: L_final,
      diagnostics: { stageA: [], stageB: [], fallback: true }
    };
  }

  /**
   * 将设计矩阵转换为行数组格式
   * @private
   */
  static _designToRowArray(design) {
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
    return A;
  }

  /**
   * 计算重建误差（使用缓存的球坐标）
   * @private
   */
  static _computeReconstructionErrorCached(sphericalCache, coeffs, shInstance) {
    let sumSq = 0;
    for (const { theta, phi, r } of sphericalCache) {
      if (r < 1e-10) continue;
      const rFit = shInstance.evaluate(coeffs, theta, phi);
      const diff = r - rFit;
      sumSq += diff * diff;
    }
    return sumSq;
  }
}
