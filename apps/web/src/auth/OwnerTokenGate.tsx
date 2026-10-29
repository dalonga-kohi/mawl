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
import { hostWindowControls } from '../shell/window-controls.ts'
import { SplashFrame } from '../splash/SplashFrame.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Input.tsx'
import { clearStoredToken, readStoredToken, storeToken, type TokenCheck } from './token.ts'

type Phase =
  | { kind: 'ready'; token: string }
  | { kind: 'restoring' }
  | { kind: 'asking'; notice?: string }
  | { kind: 'checking' }
  | { kind: 'unreachable'; token: string }

const COPY = {
  wrong: "That token didn't work. Check it and try again.",
  stale: 'Your saved token no longer works. Enter the current one.',
  empty: 'Enter the owner token.',
}

/**
 * Holds the app back until there is a token the server accepts (D1.4). Desktop: the launch token
 * the Tauri host injected, used at once. Headless: a token saved in this tab (checked first), or
 * the one the owner types. A refused token is cleared, never kept.
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
    if (launch) return { kind: 'ready', token: launch }
    return readStoredToken(storage) ? { kind: 'restoring' } : { kind: 'asking' }
  })
  const [attempt, setAttempt] = useState(0)

  const check = useCallback(
    async (token: string, saved: boolean) => {
      const result = await verify(token)
      if (result === 'ok') {
        storeToken(storage, token)
        setPhase({ kind: 'ready', token })
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

  if (phase.kind === 'ready') return children(phase.token)

  return (
    <SplashFrame controls={hostWindowControls()}>
      <main className="grid min-h-[calc(100dvh-var(--titlebar-h))] place-items-center bg-bg px-5 py-10 text-text">
        <div className="flex w-full max-w-[400px] flex-col items-center text-center">
          {phase.kind === 'restoring' ? (
            <div role="status" className="flex flex-col items-center gap-4">
              <Mawl size={88} state="thinking" />
              <p className="text-text-2">Connecting to Mawl…</p>
            </div>
          ) : phase.kind === 'unreachable' ? (
            <Unreachable
              onRetry={() => {
                setPhase({ kind: 'checking' })
                void check(phase.token, false)
              }}
            />
          ) : (
            <TokenForm
              // A new form per refusal: the field starts empty and focused for the next try.
              key={attempt}
              checking={phase.kind === 'checking'}
              notice={phase.kind === 'asking' ? phase.notice : undefined}
              onSubmit={(token) => {
                setPhase({ kind: 'checking' })
                void check(token, false)
              }}
            />
          )}
        </div>
      </main>
    </SplashFrame>
  )
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Mawl size={88} state="sleepy" />
      <h1 className="mt-3 font-display text-title text-balance">Can't reach the Mawl server</h1>
      <p className="text-pretty text-text-2">
        Check that it is running and that this address is the one it listens on.
      </p>
      <Button variant="primary" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function TokenForm({
  checking,
  notice,
  onSubmit,
}: {
  checking: boolean
  notice: string | undefined
  onSubmit: (token: string) => void
}) {
  const ids = { field: useId(), help: useId(), error: useId() }
  const [value, setValue] = useState('')
  const [empty, setEmpty] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const error = empty ? COPY.empty : notice

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
      <Mawl size={88} state="waiting" />
      <h1 className="mt-5 font-display text-title text-balance">Enter your owner token</h1>
      <p id={ids.help} className="mt-2 text-pretty text-text-2">
        This Mawl server opens only for its owner. The token is in the server's log from its first
        start, and in the owner-token file in its secrets folder.
      </p>
      <form
        noValidate
        onSubmit={submit}
        className="mt-6 flex w-full flex-col gap-3 rounded-card bg-surface p-5 text-left shadow-1"
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
