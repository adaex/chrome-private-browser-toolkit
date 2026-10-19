// 队列不关心任务返回值（checkDuplicate 的 boolean 等），Promise<unknown> 让调用点不必套空壳 async
type Task = () => Promise<unknown>;

export class Queue {
  private queue: Task[] = [];
  private activeCount = 0;

  constructor(private readonly concurrency: number) {}

  run(task: Task) {
    this.queue.push(task);
    this.tryToExecuteNext();
  }

  private tryToExecuteNext() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.activeCount++;
      task()
        .catch(catchError('queue'))
        .finally(() => {
          this.activeCount--;
          this.tryToExecuteNext();
        });
    }
  }
}

export function catchError(context: string) {
  return (error: unknown) => {
    console.error(`[${new Date().toISOString()}] Error in ${context}:`, error);
  };
}

export const queue = new Queue(1);
