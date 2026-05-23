export default class SimpleMovingAverage {
  constructor(period = 30) {
    this.period = period;
    this.data = [];
    this.sum = 0;
  }

  reset() {
    this.data = [];
    this.sum = 0;
  }

  compute(value) {
    this.data.push(value);
    this.sum += value;

    if (this.data.length > this.period) {
      this.sum -= this.data.shift();
    }

    if (this.data.length < this.period) {
      return null;
    }

    return Number((this.sum / this.period).toFixed(2));
  }
}
