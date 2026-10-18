import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createDb } from './index.ts'

describe('createDb pool errors', () => {
  it('does not throw when an idle client errors and no handler is given', async () => {
    const handle = createDb('postgres://u:p@127.0.0.1:1/d')
    try {
      expect(() => handle.pool.emit('error', new Error('idle client died'))).not.toThrow()
    } finally {
      await handle.close()
    }
  })

  it('passes pool errors to onError', async () => {
    const onError = vi.fn()
    const handle = createDb('postgres://u:p@127.0.0.1:1/d', { onError })
    try {
      const err = new Error('idle client died')
      handle.pool.emit('error', err)
      expect(onError).toHaveBeenCalledWith(err)
    } finally {
      await handle.close()
    }
  })

  it('bounds how long a caller waits for a connection', async () => {
    const handle = createDb('postgres://u:p@127.0.0.1:1/d')
    try {
      expect(handle.pool.options.connectionTimeoutMillis).toBe(5000)
    } finally {
      await handle.close()
    }
  })

  it('routes errors of a checked-out client to onError (Graphile Worker expects a connect handler)', async () => {
    const onError = vi.fn()
    const handle = createDb('postgres://u:p@127.0.0.1:1/d', { onError })
    try {
      expect(handle.pool.listenerCount('connect')).toBeGreaterThan(0)
      const client = new EventEmitter()
      handle.pool.emit('connect', client)
      const err = new Error('socket reset')
      expect(() => client.emit('error', err)).not.toThrow()
      expect(onError).toHaveBeenCalledWith(err)
    } finally {
      await handle.close()
    }
  })
})
