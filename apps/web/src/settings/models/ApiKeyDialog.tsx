import {
  type ProviderCredentialInput,
  ProviderCredentialInput as ProviderCredentialInputSchema,
  type ProviderDescriptor,
  type ProviderKind,
} from '@mawl/contracts'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../../api/ApiProvider.tsx'
import { errorCode } from '../../api/providers-api.ts'
import { Button } from '../../ui/Button.tsx'
import { cn } from '../../ui/cn.ts'
import { DialogClose } from '../../ui/Dialog.tsx'
import { fieldClass, Modal } from '../../ui/Modal.tsx'
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

const field = cn(fieldClass, 'h-11')

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

  // An address the server would not check without the owner's say-so (D1.4 SSRF guard).
  const [privateRetry, setPrivateRetry] = useState<ProviderCredentialInput | null>(null)

  const save = useMutation({
    // The input holds the API key: don't keep it in the mutation cache after the dialog closes.
    gcTime: 0,
    mutationFn: async ({
      input,
      allowPrivateNetwork,
    }: {
      input: ProviderCredentialInput
      allowPrivateNetwork: boolean
    }) => {
      const check = await providers.test(
        allowPrivateNetwork ? { ...input, allowPrivateNetwork: true } : input,
      )
      if (!check.ok) return { saved: false as const, reason: check.reason }
      // The opt-in is for the check only; a saved credential never carries it.
      await providers.create(input)
      return { saved: true as const }
    },
    onSuccess: async (result, { input, allowPrivateNetwork }) => {
      setPrivateRetry(null)
      if (!result.saved) {
        if (result.reason === 'blocked_address' && !allowPrivateNetwork) {
          setPrivateRetry(input)
          setErrors({
            form: 'This address is on this computer or your private network. Mawl checks it only if you allow it.',
          })
          return
        }
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
              ? "Couldn't reach the Mawl server. Check that it's running, then try again."
              : "Mawl couldn't save this connection. Try again.",
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
        else next.form ??= 'Mawl refused these details. Check each field and try again.'
      }
    }
    setErrors(next)
    const firstInvalid = (['label', 'secret', 'baseUrl'] as const).find((f) => next[f])
    if (firstInvalid) {
      const id = { label: ids.label, secret: ids.secret, baseUrl: ids.baseUrl }[firstInvalid]
      document.getElementById(id)?.focus()
    }
    setPrivateRetry(null)
    if (parsed.success && Object.keys(next).length === 0) {
      save.mutate({ input: parsed.data, allowPrivateNetwork: false })
    }
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
            Stays on your Mawl server, encrypted. Mawl checks it with one small request.
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
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
          <p className="text-small text-danger">{errors.form}</p>
          {privateRetry ? (
            <Button
              size="sm"
              className="self-start"
              disabled={save.isPending}
              onClick={() => save.mutate({ input: privateRetry, allowPrivateNetwork: true })}
            >
              Allow and check again
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
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
    <Modal open={open} onOpenChange={onOpenChange} title="Add an API key">
      <Form catalog={catalog} onDone={() => onOpenChange(false)} />
    </Modal>
  )
}
