import { Check, Copy } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import { transitions } from '../motion/presets.ts'
import { Button } from '../ui/Button.tsx'
import type { HostBridge } from './bridge.ts'
import { describe, INITIAL_STATUS, STEPS, type Status } from './status.ts'

/** How long "Ready" stays on screen so Mawl's hop reads, before the splash fades into the app. */
export const READY_HOLD_MS = 650
/** Matches the exit transition below. */
const EXIT_MS = 220
const COPIED_MS = 2000

type CopyState = 'idle' | 'copying' | 'copied' | 'error'

/**
 * The desktop splash: what the host's supervisor is doing while the server boots, restarts or
 * stops, and the failed screen with its way out. Rendered by the bundled `splash.html` in the
 * Tauri origin; the app itself loads from the server once it is ready.
 */
export function Splash({
  bridge,
  clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
}: {
  bridge: HostBridge
  clipboard?: Pick<Clipboard, 'writeText'> | undefined
}) {
  const [status, setStatus] = useState<Status>(INITIAL_STATUS)
  const [leaving, setLeaving] = useState(false)
  const reduce = useReducedMotionConfig() ?? false
  const view = describe(status)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let alive = true
    void bridge.onStatus(setStatus).then((off) => {
      if (alive) unlisten = off
      else off()
    })
    void bridge.status().then((s) => alive && setStatus(s))
    // After the first paint, so the window never shows a blank frame.
    window.requestAnimationFrame(() => void bridge.shown())
    return () => {
      alive = false
      unlisten?.()
    }
  }, [bridge])

  // Ready: let Mawl hop, fade out, then hand the window to the app.
  useEffect(() => {
    if (status.phase !== 'ready') {
      setLeaving(false)
      return
    }
    const hold = setTimeout(() => setLeaving(true), reduce ? 0 : READY_HOLD_MS)
    return () => clearTimeout(hold)
  }, [status.phase, reduce])

  useEffect(() => {
    if (!leaving) return
    const done = setTimeout(() => void bridge.enterApp(), reduce ? 0 : EXIT_MS)
    return () => clearTimeout(done)
  }, [leaving, bridge, reduce])

  return (
    <main className="grid min-h-dvh place-items-center overflow-hidden bg-bg px-6 py-10 text-text">
      <motion.div
        className="flex w-full max-w-[380px] flex-col items-center text-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={
          leaving
            ? { opacity: 0, scale: 1.02, transition: { duration: EXIT_MS / 1000, ease: 'easeIn' } }
            : { opacity: 1, scale: 1, transition: transitions.gentle }
        }
      >
        <div className="splash-mawl">
          <Mawl size={128} state={view.mascot} />
        </div>

        <div
          role="status"
          aria-live="polite"
          className="mt-6 flex min-h-[4.5rem] flex-col items-center"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${view.title}|${view.detail}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: transitions.fade }}
              exit={{ opacity: 0, transition: transitions.exit }}
              className="flex flex-col items-center"
            >
              <h1 className="font-display text-title text-balance">{view.title}</h1>
              <p className="mt-1.5 text-pretty text-text-2">{view.detail}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {view.done === undefined ? null : (
          <Track done={view.done} active={view.active ?? false} label={view.detail} />
        )}

        {view.failed ? <FailedActions bridge={bridge} clipboard={clipboard} /> : null}
      </motion.div>
    </main>
  )
}

/** Three slim segments, one per real boot step. The active one carries a soft shimmer. */
function Track({ done, active, label }: { done: number; active: boolean; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Starting Mawl"
      aria-valuemin={0}
      aria-valuemax={STEPS.length}
      aria-valuenow={done}
      aria-valuetext={label}
      className="mt-7 flex w-[188px] gap-1.5"
    >
      {STEPS.map((step, i) => (
        <span
          key={step}
          data-state={i < done ? 'done' : i === done && active ? 'active' : 'todo'}
          className="splash-step h-1.5 flex-1 rounded-pill"
        />
      ))}
    </div>
  )
}

function FailedActions({
  bridge,
  clipboard,
}: {
  bridge: HostBridge
  clipboard: Pick<Clipboard, 'writeText'> | undefined
}) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const [busy, setBusy] = useState<'retry' | 'quit' | undefined>()
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(reset.current), [])

  const copyDiagnostics = useCallback(async () => {
    clearTimeout(reset.current)
    setCopy('copying')
    try {
      if (!clipboard) throw new Error('no clipboard')
      await clipboard.writeText(await bridge.diagnostics())
      setCopy('copied')
    } catch {
      setCopy('error')
    }
    reset.current = setTimeout(() => setCopy('idle'), COPIED_MS)
  }, [bridge, clipboard])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: transitions.gentle }}
      className="mt-8 flex w-full flex-col items-stretch gap-2.5"
    >
      <Button
        variant="primary"
        disabled={busy !== undefined}
        onClick={() => {
          setBusy('retry')
          void bridge.retry().finally(() => setBusy(undefined))
        }}
      >
        Try again
      </Button>
      <Button variant="soft" onClick={() => void copyDiagnostics()} disabled={copy === 'copying'}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copy === 'copied' ? 'copied' : 'copy'}
            className="inline-flex items-center gap-2"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, transition: transitions.bouncy }}
            exit={{ opacity: 0, scale: 0.9, transition: transitions.exit }}
          >
            {copy === 'copied' ? (
              <>
                <Check aria-hidden="true" className="text-ok" />
                Copied
              </>
            ) : (
              <>
                <Copy aria-hidden="true" />
                Copy diagnostics
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </Button>
      <Button
        variant="ghost"
        disabled={busy !== undefined}
        onClick={() => {
          setBusy('quit')
          void bridge.quit()
        }}
      >
        Quit Mawl
      </Button>
      <p role="status" aria-live="polite" className="min-h-5 text-small text-text-2">
        {copy === 'copied'
          ? 'Diagnostics copied. Paste them into your report.'
          : copy === 'error'
            ? 'Couldn’t reach the clipboard. Try again.'
            : ''}
      </p>
    </motion.div>
  )
}
