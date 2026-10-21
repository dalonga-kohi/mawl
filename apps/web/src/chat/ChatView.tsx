import {
  type Message,
  type Profile,
  parseModelRef,
  type Run,
  type RunId,
  type ThreadId,
} from '@mawl/contracts'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  ArrowDown,
  CalendarDays,
  CircleAlert,
  CircleStop,
  FileText,
  type LucideIcon,
  PenLine,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveStatus, useRunText } from '../api/ApiProvider.tsx'
import { errorCode } from '../api/providers-api.ts'
import { Mawl } from '../mascot/Mawl.tsx'
import { useMascotState } from '../mascot/mascot-state.ts'
import type { MascotState } from '../mascot/states.ts'
import { enter, press, transitions } from '../motion/presets.ts'
import { useProfile } from '../profile/useProfile.ts'
import { useCredentials } from '../settings/models/queries.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { ShowSidebarButton } from '../shell/ShowSidebarButton.tsx'
import { ContextPanelBody } from '../teammates/ContextPanel.tsx'
import {
  useCancelRun,
  useMessages,
  useProfiles,
  useRun,
  useStartRun,
  useThreads,
} from '../teammates/queries.ts'
import { SidePanel } from '../teammates/SidePanel.tsx'
import { PanelToggle } from '../teammates/TeammatesView.tsx'
import { Button, buttonClass, IconButton } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { Markdown } from './Markdown.tsx'
import { MessageItem, UserBubble, userText } from './MessageItem.tsx'
import { failureCopy, isActive, statusLine } from './run-copy.ts'
import { ThreadMenu } from './ThreadMenu.tsx'

/** The new-chat suggestions. Picking one fills the composer; the owner still sends it. */
const SUGGESTIONS: { text: string; icon: LucideIcon }[] = [
  { text: 'Plan my week', icon: CalendarDays },
  { text: 'Summarize something', icon: FileText },
  { text: 'Draft a reply', icon: PenLine },
]

/** The chat column: messages, the landing and the composer share one width. */
const COLUMN = 'mx-auto w-full max-w-[720px]'

/** Within this many pixels of the bottom, new text keeps the view pinned to the latest message. */
const PIN_SLACK = 80

/** The run to follow: the newest user message's, unless its reply is already stored. */
function pendingRunOf(messages: Message[]): RunId | undefined {
  const lastUser = messages.findLast((m) => m.role === 'user')
  if (!lastUser?.runId) return undefined
  const replied = messages.some((m) => m.role === 'assistant' && m.runId === lastUser.runId)
  return replied ? undefined : lastUser.runId
}

/** "What's next, Sam?" from the owner's profile name; just "What's next?" without one. */
export function greeting(ownerName: string): string {
  const first = ownerName.trim().split(/\s+/)[0]
  return first ? `What's next, ${first}?` : "What's next?"
}

/** `/t/$slug`: a teammate's conversation. */
export function ChatView() {
  const { slug } = useParams({ from: '/t/$slug' })
  const search = useSearch({ from: '/t/$slug' })
  const profiles = useProfiles()
  const profile = profiles.data?.find((p) => p.slug === slug)

  if (profiles.isPending) return <ChatSkeleton />
  if (profiles.isError) {
    return (
      <EmptyState
        title="Can't reach your teammates"
        mascot="oops"
        action={<Button onClick={() => void profiles.refetch()}>Try again</Button>}
      >
        The Mawl server didn't answer. Check that it's running, then try again.
      </EmptyState>
    )
  }
  if (!profile) {
    return (
      <EmptyState
        title="No teammate here"
        mascot="idle"
        action={
          <Link to="/t" className={buttonClass('primary')}>
            See your teammates
          </Link>
        }
      >
        This teammate may have been renamed or archived.
      </EmptyState>
    )
  }
  return <Conversation key={profile.id} profile={profile} threadParam={search.thread} />
}

function Conversation({
  profile,
  threadParam,
}: {
  profile: Profile
  threadParam: string | undefined
}) {
  const navigate = useNavigate()
  const { setMascot, compact } = useShell()
  const { profile: owner } = useProfile()
  const threads = useThreads(profile.id)
  const credentials = useCredentials()
  // No param: the latest conversation, or a new one when there is none yet.
  const threadId: ThreadId | undefined =
    threadParam === 'new'
      ? undefined
      : ((threadParam as ThreadId | undefined) ?? threads.data?.[0]?.id)
  const resolving = threadParam === undefined && threads.isPending

  const messagesQuery = useMessages(threadId)
  const messages = messagesQuery.messages

  // What the owner just sent, shown until the stored message arrives.
  const [pending, setPending] = useState<{
    prompt: string
    runId?: RunId
    threadId?: ThreadId
  } | null>(null)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const composer = useRef<ComposerHandle>(null)

  // Counts conversation switches: a send that resolves after the owner moved on must not pull the
  // view back or re-show its bubble here.
  const viewSeq = useRef(0)
  // Leaving for another conversation drops a pending send that belongs elsewhere.
  useEffect(() => {
    viewSeq.current++
    setPending((p) => (p && p.threadId !== threadId ? null : p))
    setSendError(null)
  }, [threadId])

  const derivedRunId = pendingRunOf(messages)
  const runId = derivedRunId ?? pending?.runId
  const runQuery = useRun(runId)
  const run = runQuery.data
  const text = useRunText(runId)
  // The send is in flight: no run id yet.
  const starting = pending !== null && pending.runId === undefined
  const active = isActive(run?.status) || starting

  const start = useStartRun()
  const cancel = useCancelRun()
  const live = useLiveStatus()

  const mascot = useMascotState({
    run: starting ? 'queued' : run?.status,
    typing: focused && draft.trim().length > 0,
  })
  useEffect(() => setMascot(mascot), [mascot, setMascot])
  useEffect(() => () => setMascot('idle'), [setMascot])

  const showPendingBubble =
    pending !== null &&
    !messages.some((m) => m.role === 'user' && pending.runId && m.runId === pending.runId)

  const send = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed) return
      setSendError(null)
      const seq = viewSeq.current
      setPending({ prompt: trimmed, ...(threadId ? { threadId } : {}) })
      setDraft('')
      start.mutate(
        { profileId: profile.id, prompt: trimmed, ...(threadId ? { threadId } : {}) },
        {
          onSuccess: (started) => {
            if (viewSeq.current !== seq) return
            const tid = started.threadId ?? undefined
            setPending({
              prompt: trimmed,
              runId: started.id,
              ...(tid ? { threadId: tid } : {}),
            })
            if (tid && tid !== threadId) {
              void navigate({
                to: '/t/$slug',
                params: { slug: profile.slug },
                search: { thread: tid },
                replace: threadParam === 'new' || threadParam === undefined,
              })
            }
          },
          onError: (err) => {
            if (viewSeq.current !== seq) return
            setPending(null)
            setDraft(trimmed)
            setSendError(
              errorCode(err) === undefined
                ? "Couldn't reach the Mawl server, so nothing was sent. Check that it's running."
                : errorCode(err) === 'NOT_FOUND'
                  ? 'This conversation is gone. Start a new chat and send it again.'
                  : "Mawl couldn't send that. Try again.",
            )
            composer.current?.focus()
          },
        },
      )
    },
    [navigate, profile.id, profile.slug, start, threadId, threadParam],
  )

  const stop = () => {
    if (runId) cancel.mutate(runId)
  }

  // A failed run is retried by sending the owner's last words again.
  const lastPrompt = (() => {
    const last = messages.findLast((m) => m.role === 'user')
    return last ? userText(last) : pending?.prompt
  })()
  const retry = lastPrompt && !active ? () => send(lastPrompt) : undefined

  const modelRef = parseModelRef(profile.modelMain)
  const model = modelRef?.modelId
  const credentialLabel = credentials.data?.find((c) => c.id === modelRef?.credentialId)?.label
  const modelTitle = credentialLabel ? `${credentialLabel} / ${model}` : model
  // A disabled query (new chat, no thread yet) stays pending in TanStack Query v5.
  const settled = threadId === undefined || !messagesQuery.isPending
  const empty = !resolving && settled && messages.length === 0 && !pending
  const loading = resolving || (threadId !== undefined && messagesQuery.isPending)
  const threadsFailed = threadParam === undefined && threads.isError
  const landing = empty && !threadsFailed && !messagesQuery.isError
  // One id per conversation: the landing's big Mawl and the header's small one are the same Mawl.
  const mawlId = `chat-mawl-${profile.id}`

  const header = (
    <header className="flex min-h-16 items-center gap-2 px-3 py-2 md:px-4">
      <ShowSidebarButton />
      {landing ? null : (
        <motion.span
          layoutId={mawlId}
          transition={transitions.gentle}
          className="grid size-10 shrink-0 place-items-center"
        >
          <Mawl size={34} state={mascot} />
        </motion.span>
      )}
      <div className={cx('flex min-w-0 flex-1 flex-col', landing && 'pl-1')}>
        <h1 className="truncate text-heading">{profile.name}</h1>
        <p className="flex min-w-0 items-center gap-1.5 text-micro text-text-2">
          {active ? <span className="live-dot shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">
            {live === 'reconnecting'
              ? 'Reconnecting…'
              : statusLine(starting ? 'queued' : run?.status, text.length > 0)}
          </span>
        </p>
      </div>
      {model ? (
        <span
          title={modelTitle}
          className="hidden h-7 max-w-[20ch] shrink-0 items-center truncate rounded-pill px-2.5 font-mono text-micro text-text-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 md:inline-flex"
        >
          {model}
        </span>
      ) : null}
      <ThreadMenu
        threads={threads.data ?? []}
        current={threadId}
        onPick={(id) =>
          void navigate({
            to: '/t/$slug',
            params: { slug: profile.slug },
            search: { thread: id },
          })
        }
        onNew={() => {
          void navigate({
            to: '/t/$slug',
            params: { slug: profile.slug },
            search: { thread: 'new' },
          })
          composer.current?.focus()
        }}
      />
      <PanelToggle />
    </header>
  )

  // Children keep their positions (header, body, composer, suggestions, announcer), so the
  // composer is the same element on the landing and docked: it keeps its text and focus.
  return (
    <>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label={`Chat with ${profile.name}`}
      >
        {header}
        {threadsFailed ? (
          <EmptyState
            title="Couldn't load your conversations"
            mascot="oops"
            action={<Button onClick={() => void threads.refetch()}>Try again</Button>}
          >
            The Mawl server didn't send this teammate's conversations. Check that it's running.
          </EmptyState>
        ) : loading ? (
          <MessagesSkeleton />
        ) : messagesQuery.isError ? (
          <EmptyState
            title="Couldn't load this conversation"
            mascot="oops"
            action={<Button onClick={() => void messagesQuery.refetch()}>Try again</Button>}
          >
            The Mawl server didn't send the messages. Check that it's running.
          </EmptyState>
        ) : empty ? (
          <Landing
            greeting={greeting(owner.name)}
            mascot={mascot}
            mascotSize={compact ? 88 : 120}
            layoutId={mawlId}
          />
        ) : (
          <MessageScroller
            follow={`${messages.length}:${text.length}:${run?.status ?? ''}:${pending?.prompt ?? ''}`}
            canLoadEarlier={messagesQuery.hasNextPage}
            loadingEarlier={messagesQuery.isFetchingNextPage}
            onLoadEarlier={() => void messagesQuery.fetchNextPage()}
          >
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
            {showPendingBubble && pending ? <UserBubble text={pending.prompt} pending /> : null}
            <RunTail
              run={run}
              text={text}
              starting={starting}
              name={profile.name}
              onRetry={retry}
            />
          </MessageScroller>
        )}
        <motion.div
          layout="position"
          transition={{ layout: transitions.gentle }}
          className={cx(
            'px-3 md:px-6',
            landing ? 'pt-2' : 'pt-1 pb-[max(12px,env(safe-area-inset-bottom))] md:pb-5',
          )}
        >
          <div className={cx(COLUMN, 'flex flex-col gap-2')}>
            <AnimatePresence>
              {sendError ? (
                <motion.p
                  role="alert"
                  {...enter}
                  className="flex items-start gap-2 rounded-card bg-danger-soft px-4 py-2.5 text-small text-danger"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {sendError}
                </motion.p>
              ) : null}
            </AnimatePresence>
            <Composer
              ref={composer}
              value={draft}
              onChange={setDraft}
              onSend={() => send(draft)}
              onStop={stop}
              busy={active}
              sending={start.isPending}
              // Stop needs the run's id, which arrives with the send's answer.
              stopping={cancel.isPending || runId === undefined}
              label={`Message ${profile.name}`}
              placeholder={`Ask ${profile.name} to do something`}
              onFocusChange={setFocused}
            />
          </div>
        </motion.div>
        {landing ? (
          <Suggestions
            onPick={(s) => {
              setDraft(s)
              composer.current?.focus()
            }}
          />
        ) : null}
        <Announcer run={run} name={profile.name} />
      </section>
      <SidePanel>
        <ContextPanelBody run={run} />
      </SidePanel>
    </>
  )
}

/**
 * The top half of a new chat: a large Mawl and one line. The composer sits in the middle of the
 * view and the suggestions below it, so the three read as one centered column.
 */
function Landing({
  greeting,
  mascot,
  mascotSize,
  layoutId,
}: {
  greeting: string
  mascot: MascotState
  mascotSize: number
  layoutId: string
}) {
  return (
    <section
      aria-label="New chat"
      className="flex min-h-0 flex-1 flex-col items-center justify-end gap-3 overflow-hidden px-6 pb-5 text-center"
    >
      <motion.div layoutId={layoutId} transition={transitions.gentle}>
        <Mawl size={mascotSize} state={mascot} />
      </motion.div>
      <h2 className="font-display text-title md:text-display">{greeting}</h2>
    </section>
  )
}

function Suggestions({ onPick }: { onPick: (suggestion: string) => void }) {
  return (
    <div className="flex flex-[1.25] justify-center overflow-hidden px-4 pt-4 pb-6">
      <ul className="flex h-fit flex-wrap justify-center gap-2" aria-label="Suggestions">
        {SUGGESTIONS.map(({ text, icon: Icon }) => (
          <li key={text}>
            <motion.button
              type="button"
              onClick={() => onPick(text)}
              {...press}
              className="flex h-9 items-center gap-2 rounded-pill px-3.5 text-small text-text-2 shadow-[0_0_0_1px_var(--line)] transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-text pointer-coarse:h-11"
            >
              <Icon className="size-4" aria-hidden="true" />
              {text}
            </motion.button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What follows the last user message: the streaming reply, a failure, or a stop note. */
function RunTail({
  run,
  text,
  starting,
  name,
  onRetry,
}: {
  run: Run | undefined
  text: string
  starting: boolean
  name: string
  onRetry: (() => void) | undefined
}) {
  if (starting) return <Thinking name={name} />
  if (!run) return null
  if (text && run.status === 'cancelled') {
    return (
      <motion.div {...enter} className="flex max-w-[68ch] flex-col gap-2">
        <div className="text-text-2">
          <Markdown text={text} />
        </div>
        <p className="flex items-center gap-1.5 text-small text-text-2">
          <CircleStop className="size-4" aria-hidden="true" />
          Stopped. The partial reply above isn't saved.
        </p>
      </motion.div>
    )
  }
  if (text) {
    return (
      <motion.article
        {...enter}
        aria-label={`${name} is replying`}
        aria-busy={isActive(run.status)}
        className={cx('flex max-w-[68ch] flex-col gap-3', isActive(run.status) && 'stream-caret')}
      >
        <Markdown text={text} />
      </motion.article>
    )
  }
  if (isActive(run.status)) return <Thinking name={name} />
  if (run.status === 'failed') return <RunFailure run={run} onRetry={onRetry} />
  if (run.status === 'cancelled') {
    return (
      <motion.p {...enter} className="flex items-center gap-1.5 text-small text-text-2">
        <CircleStop className="size-4" aria-hidden="true" />
        Stopped. Nothing more will happen for this message.
      </motion.p>
    )
  }
  return null
}

function Thinking({ name }: { name: string }) {
  return (
    <motion.div
      {...enter}
      className="flex h-8 items-center gap-1.5"
      role="status"
      aria-label={`${name} is thinking`}
    >
      {/* A CSS pulse, so reduced motion (OS or in-app) stops it like every other animation. */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="thinking-dot size-2 rounded-pill bg-text-3"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </motion.div>
  )
}

function RunFailure({ run, onRetry }: { run: Run; onRetry: (() => void) | undefined }) {
  const copy = failureCopy(run.error)
  return (
    <motion.div
      {...enter}
      role="alert"
      className="flex max-w-[68ch] items-start gap-3 rounded-card bg-danger-soft p-4 text-danger"
    >
      <CircleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">{copy.title}</p>
        <p className="text-small">{copy.hint}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {copy.action === 'models' ? (
            <Link to="/settings" hash="models" className={buttonClass('ghost', 'sm')}>
              Open model settings
            </Link>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}

/**
 * Screen readers hear when a reply finishes or fails, once, instead of every streamed token
 * (DESIGN.md §11: live regions stay polite and throttled).
 */
function Announcer({ run, name }: { run: Run | undefined; name: string }) {
  const [message, setMessage] = useState('')
  const previous = useRef(run?.status)
  useEffect(() => {
    const before = previous.current
    previous.current = run?.status
    if (!run || before === run.status || !isActive(before)) return
    if (run.status === 'succeeded') setMessage(`${name} replied.`)
    else if (run.status === 'failed')
      setMessage(`${name} couldn't finish: ${failureCopy(run.error).title}`)
    else if (run.status === 'cancelled') setMessage('Stopped.')
  }, [run, name])
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  )
}

function MessageScroller({
  follow,
  children,
  canLoadEarlier,
  loadingEarlier,
  onLoadEarlier,
}: {
  /** Changes whenever new content arrives at the bottom. */
  follow: string
  children: ReactNode
  canLoadEarlier: boolean
  loadingEarlier: boolean
  onLoadEarlier: () => void
}) {
  const box = useRef<HTMLElement>(null)
  const [pinned, setPinned] = useState(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `follow` is the trigger by design.
  useLayoutEffect(() => {
    const el = box.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [follow])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Not a live region: the Announcer speaks for it, once per reply. */}
      <section
        ref={box}
        aria-label="Messages"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK)
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-offset-[-2px]"
      >
        <div className={cx(COLUMN, 'flex flex-col gap-7 px-4 pt-4 pb-8 md:px-6')}>
          {canLoadEarlier ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-center"
              disabled={loadingEarlier}
              onClick={onLoadEarlier}
            >
              {loadingEarlier ? 'Loading…' : 'Show earlier messages'}
            </Button>
          ) : null}
          {children}
        </div>
      </section>
      <AnimatePresence>
        {pinned ? null : (
          <motion.div
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: transitions.gentle }}
            exit={{ opacity: 0, transition: transitions.exit }}
          >
            <IconButton
              label="Jump to latest"
              tooltipSide="top"
              className="bg-surface text-text shadow-[0_0_0_1px_var(--line),var(--shadow-2)] hover:bg-surface"
              onClick={() => {
                const el = box.current
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() })
                setPinned(true)
              }}
            >
              <ArrowDown aria-hidden="true" />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Smooth only for the owner's own jump to latest, never for stick-to-bottom while streaming. The OS
 * setting and the in-app toggle (a class on <html>) both turn it off.
 */
function scrollBehavior(): 'smooth' | 'auto' {
  const reduced =
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduced ? 'auto' : 'smooth'
}

function MessagesSkeleton() {
  return (
    <div aria-hidden="true" className={cx(COLUMN, 'flex flex-1 flex-col gap-7 px-4 pt-4 md:px-6')}>
      <span className="h-11 w-2/5 animate-pulse self-end rounded-card bg-surface-2" />
      <span className="flex flex-col gap-2.5">
        <span className="h-3 w-11/12 animate-pulse rounded-xs bg-surface-2" />
        <span className="h-3 w-4/5 animate-pulse rounded-xs bg-surface-2" />
        <span className="h-3 w-3/5 animate-pulse rounded-xs bg-surface-2" />
      </span>
      <span className="h-11 w-1/3 animate-pulse self-end rounded-card bg-surface-2" />
      <span className="flex flex-col gap-2.5">
        <span className="h-3 w-10/12 animate-pulse rounded-xs bg-surface-2" />
        <span className="h-3 w-2/3 animate-pulse rounded-xs bg-surface-2" />
      </span>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy="true">
      <div className="flex min-h-16 items-center gap-3 px-4">
        <span className="size-9 animate-pulse rounded-pill bg-surface-2" />
        <span className="h-4 w-40 animate-pulse rounded-xs bg-surface-2" />
      </div>
      <MessagesSkeleton />
    </section>
  )
}
