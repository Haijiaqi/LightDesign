import { Point } from "./Point.js";
import { fitSphericalHarmonics, generateSurfacePoints } from '../math/sphericalHarmonics.js';

export class Object {
  /**
   * @param {Point[]} controlpoints - 控制点列表
   */
  constructor(controlpoints = []) {
    this.controlpoints = controlpoints;
    this.points = []; // 用于存储拟合生成的表面点
    
    // ===== 新增球谐拟合参数 =====
    this.L_max = 3; // 最大阶数
    this.shParams = []; // 球谐系数 [c00, c10, c11, ...]
    this.origin = { x: 0, y: 0, z: 0 }; // 拟合原点（质心）
    this.isFitted = false; // 标记是否已完成拟合
  }

  /**
   * 计算控制点质心作为原点
   * @returns {Object} 质心坐标 {x, y, z}
   */
  calculateCentroid() {
    if (this.controlpoints.length === 0) return { x: 0, y: 0, z: 0 };
    
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const p of this.controlpoints) {
      sumX += p.x;
      sumY += p.y;
      sumZ += p.z;
    }
    
    const n = this.controlpoints.length;
    return {
      x: sumX / n,
      y: sumY / n,
      z: sumZ / n
    };
  }

  /**
   * 从控制点拟合球谐函数
   */
  fitFromControlPoints() {
    if (this.controlpoints.length < 10) {
      console.warn('警告：控制点数量过少（<10），拟合结果可能不稳定');
    }
    
    // 1. 计算质心作为原点
    this.origin = this.calculateCentroid();
    
    // 2. 执行球谐拟合
    this.shParams = fitSphericalHarmonics(
      this.controlpoints,
      this.L_max,
      this.origin
    );
    
    this.isFitted = true;
    console.log('球谐拟合完成，系数:', this.shParams);
  }

  /**
   * 生成表面点（均匀分布）
   * @param {number} numPoints - 生成点数（默认1000）
   */
  generateSurfacePoints(numPoints = 1000) {
    if (!this.isFitted) {
      throw new Error('必须先调用 fitFromControlPoints() 进行拟合');
    }
    
    // 动态计算点数：基于阶数 (4 * L_max^2)
    if (numPoints === null || numPoints === undefined) {
      numPoints = 4 * this.L_max * this.L_max * 10; // L_max=3 → 360点
    }
    
    // 生成点
    this.points = generateSurfacePoints(
      this.shParams,
      numPoints,
      this.origin,
      this.L_max
    );
    
    console.log(`生成 ${this.points.length} 个表面点`);
  }

  /**
   * 平移整个物体
   * @param {number} dx - x方向偏移
   * @param {number} dy - y方向偏移
   * @param {number} dz - z方向偏移
   */
  translate(dx, dy, dz) {
    // 1. 平移原点
    this.origin.x += dx;
    this.origin.y += dy;
    this.origin.z += dz;
    
    // 2. 平移所有控制点
    this.controlpoints.forEach(p => {
      p.x += dx;
      p.y += dy;
      p.z += dz;
    });
    
    // 3. 如果已有表面点，平移它们
    if (this.points) {
      this.points.forEach(p => {
        p.x += dx;
        p.y += dy;
        p.z += dz;
      });
    }
    
    // 注意：球谐参数 shParams 保持不变！
  }

  /**
   * 绕原点旋转物体
   * @param {number} angleX - x轴旋转角度（弧度）
   * @param {number} angleY - y轴旋转角度（弧度）
   * @param {number} angleZ - z轴旋转角度（弧度）
   */
  rotate(angleX = 0, angleY = 0, angleZ = 0) {
    // 旋转控制点
    this.controlpoints = this.controlpoints.map(p => 
      rotatePointAroundOrigin(p, this.origin, angleX, angleY, angleZ)
    );
    
    // 旋转表面点（如果存在）
    if (this.points.length > 0) {
      this.points = this.points.map(p => 
        rotatePointAroundOrigin(p, this.origin, angleX, angleY, angleZ)
      );
    }
    
    // 重要：球谐参数 shParams 保持不变！
    // 因为旋转对称性，球谐函数在旋转下具有不变性
  }

  /**
   * 获取物体边界框
   * @returns {{min: Point, max: Point}} 边界框
   */
  getBoundingBox() {
    const allPoints = [...this.controlpoints, ...this.points];
    if (allPoints.length === 0) return {
      min: new Point(0,0,0),
      max: new Point(0,0,0)
    };
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }
    
    return {
      min: new Point(minX, minY, minZ),
      max: new Point(maxX, maxY, maxZ)
    };
  }
}

/**
 * 绕原点旋转点（内部工具函数）
 * @param {Point} point - 要旋转的点
 * @param {Object} origin - 旋转中心 {x, y, z}
 * @param {number} angleX - x轴旋转角（弧度）
 * @param {number} angleY - y轴旋转角（弧度）
 * @param {number} angleZ - z轴旋转角（弧度）
 * @returns {Point} 旋转后的点
 */
function rotatePointAroundOrigin(point, origin, angleX, angleY, angleZ) {
  // 1. 平移到局部坐标系
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  
  // 2. 应用旋转（按Z-Y-X顺序）
  let [x, y, z] = [dx, dy, dz];
  
  // 绕Z轴旋转
  if (angleZ !== 0) {
    const cosZ = Math.cos(angleZ);
    const sinZ = Math.sin(angleZ);
    const newX = x * cosZ - y * sinZ;
    const newY = x * sinZ + y * cosZ;
    x = newX;
    y = newY;
  }
  
  // 绕Y轴旋转
  if (angleY !== 0) {
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const newX = x * cosY + z * sinY;
    const newZ = -x * sinY + z * cosY;
    x = newX;
    z = newZ;
  }
  
  // 绕X轴旋转
  if (angleX !== 0) {
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    const newY = y * cosX - z * sinX;
    const newZ = y * sinX + z * cosX;
    y = newY;
    z = newZ;
  }
  
  // 3. 平移回世界坐标系
  const p = point.clone();
  p.x = x + origin.x;
  p.y = y + origin.y;
  p.z = z + origin.z;
  
  return p;
}