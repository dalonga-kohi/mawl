interface ProbeClient {
  query(text: string): Promise<unknown>
  release(err?: Error): void
}

export interface ProbePool {
  connect(): Promise<ProbeClient>
}

/**
 * Health probe: `select 1` under a server-side statement_timeout, so a hung database cancels
 * the query instead of leaving it holding a pool connection. A failed probe discards its
 * connection (release with an error) so a poisoned session never returns to the pool.
 */
export async function probeDb(pool: ProbePool, timeoutMs: number): Promise<void> {
  const client = await pool.connect()
  let failure: Error | undefined
  try {
    await client.query('begin')
    await client.query(`set local statement_timeout = ${Math.trunc(timeoutMs)}`)
    await client.query('select 1')
    await client.query('commit')
  } catch (err) {
    // No rollback: release(err) destroys the connection, which ends the transaction
    // server-side, and awaiting a rollback on a hung connection would hang the probe.
    failure = err instanceof Error ? err : new Error('probe failed')
    throw err
  } finally {
    if (failure) client.release(failure)
    else client.release()
  }
}
