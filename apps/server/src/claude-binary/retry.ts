const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Backoff for Windows, where an antivirus scan or indexer can hold a fresh file for a moment. */
export const DEFAULT_DELAYS_MS = [50, 150, 400, 1000]

/**
 * Runs `fn`, retrying after each delay while it fails with EPERM, EBUSY or EACCES. Any other
 * error, or the last failure once the delays run out, is thrown as is.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  { delaysMs = DEFAULT_DELAYS_MS }: { delaysMs?: number[] } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      const delay = delaysMs[attempt]
      if (delay === undefined || code === undefined || !TRANSIENT.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
