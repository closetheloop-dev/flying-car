/**
 * Non-negative least squares (Lawson & Hanson 1974): minimize ‖A·x − b‖ subject to x ≥ 0.
 * Dense and tiny by design — the allocation problem is at most ~18×12.
 */
import { zeros } from './math';

export function nnls(A: number[][], b: number[], tol = 1e-10): number[] {
  const m = A.length;
  const n = A[0].length;
  const x = zeros(n);
  const passive = Array.from({ length: n }, () => false);

  const gradient = (): number[] => {
    const r = b.map((bi, i) => bi - A[i].reduce((s, aij, j) => s + aij * x[j], 0));
    return Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let i = 0; i < m; i++) s += A[i][j] * r[i];
      return s;
    });
  };

  for (let outer = 0; outer < 3 * n; outer++) {
    const w = gradient();
    let t = -1;
    let best = tol;
    for (let j = 0; j < n; j++) {
      if (!passive[j] && w[j] > best) {
        best = w[j];
        t = j;
      }
    }
    if (t < 0) break;
    passive[t] = true;

    for (let inner = 0; inner < 3 * n; inner++) {
      const s = solveSubset(A, b, passive);
      let ok = true;
      for (let j = 0; j < n; j++) if (passive[j] && s[j] <= tol) ok = false;
      if (ok) {
        for (let j = 0; j < n; j++) x[j] = s[j];
        break;
      }
      let alpha = Infinity;
      for (let j = 0; j < n; j++) {
        if (passive[j] && s[j] <= tol) alpha = Math.min(alpha, x[j] / (x[j] - s[j]));
      }
      for (let j = 0; j < n; j++) {
        x[j] += alpha * (s[j] - x[j]);
        if (passive[j] && Math.abs(x[j]) <= tol) {
          passive[j] = false;
          x[j] = 0;
        }
      }
    }
  }
  return x;
}

/** Unconstrained least squares on the passive columns only (others fixed at zero). */
function solveSubset(A: number[][], b: number[], passive: boolean[]): number[] {
  const idx = passive.flatMap((p, j) => (p ? [j] : []));
  const k = idx.length;
  // Normal equations AᵀA·s = Aᵀb on the subset.
  const M = Array.from({ length: k }, () => zeros(k + 1));
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let i = 0; i < A.length; i++) s += A[i][idx[r]] * A[i][idx[c]];
      M[r][c] = s;
    }
    let s = 0;
    for (let i = 0; i < A.length; i++) s += A[i][idx[r]] * b[i];
    M[r][k] = s;
  }
  const sol = gaussSolve(M);
  const out = zeros(passive.length);
  idx.forEach((j, r) => (out[j] = sol[r]));
  return out;
}

/** Gaussian elimination with partial pivoting on an augmented k×(k+1) matrix. */
export function gaussSolve(M: number[][]): number[] {
  const k = M.length;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-14) continue;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-14 ? 0 : row[k] / row[i]));
}
