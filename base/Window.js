import { Point } from "./Point.js";
import { Object } from "./Object.js";
import { Vector } from "./Vector.js";
export class Window {
  constructor(width, height, xlength, ylength, name) {
    this.width = width;
    this.height = height;
    this.xlength = xlength;
    this.ylength = ylength;
    this.DPIx = width / this.xlength;
    this.DPIy = height / this.ylength;
    this.direction = null;
    this.capital = null;
    this.dirAngle = 0;
    this.vx = null;
    this.vy = null;
    this.disOfPointToPlane = 0;
    this.disOfPointProjToPlaneXaxis = 0;
    this.disOfPointProjToPlaneYaxis = 0;
    this.gridsize = 8;
    this.name = name;
    this.windowObjects = [];

    this.grid = Array.from({ length: this.width / this.gridsize }, () =>
      Array.from({ length: this.height / this.gridsize }, () => []),
    );
  }
  resizeRefresh(width, height, xlength, ylength) {
    this.width = width;
    this.height = height;
    this.xlength = xlength;
    this.ylength = ylength;
    this.DPIx = width / this.xlength;
    this.DPIy = height / this.ylength;
  }
  getAngle() {
    const hcdx = this.direction.start.x - this.capital.x;
    const hcdy = this.direction.start.y - this.capital.y;
    if (hcdy != 0) {
      this.dirAngle = Math.atan(hcdx / hcdy);
      if (hcdy < 0) {
        if (hcdx != 0) {
          if (hcdx > 0) {
            this.dirAngle = Math.PI + this.dirAngle;
          } else {
            this.dirAngle = -Math.PI + this.dirAngle;
          }
        } else {
          this.dirAngle = Math.PI;
        }
      }
    } else {
      if (hcdx != 0) {
        if (hcdx > 0) {
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

  update(width, height, xlength, ylength, name) {
    this.width = width;
    this.height = height;
    this.xlength = xlength;
    this.ylength = ylength;
    this.DPIx = width / this.xlength;
    this.DPIy = height / this.ylength;
  }

  horizontalRotation(angle) {
    const camAngle = angle + this.dirAngle;
    const camDirAngle = angle + this.direction.dirAngle;
    const camElevation = 0;
    const hcd = this.capital.getD(this.direction.start);
    this.direction.start.x =
      hcd * Math.cos(camElevation) * Math.sin(camAngle) + this.capital.x;
    this.direction.start.y =
      hcd * Math.cos(camElevation) * Math.cos(camAngle) + this.capital.y;
    this.direction.start.z = hcd * Math.sin(camElevation) + this.capital.z;
    this.direction.x = Math.cos(camElevation) * Math.sin(camDirAngle);
    this.direction.y = Math.cos(camElevation) * Math.cos(camDirAngle);
    this.direction.z = Math.sin(camElevation);
    this.dirAngle = camAngle;
    this.direction.dirAngle = camDirAngle;
  }
  headMoveTo(headDisFromPane, headHeight, headX) {
    this.capital = this.direction.getPoint(headDisFromPane);
    let py = this.vy.timesLV(headHeight);
    let px = this.vx.timesLV(headX);
    let pa = py.addV(px);
    this.capital.x += pa.x;
    this.capital.y += pa.y;
    this.capital.z += pa.z;
  }
  calculate(head, eyeD, direction, objects, light, otherObjects) {
    this.direction = direction;
    this.capital = head;
    this.eyeD = eyeD;
    this.getAngle();
    this.calculatePointToCenter(head, direction);

    // 清空网格
    for (let i = 0; i < this.grid.length; i++) {
      for (let j = 0; j < this.grid[i].length; j++) {
        this.grid[i][j].length = 0;
      }
    }
    if (this.eyeD && this.windowObjects.length == 0) {
      const gridConfig =
      {
        DPIx: this.DPIx,
        DPIy: this.DPIy,
        width: this.width,
        height: this.height,
        screenWidthCm: this.xlength,
        screenHeightCm: this.ylength,
        horizontalInterval: 1, // 横向间距2cm
        verticalInterval: 1, // 纵向间距2cm
        gridWidth: 20, // 网格区域宽20cm（左右各10cm）
        gridHeight: 10, // 网格区域高16cm（上下各8cm）
        centerPosCm: { x: 0, y: 0 }, // 中心交点在屏幕物理中心
        dashPattern: [0.1, 0.4], // 实长1cm，虚长0.5cm
        light: 0.5
      };
      const result = this.createGridObject(gridConfig);
      this.windowObjects = [
        new Object(result.intersections),
        new Object(result.centerLinePixels),
        new Object(result.otherPixels)
      ];
    }
    // 处理 objects 集合（原 calculateAPoint 逻辑）
    for (let oi = 0; oi < objects.length; oi++) {
      const object = objects[oi];
      // 阶段1修改：优先使用 displayPoints（渲染用），回退到 constructionPoints
      const renderPoints = (object.displayPoints && object.displayPoints.length > 0)
        ? object.displayPoints
        : object.constructionPoints;
      if (!renderPoints || renderPoints.length === 0) continue;
      for (let pi = 0; pi < renderPoints.length; pi++) {
        const point = renderPoints[pi];
        // 1. 执行公共基础计算
        const inverseRate = this.calculateBasePoint(
          head,
          eyeD,
          direction,
          point,
        );
        if (inverseRate === null) continue;
        // 2. 执行 A 点特有逻辑
        this.handleAPointSpecific(head, eyeD, point, light, inverseRate);
      }
    }

    // 处理 otherObjects 集合（原 calculateOtherPoint 逻辑）
    if (!light) {
      for (let oi = 0; oi < otherObjects.length; oi++) {
        const object = otherObjects[oi];
        // 阶段1修改：优先使用 displayPoints，回退到 constructionPoints
        const renderPoints = (object.displayPoints && object.displayPoints.length > 0)
          ? object.displayPoints
          : object.constructionPoints;
        if (!renderPoints || renderPoints.length === 0) continue;
        for (let pi = 0; pi < renderPoints.length; pi++) {
          const point = renderPoints[pi];
          // 1. 初始化 otherPoint 特有属性（light 初始值）
          point.light = 1;
          // 2. 仅执行公共基础计算（无额外特有逻辑）
          const inverseRate = this.calculateBasePoint(
            head,
            eyeD,
            direction,
            point,
          );
          // 无需处理返回值，无效点会在 calculateBasePoint 中终止
        }
      }
    }
    // if (this.windowObjects.length != 0) {
    //   for (let index = 0; index < this.windowObjects.length; index++) {
    //     const element = this.windowObjects[index];
    //     for (let i = 0; i < element.points.length; i++) {
    //       const e = element.points[i];
    //       const x_grid = Math.floor(e.xM / this.gridsize);
    //       const y_grid = Math.floor(e.yM / this.gridsize);

    //       // 网格边界判断（公共：超出网格则点无效）
    //       if (x_grid >= this.grid.length || y_grid >= this.grid[0].length) {
    //         continue;
    //       }
    //       this.grid[x_grid][y_grid].push(e);
    //     }
    //   }
    // }
    this.calculateNormal();
  }

  calculatePointToCenter(p, direction) {
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

  calculateBasePoint(head, eyeD, direction, point) {
    // 1. 基础属性初始化（公共）
    point.dis = 0;
    point.xL = 0;
    point.yL = 0;
    point.xR = 0;
    point.yR = 0;
    point.xM = 0;
    point.yM = 0;

    // 2. 空间坐标计算（公共）
    const hpdx = point.x - head.x;
    const hpdy = point.y - head.y;
    const hpdz = point.z - head.z;
    const ll = hpdx * hpdx + hpdy * hpdy + hpdz * hpdz;
    point.dir = Math.sqrt(ll);

    // 3. 平面距离判断（公共：超出阈值则点无效）
    const disOfPointToHeadPlane = direction.projL(hpdx, hpdy, hpdz);
    if (this.disOfPointToPlane - disOfPointToHeadPlane > 7.5) {
      return null;
    }

    // 4. 比例计算（公共）
    const rate = this.disOfPointToPlane / disOfPointToHeadPlane;
    const inverseRate = 1 - rate;

    // 5. 屏幕坐标转换（公共）
    const disOfPointProjToHeadPlaneXaxis = this.vy.projL(hpdx, hpdy, hpdz);
    const y =
      this.ylength / 2 -
      (this.disOfPointProjToPlaneXaxis + disOfPointProjToHeadPlaneXaxis * rate);

    const disOfPointProjToHeadPlaneYaxis = this.vx.projL(hpdx, hpdy, hpdz);
    const x =
      this.xlength / 2 +
      this.disOfPointProjToPlaneYaxis +
      disOfPointProjToHeadPlaneYaxis * rate;

    // 6. 屏幕边界判断（公共：超出边界则点无效）
    if (y <= 0 || y >= this.ylength || x <= 0 || x >= this.xlength) {
      return null;
    }

    // 7. 网格坐标计算与插入（公共）
    const yScreen = Math.round(y * this.DPIy);
    const xScreen = Math.round(x * this.DPIx);
    const x_grid = Math.floor(xScreen / this.gridsize);
    const y_grid = Math.floor(yScreen / this.gridsize);

    // 网格边界判断（公共：超出网格则点无效）
    if (x_grid >= this.grid.length || y_grid >= this.grid[0].length) {
      return null;
    }

    // 8. 点属性赋值与网格插入（公共）
    point.xM = xScreen;
    point.yM = yScreen;
    point.dis = disOfPointToHeadPlane;

    // 按距离排序插入网格（公共）
    let insertIndex = 0;
    while (
      insertIndex < this.grid[x_grid][y_grid].length &&
      this.grid[x_grid][y_grid][insertIndex].dis < point.dis
    ) {
      insertIndex++;
    }
    this.grid[x_grid][y_grid].splice(insertIndex, 0, point);

    // 9. 双眼坐标计算（公共：eyeD 存在时）
    if (eyeD) {
      // 屏幕边界校验（OtherPoint 无此逻辑）
      if (
        point.xL < 0 ||
        point.xR > this.width ||
        point.yL < 0 ||
        point.yR < 0
      ) {
        point.xL = 0;
        point.xR = 0;
        point.yL = 0;
        point.yR = 0;
        point.xM = 0;
        point.yM = 0;
      }
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
    }

    // 返回差异逻辑需用到的 inverseRate（点有效时）
    return inverseRate;
  }
  handleAPointSpecific(head, eyeD, point, light, inverseRate) {
    // 1. A点特有：light 初始值（OtherPoint 初始值为1，此处为0.5）
    point.light = 0.4;

    // 2. A点特有：eyeD 存在时的屏幕边界校验与光照计算
    if (eyeD) {
      // 法向量与光照计算（OtherPoint 无此逻辑）
      if (point.rx != 0 || point.ry != 0 || point.rz != 0) {
        const hpdx = point.x - head.x;
        const hpdy = point.y - head.y;
        const hpdz = point.z - head.z;
        const projN =
          (-hpdx * point.nx + -hpdy * point.ny + -hpdz * point.nz) / 1;

        if (projN > 0) {
          const projR =
            (-hpdx * point.rx + -hpdy * point.ry + -hpdz * point.rz) /
            point.dir;
          point.light *= projR > 0 ? projR : 0;
        } else {
          point.light *= 0;
        }
      } else {
        point.light = 0;
      }

      // 光照补偿（OtherPoint 无此逻辑）
      point.light += 0.6;

      // 光照衰减（OtherPoint 无此逻辑）
      const attenuation = 1 / (point.dir * 0.001 + 1);
      point.light *= attenuation;
    }

    // 3. A点特有：光照开启时的反射向量计算（OtherPoint 无此逻辑）
    if (light && (point.nx != 0 || point.ny != 0 || point.nz != 0)) {
      const hpdx = point.x - head.x;
      const hpdy = point.y - head.y;
      const hpdz = point.z - head.z;
      const dot = point.nx * hpdx + point.ny * hpdy + point.nz * hpdz;
      const twoDot = 2 * dot;

      // 反射向量计算
      point.rx = (hpdx - twoDot * point.nx) / point.dir;
      point.ry = (hpdy - twoDot * point.ny) / point.dir;
      point.rz = (hpdz - twoDot * point.nz) / point.dir;

      // 反射向量衰减
      const attenuation = (1 / (point.dir * 0.001 + 1)) * light;
      point.rx *= attenuation;
      point.ry *= attenuation;
      point.rz *= attenuation;
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
          // 假设 end 是起始前的索引，e 从 end + 1 开始处理
          let e = 1;
          for (let i = e; i < points.length; i++) {
            points[i].light *= Math.pow(0.075, (i - 0));
            // 计算当前索引与 e 的差值：如果是奇数，说明是需要剔除的间隔元素
            // if ((i - e) % 2 === 1) {
            // points.splice(i, 1); // 从原数组中删除该元素
            // }
          }
          // 剩余元素（e, e+2, e+4...）执行 light 乘以 0.75 的操作
          // for (let i = e; i < points.length; i++) {
          // points[i].light *= 0.075;
          // }
          // 前3个点深度差异大，跳过
          continue;
        }

        // 向后扩展，直到深度差 > 0.01
        for (let k = 3; k < points.length; k++) {
          const newAvg = (avg * k + points[k].dis) / (k + 1);
          if (Math.abs(newAvg - firstDis) <= 0.01) {
            end = k;
            avg = newAvg;
          } else {
            break;
          }
        }
        // 假设 end 是起始前的索引，e 从 end + 1 开始处理
        let e = end + 1;
        for (let i = points.length - 1; i > e; i--) {
          // 计算当前索引与 e 的差值：如果是奇数，说明是需要剔除的间隔元素
          // if ((i - e) % 2 === 1) {
          points.splice(i, 1); // 从原数组中删除该元素
          // }
        }
        // 剩余元素（e, e+2, e+4...）执行 light 乘以 0.75 的操作
        // for (let i = e; i < points.length; i++) {
        // points[i].light *= 0.075;
        // }
        // 检查 XY 分布是否足够广（单位：像素）
        let xmin = Infinity,
          xmax = -Infinity;
        let ymin = Infinity,
          ymax = -Infinity;

        for (let k = start; k <= end; k++) {
          const px = points[k].xM;
          const py = points[k].yM;
          if (px < xmin) xmin = px;
          if (px > xmax) xmax = px;
          if (py < ymin) ymin = py;
          if (py > ymax) ymax = py;
        }

        if (xmax - xmin > 2 && ymax - ymin > 2) {
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

  createGridObject(params) {
    // --------------------------
    // 1. 参数解构与常量预计算
    // --------------------------
    const {
      DPIx,
      DPIy,
      width: pixelWidth,
      height: pixelHeight,
      horizontalInterval,
      verticalInterval,
      gridWidth,
      gridHeight,
      centerPosCm,
      dashPattern,
      light
    } = params;
    const [dashOnCm, dashOffCm] = dashPattern;
    const { x: centerXcm, y: centerYcm } = centerPosCm;

    const halfGridWidth = gridWidth / 2;
    const halfGridHeight = gridHeight / 2;
    const xMinCm = centerXcm - halfGridWidth;
    const xMaxCm = centerXcm + halfGridWidth;
    const yMinCm = centerYcm - halfGridHeight;
    const yMaxCm = centerYcm + halfGridHeight;

    const centerXPixel = Math.round(pixelWidth / 2 + centerXcm * DPIx);
    const centerYPixel = Math.round(pixelHeight / 2 + centerYcm * DPIy);
    const dashCycleCm = dashOnCm + dashOffCm;

    // 全局像素Set：存储"x,y"字符串，用于去重
    const globalPixelSet = new Set();
    // 全局Point对象映射：key为"x,y"，value为Point实例
    const globalPointMap = new Map();


    // --------------------------
    // 2. 提前生成网格线列表（修复变量声明顺序问题）
    // 关键：在使用前先声明并初始化horizontalLinesYcm和verticalLinesXcm
    // --------------------------
    const horizontalLinesYcm = [];
    if (verticalInterval > 0) {
      const maxStepsUp = Math.floor((centerYcm - yMinCm) / verticalInterval);
      const maxStepsDown = Math.floor((yMaxCm - centerYcm) / verticalInterval);
      for (let i = 0; i <= maxStepsUp; i++) {
        horizontalLinesYcm.push(centerYcm - i * verticalInterval);
      }
      for (let i = 1; i <= maxStepsDown; i++) {
        horizontalLinesYcm.push(centerYcm + i * verticalInterval);
      }
    }

    const verticalLinesXcm = [];
    if (horizontalInterval > 0) {
      const maxStepsLeft = Math.floor((centerXcm - xMinCm) / horizontalInterval);
      const maxStepsRight = Math.floor((xMaxCm - centerXcm) / horizontalInterval);
      for (let i = 0; i <= maxStepsLeft; i++) {
        verticalLinesXcm.push(centerXcm - i * horizontalInterval);
      }
      for (let i = 1; i <= maxStepsRight; i++) {
        verticalLinesXcm.push(centerXcm + i * horizontalInterval);
      }
    }


    // --------------------------
    // 3. 工具函数（坐标转换+像素生成）
    // --------------------------
    // 坐标转换：cm→像素
    const cmToPixelX = (xCm) => Math.round(pixelWidth / 2 + xCm * DPIx);
    const cmToPixelY = (yCm) => Math.round(pixelHeight / 2 + yCm * DPIy);

    // 生成Point实例（去重）
    const createUniquePoint = (x, y) => {
      const key = `${x},${y}`;
      if (globalPointMap.has(key)) {
        return globalPointMap.get(key);
      }
      const point = new Point(0, 0, 0);
      point.xM = point.xL = point.xR = x;
      point.yM = point.yL = point.yR = y;
      point.light *= light;
      globalPointMap.set(key, point);
      globalPixelSet.add(key);
      return point;
    };

    // 生成实线段像素（先实后虚，去重添加）
    const addSolidPixels = (isHorizontal, fixedPosCm, startBoundCm, endBoundCm) => {
      const ranges = getSolidRanges(
        isHorizontal ? centerXcm : centerYcm,
        startBoundCm,
        endBoundCm,
        dashOnCm,
        dashOffCm,
        dashCycleCm
      );

      if (isHorizontal) {
        const fixedYPixel = cmToPixelY(fixedPosCm);
        ranges.forEach(({ start, end }) => {
          const xStart = cmToPixelX(start);
          const xEnd = cmToPixelX(end);
          for (let x = xStart; x <= xEnd; x++) {
            createUniquePoint(x, fixedYPixel);
          }
        });
      } else {
        const fixedXPixel = cmToPixelX(fixedPosCm);
        ranges.forEach(({ start, end }) => {
          const yStart = cmToPixelY(start);
          const yEnd = cmToPixelY(end);
          for (let y = yStart; y <= yEnd; y++) {
            createUniquePoint(fixedXPixel, y);
          }
        });
      }
    };


    // --------------------------
    // 4. 分步生成像素（严格按顺序，无重复）
    // --------------------------
    // 4.1 第一步：生成中心点
    const centerPoint = createUniquePoint(centerXPixel, centerYPixel);

    // 4.2 第二步：从中心点向四方向画中心线（先实后虚，去重）
    // 纵向中心线（x=中心x，上→下）
    addSolidPixels(false, centerXcm, yMinCm, yMaxCm);
    // 横向中心线（y=中心y，左→右）
    addSolidPixels(true, centerYcm, xMinCm, xMaxCm);

    // 4.3 第三步：从中心线向两侧画普通线（先实后虚，去重）
    // 普通横向线（排除中心线y）
    const normalHorizontalLines = horizontalLinesYcm.filter(yCm => yCm !== centerYcm);
    normalHorizontalLines.forEach(yCm => addSolidPixels(true, yCm, xMinCm, xMaxCm));
    // 普通纵向线（排除中心线x）
    const normalVerticalLines = verticalLinesXcm.filter(xCm => xCm !== centerXcm);
    normalVerticalLines.forEach(xCm => addSolidPixels(false, xCm, yMinCm, yMaxCm));


    // --------------------------
    // 5. 分类生成最终列表（从全局像素集中筛选，无重复）
    // --------------------------
    // 5.1 生成交点列表：先筛选已有交点，再补足缺失交点
    const intersections = [];
    const intersectionKeySet = new Set();

    // 步骤1：筛选全局像素集中已存在的交点
    horizontalLinesYcm.forEach(yCm => {
      const yPixel = cmToPixelY(yCm);
      verticalLinesXcm.forEach(xCm => {
        const xPixel = cmToPixelX(xCm);
        const key = `${xPixel},${yPixel}`;
        if (globalPixelSet.has(key)) {
          const point = globalPointMap.get(key);
          intersections.push(point);
          intersectionKeySet.add(key);
        }
      });
    });

    // 步骤2：补足“应存在但未生成”的交点
    horizontalLinesYcm.forEach(yCm => {
      const yPixel = cmToPixelY(yCm);
      verticalLinesXcm.forEach(xCm => {
        const xPixel = cmToPixelX(xCm);
        const key = `${xPixel},${yPixel}`;
        if (!intersectionKeySet.has(key)) {
          const point = createUniquePoint(xPixel, yPixel);
          intersections.push(point);
          intersectionKeySet.add(key);
        }
      });
    });

    // 确保中心点在交点列表第一个
    const centerKey = `${centerXPixel},${centerYPixel}`;
    const centerIndex = intersections.findIndex(p => `${p.xM},${p.yM}` === centerKey);
    if (centerIndex > 0) {
      [intersections[0], intersections[centerIndex]] = [intersections[centerIndex], intersections[0]];
    }

    // 5.2 生成中心线像素列表（排除交点）
    const centerLinePixels = [];
    const centerLineKeySet = new Set();
    const centerXKeyPrefix = `${centerXPixel},`;
    const centerYKeySuffix = `,${centerYPixel}`;

    globalPixelSet.forEach(key => {
      if (
        (key.startsWith(centerXKeyPrefix) || key.endsWith(centerYKeySuffix)) &&
        !intersectionKeySet.has(key) &&
        !centerLineKeySet.has(key)
      ) {
        centerLinePixels.push(globalPointMap.get(key));
        centerLineKeySet.add(key);
      }
    });

    // 5.3 生成其他普通像素列表（排除交点和中心线）
    const otherPixels = [];
    globalPixelSet.forEach(key => {
      if (
        !intersectionKeySet.has(key) &&
        !centerLineKeySet.has(key)
      ) {
        otherPixels.push(globalPointMap.get(key));
      }
    });


    // --------------------------
    // 6. 工具函数：实线段范围计算
    // --------------------------
    function getSolidRanges(startCm, minCm, maxCm, onCm, offCm, cycleCm) {
      const ranges = [];
      if (cycleCm <= 0) return ranges;

      // 正方向（右/下）：先实后虚
      for (let n = 0; ; n++) {
        const segStart = startCm + n * cycleCm;
        const segEnd = segStart + onCm;
        if (segStart > maxCm) break;
        ranges.push({ start: Math.max(segStart, startCm), end: Math.min(segEnd, maxCm) });
      }

      // 负方向（左/上）：先实后虚
      for (let n = 1; ; n++) {
        const segEnd = startCm - (n - 1) * cycleCm;
        const segStart = segEnd - onCm;
        if (segEnd < minCm) break;
        ranges.push({ start: Math.max(segStart, minCm), end: Math.min(segEnd, startCm) });
      }

      // 按距离中心由近及远排序
      return ranges.sort((a, b) => {
        const distA = Math.min(Math.abs(a.start - startCm), Math.abs(a.end - startCm));
        const distB = Math.min(Math.abs(b.start - startCm), Math.abs(b.end - startCm));
        return distA - distB;
      });
    }


    return { intersections, centerLinePixels, otherPixels };
  }
}
