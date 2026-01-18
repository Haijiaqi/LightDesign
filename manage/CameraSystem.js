import { SystemState, CONFIG } from "./SystemState.js";
import { Classifier } from "../math/Classifier.js";

const C = new Classifier();

// ========================
// 4. 摄像头初始化函数
// ========================
export async function initCamera() {
    if (!CONFIG.cameraControl.enabled) {
        console.log("摄像头控制未启用，跳过初始化。");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        SystemState.video = document.createElement("video");
        SystemState.video.srcObject = stream;
        SystemState.video.play();
        SystemState.video.style.display = "none"; // 隐藏视频元素
        document.body.appendChild(SystemState.video);

        // 创建用于处理视频帧的 canvas
        SystemState.videoCanvas = document.createElement("canvas");
        SystemState.videoCtx = SystemState.videoCanvas.getContext("2d");

        SystemState.cameraActive = true;
        console.log("摄像头初始化成功。");
    } catch (err) {
        console.error("无法访问摄像头:", err);
        SystemState.debugDiv.textContent = `摄像头错误: ${err.message || err}`;
        CONFIG.cameraControl.enabled = false; // 禁用摄像头控制
    }
}

// ========================
// 5. 摄像头识别处理函数
// ========================
export function processCamera() {
    console.group("=== processCamera 开始 ==="); // 开始一个日志组，方便折叠查看

    // 1. 检查摄像头是否已激活且配置允许处理
    if (!SystemState.cameraActive) {
        console.log(
            "摄像头未激活，跳过处理。SystemState.cameraActive =",
            SystemState.cameraActive,
        );
        console.groupEnd(); // 结束日志组
        return;
    }
    if (!CONFIG.cameraControl.enabled) {
        console.log(
            "摄像头控制在配置中被禁用，跳过处理。CONFIG.cameraControl.enabled =",
            CONFIG.cameraControl.enabled,
        );
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("摄像头已激活且控制已启用，继续处理。");

    // 2. 控制处理频率
    const now = Date.now();
    // console.log("当前时间戳:", now, "上次处理时间戳:", SystemState.lastDetectionTime, "间隔阈值:", SystemState.detectionInterval);
    if (now - SystemState.lastDetectionTime < SystemState.detectionInterval) {
        // console.log("未到处理间隔，跳过本次处理。距离下次处理还需:", (SystemState.detectionInterval - (now - SystemState.lastDetectionTime)), "ms");
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("已到达处理间隔，开始处理视频帧。");
    SystemState.lastDetectionTime = now;

    // 3. 获取视频和处理用的 Canvas 上下文
    const video = SystemState.video;
    const canvas = SystemState.videoCanvas;
    const ctx = SystemState.videoCtx;

    // 4. 检查视频是否准备好
    // console.log("视频 readyState:", video.readyState, " (0: HAVE_NOTHING, 1: HAVE_METADATA, 2: HAVE_CURRENT_DATA, 3: HAVE_FUTURE_DATA, 4: HAVE_ENOUGH_DATA)");
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        console.warn("视频数据不足，无法处理。");
        console.groupEnd(); // 结束日志组
        return;
    }
    // console.log("视频数据充足，准备处理。");

    // 5. 设置处理 Canvas 的尺寸
    // console.log("视频原始尺寸: 宽", video.videoWidth, "高", video.videoHeight);
    canvas.width = video.videoWidth / 8;
    canvas.height = video.videoHeight / 8;
    // console.log("设置处理 Canvas 尺寸: 宽", canvas.width, "高", canvas.height);

    // 6. 将视频帧绘制到 Canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // console.log("已将视频帧绘制到处理 Canvas。");

    // 7. 获取像素数据
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    // console.log("获取到 ImageData，总像素数:", data.length / 4);
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

    // updateCameraDisplay(res);
    console.groupEnd(); // 结束日志组
    console.log("--- processCamera 结束 ---\n"); // 结束标记，增加空行便于阅读
}

function processQueue(dataList, num, maxLength = 5, tol = 0.1) {
    // 1. 入队并控制最大长度
    dataList.push(num);
    if (dataList.length > maxLength) {
        dataList.shift(); // 移除最旧的元素 (头部移除，O(n) 操作，但队列短所以影响小)
        // 如果 maxLength 非常大，可以考虑用循环数组优化 shift，但通常不必要。
    }

    // 2. 计算当前队列的初始平均值 (O(n))
    let sum = 0;
    const len = dataList.length;
    for (const val of dataList) {
        sum += val;
    }
    const avg = len > 0 ? sum / len : 0;

    // 3. 原地筛选元素 (O(n))
    // 使用 writeIndex 指针，将符合条件的元素依次放回数组前面
    let writeIndex = 0;
    let newSum = 0;
    const lastOriginalIndex = dataList.length - 1; // 新添加元素在筛选前的索引

    for (let i = 0; i < dataList.length; i++) {
        const val = dataList[i];
        let valid = false;

        if (avg === 0) {
            // 平均值为0时，使用绝对偏差判断
            valid = Math.abs(val) <= tol;
        } else {
            // 平均值非0时，使用相对偏差判断
            const diffRatio = Math.abs(val - avg) / Math.abs(avg);
            // 对最新添加的元素，使用更宽松的容差 (2 * tol)
            valid = i === lastOriginalIndex ? diffRatio <= 2 * tol : diffRatio <= tol;
        }

        if (valid) {
            dataList[writeIndex] = val; // 将有效元素写入新位置
            newSum += val;
            writeIndex++; // 移动写指针
        }
    }

    // 4. 截断数组到有效部分 (O(1))
    dataList.length = writeIndex;

    // 5. 返回筛选后数组的平均值
    return writeIndex > 0 ? newSum / writeIndex : 0;
}

// --- 1. 初始化摄像头显示画布 (通常在 initCamera 或 init 时调用一次) ---
/**
 * 初始化摄像头显示画布，居中显示且支持尺寸调整
 * @param {number} scale - 尺寸缩放比例（0~1，1=原始尺寸，0.5=半尺寸，默认0.8）
 */
export function initCameraDisplay(scale = 0.5) {
    // 创建或替换画布
    if (SystemState.videoDisplayCanvas) {
        SystemState.videoDisplayCanvas.remove();
    }
    SystemState.videoDisplayCanvas = document.createElement("canvas");
    SystemState.videoDisplayCtx = SystemState.videoDisplayCanvas.getContext("2d");

    // 获取视频原始尺寸（默认640x480）
    const videoWidth = SystemState.video?.videoWidth || 640;
    const videoHeight = SystemState.video?.videoHeight || 480;

    // 按比例调整尺寸（支持大小调节）
    const displayWidth = Math.round(videoWidth * scale);
    const displayHeight = Math.round(videoHeight * scale);
    SystemState.videoDisplayCanvas.width = displayWidth;
    SystemState.videoDisplayCanvas.height = displayHeight;

    // 添加到页面并设置居中样式
    document.body.appendChild(SystemState.videoDisplayCanvas);
    const style = SystemState.videoDisplayCanvas.style;
    style.position = "fixed"; // 固定定位，相对于视口居中
    style.top = "50%";
    style.left = "50%";
    // 通过transform平移实现精确居中（基于自身尺寸的一半）
    style.transform = "translate(-50%, -50%)";
    style.zIndex = "1"; // 控制层级
    style.border = "2px solid #fff"; // 可选：添加边框便于区分
    style.boxShadow = "0 0 10px rgba(0,0,0,0.3)"; // 可选：添加阴影提升视觉效果

    console.log(
        `摄像头显示画布初始化完成。尺寸: ${displayWidth}x${displayHeight}，缩放比例: ${scale}`,
    );
    return true;
}

// --- 2. 更新摄像头显示画布内容 (在 processCamera 或渲染循环中调用) ---
export function updateCameraDisplay(test) {
    C.updateCameraDisplay(SystemState, test);
}

// --- 3. 将摄像头画面绘制到主渲染画布 (在 render 函数中调用) ---
export function drawCameraFeedOnMainCanvas(
    ctx,
    x = 0,
    y = 0,
    width = 200,
    height = 150,
    opacity = 0.5,
) {
    // 可调整位置、大小和透明度
    if (!SystemState.videoDisplayCanvas) {
        // console.warn("摄像头显示画布不存在，无法绘制。");
        return;
    }

    // 保存当前绘图状态
    ctx.save();

    // 设置透明度
    ctx.globalAlpha = opacity;

    // 绘制摄像头画面到主画布的指定位置和大小
    ctx.drawImage(SystemState.videoDisplayCanvas, x, y, width, height);

    // 恢复绘图状态
    ctx.restore();
}
