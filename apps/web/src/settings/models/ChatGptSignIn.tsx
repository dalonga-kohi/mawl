import type { ChatGptStartResult } from '@faire/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../../api/ApiProvider.tsx'
import { errorCode } from '../../api/providers-api.ts'
import { Button } from '../../ui/Button.tsx'
import { signInFailureText } from './copy.ts'
import { useRefreshCredentials } from './queries.ts'

const POLL_MS = 1500

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

  const start = useMutation({
    mutationFn: () => providers.chatgptStart(),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      setAttempt(result)
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
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : POLL_MS),
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

  return {
    start: () => start.mutate(),
    starting: start.isPending,
    attempt,
    cancel: () => setAttempt(null),
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
        <p>Finish signing in in the browser tab that just opened. This page updates by itself.</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={signIn.attempt.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent-ink underline-offset-2 hover:underline"
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
