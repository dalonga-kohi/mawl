import { describe, expect, it } from 'vitest'
import {
  loadPanelOpen,
  loadSidebarOpen,
  PANEL_STORAGE_KEY,
  SIDEBAR_STORAGE_KEY,
  savePanelOpen,
  saveSidebarOpen,
} from './shell-prefs.ts'

const store = (initial?: string) => {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(SIDEBAR_STORAGE_KEY, initial)
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}
const blocked = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('panel pref', () => {
  it('is open by default and remembers closed and open', () => {
    const data = new Map<string, string>()
    const s = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
    expect(loadPanelOpen(s)).toBe(true)
    savePanelOpen(s, false)
    expect(data.get(PANEL_STORAGE_KEY)).toBe('closed')
    expect(loadPanelOpen(s)).toBe(false)
    savePanelOpen(s, true)
    expect(loadPanelOpen(s)).toBe(true)
  })

  it('survives blocked storage', () => {
    expect(loadPanelOpen(blocked)).toBe(true)
    expect(() => savePanelOpen(blocked, false)).not.toThrow()
  })
})

describe('sidebar pref', () => {
  it('is open by default', () => {
    expect(loadSidebarOpen(store())).toBe(true)
    expect(loadSidebarOpen(null)).toBe(true)
  })

  it('remembers closed and open', () => {
    const s = store()
    saveSidebarOpen(s, false)
    expect(loadSidebarOpen(s)).toBe(false)
    saveSidebarOpen(s, true)
    expect(loadSidebarOpen(s)).toBe(true)
  })

  it('ignores junk and survives blocked storage', () => {
    expect(loadSidebarOpen(store('maybe'))).toBe(true)
    expect(loadSidebarOpen(blocked)).toBe(true)
    expect(() => saveSidebarOpen(blocked, false)).not.toThrow()
  })
})
