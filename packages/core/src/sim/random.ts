// The only source of randomness in packages/core/src/sim: the same seed gives the same plan.
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

// mulberry32: 32-bit state, one value in [0, 1) per call.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new Error(`rng int needs a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("rng pick needs a non-empty list");
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}

// FNV-1a 32-bit of `${seed}:${label}`, so each part and category has its own stream.
export function deriveSeed(seed: number, label: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${seed}:${label}`)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Splits `total` by the weights with the largest-remainder rule (ties go to the lower index): the counts add up to `total`.
export function largestRemainder(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error("largestRemainder needs a positive weight sum");
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map((x) => Math.floor(x + 1e-9));
  const order = exact
    .map((x, index) => ({ index, rest: x - (counts[index] as number) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  let left = total - counts.reduce((a, b) => a + b, 0);
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index] = (counts[index] as number) + 1;
    left -= 1;
  }
  return counts;
}

// `total` items from `items` in the exact shares of `weights` (largest remainder), then shuffled.
export function quota<T>(rng: Rng, items: readonly T[], weights: readonly number[], total: number): T[] {
  const counts = largestRemainder(weights, total);
  const out = items.flatMap((item, index) => Array.from({ length: counts[index] as number }, () => item));
  return rng.shuffle(out);
}
