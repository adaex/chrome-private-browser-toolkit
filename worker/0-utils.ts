type Task = () => Promise<void | boolean>;

class Queue {
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
      task().finally(() => {
        this.activeCount--;
        this.tryToExecuteNext();
      });
    }
  }
}

const queue = new Queue(1);

const noop = () => {};
const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
