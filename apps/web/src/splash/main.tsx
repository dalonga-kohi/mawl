import '../styles.css'
import './splash.css'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { type HostBridge, hostAppearance, inTauri, tauriBridge } from './bridge.ts'
import type { HostAppearance } from './remote.ts'
import { Splash } from './Splash.tsx'
import { applySplashAppearance, initialViewFrom } from './setup.ts'

const container = document.getElementById('root')
if (!container) throw new Error('splash.html is missing #root')

async function bridge(): Promise<HostBridge | undefined> {
  if (inTauri(window)) return tauriBridge()
  if (import.meta.env.DEV) {
    const demo = new URLSearchParams(window.location.search).get('demo')
    if (demo) return (await import('./demo-bridge.ts')).demoBridge(demo)
  }
  return undefined
}

async function appearance(): Promise<HostAppearance | null> {
  if (inTauri(window)) return hostAppearance()
  if (import.meta.env.DEV) {
    const look = new URLSearchParams(window.location.search).get('look')
    if (look) return (await import('./demo-bridge.ts')).demoAppearance(look)
  }
  return null
}

void Promise.all([bridge(), appearance()]).then(([host, look]) => {
  // Before the first render, so the window never paints in the wrong theme.
  applySplashAppearance(document.documentElement, look)
  createRoot(container).render(
    <StrictMode>
      <MotionConfig reducedMotion={look?.reduceMotion ? 'always' : 'user'}>
        {host ? (
          <Splash bridge={host} initialView={initialViewFrom(window.location.search)} />
        ) : (
          <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-text-2">
            <p>This page belongs to the Mawl desktop app.</p>
          </main>
        )}
      </MotionConfig>
    </StrictMode>,
  )
})
