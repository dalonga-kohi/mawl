import type { RunId } from '@faire/contracts'

/**
 * The runs this process is executing right now, each with the controller that stops it.
 * `register` doubles as the "already executing" guard: a second job for the same run gets null
 * and must back off.
 */
export class RunRegistry {
  private readonly active = new Map<RunId, AbortController>()

  get size(): number {
    return this.active.size
  }

  register(runId: RunId): AbortController | null {
    if (this.active.has(runId)) return null
    const controller = new AbortController()
    this.active.set(runId, controller)
    return controller
  }

  /** Only removes the entry if it still belongs to `controller`. */
  release(runId: RunId, controller: AbortController): void {
    if (this.active.get(runId) === controller) this.active.delete(runId)
  }

  /** True when the run was executing here. */
  abort(runId: RunId, reason: string): boolean {
    const controller = this.active.get(runId)
    if (!controller) return false
    controller.abort(reason)
    return true
  }

  abortAll(reason: string): void {
    for (const controller of this.active.values()) controller.abort(reason)
  }
}
