import { wsProtocols } from '@mawl/contracts'

/** A fixed auth token for unit tests. Not a secret: it only ever guards in-process test servers. */
export const TEST_AUTH_TOKEN = 'mawl-test-token_0123456789abcdefghijkl'

/** The header an authenticated `/rpc` call carries. */
export const TEST_AUTH_HEADERS = { authorization: `Bearer ${TEST_AUTH_TOKEN}` } as const

/** The subprotocols an authenticated `/ws` client offers. */
export const TEST_WS_PROTOCOLS = wsProtocols(TEST_AUTH_TOKEN)
