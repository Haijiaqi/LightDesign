/**
 * 通用拟合计算类
 * 优先级：第二级（依赖 Matrix 类和 Point 类）
 * 职责：计算点集的最优拟合，自动确定最佳阶数
 */
class FittingCalculator {
  constructor(options = {}) {
    // 配置参数
    this.maxOrder = options.maxOrder ?? 10;
    this.minOrder = options.minOrder ?? 2;
    this.criterionType = options.criterionType ?? 'extrema'; // 'extrema', 'aic', 'bic', 'cv'
    this.smoothness = options.smoothness ?? 0.1; // 平滑度权重
    this.verbose = options.verbose ?? false;
    
    // 依赖注入：Matrix 类
    this.Matrix = options.Matrix;
    if (!this.Matrix) {
      throw new Error('Matrix class is required');
    }
  }

  // ====================================================
  // 核心接口：自动拟合
  // ====================================================

  /**
   * 自动确定最佳阶数并拟合
   * @param {Array} points 点集 [{x, y, z}, ...] 或 [{x, value}, ...]
   * @param {Object} options 拟合选项
   * @returns {Object} 拟合结果
   */
  autoFit(points, options = {}) {
    if (!points || points.length === 0) {
      throw new Error('Points array is empty');
    }

    const fitType = this._detectFitType(points);
    const prepared = this._prepareData(points, fitType, options);

    // 先计算最高阶拟合
    const highOrderResult = this._fitPolynomial(
      prepared.x,
      prepared.y,
      this.maxOrder,
      options
    );

    // 根据准则确定最佳阶数
    const bestOrder = this._determineBestOrder(
      prepared.x,
      prepared.y,
      highOrderResult,
      options
    );

    // 用最佳阶数重新拟合
    let finalResult;
    if (bestOrder === this.maxOrder) {
      finalResult = highOrderResult;
    } else {
      finalResult = this._fitPolynomial(
        prepared.x,
        prepared.y,
        bestOrder,
        options
      );
    }

    return {
      coefficients: finalResult.coefficients,
      order: bestOrder,
      fitType,
      residual: finalResult.residual,
      condition: finalResult.condition,
      extremaCount: this._countExtrema(finalResult.coefficients),
      metadata: {
        pointCount: points.length,
        xRange: [prepared.xMin, prepared.xMax],
        yRange: [prepared.yMin, prepared.yMax],
        criterionUsed: this.criterionType
      },
      evaluate: (x) => this._evaluatePolynomial(finalResult.coefficients, x, prepared),
      _prepared: prepared,
      _qrState: finalResult.qrState
    };
  }

  /**
   * 指定阶数拟合（不自动选择）
   * @param {Array} points 点集
   * @param {Number} order 多项式阶数
   * @param {Object} options 选项
   * @returns {Object} 拟合结果
   */
  fit(points, order, options = {}) {
    if (order < 1 || order > this.maxOrder) {
      throw new Error(`Order must be between 1 and ${this.maxOrder}`);
    }

    const fitType = this._detectFitType(points);
    const prepared = this._prepareData(points, fitType, options);
    const result = this._fitPolynomial(prepared.x, prepared.y, order, options);

    return {
      coefficients: result.coefficients,
      order,
      fitType,
      residual: result.residual,
      condition: result.condition,
      extremaCount: this._countExtrema(result.coefficients),
      metadata: {
        pointCount: points.length,
        xRange: [prepared.xMin, prepared.xMax],
        yRange: [prepared.yMin, prepared.yMax]
      },
      evaluate: (x) => this._evaluatePolynomial(result.coefficients, x, prepared),
      _prepared: prepared,
      _qrState: result.qrState
    };
  }

  // ====================================================
  // 数据准备
  // ====================================================

  _detectFitType(points) {
    const first = points[0];
    
    // 检测是否为 3D 点
    if (first.z !== undefined && first.z !== null) {
      return '3d';
    }
    
    // 检测是否为时间序列（K线等）
    if (first.value !== undefined || first.close !== undefined) {
      return 'timeseries';
    }
    
    // 默认为 2D 点
    return '2d';
  }

  _prepareData(points, fitType, options) {
    let x = [], y = [];
    
    // 根据类型提取数据
    if (fitType === '3d') {
      // 3D: 沿某个方向投影（默认沿第一主成分）
      const projection = options.projection ?? 'pca';
      const result = this._project3DPoints(points, projection);
      x = result.x;
      y = result.y;
    } else if (fitType === 'timeseries') {
      // 时间序列：使用索引或时间戳
      for (let i = 0; i < points.length; i++) {
        x.push(points[i].x ?? points[i].time ?? i);
        y.push(points[i].value ?? points[i].close ?? points[i].y);
      }
    } else {
      // 2D: 直接使用
      for (let i = 0; i < points.length; i++) {
        x.push(points[i].x);
        y.push(points[i].y ?? points[i].value ?? 0);
      }
    }

    // 数据归一化（提高数值稳定性）
    const xMin = Math.min(...x);
    const xMax = Math.max(...x);
    const yMin = Math.min(...y);
    const yMax = Math.max(...y);
    
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    
    // 避免除零
    const xScale = xRange > 1e-10 ? xRange : 1;
    const yScale = yRange > 1e-10 ? yRange : 1;

    const xNorm = x.map(v => (v - xMin) / xScale);
    const yNorm = y.map(v => (v - yMin) / yScale);

    return {
      x: xNorm,
      y: yNorm,
      xMin,
      xMax,
      yMin,
      yMax,
      xScale,
      yScale,
      originalPoints: points
    };
  }

  _project3DPoints(points, projection) {
    if (projection === 'pca') {
      // 简化版 PCA：沿最大方差方向
      return this._pcaProject(points);
    } else if (projection === 'x') {
      return {
        x: points.map(p => p.x),
        y: points.map(p => Math.sqrt(p.y * p.y + p.z * p.z))
      };
    } else if (projection === 'y') {
      return {
        x: points.map(p => p.y),
        y: points.map(p => Math.sqrt(p.x * p.x + p.z * p.z))
      };
    } else if (projection === 'z') {
      return {
        x: points.map(p => p.z),
        y: points.map(p => Math.sqrt(p.x * p.x + p.y * p.y))
      };
    }
    
    throw new Error(`Unknown projection type: ${projection}`);
  }

  _pcaProject(points) {
    // 简化版 PCA：找到最大方差方向
    const n = points.length;
    
    // 计算中心
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    cx /= n;
    cy /= n;
    cz /= n;

    // 计算协方差矩阵（简化：只找主方向）
    let cxx = 0, cxy = 0, cxz = 0;
    let cyy = 0, cyz = 0, czz = 0;
    
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      cxx += dx * dx;
      cxy += dx * dy;
      cxz += dx * dz;
      cyy += dy * dy;
      cyz += dy * dz;
      czz += dz * dz;
    }

    // 简化：使用最大对角元素对应的轴
    const maxVar = Math.max(cxx, cyy, czz);
    let mainAxis, perpDist;
    
    if (maxVar === cxx) {
      mainAxis = points.map(p => p.x);
      perpDist = points.map(p => Math.sqrt((p.y - cy) ** 2 + (p.z - cz) ** 2));
    } else if (maxVar === cyy) {
      mainAxis = points.map(p => p.y);
      perpDist = points.map(p => Math.sqrt((p.x - cx) ** 2 + (p.z - cz) ** 2));
    } else {
      mainAxis = points.map(p => p.z);
      perpDist = points.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
    }

    return { x: mainAxis, y: perpDist };
  }

  // ====================================================
  // 多项式拟合
  // ====================================================

  _fitPolynomial(x, y, order, options) {
    const n = x.length;
    const m = order + 1; // 系数个数

    if (n < m) {
      throw new Error(`Not enough points (${n}) for order ${order} fit (need ${m})`);
    }

    // 构建 Vandermonde 矩阵
    const A = new this.Matrix(n, m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        A.set(i, j, Math.pow(x[i], j));
      }
    }

    const b = new Float64Array(y);

    // QR 分解求解
    const qrOptions = {
      allowExtend: options.allowIncremental ?? false,
      estimateCondition: true
    };

    let qrState;
    if (options.useGivens) {
      qrState = this.Matrix.givensQR(A, b, qrOptions);
    } else {
      qrState = this.Matrix.householderQR(A, b, qrOptions);
    }

    // 检查条件数
    if (qrState.condition > 1e12) {
      console.warn(`High condition number (${qrState.condition.toExponential(2)}): fit may be unstable`);
    }

    const coefficients = this.Matrix.solveFromQR(qrState);

    // 计算残差
    const residual = this._computeResidual(x, y, coefficients);

    return {
      coefficients: Array.from(coefficients),
      residual,
      condition: qrState.condition,
      qrState
    };
  }

  _computeResidual(x, y, coeffs) {
    let sumSq = 0;
    for (let i = 0; i < x.length; i++) {
      const predicted = this._polyEval(coeffs, x[i]);
      const error = y[i] - predicted;
      sumSq += error * error;
    }
    return Math.sqrt(sumSq / x.length);
  }

  _polyEval(coeffs, x) {
    // Horner's method（改进：从低次项到高次项）
    let result = 0;
    let xPower = 1;
    for (let i = 0; i < coeffs.length; i++) {
      result += coeffs[i] * xPower;
      xPower *= x;
    }
    return result;
  }

  // ====================================================
  // 最佳阶数确定
  // ====================================================

  _determineBestOrder(x, y, highOrderResult, options) {
    const criterion = options.criterion ?? this.criterionType;

    if (criterion === 'extrema') {
      return this._orderByExtrema(highOrderResult.coefficients);
    } else if (criterion === 'aic') {
      return this._orderByAIC(x, y);
    } else if (criterion === 'bic') {
      return this._orderByBIC(x, y);
    } else if (criterion === 'cv') {
      return this._orderByCV(x, y, options);
    }

    throw new Error(`Unknown criterion: ${criterion}`);
  }

  _orderByExtrema(coeffs) {
    // 根据极值点数量确定阶数
    // 多项式的极值点数 ≤ degree - 1
    // 我们希望拟合曲线的极值点数与真实趋势相符
    
    const extremaCount = this._countExtrema(coeffs);
    
    // 启发式规则：
    // 1. 如果没有极值点，可能是单调的，低阶拟合
    // 2. 如果极值点太多，可能过拟合，降低阶数
    // 3. 目标：extremaCount ≈ order / 2
    
    const currentOrder = coeffs.length - 1;
    
    if (extremaCount === 0) {
      // 单调，使用低阶
      return Math.max(this.minOrder, Math.min(3, currentOrder));
    }
    
    // 经验公式：最佳阶数约为 2 * extremaCount + 1
    const suggestedOrder = Math.min(
      currentOrder,
      Math.max(this.minOrder, 2 * extremaCount + 1)
    );
    
    if (this.verbose) {
      console.log(`Extrema count: ${extremaCount}, suggested order: ${suggestedOrder}`);
    }
    
    return suggestedOrder;
  }

  _countExtrema(coeffs) {
    // 计算导数系数
    const derivCoeffs = [];
    for (let i = 1; i < coeffs.length; i++) {
      derivCoeffs.push(i * coeffs[i]);
    }

    if (derivCoeffs.length === 0) return 0;

    // 使用数值方法在 [0, 1] 区间采样找极值点
    const samples = 100;
    let extrema = 0;
    let prevDeriv = this._polyEval(derivCoeffs, 0);

    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const deriv = this._polyEval(derivCoeffs, t);
      
      // 检测符号变化（极值点）
      if (prevDeriv * deriv < 0) {
        extrema++;
      }
      prevDeriv = deriv;
    }

    return extrema;
  }

  _orderByAIC(x, y) {
    // Akaike Information Criterion
    let bestOrder = this.minOrder;
    let bestAIC = Infinity;

    for (let order = this.minOrder; order <= this.maxOrder; order++) {
      const result = this._fitPolynomial(x, y, order, {});
      const n = x.length;
      const k = order + 1;
      const rss = result.residual * result.residual * n;
      
      // AIC = 2k + n*ln(RSS/n)
      const aic = 2 * k + n * Math.log(rss / n);
      
      if (aic < bestAIC) {
        bestAIC = aic;
        bestOrder = order;
      }
    }

    return bestOrder;
  }

  _orderByBIC(x, y) {
    // Bayesian Information Criterion
    let bestOrder = this.minOrder;
    let bestBIC = Infinity;

    for (let order = this.minOrder; order <= this.maxOrder; order++) {
      const result = this._fitPolynomial(x, y, order, {});
      const n = x.length;
      const k = order + 1;
      const rss = result.residual * result.residual * n;
      
      // BIC = k*ln(n) + n*ln(RSS/n)
      const bic = k * Math.log(n) + n * Math.log(rss / n);
      
      if (bic < bestBIC) {
        bestBIC = bic;
        bestOrder = order;
      }
    }

    return bestOrder;
  }

  _orderByCV(x, y, options) {
    // Cross-Validation (简化版：留一法)
    const folds = options.cvFolds ?? Math.min(10, Math.floor(x.length / 5));
    
    let bestOrder = this.minOrder;
    let bestError = Infinity;

    for (let order = this.minOrder; order <= this.maxOrder; order++) {
      let totalError = 0;
      const foldSize = Math.floor(x.length / folds);

      for (let f = 0; f < folds; f++) {
        const testStart = f * foldSize;
        const testEnd = f === folds - 1 ? x.length : (f + 1) * foldSize;
        
        // 分割训练/测试集
        const xTrain = [...x.slice(0, testStart), ...x.slice(testEnd)];
        const yTrain = [...y.slice(0, testStart), ...y.slice(testEnd)];
        const xTest = x.slice(testStart, testEnd);
        const yTest = y.slice(testStart, testEnd);

        // 训练
        const result = this._fitPolynomial(xTrain, yTrain, order, {});
        
        // 测试
        for (let i = 0; i < xTest.length; i++) {
          const pred = this._polyEval(result.coefficients, xTest[i]);
          totalError += (yTest[i] - pred) ** 2;
        }
      }

      const avgError = totalError / x.length;
      if (avgError < bestError) {
        bestError = avgError;
        bestOrder = order;
      }
    }

    return bestOrder;
  }

  // ====================================================
  // 评估函数
  // ====================================================

  _evaluatePolynomial(coeffs, xInput, prepared) {
    // 反归一化输入
    const xNorm = (xInput - prepared.xMin) / prepared.xScale;
    
    // 计算归一化输出
    const yNorm = this._polyEval(coeffs, xNorm);
    
    // 反归一化输出
    const y = yNorm * prepared.yScale + prepared.yMin;
    
    return y;
  }

  // ====================================================
  // 工具函数
  // ====================================================

  /**
   * 批量评估
   * @param {Object} fitResult 拟合结果
   * @param {Array} xValues x 值数组
   * @returns {Array} y 值数组
   */
  static evaluate(fitResult, xValues) {
    if (!fitResult.evaluate) {
      throw new Error('Invalid fit result');
    }
    return xValues.map(x => fitResult.evaluate(x));
  }

  /**
   * 计算导数
   * @param {Object} fitResult 拟合结果
   * @param {Number} x 位置
   * @returns {Number} 导数值
   */
  static derivative(fitResult, x) {
    const coeffs = fitResult.coefficients;
    const prepared = fitResult._prepared;
    
    // 导数系数
    const derivCoeffs = [];
    for (let i = 1; i < coeffs.length; i++) {
      derivCoeffs.push(i * coeffs[i]);
    }

    // 归一化
    const xNorm = (x - prepared.xMin) / prepared.xScale;
    const dyNorm = this.prototype._polyEval(derivCoeffs, xNorm);
    
    // 考虑归一化的链式法则
    return dyNorm * prepared.yScale / prepared.xScale;
  }

  /**
   * 寻找极值点
   * @param {Object} fitResult 拟合结果
   * @param {Object} options 选项
   * @returns {Array} 极值点数组 [{x, y, type}, ...]
   */
  static findExtrema(fitResult, options = {}) {
    const prepared = fitResult._prepared;
    const samples = options.samples ?? 200;
    const extrema = [];

    let prevDeriv = FittingCalculator.derivative(fitResult, prepared.xMin);

    for (let i = 1; i <= samples; i++) {
      const x = prepared.xMin + (prepared.xMax - prepared.xMin) * i / samples;
      const deriv = FittingCalculator.derivative(fitResult, x);
      
      // 检测符号变化
      if (prevDeriv * deriv < 0) {
        const y = fitResult.evaluate(x);
        extrema.push({
          x,
          y,
          type: prevDeriv > 0 ? 'max' : 'min'
        });
      }
      
      prevDeriv = deriv;
    }

    return extrema;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FittingCalculator };
} else if (typeof window !== 'undefined') {
  window.FittingCalculator = FittingCalculator;
}