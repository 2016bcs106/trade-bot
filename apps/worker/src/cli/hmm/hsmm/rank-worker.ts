import { parentPort } from "worker_threads";
import { runStage1, runStage2 } from "./rank-stages.ts";
import { RankTask } from "./worker-pool.ts";

parentPort?.on("message", (task: RankTask) => {
  try {
    const result = task.type === "stage1" ? runStage1(task.symbol) : runStage2(task.stage1);
    parentPort!.postMessage({ ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ ok: false, error });
  }
});
