// main.js
import { Engine } from './core/Engine.js';
import { InputManager } from './input/InputManager.js';
import { CanvasRenderer } from './render/CanvasRenderer.js';
import { ProjectionSurface } from './display/ProjectionSurface.js';
import { Camera } from './camera/Camera.js';
import { PointCloud } from './scene/PointCloud.js';
import { Point } from './scene/Point.js';
import { PointLoader } from './utils/PointLoader.js';

async function main() {
    const engine = new Engine();
    engine.renderer = new CanvasRenderer();
    engine.input = new InputManager();
    engine.projectionSurface = new ProjectionSurface(window.innerWidth, window.innerHeight);

    const mainCamera = new Camera();
    engine.projectionSurface.addView(mainCamera);

    // 创建默认点云
    const defaultPoints = PointLoader.createDefaultPoints(1000);
    const cloud = new PointCloud();
    for (const p of defaultPoints) {
        cloud.addPoint(new Point(p.x, p.y, p.z));
    }
    engine.pointClouds.push(cloud);

    // 渲染任务
    class RenderTask {
        execute(ctx) {
            ctx.engine.renderer.clear();
            const projected = ctx.engine.projectionSurface.projectPoints(ctx.pointClouds[0]);
            ctx.engine.renderer.renderPoints(projected, ctx.pointClouds[0].points.length);
        }
    }

    // 输入任务
    class InputTask {
        execute(ctx) {
            const cam = ctx.engine.projectionSurface.views[0];
            const speed = 0.2;
            if (ctx.input.isKeyDown('ArrowLeft')) cam.position.x -= speed;
            if (ctx.input.isKeyDown('ArrowRight')) cam.position.x += speed;
            if (ctx.input.isKeyDown('ArrowUp')) cam.position.y += speed;
            if (ctx.input.isKeyDown('ArrowDown')) cam.position.y -= speed;
            if (ctx.input.isKeyDown('PageUp')) cam.position.z -= speed;
            if (ctx.input.isKeyDown('PageDown')) cam.position.z += speed;
        }
    }

    engine.enqueueNextFrame(new RenderTask());
    engine.enqueueNextFrame(new InputTask());
    engine.start();

    // 添加文件导入按钮
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.xyz,.pts';
    fileInput.style.cssText = `
        position: absolute; bottom: 10px; left: 10px; z-index: 20;
        background: rgba(255,255,255,0.8); padding: 5px;
    `;
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const points = await PointLoader.loadFromFile(file);
        const newCloud = new PointCloud();
        for (const p of points) {
            newCloud.addPoint(new Point(p.x, p.y, p.z));
        }
        engine.pointClouds[0] = newCloud; // 替换
        console.log(`Loaded ${points.length} points`);
    };
    document.body.appendChild(fileInput);

    const label = document.createElement('label');
    label.textContent = '📁 Load Point Cloud';
    label.style.cssText = `
        position: absolute; bottom: 10px; left: 120px; z-index: 20;
        background: rgba(255,255,255,0.8); padding: 5px; cursor: pointer;
    `;
    label.onclick = () => fileInput.click();
    document.body.appendChild(label);
}

main().catch(console.error);