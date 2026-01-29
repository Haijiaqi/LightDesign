export const CONFIG = {
    screenXLengthCm: 31.0,
    screenYLengthCm: 17.4,
    screenWidth: 1920,
    screenHeight: 1080,
    eyeD: 6.3,
    displayMode: '3D_LR',
    userEyeHeight: 8.7,
    screenCenterHeight: 0,
    userDistanceFromOrigin: 10,
    screenDistance: 50,
    lightX: 10,
    lightY: 30,
    lightZ: 0,
    spherePoints: 1000,
    cubePoints: 250,
    rotationSpeed: 0.05,
    moveSpeed: 0.5,
    minElevation: -Math.PI / 2 + 0.1,
    maxElevation: Math.PI / 2 - 0.1,
    dragRotationSpeed: 0.01,
    normalEstimationIterations: 2000, // 增加法向量估算密度
    normalEstimationRadius: 15,
    cameraControl: {
        enabled: false,
        sensitivity: 0.005,
        targetHue: 0,
        targetHueTolerance: 30,
        targetSaturation: 0.7,
        targetValue: 0.5,
        minArea: 50,
        maxArea: 10000,
        smoothingFactor: 0.1,
    },

    // ========== Phase 3: 物理系统配置 ==========
    // 物理渲染开关：false 时回落到原渲染路径
    usePhysicsRendering: true,
    // 物理模式：'OFF' | 'PERFORMANCE' | 'QUALITY'
    physicsMode: 'QUALITY',
    // 物理调试日志
    physicsDebug: true,
    // 默认物理模型：'pbd' (Position-Based Dynamics) | 'force' (质点弹簧)
    defaultPhysicsModel: 'force',
};
