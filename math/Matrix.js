class Matrix {
  constructor(rows, cols, data = null) {
    this.rows = rows;
    this.cols = cols;
    this.data = data || new Float64Array(rows * cols);
  }

  get(r, c) { return this.data[r + c * this.rows]; }
  set(r, c, v) { this.data[r + c * this.rows] = v; }

  copy() {
    return new Matrix(this.rows, this.cols, new Float64Array(this.data));
  }

  static zeros(r, c) { return new Matrix(r, c); }

  // =================== Householder QR ===================

  static householderQR(A, b = null, options = {}) {
    const m = A.rows, n = A.cols;
    const R = A.copy();
    const Qtb = b ? new Float64Array(b) : null;

    for (let k = 0; k < n; k++) {
      // 计算当前列的范数（从 k 行开始）
      let norm = 0;
      for (let i = k; i < m; i++) {
        const v = R.get(i, k);
        norm += v * v;
      }
      norm = Math.sqrt(norm);
      if (norm < 1e-15) continue; // ⭐ 改进：使用一致的阈值

      // 确定符号，避免精度损失
      const sign = R.get(k, k) >= 0 ? 1 : -1;
      const u1 = R.get(k, k) + sign * norm;
      if (Math.abs(u1) < 1e-15) continue;

      // 构建反射向量
      const v = new Float64Array(m - k);
      v[0] = u1;
      for (let i = k + 1; i < m; i++) v[i - k] = R.get(i, k);

      // 计算 beta = 2/(v^T v)
      let vnorm2 = 0;
      for (let i = 0; i < v.length; i++) vnorm2 += v[i] * v[i];
      if (vnorm2 < 1e-30) continue; // ⭐ 改进：避免除零
      const beta = 2 / vnorm2;

      // ⭐ 修正：应用反射变换到 R 的右侧部分（包括当前列）
      // 注意：应该更新所有列 j >= k，但对于 j = k，
      // 我们知道结果应该是 [r_kk; 0; 0; ...] 其中 r_kk = -sign*norm
      // 为了数值稳定性，我们直接设置而不是通过变换计算
      
      // 先直接设置第 k 列的结果
      R.set(k, k, -sign * norm);
      for (let i = k + 1; i < m; i++) R.set(i, k, 0);

      // 然后应用反射变换到剩余列 (j > k)
      for (let j = k + 1; j < n; j++) {
        let dot = 0;
        for (let i = 0; i < v.length; i++) {
          dot += v[i] * R.get(k + i, j);
        }
        const s = beta * dot;
        for (let i = 0; i < v.length; i++) {
          R.set(k + i, j, R.get(k + i, j) - s * v[i]);
        }
      }

      // 应用到 b 向量
      if (Qtb) {
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += v[i] * Qtb[k + i];
        const s = beta * dot;
        for (let i = 0; i < v.length; i++) Qtb[k + i] -= s * v[i];
      }
    }

    const Rp = Matrix.packR(R, n);
    return {
      R: Rp,
      Qtb: Qtb ? Qtb.slice(0, n) : null,
      rows: m,
      cols: n,
      condition: options.estimateCondition === false ? null
        : Matrix._estimateConditionFromR(Rp, n),
      residual: null,
      _compatibility: { type: 'householder', canExtend: false }
    };
  }

  // =================== Givens QR ===================

  static givensQR(A, b = null, options = {}) {
    const m = A.rows, n = A.cols;
    const Rp = new Float64Array(n * (n + 1) / 2);
    const Qtb = b ? new Float64Array(n) : null;

    for (let i = 0; i < m; i++) {
      const row = new Float64Array(n);
      for (let j = 0; j < n; j++) row[j] = A.get(i, j);
      const bval = b ? b[i] : 0;
      Matrix._givensInsertRow(Rp, row, Qtb, bval, n);
    }

    return {
      R: Rp,
      Qtb,
      rows: m,
      cols: n,
      condition: options.estimateCondition === false ? null
        : Matrix._estimateConditionFromR(Rp, n),
      residual: null,
      _compatibility: { type: 'givens', canExtend: !!options.allowExtend }
    };
  }

  static givensExtend(state, row, bval = 0, options = {}) {
    if (!state._compatibility?.canExtend)
      throw new Error('State not extendable');

    const Rp = new Float64Array(state.R);
    const Qtb = state.Qtb ? new Float64Array(state.Qtb) : null;
    const rowVec = new Float64Array(row);
    
    // 应用列阈值截断
    if (options.columnThreshold) {
      for (let i = 0; i < state.cols; i++) {
        if (Math.abs(rowVec[i]) < options.columnThreshold) {
          rowVec[i] = 0;
        }
      }
    }
    
    Matrix._givensInsertRow(Rp, rowVec, Qtb, bval, state.cols);

    return {
      ...state,
      R: Rp,
      Qtb,
      rows: state.rows + 1,
      condition: options.estimateCondition === false ? state.condition
        : Matrix._estimateConditionFromR(Rp, state.cols),
      residual: null
    };
  }

  // =================== Solve ===================

  static solveFromQR(state) {
    const n = state.cols;
    const x = new Float64Array(n);
    const R = state.R, Qtb = state.Qtb;
    if (!Qtb) throw new Error('Qtb missing');

    // 回代求解 Rx = Qtb
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) {
        // ⭐ 修正：上三角矩阵压缩存储的正确索引
        // 存储顺序：列主序，每列存储从对角线到该列顶部的元素
        // 第 j 列有 j+1 个元素，前面所有列的元素总数是 j*(j+1)/2
        // 第 j 列中第 i 个元素（i <= j）的索引是 j*(j+1)/2 + i
        const idx = (j * (j + 1)) / 2 + i;
        sum += R[idx] * x[j];
      }
      // 对角线元素索引：i*(i+1)/2 + i
      const diagIdx = (i * (i + 1)) / 2 + i;
      const d = R[diagIdx];
      if (Math.abs(d) < 1e-15) {
        throw new Error(`Matrix is singular: R[${i},${i}] is near zero (${d})`);
      }
      x[i] = (Qtb[i] - sum) / d;
    }
    return x;
  }

  // =================== 工具函数 ===================

  static _givensInsertRow(Rp, row, Qtb, bval, n) {
    for (let j = 0; j < n; j++) {
      const diagIdx = (j * (j + 1)) / 2 + j; // 对角线元素索引
      const a = Rp[diagIdx];
      const b = row[j];
      
      // ⭐ 改进：使用相对阈值
      const threshold = Math.max(1e-15, 1e-15 * Math.abs(a));
      if (Math.abs(b) < threshold) continue;
      
      // 计算 Givens 旋转
      const r = Math.hypot(a, b);
      const c = a / r;
      const s = b / r;
      
      // 更新对角线元素
      Rp[diagIdx] = r;
      
      // 更新 R 的当前行右侧元素
      for (let k = j + 1; k < n; k++) {
        const idx = (k * (k + 1)) / 2 + j;
        const x = Rp[idx];
        const y = row[k];
        Rp[idx] = c * x + s * y;
        row[k] = -s * x + c * y;
      }
      
      // 更新 Qtb 向量
      if (Qtb) {
        const q = Qtb[j];
        Qtb[j] = c * q + s * bval;
        bval = -s * q + c * bval;
      }
    }
  }

  static _estimateConditionFromR(Rp, n) {
    let max = 0, min = Infinity;
    for (let i = 0; i < n; i++) {
      const diagIdx = (i * (i + 1)) / 2 + i;
      const d = Math.abs(Rp[diagIdx]);
      if (d < 1e-15) return Infinity; // ⭐ 改进：使用阈值而非精确零
      max = Math.max(max, d);
      min = Math.min(min, d);
    }
    return min === 0 ? Infinity : max / min;
  }

  static packR(R, n) {
    // ⭐ 注意：按列主序打包上三角矩阵
    // 第 j 列存储 R[0:j+1, j]（从顶部到对角线）
    const p = new Float64Array((n * (n + 1)) / 2);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i <= j; i++) {
        p[k++] = R.get(i, j);
      }
    }
    return p;
  }
  
  static unpackR(Rp, n) {
    const R = new Matrix(n, n);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i <= j; i++) {
        R.set(i, j, Rp[k++]);
      }
    }
    return R;
  }
  
  // =================== 高级工具 ===================
  
  static estimateCondition(state) {
    return Matrix._estimateConditionFromR(state.R, state.cols);
  }
  
  static computeResidual(state, A, b) {
    const x = Matrix.solveFromQR(state);
    const m = A.rows;
    let residual = 0;
    
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < state.cols; j++) {
        sum += A.get(i, j) * x[j];
      }
      const diff = sum - b[i];
      residual += diff * diff;
    }
    
    return Math.sqrt(residual);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Matrix };
} else if (typeof window !== 'undefined') {
  window.Matrix = Matrix;
}