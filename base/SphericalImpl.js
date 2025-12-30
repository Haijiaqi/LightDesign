// SphericalImpl.js - 球谐数学模块
// 职责定位: 纯数学模块（完全无状态）

export class SphericalImpl {
  /**
   * SphericalImpl 构造函数
   * 
   * ⭐ 职责：
   *   1. 保存 this._object = object
   *   2. this._verbose = object.verbose
   *   3. 不初始化缓存（由 Object 管理）
   *   4. 不持有数据（纯计算模块）
   * 
   * @param {Object} object - Object 实例的引用
   */
  constructor(object) {
    this._object = object;
    this._verbose = object.verbose;
  }

  /**
   * 拟合球谐系数
   * 
   * ⭐ 职责：从控制点拟合球谐系数
   * ⭐ 输入：context = { order, autoOrder, pointVersion }
   * 
   * 算法流程：
   *   1. 缓存检查
   *   2. 获取控制点（只读）
   *   3. 确定阶数
   *   4. ⚠️ 即时计算球坐标（不缓存）
   *   5. 构建线性系统
   *   6. 求解最小二乘
   *   7. 缓存结果
   */
  fitSphericalHarmonics(context) {
    // 【步骤1：缓存检查】
    const cached = this._object._fitCache.get(context);
    if (cached) {
      if (this._verbose) {
        console.log('[SphericalImpl] Cache hit');
      }
      return cached;
    }

    // 【步骤2：获取控制点】
    const controlPoints = this._object.controlPoints;  // 只读
    if (controlPoints.length < 4) {
      console.error('[SphericalImpl] Need at least 4 control points');
      return null;
    }

    const center = this._object.center;  // 只读

    if (this._verbose) {
      console.log(`[SphericalImpl] Fitting ${controlPoints.length} control points`);
    }

    // 【步骤3：确定阶数】
    let lmax;
    if (context.order !== undefined) {
      // 用户指定阶数
      lmax = context.order;
    } else if (context.autoOrder === true) {
      // 自动阶数：根据点数确定
      // 公式：n = (lmax + 1)^2
      // 反推：lmax = ceil(sqrt(n)) - 1
      const n = controlPoints.length;
      lmax = Math.min(
        Math.ceil(Math.sqrt(n)) - 1,
        10  // 最大阶数限制
      );
    } else {
      // 默认阶数
      lmax = 4;
    }

    if (this._verbose) {
      console.log(`[SphericalImpl] Using order: ${lmax}`);
    }

    // 【步骤4：坐标转换 - ⚠️ 即时计算，不缓存】
    const sphericalCoords = [];
    for (const point of controlPoints) {
      // 平移到中心
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const dz = point.z - center.z;

      // 计算半径
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1e-10) {
        if (this._verbose) {
          console.warn('[SphericalImpl] Point too close to center, skipping');
        }
        continue;
      }

      // 计算方位角 theta: [0, 2π]
      let theta = Math.atan2(dy, dx);
      if (theta < 0) theta += 2 * Math.PI;

      // 计算极角 phi: [0, π]
      const cosTheta = Math.max(-1, Math.min(1, dz / r));
      const phi = Math.acos(cosTheta);

      sphericalCoords.push({ theta, phi, r });
    }

    if (sphericalCoords.length < 4) {
      console.error('[SphericalImpl] Not enough valid points after filtering');
      return null;
    }

    // 【步骤5：构建线性系统】
    const numCoeffs = (lmax + 1) * (lmax + 1);
    const n = sphericalCoords.length;

    const A = [];  // n × numCoeffs 矩阵
    const b = [];  // n 维向量（半径）

    for (let i = 0; i < n; i++) {
      const { theta, phi, r } = sphericalCoords[i];
      const row = [];

      // 计算所有 Y_lm(theta, phi)
      let coeffIndex = 0;
      for (let l = 0; l <= lmax; l++) {
        for (let m = -l; m <= l; m++) {
          const Y_lm = this._computeSphericalHarmonic(l, m, theta, phi);
          row.push(Y_lm);
          coeffIndex++;
        }
      }

      A.push(row);
      b.push(r);
    }

    // 【步骤6：求解最小二乘 A^T A x = A^T b】
    // 计算 A^T A
    const AtA = [];
    for (let i = 0; i < numCoeffs; i++) {
      const row = [];
      for (let j = 0; j < numCoeffs; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += A[k][i] * A[k][j];
        }
        row.push(sum);
      }
      AtA.push(row);
    }

    // 计算 A^T b
    const Atb = [];
    for (let i = 0; i < numCoeffs; i++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += A[k][i] * b[k];
      }
      Atb.push(sum);
    }

    // 高斯消元求解
    const coefficients = this._solveLinearSystem(AtA, Atb);

    if (!coefficients) {
      console.error('[SphericalImpl] Failed to solve linear system');
      return null;
    }

    // 【步骤7：缓存结果】
    const result = {
      coefficients,
      order: lmax,
      controlPointCount: controlPoints.length
    };

    this._object._fitCache.set(context, result);

    if (this._verbose) {
      console.log(`[SphericalImpl] Fit complete: ${coefficients.length} coefficients`);
    }

    return result;
  }

  /**
   * 求值球谐函数
   * 
   * ⭐ 职责：给定球坐标角度，计算半径
   * ⭐ 输入：theta（方位角）, phi（极角）, coefficients（系数数组）, lmax（阶数）
   * 
   * ⚠️ 纯函数：不访问 Object 数据（除了 verbose）
   * ⚠️ 返回 1.0 作为默认值是有意设计，防止退化几何
   */
  evaluate(theta, phi, coefficients, lmax) {
    // 验证系数数量
    const expectedCoeffs = (lmax + 1) * (lmax + 1);
    if (coefficients.length !== expectedCoeffs) {
      if (this._verbose) {
        console.error('[SphericalImpl] Invalid coefficient count');
        console.error(`[SphericalImpl] Expected ${expectedCoeffs}, got ${coefficients.length}`);
      }
      return 1.0;  // 默认半径
    }

    // 计算加权和
    let r = 0;
    let coeffIndex = 0;

    for (let l = 0; l <= lmax; l++) {
      for (let m = -l; m <= l; m++) {
        // 计算 Y_lm(theta, phi)
        const Y_lm = this._computeSphericalHarmonic(l, m, theta, phi);

        // 累加：r += c_lm * Y_lm
        r += coefficients[coeffIndex] * Y_lm;

        coeffIndex++;
      }
    }

    // 非负约束（有意设计）
    if (r < 0.1) {
      if (this._verbose) {
        console.warn('[SphericalImpl] Negative radius clamped to 0.1');
      }
      r = 0.1;  // 最小半径，防止退化几何
    }

    return r;
  }

  /**
   * 投影到球坐标
   * 
   * ⭐ 职责：将笛卡尔坐标转换为球坐标
   * ⭐ 输入：point（笛卡尔坐标）, center（球心）
   * 
   * ⚠️ 纯函数：不访问 Object
   */
  projectToSpherical(point, center) {
    // 平移到球心
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dz = point.z - center.z;

    // 计算半径
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < 1e-10) {
      if (this._verbose) {
        console.warn('[SphericalImpl] Point at center, returning zero coords');
      }
      return { r: 0, theta: 0, phi: 0 };
    }

    // 计算方位角 theta: [0, 2π]
    let theta = Math.atan2(dy, dx);
    if (theta < 0) {
      theta += 2 * Math.PI;  // 归一化到 [0, 2π]
    }

    // 计算极角 phi: [0, π]
    const cosTheta = Math.max(-1, Math.min(1, dz / r));
    const phi = Math.acos(cosTheta);

    return { r, theta, phi };
  }

  // ============================================================
  // 私有辅助方法 - 球谐数学
  // ============================================================

  /**
   * 计算实球谐函数 Y_lm(theta, phi)
   * 
   * ⭐ 职责：计算实球谐函数
   * ⭐ 算法：归一化常数 × 关联勒让德函数 × 角向部分
   * 
   * ⚠️ 纯数学函数，不访问 Object
   */
  _computeSphericalHarmonic(l, m, theta, phi) {
    const absM = Math.abs(m);

    // 1. 计算归一化常数
    // 计算阶乘比：(l - |m|)! / (l + |m|)!
    let factorialRatio = 1;
    for (let i = l - absM + 1; i <= l + absM; i++) {
      if (i > l - absM) {
        factorialRatio /= i;
      }
    }

    const normFactor = Math.sqrt(
      ((2 * l + 1) / (4 * Math.PI)) * factorialRatio
    );

    // 2. 计算关联勒让德函数 P_l^m(cos φ)
    const cosTheta = Math.cos(phi);
    const P_lm = this._associatedLegendre(l, absM, cosTheta);

    // 3. 计算角向部分
    let angularPart;
    if (m > 0) {
      // Y_l^m = sqrt(2) * P_l^m * cos(m * theta)
      angularPart = Math.sqrt(2) * Math.cos(m * theta);
    } else if (m < 0) {
      // Y_l^(-m) = sqrt(2) * P_l^m * sin(|m| * theta)
      angularPart = Math.sqrt(2) * Math.sin(absM * theta);
    } else {
      // Y_l^0 = P_l^0（无角向依赖）
      angularPart = 1;
    }

    // 4. 组合结果
    const Y_lm = normFactor * P_lm * angularPart;

    return Y_lm;
  }

  /**
   * 计算关联勒让德函数 P_l^m(x)
   * 
   * ⭐ 职责：计算关联勒让德函数
   * ⭐ 输入：l（阶数）, m（序数，0 <= m <= l）, x（自变量，[-1, 1]）
   * 
   * ⚠️ 纯数学递推，数值稳定性关键
   */
  _associatedLegendre(l, m, x) {
    // 验证输入
    if (m < 0 || m > l) {
      console.error('[SphericalImpl] Invalid m for associated Legendre');
      return 0;
    }

    // 特殊情况处理
    if (l === 0 && m === 0) {
      return 1;  // P_0^0(x) = 1
    }

    // 递推计算

    // 起始值 P_m^m
    let P_mm = 1;
    const sqrt1mx2 = Math.sqrt(Math.max(0, 1 - x * x));
    for (let i = 1; i <= m; i++) {
      P_mm *= -(2 * i - 1) * sqrt1mx2;
    }

    if (l === m) {
      return P_mm;
    }

    // 递推到 P_{m+1}^m
    let P_mp1m = x * (2 * m + 1) * P_mm;

    if (l === m + 1) {
      return P_mp1m;
    }

    // 双重递推到 P_l^m
    let P_llm = 0;
    for (let ll = m + 2; ll <= l; ll++) {
      P_llm = (
        x * (2 * ll - 1) * P_mp1m - (ll + m - 1) * P_mm
      ) / (ll - m);

      P_mm = P_mp1m;
      P_mp1m = P_llm;
    }

    return P_mp1m;
  }

  /**
   * 求解线性方程组 Ax = b（高斯消元法）
   * 
   * ⭐ 职责：求解线性方程组
   * ⭐ 输入：A（n × n 系数矩阵）, b（n 维右端向量）
   * 
   * ⚠️ 经典高斯消元（部分主元法），不访问 Object
   */
  _solveLinearSystem(A, b) {
    const n = A.length;

    // 【步骤1：前向消元】
    // 1. 构建增广矩阵
    const augmented = [];
    for (let i = 0; i < n; i++) {
      augmented.push([...A[i], b[i]]);
    }

    // 2. 逐列消元（部分主元法）
    for (let k = 0; k < n; k++) {
      // 选主元
      let maxRow = k;
      let maxVal = Math.abs(augmented[k][k]);
      for (let i = k + 1; i < n; i++) {
        const val = Math.abs(augmented[i][k]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = i;
        }
      }

      // 交换行
      if (maxRow !== k) {
        [augmented[k], augmented[maxRow]] = [augmented[maxRow], augmented[k]];
      }

      // 检查奇异性
      if (Math.abs(augmented[k][k]) < 1e-10) {
        console.error('[SphericalImpl] Singular matrix detected');
        return new Array(n).fill(0);
      }

      // 消元
      for (let i = k + 1; i < n; i++) {
        const factor = augmented[i][k] / augmented[k][k];
        for (let j = k; j <= n; j++) {
          augmented[i][j] -= factor * augmented[k][j];
        }
      }
    }

    // 【步骤2：回代求解】
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = augmented[i][n];
      for (let j = i + 1; j < n; j++) {
        sum -= augmented[i][j] * x[j];
      }
      x[i] = sum / augmented[i][i];
    }

    return x;
  }
}
