// 队列不关心任务返回值（checkDuplicate 的 boolean 等），Promise<unknown> 让调用点不必套空壳 async
type Task = () => Promise<unknown>;

export class Queue {
  private queue: (Task | undefined)[] = [];
  private head = 0;
  private activeCount = 0;

  constructor(private readonly concurrency: number) {}

  run(task: Task) {
    this.queue.push(task);
    this.tryToExecuteNext();
  }

  private tryToExecuteNext() {
    while (this.activeCount < this.concurrency && this.head < this.queue.length) {
      // 游标出队避免 shift() 反复搬移数组；持续积压时切片压缩，保持均摊 O(1)
      const index = this.head++;
      const task = this.queue[index]!;
      if (this.head === this.queue.length) {
        this.queue.length = 0;
        this.head = 0;
      } else if (this.head >= 16 && this.head * 2 >= this.queue.length) {
        this.queue = this.queue.slice(this.head);
        this.head = 0;
      } else {
        this.queue[index] = undefined;
      }
      this.activeCount++;
      let result: Promise<unknown>;
      try {
        result = task();
      } catch (error) {
        result = Promise.reject(error);
      }
      result
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
