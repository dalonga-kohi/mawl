import { contract } from '@faire/contracts'
import { listProviderDescriptors } from '@faire/core'
import { implement, ORPCError } from '@orpc/server'
import {
  CredentialNotFoundError,
  CredentialUnreadableError,
  type ProviderService,
  SignInAttemptNotFoundError,
  SignInUnavailableError,
} from './providers/service.ts'

export interface RouterDeps {
  version: string
  providers: ProviderService
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

/**
 * Every procedure in the contract must appear here: this object is type-checked against the
 * contract, so adding a procedure to `@faire/contracts` fails the build until it is stubbed
 * or implemented. Replace a stub by a real handler when its slice lands.
 */
export function createRouter({ version, providers }: RouterDeps) {
  const os = implement(contract)
  return os.router({
    health: { get: os.health.get.handler(() => ({ ok: true as const, version })) },
    profiles: {
      list: stub(os.profiles.list),
      get: stub(os.profiles.get),
      create: stub(os.profiles.create),
      update: stub(os.profiles.update),
      archive: stub(os.profiles.archive),
    },
    threads: {
      list: stub(os.threads.list),
      messages: stub(os.threads.messages),
    },
    runs: {
      start: stub(os.runs.start),
      get: stub(os.runs.get),
      cancel: stub(os.runs.cancel),
      pause: stub(os.runs.pause),
      resume: stub(os.runs.resume),
    },
    approvals: {
      list: stub(os.approvals.list),
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
          return notFound(errors)(err)
        }),
      ),
    },
    settings: {
      get: stub(os.settings.get),
      update: stub(os.settings.update),
    },
    // WebSocket transport arrives in P1.5.
    events: { subscribe: stub(os.events.subscribe) },
  })
}

export type AppRouter = ReturnType<typeof createRouter>
