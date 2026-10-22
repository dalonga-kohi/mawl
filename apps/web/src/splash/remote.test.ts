import { describe, expect, it } from 'vitest'
import {
  connectErrorCopy,
  describeRemote,
  hostOf,
  isUnencrypted,
  parseConnectError,
  parseHealth,
  parseHostAppearance,
  parseTarget,
} from './remote.ts'

describe('what the host says about the remote Mawl, parsed at the boundary', () => {
  it('reads the window target and never more than the origin', () => {
    expect(parseTarget({ kind: 'local' })).toEqual({ kind: 'local' })
    expect(parseTarget({ kind: 'remote', origin: 'https://mawl.example.com/' })).toEqual({
      kind: 'remote',
      origin: 'https://mawl.example.com/',
    })
    // Extra fields are dropped; anything odd means local.
    expect(
      parseTarget({ kind: 'remote', origin: 'https://mawl.example.com/', token: 'x' }),
    ).toEqual({ kind: 'remote', origin: 'https://mawl.example.com/' })
    expect(parseTarget({ kind: 'remote' })).toEqual({ kind: 'local' })
    expect(parseTarget('nope')).toEqual({ kind: 'local' })
  })

  it('reads a health answer, and anything unknown as unreachable', () => {
    expect(parseHealth('ready')).toBe('ready')
    expect(parseHealth('token_refused')).toBe('token_refused')
    expect(parseHealth('surprise')).toBe('unreachable')
  })

  it('reads a connect error, and anything unknown as a store error', () => {
    expect(parseConnectError({ kind: 'url', reason: 'scheme' })).toEqual({
      kind: 'url',
      reason: 'scheme',
    })
    expect(parseConnectError({ kind: 'remote', health: 'not_mawl' })).toEqual({
      kind: 'remote',
      health: 'not_mawl',
    })
    expect(parseConnectError('Command connect_remote not allowed')).toEqual({ kind: 'store' })
  })

  it('reads the saved appearance strictly', () => {
    expect(parseHostAppearance({ theme: 'dark', accent: '#F7C4A3', reduceMotion: true })).toEqual({
      theme: 'dark',
      accent: '#F7C4A3',
      reduceMotion: true,
    })
    expect(parseHostAppearance({ theme: 'light', accent: null, reduceMotion: false })).toEqual({
      theme: 'light',
      accent: null,
      reduceMotion: false,
    })
    expect(parseHostAppearance({ theme: 'neon', accent: '#fff', reduceMotion: 1 })).toBeNull()
    expect(parseHostAppearance(null)).toBeNull()
  })
})

describe('the words for it', () => {
  it('names the remote by its host', () => {
    expect(hostOf('https://mawl.tail1234.ts.net/')).toBe('mawl.tail1234.ts.net')
    expect(hostOf('http://192.168.1.20:7420/')).toBe('192.168.1.20:7420')
    expect(hostOf('not a url')).toBe('not a url')
  })

  it('explains each failed check with what to do', () => {
    const host = 'mawl.example.com'
    expect(describeRemote('unreachable', host)).toMatch(/couldn’t reach mawl\.example\.com/)
    expect(describeRemote('not_mawl', host)).toMatch(/isn’t Mawl/)
    expect(describeRemote('token_refused', host)).toMatch(/didn’t accept the owner token/)
    expect(describeRemote('unhealthy', host)).toMatch(/lost its database/)
  })

  it('puts each connect error next to the field it is about', () => {
    expect(connectErrorCopy({ kind: 'url', reason: 'empty' })).toEqual({
      field: 'url',
      message: 'Enter the address of the remote Mawl.',
    })
    expect(connectErrorCopy({ kind: 'url', reason: 'user_info' }).message).toMatch(
      /user name and password/,
    )
    expect(connectErrorCopy({ kind: 'url', reason: 'not_an_origin' }).message).toMatch(/no path/)
    expect(connectErrorCopy({ kind: 'token', reason: 'length' })).toEqual({
      field: 'token',
      message: 'Owner tokens are 32 to 512 characters long.',
    })
    expect(connectErrorCopy({ kind: 'remote', health: 'token_refused' }).field).toBe('token')
    expect(connectErrorCopy({ kind: 'remote', health: 'unreachable' }).field).toBe('url')
    expect(connectErrorCopy({ kind: 'store' }).field).toBe('form')
  })

  it('flags an address that is not encrypted', () => {
    expect(isUnencrypted('http://192.168.1.20:7420')).toBe(true)
    expect(isUnencrypted(' HTTP://mawl.lan ')).toBe(true)
    expect(isUnencrypted('https://mawl.example.com')).toBe(false)
    expect(isUnencrypted('mawl.example.com')).toBe(false)
  })
})
