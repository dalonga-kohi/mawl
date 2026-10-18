/** Sends every request with `redirect: 'error'`. The global is read per call so stubs apply. */
export function noRedirectFetch(inner?: typeof globalThis.fetch): typeof globalThis.fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    (inner ?? globalThis.fetch)(input, { ...init, redirect: 'error' })) as typeof globalThis.fetch
}
