import type { ProviderCredential, ProviderDescriptor, ProviderTestResult } from '@mawl/contracts'
import { useMutation } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../../api/ApiProvider.tsx'
import { Button, buttonClass } from '../../ui/Button.tsx'
import { cx } from '../../ui/cx.ts'
import { CHATGPT_USAGE_URL, testFailureText } from './copy.ts'
import { useRefreshCredentials } from './queries.ts'

const tag = 'rounded-pill px-2 py-0.5 text-micro whitespace-nowrap'

function ProviderMark({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-small font-bold text-text-2"
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

function TestResultLine({
  result,
  credential,
}: {
  result: ProviderTestResult
  credential: ProviderCredential
}) {
  if (result.ok) {
    return <p className="text-small text-ok">Working ({result.latencyMs} ms)</p>
  }
  const text = testFailureText(result.reason, credential.provider)
  return (
    <p role="alert" className="text-small text-danger">
      {text}
      {credential.provider === 'openai_chatgpt' && result.reason === 'rate_limited' ? (
        <>
          {' '}
          <a
            href={CHATGPT_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            See your plan usage
          </a>
        </>
      ) : null}
    </p>
  )
}

/** One connected model provider with its state, a connection check and removal. */
export function CredentialRow({
  credential,
  descriptor,
  onSignInAgain,
  onSignedOutUnconfirmed,
  onRemoved,
}: {
  credential: ProviderCredential
  descriptor: ProviderDescriptor | undefined
  onSignInAgain: () => void
  onSignedOutUnconfirmed: () => void
  onRemoved: () => void
}) {
  const { providers } = useApi()
  const refresh = useRefreshCredentials()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isChatGpt = credential.provider === 'openai_chatgpt'
  const removeLabel = isChatGpt ? `Sign out of ${credential.label}` : `Remove ${credential.label}`

  const check = useMutation({ mutationFn: () => providers.test({ id: credential.id }) })
  const remove = useMutation({
    mutationFn: () => providers.remove(credential.id),
    onSuccess: async (removed) => {
      await refresh()
      // The row and its buttons are gone; hand focus back before it falls to <body>.
      onRemoved()
      if (!removed.revoked) onSignedOutUnconfirmed()
      else toast(isChatGpt ? 'Signed out of ChatGPT' : `${credential.label} removed`)
    },
    onError: () => toast("Couldn't remove it. Check that the Mawl server is running."),
  })

  // The second line says what the connection is, without repeating the name.
  const providerName = isChatGpt
    ? (credential.accountEmail ?? 'ChatGPT account')
    : credential.provider === 'anthropic_claude_code'
      ? 'Claude Code on the Mawl server'
      : descriptor && descriptor.label !== credential.label
        ? descriptor.label
        : descriptor?.keyRequired === false
          ? (credential.baseUrl ?? descriptor.defaultBaseUrl ?? 'Local server')
          : 'API key'

  return (
    <li className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark label={credential.label} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold">{credential.label}</h3>
          <p className="truncate text-small text-text-2">{providerName}</p>
        </div>
        {isChatGpt && !credential.reauthRequired && credential.planUsage ? (
          <span className={cx(tag, 'bg-ok-soft text-ok')}>Using ChatGPT plan</span>
        ) : null}
        {isChatGpt && !credential.reauthRequired && !credential.planUsage ? (
          <span className={cx(tag, 'bg-warn-soft text-warn')}>Plan usage is off</span>
        ) : null}
        {check.data && !check.data.ok && check.data.reason === 'rate_limited' && isChatGpt ? (
          <span className={cx(tag, 'bg-warn-soft text-warn')}>Usage limit reached</span>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {isChatGpt ? (
            <a
              href={CHATGPT_USAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('ghost', 'sm')}
            >
              Manage usage
            </a>
          ) : null}
          {!credential.reauthRequired ? (
            <Button
              size="sm"
              variant="soft"
              aria-label={`Check ${credential.label}`}
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? 'Checking…' : 'Check'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={removeLabel}
            onClick={() => setConfirmOpen(true)}
          >
            {isChatGpt ? 'Sign out' : 'Remove'}
          </Button>
        </div>
      </div>
      {credential.reauthRequired ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn-soft px-3 py-2.5">
          <div>
            <p className="text-small font-semibold text-warn">Signed out of ChatGPT</p>
            <p className="text-small text-text-2">
              ChatGPT ended this sign-in. Teammates using it pause until you sign in again.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={onSignInAgain}>
            Sign in again
          </Button>
        </div>
      ) : null}
      {!isChatGpt && credential.provider === 'anthropic_claude_code' && check.data?.ok === false ? (
        <p className="text-small text-text-2">
          In Docker, run{' '}
          <code className="font-mono text-micro">docker compose exec server claude auth login</code>
          .
        </p>
      ) : null}
      {check.data ? <TestResultLine result={check.data} credential={credential} /> : null}
      {check.isError ? (
        <p role="alert" className="text-small text-danger">
          Couldn't run the check. Make sure the Mawl server is running.
        </p>
      ) : null}

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg bg-surface p-5 shadow-2">
            <AlertDialog.Title className="text-heading">
              {isChatGpt ? 'Sign out of ChatGPT?' : `Remove ${credential.label}?`}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-small text-text-2">
              {isChatGpt
                ? 'Mawl asks ChatGPT to revoke its access and forgets the sign-in. Teammates using it stop until you connect a model again.'
                : 'Mawl deletes the stored key. Teammates using it stop until you connect a model again.'}
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 pt-1">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant="primary" onClick={() => remove.mutate()}>
                  {isChatGpt ? 'Sign out' : 'Remove'}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </li>
  )
}
