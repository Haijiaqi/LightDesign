import { Object } from "../base/Object.js";
import { Window } from "../base/Window.js";

/**
 * World - 场景管理器（预留）
 * TODO: 未来用于多场景管理、场景切换等功能
 */
export class World {
  constructor(objects = [], windows = []) {
    this.objects = objects;
    this.windows = windows;
    this.screen = new Window();
  }

  calc() {
    // TODO: 实现场景计算逻辑
  }
}
