export class Point {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
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
    }

    getD(p) {
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const dz = p.z - this.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}