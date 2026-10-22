import '../styles.css'
import './splash.css'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { type HostBridge, inTauri, tauriBridge } from './bridge.ts'
import { Splash } from './Splash.tsx'

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

void bridge().then((host) => {
  createRoot(container).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        {host ? (
          <Splash bridge={host} />
        ) : (
          <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-text-2">
            <p>This page belongs to the Mawl desktop app.</p>
          </main>
        )}
      </MotionConfig>
    </StrictMode>,
  )
})
