import { Point } from './Point.js';
import { Vector } from './Vector.js';
export class Window {
    constructor(width, height, vector) {
        this.width = width;
        this.height = height;
        this.direction = vector;
        this.vx = null;
        this.vy = null;
        this.disOfPointToPlane = 0;
        this.disOfPointProjToPlaneXaxis = 0;
        this.disOfPointProjToPlaneYaxis = 0;
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
        this.vy = vx.cross(direction.x, direction.y, direction.z);
        const cpdx = p.x - direction.start.x;
        const cpdy = p.y - direction.start.y;
        const cpdz = p.z - direction.start.z;
        this.disOfPointToPlane = -direction.projL(cpdx, cpdy, cpdz);

        this.disOfPointProjToPlaneXaxis = vy.projL(cpdx, cpdy, cpdz);
        this.disOfPointProjToPlaneYaxis = vx.projL(cpdx, cpdy, cpdz);
        // const disOfPointToNormal = Math.sqrt(cpd2 - disOfPointToPlane * disOfPointToPlane);
    }

    calculateAPoint (eyeL, eyeD, direction, point) {
        const elpdx = point.x - eyeL.x;
        const elpdy = point.y - eyeL.y;
        const elpdz = point.z - eyeL.z;

        const disOfPointToEyelPlane = direction.projL(elpdx, elpdy, elpdz);
        const rate = this.disOfPointToPlane / disOfPointToEyelPlane;
        const disOfPointProjToEyelPlaneXaxis = this.vy.ProjL(elpdx, elpdy, elpdz);
        const y = this.disOfPointProjToPlaneXaxis + disOfPointProjToEyelPlaneXaxis * rate;

        const disOfPointProjToEyelPlaneYaxis = this.vx.ProjL(elpdx, elpdy, elpdz);
        const xL = this.disOfPointProjToPlaneYaxis + disOfPointProjToEyelPlaneYaxis * rate;
        if (eyeD) {
            const xR = xL + eyeD * rate;
            return [y, xL, xR]
        }
        return [y, xL]
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