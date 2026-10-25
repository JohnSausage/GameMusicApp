export interface Comparison {
  referenceCount: number
  detectedCount: number
  correct: number
  /** Wrong pitch in the right place. */
  substitutions: number
  /** Substitutions that are exactly one octave off (typical overtone error). */
  octaveErrors: number
  /** Reference notes with no detected counterpart. */
  missed: number
  /** Detected notes that are not in the reference. */
  extra: number
  /** correct / referenceCount */
  accuracy: number
}

/**
 * A wrong note costs a bit more than one gap but less than two, so among
 * equally short alignments the one with the most correct notes wins.
 */
const SUBSTITUTION_COST = 1.5

/**
 * Aligns the detected pitch sequence with the reference (edit distance) and
 * counts what went right and wrong. Only pitch order is compared, not timing.
 */
export function comparePitchSequences(reference: number[], detected: number[]): Comparison {
  const n = reference.length
  const m = detected.length
  const stepCost = (i: number, j: number): number => (reference[i - 1] === detected[j - 1] ? 0 : SUBSTITUTION_COST)
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(cost[i - 1][j - 1] + stepCost(i, j), cost[i - 1][j] + 1, cost[i][j - 1] + 1)
    }
  }

  let correct = 0
  let substitutions = 0
  let octaveErrors = 0
  let missed = 0
  let extra = 0
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + stepCost(i, j)) {
      if (reference[i - 1] === detected[j - 1]) correct++
      else {
        substitutions++
        if (Math.abs(reference[i - 1] - detected[j - 1]) === 12) octaveErrors++
      }
      i--
      j--
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      missed++
      i--
    } else {
      extra++
      j--
    }
  }

  return {
    referenceCount: n,
    detectedCount: m,
    correct,
    substitutions,
    octaveErrors,
    missed,
    extra,
    accuracy: n === 0 ? 0 : correct / n
  }
}
