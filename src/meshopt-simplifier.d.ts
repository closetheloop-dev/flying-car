// The parts of meshoptimizer's simplifier (shipped with three, untyped) that glb.ts uses.
declare module 'three/addons/libs/meshopt_simplifier.module.js' {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    /** Returns the simplified index buffer and the resulting error (relative to the mesh extent). */
    simplify(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: ('LockBorder' | 'Sparse' | 'ErrorAbsolute')[],
    ): [Uint32Array, number];
    /** As simplify, also keeping per-vertex attributes (e.g. normals, UVs) within their weighted error. */
    simplifyWithAttributes(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      attributes: Float32Array,
      attributeStride: number,
      attributeWeights: number[],
      vertexLock: Uint8Array | null,
      targetIndexCount: number,
      targetError: number,
      flags?: ('LockBorder' | 'Sparse' | 'ErrorAbsolute')[],
    ): [Uint32Array, number];
  };
}
