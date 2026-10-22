import { AUTH_TOKEN_PATTERN } from '@mawl/contracts'

/** The fixed token the e2e specs send (apps/web/e2e/fixtures.ts), required so nothing is generated. */
export function e2eOwnerToken(env: Record<string, string | undefined>): string {
  const token = env.MAWL_OWNER_TOKEN
  if (!token || !AUTH_TOKEN_PATTERN.test(token)) {
    throw new Error('The e2e server needs MAWL_OWNER_TOKEN (32-512 base64url characters)')
  }
  return token
}

/** The e2e server answers every run with a scripted model, so it must never start by accident. */
export function assertE2eEnv(env: Record<string, string | undefined>): void {
  if (env.MAWL_E2E !== '1') {
    throw new Error('The e2e server is for tests only: set MAWL_E2E=1 to start it')
  }
}
