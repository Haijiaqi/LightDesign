import { Point } from './Point.js';
export class Vector {
    constructor(x, y, z, x0 = 0, y0 = 0, z0 = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.start = new Point(x0, y0, z0);
        this.ll = x * x + y * y + z * z;
        this.l = Math.sqrt(this.ll);
    }
    cross(b) {
        return new Vector(this.y * b.z - b.y * this.z, this.z * b.x - b.z * this.x, this.x * b.y - b.x * this.y);
    }
    cross(x, y, z) {
        return new Vector(this.y * z - y * this.z, this.z * x - z * this.x, this.x * y - x * this.y);
    }
    projL(b) {
        const dot = this.x * b.x + this.y * b.y + this.z * b.z;
        return dot / ll;
    }
    projL(x, y, z) {
        const dot = this.x * x + this.y * y + this.z * z;
        return dot / this.ll;
    }
}