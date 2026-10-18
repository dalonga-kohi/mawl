import type {
  Message,
  MessagePart,
  Profile,
  ProfileId,
  Run,
  RunErrorCode,
  RunId,
  Thread,
  ThreadId,
} from '@faire/contracts'
import type { QueryClient } from '@tanstack/react-query'
import type {
  LiveStatus,
  LiveStore,
  ProfileCreateInput,
  ProfilesApi,
  RunsApi,
  ThreadsApi,
} from '../api/chat-api.ts'
import { ApiError } from './fake-providers-api.ts'

let seq = 0
const ulid = () => `01JTEST${String(++seq).padStart(19, '0')}`
const NOW = '2026-10-18T10:00:00.000Z'

export function profile(patch: Partial<Profile> = {}): Profile {
  return {
    id: `prof_${ulid()}` as ProfileId,
    name: 'Inbox Sweeper',
    slug: 'inbox-sweeper',
    color: '#3D8BFD',
    personaMd: '',
    modelMain: 'cred_01JTEST0000000000000000001:gpt-test',
    modelHelper: null,
    heartbeatCron: null,
    createdAt: NOW,
    archivedAt: null,
    ...patch,
  }
}

export function thread(profileId: ProfileId, patch: Partial<Thread> = {}): Thread {
  return {
    id: `thr_${ulid()}` as ThreadId,
    profileId,
    channel: 'app',
    peer: null,
    title: 'Morning sweep',
    createdAt: NOW,
    lastEventAt: NOW,
    ...patch,
  }
}

export function message(
  threadId: ThreadId,
  role: Message['role'],
  parts: MessagePart[] | string,
  patch: Partial<Message> = {},
): Message {
  return {
    id: `msg_${ulid()}` as Message['id'],
    threadId,
    runId: null,
    role,
    parts: typeof parts === 'string' ? [{ type: 'text', text: parts }] : parts,
    tokenCount: null,
    createdAt: NOW,
    ...patch,
  }
}

function run(profileId: ProfileId, threadId: ThreadId, patch: Partial<Run> = {}): Run {
  return {
    id: `run_${ulid()}` as RunId,
    profileId,
    threadId,
    trigger: 'user',
    status: 'queued',
    budget: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    segmentNo: 0,
    activeMs: 0,
    startedAt: null,
    endedAt: null,
    error: null,
    ...patch,
  }
}

/**
 * An in-memory chat backend plus a hand-driven live stream. `stream`, `finish` and `fail` play the
 * part of the server and the event store: they change the data, then invalidate the same query
 * prefixes the real event store does.
 */
export function fakeChatApi(initial: { profiles?: Profile[] } = {}) {
  const state = {
    profiles: [...(initial.profiles ?? [])],
    threads: [] as Thread[],
    messages: [] as Message[],
    runs: new Map<RunId, Run>(),
    started: [] as { profileId: ProfileId; threadId?: ThreadId; prompt: string }[],
    created: [] as ProfileCreateInput[],
    cancelled: [] as RunId[],
    createError: null as Error | null,
    startError: null as Error | null,
    messagesError: null as Error | null,
    profilesError: null as Error | null,
    threadsError: null as Error | null,
    /** When set, runs.start waits for it before answering (a send in flight). */
    startGate: null as Promise<void> | null,
  }
  let queryClient: QueryClient | undefined
  const text = new Map<RunId, string>()
  const textListeners = new Map<RunId, Set<() => void>>()
  const statusListeners = new Set<() => void>()
  let status: LiveStatus = 'idle'

  const notify = (id: RunId) => {
    for (const l of textListeners.get(id) ?? []) l()
  }
  const invalidate = async () => {
    await queryClient?.invalidateQueries({ queryKey: [['runs'], {}] })
    await queryClient?.invalidateQueries({ queryKey: [['threads'], {}] })
  }
  const setRun = (id: RunId, patch: Partial<Run>) => {
    const current = state.runs.get(id)
    if (!current) throw new Error(`no run ${id}`)
    state.runs.set(id, { ...current, ...patch })
  }

  const profiles: ProfilesApi = {
    list: async () => {
      if (state.profilesError) throw state.profilesError
      return state.profiles.filter((p) => !p.archivedAt)
    },
    create: async (input) => {
      if (state.createError) throw state.createError
      state.created.push(input)
      const slug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      const row = profile({
        name: input.name,
        slug: slug || 'teammate',
        modelMain: input.modelMain,
        personaMd: input.personaMd ?? '',
      })
      state.profiles.push(row)
      return row
    },
  }

  const threads: ThreadsApi = {
    list: async (profileId) => {
      if (state.threadsError) throw state.threadsError
      return state.threads
        .filter((t) => t.profileId === profileId)
        .sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''))
    },
    messages: async ({ threadId, limit = 50, before }) => {
      if (state.messagesError) throw state.messagesError
      const all = state.messages.filter((m) => m.threadId === threadId)
      if (before && !all.some((m) => m.id === before)) throw new ApiError('NOT_FOUND')
      const end = before ? all.findIndex((m) => m.id === before) : all.length
      return all.slice(Math.max(0, end - limit), end)
    },
  }

  const runs: RunsApi = {
    start: async (input) => {
      if (state.startGate) await state.startGate
      if (state.startError) throw state.startError
      state.started.push(input)
      let threadId = input.threadId
      if (!threadId) {
        const t = thread(input.profileId, { title: input.prompt.slice(0, 60) })
        state.threads.push(t)
        threadId = t.id
      }
      const r = run(input.profileId, threadId)
      state.runs.set(r.id, r)
      state.messages.push(message(threadId, 'user', input.prompt, { runId: r.id }))
      return r
    },
    get: async (id) => {
      const r = state.runs.get(id)
      if (!r) throw new ApiError('NOT_FOUND')
      return r
    },
    cancel: async (id) => {
      state.cancelled.push(id)
      // Like the server: cancelling never touches the client's streamed text; the event store
      // drops it later (see `dropText`).
      setRun(id, { status: 'cancelled' })
      return state.runs.get(id) as Run
    },
  }

  const live = (client: QueryClient): LiveStore => {
    queryClient = client
    return {
      start: () => {
        status = 'live'
        for (const l of statusListeners) l()
      },
      stop: () => {
        status = 'stopped'
      },
      get status() {
        return status
      },
      subscribeStatus: (l) => {
        statusListeners.add(l)
        return () => void statusListeners.delete(l)
      },
      getRunText: (id) => text.get(id) ?? '',
      subscribeRunText: (id, l) => {
        const set = textListeners.get(id) ?? new Set()
        textListeners.set(id, set)
        set.add(l)
        return () => void set.delete(l)
      },
    }
  }

  const lastRun = () => [...state.runs.values()].at(-1) as Run

  const server = {
    /** The worker picked the run up and streamed `chunk` (appended). */
    async stream(chunk: string, id: RunId = lastRun().id) {
      if (state.runs.get(id)?.status === 'queued') {
        setRun(id, { status: 'running' })
        await invalidate()
      }
      text.set(id, (text.get(id) ?? '') + chunk)
      notify(id)
    },
    async running(id: RunId = lastRun().id) {
      setRun(id, { status: 'running' })
      await invalidate()
    },
    /** The run succeeded with `reply` stored as the assistant message. */
    async finish(reply: string, id: RunId = lastRun().id) {
      const r = state.runs.get(id) as Run
      state.messages.push(message(r.threadId as ThreadId, 'assistant', reply, { runId: id }))
      setRun(id, { status: 'succeeded', usage: { inputTokens: 12, outputTokens: 34 } })
      await invalidate()
      text.delete(id)
      notify(id)
    },
    async fail(error: RunErrorCode, id: RunId = lastRun().id) {
      setRun(id, { status: 'failed', error })
      await invalidate()
      text.delete(id)
      notify(id)
    },
    setLiveStatus(next: LiveStatus) {
      status = next
      for (const l of statusListeners) l()
    },
  }

  return { api: { profiles, threads, runs, live }, state, server }
}
