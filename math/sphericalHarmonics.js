import { TinyMatrix } from './TinyMath.js';

/**
 * 笛卡尔坐标转球坐标
 * @param {number} x - x坐标
 * @param {number} y - y坐标
 * @param {number} z - z坐标
 * @param {Object} origin - 原点 {x, y, z}
 * @returns {{r: number, theta: number, phi: number}} 球坐标
 */
function cartesianToSpherical(x, y, z, origin) {
  // 平移到局部坐标系
  const dx = x - origin.x;
  const dy = y - origin.y;
  const dz = z - origin.z;
  
  const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const theta = Math.acos(dz / r); // 极角 θ ∈ [0, π]
  let phi = Math.atan2(dy, dx);    // 方位角 φ ∈ [-π, π]
  if (phi < 0) phi += 2 * Math.PI; // 转换为 [0, 2π)
  
  return { r, theta, phi };
}

/**
 * 球坐标转笛卡尔坐标
 * @param {number} r - 半径
 * @param {number} theta - 极角
 * @param {number} phi - 方位角
 * @param {Object} origin - 原点 {x, y, z}
 * @returns {{x: number, y: number, z: number}} 笛卡尔坐标
 */
function sphericalToCartesian(r, theta, phi, origin) {
  const x = r * Math.sin(theta) * Math.cos(phi) + origin.x;
  const y = r * Math.sin(theta) * Math.sin(phi) + origin.y;
  const z = r * Math.cos(theta) + origin.z;
  return { x, y, z };
}

/**
 * 计算实数形式球谐函数 (L_max=3)
 * @param {number} l - 阶数
 * @param {number} m - 阶次
 * @param {number} theta - 极角
 * @param {number} phi - 方位角
 * @returns {number} Y_l^m(theta, phi) 的实数值
 */
function realSphericalHarmonic(l, m, theta, phi) {
  // 预计算三角函数值
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  
  // 根据阶数(l)和阶次(m)返回解析表达式
  switch (l) {
    case 0:
      return 0.5 * Math.sqrt(1 / Math.PI); // Y_0^0
    
    case 1:
      if (m === 0) return 0.5 * Math.sqrt(3 / Math.PI) * cosTheta; // Y_1^0
      if (m === 1) return -0.5 * Math.sqrt(3 / (2 * Math.PI)) * sinTheta * cosPhi; // Y_1^1 (实部)
      if (m === -1) return -0.5 * Math.sqrt(3 / (2 * Math.PI)) * sinTheta * sinPhi; // Y_1^{-1} (实部)
      break;
    
    case 2:
      if (m === 0) return 0.25 * Math.sqrt(5 / Math.PI) * (3 * cosTheta * cosTheta - 1); // Y_2^0
      if (m === 1) return -0.5 * Math.sqrt(15 / (2 * Math.PI)) * sinTheta * cosTheta * cosPhi; // Y_2^1
      if (m === -1) return -0.5 * Math.sqrt(15 / (2 * Math.PI)) * sinTheta * cosTheta * sinPhi; // Y_2^{-1}
      if (m === 2) return 0.25 * Math.sqrt(15 / (2 * Math.PI)) * sinTheta * sinTheta * Math.cos(2 * phi); // Y_2^2
      if (m === -2) return 0.25 * Math.sqrt(15 / (2 * Math.PI)) * sinTheta * sinTheta * Math.sin(2 * phi); // Y_2^{-2}
      break;
    
    case 3:
      if (m === 0) return 0.25 * Math.sqrt(7 / Math.PI) * (5 * Math.pow(cosTheta, 3) - 3 * cosTheta); // Y_3^0
      if (m === 1) return -0.25 * Math.sqrt(21 / (2 * Math.PI)) * (5 * Math.pow(cosTheta, 2) - 1) * sinTheta * cosPhi; // Y_3^1
      if (m === -1) return -0.25 * Math.sqrt(21 / (2 * Math.PI)) * (5 * Math.pow(cosTheta, 2) - 1) * sinTheta * sinPhi; // Y_3^{-1}
      if (m === 2) return 0.25 * Math.sqrt(105 / (2 * Math.PI)) * cosTheta * sinTheta * sinTheta * Math.cos(2 * phi); // Y_3^2
      if (m === -2) return 0.25 * Math.sqrt(105 / (2 * Math.PI)) * cosTheta * sinTheta * sinTheta * Math.sin(2 * phi); // Y_3^{-2}
      if (m === 3) return -0.25 * Math.sqrt(35 / (2 * Math.PI)) * Math.pow(sinTheta, 3) * Math.cos(3 * phi); // Y_3^3
      if (m === -3) return -0.25 * Math.sqrt(35 / (2 * Math.PI)) * Math.pow(sinTheta, 3) * Math.sin(3 * phi); // Y_3^{-3}
      break;
  }
  
  throw new Error(`Unsupported harmonic: l=${l}, m=${m}`);
}

/**
 * 生成Fibonacci球面采样点（均匀分布）
 * @param {number} numPoints - 采样点数量
 * @returns {Array<{theta: number, phi: number}>} 球坐标角度列表
 */
function fibonacciSphere(numPoints) {
  const points = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const angleIncrement = 2 * Math.PI * goldenRatio;
  
  for (let i = 0; i < numPoints; i++) {
    const y = 1 - (i / (numPoints - 1)) * 2; // y ∈ [-1, 1]
    const radius = Math.sqrt(1 - y * y);     // 当前纬度半径
    
    const theta = Math.acos(y);              // 极角 θ
    const phi = (i * angleIncrement) % (2 * Math.PI); // 方位角 φ
    
    points.push({ theta, phi });
  }
  
  return points;
}

/**
 * 球谐函数拟合（最小二乘）
 * @param {Array<Point>} controlPoints - 控制点列表
 * @param {number} L_max - 最大阶数 (3)
 * @param {Object} origin - 原点 {x, y, z}
 * @returns {Array<number>} 球谐系数 [c00, c10, c11, c1-1, c20, ...]
 */
export function fitSphericalHarmonics(controlPoints, L_max = 3, origin) {
  // ===== 1. 准备数据：计算每个控制点的球坐标 =====
  const sphericalPoints = controlPoints.map(p => 
    cartesianToSpherical(p.x, p.y, p.z, origin)
  );
  
  // ===== 2. 确定参数数量 =====
  // 对于实数球谐，参数数量 = (L_max + 1)^2
  const numParams = (L_max + 1) * (L_max + 1); // L_max=3 → 16个参数
  
  // ===== 3. 构建设计矩阵 A 和观测向量 b =====
  const n = controlPoints.length;
  const A = new Matrix(n, numParams);
  const b = new Matrix(n, 1);
  
  // 遍历每个控制点
  for (let i = 0; i < n; i++) {
    const { theta, phi } = sphericalPoints[i];
    b.set(i, 0, sphericalPoints[i].r); // 观测值 = 径向距离
    
    // 遍历所有球谐基函数 (l, m)
    let paramIndex = 0;
    for (let l = 0; l <= L_max; l++) {
      for (let m = -l; m <= l; m++) {
        // 计算该基函数在(θ,φ)处的值
        const ylm = realSphericalHarmonic(l, m, theta, phi);
        A.set(i, paramIndex, ylm);
        paramIndex++;
      }
    }
  }
  
  // ===== 4. 求解最小二乘问题：min ||Ax - b||^2 =====
  // 标准解法：(AᵀA)x = Aᵀb
  // 使用ml-matrix的solve函数（内部使用LU分解，数值稳定）
  /*
   * 关键注释：此处为最小二乘核心步骤
   * 
   * 正规方程： (AᵀA)x = Aᵀb
   * 其中：
   *   A: [n_points × n_params] 设计矩阵
   *   b: [n_points × 1] 观测向量（径向距离）
   *   x: [n_params × 1] 待求系数（球谐参数）
   * 
   * 数值稳定性说明：
   *   - 当AᵀA接近奇异时（控制点分布不均），解可能不稳定
   *   - 后续可在此处加入：
   *       1. Tikhonov正则化： (AᵀA + λI)x = Aᵀb
   *       2. RANSAC：迭代加权最小二乘
   *       3. Huber损失：替换L2损失为鲁棒损失
   * 
   * 当前使用直接求解，适用于良好分布的控制点
   */

  // 替换 fitSphericalHarmonics 中的求解部分
  const AT = A.transpose();
  const ATA = AT.mmul(A);
  const ATb = AT.mmul(b);

  // 使用自实现求解器
  const coeffs = TinyMatrix.solve(ATA, ATb); // 注意：返回TinyMatrix对象
  return coeffs.to1DArray(); // 转换为普通数组
}

/**
 * 从球谐参数生成表面点
 * @param {Array<number>} coeffs - 球谐系数
 * @param {number} numPoints - 生成点数
 * @param {Object} origin - 原点 {x, y, z}
 * @param {number} L_max - 最大阶数
 * @returns {Array<Point>} 表面点列表
 */
export function generateSurfacePoints(coeffs, numPoints, origin, L_max = 3) {
  const points = [];
  const sphericalAngles = fibonacciSphere(numPoints);
  
  // 遍历每个采样方向
  sphericalAngles.forEach(({ theta, phi }) => {
    // 计算该方向的径向距离 r(θ,φ) = Σ c_lm * Y_lm(θ,φ)
    let r = 0;
    let paramIndex = 0;
    
    for (let l = 0; l <= L_max; l++) {
      for (let m = -l; m <= l; m++) {
        const ylm = realSphericalHarmonic(l, m, theta, phi);
        r += coeffs[paramIndex] * ylm;
        paramIndex++;
      }
    }
    
    // 防止负半径（物理上无效）
    r = Math.max(r, 0.01);
    
    // 转换回笛卡尔坐标
    const { x, y, z } = sphericalToCartesian(r, theta, phi, origin);
    
    // 创建点对象
    const p = new Point(x, y, z);
    p.dis = r; // 记录径向距离
    points.push(p);
  });
  
  return points;
}

// 导出工具函数（可选）
export { cartesianToSpherical, sphericalToCartesian, fibonacciSphere };