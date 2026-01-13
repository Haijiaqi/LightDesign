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

    // ========== 亮度范围（禁止修改）==========
    static BRIGHTNESS = {
        STEREO_LEFT: { base: 35, max: 35 },
        STEREO_RIGHT: { base: 50, max: 50 },
        MONO: { base: 50, max: 50 }
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
        const maxBrightnessRed = this.BRIGHTNESS.STEREO_LEFT.max;
        const maxBrightnessBluePurple = this.BRIGHTNESS.STEREO_RIGHT.max;

        const sizeRed = Math.round(maxBrightnessRed * factor) + 1;
        const sizeBluePurple = Math.round(maxBrightnessBluePurple * factor) + 1;

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
        // 控制点：单色高亮，带发光效果
        CONTROL: {
            colorMode: 'mono',
            monoKey: 'purple',
            lightAffected: false,
            fixedLight: 1.0,
            neighborRule: 'glow',
            glowRadius: 2
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
}
