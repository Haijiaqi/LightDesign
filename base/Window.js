import { Point } from './Point.js';
import { Vector } from './Vector.js';
export class Window {
    constructor(width, height, xlength, ylength, name) {
        this.width = width;
        this.height = height;
        this.xlength = xlength;
        this.ylength = ylength;
        this.DPIx = width / this.xlength;
        this.DPIy = height / this.ylength;
        this.direction = null;
        this.vx = null;
        this.vy = null;
        this.disOfPointToPlane = 0;
        this.disOfPointProjToPlaneXaxis = 0;
        this.disOfPointProjToPlaneYaxis = 0;
        this.gridsize = 8;
        this.name = name;

        this.grid = Array.from({ length: this.width / this.gridsize }, () =>
            Array.from({ length: this.height / this.gridsize }, () => [])
        );
    }

    calculate(head, eyeD, direction, objects, light) {
        this.direction = direction;
        this.calculatePointToCenter(head, direction);
        
        for (let i = 0; i < this.grid.length; i++) {
            for (let j = 0; j < this.grid[i].length; j++) {
                this.grid[i][j].length = 0;
            }
        }
        for (let oi = 0; oi < objects.length; oi++) {
            const object = objects[oi];
            for (let pi = 0; pi < object.points.length; pi++) {
                const point = object.points[pi];
                this.calculateAPoint(head, eyeD, direction, point, light);
            }
        }
        this.calculateNormal();
    }
    
    calculatePointToCenter (p, direction) {
        this.vx = direction.cross(0, 0, 1);
        this.vy = this.vx.cross(direction.x, direction.y, direction.z);
        const cpdx = p.x - direction.start.x;
        const cpdy = p.y - direction.start.y;
        const cpdz = p.z - direction.start.z;
        this.disOfPointToPlane = -direction.projL(cpdx, cpdy, cpdz);

        this.disOfPointProjToPlaneXaxis = this.vy.projL(cpdx, cpdy, cpdz);
        this.disOfPointProjToPlaneYaxis = this.vx.projL(cpdx, cpdy, cpdz);
        // const disOfPointToNormal = Math.sqrt(cpd2 - disOfPointToPlane * disOfPointToPlane);
    }

    calculateAPoint (head, eyeD, direction, point, light) {
        point.dis = 0;
        point.light = 0.5;
        const hpdx = point.x - head.x;
        const hpdy = point.y - head.y;
        const hpdz = point.z - head.z;
        let ll = hpdx * hpdx + hpdy * hpdy + hpdz * hpdz;
        point.dir = Math.sqrt(ll);

        const disOfPointToHeadPlane = direction.projL(hpdx, hpdy, hpdz);
        const rate = this.disOfPointToPlane / disOfPointToHeadPlane;
        const inverseRate = 1 - rate;
        const disOfPointProjToHeadPlaneXaxis = this.vy.projL(hpdx, hpdy, hpdz);
        const y = (this.ylength / 2) - (this.disOfPointProjToPlaneXaxis + disOfPointProjToHeadPlaneXaxis * rate);

        const disOfPointProjToHeadPlaneYaxis = this.vx.projL(hpdx, hpdy, hpdz);
        const x = (this.xlength / 2) + this.disOfPointProjToPlaneYaxis + disOfPointProjToHeadPlaneYaxis * rate;
        if (y < 0 || y > this.ylength || x < 0 || x > this.xlength) {
            return;
        }
        const yScreen = Math.round(y * this.DPIy);
        const xScreen = Math.round(x * this.DPIx);

        const x_grid = Math.floor(xScreen / this.gridsize);
        const y_grid = Math.floor(yScreen / this.gridsize);
        if (x_grid >= this.grid.length || y_grid >= this.grid[0].length) {
            return;
        }
        point.xM = xScreen;
        point.yM = yScreen;
        // const targetList = this.grid[x_grid][y_grid];
        point.dis = disOfPointToHeadPlane;
        let insertIndex = 0;
        while (insertIndex < this.grid[x_grid][y_grid].length && this.grid[x_grid][y_grid][insertIndex].dis < point.dis) {
            insertIndex++;
        }
        if (x_grid == 102 && y_grid == 61) {
            point.dis = disOfPointToHeadPlane;
        }
        this.grid[x_grid][y_grid].splice(insertIndex, 0, point);
        if (eyeD) {
            const dis = (eyeD / 2) * inverseRate;
            const xL = x - dis;
            const xR = x + dis;
            const yLScreen = Math.round(y * this.DPIy);
            const xLScreen = Math.round(xL * this.DPIx);
            const xRScreen = Math.round(xR * this.DPIx);
            point.xL = xLScreen;
            point.yL = yLScreen;
            point.xR = xRScreen;
            point.yR = yLScreen;
            if (point.rx != 0 || point.ry != 0 || point.rz != 0) {
                let projN = (-hpdx * point.nx + -hpdy * point.ny + -hpdz * point.nz) / 1;
                if (projN > 0) {
                    let projR = ((-hpdx * point.rx) + (-hpdy * point.ry) + (-hpdz * point.rz)) / point.dir;
                    if (projR > 0) {
                        point.light *= projR;
                    }
                } else {
                    point.light *= 0.1;
                }
            } else {
                point.light = 0;
            }
            point.light += 0.5;
        }
        if (light) {
            if (point.nx != 0 || point.ny != 0 || point.nz != 0) {
                const dot = point.nx * hpdx + point.ny * hpdy + point.nz * hpdz;
                const twoDot = 2 * dot;
                point.rx = (hpdx - twoDot * point.nx) / point.dir;
                point.ry = (hpdy - twoDot * point.ny) / point.dir;
                point.rz = (hpdz - twoDot * point.nz) / point.dir;
                const attenuation = 1 / (point.dir * 0.001 + 1) * light;
                point.rx *= attenuation;
                point.ry *= attenuation;
                point.rz *= attenuation;
            }
            //point.reflects.set(this.name, new Reflect(xLScreen, yScreen, xRScreen, yScreen, disOfPointToHeadPlane));
        }
    }
    calculateNormal() {
        // 遍历每个网格单元
        for (let i = 0; i < this.grid.length; i++) {
            for (let j = 0; j < this.grid[i].length; j++) {
                const points = this.grid[i][j];
                if (points.length < 3) continue;

                // 4. 找出深度相近的连续点集 [start, end]
                let start = 0;
                let end = 2; // 至少3个点

                // 检查前3个点是否深度相近（阈值 0.01，单位与 dis 一致）
                const firstDis = points[0].dis;
                let avg = (points[0].dis + points[1].dis + points[2].dis) / 3;
                if (Math.abs(avg - firstDis) > 0.05) {
                    for (let e = 1; e < points.length; e++) {
                        points[e].light *= 0.75;// Math.pow(0.5, e - end);
                    }
                    // 前3个点深度差异大，跳过
                    continue;
                }

                // 向后扩展，直到深度差 > 0.01
                for (let k = 3; k < points.length; k++) {
                    const newAvg = (avg * (k) + points[k].dis) / (k + 1);
                    if (Math.abs(newAvg - firstDis) <= 0.05) {
                        end = k;
                        avg = newAvg;
                    } else {
                        break;
                    }
                }
                for (let e = end + 1; e < points.length; e++) {
                    points[e].light *= 0.75;// Math.pow(0.5, e - end);
                }
                // 检查 XY 分布是否足够广（单位：像素）
                let xmin = Infinity, xmax = -Infinity;
                let ymin = Infinity, ymax = -Infinity;

                for (let k = start; k <= end; k++) {
                    const px = points[k].xM;
                    const py = points[k].yM;
                    if (px < xmin) xmin = px;
                    if (px > xmax) xmax = px;
                    if (py < ymin) ymin = py;
                    if (py > ymax) ymax = py;
                }

                if ((xmax - xmin) > 1 && (ymax - ymin) > 1) {
                    // 6. 赋法向量给深度相近且空间分布广的点
                    for (let k = start; k <= end; k++) {
                        if (points[k].nx == 0 && points[k].ny == 0 && points[k].nz == 0) {
                            points[k].nx = -this.direction.x;
                            points[k].ny = -this.direction.y;
                            points[k].nz = -this.direction.z;
                        } else {
                            if (Math.random() < 0.5) {
                                points[k].nx = -this.direction.x;
                                points[k].ny = -this.direction.y;
                                points[k].nz = -this.direction.z;
                            }
                        }
                    }
                }
            }
        }
    }
}