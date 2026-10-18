import {
  type ProviderCredentialInput,
  ProviderCredentialInput as ProviderCredentialInputSchema,
  type ProviderDescriptor,
  type ProviderKind,
} from '@faire/contracts'
import { useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../../api/ApiProvider.tsx'
import { errorCode } from '../../api/providers-api.ts'
import { overlayFade, transitions } from '../../motion/presets.ts'
import { Button, IconButton } from '../../ui/Button.tsx'
import { testFailureText } from './copy.ts'
import { useRefreshCredentials } from './queries.ts'

/** Kinds that take a key or an address; plan sign-ins have their own flows. */
const KEY_KINDS: ProviderKind[] = [
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'openai_compatible',
]

const field =
  'h-11 w-full rounded-sm bg-surface px-3.5 text-body text-text shadow-[0_0_0_1px_var(--line)] outline-none transition-shadow duration-[120ms] placeholder:text-text-3 focus:shadow-[0_0_0_2px_var(--accent-ring)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]'

interface Errors {
  secret?: string
  baseUrl?: string
  label?: string
  form?: string
}

function Form({ catalog, onDone }: { catalog: ProviderDescriptor[]; onDone: () => void }) {
  const { providers } = useApi()
  const refresh = useRefreshCredentials()
  const options = catalog.filter((d) => KEY_KINDS.includes(d.kind))
  const [kind, setKind] = useState<ProviderKind>(options[0]?.kind ?? 'anthropic')
  const descriptor = options.find((d) => d.kind === kind)
  const [label, setLabel] = useState(descriptor?.label ?? '')
  const [labelEdited, setLabelEdited] = useState(false)
  const [secret, setSecret] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { kind: useId(), label: useId(), secret: useId(), baseUrl: useId() }

  const showAddress = descriptor?.baseUrlRequired || kind === 'ollama'
  const keyRequired = descriptor?.keyRequired ?? true

  const save = useMutation({
    // The input holds the API key: don't keep it in the mutation cache after the dialog closes.
    gcTime: 0,
    mutationFn: async (input: ProviderCredentialInput) => {
      const check = await providers.test(input)
      if (!check.ok) return { saved: false as const, reason: check.reason }
      await providers.create(input)
      return { saved: true as const }
    },
    onSuccess: async (result, input) => {
      if (!result.saved) {
        setErrors({ form: testFailureText(result.reason, input.provider) })
        return
      }
      await refresh()
      toast(`${input.label} connected`)
      onDone()
    },
    onError: (e) =>
      setErrors({
        form:
          errorCode(e) === 'VALIDATION'
            ? "The server didn't accept these details. Check each field and try again."
            : errorCode(e) === undefined
              ? "Couldn't reach the Faire server. Check that it's running, then try again."
              : "Faire couldn't save this connection. Try again.",
      }),
  })

  const changeKind = (next: ProviderKind) => {
    setKind(next)
    setErrors({})
    if (!labelEdited) setLabel(options.find((d) => d.kind === next)?.label ?? '')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!label.trim()) next.label = 'Give this connection a name.'
    if (keyRequired && !secret.trim()) next.secret = 'Paste your API key.'
    if (descriptor?.baseUrlRequired && !baseUrl.trim()) next.baseUrl = 'Enter the server address.'
    const input: ProviderCredentialInput = {
      provider: kind,
      label: label.trim(),
      ...(secret.trim() ? { secret: secret.trim() } : {}),
      ...(showAddress && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
    }
    const parsed = ProviderCredentialInputSchema.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'baseUrl')
          next.baseUrl ??= 'Enter a full address starting with http:// or https://.'
        else if (field === 'label') next.label ??= 'Keep the name under 80 characters.'
        else if (field === 'secret') next.secret ??= 'That key is too long.'
        // Fail closed on anything the form has no field for.
        else next.form ??= 'Faire refused these details. Check each field and try again.'
      }
    }
    setErrors(next)
    const firstInvalid = (['label', 'secret', 'baseUrl'] as const).find((f) => next[f])
    if (firstInvalid) {
      const id = { label: ids.label, secret: ids.secret, baseUrl: ids.baseUrl }[firstInvalid]
      document.getElementById(id)?.focus()
    }
    if (parsed.success && Object.keys(next).length === 0) save.mutate(parsed.data)
  }

  const fieldError = (id: string, message?: string) =>
    message ? (
      <p id={`${id}-error`} className="text-small text-danger">
        {message}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.kind} className="text-small font-semibold text-text-2">
          Provider
        </label>
        <select
          id={ids.kind}
          value={kind}
          onChange={(e) => changeKind(e.target.value as ProviderKind)}
          className={field}
        >
          {options.map((d) => (
            <option key={d.kind} value={d.kind}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.label} className="text-small font-semibold text-text-2">
          Name
        </label>
        <input
          id={ids.label}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            setLabelEdited(true)
          }}
          aria-invalid={Boolean(errors.label)}
          aria-describedby={errors.label ? `${ids.label}-error` : undefined}
          className={field}
        />
        {fieldError(ids.label, errors.label)}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.secret} className="text-small font-semibold text-text-2">
          {keyRequired ? 'API key' : 'API key (optional)'}
        </label>
        <input
          id={ids.secret}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Paste your key"
          aria-invalid={Boolean(errors.secret)}
          aria-describedby={errors.secret ? `${ids.secret}-error` : `${ids.secret}-help`}
          className={field}
        />
        {errors.secret ? (
          fieldError(ids.secret, errors.secret)
        ) : (
          <p id={`${ids.secret}-help`} className="text-small text-text-2">
            Stays on your Faire server, encrypted. Faire checks it with one small request.
          </p>
        )}
      </div>
      {showAddress ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.baseUrl} className="text-small font-semibold text-text-2">
            {descriptor?.baseUrlRequired ? 'Server address' : 'Server address (optional)'}
          </label>
          <input
            id={ids.baseUrl}
            inputMode="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={descriptor?.defaultBaseUrl ?? 'https://llm.example.com/v1'}
            aria-invalid={Boolean(errors.baseUrl)}
            aria-describedby={errors.baseUrl ? `${ids.baseUrl}-error` : undefined}
            className={field}
          />
          {fieldError(ids.baseUrl, errors.baseUrl)}
        </div>
      ) : null}
      {errors.form ? (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-small text-danger">
          {errors.form}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Dialog.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? 'Checking…' : 'Check and save'}
        </Button>
      </div>
    </form>
  )
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  catalog,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  catalog: ProviderDescriptor[]
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-text/20" {...overlayFade} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                // Start on the first field, not the Close button.
                const select = (e.currentTarget as HTMLElement | null)?.querySelector('select')
                if (select) {
                  e.preventDefault()
                  select.focus()
                }
              }}
            >
              <motion.div
                className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-5 shadow-2"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1, transition: transitions.gentle }}
                exit={{ opacity: 0, scale: 0.98, transition: transitions.exit }}
              >
                <div className="flex items-center justify-between gap-2">
                  <Dialog.Title className="text-heading">Add an API key</Dialog.Title>
                  <Dialog.Close asChild>
                    <IconButton label="Close">
                      <X aria-hidden="true" />
                    </IconButton>
                  </Dialog.Close>
                </div>
                <Form catalog={catalog} onDone={() => onOpenChange(false)} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
