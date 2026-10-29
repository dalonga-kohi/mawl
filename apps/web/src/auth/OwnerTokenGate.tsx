import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import type { MascotState } from '../mascot/states.ts'
import { type EntryFrom, EntryHandoff } from '../motion/entry.tsx'
import { hostWindowControls } from '../shell/window-controls.ts'
import { SplashField } from '../splash/Field.tsx'
import { Actions, Caption, LaunchFrame } from '../splash/LaunchFrame.tsx'
import { SplashFrame } from '../splash/SplashFrame.tsx'
import { OrbStage } from '../splash/Stage.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Input.tsx'
import { clearStoredToken, readStoredToken, storeToken, type TokenCheck } from './token.ts'

type Phase =
  | { kind: 'ready'; token: string; from: EntryFrom | undefined }
  | { kind: 'restoring' }
  | { kind: 'asking'; notice?: string }
  | { kind: 'checking' }
  | { kind: 'unreachable'; token: string }
  | { kind: 'retrying'; token: string }

const COPY = {
  wrong: "That token didn't work. Check it and try again.",
  stale: 'Your saved token no longer works. Enter the current one.',
  empty: 'Enter the owner token.',
}

/** Where the gate's orb is now, for the hand-off into the app; `undefined` when none is drawn. */
function orbFrom(box: RefObject<HTMLElement | null>): EntryFrom | undefined {
  const svg = box.current?.querySelector('svg')
  if (!svg) return undefined
  const r = svg.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width }
}

/**
 * Holds the app back until there is a token the server accepts (D1.4). Desktop: the launch token
 * the Tauri host injected, used at once, and the orb the splash left in the middle of the window
 * flies into the app. Headless: a token saved in this tab (checked first), or the one the owner
 * types; the gate's own orb flies into the app. A refused token is cleared, never kept.
 */
export function OwnerTokenGate({
  launch,
  storage,
  verify,
  children,
}: {
  launch?: string
  storage: Storage | null
  verify: (token: string) => Promise<TokenCheck>
  children: (token: string) => ReactNode
}) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (launch) return { kind: 'ready', token: launch, from: 'centre' }
    return readStoredToken(storage) ? { kind: 'restoring' } : { kind: 'asking' }
  })
  const [attempt, setAttempt] = useState(0)
  const [tries, setTries] = useState(0)
  const orb = useRef<HTMLSpanElement>(null)

  const check = useCallback(
    async (token: string, saved: boolean) => {
      const result = await verify(token)
      if (result === 'ok') {
        storeToken(storage, token)
        setPhase({ kind: 'ready', token, from: orbFrom(orb) })
      } else if (result === 'unauthorized') {
        clearStoredToken(storage)
        setAttempt((n) => n + 1)
        setPhase({ kind: 'asking', notice: saved ? COPY.stale : COPY.wrong })
      } else {
        setPhase({ kind: 'unreachable', token })
      }
    },
    [storage, verify],
  )

  // A token saved earlier in this tab: check it once before showing anything.
  const restored = useRef(false)
  useEffect(() => {
    if (phase.kind !== 'restoring' || restored.current) return
    restored.current = true
    const token = readStoredToken(storage)
    if (token) void check(token, true)
    else setPhase({ kind: 'asking' })
  }, [phase.kind, storage, check])

  if (phase.kind === 'ready') {
    return <EntryHandoff from={phase.from}>{children(phase.token)}</EntryHandoff>
  }

  const retry = (token: string) => {
    setTries((n) => n + 1)
    setPhase({ kind: 'retrying', token })
    void check(token, false)
  }

  return (
    <SplashFrame controls={hostWindowControls()}>
      {phase.kind === 'restoring' || phase.kind === 'retrying' ? (
        <LaunchFrame
          stage={
            <OrbStage
              orbRef={orb}
              mascot="thinking"
              mode={phase.kind === 'retrying' ? 'retry' : 'progress'}
              progress={{ done: 0, active: true, label: 'Connecting to Mawl' }}
              retry={phase.kind === 'retrying' ? { attempt: tries + 1 } : undefined}
            />
          }
        >
          <Caption
            title="Connecting to Mawl"
            detail={
              phase.kind === 'retrying'
                ? 'Trying the Mawl server again.'
                : 'Checking the token saved in this tab.'
            }
          />
        </LaunchFrame>
      ) : phase.kind === 'unreachable' ? (
        <LaunchFrame stage={<OrbStage orbRef={orb} mascot="oops" mode="failed" />}>
          <Caption
            title="Can't reach the Mawl server"
            detail="Check that it is running and that this address is the one it listens on."
          />
          <Actions>
            <Button variant="primary" className="w-full" onClick={() => retry(phase.token)}>
              Try again
            </Button>
          </Actions>
        </LaunchFrame>
      ) : (
        <main className="relative grid min-h-[calc(100dvh-var(--titlebar-h))] place-items-center overflow-hidden bg-bg px-5 py-10 text-text">
          <SplashField />
          <div className="relative flex w-full max-w-[400px] flex-col items-center text-center">
            <TokenForm
              // A new form per refusal: the field starts empty and focused for the next try.
              key={attempt}
              orb={orb}
              checking={phase.kind === 'checking'}
              notice={phase.kind === 'asking' ? phase.notice : undefined}
              onSubmit={(token) => {
                setPhase({ kind: 'checking' })
                void check(token, false)
              }}
            />
          </div>
        </main>
      )}
    </SplashFrame>
  )
}

function TokenForm({
  orb,
  checking,
  notice,
  onSubmit,
}: {
  orb: RefObject<HTMLSpanElement | null>
  checking: boolean
  notice: string | undefined
  onSubmit: (token: string) => void
}) {
  const ids = { field: useId(), help: useId(), error: useId() }
  const [value, setValue] = useState('')
  const [empty, setEmpty] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const error = empty ? COPY.empty : notice
  // The orb follows the form: asking, checking, or unhappy with the last answer.
  const mood: MascotState = checking ? 'thinking' : error ? 'oops' : 'waiting'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const token = value.trim()
    if (!token) {
      setEmpty(true)
      field.current?.focus()
      return
    }
    setEmpty(false)
    onSubmit(token)
  }

  return (
    <>
      <span ref={orb} className="splash-orb">
        <Mawl size={88} state={mood} />
      </span>
      <h1 className="mt-4 font-display text-title text-balance">Enter your owner token</h1>
      <p id={ids.help} className="mt-2 text-pretty text-text-2">
        This Mawl server opens only for its owner. The token is in the server's log from its first
        start, and in the owner-token file in its secrets folder.
      </p>
      <form
        noValidate
        onSubmit={submit}
        aria-busy={checking}
        className="mt-6 flex w-full flex-col gap-3 rounded-panel bg-surface p-5 text-left shadow-1"
      >
        <label htmlFor={ids.field} className="text-small font-semibold text-text-2">
          Owner token
        </label>
        <Input
          ref={field}
          id={ids.field}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // The only thing to do on this page.
          autoFocus
          value={value}
          disabled={checking}
          onChange={(e) => {
            setValue(e.target.value)
            if (empty) setEmpty(false)
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${ids.error} ${ids.help}` : ids.help}
          className="font-mono"
        />
        {error ? (
          <p id={ids.error} role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={checking}>
          {checking ? 'Checking…' : 'Open Mawl'}
        </Button>
      </form>
    </>
  )
}
