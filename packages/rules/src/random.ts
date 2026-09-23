/** Deterministic PRNG. Store its state with each game snapshot for exact replay. */
export class RandomStream {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  getState(): number {
    return this.state;
  }

  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  rollDie(sides: number): number {
    if (!Number.isInteger(sides) || sides < 2) throw new Error('sides must be an integer >= 2');
    return (this.nextUint32() % sides) + 1;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.nextUint32() % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
