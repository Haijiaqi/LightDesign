export class Point {
  constructor(x, y, z) {
    // ========== 基础坐标 ==========
    this.x = x;
    this.y = y;
    this.z = z;

    // ========== 局部坐标 (Local Space) ==========
    this.lx = x; // 局部 X
    this.ly = y; // 局部 Y
    this.lz = z; // 局部 Z

    // ========== 法向量 ==========
    this.nx = 0;
    this.ny = 0;
    this.nz = 0;

    // ========== 距离/方向 ==========
    this.dis = 0;  // 到观察者的距离
    this.dir = 0;  // 方向角

    // ========== 屏幕坐标 ==========
    this.xM = 0;  // 屏幕 X (中点/单眼)
    this.yM = 0;  // 屏幕 Y (中点/单眼)
    this.xL = 0;  // 屏幕 X (左眼)
    this.yL = 0;  // 屏幕 Y (左眼)
    this.xR = 0;  // 屏幕 X (右眼)
    this.yR = 0;  // 屏幕 Y (右眼)

    // ========== 反射向量 ==========
    this.rx = 0;
    this.ry = 0;
    this.rz = 0;

    // ========== 渲染属性 ==========
    this.light = 0.6;           // 亮度（物理属性：基础亮度、距离衰减、遮挡、反射）
    this.space = 'world';       // 坐标空间：'world' | 'screen'
    this.tag = null;            // 样式标签：SURFACE, CONTROL, LOCAL_GRID, etc.
    this.isVisible = true;      // 业务可见性（用于切片显示等业务逻辑，与物理光照分离）

    // ========== 交互属性 ==========
    this.isAttractable = false; // 是否可被虚拟鼠标吸附
    this.isEditable = true;     // 是否可被拖拽编辑 (控制点专用)

    // ========== 点类型标记 ==========
    this.isObjectCenter = false;  // 是否是物体中心点
    this.isGridPoint = false;     // 是否是格网交点 (世界格网)
    this.isIntersection = false;  // 是否是屏幕辅助格网交点
  }

  getD(p) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dz = p.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
