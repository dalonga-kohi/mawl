import type { ProviderCredential } from '@mawl/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'
import { useApi } from '../../api/ApiProvider.tsx'
import { enter } from '../../motion/presets.ts'
import { Button, IconButton } from '../../ui/Button.tsx'
import { cx } from '../../ui/cx.ts'
import { IconTile } from '../../ui/IconTile.tsx'
import { SettingsSectionHeader, settingsCard } from '../parts.tsx'
import { ApiKeyDialog } from './ApiKeyDialog.tsx'
import { type ChatGptSignInState, ChatGptSignInStatus, useChatGptSignIn } from './ChatGptSignIn.tsx'
import { CredentialRow } from './CredentialRow.tsx'
import { CHATGPT_SETTINGS_URL } from './copy.ts'
import { providerKeys, useCatalog, useCredentials } from './queries.ts'

/** SIWC asks for a recognisable "Continue with ChatGPT" control; it reads as a sign-in, not a Mawl action. */
function ChatGptButton({
  signIn,
  label = 'Continue with ChatGPT',
}: {
  signIn: ChatGptSignInState
  label?: string
}) {
  return (
    <Button
      variant="contrast"
      disabled={signIn.starting || signIn.attempt !== null}
      onClick={signIn.start}
    >
      {label}
    </Button>
  )
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-card bg-surface-2 py-1 pr-1 pl-3.5">
      <code className="flex-1 overflow-x-auto font-mono text-small whitespace-nowrap">
        {command}
      </code>
      <IconButton
        label={copied ? 'Copied' : 'Copy command'}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </IconButton>
    </div>
  )
}

/** Mawl never sees Claude credentials: the owner signs in to Claude Code itself on the server. */
function ClaudePlanSteps({ onClose }: { onClose: () => void }) {
  const { providers } = useApi()
  const client = useQueryClient()
  const add = useMutation({
    mutationFn: () => providers.create({ provider: 'anthropic_claude_code', label: 'Claude plan' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: providerKeys.list })
      onClose()
    },
  })
  return (
    <motion.div {...enter} className="flex flex-col gap-3 rounded-md bg-surface-2/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-body font-semibold">Use your Claude plan</h3>
        <IconButton label="Close Claude plan steps" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-small text-text-2">
        <li className="flex flex-col gap-2">
          <span>On the computer running Mawl, open a terminal and sign in to Claude Code:</span>
          <CopyCommand command="claude auth login" />
          <span>
            Running Mawl in Docker? Use{' '}
            <code className="font-mono text-micro text-text">
              docker compose exec server claude auth login
            </code>
            .
          </span>
        </li>
        <li className="flex flex-col items-start gap-2">
          <span>Then add it here. Mawl checks the sign-in before every run.</span>
          <Button variant="primary" size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
            Add Claude plan
          </Button>
        </li>
      </ol>
      {add.isError ? (
        <p role="alert" className="text-small text-danger">
          Couldn't add it. Check that the Mawl server is running.
        </p>
      ) : null}
    </motion.div>
  )
}

/** One way to connect a model, as its own card; `below` holds what opens under it. */
function Option({
  title,
  description,
  children,
  below,
}: {
  title: string
  description: string
  children: ReactNode
  below?: ReactNode
}) {
  return (
    <div className={cx(settingsCard, 'flex flex-col gap-3')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-[46ch]">
          <h3 className="text-body font-semibold">{title}</h3>
          <p className="text-small text-text-2">{description}</p>
        </div>
        {children}
      </div>
      {below}
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-hidden="true" className={cx(settingsCard, 'flex flex-col gap-4')}>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-8 animate-pulse rounded-full bg-surface-2" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3.5 w-40 animate-pulse rounded-xs bg-surface-2" />
            <span className="h-3 w-24 animate-pulse rounded-xs bg-surface-2" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function ModelsSection() {
  const catalog = useCatalog()
  const credentials = useCredentials()
  const signIn = useChatGptSignIn()
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [revokeNotice, setRevokeNotice] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const list: ProviderCredential[] = credentials.data ?? []
  const hasChatGpt = list.some((c) => c.provider === 'openai_chatgpt')
  const hasClaude = list.some((c) => c.provider === 'anthropic_claude_code')
  const descriptorOf = (c: ProviderCredential) => catalog.data?.find((d) => d.kind === c.provider)

  // The sign-in status stays visible after ChatGPT is connected only while there is news.
  const showSignInStatus = !hasChatGpt || signIn.attempt || signIn.error
  const signInStatus = showSignInStatus ? (
    <div className="empty:hidden">
      <ChatGptSignInStatus signIn={signIn} />
    </div>
  ) : null

  let body: ReactNode
  if (credentials.isPending) {
    body = <Skeleton />
  } else if (credentials.isError) {
    body = (
      <div
        role="alert"
        className={cx(settingsCard, 'flex flex-wrap items-center justify-between gap-3')}
      >
        <p className="text-small text-text-2">
          Couldn't reach the Mawl server. Check that it's running, then try again.
        </p>
        <Button size="sm" variant="soft" onClick={() => void credentials.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else {
    body = (
      <>
        {list.length === 0 ? (
          <div className={cx(settingsCard, 'flex items-center gap-4')}>
            <IconTile icon={Sparkles} size={44} iconSize={22} />
            <div>
              <p className="text-body font-semibold">No model connected yet.</p>
              <p className="text-small text-text-2">
                Pick one below. Teammates need a model before they can chat.
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <CredentialRow
                key={c.id}
                credential={c}
                descriptor={descriptorOf(c)}
                onSignInAgain={signIn.start}
                onSignedOutUnconfirmed={() => setRevokeNotice(true)}
                onRemoved={() => headingRef.current?.focus()}
              />
            ))}
          </ul>
        )}
        {!hasChatGpt ? (
          <Option
            title="ChatGPT plan"
            description="Use your ChatGPT Plus or Pro plan. No API key needed."
            below={signInStatus}
          >
            <ChatGptButton signIn={signIn} />
          </Option>
        ) : (
          signInStatus
        )}
        {!hasClaude ? (
          <Option
            title="Claude plan"
            description="Use your Claude Pro or Max plan through Claude Code on this server."
            below={
              <AnimatePresence>
                {claudeOpen ? <ClaudePlanSteps onClose={() => setClaudeOpen(false)} /> : null}
              </AnimatePresence>
            }
          >
            <Button variant="soft" onClick={() => setClaudeOpen(true)} disabled={claudeOpen}>
              Use your Claude plan
            </Button>
          </Option>
        ) : null}
        <Option
          title="API key"
          description="Anthropic, OpenAI, OpenRouter, Ollama or any OpenAI-compatible server."
        >
          <Button variant="soft" onClick={() => setKeyOpen(true)}>
            Add an API key
          </Button>
        </Option>
      </>
    )
  }

  return (
    <section aria-labelledby="settings-models" className="flex flex-col gap-4">
      <SettingsSectionHeader id="settings-models" title="Models and keys" headingRef={headingRef}>
        The models your teammates think with. Keys stay on your Mawl server.
      </SettingsSectionHeader>
      {revokeNotice ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md bg-warn-soft px-3.5 py-3"
        >
          <p className="text-small text-text">
            Mawl couldn't confirm that ChatGPT revoked its access. Revoke it in{' '}
            <a
              href={CHATGPT_SETTINGS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2"
            >
              ChatGPT settings
            </a>
            .
          </p>
          <IconButton label="Dismiss" onClick={() => setRevokeNotice(false)}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
      {body}
      <ApiKeyDialog open={keyOpen} onOpenChange={setKeyOpen} catalog={catalog.data ?? []} />
    </section>
  )
}
