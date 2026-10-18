import { describe, expect, it } from 'vitest'
import { socketUrl } from './create-api.ts'

describe('socketUrl', () => {
  it('uses ws:// for a plain http page', () => {
    expect(socketUrl('http://localhost:5173')).toBe('ws://localhost:5173/ws')
  })

  it('uses wss:// for an https page, keeping host and port', () => {
    expect(socketUrl('https://faire.example.com:8443')).toBe('wss://faire.example.com:8443/ws')
  })

  it('ignores any path on the origin', () => {
    expect(socketUrl('http://127.0.0.1:7420/settings')).toBe('ws://127.0.0.1:7420/ws')
  })
})
