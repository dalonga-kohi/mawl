import {
  type Message,
  type Profile,
  parseModelRef,
  type Run,
  type RunId,
  type ThreadId,
} from '@faire/contracts'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowDown, ChevronLeft, CircleAlert, CircleStop } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveStatus, useRunText } from '../api/ApiProvider.tsx'
import { errorCode } from '../api/providers-api.ts'
import type { MascotState } from '../mascot/Beaver.tsx'
import { Beaver } from '../mascot/Beaver.tsx'
import { useMascotState } from '../mascot/mascot-state.ts'
import { enter, transitions } from '../motion/presets.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { MEDIUM, useMediaQuery } from '../shell/use-media-query.ts'
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
import { TeammateAvatar } from '../teammates/TeammateAvatar.tsx'
import { PanelToggle } from '../teammates/TeammatesView.tsx'
import { Button, buttonClass, IconButton } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { Markdown } from './Markdown.tsx'
import { MessageItem, UserBubble } from './MessageItem.tsx'
import { failureCopy, isActive, statusLine } from './run-copy.ts'
import { ThreadMenu } from './ThreadMenu.tsx'

const SUGGESTIONS = [
  'What can you help me with?',
  'Make a short plan for my day',
  'Explain something to me simply',
]

/** Within this many pixels of the bottom, new text keeps the view pinned to the latest message. */
const PIN_SLACK = 80

/** The run to follow: the newest user message's, unless its reply is already stored. */
function pendingRunOf(messages: Message[]): RunId | undefined {
  const lastUser = messages.findLast((m) => m.role === 'user')
  if (!lastUser?.runId) return undefined
  const replied = messages.some((m) => m.role === 'assistant' && m.runId === lastUser.runId)
  return replied ? undefined : lastUser.runId
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
        mascot="error"
        action={<Button onClick={() => void profiles.refetch()}>Try again</Button>}
      >
        The Faire server didn't answer. Check that it's running, then try again.
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
  const medium = useMediaQuery(MEDIUM)
  const { setMascot } = useShell()
  const threads = useThreads(profile.id)
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

  // Leaving for another conversation drops a pending send that belongs elsewhere.
  useEffect(() => {
    setPending((p) => (p && p.threadId !== undefined && p.threadId !== threadId ? null : p))
    setSendError(null)
  }, [threadId])

  const derivedRunId = pendingRunOf(messages)
  const runId = derivedRunId ?? pending?.runId
  const runQuery = useRun(runId)
  const run = runQuery.data
  const text = useRunText(runId)
  const active = isActive(run?.status) || (pending !== null && pending.runId === undefined)

  const start = useStartRun()
  const cancel = useCancelRun()
  const live = useLiveStatus()

  const mascot = useMascotState({
    run: run?.status,
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
      setPending({ prompt: trimmed, ...(threadId ? { threadId } : {}) })
      setDraft('')
      start.mutate(
        { profileId: profile.id, prompt: trimmed, ...(threadId ? { threadId } : {}) },
        {
          onSuccess: (started) => {
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
            setPending(null)
            setDraft(trimmed)
            setSendError(
              errorCode(err) === undefined
                ? "Couldn't reach the Faire server, so nothing was sent. Check that it's running."
                : errorCode(err) === 'NOT_FOUND'
                  ? 'This conversation is gone. Start a new chat and send it again.'
                  : "Faire couldn't send that. Try again.",
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

  const model = parseModelRef(profile.modelMain)?.modelId
  // A disabled query (new chat, no thread yet) stays pending in TanStack Query v5.
  const settled = threadId === undefined || !messagesQuery.isPending
  const empty = !resolving && settled && messages.length === 0 && !pending
  const loading = resolving || (threadId !== undefined && messagesQuery.isPending)

  const header = (
    <header className="flex min-h-[68px] items-center gap-3 border-b border-line px-3 py-3 md:px-5">
      {medium ? null : (
        <Link
          to="/t"
          aria-label="All teammates"
          className="grid size-11 shrink-0 place-items-center rounded-sm text-text-2 hover:bg-surface-2"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
      )}
      <TeammateAvatar color={profile.color} size={40} state={mascot} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-heading">{profile.name}</h1>
          <span className="flex shrink-0 items-center gap-1.5 text-small text-text-2">
            {active ? <span className="live-dot" aria-hidden="true" /> : null}
            {live === 'reconnecting' ? 'Reconnecting…' : statusLine(run?.status, text.length > 0)}
          </span>
        </div>
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
      </div>
      <PanelToggle />
    </header>
  )

  return (
    <>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg"
        aria-label={`Chat with ${profile.name}`}
      >
        {header}
        {loading ? (
          <MessagesSkeleton />
        ) : messagesQuery.isError ? (
          <EmptyState
            title="Couldn't load this conversation"
            mascot="error"
            action={<Button onClick={() => void messagesQuery.refetch()}>Try again</Button>}
          >
            The Faire server didn't send the messages. Check that it's running.
          </EmptyState>
        ) : empty ? (
          <ChatEmpty
            name={profile.name}
            mascot={mascot}
            onPick={(s) => {
              setDraft(s)
              composer.current?.focus()
            }}
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
              starting={pending !== null && pending.runId === undefined}
              name={profile.name}
            />
          </MessageScroller>
        )}
        <AnimatePresence>
          {sendError ? (
            <motion.p
              role="alert"
              {...enter}
              className="mx-auto mt-1 flex w-[min(76ch,calc(100%-24px))] items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-small text-danger"
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
          stopping={cancel.isPending}
          label={`Message ${profile.name}`}
          placeholder={`Ask ${profile.name} to do something`}
          model={model}
          onFocusChange={setFocused}
        />
        <Announcer run={run} name={profile.name} />
      </section>
      <SidePanel>
        <ContextPanelBody run={run} />
      </SidePanel>
    </>
  )
}

/** What follows the last user message: the streaming reply, a failure, or a stop note. */
function RunTail({
  run,
  text,
  starting,
  name,
}: {
  run: Run | undefined
  text: string
  starting: boolean
  name: string
}) {
  if (starting) return <Thinking name={name} />
  if (!run) return null
  if (text) {
    return (
      <motion.article
        {...enter}
        aria-label={`${name} is replying`}
        aria-busy={isActive(run.status)}
        className={cx('flex flex-col gap-2.5', isActive(run.status) && 'stream-caret')}
      >
        <Markdown text={text} />
      </motion.article>
    )
  }
  if (isActive(run.status)) return <Thinking name={name} />
  if (run.status === 'failed') return <RunFailure run={run} />
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
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-pill bg-text-3"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </motion.div>
  )
}

function RunFailure({ run }: { run: Run }) {
  const copy = failureCopy(run.error)
  return (
    <motion.div
      {...enter}
      role="alert"
      className="flex max-w-[60ch] items-start gap-3 rounded-md bg-danger-soft p-3.5 text-danger"
    >
      <CircleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">{copy.title}</p>
        <p className="text-small">{copy.hint}</p>
        {copy.action === 'models' ? (
          <Link
            to="/settings"
            hash="models"
            className="mt-1 w-fit text-small font-semibold underline underline-offset-2"
          >
            Open model settings
          </Link>
        ) : null}
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
  const box = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `follow` is the trigger by design.
  useLayoutEffect(() => {
    const el = box.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [follow])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK)
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-[76ch] flex-col gap-5 px-4 py-6 md:px-6">
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
      </div>
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
              className="bg-surface shadow-2"
              onClick={() => {
                const el = box.current
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
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

function ChatEmpty({
  name,
  mascot,
  onPick,
}: {
  name: string
  mascot: MascotState
  onPick: (suggestion: string) => void
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6 text-center">
      <div className="flex max-w-[44ch] flex-col items-center gap-2">
        <Beaver size={112} state={mascot} />
        <h2 className="mt-2 font-display text-title">{`Ask ${name} anything`}</h2>
        <p className="text-text-2">
          Give it a job in a sentence or two. It keeps working on your server, even if you close
          this window.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              whileTap={{ scale: 0.96 }}
              className="h-8 pointer-coarse:h-11 rounded-pill bg-surface-2 px-3 text-small font-semibold text-text-2 transition-colors duration-[120ms] hover:bg-accent-soft hover:text-accent-ink"
            >
              {s}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}

function MessagesSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full max-w-[76ch] flex-1 flex-col gap-5 px-4 py-6 md:px-6"
    >
      <span className="h-10 w-2/5 animate-pulse self-end rounded-md bg-surface-2" />
      <span className="flex flex-col gap-2">
        <span className="h-3 w-11/12 animate-pulse rounded-xs bg-surface-2" />
        <span className="h-3 w-4/5 animate-pulse rounded-xs bg-surface-2" />
        <span className="h-3 w-3/5 animate-pulse rounded-xs bg-surface-2" />
      </span>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-busy="true">
      <div className="flex min-h-[68px] items-center gap-3 border-b border-line px-5">
        <span className="size-10 animate-pulse rounded-sm bg-surface-2" />
        <span className="h-4 w-40 animate-pulse rounded-xs bg-surface-2" />
      </div>
      <MessagesSkeleton />
    </section>
  )
}
