import pg from 'pg'

/** The Postgres channel `insertEvent` notifies on. The payload is just `{"id": <event id>}`. */
export const EVENTS_CHANNEL = 'faire_events'

export interface NotificationConnection {
  /** Stops listening and releases the connection. Safe to call after the connection died. */
  close(): Promise<void>
}

export interface NotificationHandlers {
  /** Some event was committed. The payload is ignored: the bus reads the table. */
  onNotify(): void
  /** The connection ended or errored. Called at most once per connection. */
  onClose(err?: Error): void
}

/** Port for the one LISTEN connection (a node-postgres client in production, PGlite in tests). */
export interface NotificationSource {
  /** Opens a connection and LISTENs. Rejects when it cannot. */
  connect(handlers: NotificationHandlers): Promise<NotificationConnection>
}

/**
 * LISTEN needs a session of its own that is never handed back to a pool, so this builds its own
 * `pg.Client` from the database url. node-postgres does not reconnect; the bus does.
 */
export function createPgSource(databaseUrl: string): NotificationSource {
  return {
    async connect({ onNotify, onClose }) {
      const client = new pg.Client({ connectionString: databaseUrl })
      let closed = false
      const lost = (err?: Error) => {
        if (closed) return
        closed = true
        onClose(err)
      }
      // Must exist before connect(): an unhandled 'error' event would crash the process.
      client.on('error', (err) => lost(err))
      client.on('end', () => lost())
      client.on('notification', (msg) => {
        if (msg.channel === EVENTS_CHANNEL) onNotify()
      })
      try {
        await client.connect()
        await client.query(`LISTEN ${EVENTS_CHANNEL}`)
      } catch (err) {
        closed = true
        await client.end().catch(() => {})
        throw err
      }
      return {
        async close() {
          closed = true
          await client.end().catch(() => {})
        },
      }
    },
  }
}
