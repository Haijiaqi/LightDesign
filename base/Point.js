export class Point {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.nx = 0;  // 法向量
    this.ny = 0;
    this.nz = 0;
    this.dis = 0; // 到原点距离
    this.dir = 0; // 方向角（备用）
    this.xM = 0;  // 多用途字段
    this.yM = 0;
    this.xL = 0;
    this.yL = 0;
    this.xR = 0;
    this.yR = 0;
    this.rx = 0;  // 旋转后坐标
    this.ry = 0;
    this.rz = 0;
    this.light = 0.6; // 光照强度
  }

  /**
   * 计算到点p的欧氏距离
   * @param {Point} p 目标点
   * @returns {number} 距离
   */
  getD(p) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dz = p.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 克隆点对象（保留所有属性）
   * @returns {Point} 新点
   */
  clone() {
    const p = new Point(this.x, this.y, this.z);
    Object.assign(p, this);
    return p;
  }
}