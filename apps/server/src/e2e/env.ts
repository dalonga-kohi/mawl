/** The e2e server answers every run with a scripted model, so it must never start by accident. */
export function assertE2eEnv(env: Record<string, string | undefined>): void {
  if (env.MAWL_E2E !== '1') {
    throw new Error('The e2e server is for tests only: set MAWL_E2E=1 to start it')
  }
}
