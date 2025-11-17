import { TinyMatrix } from './TinyMath.js';

// =============== 球坐标转换 ===============
const EPSILON = 1e-8;

export function cartesianToSpherical(x, y, z, origin) {
  const dx = x - origin.x;
  const dy = y - origin.y;
  const dz = z - origin.z;
  
  const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (r < EPSILON) {
    console.warn('点与原点重合，使用安全默认值');
    return { r: EPSILON, theta: 0, phi: 0 };
  }
  
  const theta = Math.acos(dz / r);
  let phi = Math.atan2(dy, dx);
  if (phi < 0) phi += 2 * Math.PI;
  
  return { r, theta, phi };
}

export function sphericalToCartesian(r, theta, phi, origin) {
  const sinTheta = Math.sin(theta);
  const x = r * sinTheta * Math.cos(phi) + origin.x;
  const y = r * sinTheta * Math.sin(phi) + origin.y;
  const z = r * Math.cos(theta) + origin.z;
  return { x, y, z };
}

// =============== 球谐函数（L_max=3） ===============
const SQRT_PI = Math.sqrt(Math.PI);
const PRECOMPUTED_COEFFS = {
  c00: 0.5 * Math.sqrt(1 / Math.PI),
  c10: 0.5 * Math.sqrt(3 / Math.PI),
  c11: -0.5 * Math.sqrt(3 / (2 * Math.PI)),
  c20: 0.25 * Math.sqrt(5 / Math.PI),
  c21: -0.5 * Math.sqrt(15 / (2 * Math.PI)),
  c22: 0.25 * Math.sqrt(15 / (2 * Math.PI)),
  c30: 0.25 * Math.sqrt(7 / Math.PI),
  c31: -0.25 * Math.sqrt(21 / (2 * Math.PI)),
  c32: 0.25 * Math.sqrt(105 / (2 * Math.PI)),
  c33: -0.25 * Math.sqrt(35 / (2 * Math.PI))
};

export function evaluateHarmonics(theta, phi, L_max = 3) {
  const values = new Float64Array((L_max + 1) * (L_max + 1));
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  let idx = 0;

  // l=0
  values[idx++] = PRECOMPUTED_COEFFS.c00; // Y00

  // l=1
  values[idx++] = PRECOMPUTED_COEFFS.c10 * cosTheta; // Y10
  values[idx++] = PRECOMPUTED_COEFFS.c11 * sinTheta * cosPhi; // Y11
  values[idx++] = PRECOMPUTED_COEFFS.c11 * sinTheta * sinPhi; // Y1-1

  // l=2
  const cos2Theta = cosTheta * cosTheta;
  const sin2Theta = sinTheta * sinTheta;
  const cos2Phi = Math.cos(2 * phi);
  const sin2Phi = Math.sin(2 * phi);
  
  values[idx++] = PRECOMPUTED_COEFFS.c20 * (3 * cos2Theta - 1); // Y20
  values[idx++] = PRECOMPUTED_COEFFS.c21 * sinTheta * cosTheta * cosPhi; // Y21
  values[idx++] = PRECOMPUTED_COEFFS.c21 * sinTheta * cosTheta * sinPhi; // Y2-1
  values[idx++] = PRECOMPUTED_COEFFS.c22 * sin2Theta * cos2Phi; // Y22
  values[idx++] = PRECOMPUTED_COEFFS.c22 * sin2Theta * sin2Phi; // Y2-2

  // l=3
  if (L_max >= 3) {
    const cos3Theta = cosTheta * cos2Theta;
    const sin3Theta = sinTheta * sin2Theta;
    const cos3Phi = Math.cos(3 * phi);
    const sin3Phi = Math.sin(3 * phi);
    
    values[idx++] = PRECOMPUTED_COEFFS.c30 * (5 * cos3Theta - 3 * cosTheta); // Y30
    values[idx++] = PRECOMPUTED_COEFFS.c31 * (5 * cos2Theta - 1) * sinTheta * cosPhi; // Y31
    values[idx++] = PRECOMPUTED_COEFFS.c31 * (5 * cos2Theta - 1) * sinTheta * sinPhi; // Y3-1
    values[idx++] = PRECOMPUTED_COEFFS.c32 * cosTheta * sin2Theta * cos2Phi; // Y32
    values[idx++] = PRECOMPUTED_COEFFS.c32 * cosTheta * sin2Theta * sin2Phi; // Y3-2
    values[idx++] = PRECOMPUTED_COEFFS.c33 * sin3Theta * cos3Phi; // Y33
    values[idx++] = PRECOMPUTED_COEFFS.c33 * sin3Theta * sin3Phi; // Y3-3
  }

  return values;
}

// =============== Fibonacci 采样 ===============
export function fibonacciSphere(numPoints) {
  if (numPoints <= 0) return { thetas: new Float32Array(0), phis: new Float32Array(0), count: 0 };
  
  const thetas = new Float32Array(numPoints);
  const phis = new Float32Array(numPoints);
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const angleIncrement = 2 * Math.PI * goldenRatio;
  
  for (let i = 0; i < numPoints; i++) {
    const y = 1 - (i / (numPoints - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    thetas[i] = Math.acos(y);
    phis[i] = (i * angleIncrement) % (2 * Math.PI);
  }
  
  return { thetas, phis, count: numPoints };
}

// =============== 球谐拟合（核心） ===============
export function fitSphericalHarmonics(controlPoints, L_max = 3, origin) {
  // 1. 验证控制点数量
  const minPoints = (L_max + 1) * (L_max + 1);
  if (controlPoints.length < minPoints) {
    throw new Error(
      `控制点不足: 需要至少 ${minPoints} 个点 (当前 ${controlPoints.length} 个)`
    );
  }

  // 2. 预计算球坐标
  const sphericalPoints = new Array(controlPoints.length);
  const rs = new Float64Array(controlPoints.length);
  
  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    sphericalPoints[i] = cartesianToSpherical(p.x, p.y, p.z, origin);
    rs[i] = sphericalPoints[i].r;
  }

  // 3. 构建设计矩阵 (n_points x n_params)
  const n = controlPoints.length;
  const nParams = (L_max + 1) * (L_max + 1);
  const A = new Float64Array(n * nParams);
  
  // 向量化填充矩阵
  for (let i = 0; i < n; i++) {
    const { theta, phi } = sphericalPoints[i];
    const harmonics = evaluateHarmonics(theta, phi, L_max);
    const rowOffset = i * nParams;
    
    for (let j = 0; j < nParams; j++) {
      A[rowOffset + j] = harmonics[j];
    }
  }

  // 4. 计算 ATA 和 ATb (利用对称性)
  const ATA = new Float64Array(nParams * nParams);
  const ATb = new Float64Array(nParams);
  
  // 手动计算 ATA (对称矩阵)
  for (let i = 0; i < nParams; i++) {
    for (let j = i; j < nParams; j++) { // 仅上三角
      let sum = 0;
      const col1 = i * n;
      const col2 = j * n;
      
      for (let k = 0; k < n; k++) {
        sum += A[k * nParams + i] * A[k * nParams + j];
      }
      
      ATA[i * nParams + j] = sum;
      ATA[j * nParams + i] = sum; // 对称填充
    }
    
    // 计算 ATb
    let sumB = 0;
    for (let k = 0; k < n; k++) {
      sumB += A[k * nParams + i] * rs[k];
    }
    ATb[i] = sumB;
  }

  // 5. 求解线性系统
  const coeffs = TinyMatrix.solveSymmetric(ATA, ATb, nParams);
  return coeffs;
}

// =============== 生成表面点 ===============
export function generateSurfacePoints(coeffs, numPoints, origin, L_max = 3) {
  const points = new Array(numPoints);
  const spherical = fibonacciSphere(numPoints);
  const MIN_RADIUS = 0.05; // 物理最小半径
  
  // 预计算系数映射
  const nParams = (L_max + 1) * (L_max + 1);
  
  for (let i = 0; i < spherical.count; i++) {
    const theta = spherical.thetas[i];
    const phi = spherical.phis[i];
    
    // 1. 计算径向距离 r(θ,φ) = Σ c_lm * Y_lm(θ,φ)
    let r = 0;
    const harmonics = evaluateHarmonics(theta, phi, L_max);
    
    for (let j = 0; j < nParams; j++) {
      r += coeffs[j] * harmonics[j];
    }
    
    // 2. 安全半径处理（软阈值）
    if (r < MIN_RADIUS) {
      // 平滑过渡到最小半径
      r = MIN_RADIUS * (1 + Math.exp(-10 * (MIN_RADIUS - r)));
    }
    
    // 3. 转换回笛卡尔坐标
    const { x, y, z } = sphericalToCartesian(r, theta, phi, origin);
    const p = new Point(x, y, z);
    p.dis = r;
    points[i] = p;
  }
  
  return points;
}