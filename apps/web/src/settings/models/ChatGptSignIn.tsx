import type { ChatGptStartResult } from '@faire/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../../api/ApiProvider.tsx'
import { errorCode } from '../../api/providers-api.ts'
import { Button } from '../../ui/Button.tsx'
import { signInFailureText } from './copy.ts'
import { useRefreshCredentials } from './queries.ts'

const POLL_MS = 1500
/** The server expires an attempt after 10 minutes; the page stops waiting at the same point. */
const ATTEMPT_TIMEOUT_MS = 10 * 60_000

const isLoopbackHost = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')

/**
 * Sign in with ChatGPT (SIWC). The server opens a loopback callback on its own host, so in v1 the
 * browser that signs in must run on the same computer as Faire.
 */
export function useChatGptSignIn() {
  const { providers } = useApi()
  const refresh = useRefreshCredentials()
  const [attempt, setAttempt] = useState<ChatGptStartResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollMs = providers.chatgptPollMs ?? POLL_MS

  const start = useMutation({
    mutationFn: () => providers.chatgptStart(),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      setAttempt(result)
      // Opened after a server round trip, so a popup blocker may stop it; the status panel links
      // to the same page.
      window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer')
    },
    onError: (e) =>
      setError(
        errorCode(e) === 'SIGN_IN_UNAVAILABLE'
          ? "Faire couldn't open its sign-in listener on port 1455. Close the app using that port, then try again."
          : "Couldn't start the sign-in. Check that the Faire server is running, then try again.",
      ),
  })

  const status = useQuery({
    queryKey: ['providers', 'chatgpt', attempt?.attemptId],
    queryFn: () => providers.chatgptStatus(attempt?.attemptId ?? ''),
    enabled: attempt !== null,
    // Only a forgotten attempt ends the wait. Any other failure (a dropped socket, a busy server)
    // keeps polling: the client reopens its socket on the next call.
    refetchInterval: (q) =>
      errorCode(q.state.error) === 'NOT_FOUND' ||
      (q.state.data && q.state.data.status !== 'pending')
        ? false
        : pollMs,
    retry: false,
    gcTime: 0,
  })

  const result = status.data
  useEffect(() => {
    if (!result || result.status === 'pending') return
    setAttempt(null)
    if (result.status === 'succeeded') {
      void refresh()
      toast('Signed in with ChatGPT')
    } else {
      setError(signInFailureText(result.reason))
    }
  }, [result, refresh])

  // A restarted server forgets the attempt (NOT_FOUND); stop polling instead of waiting forever.
  const attemptLost = errorCode(status.error) === 'NOT_FOUND'
  useEffect(() => {
    if (!attemptLost) return
    setAttempt(null)
    setError('Faire lost track of this sign-in, maybe because the server restarted. Start again.')
  }, [attemptLost])

  // The sign-in may have finished on the server after the last poll, so the list is refreshed
  // whenever the page stops waiting without a result.
  const stopWaiting = useCallback(
    (reason?: string) => {
      setAttempt(null)
      if (reason) setError(reason)
      void refresh()
    },
    [refresh],
  )

  useEffect(() => {
    if (!attempt) return
    const timer = setTimeout(() => stopWaiting(signInFailureText('expired')), ATTEMPT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [attempt, stopWaiting])

  return {
    start: () => {
      if (!start.isPending && !attempt) start.mutate()
    },
    starting: start.isPending,
    attempt,
    cancel: () => stopWaiting(),
    error,
    remote: !isLoopbackHost(window.location.hostname),
  }
}

export type ChatGptSignInState = ReturnType<typeof useChatGptSignIn>

/** The pending step and any failure, shown under the sign-in button. */
export function ChatGptSignInStatus({ signIn }: { signIn: ChatGptSignInState }) {
  if (signIn.attempt) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md bg-accent-softer p-3 text-small">
        <p>
          Finish signing in on the ChatGPT page. If no tab opened, use the link below. This page
          updates by itself.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={signIn.attempt.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center font-semibold text-accent-ink underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            Open the sign-in page again
          </a>
          <Button size="sm" variant="ghost" onClick={signIn.cancel}>
            Stop waiting
          </Button>
        </div>
      </div>
    )
  }
  if (signIn.error) {
    return (
      <p role="alert" className="rounded-md bg-danger-soft p-3 text-small text-danger">
        {signIn.error}
      </p>
    )
  }
  if (signIn.remote) {
    return (
      <p className="text-small text-text-2">
        Sign-in finishes on the computer running Faire. Open this page there to continue with
        ChatGPT.
      </p>
    )
  }
  return null
}
