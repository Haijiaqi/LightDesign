export class Point {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    // ========== 阶段3新增：局部坐标 (Local Space) ==========
    this.lx = x; // 局部 X
    this.ly = y; // 局部 Y
    this.lz = z; // 局部 Z
    // =======================================================
    this.nx = 0;
    this.ny = 0;
    this.nz = 0;
    this.dis = 0;
    this.dir = 0;
    this.xM = 0;
    this.yM = 0;
    this.xL = 0;
    this.yL = 0;
    this.xR = 0;
    this.yR = 0;
    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.light = 0.6;
    // ========== 阶段2新增 ==========
    this.space = 'world';       // 坐标空间：'world'(世界坐标) | 'screen'(屏幕坐标)
    this.tag = null;            // 样式标签：null 表示使用默认样式
    this.isAttractable = false; // 是否可被吸附（FOCUS态使用）
    // ===============================
  }

  getD(p) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dz = p.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
