class TinyMatrix {
  /**
   * 创建矩阵（小矩阵专用）
   * @param {number} rows - 行数
   * @param {number} cols - 列数
   */
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Float64Array(rows * cols); // 预分配TypedArray
  }

  /** 设置元素 */
  set(i, j, value) {
    this.data[i * this.cols + j] = value;
  }

  /** 获取元素 */
  get(i, j) {
    return this.data[i * this.cols + j];
  }

  /** 转置（原地操作） */
  transpose() {
    const result = new TinyMatrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(j, i, this.get(i, j));
      }
    }
    return result;
  }

  /** 矩阵乘法 C = A × B */
  mmul(B) {
    console.assert(this.cols === B.rows, '矩阵维度不匹配');
    const C = new TinyMatrix(this.rows, B.cols);
    
    // 三重循环（小矩阵最优）
    for (let i = 0; i < this.rows; i++) {
      for (let k = 0; k < this.cols; k++) {
        const aik = this.get(i, k);
        if (aik === 0) continue; // 跳过零（稀疏优化）
        for (let j = 0; j < B.cols; j++) {
          C.data[i * C.cols + j] += aik * B.get(k, j);
        }
      }
    }
    return C;
  }

  /** 转换为1D数组 */
  to1DArray() {
    return Array.from(this.data);
  }

  /** 求解线性方程组 Ax = b（LU分解） */
  static solve(A, b) {
    const n = A.rows;
    // 创建增广矩阵 [A|b]
    const M = new TinyMatrix(n, n + 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        M.set(i, j, A.get(i, j));
      }
      M.set(i, n, b.get(i, 0));
    }

    // 高斯消元（带行交换）
    for (let col = 0; col < n; col++) {
      // 寻找主元
      let pivotRow = col;
      let maxVal = Math.abs(M.get(col, col));
      for (let row = col + 1; row < n; row++) {
        const val = Math.abs(M.get(row, col));
        if (val > maxVal) {
          maxVal = val;
          pivotRow = row;
        }
      }

      // 交换行
      if (pivotRow !== col) {
        for (let j = 0; j <= n; j++) {
          const temp = M.get(col, j);
          M.set(col, j, M.get(pivotRow, j));
          M.set(pivotRow, j, temp);
        }
      }

      // 消元
      const pivot = M.get(col, col);
      if (Math.abs(pivot) < 1e-12) throw new Error('矩阵奇异');
      
      for (let row = col + 1; row < n; row++) {
        const factor = M.get(row, col) / pivot;
        for (let j = col; j <= n; j++) {
          M.set(row, j, M.get(row, j) - factor * M.get(col, j));
        }
      }
    }

    // 回代
    const x = new TinyMatrix(n, 1);
    for (let i = n - 1; i >= 0; i--) {
      let sum = M.get(i, n);
      for (let j = i + 1; j < n; j++) {
        sum -= M.get(i, j) * x.get(j, 0);
      }
      x.set(i, 0, sum / M.get(i, i));
    }
    return x;
  }
}

export { TinyMatrix };