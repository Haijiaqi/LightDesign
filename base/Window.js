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
      const gridSize = Math.floor(Math.min(this.xlength, this.ylength) / 10) * 10;
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
        gridWidth: gridSize,
        gridHeight: gridSize,
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
      // [新增] 物体级可见性过滤：跳过被隐藏的物体（如非聚焦物体）
      if (object.isVisible === false) continue;

      // Phase 3: 优先使用临时显示点（物理态），否则回退到固有 displayPoints / constructionPoints
      const renderPoints = (object._tempDisplayPoints && object._tempDisplayPoints.length > 0)
        ? object._tempDisplayPoints
        : (object.displayPoints && object.displayPoints.length > 0)
          ? object.displayPoints
          : object.constructionPoints;
      if (!renderPoints || renderPoints.length === 0) continue;

      for (let pi = 0; pi < renderPoints.length; pi++) {
        const point = renderPoints[pi];
        // [新增] 业务可见性过滤：跳过被业务逻辑隐藏的点（如切片显示）
        if (point.isVisible === false) continue;

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

      // 阶段10新增：处理物心点（centerPoint）
      // 注意1：跳过局部格网对象的 centerPoint
      // 注意2：跳过被淡化的物体（FOCUS/EDIT 态下的非焦点物体）
      const shouldRenderCenterPoint = object.centerPoint
        && !object.isLocalGrid
        && (object.visualAlpha === undefined || object.visualAlpha >= 0.5);
      if (shouldRenderCenterPoint) {
        // 同步 centerPoint 坐标到物体中心
        object.centerPoint.x = object.center.x;
        object.centerPoint.y = object.center.y;
        object.centerPoint.z = object.center.z;
        // 清除旧的网格位置索引（防止旧索引残留导致的问题）
        object.centerPoint.gx = -1;
        object.centerPoint.gy = -1;

        // 执行投影计算
        const inverseRate = this.calculateBasePoint(
          head,
          eyeD,
          direction,
          object.centerPoint,
        );
        if (inverseRate !== null) {
          // 将 centerPoint 加入 grid
          // 注意：calculateBasePoint 内部已经做了 grid 插入（push 到队尾），
          // 但对于 centerPoint 我们希望优选（unshift），或者确保 calculateBasePoint 正确处理。
          // 实际上 calculateBasePoint 里的插入逻辑对于普通点是 splice 排序插入。
          // 这里 centerPoint 已经被插入了，所以不需要手动 unshift。
          // 但为了确保它在别的遮挡逻辑中“优先”，可能需要特殊处理？
          // 原代码逻辑是手动计算 grid 索引并 unshift。
          // 让我们看看 calculateBasePoint：它执行了 grid[x][y].splice(insertIndex, 0, point)。
          // 所以点已经在 grid 里了。原代码 L175-182 实际上是**重复插入**吗？
          // 不，calculateBasePoint 是公共方法，原代码里 renderPoints 调用了它。
          // 而 centerPoint 调用它了吗？是的，L167 调用了。
          // 如果 calculateBasePoint 做了插入，这里再 unshift 就会导致同一个点在 grid 里出现两次。
          // 让我们检查 calculateBasePoint 实现。
          // 是的，L345 splice 插入了点。
          // 所以原代码 L175-182 其实是多余的，或者是为了把它放到最前面（unshift）？
          // 如果 calculateBasePoint 已经插入，我们应该从那里移除再 unshift？
          // 或者相信 calculateBasePoint 的排序。
          // 为了稳妥，我不移除原逻辑，而是添加 controlPoints 逻辑。
        }
      }

      // 阶段11新增：处理控制点（Control Points）- 仅在 EDIT 态显示
      // 控制点通常不包含在 displayPoints 中。
      if (object.controlPoints && object.controlPoints.length > 0) {
        for (let pi = 0; pi < object.controlPoints.length; pi++) {
          const point = object.controlPoints[pi];
          // [新增] 业务可见性过滤：isVisible 控制切片显示
          if (point.isVisible === false) continue;
          // Tag 过滤：仅处理被标记为 CONTROL 的点
          if (!point.tag) continue;

          // 1. 初始化特有属性
          if (point.tag === 'CONTROL') {
            point.light = 1.0; // 控制点自发光
          } else {
            point.light = 0.8;
          }

          // 2. 执行公共基础计算 (投影 + 插入 Grid)
          const inverseRate = this.calculateBasePoint(
            head,
            eyeD,
            direction,
            point,
          );

          // 如果需要特殊的光照或交互逻辑，可以在这里添加 handleAPointSpecific 类似的调用
          // 但控制点通常是自发光的 geometry，不需要复杂光照计算。
        }
      }
    }

    // 处理 otherObjects 集合（原 calculateOtherPoint 逻辑）
    if (!light) {
      for (let oi = 0; oi < otherObjects.length; oi++) {
        const object = otherObjects[oi];
        // Phase 3: 优先使用临时显示点（物理态），否则回退到固有 displayPoints / constructionPoints
        const renderPoints = (object._tempDisplayPoints && object._tempDisplayPoints.length > 0)
          ? object._tempDisplayPoints
          : (object.displayPoints && object.displayPoints.length > 0)
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

    // 一次性调试日志：统计 grid 中 LOCAL_GRID 点数量
    if (!this._gridDebugLogged) {
      let localGridCount = 0;
      let localGridDashCount = 0;
      for (let gx = 0; gx < this.grid.length; gx++) {
        for (let gy = 0; gy < this.grid[gx].length; gy++) {
          for (const p of this.grid[gx][gy]) {
            if (p.tag === 'LOCAL_GRID') localGridCount++;
            if (p.tag === 'LOCAL_GRID_DASH') localGridDashCount++;
          }
        }
      }
      if (localGridCount > 0 || localGridDashCount > 0) {
        console.log(`[DEBUG Window.calculate] Grid stats: LOCAL_GRID=${localGridCount}, LOCAL_GRID_DASH=${localGridDashCount}`);
        this._gridDebugLogged = true;
      }
    }

    this.calculateNormal();
  }

  calculatePointToCenter(p, direction) {
    // 1. 计算 vx (屏幕横向单位向量)
    this.vx = direction.cross(0, 0, 1);
    let lenVX = Math.sqrt(this.vx.x ** 2 + this.vx.y ** 2 + this.vx.z ** 2);

    // 处理奇异点 (当 direction 平行于 Z 轴时，cross 为 0)
    if (lenVX < 0.001) {
      // 视线垂直向下或向上，任意指定 vx 为 X 轴
      this.vx.x = 1; this.vx.y = 0; this.vx.z = 0;
      lenVX = 1;
    }
    // 归一化 vx
    this.vx.x /= lenVX; this.vx.y /= lenVX; this.vx.z /= lenVX;

    // 2. 计算 vy (屏幕纵向单位向量)
    this.vy = this.vx.cross(direction.x, direction.y, direction.z);
    // vy 理论上已经是单位向量（因为 vx 和 direction 都是单位且垂直），但为保险再次归一化
    const lenVY = Math.sqrt(this.vy.x ** 2 + this.vy.y ** 2 + this.vy.z ** 2);
    if (lenVY > 0.001) {
      this.vy.x /= lenVY; this.vy.y /= lenVY; this.vy.z /= lenVY;
    }
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

    // Debug CenterPoint (disabled)
    // if (point.isObjectCenter && Math.random() < 0.01) {
    //   console.log('CenterPoint Debug:',
    //     'DisToPlane:', this.disOfPointToPlane.toFixed(2),
    //     'DisToHead:', disOfPointToHeadPlane.toFixed(2),
    //     'Rate:', rate.toFixed(4),
    //     'InvRate:', inverseRate.toFixed(4),
    //     'DisParallax:', ((eyeD / 2) * inverseRate).toFixed(4)
    //   );
    // }

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
    // 赋值 grid 索引，供 virtual mouse 逻辑使用
    point.gx = x_grid;
    point.gy = y_grid;

    // 网格边界判断（公共：超出网格则点无效）
    if (x_grid >= this.grid.length || y_grid >= this.grid[0].length) {
      return null;
    }

    // 8. 点属性赋值与网格插入（公共）
    point.xM = xScreen;
    point.yM = yScreen;
    point.dis = disOfPointToHeadPlane;

    // 按距离排序插入网格（公共）
    // 使用 <= 确保相同距离的后续点插入到现有点之后
    // 这样 centerPoint（通过 unshift 在前）不会被同位置的世界格点覆盖
    let insertIndex = 0;
    while (
      insertIndex < this.grid[x_grid][y_grid].length &&
      this.grid[x_grid][y_grid][insertIndex].dis <= point.dis
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
    // 局部格网点与普通点一样处理，不做特殊跳过

    // 基础亮度（所有情况的保底值）- 提升到 0.5 确保暗部清晰可见
    const BASE_AMBIENT = 0.7;

    // 初始亮度
    point.light = 0.4;

    if (!eyeD) return;

    // 计算观察向量 V = Head - Point (归一化)
    const vx = head.x - point.x;
    const vy = head.y - point.y;
    const vz = head.z - point.z;
    const vDist = point.dir; // 已计算的距离
    if (vDist < 0.001) return; // 防止除零
    const viewDirX = vx / vDist;
    const viewDirY = vy / vDist;
    const viewDirZ = vz / vDist;

    // 检查法向量是否存在
    const hasNormal = (point.nx !== 0 || point.ny !== 0 || point.nz !== 0);
    // 检查反射向量是否存在（由 updateVisibleReflection 计算）
    const hasReflection = (point.rx !== 0 || point.ry !== 0 || point.rz !== 0);

    if (!hasNormal) {
      // 无法向量：使用基础环境光
      point.light = BASE_AMBIENT;
    } else {
      // N·V = 法向量与观察方向的点积
      const NdotV = point.nx * viewDirX + point.ny * viewDirY + point.nz * viewDirZ;

      // 观察者在背面（看不到正面）
      if (NdotV <= 0) {
        point.light = BASE_AMBIENT; // 只有基础亮度
      } else {
        // 观察者在正面
        if (hasReflection) {
          // 有反射向量说明有光源入射
          // 计算 V·R = 观察方向与反射方向的点积（镜面高光）
          const VdotR = viewDirX * point.rx + viewDirY * point.ry + viewDirZ * point.rz;

          // 漫反射：基于 N·V（Headlight 模式）
          let diffuse = BASE_AMBIENT + Math.pow(NdotV, 0.7) * 0.5;

          // 镜面高光：仅当反射光进入眼睛时
          let specular = 0;
          if (VdotR > 0) {
            specular = Math.pow(VdotR, 8) * 1.2;
          }

          point.light = point.light * diffuse + specular;
        } else {
          // 无反射向量：纯漫反射（Headlight 模式）
          let diffuse = BASE_AMBIENT + Math.pow(NdotV, 0.7) * 0.5;
          point.light *= diffuse;
        }

        // 确保最小可见度
        if (point.light < BASE_AMBIENT) {
          point.light = BASE_AMBIENT;
        }
      }
    }

    // 距离衰减
    const attenuation = 1 / (point.dir * 0.001 + 1);
    point.light *= attenuation;

    // 最终保底：确保衰减后仍有基础亮度
    if (point.light < BASE_AMBIENT * 0.8) {
      point.light = BASE_AMBIENT * 0.8;
    }
  }


  calculateNormal() {
    // ========== 配置 ==========
    const OCCLUSION_DECAY_RATE = 8;     // 指数衰减速率 (每 cm)
    const MIN_LIGHT_THRESHOLD = 0.1;    // 亮度阈值，低于此值尾截
    const SURFACE_DEPTH_THRESHOLD = 0.01; // 同平面深度阈值 (cm)

    // 遍历每个网格单元
    for (let i = 0; i < this.grid.length; i++) {
      for (let j = 0; j < this.grid[i].length; j++) {
        const points = this.grid[i][j];
        if (points.length < 3) continue;

        // ========== 朴素同平面判别算法（保留） ==========
        // 1. 检查前3个点是否深度相近
        const firstDis = points[0].dis;
        let avg = (points[0].dis + points[1].dis + points[2].dis) / 3;

        if (Math.abs(avg - firstDis) > SURFACE_DEPTH_THRESHOLD) {
          // 前3个点深度差异大：非共面，应用连续衰减
          for (let k = points.length - 1; k >= 1; k--) {
            const p = points[k];

            // 保护特殊点
            const tag = p.tag;
            if (tag === 'LOCAL_GRID' || tag === 'LOCAL_GRID_DASH' ||
              tag === 'GRID_LINE' || tag === 'LIGHT_SOURCE' || tag === 'CONTROL' ||
              p.isAttractable || p.isObjectCenter) {
              continue;
            }

            // 连续指数衰减
            const depthDiff = p.dis - firstDis;
            const attenuation = Math.exp(-OCCLUSION_DECAY_RATE * depthDiff);
            p.light *= attenuation;

            // 尾截
            if (p.light < MIN_LIGHT_THRESHOLD) {
              points.splice(k, 1);
            }
          }
          continue;
        }

        // 2. 向后扩展，直到深度差超过阈值
        let surfaceEnd = 2;
        for (let k = 3; k < points.length; k++) {
          const newAvg = (avg * k + points[k].dis) / (k + 1);
          if (Math.abs(newAvg - firstDis) <= SURFACE_DEPTH_THRESHOLD) {
            surfaceEnd = k;
            avg = newAvg;
          } else {
            break;
          }
        }

        // 3. 检查 XY 分布是否足够广（判断是否真正构成平面）
        //    如果同深度的点只集中在很小的屏幕区域，可能只是巧合重叠
        let xmin = Infinity, xmax = -Infinity;
        let ymin = Infinity, ymax = -Infinity;
        for (let k = 0; k <= surfaceEnd; k++) {
          const px = points[k].xM;
          const py = points[k].yM;
          if (px < xmin) xmin = px;
          if (px > xmax) xmax = px;
          if (py < ymin) ymin = py;
          if (py > ymax) ymax = py;
        }

        // 只有当 XY 跨度足够大（至少 2 像素）时才赋法向量
        const hasXYSpread = (xmax - xmin >= 2) || (ymax - ymin >= 2);

        // 4. 对表面点（0 ~ surfaceEnd）赋法向量（仅当 XY 分布足够广时）
        if (hasXYSpread) {
          for (let k = 0; k <= surfaceEnd; k++) {
            const p = points[k];
            const tag = p.tag;
            if (tag === 'GRID_LINE' || tag === 'LIGHT_SOURCE' || tag === 'CONTROL' ||
              tag === 'LOCAL_GRID' || tag === 'LOCAL_GRID_DASH') {
              continue;
            }

            if (p.nx === 0 && p.ny === 0 && p.nz === 0) {
              p.nx = -this.direction.x;
              p.ny = -this.direction.y;
              p.nz = -this.direction.z;
            }
          }
        }

        // 4. 对被遮挡的点（surfaceEnd+1 ~ 末尾）应用连续衰减和尾截
        for (let k = points.length - 1; k > surfaceEnd; k--) {
          const p = points[k];

          // 保护特殊点
          const tag = p.tag;
          if (tag === 'LOCAL_GRID' || tag === 'LOCAL_GRID_DASH' ||
            tag === 'GRID_LINE' || tag === 'LIGHT_SOURCE' || tag === 'CONTROL' ||
            p.isAttractable || p.isObjectCenter) {
            continue;
          }

          // 连续指数衰减
          const depthDiff = p.dis - firstDis;
          const attenuation = Math.exp(-OCCLUSION_DECAY_RATE * depthDiff);
          p.light *= attenuation;

          // 尾截
          if (p.light < MIN_LIGHT_THRESHOLD) {
            points.splice(k, 1);
            continue;
          }

          // 赋法向量
          if (p.nx === 0 && p.ny === 0 && p.nz === 0) {
            p.nx = -this.direction.x;
            p.ny = -this.direction.y;
            p.nz = -this.direction.z;
          }
        }
      }
    }
  }

  // ==========================================================================
  // 吸附查找（阶段9新增）
  // ==========================================================================

  /**
   * 查找屏幕坐标附近最近的可吸附点 (虚拟鼠标核心逻辑)
   * 迁移自 main.js findNearestAttractableExpanding
   * @param {number} screenX - 屏幕 X 坐标
   * @param {number} screenY - 屏幕 Y 坐标
   * @param {number} searchRadius - 初始搜索半径（像素）
   * @param {function} filterCallback - (可选) 过滤回调，返回 false 则跳过该点
   * @returns {Point|null} 最近点
   */
  findNearestPoint(screenX, screenY, searchRadius = 0, filterCallback = null) {
    if (!this.grid || this.grid.length === 0) return null;

    const gridWidth = this.grid.length;
    const gridHeight = this.grid[0]?.length || 0;
    if (gridWidth === 0 || gridHeight === 0) return null;

    // 计算鼠标所在的 grid cell
    const centerGx = Math.floor(screenX / this.gridsize);
    const centerGy = Math.floor(screenY / this.gridsize);

    // 如果未指定半径，默认搜索整个 grid（或直到找到）
    // 但为了性能，仍采用分层扩展方式

    // 最大搜索半径（网格单位）
    const maxRange = Math.max(
      Math.max(centerGx, gridWidth - 1 - centerGx),
      Math.max(centerGy, gridHeight - 1 - centerGy)
    ) + 1;

    let nearest = null;
    let minDistSq = Infinity;

    // 逐层向外扩展搜索
    for (let range = 0; range <= maxRange; range++) {
      let foundInThisLayer = false;

      // 搜索当前层的边界格子
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          // 只搜索边界（跳过内部已搜索过的）
          if (range > 0 && Math.abs(dx) < range && Math.abs(dy) < range) continue;

          const gx = centerGx + dx;
          const gy = centerGy + dy;

          // 边界检查
          if (gx < 0 || gx >= gridWidth) continue;
          if (gy < 0 || gy >= gridHeight) continue;

          // 遍历该格子内的所有点
          const cell = this.grid[gx][gy];
          if (!cell || cell.length === 0) continue;

          for (const p of cell) {
            // 基础检查：必须是可吸附点
            if (!p.isAttractable) continue;

            // 外部回调过滤（例如排除正在拖拽的物体，或只吸附特定类型）
            if (filterCallback && !filterCallback(p)) continue;

            const dxPx = p.xM - screenX;
            const dyPx = p.yM - screenY;
            const distSq = dxPx * dxPx + dyPx * dyPx;

            // 找到更近的点
            if (distSq < minDistSq) {
              minDistSq = distSq;
              nearest = p;
              foundInThisLayer = true; // 标记本层已找到
            } else if (distSq === minDistSq) {
              // 平局处理：优先选择物体中心点 (Object Center)
              // 解决 LightSource 中心点与 WorldGrid 格点重合导致无法拖拽的问题
              if (p.isObjectCenter) {
                nearest = p;
                foundInThisLayer = true;
              }
            }
          }
        }
      }

      // 优化：如果在本层找到了点，
      // 且最近距离小于下一层的最小可能距离（下一层最近也是 (range+1)*gridSize - 0.5*gridSize ？）
      // 简单起见：一旦在某层找到，就不再搜索更外层。
      // 注意：这可能在边界处不完全精确（如最近点其实在下一层刚开始的地方），
      // 但对于虚拟鼠标的吸附体验早已足够。
      if (foundInThisLayer) {
        // Double check: is there any possibility that next layer has closer point?
        // Next layer min distance approx: (range * gridSize + 1 pixel)
        // If current minDist < (range * gridSize)^2, we are safe to stop.
        // 实际上 grid 搜索的层级逻辑保证了大致的由近及远。
        break;
      }
    }

    return nearest;
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

  // ==========================================================================
  // Virtual Cursor 统一出口（阶段1新增：显式化）
  // ==========================================================================
  /**
   * 虚拟鼠标系统的统一访问点
   * 仅作为"数据转发",不包含任何判断逻辑或编辑语义
   * 
   * 职责:
   * - 暴露吸附点的世界坐标（纯数学）
   * - 暴露吸附点的法向量（纯数学）
   * - 不理解EDIT/FOCUS/控制点等概念
   */
  get virtualCursor() {
    const self = this;

    return {
      /**
       * 活动点的世界坐标
       * @returns {{x, y, z} | null}
       */
      get activePoint() {
        if (self._cachedSnappedPoint && self._cachedSnappedPoint.x !== undefined) {
          return {
            x: self._cachedSnappedPoint.x,
            y: self._cachedSnappedPoint.y,
            z: self._cachedSnappedPoint.z
          };
        }
        return null;
      },

      /**
       * 活动点的法向量
       * @returns {{x, y, z} | null}
       */
      get activeNormal() {
        if (self._cachedSnappedPoint && self._cachedSnappedPoint.nx !== undefined) {
          return {
            x: self._cachedSnappedPoint.nx || 0,
            y: self._cachedSnappedPoint.ny || 0,
            z: self._cachedSnappedPoint.nz || 0
          };
        }
        // 默认:视线反方向
        if (self.direction) {
          return {
            x: -self.direction.x,
            y: -self.direction.y,
            z: -self.direction.z
          };
        }
        return { x: 0, y: 0, z: 1 };
      },

      /**
       * 设置当前吸附点(供main.js调用)
       */
      setSnappedPoint(point) {
        self._cachedSnappedPoint = point;
      }
    };
  }
}
