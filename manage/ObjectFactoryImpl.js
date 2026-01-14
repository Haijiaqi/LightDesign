/**
 * ObjectFactoryImpl.js - 几何对象创建工厂
 * 
 * ============================================================================
 * 版本: v1.0
 * 日期: 2026-01-14
 * ============================================================================
 * 
 * 职责：
 * - 基础几何体创建 (Cube, Sphere, Plane)
 * - 特殊对象创建 (WorldGrid, IntegerGridObject, TestScene)
 * - 局部格网系统 (LocalGridConfig, createLocalGridObject)
 * 
 * 依赖：
 * - base/Point.js
 * - base/Object.js
 * ============================================================================
 */

import { Point } from "../base/Point.js";
import { Object } from "../base/Object.js";

export class ObjectFactoryImpl {

    // ==========================================================================
    // 基础几何体创建
    // ==========================================================================

    /**
     * 创建立方体点云
     * @param {number} size - 边长（厘米）
     * @param {number} pointsPerFace - 每面点数
     * @param {number} x - 中心 X 坐标
     * @param {number} y - 中心 Y 坐标
     * @param {number} z - 中心 Z 坐标
     * @param {number} alpha - 绕 Z 轴旋转角度（度）
     * @param {boolean} ifEntity - 是否生成内部点
     * @returns {Object}
     */
    static createCube(
        size = 5,
        pointsPerFace = 100,
        x = 0,
        y = -30,
        z = 0,
        alpha = 0,
        ifEntity = false
    ) {
        const points = [];
        const halfSize = size / 2;
        const rad = (alpha * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        const faceGenerators = [
            () => ({
                x: (Math.random() - 0.5) * size,
                y: (Math.random() - 0.5) * size,
                z: halfSize,
            }), // 前
            () => ({
                x: (Math.random() - 0.5) * size,
                y: (Math.random() - 0.5) * size,
                z: -halfSize,
            }), // 后
            () => ({
                x: -halfSize,
                y: (Math.random() - 0.5) * size,
                z: (Math.random() - 0.5) * size,
            }), // 左
            () => ({
                x: halfSize,
                y: (Math.random() - 0.5) * size,
                z: (Math.random() - 0.5) * size,
            }), // 右
            () => ({
                x: (Math.random() - 0.5) * size,
                y: halfSize,
                z: (Math.random() - 0.5) * size,
            }), // 上
            () => ({
                x: (Math.random() - 0.5) * size,
                y: -halfSize,
                z: (Math.random() - 0.5) * size,
            }), // 下
        ];

        for (let i = 0; i < pointsPerFace; i++) {
            faceGenerators.forEach((gen) => {
                const { x: px, y: py, z: pz } = gen();
                const rotatedX = px * cosA - py * sinA;
                const rotatedY = px * sinA + py * cosA;
                const rotatedZ = pz;
                points.push(new Point(rotatedX + x, rotatedY + y, rotatedZ + z));
            });

            if (ifEntity) {
                const intX = (Math.random() - 0.5) * size;
                const intY = (Math.random() - 0.5) * size;
                const intZ = (Math.random() - 0.5) * size;
                const rotatedX = intX * cosA - intY * sinA;
                const rotatedY = intX * sinA + intY * cosA;
                const rotatedZ = intZ;
                points.push(new Point(rotatedX + x, rotatedY + y, rotatedZ + z));
            }
        }

        // 计算初始 frontDirection（默认朝向 -Y，即(0,-1,0)）
        // 因为 createCube 创建时绕 Z 轴旋转了 alpha 度
        const frontX = Math.sin(rad);
        const frontY = -Math.cos(rad);
        const frontZ = 0;

        return new Object(points, {
            frontDirection: { x: frontX, y: frontY, z: frontZ },
            center: { x, y, z }
        });
    }

    /**
     * 创建平面点云
     * @param {number} width - 宽度（X方向）
     * @param {number} height - 高度（Z方向）
     * @param {number} pointsPerFace - 点数
     * @param {number} x - 中心 X 坐标
     * @param {number} y - 中心 Y 坐标
     * @param {number} z - 中心 Z 坐标
     * @param {number} alpha - 绕 Z 轴旋转角度（度）
     * @param {boolean} ifEntity - 是否生成额外点
     * @returns {Object}
     */
    static createPlane(
        width = 20,
        height = 10,
        pointsPerFace = 10000,
        x = 0,
        y = 0,
        z = 0,
        alpha = 5,
        ifEntity = false
    ) {
        const points = [];
        const rad = (alpha * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        const generateSurfacePoint = () => {
            const px = (Math.random() - 0.5) * width;
            const pz = (Math.random() - 0.5) * height;
            const py = 0;

            const rotatedX = px * cosA - py * sinA;
            const rotatedY = px * sinA + py * cosA;
            const rotatedZ = pz;

            // 法向量（默认(0,-1,0)，同步绕Z轴旋转）
            const nx = 0 * cosA - -1 * sinA;
            const ny = 0 * sinA + -1 * cosA;
            const nz = 0;

            const p = new Point(rotatedX + x, rotatedY + y, rotatedZ + z);
            p.nx = nx;
            p.ny = ny;
            p.nz = nz;
            return p;
        };

        for (let i = 0; i < pointsPerFace; i++) {
            points.push(generateSurfacePoint());
        }

        if (ifEntity) {
            for (let i = 0; i < pointsPerFace; i++) {
                points.push(generateSurfacePoint());
            }
        }

        return new Object(points);
    }

    /**
     * 创建球体点云
     * @param {number} x0 - 中心 X 坐标
     * @param {number} y0 - 中心 Y 坐标
     * @param {number} z0 - 中心 Z 坐标
     * @param {number} radius - 半径
     * @param {number} numPoints - 点数
     * @returns {Object}
     */
    static createSphere(x0, y0, z0, radius = 5, numPoints = 5000) {
        const points = [];
        for (let i = 0; i < numPoints; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            const x = radius * Math.sin(phi) * Math.cos(theta) + x0;
            const y = radius * Math.sin(phi) * Math.sin(theta) + y0;
            const z = radius * Math.cos(phi) + z0;
            points.push(new Point(x, y, z));
        }
        return new Object(points, { center: { x: x0, y: y0, z: z0 } });
    }

    /**
     * 创建带经纬线的球体（三个正交大圆）
     * @param {number} x0 - 中心 X 坐标
     * @param {number} y0 - 中心 Y 坐标
     * @param {number} z0 - 中心 Z 坐标
     * @param {number} radius - 半径
     * @param {number} numMeridians - 经线数（未使用，保留接口）
     * @param {number} pointsPerCircle - 每圆点数
     * @returns {Object}
     */
    static createSphereWithMeridians(
        x0,
        y0,
        z0,
        radius = 2.5,
        numMeridians = 12,
        pointsPerCircle = 50
    ) {
        const points = [];

        // 圆1: XY平面 (z=z0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                x0 + radius * Math.cos(theta),
                y0 + radius * Math.sin(theta),
                z0
            ));
        }

        // 圆2: XZ平面 (y=y0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                x0 + radius * Math.cos(theta),
                y0,
                z0 + radius * Math.sin(theta)
            ));
        }

        // 圆3: YZ平面 (x=x0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                x0,
                y0 + radius * Math.cos(theta),
                z0 + radius * Math.sin(theta)
            ));
        }

        return new Object(points, { center: { x: x0, y: y0, z: z0 } });
    }

    // ==========================================================================
    // 特殊对象创建
    // ==========================================================================

    /**
     * 创建世界格网（以原点为球心的整数格点）
     * @param {number} spacing - 格点间距（厘米），默认 10
     * @param {number} radius - 球形范围半径（厘米），默认 100
     * @returns {Object} 世界格网 Object
     */
    static createWorldGrid(spacing = 10, radius = 100) {
        const points = [];

        const minBound = Math.ceil(-radius / spacing) * spacing;
        const maxBound = Math.floor(radius / spacing) * spacing;

        for (let x = minBound; x <= maxBound; x += spacing) {
            for (let y = minBound; y <= maxBound; y += spacing) {
                for (let z = minBound; z <= maxBound; z += spacing) {
                    const dist = Math.sqrt(x * x + y * y + z * z);
                    if (dist <= radius) {
                        const p = new Point(x, y, z);
                        p.isAttractable = true;
                        p.isGridPoint = true;
                        p.light = 0.3;
                        points.push(p);
                    }
                }
            }
        }

        const grid = new Object([]);
        grid.isWorldGrid = true;
        grid.centerPoint = null;
        grid.displayPoints = points;

        return grid;
    }

    /**
     * 创建全整数坐标的网格对象（表面点）
     * @param {number} cx - 中心 X
     * @param {number} cy - 中心 Y
     * @param {number} cz - 中心 Z
     * @param {number} size - 边长点数
     * @param {number} spacing - 间距
     * @returns {Object}
     */
    static createIntegerGridObject(cx, cy, cz, size = 6, spacing = 1) {
        const points = [];
        const startOffset = -Math.floor(size / 2);
        const endOffset = startOffset + size - 1;

        for (let ix = startOffset; ix <= endOffset; ix++) {
            for (let iy = startOffset; iy <= endOffset; iy++) {
                for (let iz = startOffset; iz <= endOffset; iz++) {
                    const isSurface = (
                        ix === startOffset || ix === endOffset ||
                        iy === startOffset || iy === endOffset ||
                        iz === startOffset || iz === endOffset
                    );

                    if (isSurface) {
                        const x = cx + ix * spacing;
                        const y = cy + iy * spacing;
                        const z = cz + iz * spacing;

                        const p = new Point(x, y, z);
                        p.isAttractable = false;
                        points.push(p);
                    }
                }
            }
        }

        return new Object(points, {
            center: { x: cx, y: cy, z: cz },
            frontDirection: { x: 0, y: -1, z: 0 },
            upDirection: { x: 0, y: 0, z: 1 },
            name: 'IntegerGrid'
        });
    }

    /**
     * 创建测试场景物体
     * @returns {Object[]}
     */
    static createTestScene() {
        return [
            ObjectFactoryImpl.createSphere(0, 50, 0, 3, 2000),
            ObjectFactoryImpl.createCube(5, 100, -10, 50, 0, 0),
            ObjectFactoryImpl.createIntegerGridObject(10, 50, 0, 5, 1),
        ];
    }

    // ==========================================================================
    // 局部格网系统
    // ==========================================================================

    /**
     * 局部格网配置 (集中管理，方便调整)
     */
    static LocalGridConfig = {
        // 格网尺寸 (临时固定 8cm，正式版应为 Round(Min(ScreenW, ScreenH)/10)*10)
        size: 8,
        spacing: 2.0,

        // 计算属性
        get halfSize() { return this.size / 2; },
        get layerCount() { return Math.floor(this.halfSize / this.spacing); },

        /**
         * 根据姿态类型获取层间距
         * - 面向 (FACE)：层间距 = spacing
         * - 棱向 (EDGE)：层间距 = spacing × cos(45°) = spacing / √2
         */
        getLayerSpacingForOrientation(orientationType) {
            if (!orientationType) return this.spacing;
            if (orientationType.includes('EDGE')) {
                return this.spacing / Math.SQRT2;
            }
            return this.spacing;
        },

        /**
         * 根据姿态类型获取最大切片深度
         * - 面向：halfSize
         * - 棱向：halfSize × √2
         */
        getMaxDepthForOrientation(orientationType) {
            if (!orientationType) return this.halfSize;
            if (orientationType.includes('EDGE')) {
                return this.halfSize * Math.SQRT2;
            }
            return this.halfSize;
        }
    };

    /**
     * 创建局部格网对象
     * @param {Object} targetObj - 目标物体（用于同步位置和姿态）
     * @returns {Object} 局部格网对象
     */
    static createLocalGridObject(targetObj) {
        const config = ObjectFactoryImpl.LocalGridConfig;
        const finalSize = config.size;
        const spacing = config.spacing;

        console.log(`创建局部格网: 尺寸 ${finalSize}cm, 间距 ${spacing}cm`);

        const points = [];
        const count = config.layerCount;

        // 虚线配置
        const dashPointsPerEdge = 3;
        const dashSpacing = spacing / (dashPointsPerEdge + 1);

        // 生成立方体点阵
        for (let ix = -count; ix <= count; ix++) {
            for (let iy = -count; iy <= count; iy++) {
                for (let iz = -count; iz <= count; iz++) {
                    const x = ix * spacing;
                    const y = iy * spacing;
                    const z = iz * spacing;

                    const p = new Point(x, y, z);
                    p._localX = x;
                    p._localY = y;
                    p._localZ = z;
                    p.isAttractable = true;
                    p.tag = 'LOCAL_GRID';
                    points.push(p);
                }
            }
        }

        // 生成虚线点
        for (let ix = -count; ix <= count; ix++) {
            for (let iy = -count; iy <= count; iy++) {
                for (let iz = -count; iz <= count; iz++) {
                    const x0 = ix * spacing;
                    const y0 = iy * spacing;
                    const z0 = iz * spacing;

                    // +X 方向
                    if (ix < count) {
                        for (let d = 1; d <= dashPointsPerEdge; d++) {
                            const dp = new Point(x0 + d * dashSpacing, y0, z0);
                            dp._localX = dp.x;
                            dp._localY = dp.y;
                            dp._localZ = dp.z;
                            dp.isAttractable = false;
                            dp.tag = 'LOCAL_GRID_DASH';
                            points.push(dp);
                        }
                    }

                    // +Y 方向
                    if (iy < count) {
                        for (let d = 1; d <= dashPointsPerEdge; d++) {
                            const dp = new Point(x0, y0 + d * dashSpacing, z0);
                            dp._localX = dp.x;
                            dp._localY = dp.y;
                            dp._localZ = dp.z;
                            dp.isAttractable = false;
                            dp.tag = 'LOCAL_GRID_DASH';
                            points.push(dp);
                        }
                    }

                    // +Z 方向
                    if (iz < count) {
                        for (let d = 1; d <= dashPointsPerEdge; d++) {
                            const dp = new Point(x0, y0, z0 + d * dashSpacing);
                            dp._localX = dp.x;
                            dp._localY = dp.y;
                            dp._localZ = dp.z;
                            dp.isAttractable = false;
                            dp.tag = 'LOCAL_GRID_DASH';
                            points.push(dp);
                        }
                    }
                }
            }
        }

        console.log(`局部格网生成: 格点 ${Math.pow(2 * count + 1, 3)}个, 虚线点 ${points.length - Math.pow(2 * count + 1, 3)}个`);

        const gridObj = new Object();
        gridObj.displayPoints = points;
        gridObj.center = { x: targetObj.center.x, y: targetObj.center.y, z: targetObj.center.z };

        if (targetObj.quaternion) {
            gridObj.quaternion = { ...targetObj.quaternion };
        } else {
            gridObj.quaternion = { w: 1, x: 0, y: 0, z: 0 };
        }

        gridObj.isLocalGrid = true;
        gridObj.owner = targetObj;

        return gridObj;
    }
}
