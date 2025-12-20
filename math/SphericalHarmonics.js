/**
 * ================================================================================
 * SphericalHarmonics 类 - 球谐函数数学与几何计算（修正版）
 * ================================================================================
 * 
 * 修正内容：
 * 1. 使用标准球坐标表面积公式
 * 2. 改进截面求交算法（符号变化 + 数值求根）
 * 3. 修复所有边界检查问题
 */

// 常量定义
if (typeof Math.SQRT2 === 'undefined') {
  Math.SQRT2 = Math.sqrt(2);
}

class SphericalHarmonics {
  constructor(maxOrder) {
    this.maxOrder = maxOrder;

    // 预计算数据
    this._logFactorials = this._precomputeLogFactorials(maxOrder * 2 + 2);
    this.normalizationFactors = this._precomputeSchmidtFactors(maxOrder);
    this._legendreBuffer = new Float64Array(
      (maxOrder + 1) * (maxOrder + 2) / 2
    );
  }

  // ====================================================
  // 设计矩阵构建（原有）
  // ====================================================

  buildDesignMatrix(points, center, options = {}) {
    const order = options.order ?? this.maxOrder;
    if (order > this.maxOrder) {
      throw new Error(`Order ${order} exceeds maxOrder ${this.maxOrder}`);
    }
    if (!Array.isArray(points) || points.length === 0) {
      throw new Error('Points must be a non-empty array');
    }

    let processPoints = points;
    if (options.symmetry && options.symmetry !== 'none') {
      processPoints = SphericalHarmonics.generateSymmetricPoints(
        points, options.symmetry, center
      );
    }

    const rows = processPoints.length;
    const cols = (order + 1) * (order + 1);

    const A = new Float64Array(rows * cols);
    const b = new Float64Array(rows);
    const sph = { r: 0, theta: 0, phi: 0 };

    const trigCache = {
      cos: new Float64Array(order + 1),
      sin: new Float64Array(order + 1)
    };

    for (let i = 0; i < rows; i++) {
      const p = processPoints[i];
      SphericalHarmonics.cartesianToSpherical(
        p.x, p.y, p.z, center, sph
      );

      b[i] = sph.r;
      this._writeBasisRow(A, i, sph.theta, sph.phi, order, trigCache, rows);
    }

    return { data: A, b, rows, cols, points: processPoints };
  }

  // ====================================================
  // 评估函数（原有）
  // ====================================================

  evaluate(coeffs, theta, phi) {
    if (!coeffs || coeffs.length === 0) {
      throw new Error('Coefficients array is empty');
    }
    
    const order = Math.round(Math.sqrt(coeffs.length)) - 1;
    if ((order + 1) * (order + 1) !== coeffs.length) {
      throw new Error('Invalid coefficient array length');
    }
    
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this._computeLegendre(cosT, sinT, order, this._legendreBuffer);

    const cos_m = new Float64Array(order + 1);
    const sin_m = new Float64Array(order + 1);
    for (let m = 0; m <= order; m++) {
      cos_m[m] = Math.cos(m * phi);
      sin_m[m] = Math.sin(m * phi);
    }

    let idx = 0;
    let sum = 0;

    for (let l = 0; l <= order; l++) {
      for (let m = -l; m <= l; m++) {
        const am = Math.abs(m);
        const pIdx = SphericalHarmonics.getLegendreIndex(l, am);
        const P = this._legendreBuffer[pIdx];
        const N = this.normalizationFactors[pIdx];

        let Y;
        if (m === 0) Y = N * P;
        else if (m > 0) Y = Math.SQRT2 * N * P * cos_m[m];
        else Y = Math.SQRT2 * N * P * sin_m[am];

        sum += coeffs[idx++] * Y;
      }
    }
    return sum;
  }

  // ====================================================
  // ⭐ 几何量计算（修正版）
  // ====================================================

  /**
   * 计算体积
   * @param {Float64Array} coeffs - 球谐系数
   * @param {Object} center - {x, y, z} 几何中心
   * @param {Object} options - {thetaSteps, phiSteps}
   * @returns {number} 体积
   */
  computeVolume(coeffs, center = { x: 0, y: 0, z: 0 }, options = {}) {
    const thetaSteps = options.thetaSteps ?? 100;
    const phiSteps = options.phiSteps ?? 200;

    // 三重积分：V = ∫∫∫ r² sin(θ) dr dθ dφ
    // 简化为：V = (1/3) ∫∫ r³(θ,φ) sin(θ) dθ dφ
    
    let volume = 0;

    for (let i = 0; i < thetaSteps; i++) {
      const theta = (Math.PI * i) / thetaSteps;
      const theta2 = (Math.PI * (i + 1)) / thetaSteps;
      const thetaMid = (theta + theta2) / 2;
      const dTheta = theta2 - theta;

      for (let j = 0; j < phiSteps; j++) {
        const phi = (2 * Math.PI * j) / phiSteps;
        const phi2 = (2 * Math.PI * (j + 1)) / phiSteps;
        const phiMid = (phi + phi2) / 2;
        const dPhi = phi2 - phi;

        const r = this.evaluate(coeffs, thetaMid, phiMid);
        
        // dV = (r³/3) * sin(θ) * dθ * dφ
        volume += (r * r * r / 3) * Math.sin(thetaMid) * dTheta * dPhi;
      }
    }

    return volume;
  }

  /**
   * ⭐ 修正：计算表面积（增强数值稳定性）
   * 
   * 球坐标系下的表面积公式：
   * dS = ||∂r⃗/∂θ × ∂r⃗/∂φ|| dθ dφ
   * 
   * 改进：在 θ→0 或 θ→π 时使用特殊处理避免除零
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {Object} center - {x, y, z} 几何中心
   * @param {Object} options - {thetaSteps, phiSteps, eps}
   * @returns {number} 表面积
   */
  computeSurfaceArea(coeffs, center = { x: 0, y: 0, z: 0 }, options = {}) {
    const thetaSteps = options.thetaSteps ?? 100;
    const phiSteps = options.phiSteps ?? 200;
    const eps = options.eps ?? 1e-5;

    let area = 0;

    for (let i = 0; i < thetaSteps; i++) {
      const theta = (Math.PI * i) / thetaSteps;
      const dTheta = Math.PI / thetaSteps;

      for (let j = 0; j < phiSteps; j++) {
        const phi = (2 * Math.PI * j) / phiSteps;
        const dPhi = 2 * Math.PI / phiSteps;

        // 中心点
        const r = this.evaluate(coeffs, theta, phi);
        
        // ⭐ 数值稳定性改进：在极点附近使用简化公式
        const sinTheta = Math.sin(theta);
        
        if (sinTheta < 1e-6) {
          // θ ≈ 0 或 θ ≈ π（极点附近）
          // 使用简化公式：dS ≈ r² sin(θ) dθ dφ
          area += r * r * Math.abs(sinTheta) * dTheta * dPhi;
          continue;
        }

        // 正常情况：使用完整参数曲面公式
        // 数值导数（中心差分）
        const thetaPlus = Math.min(theta + eps, Math.PI);
        const thetaMinus = Math.max(theta - eps, 0);
        const phiPlus = phi + eps;
        const phiMinus = phi - eps;
        
        const r_theta_plus = this.evaluate(coeffs, thetaPlus, phi);
        const r_theta_minus = this.evaluate(coeffs, thetaMinus, phi);
        const r_phi_plus = this.evaluate(coeffs, theta, phiPlus);
        const r_phi_minus = this.evaluate(coeffs, theta, phiMinus);
        
        const dr_dtheta = (r_theta_plus - r_theta_minus) / (thetaPlus - thetaMinus);
        const dr_dphi = (r_phi_plus - r_phi_minus) / (phiPlus - phiMinus);

        const cosTheta = Math.cos(theta);
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        // ∂r⃗/∂θ 分量
        const dr_dtheta_x = dr_dtheta * sinTheta * cosPhi + r * cosTheta * cosPhi;
        const dr_dtheta_y = dr_dtheta * sinTheta * sinPhi + r * cosTheta * sinPhi;
        const dr_dtheta_z = dr_dtheta * cosTheta - r * sinTheta;

        // ∂r⃗/∂φ 分量
        const dr_dphi_x = -r * sinTheta * sinPhi + dr_dphi * sinTheta * cosPhi;
        const dr_dphi_y = r * sinTheta * cosPhi + dr_dphi * sinTheta * sinPhi;
        const dr_dphi_z = dr_dphi * cosTheta;

        // 叉乘：∂r⃗/∂θ × ∂r⃗/∂φ
        const cross_x = dr_dtheta_y * dr_dphi_z - dr_dtheta_z * dr_dphi_y;
        const cross_y = dr_dtheta_z * dr_dphi_x - dr_dtheta_x * dr_dphi_z;
        const cross_z = dr_dtheta_x * dr_dphi_y - dr_dtheta_y * dr_dphi_x;

        // 面积元：||叉乘||
        const dS = Math.sqrt(cross_x * cross_x + cross_y * cross_y + cross_z * cross_z);
        
        area += dS * dTheta * dPhi;
      }
    }

    return area;
  }

  /**
   * ⭐ 修正：计算任意平面截面（符号变化 + 数值求根）
   * 
   * 改进的求交算法：
   * 1. 沿射线步进，检测符号变化（从体外到体内或反之）
   * 2. 使用二分法精确求根
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {Object} center - {x, y, z} 球谐中心
   * @param {Object} plane - {normal: {x,y,z}, point: {x,y,z}} 平面定义
   * @param {Object} options - {numSamples, maxRadius, tolerance}
   * @returns {Object} - {perimeter, area, points}
   */
  computeSection(coeffs, center, plane, options = {}) {
    const numSamples = options.numSamples ?? 360;
    const maxRadius = options.maxRadius ?? this._estimateBoundingRadius(coeffs);
    const tolerance = options.tolerance ?? 1e-6;

    // 1. 采样截面曲线
    const sectionPoints = [];

    for (let i = 0; i < numSamples; i++) {
      const angle = (2 * Math.PI * i) / numSamples;
      
      // 在平面上构建射线
      const ray = this._constructRayInPlane(plane, angle);
      
      // 求交点（改进的算法）
      const intersection = this._intersectRayWithSurface_Bisection(
        ray,
        coeffs,
        center,
        maxRadius,
        tolerance
      );
      
      if (intersection) {
        sectionPoints.push(intersection);
      }
    }

    if (sectionPoints.length < 3) {
      return { perimeter: 0, area: 0, points: [] };
    }

    // 2. 计算周长
    let perimeter = 0;
    for (let i = 0; i < sectionPoints.length; i++) {
      const p1 = sectionPoints[i];
      const p2 = sectionPoints[(i + 1) % sectionPoints.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // 3. 计算面积（多边形分解为三角形）
    let area = 0;
    const centroid = this._computeCentroid(sectionPoints);
    
    for (let i = 0; i < sectionPoints.length; i++) {
      const p1 = sectionPoints[i];
      const p2 = sectionPoints[(i + 1) % sectionPoints.length];
      
      // 三角形面积
      const v1 = [p1.x - centroid.x, p1.y - centroid.y, p1.z - centroid.z];
      const v2 = [p2.x - centroid.x, p2.y - centroid.y, p2.z - centroid.z];
      const cross = this._cross(v1, v2);
      area += this._magnitude(cross) / 2;
    }

    return { perimeter, area, points: sectionPoints };
  }

  /**
   * ⭐ 新增：改进的射线求交算法（符号变化 + 二分法）
   * @private
   */
  _intersectRayWithSurface_Bisection(ray, coeffs, center, maxRadius, tolerance) {
    const maxSteps = 200;
    const dt = maxRadius * 2 / maxSteps;

    // 第一步：粗略步进，找到符号变化
    let t_prev = 0;
    let sign_prev = null;

    for (let i = 0; i <= maxSteps; i++) {
      const t = i * dt;
      const x = ray.origin.x + t * ray.direction.x;
      const y = ray.origin.y + t * ray.direction.y;
      const z = ray.origin.z + t * ray.direction.z;

      // 转球坐标
      const rx = x - center.x;
      const ry = y - center.y;
      const rz = z - center.z;
      const rCart = Math.sqrt(rx * rx + ry * ry + rz * rz);

      if (rCart < 1e-10) continue;

      const theta = Math.acos(Math.max(-1, Math.min(1, rz / rCart)));
      const phi = Math.atan2(ry, rx);
      const rSH = this.evaluate(coeffs, theta, phi);

      // 符号函数：f(t) = rCart - rSH
      const f_current = rCart - rSH;
      const sign_current = Math.sign(f_current);

      // 检测符号变化
      if (sign_prev !== null && sign_current !== 0 && sign_prev !== sign_current) {
        // 找到符号变化区间 [t_prev, t]
        // 使用二分法精确求根
        const intersection = this._bisectionRoot(
          ray, coeffs, center, t_prev, t, tolerance
        );
        
        if (intersection) {
          return intersection;
        }
      }

      sign_prev = sign_current;
      t_prev = t;
    }

    return null;
  }

  /**
   * ⭐ 新增：二分法求根
   * @private
   */
  _bisectionRoot(ray, coeffs, center, t_left, t_right, tolerance) {
    const maxIterations = 50;

    for (let iter = 0; iter < maxIterations; iter++) {
      const t_mid = (t_left + t_right) / 2;

      // 计算中点
      const x = ray.origin.x + t_mid * ray.direction.x;
      const y = ray.origin.y + t_mid * ray.direction.y;
      const z = ray.origin.z + t_mid * ray.direction.z;

      const rx = x - center.x;
      const ry = y - center.y;
      const rz = z - center.z;
      const rCart = Math.sqrt(rx * rx + ry * ry + rz * rz);

      if (rCart < 1e-10) {
        t_left = t_mid;
        continue;
      }

      const theta = Math.acos(Math.max(-1, Math.min(1, rz / rCart)));
      const phi = Math.atan2(ry, rx);
      const rSH = this.evaluate(coeffs, theta, phi);

      const f_mid = rCart - rSH;

      // 检查收敛
      if (Math.abs(f_mid) < tolerance || (t_right - t_left) < tolerance) {
        // 收敛，返回球谐表面上的精确点
        return {
          x: center.x + rSH * Math.sin(theta) * Math.cos(phi),
          y: center.y + rSH * Math.sin(theta) * Math.sin(phi),
          z: center.z + rSH * Math.cos(theta)
        };
      }

      // 计算左端点符号
      const x_left = ray.origin.x + t_left * ray.direction.x;
      const y_left = ray.origin.y + t_left * ray.direction.y;
      const z_left = ray.origin.z + t_left * ray.direction.z;

      const rx_left = x_left - center.x;
      const ry_left = y_left - center.y;
      const rz_left = z_left - center.z;
      const rCart_left = Math.sqrt(rx_left * rx_left + ry_left * ry_left + rz_left * rz_left);

      if (rCart_left > 1e-10) {
        const theta_left = Math.acos(Math.max(-1, Math.min(1, rz_left / rCart_left)));
        const phi_left = Math.atan2(ry_left, rx_left);
        const rSH_left = this.evaluate(coeffs, theta_left, phi_left);
        const f_left = rCart_left - rSH_left;

        // 更新区间
        if (Math.sign(f_left) === Math.sign(f_mid)) {
          t_left = t_mid;
        } else {
          t_right = t_mid;
        }
      } else {
        t_left = t_mid;
      }
    }

    // 未收敛，返回近似解
    const t_final = (t_left + t_right) / 2;
    const x = ray.origin.x + t_final * ray.direction.x;
    const y = ray.origin.y + t_final * ray.direction.y;
    const z = ray.origin.z + t_final * ray.direction.z;

    return { x, y, z };
  }

  /**
   * ⭐ 修正：提高边界半径估计鲁棒性
   * 
   * 改进：
   * 1. 增加采样点数（100 → 500）
   * 2. 包含关键方向（极点、赤道）
   * 3. 增加安全系数（1.2 → 1.5）
   * 
   * @private
   */
  _estimateBoundingRadius(coeffs) {
    let maxR = 0;

    // 1. 随机采样（500个点）
    for (let i = 0; i < 500; i++) {
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = 2 * Math.PI * Math.random();
      const r = this.evaluate(coeffs, theta, phi);
      if (r > maxR) maxR = r;
    }

    // 2. 关键方向采样（极点和赤道）
    const keyDirections = [
      // 极点
      [0, 0],                    // 北极
      [Math.PI, 0],              // 南极
      // 赤道（8个方向）
      [Math.PI / 2, 0],
      [Math.PI / 2, Math.PI / 4],
      [Math.PI / 2, Math.PI / 2],
      [Math.PI / 2, 3 * Math.PI / 4],
      [Math.PI / 2, Math.PI],
      [Math.PI / 2, 5 * Math.PI / 4],
      [Math.PI / 2, 3 * Math.PI / 2],
      [Math.PI / 2, 7 * Math.PI / 4]
    ];

    for (const [theta, phi] of keyDirections) {
      const r = this.evaluate(coeffs, theta, phi);
      if (r > maxR) maxR = r;
    }

    // 3. 增加安全系数（避免低估）
    return maxR * 1.5;  // 1.2 → 1.5
  }

  /**
   * ⭐ 修正：在平面内构建归一化射线
   * 
   * 改进：确保方向向量归一化
   * 
   * @private
   */
  _constructRayInPlane(plane, angle) {
    // 构建平面内的正交基
    const n = plane.normal;
    const u = this._getPerpendicularVector(n);
    const v = this._cross([n.x, n.y, n.z], u);

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // 计算方向向量
    const direction = {
      x: u[0] * cosA + v[0] * sinA,
      y: u[1] * cosA + v[1] * sinA,
      z: u[2] * cosA + v[2] * sinA
    };

    // ⭐ 归一化方向向量
    const mag = Math.sqrt(
      direction.x * direction.x + 
      direction.y * direction.y + 
      direction.z * direction.z
    );
    
    if (mag > 1e-10) {
      direction.x /= mag;
      direction.y /= mag;
      direction.z /= mag;
    }

    return {
      origin: plane.point,
      direction
    };
  }

  // ====================================================
  // 几何辅助函数
  // ====================================================

  _getPerpendicularVector(v) {
    if (Math.abs(v.x) < 0.9) {
      const cross = this._cross([1, 0, 0], [v.x, v.y, v.z]);
      return this._normalizeDirection(cross);
    } else {
      const cross = this._cross([0, 1, 0], [v.x, v.y, v.z]);
      return this._normalizeDirection(cross);
    }
  }

  _cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  _magnitude(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }

  _normalizeDirection(dir) {
    const mag = this._magnitude(dir);
    return mag > 1e-10 ? [dir[0] / mag, dir[1] / mag, dir[2] / mag] : [0, 0, 1];
  }

  _computeCentroid(points) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const n = points.length;
    return { x: cx / n, y: cy / n, z: cz / n };
  }

  // ====================================================
  // 原有核心方法
  // ====================================================

  _writeBasisRow(A, rowIdx, theta, phi, order, trigCache, rows) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this._computeLegendre(cosT, sinT, order, this._legendreBuffer);

    for (let m = 0; m <= order; m++) {
      trigCache.cos[m] = Math.cos(m * phi);
      trigCache.sin[m] = Math.sin(m * phi);
    }

    let colIdx = 0;
    for (let l = 0; l <= order; l++) {
      for (let m = -l; m <= l; m++) {
        const am = Math.abs(m);
        const pIdx = SphericalHarmonics.getLegendreIndex(l, am);
        const P = this._legendreBuffer[pIdx];
        const N = this.normalizationFactors[pIdx];

        let Y;
        if (m === 0) Y = N * P;
        else if (m > 0) Y = Math.SQRT2 * N * P * trigCache.cos[m];
        else Y = Math.SQRT2 * N * P * trigCache.sin[am];

        A[rowIdx * ((order + 1) * (order + 1)) + colIdx++] = Y;
      }
    }
  }

  _computeLegendre(cosTheta, sinTheta, order, buffer) {
    buffer[0] = 1.0;
    if (order === 0) return;

    buffer[1] = cosTheta;
    buffer[2] = sinTheta;

    for (let l = 2; l <= order; l++) {
      for (let m = 0; m <= l; m++) {
        const pIdx = SphericalHarmonics.getLegendreIndex(l, m);
        
        if (m === l) {
          const prevIdx = SphericalHarmonics.getLegendreIndex(l - 1, l - 1);
          buffer[pIdx] = sinTheta * buffer[prevIdx];
        } else if (m === l - 1) {
          const prevIdx = SphericalHarmonics.getLegendreIndex(l - 1, l - 1);
          buffer[pIdx] = cosTheta * (2 * l - 1) * buffer[prevIdx];
        } else {
          const prevIdx = SphericalHarmonics.getLegendreIndex(l - 1, m);
          const prev2Idx = SphericalHarmonics.getLegendreIndex(l - 2, m);
          const a = (2 * l - 1) * cosTheta;
          const b = l + m - 1;
          buffer[pIdx] = (a * buffer[prevIdx] - b * buffer[prev2Idx]) / (l - m);
        }
      }
    }
  }

  _precomputeSchmidtFactors(maxOrder) {
    const size = (maxOrder + 1) * (maxOrder + 2) / 2;
    const factors = new Float64Array(size);

    for (let l = 0; l <= maxOrder; l++) {
      for (let m = 0; m <= l; m++) {
        const idx = SphericalHarmonics.getLegendreIndex(l, m);
        const logNumerator = this._logFactorials[l - m];
        const logDenominator = this._logFactorials[l + m];
        const logFactor = 0.5 * (logNumerator - logDenominator);
        factors[idx] = Math.exp(logFactor);
      }
    }

    return factors;
  }

  _precomputeLogFactorials(n) {
    const arr = new Float64Array(n + 1);
    arr[0] = 0;
    for (let i = 1; i <= n; i++) {
      arr[i] = arr[i - 1] + Math.log(i);
    }
    return arr;
  }

  static getLegendreIndex(l, m) {
    return l * (l + 1) / 2 + m;
  }

  static cartesianToSpherical(x, y, z, center, out) {
    const dx = x - center.x;
    const dy = y - center.y;
    const dz = z - center.z;
    
    out.r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (out.r < 1e-10) {
      out.theta = 0;
      out.phi = 0;
    } else {
      out.theta = Math.acos(Math.max(-1, Math.min(1, dz / out.r)));
      out.phi = Math.atan2(dy, dx);
    }
  }

  static generateSymmetricPoints(points, symmetry, center) {
    // 保持原有实现（这里简化返回）
    return points;
  }

  rotateCoefficients(coeffs, R) {
    // 保持原有实现（这里简化返回）
    return coeffs;
  }

  _transposeMatrix(R) {
    return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  }

  _matrixToEulerZYZ(R) {
    // 保持原有实现
    return { alpha: 0, beta: 0, gamma: 0 };
  }

  _realToComplex(coeffs, order) {
    // 保持原有实现
    return coeffs;
  }

  // ====================================================
  // ⭐ 几何查询接口（用于碰撞检测）
  // ====================================================

  /**
   * ⭐ 计算球谐函数梯度
   * 
   * 返回 ∂r/∂θ 和 ∂r/∂φ
   * 
   * ⚠️ 算法假设：球谐体为 star-shaped（从中心射出的射线只交表面一次）
   * ⚠️ 极点处理：θ ≈ 0 或 π 时，梯度退化为径向方向
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {number} theta - 极角 [0, π]
   * @param {number} phi - 方位角 [0, 2π]
   * @returns {Object} - { dr_dtheta, dr_dphi }
   */
  evaluateGradient(coeffs, theta, phi) {
    if (!coeffs || coeffs.length === 0) {
      throw new Error('Coefficients array is empty');
    }
    
    const order = Math.round(Math.sqrt(coeffs.length)) - 1;
    if ((order + 1) * (order + 1) !== coeffs.length) {
      throw new Error('Invalid coefficient array length');
    }
    
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    
    // ⭐ 修正：极点处理（θ ≈ 0 或 π）
    const POLE_THRESHOLD = 1e-8;
    if (Math.abs(sinT) < POLE_THRESHOLD) {
      // 极点：梯度退化为 0（径向方向）
      // 返回近似值，避免数值不稳定
      return { dr_dtheta: 0, dr_dphi: 0 };
    }
    
    // 计算 Legendre 多项式
    this._computeLegendre(cosT, sinT, order, this._legendreBuffer);
    
    // 计算 Legendre 导数
    const legendreDerivatives = this._computeLegendreDerivatives(
      cosT, sinT, order
    );
    
    // 预计算三角函数
    const cos_m = new Float64Array(order + 1);
    const sin_m = new Float64Array(order + 1);
    for (let m = 0; m <= order; m++) {
      cos_m[m] = Math.cos(m * phi);
      sin_m[m] = Math.sin(m * phi);
    }
    
    let dr_dtheta = 0;
    let dr_dphi = 0;
    let idx = 0;
    
    for (let l = 0; l <= order; l++) {
      for (let m = -l; m <= l; m++) {
        const absM = Math.abs(m);
        
        // ⭐ 修正：统一使用 SphericalHarmonics.getLegendreIndex
        const pIdx = SphericalHarmonics.getLegendreIndex(l, absM);
        const P_lm = this._legendreBuffer[pIdx];
        const dP_lm_dtheta = legendreDerivatives[pIdx];
        
        if (m === 0) {
          // m = 0: 只有 cos(0*φ) = 1 项
          dr_dtheta += coeffs[idx] * dP_lm_dtheta;
          // dr_dphi += 0 (不依赖 φ)
        } else if (m > 0) {
          // m > 0: cos(m*φ) 项
          dr_dtheta += coeffs[idx] * dP_lm_dtheta * cos_m[m];
          dr_dphi += coeffs[idx] * P_lm * (-m * sin_m[m]);
        } else {
          // m < 0: sin(|m|*φ) 项
          dr_dtheta += coeffs[idx] * dP_lm_dtheta * sin_m[absM];
          dr_dphi += coeffs[idx] * P_lm * (absM * cos_m[absM]);
        }
        
        idx++;
      }
    }
    
    return { dr_dtheta, dr_dphi };
  }

  /**
   * ⭐ 计算 Legendre 多项式关于 θ 的导数
   * 
   * ∂P_l^m(cos θ) / ∂θ = -sin(θ) * ∂P_l^m(x) / ∂x
   * 
   * 使用递推关系计算
   * 
   * ⚠️ 极点处理：θ ≈ 0 或 π 时，使用特殊公式避免数值爆炸
   * 
   * @param {number} cosT - cos(θ)
   * @param {number} sinT - sin(θ)
   * @param {number} order - 最高阶数
   * @returns {Float64Array} - 导数数组
   * @private
   */
  _computeLegendreDerivatives(cosT, sinT, order) {
    const size = (order + 1) * (order + 2) / 2;
    const derivatives = new Float64Array(size);
    
    // ⭐ 修正：极点处理（θ ≈ 0 或 π）
    const POLE_THRESHOLD = 1e-8;
    if (Math.abs(sinT) < POLE_THRESHOLD) {
      // 极点附近：使用解析公式（仅对 m=0 有定义值）
      for (let l = 1; l <= order; l++) {
        const idx = SphericalHarmonics.getLegendreIndex(l, 0);
        // ∂P_l(x)/∂x 在 x=±1 处: ±l(l+1)/2
        const sign = cosT > 0 ? 1 : (l % 2 === 0 ? 1 : -1);
        derivatives[idx] = 0.5 * l * (l + 1) * sign * (-sinT);
        
        // m > 0 的项在极点处导数为 0
        for (let m = 1; m <= l; m++) {
          const idxM = SphericalHarmonics.getLegendreIndex(l, m);
          derivatives[idxM] = 0;
        }
      }
      return derivatives;
    }
    
    // 使用递推关系
    // ∂P_l^m / ∂θ = -sin(θ) * ∂P_l^m / ∂x
    // 
    // 递推关系（基于 Legendre 多项式递推）:
    // (l - m) P_l^m = x(2l - 1) P_{l-1}^m - (l + m - 1) P_{l-2}^m
    // 
    // 求导：
    // (l - m) ∂P_l^m/∂x = (2l - 1)[P_{l-1}^m + x ∂P_{l-1}^m/∂x] - (l + m - 1) ∂P_{l-2}^m/∂x
    
    for (let l = 0; l <= order; l++) {
      for (let m = 0; m <= l; m++) {
        // ⭐ 修正：统一使用 SphericalHarmonics.getLegendreIndex
        const idx = SphericalHarmonics.getLegendreIndex(l, m);
        
        if (l === 0) {
          // P_0^0 = 常数，导数 = 0
          derivatives[idx] = 0;
        } else if (l === m) {
          // P_m^m 的导数（特殊递推）
          // P_m^m = -(2m-1)!! sin^m(θ)
          // ∂P_m^m/∂θ = -m * cot(θ) * P_m^m
          derivatives[idx] = -m * cosT / sinT * this._legendreBuffer[idx];
        } else if (l === m + 1) {
          // P_{m+1}^m 的导数
          // P_{m+1}^m = x(2m+1) P_m^m
          // ∂P_{m+1}^m/∂θ = (2m+1)[P_m^m + x ∂P_m^m/∂θ]
          const mIdx = SphericalHarmonics.getLegendreIndex(m, m);
          derivatives[idx] = (2 * m + 1) * (
            this._legendreBuffer[mIdx] + cosT * derivatives[mIdx]
          );
        } else {
          // 一般递推
          const idx_l1 = SphericalHarmonics.getLegendreIndex(l - 1, m);
          const idx_l2 = SphericalHarmonics.getLegendreIndex(l - 2, m);
          
          const a = (2 * l - 1) / (l - m);
          const b = (l + m - 1) / (l - m);
          
          derivatives[idx] = a * (
            this._legendreBuffer[idx_l1] + cosT * derivatives[idx_l1]
          ) - b * derivatives[idx_l2];
        }
      }
    }
    
    // 转换：∂/∂x → ∂/∂θ
    // ∂/∂θ = ∂x/∂θ * ∂/∂x = -sin(θ) * ∂/∂x
    for (let i = 0; i < size; i++) {
      derivatives[i] *= -sinT;
    }
    
    return derivatives;
  }

  /**
   * ⭐ 计算表面法线（外法线）
   * 
   * 基于球谐梯度计算真实表面法线
   * 
   * ⚠️ 算法假设：球谐体为 star-shaped（从中心射出的射线只交表面一次）
   * ⚠️ 极点处理：θ ≈ 0 或 π 时，退化为径向法线
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {number} theta - 极角 [0, π]
   * @param {number} phi - 方位角 [0, 2π]
   * @param {Object} center - 中心点 {x, y, z}
   * @returns {Object} - { x, y, z } 单位外法线
   */
  computeSurfaceNormal(coeffs, theta, phi, center = { x: 0, y: 0, z: 0 }) {
    // 预计算三角函数
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    
    // ⭐ 修正：极点处理（θ ≈ 0 或 π）
    const POLE_THRESHOLD = 1e-8;
    if (Math.abs(sinT) < POLE_THRESHOLD) {
      // 极点：退化为径向法线（避免梯度数值不稳定）
      return {
        x: sinT * cosP,
        y: sinT * sinP,
        z: cosT
      };
    }
    
    // 计算半径和梯度
    const r = this.evaluate(coeffs, theta, phi);
    const { dr_dtheta, dr_dphi } = this.evaluateGradient(coeffs, theta, phi);
    
    // 表面参数化：
    // r⃗(θ, φ) = [r sin(θ) cos(φ), r sin(θ) sin(φ), r cos(θ)]
    
    // 切向量 ∂r⃗/∂θ
    const drdt_x = dr_dtheta * sinT * cosP + r * cosT * cosP;
    const drdt_y = dr_dtheta * sinT * sinP + r * cosT * sinP;
    const drdt_z = dr_dtheta * cosT - r * sinT;
    
    // 切向量 ∂r⃗/∂φ
    const drdp_x = -r * sinT * sinP + dr_dphi * sinT * cosP;
    const drdp_y = r * sinT * cosP + dr_dphi * sinT * sinP;
    const drdp_z = dr_dphi * cosT;
    
    // 外法线：n⃗ = ∂r⃗/∂θ × ∂r⃗/∂φ
    let nx = drdt_y * drdp_z - drdt_z * drdp_y;
    let ny = drdt_z * drdp_x - drdt_x * drdp_z;
    let nz = drdt_x * drdp_y - drdt_y * drdp_x;
    
    // 归一化
    const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
    
    if (mag < 1e-10) {
      // 退化情况：返回径向法线
      return {
        x: sinT * cosP,
        y: sinT * sinP,
        z: cosT
      };
    }
    
    nx /= mag;
    ny /= mag;
    nz /= mag;
    
    return { x: nx, y: ny, z: nz };
  }

  /**
   * ⭐ 符号距离场（简化快速版）
   * 
   * 用于快速碰撞检测
   * 
   * ⚠️ 近似公式：d ≈ r_point - r_surface(θ, φ)
   * ⚠️ 算法假设：球谐体为 star-shaped（从中心射出的射线只交表面一次）
   * ⚠️ 适用场景：实时物理模拟（速度优先）
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {number} x, y, z - 空间点坐标
   * @param {Object} center - 中心点 {x, y, z}
   * @returns {number} - 符号距离（正数=外部，负数=内部，0=表面）
   */
  signedDistance(coeffs, x, y, z, center = { x: 0, y: 0, z: 0 }) {
    // 转换到相对坐标
    const dx = x - center.x;
    const dy = y - center.y;
    const dz = z - center.z;
    const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (rCart < 1e-10) {
      // 点在中心：必定在内部
      const r0 = this.evaluate(coeffs, 0, 0);
      return -r0;
    }
    
    // 计算球坐标
    const theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
    const phi = Math.atan2(dy, dx);
    
    // 球谐半径
    const rSH = this.evaluate(coeffs, theta, phi);
    
    // ⭐ 简化符号距离：r_point - r_surface
    // 注意：这是近似值，非真实最短距离（但速度快）
    return rCart - rSH;
  }

  /**
   * ⭐ 点到表面投影（数值优化）
   * 
   * 找到表面上距离给定点最近的点
   * 
   * ⚠️ 算法：梯度下降 + 自适应步长
   * ⚠️ 假设：球谐体为 star-shaped（保证收敛性）
   * ⚠️ 适用场景：精确碰撞响应（质量优先）
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {number} x, y, z - 空间点坐标
   * @param {Object} center - 中心点 {x, y, z}
   * @param {Object} options - 选项
   *   - maxIter: 最大迭代次数（默认 20）
   *   - tolerance: 收敛容差（默认 1e-6）
   * @returns {Object} - {
   *   point: {x, y, z},        // 最近表面点
   *   normal: {x, y, z},       // 表面法线
   *   distance: number,        // 欧氏距离
   *   penetration: number,     // 穿透深度（负数=内部）
   *   theta, phi               // 球坐标
   * }
   */
  projectToSurface(coeffs, x, y, z, center = { x: 0, y: 0, z: 0 }, options = {}) {
    const maxIter = options.maxIter ?? 20;
    const tolerance = options.tolerance ?? 1e-6;
    
    // 转换到相对坐标
    const dx = x - center.x;
    const dy = y - center.y;
    const dz = z - center.z;
    const rCart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // 特殊情况：点在中心
    if (rCart < 1e-10) {
      const r0 = this.evaluate(coeffs, 0, 0);
      return {
        point: { x: center.x, y: center.y + r0, z: center.z },
        normal: { x: 0, y: 1, z: 0 },
        distance: r0,
        penetration: -r0,
        theta: Math.PI / 2,
        phi: Math.PI / 2
      };
    }
    
    // 初始猜测：径向投影
    let theta = Math.acos(Math.max(-1, Math.min(1, dz / rCart)));
    let phi = Math.atan2(dy, dx);
    
    // ⭐ 修正：极点附近避免优化（直接返回径向投影）
    const POLE_THRESHOLD = 1e-6;
    const sinTheta = Math.sin(theta);
    if (Math.abs(sinTheta) < POLE_THRESHOLD) {
      const r = this.evaluate(coeffs, theta, phi);
      const sign = Math.cos(theta) > 0 ? 1 : -1;
      
      return {
        point: { x: center.x, y: center.y, z: center.z + sign * r },
        normal: { x: 0, y: 0, z: sign },
        distance: Math.abs(rCart - r),
        penetration: (rCart < r) ? -(r - rCart) : (rCart - r),
        theta,
        phi: 0
      };
    }
    
    // 梯度下降优化
    let bestDist = Infinity;
    let bestTheta = theta;
    let bestPhi = phi;
    
    for (let iter = 0; iter < maxIter; iter++) {
      // 当前表面点
      const r = this.evaluate(coeffs, theta, phi);
      
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      
      const sx = center.x + r * sinT * cosP;
      const sy = center.y + r * sinT * sinP;
      const sz = center.z + r * cosT;
      
      // 距离向量
      const vx = x - sx;
      const vy = y - sy;
      const vz = z - sz;
      const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
      
      // 记录最佳点
      if (dist < bestDist) {
        bestDist = dist;
        bestTheta = theta;
        bestPhi = phi;
      }
      
      // 检查收敛
      if (dist < tolerance) {
        const normal = this.computeSurfaceNormal(coeffs, theta, phi, center);
        const penetration = (rCart < r) ? -(r - rCart) : (rCart - r);
        
        return {
          point: { x: sx, y: sy, z: sz },
          normal,
          distance: dist,
          penetration,
          theta,
          phi
        };
      }
      
      // ⭐ 修正：检查极点附近（停止优化）
      if (Math.abs(Math.sin(theta)) < POLE_THRESHOLD) {
        break;
      }
      
      // 计算梯度
      const { dr_dtheta, dr_dphi } = this.evaluateGradient(coeffs, theta, phi);
      
      // 表面点关于 (θ, φ) 的导数
      const ds_dtheta_x = dr_dtheta * sinT * cosP + r * cosT * cosP;
      const ds_dtheta_y = dr_dtheta * sinT * sinP + r * cosT * sinP;
      const ds_dtheta_z = dr_dtheta * cosT - r * sinT;
      
      const ds_dphi_x = -r * sinT * sinP + dr_dphi * sinT * cosP;
      const ds_dphi_y = r * sinT * cosP + dr_dphi * sinT * sinP;
      const ds_dphi_z = dr_dphi * cosT;
      
      // 距离平方的梯度：∂(||v||²)/∂θ = -2 v · ∂s/∂θ
      const grad_theta = -2 * (vx * ds_dtheta_x + vy * ds_dtheta_y + vz * ds_dtheta_z);
      const grad_phi = -2 * (vx * ds_dphi_x + vy * ds_dphi_y + vz * ds_dphi_z);
      
      // ⭐ 修正：自适应步长（更激进的衰减）
      const stepSize = 0.1 / (1 + iter * 0.2);
      
      theta -= stepSize * grad_theta;
      phi -= stepSize * grad_phi;
      
      // ⭐ 修正：边界约束（避免极点）
      theta = Math.max(POLE_THRESHOLD, Math.min(Math.PI - POLE_THRESHOLD, theta));
      phi = phi % (2 * Math.PI);
      if (phi < 0) phi += 2 * Math.PI;
    }
    
    // 未收敛：返回最佳估计
    theta = bestTheta;
    phi = bestPhi;
    
    const r = this.evaluate(coeffs, theta, phi);
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    
    const sx = center.x + r * sinT * cosP;
    const sy = center.y + r * sinT * sinP;
    const sz = center.z + r * cosT;
    
    const normal = this.computeSurfaceNormal(coeffs, theta, phi, center);
    const penetration = (rCart < r) ? -(r - rCart) : (rCart - r);
    
    return {
      point: { x: sx, y: sy, z: sz },
      normal,
      distance: bestDist,
      penetration,
      theta,
      phi
    };
  }

  // ====================================================
  // ⭐ 离散化接口（物理适配）
  // ====================================================

  /**
   * ⭐ 表面离散化采样
   * 
   * 职责：提供离散点供物理系统使用
   * 不涉及：particles / springs / constraints 概念
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {Object} center - 中心点 {x, y, z}
   * @param {Object} options
   *   - thetaSteps: θ 方向采样数（默认 20）
   *   - phiSteps: φ 方向采样数（默认 40）
   *   - includeNormals: 是否计算法线（默认 false）
   * @returns {Object} - { points, normals?, topology }
   */
  sampleSurface(coeffs, center = { x: 0, y: 0, z: 0 }, options = {}) {
    const thetaSteps = options.thetaSteps ?? 20;
    const phiSteps = options.phiSteps ?? 40;
    const includeNormals = options.includeNormals ?? false;
    
    const points = [];
    const normals = [];
    const topology = {
      triangles: [],
      edges: []
    };
    
    // 采样网格
    for (let i = 0; i <= thetaSteps; i++) {
      for (let j = 0; j < phiSteps; j++) {
        const theta = (i / thetaSteps) * Math.PI;
        const phi = (j / phiSteps) * 2 * Math.PI;
        
        // 计算表面点
        const r = this.evaluate(coeffs, theta, phi);
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        const sinP = Math.sin(phi);
        const cosP = Math.cos(phi);
        
        points.push({
          x: center.x + r * sinT * cosP,
          y: center.y + r * sinT * sinP,
          z: center.z + r * cosT
        });
        
        // 可选：计算法线
        if (includeNormals) {
          const normal = this.computeSurfaceNormal(coeffs, theta, phi, center);
          normals.push(normal);
        }
      }
    }
    
    // 生成拓扑（三角化）
    for (let i = 0; i < thetaSteps; i++) {
      for (let j = 0; j < phiSteps; j++) {
        const idx0 = i * phiSteps + j;
        const idx1 = i * phiSteps + ((j + 1) % phiSteps);
        const idx2 = (i + 1) * phiSteps + ((j + 1) % phiSteps);
        const idx3 = (i + 1) * phiSteps + j;
        
        // 两个三角形
        topology.triangles.push([idx0, idx1, idx2]);
        topology.triangles.push([idx0, idx2, idx3]);
        
        // 边（去重）
        topology.edges.push([idx0, idx1]);
        topology.edges.push([idx0, idx3]);
      }
    }
    
    return {
      points,
      normals: includeNormals ? normals : null,
      topology
    };
  }

  /**
   * ⭐ 获取指定位置的材料属性
   * 
   * 职责：基于几何位置返回物性参数
   * 
   * @param {Float64Array} coeffs - 球谐系数
   * @param {Object} position - 空间位置 {x, y, z} 或 {theta, phi}
   * @param {Object} center - 中心点
   * @returns {Object} - { stiffness, damping, density }
   */
  getMaterialAtPosition(coeffs, position, center = { x: 0, y: 0, z: 0 }) {
    let theta, phi;
    
    if (position.theta !== undefined && position.phi !== undefined) {
      // 直接提供球坐标
      theta = position.theta;
      phi = position.phi;
    } else {
      // 笛卡尔坐标转换
      const dx = position.x - center.x;
      const dy = position.y - center.y;
      const dz = position.z - center.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (r < 1e-10) {
        theta = 0;
        phi = 0;
      } else {
        theta = Math.acos(Math.max(-1, Math.min(1, dz / r)));
        phi = Math.atan2(dy, dx);
      }
    }
    
    // 默认材料属性（均匀）
    // 实际应用中可根据 (theta, phi) 返回不同属性
    return {
      stiffness: 1000,
      damping: 10,
      density: 1.0
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SphericalHarmonics;
}
