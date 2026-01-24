/**
 * StyleImpl - 样式实现类
 * 管理颜色 LUT 和样式标签
 * 
 * 阶段 3A: LUT 迁移
 * 阶段 3B: 标签系统
 */
export class StyleImpl {
    // ========== 核心色定义（禁止修改）==========
    static CORE_COLORS = {
        STEREO_LEFT: { h: 0, s: 100 },  // 红
        STEREO_RIGHT: { h: 240, s: 100 },  // 蓝
        MONO: { h: 285, s: 90 }   // 紫
    };

    // ========== 亮度范围 ==========
    static BRIGHTNESS = {
        STEREO_LEFT: { base: 35, maxIndex: 350 },
        STEREO_RIGHT: { base: 50, maxIndex: 500 },
        MONO: { base: 50, maxIndex: 500 }
    };

    // ========== 立体模式配置 ==========
    static get STEREO_CONFIG() {
        return {
            '3D_LR': {
                left: { colorType: 'red', base: this.BRIGHTNESS.STEREO_LEFT.base, maxIndex: this.BRIGHTNESS.STEREO_LEFT.maxIndex },
                right: { colorType: 'blue', base: this.BRIGHTNESS.STEREO_RIGHT.base, maxIndex: this.BRIGHTNESS.STEREO_RIGHT.maxIndex }
            },
            '3D_RL': {
                left: { colorType: 'blue', base: this.BRIGHTNESS.STEREO_RIGHT.base, maxIndex: this.BRIGHTNESS.STEREO_RIGHT.maxIndex },
                right: { colorType: 'red', base: this.BRIGHTNESS.STEREO_LEFT.base, maxIndex: this.BRIGHTNESS.STEREO_LEFT.maxIndex }
            }
        };
    }

    // ========== 邻接点阈值 ==========
    static NEIGHBOR_THRESHOLDS = {
        high: 0.6,
        low: 0.3
    };

    // LUT 缓存
    static _lut = null;

    // LUT 索引因子（用于将亮度转换为索引）
    static LUT_FACTOR = 10;

    /**
     * 获取颜色 LUT
     * @returns {Object} { red: [], blue: [], purple: [] }
     */
    static getLUT() {
        if (!this._lut) {
            this._lut = this._generateLUT();
        }
        return this._lut;
    }

    /**
     * HSL 转 RGB
     * @private
     */
    static _hslToRgb(h, s, l) {
        s /= 100;
        l /= 100;
        const k = (n) => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n) =>
            l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [
            Math.round(f(0) * 255),
            Math.round(f(8) * 255),
            Math.round(f(4) * 255),
        ];
    }

    /**
     * 生成颜色 LUT
     * @private
     */
    static _generateLUT() {
        const factor = this.LUT_FACTOR;
        // LUT 尺寸直接使用 maxIndex + 1
        const sizeRed = this.BRIGHTNESS.STEREO_LEFT.maxIndex + 1;
        const sizeBluePurple = this.BRIGHTNESS.STEREO_RIGHT.maxIndex + 1;

        const lut = {
            red: new Array(sizeRed),
            blue: new Array(sizeBluePurple),
            purple: new Array(sizeBluePurple),
        };

        // 红色
        const redColor = this.CORE_COLORS.STEREO_LEFT;
        for (let i = 0; i < sizeRed; i++) {
            lut.red[i] = this._hslToRgb(redColor.h, redColor.s, i / factor);
        }

        // 蓝色
        const blueColor = this.CORE_COLORS.STEREO_RIGHT;
        for (let i = 0; i < sizeBluePurple; i++) {
            lut.blue[i] = this._hslToRgb(blueColor.h, blueColor.s, i / factor);
        }

        // 紫色
        const purpleColor = this.CORE_COLORS.MONO;
        for (let i = 0; i < sizeBluePurple; i++) {
            lut.purple[i] = this._hslToRgb(purpleColor.h, purpleColor.s, i / factor);
        }

        return lut;
    }

    // ========== 阶段 3B：标签系统 ==========

    /**
     * 标签配置
     * colorMode: 'stereo' | 'mono' - 立体/单色模式
     * lightAffected: boolean - 是否受光照影响
     * fixedLight: number - 固定亮度值（lightAffected=false 时使用）
     * brightnessMultiplier: number - 亮度乘数（可选）
     * neighborRule: 'standard' | 'none' | 'glow' - 邻接点规则
     * monoKey: string - 单色模式的颜色键名（可选）
     * glowRadius: number - 发光半径（neighborRule='glow' 时使用）
     */
    static TAGS = {
        // 表面点：正常立体渲染，受光照影响
        SURFACE: {
            colorMode: 'stereo',
            lightAffected: true,
            neighborRule: 'standard'
        },
        // 暗化点：立体渲染，固定低亮度
        DIMMED: {
            colorMode: 'stereo',
            lightAffected: false,
            fixedLight: 0.05,
            brightnessMultiplier: 0.05,
            neighborRule: 'none'
        },
        // 网格线：单色（紫），固定中亮度
        GRID_LINE: {
            colorMode: 'mono',
            monoKey: 'purple',
            lightAffected: false,
            fixedLight: 0.5,
            neighborRule: 'none'
        },
        // 控制点：立体高亮，使用发光效果
        CONTROL: {
            colorMode: 'stereo',
            lightAffected: false,
            fixedLight: 1.0,
            neighborRule: 'glow',
            glowRadius: 3
        },
        // 光源：超亮显示，不受光照影响
        LIGHT_SOURCE: {
            colorMode: 'stereo',
            lightAffected: false,
            fixedLight: 3.0, // 更亮以确保光源显眼
            neighborRule: 'glow',
            glowRadius: 3
        },
        // 局部格网格点：立体渲染，使用动态设置的 light 值
        LOCAL_GRID: {
            colorMode: 'stereo',
            lightAffected: true,  // 使用点的 light 属性
            neighborRule: 'none'
        },
        // 局部格网虚线点：立体渲染，使用动态设置的 light 值
        LOCAL_GRID_DASH: {
            colorMode: 'stereo',
            lightAffected: true,  // 使用点的 light 属性
            neighborRule: 'none'
        }
    };

    /**
     * 获取标签配置
     * @param {string} tag - 标签名称
     * @returns {Object} 标签配置，若不存在返回 SURFACE 配置
     */
    static getTagConfig(tag) {
        return this.TAGS[tag] || this.TAGS.SURFACE;
    }

    /**
     * 解析点的渲染样式
     * @param {Object} context - 渲染上下文
     * @param {string} context.tag - 点标签
     * @param {number} context.light - 光照强度 (0-1)
     * @param {string} context.displayMode - 显示模式 ('3D_LR'|'3D_RL'|'2D')
     * @param {boolean} context.hasDisparity - 是否有视差
     * @returns {Object} ResolvedStyle
     */
    static resolvePointStyle(context) {
        const { tag, light, displayMode, hasDisparity } = context;
        const tagConfig = this.getTagConfig(tag);
        const is3D = displayMode !== '2D';

        // 计算有效亮度
        let effectiveLight = tagConfig.lightAffected ? light : (tagConfig.fixedLight ?? 1.0);
        if (tagConfig.brightnessMultiplier !== undefined) {
            effectiveLight *= tagConfig.brightnessMultiplier;
        }

        // 计算邻接渲染半径
        let neighborRadius = 0;
        if (tagConfig.neighborRule === 'standard') {
            neighborRadius = 1;
        } else if (tagConfig.neighborRule === 'glow') {
            neighborRadius = tagConfig.glowRadius || 2;
        }

        // 立体配置
        const stereoConfig = this.STEREO_CONFIG[displayMode] || this.STEREO_CONFIG['3D_LR'];

        // 单色配置
        const monoConfig = {
            colorType: tagConfig.monoKey || 'purple',
            base: this.BRIGHTNESS.MONO.base,
            maxIndex: this.BRIGHTNESS.MONO.maxIndex
        };

        return {
            is3D,
            hasDisparity: is3D && hasDisparity,
            left: stereoConfig.left,
            right: stereoConfig.right,
            mono: monoConfig,
            neighborRadius,
            effectiveLight,
            tagConfig
        };
    }
}
