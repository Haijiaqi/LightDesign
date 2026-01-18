import { SystemState, CONFIG } from "./SystemState.js";
import { Classifier } from "../math/Classifier.js";

const C = new Classifier();

async function initCamera() {
    if (!CONFIG.cameraControl.enabled) {
        console.log("摄像头控制未启用，跳过初始化。");
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        SystemState.video = document.createElement("video");
        SystemState.video.srcObject = stream;
        SystemState.video.play();
        SystemState.video.style.display = "none";
        document.body.appendChild(SystemState.video);
        SystemState.videoCanvas = document.createElement("canvas");
        SystemState.videoCtx = SystemState.videoCanvas.getContext("2d");
        SystemState.cameraActive = true;
        console.log("摄像头初始化成功。");
    } catch (err) {
        console.error("无法访问摄像头:", err);
        SystemState.debugDiv.textContent = `摄像头错误: ${err.message || err}`;
        CONFIG.cameraControl.enabled = false;
    }
}

function processCamera() {
    console.group("=== processCamera 开始 ===");
    if (!SystemState.cameraActive) {
        console.log(
            "摄像头未激活，跳过处理。SystemState.cameraActive =",
            SystemState.cameraActive,
        );
        console.groupEnd();
        return;
    }
    if (!CONFIG.cameraControl.enabled) {
        console.log(
            "摄像头控制在配置中被禁用，跳过处理。CONFIG.cameraControl.enabled =",
            CONFIG.cameraControl.enabled,
        );
        console.groupEnd();
        return;
    }
    const now = Date.now();
    if (now - SystemState.lastDetectionTime < SystemState.detectionInterval) {
        console.groupEnd();
        return;
    }
    SystemState.lastDetectionTime = now;
    const video = SystemState.video;
    const canvas = SystemState.videoCanvas;
    const ctx = SystemState.videoCtx;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        console.warn("视频数据不足，无法处理。");
        console.groupEnd();
        return;
    }
    canvas.width = video.videoWidth / 8;
    canvas.height = video.videoHeight / 8;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const res = C.processImageFromCamera(data, canvas.width, canvas.height);
    if (res && res.estimateDis && res.headHeight && res.headX) {
        const headDis = processQueue(
            SystemState.smoothingListDis,
            res.estimateDis,
            3,
            0.4,
        );
        let headHeight = processQueue(
            SystemState.smoothingListHeight,
            res.headHeight,
            3,
            0.4,
        );
        let headX = processQueue(SystemState.smoothingListX, res.headX, 3, 0.4);
        headHeight =
            ((0.5 - headHeight) / 0.5 / 1.732) * headDis +
            SystemState.mainWindow.ylength / 2;
        if (Math.abs(headX - 0.5) > 0.25) {
            headX = 0;
        } else {
            headX = ((0.5 - headX) / 0.25 / 1.732) * headDis;
        }
        SystemState.mainWindow.headMoveTo(-headDis, headHeight, headX);
        SystemState.ifControl = true;
    }
    console.groupEnd();
    console.log("--- processCamera 结束 ---\n");
}

function processQueue(dataList, num, maxLength = 5, tol = 0.1) {
    dataList.push(num);
    if (dataList.length > maxLength) {
        dataList.shift();
    }
    let sum = 0;
    const len = dataList.length;
    for (const val of dataList) {
        sum += val;
    }
    const avg = len > 0 ? sum / len : 0;
    let writeIndex = 0;
    let newSum = 0;
    const lastOriginalIndex = dataList.length - 1;
    for (let i = 0; i < dataList.length; i++) {
        const val = dataList[i];
        let valid = false;
        if (avg === 0) {
            valid = Math.abs(val) <= tol;
        } else {
            const diffRatio = Math.abs(val - avg) / Math.abs(avg);
            valid = i === lastOriginalIndex ? diffRatio <= 2 * tol : diffRatio <= tol;
        }
        if (valid) {
            dataList[writeIndex] = val;
            newSum += val;
            writeIndex++;
        }
    }
    dataList.length = writeIndex;
    return writeIndex > 0 ? newSum / writeIndex : 0;
}

function initCameraDisplay(scale = 0.5) {
    if (SystemState.videoDisplayCanvas) {
        SystemState.videoDisplayCanvas.remove();
    }
    SystemState.videoDisplayCanvas = document.createElement("canvas");
    SystemState.videoDisplayCtx = SystemState.videoDisplayCanvas.getContext("2d");
    const videoWidth = SystemState.video?.videoWidth || 640;
    const videoHeight = SystemState.video?.videoHeight || 480;
    const displayWidth = Math.round(videoWidth * scale);
    const displayHeight = Math.round(videoHeight * scale);
    SystemState.videoDisplayCanvas.width = displayWidth;
    SystemState.videoDisplayCanvas.height = displayHeight;
    document.body.appendChild(SystemState.videoDisplayCanvas);
    const style = SystemState.videoDisplayCanvas.style;
    style.position = "fixed";
    style.top = "50%";
    style.left = "50%";
    style.transform = "translate(-50%, -50%)";
    style.zIndex = "1";
    style.border = "2px solid #fff";
    style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
    console.log(
        `摄像头显示画布初始化完成。尺寸: ${displayWidth}x${displayHeight}，缩放比例: ${scale}`,
    );
    return true;
}

function updateCameraDisplay(test) {
    C.updateCameraDisplay(SystemState, test);
}

function drawCameraFeedOnMainCanvas(
    ctx,
    x = 0,
    y = 0,
    width = 200,
    height = 150,
    opacity = 0.5,
) {
    if (!SystemState.videoDisplayCanvas) {
        return;
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(SystemState.videoDisplayCanvas, x, y, width, height);
    ctx.restore();
}

export const CameraSystem = {
    initCamera,
    processCamera,
    processQueue,
    initCameraDisplay,
    updateCameraDisplay,
    drawCameraFeedOnMainCanvas
};
