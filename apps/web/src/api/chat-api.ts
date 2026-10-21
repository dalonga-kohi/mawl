import type {
  Message,
  MessageId,
  Profile,
  ProfileId,
  Run,
  RunId,
  Thread,
  ThreadId,
  UserProfile,
} from '@mawl/contracts'
import type { QueryClient } from '@tanstack/react-query'

/** The owner's own profile (`user.*`). `update` replaces both fields. */
export interface UserApi {
  get(): Promise<UserProfile>
  update(input: UserProfile): Promise<UserProfile>
}

/** What the teammate views need from `profiles.*`. */
export interface ProfilesApi {
  list(): Promise<Profile[]>
  create(input: ProfileCreateInput): Promise<Profile>
}

export interface ProfileCreateInput {
  name: string
  /** `<credentialId>:<modelId>` */
  modelMain: string
  personaMd?: string
}

export interface ThreadsApi {
  /** Newest activity first. */
  list(profileId: ProfileId): Promise<Thread[]>
  /** Latest `limit` messages in chronological order, older than `before` when given. */
  messages(input: { threadId: ThreadId; limit?: number; before?: MessageId }): Promise<Message[]>
}

export interface RunsApi {
  start(input: { profileId: ProfileId; threadId?: ThreadId; prompt: string }): Promise<Run>
  get(id: RunId): Promise<Run>
  cancel(id: RunId): Promise<Run>
}

export type LiveStatus = 'idle' | 'live' | 'reconnecting' | 'stopped'

/**
 * The live event stream as the views see it: streamed run text plus the connection state. The app
 * backs it with the @mawl/client event store, which also invalidates queries as events arrive.
 */
export interface LiveStore {
  start(): void
  stop(): void
  readonly status: LiveStatus
  subscribeStatus(listener: () => void): () => void
  /** Text streamed so far for the run's current step; '' when none. */
  getRunText(runId: RunId): string
  subscribeRunText(runId: RunId, listener: () => void): () => void
}

/** Builds the live store for the app's query cache, so events invalidate the queries views read. */
export type LiveFactory = (queryClient: QueryClient) => LiveStore
