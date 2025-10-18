import { Point } from './Point.js';
export class Vector {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.start = new Point(0, 0, 0);
        this.ll = x * x + y * y + z * z;
        this.l = Math.sqrt(this.ll);
        this.dirAngle = 0;
    }
    normalInit(x0, y0, z0, x1, y1, z1) {
        this.x = x1 - x0;
        this.y = y1 - y0;
        this.z = z1 - z0;
        this.start.x = x0;
        this.start.y = y0;
        this.start.z = z0;
        this.ll = this.x * this.x + this.y * this.y + this.z * this.z;
        this.l = Math.sqrt(this.ll);
        this.x /= this.l;
        this.y /= this.l;
        this.z /= this.l;
        this.l = 1;
        this.ll = 1;
        this.getAngle();
    }
    getAngle() {
        if (this.y != 0) {
            this.dirAngle = Math.atan(this.x / this.y);
            if (this.y < 0) {
                if (this.x != 0) {
                    if (this.x > 0) {
                        this.dirAngle = Math.PI + this.dirAngle;
                    } else {
                        this.dirAngle = -Math.PI + this.dirAngle;
                    }
                } else {
                    this.dirAngle = Math.PI;
                }
            }
        } else {
            if (this.x != 0) {
                if (this.x > 0) {
                    this.dirAngle = Math.PI / 2;
                } else {
                    this.dirAngle = -Math.PI / 2;
                }
            } else {
                this.dirAngle = 0;
            }
        }
        return this.dirAngle;
    }
    cross(b) {
        return new Vector(this.y * b.z - b.y * this.z, this.z * b.x - b.z * this.x, this.x * b.y - b.x * this.y);
    }
    cross(x, y, z) {
        return new Vector(this.y * z - y * this.z, this.z * x - z * this.x, this.x * y - x * this.y);
    }
    projL(b) {
        const dot = this.x * b.x + this.y * b.y + this.z * b.z;
        return dot / this.ll;
    }
    projL(x, y, z) {
        const dot = this.x * x + this.y * y + this.z * z;
        return dot / this.ll;
    }
    getPoint(l) {
        return new Point(this.x * l + this.start.x, this.y * l + this.start.y, this.z * l + this.start.z);
    }
}