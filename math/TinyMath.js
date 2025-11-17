// TinyMath.js
/**
 * 专为小规模矩阵优化（<32x32）
 * 特性：
 *   - TypedArray内存布局
 *   - 对称矩阵优化
 *   - 安全数值处理
 */
export class TinyMatrix {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Float64Array(rows * cols);
  }

  set(i, j, value) {
    this.data[i * this.cols + j] = value;
  }

  get(i, j) {
    return this.data[i * this.cols + j];
  }

  transpose() {
    const result = new TinyMatrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(j, i, this.get(i, j));
      }
    }
    return result;
  }

  /**
   * 高效矩阵乘法（小矩阵优化）
   * @param {TinyMatrix} B
   * @returns {TinyMatrix}
   */
  mmul(B) {
    if (this.cols !== B.rows) {
      throw new Error(`维度不匹配: ${this.cols} != ${B.rows}`);
    }
    
    const C = new TinyMatrix(this.rows, B.cols);
    const a = this.data;
    const b = B.data;
    const c = C.data;
    const rows = this.rows;
    const cols = B.cols;
    const inner = this.cols;
    
    // 优化内存访问模式
    for (let i = 0; i < rows; i++) {
      const rowOffset = i * inner;
      for (let k = 0; k < inner; k++) {
        const aVal = a[rowOffset + k];
        if (aVal === 0) continue;
        const bRowOffset = k * cols;
        const cRowOffset = i * cols;
        for (let j = 0; j < cols; j++) {
          c[cRowOffset + j] += aVal * b[bRowOffset + j];
        }
      }
    }
    return C;
  }

  to1DArray() {
    return Array.from(this.data);
  }

  /**
   * 求解对称正定系统 (Cholesky分解)
   * @param {Float64Array} A - 对称矩阵 (n x n)
   * @param {Float64Array} b - 右侧向量 (n)
   * @param {number} n - 维度
   * @returns {Float64Array} 解向量
   */
  static solveSymmetric(A, b, n) {
    // 条件数检查
    let maxDiag = 0, minDiag = Infinity;
    for (let i = 0; i < n; i++) {
      const diag = A[i * n + i];
      maxDiag = Math.max(maxDiag, Math.abs(diag));
      minDiag = Math.min(minDiag, Math.abs(diag));
    }
    const cond = maxDiag / (minDiag + 1e-15);
    
    // 动态Tikhonov正则化
    if (cond > 1e6) {
      const lambda = 1e-6 * maxDiag;
      for (let i = 0; i < n; i++) {
        A[i * n + i] += lambda;
      }
    }

    // Cholesky分解: A = L * Lᵀ
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i * n + k] * L[j * n + k];
        }
        
        if (i === j) {
          const diag = A[i * n + i] - sum;
          L[i * n + i] = diag > 0 ? Math.sqrt(diag) : 1e-8;
        } else {
          L[i * n + j] = (A[i * n + j] - sum) / L[j * n + j];
        }
      }
    }

    // 前向替换: L * y = b
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < i; k++) {
        sum += L[i * n + k] * y[k];
      }
      y[i] = (b[i] - sum) / L[i * n + i];
    }

    // 后向替换: Lᵀ * x = y
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let k = i + 1; k < n; k++) {
        sum += L[k * n + i] * x[k];
      }
      x[i] = (y[i] - sum) / L[i * n + i];
    }

    return x;
  }
}