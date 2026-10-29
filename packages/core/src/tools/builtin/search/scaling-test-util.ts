/**
 * Test helper: how much slower `run` gets when its input grows 4x. Linear code gives about 4,
 * quadratic code about 16. A ratio, unlike a wall-clock budget, does not depend on how fast the
 * machine is (CI runners are several times slower than a dev box).
 *
 * One warm-up run (JIT), then the best of five runs per size, to cut GC and scheduler noise.
 * Times below `floorMs` count as `floorMs`, so timer resolution on tiny inputs cannot fake a
 * large ratio.
 */
export function growthRatio<T>(
  build: (n: number) => T,
  run: (input: T) => unknown,
  n: number,
  floorMs = 1,
): number {
  const small = build(n)
  const large = build(4 * n)
  run(small)
  const best = (input: T) => {
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      run(input)
      min = Math.min(min, performance.now() - started)
    }
    return Math.max(min, floorMs)
  }
  const t1 = best(small)
  const t4 = best(large)
  return t4 / t1
}

/** 4x input: linear is ~4, quadratic ~16. 10 leaves room for noise (a loaded CI runner measured 8.9) and still fails quadratic. */
export const LINEAR_MAX_RATIO = 10
