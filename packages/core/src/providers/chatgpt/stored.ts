import { z } from 'zod'
import { DIRECT_SCOPE } from './constants.ts'

/**
 * What the server encrypts as a ChatGPT credential's secret. Tokens are null once cleared
 * (terminal refresh error or logout), while the issued client id is kept for the next sign-in.
 * Never log or serialise this outside the secret box.
 */
export const StoredChatGptCredential = z.strictObject({
  clientId: z.string().min(1),
  accessToken: z.string().min(1).nullable(),
  refreshToken: z.string().min(1).nullable(),
  idToken: z.string().min(1).nullable(),
  /** Epoch ms when the access token expires. */
  expiresAt: z.number().int().nonnegative(),
  /** Space separated, as granted by the last token response. */
  scope: z.string(),
})
export type StoredChatGptCredential = z.infer<typeof StoredChatGptCredential>

/** Throws a ZodError (issues only, no values in the message we surface) on a malformed blob. */
export function parseStoredCredential(json: string): StoredChatGptCredential {
  return StoredChatGptCredential.parse(JSON.parse(json))
}

export function serializeStoredCredential(c: StoredChatGptCredential): string {
  return JSON.stringify(StoredChatGptCredential.parse(c))
}

/** Whether the grant covers direct plan usage; without it there is no inference. */
export function hasPlanUsage(scope: string): boolean {
  return scope.split(/\s+/).includes(DIRECT_SCOPE)
}
