import { Link } from './Link.js';
export class Point {
    constructor(x, y, z, nx = 0, ny = 0, nz = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.nx = nx;
        this.ny = ny;
        this.nz = nz;
        this.links = new Map();
        this.reflects = new Map();
        this.dis = 0;
        this.x0 = 0;
        this.y0 = 0;
    }

    normal(x, y, z) {
        this.nx = x;
        this.ny = y;
        this.nz = z;
    }

    setDis(dis) {
        this.dis = dis;
    }
    setX0Y0(x0, y0) {
        this.x0 = x0;
        this.y0 = y0;
    }
}