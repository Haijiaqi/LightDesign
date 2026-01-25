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
import { CONFIG } from "./Config.js";
import { EditConfig } from "./EditConfig.js";


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
                // 阶段3修改：生成局部坐标（以原点为中心）
                const rotatedX = px * cosA - py * sinA;
                const rotatedY = px * sinA + py * cosA;
                const rotatedZ = pz;
                // 不加 x, y, z 偏移，这些是局部坐标
                points.push(new Point(rotatedX, rotatedY, rotatedZ));
            });

            if (ifEntity) {
                const intX = (Math.random() - 0.5) * size;
                const intY = (Math.random() - 0.5) * size;
                const intZ = (Math.random() - 0.5) * size;
                const rotatedX = intX * cosA - intY * sinA;
                const rotatedY = intX * sinA + intY * cosA;
                const rotatedZ = intZ;
                // 不加 x, y, z 偏移
                points.push(new Point(rotatedX, rotatedY, rotatedZ));
            }
        }

        // 计算初始 frontDirection（默认朝向 -Y，即(0,-1,0)）
        // 因为 createCube 创建时绕 Z 轴旋转了 alpha 度
        const frontX = Math.sin(rad);
        const frontY = -Math.cos(rad);
        const frontZ = 0;

        // 通过 center 参数传递世界位置
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

        // 阶段3修改：生成局部坐标（以原点为中心）
        // 不再单独给平面赋法向量，让系统通过 estimateNormals 统一处理
        const generateSurfacePoint = () => {
            const px = (Math.random() - 0.5) * width;
            const pz = (Math.random() - 0.5) * height;
            const py = 0;

            const rotatedX = px * cosA - py * sinA;
            const rotatedY = px * sinA + py * cosA;
            const rotatedZ = pz;

            // 不加 x, y, z 偏移，这些是局部坐标
            return new Point(rotatedX, rotatedY, rotatedZ);
        };

        for (let i = 0; i < pointsPerFace; i++) {
            points.push(generateSurfacePoint());
        }

        if (ifEntity) {
            for (let i = 0; i < pointsPerFace; i++) {
                points.push(generateSurfacePoint());
            }
        }

        // 通过 center 参数传递世界位置
        return new Object(points, { center: { x, y, z } });
    }

    /**
     * 创建球体点云
     * @param {number} x0 - 中心 X 坐标（世界坐标）
     * @param {number} y0 - 中心 Y 坐标（世界坐标）
     * @param {number} z0 - 中心 Z 坐标（世界坐标）
     * @param {number} radius - 半径
     * @param {number} numPoints - 点数
     * @returns {Object}
     */
    static createSphere(x0, y0, z0, radius = 5, numPoints = 5000) {
        const points = [];
        // 阶段3修改：生成局部坐标（以原点为中心）
        for (let i = 0; i < numPoints; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            // 局部坐标：不加 x0, y0, z0
            const lx = radius * Math.sin(phi) * Math.cos(theta);
            const ly = radius * Math.sin(phi) * Math.sin(theta);
            const lz = radius * Math.cos(phi);
            points.push(new Point(lx, ly, lz));
        }
        // 通过 center 参数传递世界位置
        return new Object(points, { center: { x: x0, y: y0, z: z0 } });
    }

    /**
     * 创建带经纬线的球体（三个正交大圆）
     * @param {number} x0 - 中心 X 坐标（世界坐标）
     * @param {number} y0 - 中心 Y 坐标（世界坐标）
     * @param {number} z0 - 中心 Z 坐标（世界坐标）
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

        // 阶段3修改：生成局部坐标（以原点为中心）
        // 圆1: XY平面 (z=0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                radius * Math.cos(theta),
                radius * Math.sin(theta),
                0
            ));
        }

        // 圆2: XZ平面 (y=0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                radius * Math.cos(theta),
                0,
                radius * Math.sin(theta)
            ));
        }

        // 圆3: YZ平面 (x=0)
        for (let p = 0; p <= pointsPerCircle; p++) {
            const theta = (p / pointsPerCircle) * 2 * Math.PI;
            points.push(new Point(
                0,
                radius * Math.cos(theta),
                radius * Math.sin(theta)
            ));
        }

        // 通过 center 参数传递世界位置
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
        // 修复：使用对称范围，确保几何中心与局部原点重合
        // size=6 时: halfExtent=2.5, 坐标范围 [-2.5, 2.5]
        const halfExtent = (size - 1) * spacing / 2;

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                for (let k = 0; k < size; k++) {
                    const isSurface = (
                        i === 0 || i === size - 1 ||
                        j === 0 || j === size - 1 ||
                        k === 0 || k === size - 1
                    );

                    if (isSurface) {
                        // 对称坐标：以原点为中心
                        const lx = (i - (size - 1) / 2) * spacing;
                        const ly = (j - (size - 1) / 2) * spacing;
                        const lz = (k - (size - 1) / 2) * spacing;

                        const p = new Point(lx, ly, lz);
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
            // 测试平面: 20cm 宽 × 5cm 高，位于 (0, 50, 0)
            ObjectFactoryImpl.createPlane(20, 5, 2000, 0, 50, 0, 0, false),

            // 球体: 半径 3cm，位于 (-10, 50, 0) - 整10位置
            ObjectFactoryImpl.createSphere(-10, 50, 0, 3, 3000),

            // 立方体: 边长 4cm，位于 (10, 50, 0) - 整10位置
            // 参数顺序: size, pointsPerFace, x, y, z, alpha, ifEntity
            ObjectFactoryImpl.createCube(4, 300, 10, 50, 0, 0, false),

            // 整格点对象: 7点边长(6cm)，间距1cm，位于 (0, 50, 0)
            ObjectFactoryImpl.createIntegerGridObject(0, 50, 0, 7, 1),
        ];
    }

    // ==========================================================================
    // 局部格网系统
    // ==========================================================================

    /**
     * 局部格网配置 (集中管理，方便调整)
     */
    static LocalGridConfig = {
        get size() { return EditConfig.size; },
        get spacing() { return EditConfig.spacing; },
        get halfSize() { return EditConfig.halfSize; },
        get layerCount() { return EditConfig.layerCount; },

        getLayerSpacingForOrientation(orientationType) {
            return EditConfig.getLayerSpacingForOrientation(orientationType);
        },

        getMaxDepthForOrientation(orientationType) {
            return EditConfig.getMaxDepthForOrientation(orientationType);
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
        const count = config.layerCount;

        console.log(`创建局部格网: 尺寸=${finalSize}cm, 间距=${spacing}cm, layerCount=${count}`);

        const points = [];
        const controlPoints = [];

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

                    // 判断是否是棱上的点（12条棱）
                    // 棱的定义：恰好有两个坐标在边界（±count），第三个坐标在内部
                    const onEdgeX = (ix === -count || ix === count);
                    const onEdgeY = (iy === -count || iy === count);
                    const onEdgeZ = (iz === -count || iz === count);
                    const edgeCount = (onEdgeX ? 1 : 0) + (onEdgeY ? 1 : 0) + (onEdgeZ ? 1 : 0);

                    if (edgeCount >= 2) {
                        // 【规格 B】棱上或角上的点：作为 Control Point
                        // - 直接作为 controlPoints 传入
                        // - 行为规则：EDIT 态永远显示，永远可吸附，不可编辑
                        p.tag = 'CONTROL';
                        p.isEditable = false;
                        p.isAttractable = true; // 规格要求永远可吸附
                        controlPoints.push(p);
                    } else {
                        // 【规格 B】普通格点：作为 Display Point
                        // - 行为规则：只有靠近屏幕平面才显示/吸附
                        p.tag = 'LOCAL_GRID';
                        p.isAttractable = true;
                        // light 初始值，会被 updateLocalGrid 动态更新
                        p.light = 0.8;
                        points.push(p);
                    }
                }
            }
        }

        console.log(`局部格网生成: 格点(Display)=${points.length}, 棱点(Control)=${controlPoints.length}`);

        // 阶段3修复：正确初始化 transform
        const gridObj = new Object(points, {
            center: {
                x: targetObj.center.x,
                y: targetObj.center.y,
                z: targetObj.center.z
            },
            quaternion: targetObj.quaternion ? {
                w: targetObj.quaternion.w,
                x: targetObj.quaternion.x,
                y: targetObj.quaternion.y,
                z: targetObj.quaternion.z
            } : { w: 1, x: 0, y: 0, z: 0 },
            // 【规格 B】显式传入 Control Points
            controlPoints: controlPoints
        });

        gridObj.isLocalGrid = true;
        gridObj.owner = targetObj;

        // 禁用局部格网的中心点吸附（它不应该干扰编辑操作）
        if (gridObj.centerPoint) {
            gridObj.centerPoint.isAttractable = false;
            gridObj.centerPoint.isObjectCenter = false;
        }

        return gridObj;
    }
}
