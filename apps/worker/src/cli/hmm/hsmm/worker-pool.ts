import { Worker } from "worker_threads";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Stage1Result } from "./rank-stages.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, "rank-worker-bootstrap.mjs");

export type RankTask =
  | { type: "stage1"; symbol: string }
  | { type: "stage2"; stage1: Stage1Result };

type WorkerResponse = { ok: true; result: unknown } | { ok: false; error: string };

interface QueueItem {
  task: RankTask;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Minimal fixed-size worker_threads pool for running independent rank-stages
 * tasks (each reads its own OHLCV file, no shared state) off the main thread.
 */
export default class RankWorkerPool {
  private idle: Worker[] = [];
  private queue: QueueItem[] = [];
  private pending = new Map<Worker, QueueItem>();

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(WORKER_PATH);
      worker.on("message", (msg: WorkerResponse) => this.onMessage(worker, msg));
      worker.on("error", (err: Error) => this.onError(worker, err));
      this.idle.push(worker);
    }
  }

  run<T>(task: RankTask): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
      this.dispatch();
    });
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.idle, ...this.pending.keys()].map((w) => w.terminate()));
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const item = this.queue.shift()!;
      this.pending.set(worker, item);
      worker.postMessage(item.task);
    }
  }

  private onMessage(worker: Worker, msg: WorkerResponse): void {
    const item = this.pending.get(worker);
    this.pending.delete(worker);
    this.idle.push(worker);
    if (msg.ok) item?.resolve(msg.result);
    else item?.reject(new Error(msg.error));
    this.dispatch();
  }

  private onError(worker: Worker, err: Error): void {
    const item = this.pending.get(worker);
    this.pending.delete(worker);
    item?.reject(err);
  }
}
