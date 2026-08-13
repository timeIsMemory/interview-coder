// A tiny dependency-free concurrency limiter and cancellable task pool.
// Used by the AI gateway and batch generation so we never fire more requests
// than a provider allows, and so a whole batch can be paused/cancelled.

export type LimitedTask<T> = () => Promise<T>

/**
 * Runs async tasks with a maximum concurrency. Returns a function that queues
 * a task and resolves when it completes.
 */
export function createLimiter(maxConcurrent: number) {
  let active = 0
  const queue: Array<() => void> = []
  const limit = Math.max(1, Math.floor(maxConcurrent))

  const next = () => {
    if (active >= limit) return
    const run = queue.shift()
    if (run) {
      active++
      run()
    }
  }

  return function schedule<T>(task: LimitedTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      }
      queue.push(run)
      next()
    })
  }
}

/**
 * A cooperative pause/cancel token. Long batch jobs check `throwIfCancelled()`
 * between steps and `await waitWhilePaused()` so a user can pause a 50-item run.
 */
export class ControlToken {
  private cancelled = false
  private paused = false
  private resumeWaiters: Array<() => void> = []

  cancel(): void {
    this.cancelled = true
    // Wake any paused waiters so they can observe cancellation and exit.
    this.resume()
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    waiters.forEach((w) => w())
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  get isPaused(): boolean {
    return this.paused
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      const err = new Error("cancelled") as Error & { code?: string }
      err.code = "CANCELLED"
      throw err
    }
  }

  async waitWhilePaused(): Promise<void> {
    if (!this.paused || this.cancelled) return
    await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
  }
}

export function isCancellationError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "CANCELLED"
}
