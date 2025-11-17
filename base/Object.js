import { Point } from "./Point.js";
import { fitSphericalHarmonics, generateSurfacePoints } from '../math/sphericalHarmonics.js';
import { Quaternion, rotatePoint } from './quaternion.js';

export class Object {
  constructor(controlpoints = []) {
    this.controlpoints = controlpoints;
    this.points = [];
    
    // 球谐参数
    this.L_max = 3;
    this.shParams = null; // Float64Array
    this.origin = { x: 0, y: 0, z: 0 };
    this.isFitted = false;
    
    // 旋转状态（四元数）
    this.rotation = new Quaternion();
  }

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

  fitFromControlPoints() {
    this.origin = this.calculateCentroid();
    this.shParams = fitSphericalHarmonics(
      this.controlpoints,
      this.L_max,
      this.origin
    );
    this.isFitted = true;
    console.log('球谐拟合完成，系数:', this.shParams);
  }

  generateSurfacePoints(numPoints = null) {
    if (!this.isFitted) {
      throw new Error('必须先调用 fitFromControlPoints() 进行拟合');
    }
    
    // 动态计算点数
    if (numPoints === null || numPoints === undefined) {
      numPoints = Math.max(100, 4 * this.L_max * this.L_max * 10);
    }
    
    // 清理旧点防止内存泄漏
    this.points = [];
    this.points = generateSurfacePoints(
      this.shParams,
      numPoints,
      this.origin,
      this.L_max
    );
    
    console.log(`生成 ${this.points.length} 个表面点`);
  }

  translate(dx, dy, dz) {
    // 平移原点
    this.origin.x += dx;
    this.origin.y += dy;
    this.origin.z += dz;
    
    // 平移控制点
    for (const p of this.controlpoints) {
      p.x += dx;
      p.y += dy;
      p.z += dz;
    }
    
    // 平移表面点（如果存在）
    for (const p of this.points) {
      p.x += dx;
      p.y += dy;
      p.z += dz;
    }
  }

  rotate(angleX = 0, angleY = 0, angleZ = 0) {
    // 1. 更新旋转状态
    const deltaRot = Quaternion.fromEuler(angleX, angleY, angleZ);
    this.rotation = deltaRot.multiply(this.rotation);
    
    // 2. 旋转所有点（四元数版）
    for (let i = 0; i < this.controlpoints.length; i++) {
      this.controlpoints[i] = rotatePoint(
        this.controlpoints[i], 
        this.origin, 
        this.rotation
      );
    }
    
    for (let i = 0; i < this.points.length; i++) {
      this.points[i] = rotatePoint(
        this.points[i], 
        this.origin, 
        this.rotation
      );
    }
    
    // 3. 重要：球谐参数保持不变！
  }

  getBoundingBox() {
    const allPoints = [...this.controlpoints, ...this.points];
    if (allPoints.length === 0) {
      return {
        min: new Point(0, 0, 0),
        max: new Point(0, 0, 0)
      };
    }
    
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

  /**
   * 重置旋转状态（保留当前形状）
   */
  resetRotation() {
    this.rotation = new Quaternion();
    // 注意：点坐标已旋转，此处不重置
  }

  /**
   * 获取当前旋转角度（欧拉角表示）
   * @returns {{x: number, y: number, z: number}}
   */
  getEulerAngles() {
    // 四元数转欧拉角（简化版）
    const { w, x, y, z } = this.rotation;
    const sinr = 2 * (w * x + y * z);
    const cosr = 1 - 2 * (x * x + y * y);
    const pitch = Math.atan2(sinr, cosr);
    
    const sinp = 2 * (w * y - z * x);
    let roll;
    if (Math.abs(sinp) >= 1) {
      roll = Math.sign(sinp) * Math.PI / 2;
    } else {
      roll = Math.asin(sinp);
    }
    
    const siny = 2 * (w * z + x * y);
    const cosy = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny, cosy);
    
    return { x: pitch, y: yaw, z: roll };
  }
}