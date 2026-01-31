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
    physicsMode: 'PERFORMANCE',
    // 物理调试日志
    physicsDebug: true,
    // 默认物理模型：'pbd' (Position-Based Dynamics) | 'force' (质点弹簧)
    defaultPhysicsModel: 'force',

    // ========== Phase 4: 物理显示配置 ==========
    physicsDisplay: {
        // ━━━ FOCUS 态 ━━━
        // 进入 FOCUS 是否立即激活物理显示（而不等待点击）
        activateOnFocusEnter: true,

        // 物理静止后是否自动恢复固有显示 (displayPoints)
        revertOnSettle: false,

        // 静止判定帧数阈值（需运动超过此帧数后才进行静止检测）
        settleFrameThreshold: 60,

        // 静止判定速度阈值 (cm/s)²
        settleVelocityThreshold: 0.0001,

        // ━━━ EDIT 态 ━━━
        // 保持物理显示（即使进入编辑态）
        keepPhysicsInEdit: false,

        // 启用 COM 平移分离（修正物理漂移）
        enableCOMTranslation: false,
    },

    // ========== Phase 9: 物理核心参数 ==========
    physicsParams: {
        force: {
            // 弹簧刚度 (Stiffness)：控制物体硬度
            // 20 ~ 100 适合软体，1000+ 适合硬体
            stiffness: 2,

            // 弹簧阻尼 (Damping)：控制震荡衰减
            // 0.05 适合欠阻尼（Q弹），0.5+ 适合过阻尼（肉）
            damping: 0.02,

            // 全局速度衰减 (Global Velocity Decay)：Verlet 积分的隐式阻尼
            // 1.0 = 无衰减，0.98 = 强衰减。设为 0.999 以保持长时间震荡
            globalDamping: 0.995,

            // 空气阻力 (Air Damping)：Force based 全局阻力
            airDamping: 0.01,

            // 交互冲量 (Impulse)：点击时的力度
            impulseScale: 300.0
        },

        // 系统运行参数
        system: {
            maxDisplacement: 5.0, // 单帧最大位移限制 (cm)，防爆炸
            fixedTimeStep: 1 / 60, // 固定物理步长 (秒)
            maxStepsPerFrame: 5,   // 单帧最大物理步数（防卡死）
            substeps: 10           // Verelt 积分及约束求解子步数
        }
    },
};
