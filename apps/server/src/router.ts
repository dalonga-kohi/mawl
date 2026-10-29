import { type CredentialId, contract, type RunStatus } from '@mawl/contracts'
import { listProviderDescriptors } from '@mawl/core'
import { implement, ORPCError } from '@orpc/server'
import type { Principal } from './auth/principal.ts'
import {
  type ConnectionState,
  type EventsService,
  newConnectionState,
  ResyncRequiredError,
  TooManySubscriptionsError,
} from './events/service.ts'
import { SlugTakenError, UnknownCredentialError } from './profiles/errors.ts'
import type { ProfileService } from './profiles/service.ts'
import {
  CredentialNotFoundError,
  CredentialUnreadableError,
  type ProviderService,
  ProviderTestRateLimitedError,
  SignInAttemptNotFoundError,
  SignInUnavailableError,
} from './providers/service.ts'
import { EntityNotFoundError, RunConflictError } from './runs/errors.ts'
import type { RunService } from './runs/service.ts'
import type { SearchService } from './search/service.ts'
import type { UserService } from './user/service.ts'

export interface RouterDeps {
  version: string
  providers: ProviderService
  runs: RunService
  /** Without it the profiles procedures stay 501 stubs (unit tests that never touch them). */
  profiles?: ProfileService
  /** Without it the user procedures stay 501 stubs. */
  user?: UserService
  /** Without it events.subscribe stays a 501 stub (unit tests that never stream). */
  events?: EventsService
  /** Without it the search key procedures stay 501 stubs. */
  search?: SearchService
}

/**
 * Per-request context. A WebSocket connection passes its own connection, so the subscription cap
 * counts per socket; an HTTP request has none and gets a fresh state.
 */
export interface RouterContext {
  connection?: ConnectionState
  /** Set by the transport once the request proved the auth token (see auth/principal.ts). */
  principal?: Principal
}

/**
 * Not-yet-built procedures answer 501. The contract's typed error maps only describe
 * domain errors, but oRPC lets a handler throw any ORPCError; it reaches the client as a
 * plain ORPCError with this code and status.
 */
const notImplemented = (): never => {
  throw new ORPCError('NOT_IMPLEMENTED', { status: 501 })
}

/** Turns a contract procedure into a stub handler. */
const stub = <T>(procedure: { handler: (handler: () => never) => T }): T =>
  procedure.handler(notImplemented)

/** Maps the service's not-found error to the contract's typed NOT_FOUND; others pass through. */
const notFound =
  (errors: { NOT_FOUND: (options: { data: { entity: string; id: string } }) => Error }) =>
  (err: unknown): never => {
    if (err instanceof CredentialNotFoundError) {
      throw errors.NOT_FOUND({ data: { entity: 'credential', id: err.id } })
    }
    throw err
  }

type RunErrors = {
  NOT_FOUND: (options: { data: { entity: string; id: string } }) => Error
  CONFLICT?: (options: { data: { from: RunStatus; to: RunStatus } }) => Error
}

/** Maps the run service's domain errors to the contract's typed NOT_FOUND and CONFLICT. */
const runErrors =
  (errors: RunErrors) =>
  (err: unknown): never => {
    if (err instanceof EntityNotFoundError) {
      throw errors.NOT_FOUND({ data: { entity: err.entity, id: err.id } })
    }
    if (err instanceof RunConflictError && errors.CONFLICT) {
      throw errors.CONFLICT({ data: { from: err.from, to: err.to } })
    }
    throw err
  }

type ProfileErrors = {
  NOT_FOUND?: (options: { data: { entity: string; id: string } }) => Error
  SLUG_TAKEN?: (options: { data: { slug: string } }) => Error
  UNKNOWN_CREDENTIAL?: (options: { data: { credentialId: CredentialId } }) => Error
}

/** Maps the profile service's domain errors to the contract's typed errors. */
const profileErrors =
  (errors: ProfileErrors) =>
  (err: unknown): never => {
    if (err instanceof EntityNotFoundError && errors.NOT_FOUND) {
      throw errors.NOT_FOUND({ data: { entity: err.entity, id: err.id } })
    }
    if (err instanceof SlugTakenError && errors.SLUG_TAKEN) {
      throw errors.SLUG_TAKEN({ data: { slug: err.slug } })
    }
    if (err instanceof UnknownCredentialError && errors.UNKNOWN_CREDENTIAL) {
      throw errors.UNKNOWN_CREDENTIAL({ data: { credentialId: err.credentialId } })
    }
    throw err
  }

/**
 * Every procedure in the contract must appear here: this object is type-checked against the
 * contract, so adding a procedure to `@mawl/contracts` fails the build until it is stubbed
 * or implemented. Replace a stub by a real handler when its slice lands.
 */
export function createRouter({
  version,
  providers,
  runs,
  events,
  profiles,
  user,
  search,
}: RouterDeps) {
  const os = implement(contract).$context<RouterContext>()
  return os.router({
    health: { get: os.health.get.handler(() => ({ ok: true as const, version })) },
    profiles: profiles
      ? {
          list: os.profiles.list.handler(({ input }) => profiles.list(input)),
          get: os.profiles.get.handler(({ input, errors }) =>
            profiles.get(input.id).catch(profileErrors(errors)),
          ),
          create: os.profiles.create.handler(({ input, errors }) =>
            profiles.create(input).catch(profileErrors(errors)),
          ),
          update: os.profiles.update.handler(({ input, errors }) =>
            profiles.update(input.id, input.patch).catch(profileErrors(errors)),
          ),
          archive: os.profiles.archive.handler(({ input, errors }) =>
            profiles.archive(input.id).catch(profileErrors(errors)),
          ),
        }
      : {
          list: stub(os.profiles.list),
          get: stub(os.profiles.get),
          create: stub(os.profiles.create),
          update: stub(os.profiles.update),
          archive: stub(os.profiles.archive),
        },
    threads: {
      list: os.threads.list.handler(({ input, errors }) =>
        runs.listThreads(input.profileId).catch(runErrors(errors)),
      ),
      messages: os.threads.messages.handler(({ input, errors }) =>
        runs.threadMessages(input).catch(runErrors(errors)),
      ),
    },
    runs: {
      start: os.runs.start.handler(({ input, errors }) =>
        runs.start(input).catch(runErrors(errors)),
      ),
      get: os.runs.get.handler(({ input, errors }) => runs.get(input.id).catch(runErrors(errors))),
      cancel: os.runs.cancel.handler(({ input, errors }) =>
        runs.cancel(input.id).catch(runErrors(errors)),
      ),
      pause: os.runs.pause.handler(({ input, errors }) =>
        runs.pause(input.id).catch(runErrors(errors)),
      ),
      resume: os.runs.resume.handler(({ input, errors }) =>
        runs.resume(input.id).catch(runErrors(errors)),
      ),
      reply: os.runs.reply.handler(({ input, errors }) =>
        runs.reply(input.id, input.answer).catch(runErrors(errors)),
      ),
    },
    search: search
      ? {
          status: os.search.status.handler(() => search.status()),
          setKey: os.search.setKey.handler(({ input }) => search.setKey(input)),
          clearKey: os.search.clearKey.handler(({ input }) => search.clearKey(input)),
        }
      : {
          status: stub(os.search.status),
          setKey: stub(os.search.setKey),
          clearKey: stub(os.search.clearKey),
        },
    approvals: {
      list: stub(os.approvals.list),
      get: stub(os.approvals.get),
      decide: stub(os.approvals.decide),
    },
    devices: {
      pair: stub(os.devices.pair),
      list: stub(os.devices.list),
      revoke: stub(os.devices.revoke),
    },
    providers: {
      catalog: os.providers.catalog.handler(() => listProviderDescriptors()),
      list: os.providers.list.handler(() => providers.list()),
      create: os.providers.create.handler(({ input }) => providers.create(input)),
      delete: os.providers.delete.handler(({ input, errors }) =>
        providers.delete(input.id).catch(notFound(errors)),
      ),
      chatgpt: {
        start: os.providers.chatgpt.start.handler(() =>
          providers.startChatGptSignIn().catch((err: unknown) => {
            // 503: the owner can fix it (set a free port, or the host id file) and retry.
            if (err instanceof SignInUnavailableError) {
              throw new ORPCError('SIGN_IN_UNAVAILABLE', { status: 503, data: { why: err.why } })
            }
            throw err
          }),
        ),
        status: os.providers.chatgpt.status.handler(({ input, errors }) => {
          try {
            return providers.chatGptSignInStatus(input.attemptId)
          } catch (err) {
            if (err instanceof SignInAttemptNotFoundError) {
              throw errors.NOT_FOUND({ data: { entity: 'sign_in_attempt', id: err.id } })
            }
            throw err
          }
        }),
      },
      test: os.providers.test.handler(({ input, errors }) =>
        providers.test(input).catch((err: unknown) => {
          if (err instanceof CredentialUnreadableError) {
            throw errors.CREDENTIAL_UNREADABLE({ data: { id: err.id } })
          }
          // Typed in the contract: the owner waits a moment and checks again.
          if (err instanceof ProviderTestRateLimitedError) throw errors.RATE_LIMITED()
          return notFound(errors)(err)
        }),
      ),
    },
    settings: {
      get: stub(os.settings.get),
      update: stub(os.settings.update),
    },
    user: user
      ? {
          get: os.user.get.handler(() => user.get()),
          update: os.user.update.handler(({ input }) => user.update(input)),
        }
      : { get: stub(os.user.get), update: stub(os.user.update) },
    events: {
      subscribe: events
        ? os.events.subscribe.handler(async function* ({ input, context, signal, errors }) {
            // Defence in depth: the transports set the principal only after the auth token
            // checked out, so a router reached any other way streams nothing.
            if (!context.principal) throw errors.UNAUTHORIZED()
            try {
              yield* events.subscribe(input, {
                connection: context.connection ?? newConnectionState(),
                principal: context.principal,
                ...(signal ? { signal } : {}),
              })
            } catch (err) {
              if (err instanceof ResyncRequiredError) throw errors.RESYNC_REQUIRED()
              if (err instanceof TooManySubscriptionsError) throw errors.TOO_MANY_SUBSCRIPTIONS()
              throw err
            }
          })
        : stub(os.events.subscribe),
    },
  })
}

export type AppRouter = ReturnType<typeof createRouter>
