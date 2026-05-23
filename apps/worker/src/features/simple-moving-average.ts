export default class SimpleMovingAverage {
  private period: number;
  private data: number[];
  private sum: number;

  constructor(period: number = 30) {
    this.period = period;
    this.data = [];
    this.sum = 0;
  }

  reset(): void {
    this.data = [];
    this.sum = 0;
  }

  compute(value: number): number | null {
    this.data.push(value);
    this.sum += value;

    if (this.data.length > this.period) {
      this.sum -= this.data.shift()!;
    }

    if (this.data.length < this.period) {
      return null;
    }

    return Number((this.sum / this.period).toFixed(2));
  }
}
