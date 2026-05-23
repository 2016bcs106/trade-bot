export interface AnalysisResult {
  close: number;
  fastSma: number | null;
  slowSma: number | null;
  signal: string | null;
  runningProfit: number;
}
