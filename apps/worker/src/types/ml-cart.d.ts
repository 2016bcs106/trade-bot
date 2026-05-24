declare module "ml-cart" {
  export class DecisionTreeRegression {
    constructor(options?: { maxDepth?: number; minNumSamples?: number });
    train(X: number[][], y: number[]): void;
    predict(X: number[][]): number[];
    toJSON(): any;
    static load(json: any): DecisionTreeRegression;
  }
}
