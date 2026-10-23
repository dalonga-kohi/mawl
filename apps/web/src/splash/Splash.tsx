import { Check, Copy } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import type { MascotState } from '../mascot/states.ts'
import { transitions } from '../motion/presets.ts'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Input.tsx'
import type { ConnectResult, HostBridge } from './bridge.ts'
import {
  type ConnectError,
  connectErrorCopy,
  describeRemote,
  type FieldMessage,
  hostOf,
  type RemoteHealth,
  type Target,
} from './remote.ts'
import { describe, INITIAL_STATUS, STEPS, type Status } from './status.ts'

/** How long "Ready" stays on screen so Mawl's hop reads, before the splash fades into the app. */
export const READY_HOLD_MS = 650
/** Matches the exit transition below. */
const EXIT_MS = 220
const COPIED_MS = 2000

type CopyState = 'idle' | 'copying' | 'copied' | 'error'

/** A host call that rejected instead of answering (an IPC failure): worded as a store error. */
const REJECTED: ConnectResult = { ok: false, error: { kind: 'store' } }

/** Runs a connect or switch call; a rejection becomes {@link REJECTED}, never a stuck screen. */
async function settle(call: () => Promise<ConnectResult>): Promise<ConnectResult> {
  try {
    return await call()
  } catch {
    return REJECTED
  }
}

/** `main`: the boot status (this PC's server or the remote check); `connect`: the form. */
export type SplashView = 'main' | 'connect'

type Screen =
  | { kind: 'main' }
  | { kind: 'connect'; address: string }
  | { kind: 'relaunching'; to: 'remote' | 'local' }

/**
 * The desktop splash: what the host's supervisor is doing while the server boots, restarts or
 * stops, the failed screen with its way out, and "Connect to a remote Mawl". Rendered by the
 * bundled `splash.html` in the Tauri origin; the app itself loads from the server (or the remote
 * Mawl) once it is ready.
 */
export function Splash({
  bridge,
  clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  initialView = 'main',
}: {
  bridge: HostBridge
  clipboard?: Pick<Clipboard, 'writeText'> | undefined
  initialView?: SplashView
}) {
  const [target, setTarget] = useState<Target | undefined>()
  const [screen, setScreen] = useState<Screen>(
    initialView === 'connect' ? { kind: 'connect', address: '' } : { kind: 'main' },
  )

  useEffect(() => {
    let alive = true
    bridge.target().then(
      (t) => alive && setTarget(t),
      () => alive && setTarget({ kind: 'local' }),
    )
    // After the first paint, so the window never shows a blank frame.
    window.requestAnimationFrame(() => void bridge.shown())
    return () => {
      alive = false
    }
  }, [bridge])

  const relaunchWith = useCallback(
    async (to: 'remote' | 'local', call: () => Promise<ConnectResult>): Promise<ConnectResult> => {
      const result = await settle(call)
      if (result.ok) setScreen({ kind: 'relaunching', to })
      return result
    },
    [],
  )

  const openConnect = useCallback(
    () =>
      setScreen({
        kind: 'connect',
        address: target?.kind === 'remote' ? target.origin : '',
      }),
    [target],
  )

  // Nothing to show until the host said which Mawl this window is for (a few milliseconds).
  if (!target) return <main className="min-h-dvh bg-bg" />

  if (screen.kind === 'relaunching') {
    return (
      <Frame>
        <Message
          mascot="working"
          title="Restarting Mawl"
          detail={
            screen.to === 'remote'
              ? 'Connected. Mawl opens again on your remote Mawl.'
              : 'Mawl opens again on this PC’s server.'
          }
        />
      </Frame>
    )
  }

  if (screen.kind === 'connect') {
    return (
      <ConnectForm
        initialAddress={screen.address}
        current={target.kind === 'remote' ? hostOf(target.origin) : undefined}
        onConnect={(url, token) => relaunchWith('remote', () => bridge.connectRemote(url, token))}
        onSwitchToLocal={() => relaunchWith('local', () => bridge.switchToLocal())}
        onCancel={() => setScreen({ kind: 'main' })}
      />
    )
  }

  return target.kind === 'remote' ? (
    <RemoteStatus
      bridge={bridge}
      origin={target.origin}
      onChange={openConnect}
      onSwitchToLocal={() => relaunchWith('local', () => bridge.switchToLocal())}
    />
  ) : (
    <LocalStatus bridge={bridge} clipboard={clipboard} onConnect={openConnect} />
  )
}

/** The centred column every splash screen shares; `leaving` fades it out into the app. */
function Frame({ children, leaving = false }: { children: ReactNode; leaving?: boolean }) {
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
        {children}
      </motion.div>
    </main>
  )
}

/** Mawl, then a title and a line that cross-fade when they change. */
function Message({
  mascot,
  title,
  detail,
}: {
  mascot: MascotState
  title: string
  detail: string
}) {
  return (
    <>
      <Mawl size={128} state={mascot} />
      <div
        role="status"
        aria-live="polite"
        className="mt-6 flex min-h-[4.5rem] flex-col items-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${title}|${detail}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: transitions.fade }}
            exit={{ opacity: 0, transition: transitions.exit }}
            className="flex flex-col items-center"
          >
            <h1 className="font-display text-title text-balance">{title}</h1>
            <p className="mt-1.5 text-pretty text-text-2">{detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

/** Ready: let Mawl hop, fade out, then hand the window to the app. */
function useEnterWhenReady(ready: boolean, bridge: HostBridge): boolean {
  const [leaving, setLeaving] = useState(false)
  const reduce = useReducedMotionConfig() ?? false

  useEffect(() => {
    if (!ready) {
      setLeaving(false)
      return
    }
    const hold = setTimeout(() => setLeaving(true), reduce ? 0 : READY_HOLD_MS)
    return () => clearTimeout(hold)
  }, [ready, reduce])

  useEffect(() => {
    if (!leaving) return
    const done = setTimeout(() => void bridge.enterApp(), reduce ? 0 : EXIT_MS)
    return () => clearTimeout(done)
  }, [leaving, bridge, reduce])

  return leaving
}

/** This PC's server: the supervisor's status, and the failed screen with its way out. */
function LocalStatus({
  bridge,
  clipboard,
  onConnect,
}: {
  bridge: HostBridge
  clipboard: Pick<Clipboard, 'writeText'> | undefined
  onConnect: () => void
}) {
  const [status, setStatus] = useState<Status>(INITIAL_STATUS)
  const view = describe(status)
  const leaving = useEnterWhenReady(status.phase === 'ready', bridge)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let alive = true
    // An event is always newer than the snapshot: once one arrives, a late snapshot is stale.
    let heard = false
    void bridge
      .onStatus((s) => {
        heard = true
        setStatus(s)
      })
      .then((off) => {
        if (alive) unlisten = off
        else off()
      })
    void bridge.status().then(
      (s) => {
        if (alive && !heard) setStatus(s)
      },
      () => {
        // No snapshot: the events will tell.
      },
    )
    return () => {
      alive = false
      unlisten?.()
    }
  }, [bridge])

  return (
    <Frame leaving={leaving}>
      <Message mascot={view.mascot} title={view.title} detail={view.detail} />
      {view.done === undefined ? null : (
        <Track done={view.done} active={view.active ?? false} label={view.detail} />
      )}
      {view.failed ? (
        <FailedActions bridge={bridge} clipboard={clipboard} onConnect={onConnect} />
      ) : null}
    </Frame>
  )
}

type RemotePhase =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'failed'; health: RemoteHealth }

/** A remote Mawl: one check (the remote proves it knows the token), then into the app. */
function RemoteStatus({
  bridge,
  origin,
  onChange,
  onSwitchToLocal,
}: {
  bridge: HostBridge
  origin: string
  onChange: () => void
  onSwitchToLocal: () => Promise<ConnectResult>
}) {
  const host = hostOf(origin)
  const [phase, setPhase] = useState<RemotePhase>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)
  const [switching, setSwitching] = useState(false)
  const [refused, setRefused] = useState<string | undefined>()
  const leaving = useEnterWhenReady(phase.kind === 'ready', bridge)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the check on Try again.
  useEffect(() => {
    let alive = true
    setPhase({ kind: 'checking' })
    bridge.checkRemote().then(
      (health) => {
        if (!alive) return
        setPhase(health === 'ready' ? { kind: 'ready' } : { kind: 'failed', health })
      },
      () => alive && setPhase({ kind: 'failed', health: 'unreachable' }),
    )
    return () => {
      alive = false
    }
  }, [bridge, attempt])

  const switchToLocal = async () => {
    setSwitching(true)
    setRefused(undefined)
    const result = await settle(onSwitchToLocal)
    if (!result.ok) {
      setSwitching(false)
      setRefused(connectErrorCopy(result.error).message)
    }
  }

  const message =
    phase.kind === 'failed'
      ? {
          mascot: 'oops' as const,
          title: 'Can’t reach your remote Mawl',
          detail: describeRemote(phase.health === 'ready' ? 'unreachable' : phase.health, host),
        }
      : phase.kind === 'ready'
        ? { mascot: 'done' as const, title: 'Ready', detail: `Opening ${host}` }
        : { mascot: 'thinking' as const, title: 'Connecting', detail: `Checking ${host}` }

  return (
    <Frame leaving={leaving}>
      <Message {...message} />
      {phase.kind === 'failed' ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: transitions.gentle }}
          className="mt-8 flex w-full flex-col items-stretch gap-2.5"
        >
          <Button variant="primary" disabled={switching} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
          <Button variant="soft" disabled={switching} onClick={onChange}>
            Change address
          </Button>
          <Button variant="ghost" disabled={switching} onClick={() => void switchToLocal()}>
            Use this PC’s Mawl
          </Button>
          {refused ? (
            <p role="alert" className="text-small text-danger">
              {refused}
            </p>
          ) : null}
        </motion.div>
      ) : null}
    </Frame>
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
  onConnect,
}: {
  bridge: HostBridge
  clipboard: Pick<Clipboard, 'writeText'> | undefined
  onConnect: () => void
}) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const [busy, setBusy] = useState<'retry' | 'quit' | undefined>()
  /** A Try again or Quit command the host refused; the buttons are usable again. */
  const [refused, setRefused] = useState<string | undefined>()
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)
  const alive = useRef(true)

  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const run = useCallback((kind: 'retry' | 'quit', command: () => Promise<void>) => {
    setBusy(kind)
    setRefused(undefined)
    command().then(
      // Success: the host's next status replaces this screen.
      () => alive.current && setBusy(undefined),
      () => {
        if (!alive.current) return
        setBusy(undefined)
        setRefused(
          kind === 'retry'
            ? 'Mawl couldn’t restart the server. Try again, or quit and open Mawl again.'
            : 'Mawl couldn’t quit. Try again, or close it from the tray.',
        )
      },
    )
  }, [])

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
        onClick={() => run('retry', () => bridge.retry())}
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
      <Button variant="ghost" disabled={busy !== undefined} onClick={onConnect}>
        Connect to a remote Mawl
      </Button>
      <Button
        variant="ghost"
        disabled={busy !== undefined}
        onClick={() => run('quit', () => bridge.quit())}
      >
        Quit Mawl
      </Button>
      {refused ? (
        <p role="alert" className="text-small text-danger">
          {refused}
        </p>
      ) : null}
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

/**
 * "Connect to a remote Mawl": an address and the owner token. The host checks both, asks the
 * remote to prove it knows the token, and only then saves them and restarts Mawl on it. The token
 * stays in this component's state until it goes to the host; it is never shown or stored here.
 */
function ConnectForm({
  initialAddress,
  current,
  onConnect,
  onSwitchToLocal,
  onCancel,
}: {
  initialAddress: string
  /** The remote Mawl in use now, if any. */
  current: string | undefined
  onConnect: (url: string, token: string) => Promise<ConnectResult>
  onSwitchToLocal: () => Promise<ConnectResult>
  onCancel: () => void
}) {
  const ids = {
    address: useId(),
    addressHelp: useId(),
    token: useId(),
    tokenHelp: useId(),
    error: useId(),
  }
  const [address, setAddress] = useState(initialAddress)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'connect' | 'local' | undefined>()
  const [problem, setProblem] = useState<FieldMessage | undefined>()
  const addressField = useRef<HTMLInputElement>(null)
  const tokenField = useRef<HTMLInputElement>(null)

  /** The field to focus once the form is enabled again (a disabled input cannot take focus). */
  const [focusAfter, setFocusAfter] = useState<'url' | 'token' | undefined>()

  useEffect(() => {
    if (!focusAfter || busy) return
    ;(focusAfter === 'url' ? addressField : tokenField).current?.focus()
    setFocusAfter(undefined)
  }, [focusAfter, busy])

  const fail = (error: ConnectError) => {
    const copy = connectErrorCopy(error)
    setProblem(copy)
    if (copy.field !== 'form') setFocusAfter(copy.field)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy('connect')
    setProblem(undefined)
    const result = await settle(() => onConnect(address, token))
    if (!result.ok) {
      setBusy(undefined)
      fail(result.error)
    }
  }

  const switchToLocal = async () => {
    setBusy('local')
    setProblem(undefined)
    const result = await settle(onSwitchToLocal)
    if (!result.ok) {
      setBusy(undefined)
      fail(result.error)
    }
  }

  const describedBy = (field: 'url' | 'token', help: string) =>
    problem?.field === field ? `${ids.error} ${help}` : help
  const errorLine = problem ? (
    <p id={ids.error} role="alert" className="text-small text-danger">
      {problem.message}
    </p>
  ) : null

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-10 text-text">
      <motion.div
        className="flex w-full max-w-[400px] flex-col items-center text-center"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: transitions.gentle }}
      >
        <Mawl size={88} state="waiting" />
        <h1 className="mt-5 font-display text-title text-balance">Connect to a remote Mawl</h1>
        <p className="mt-2 text-pretty text-text-2">
          Open a Mawl that runs on another computer, such as a home server you reach over Tailscale.
          Nothing is saved until that Mawl accepts the token.
        </p>
        {current ? <p className="mt-2 text-small text-text-2">Now showing {current}.</p> : null}

        <form
          noValidate
          onSubmit={(e) => void submit(e)}
          className="mt-6 flex w-full flex-col gap-3 rounded-card bg-surface p-5 text-left shadow-1"
        >
          <label htmlFor={ids.address} className="text-small font-semibold text-text-2">
            Address
          </label>
          <Input
            ref={addressField}
            id={ids.address}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            // The first thing to do on this page.
            autoFocus
            placeholder="https://mawl.example.ts.net"
            value={address}
            disabled={busy !== undefined}
            onChange={(e) => {
              setAddress(e.target.value)
              if (problem?.field === 'url') setProblem(undefined)
            }}
            aria-invalid={problem?.field === 'url'}
            aria-describedby={describedBy('url', ids.addressHelp)}
          />
          <p id={ids.addressHelp} className="-mt-1 text-small text-text-2">
            Where that Mawl serves its web app. It starts with https://, so the token travels
            encrypted.
          </p>
          {problem?.field === 'url' ? errorLine : null}

          <label htmlFor={ids.token} className="mt-1 text-small font-semibold text-text-2">
            Owner token
          </label>
          <Input
            ref={tokenField}
            id={ids.token}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={token}
            disabled={busy !== undefined}
            onChange={(e) => {
              setToken(e.target.value)
              if (problem?.field === 'token') setProblem(undefined)
            }}
            aria-invalid={problem?.field === 'token'}
            aria-describedby={describedBy('token', ids.tokenHelp)}
            className="font-mono"
          />
          <p id={ids.tokenHelp} className="-mt-1 text-small text-text-2">
            From that server’s log at its first start, or the owner-token file in its secrets
            folder.
          </p>
          {problem?.field === 'token' ? errorLine : null}
          {problem?.field === 'form' ? errorLine : null}

          <div className="mt-2 flex flex-col-reverse gap-2.5">
            <Button type="button" variant="ghost" disabled={busy !== undefined} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy !== undefined}>
              {busy === 'connect' ? 'Checking…' : 'Connect'}
            </Button>
          </div>
        </form>

        {current ? (
          <Button
            variant="soft"
            className="mt-4 w-full"
            disabled={busy !== undefined}
            onClick={() => void switchToLocal()}
          >
            Use this PC’s Mawl
          </Button>
        ) : null}
      </motion.div>
    </main>
  )
}
