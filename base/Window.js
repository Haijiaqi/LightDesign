import { Point } from './Point.js';
import { Vector } from './Vector.js';
export class Window {
    constructor(width, height, xlength, ylength, vector, name) {
        this.name = name;
        this.width = width;
        this.height = height;
        this.DPI = width / xlength;
        this.direction = vector;
        this.vx = null;
        this.vy = null;
        this.disOfPointToPlane = 0;
        this.disOfPointProjToPlaneXaxis = 0;
        this.disOfPointProjToPlaneYaxis = 0;
        this.gridsize = 8;

        this.grid = Array.from({ length: this.width / this.gridsize }, () =>
            Array.from({ length: this.height / this.gridsize }, () => [])
        );
    }

    calculate(eyeL, eyeD, direction, objects) {
        calculatePointToCenter(eyeL, direction);
        for (let oi = 0; oi < objects.length; oi++) {
            const object = objects[oi];
            for (let pi = 0; pi < object.points.length; pi++) {
                const point = object.points[pi];
                calculateAPoint(eyeL, eyeD, direction, point);
            }
        }
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

    calculateAPoint (head, eyeD, direction, point) {
        const hpdx = point.x - head.x;
        const hpdy = point.y - head.y;
        const hpdz = point.z - head.z;

        const disOfPointToHeadPlane = direction.projL(hpdx, hpdy, hpdz);
        const rate = 1 - (this.disOfPointToPlane / disOfPointToHeadPlane);
        const disOfPointProjToHeadPlaneXaxis = this.vy.projL(hpdx, hpdy, hpdz);
        const y = (ylength / 2) - (this.disOfPointProjToPlaneXaxis + disOfPointProjToHeadPlaneXaxis * rate);

        const disOfPointProjToHeadPlaneYaxis = this.vx.projL(hpdx, hpdy, hpdz);
        const x = (xlength / 2) + this.disOfPointProjToPlaneYaxis + disOfPointProjToHeadPlaneYaxis * rate;
        if (eyeD) {
            const dis = (eyeD / 2) * rate;
            const xL = x - dis;
            const xR = x + dis;
            const yScreen = Math.round(y * this.DPI);
            const xLScreen = Math.round(xL * this.DPI);
            const xRScreen = Math.round(xR * this.DPI);
            //point.links.set(this.name, new Link(xLScreen, yScreen, xRScreen, yScreen, disOfPointToHeadPlane));
        } else {
            const yScreen = Math.round(y * this.DPI);
            const xScreen = Math.round(x * this.DPI);
            point.x0 = xScreen;
            point.y0 = yScreen;
            const x_grid = Math.round(xScreen / this.gridsize);
            const y_grid = Math.round(yScreen / this.gridsize);
            const targetList = this.grid[x_grid][y_grid];
            point.setDis(dis);
            let insertIndex = 0;
            while (insertIndex < targetList.length && targetList[insertIndex].dis >= point.dis) {
                insertIndex++;
            }
            targetList.splice(insertIndex, 0, point);
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
                if (Math.abs(avg - firstDis) > 0.01) {
                    // 前3个点深度差异大，跳过
                    continue;
                }

                // 向后扩展，直到深度差 > 0.01
                for (let k = 3; k < points.length; k++) {
                    const newAvg = (avg * (k) + points[k].dis) / (k + 1);
                    if (Math.abs(newAvg - firstDis) <= 0.01) {
                        end = k;
                        avg = newAvg;
                    } else {
                        break;
                    }
                }
                // 检查 XY 分布是否足够广（单位：像素）
                let xmin = Infinity, xmax = -Infinity;
                let ymin = Infinity, ymax = -Infinity;

                for (let k = start; k <= end; k++) {
                    const px = points[k].x0;
                    const py = points[k].y0;
                    if (px < xmin) xmin = px;
                    if (px > xmax) xmax = px;
                    if (py < ymin) ymin = py;
                    if (py > ymax) ymax = py;
                }

                if ((xmax - xmin) > 1 && (ymax - ymin) > 1) {
                    // 6. 赋法向量给深度相近且空间分布广的点
                    for (let k = start; k <= end; k++) {
                        point.normal(-this.direction.x, -this.direction.y, -this.direction.z);
                    }
                }
            }
        }
    }

    calx (eye, direction, rotation, point) {
        const ecdx = eye.x - direction.start.x;
        const ecdy = eye.y - direction.start.y;
        const ecdz = eye.z - direction.start.z;
        const ecd2 = ecdx * ecdx + ecdy * ecdy + ecdz * ecdz;
        const disOfEyeToPlane = direction.projL(ecdx, ecdy, ecdz);
        const disOfEyeProjToNormal = Math.sqrt(ecd2 - disOfEyeToPlane * disOfEyeToPlane);
        const disOfEyeProjToXaxis = rotation.projL(ecdx, ecdy, ecdz);
        const disOfEyeProjToYaxis = Math.sqrt(disOfEyeProjToNormal * disOfEyeProjToNormal - disOfEyeProjToXaxis * disOfEyeProjToXaxis);
        
        const epdx = point.x - eye.x;
        const epdy = point.y - eye.y;
        const epdz = point.z - eye.z;
        const epd2 = epdx * epdx + epdy * epdy + epdz * epdz;
        const disOfPointProjToEye = direction.projL(epdx, epdy, epdz);
        const disOfPointYToEye = rotation.projL(epdx, epdy, epdz);
        const disOfPointProjPlaneToEye2 = epd2 - disOfPointProjToEye * disOfPointProjToEye;
        const disOfPointXToEye = Math.sqrt(disOfPointProjPlaneToEye2 - disOfPointYToEye * disOfPointYToEye);        

        return [disOfEyeProjToYaxis + disOfPointXToEye, disOfEyeProjToXaxis + disOfPointYToEye];
    }
}