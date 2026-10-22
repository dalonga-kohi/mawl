/**
 * Runs shutdown steps in order. A failing step never skips the ones after it (the last ones
 * usually free the most, e.g. the embedded Postgres). Afterwards the one error is rethrown, or an
 * AggregateError when several steps failed.
 */
export async function runTeardown(steps: readonly (() => unknown)[]): Promise<void> {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (err) {
      errors.push(err)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'several shutdown steps failed')
}
