import {
  type CredentialId,
  formatModelRef,
  type ProviderCredential,
  type ProviderKind,
} from '@mawl/contracts'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { errorCode } from '../api/providers-api.ts'
import { useCredentials } from '../settings/models/queries.ts'
import { Button, buttonClass } from '../ui/Button.tsx'
import { fieldClass, Modal } from '../ui/Modal.tsx'
import { useCreateProfile } from './queries.ts'

/** A sensible first model per provider, where Mawl knows one; otherwise the owner types it. */
const SUGGESTED_MODEL: Partial<Record<ProviderKind, string>> = {
  anthropic: 'claude-sonnet-5-5',
  anthropic_claude_code: 'claude-sonnet-5-5',
}

interface Errors {
  name?: string
  model?: string
  form?: string
}

function Form({ credentials, onDone }: { credentials: ProviderCredential[]; onDone: () => void }) {
  const create = useCreateProfile()
  const navigate = useNavigate()
  const usable = credentials.filter((c) => !c.reauthRequired)
  const [credentialId, setCredentialId] = useState(usable[0]?.id ?? '')
  const credential = usable.find((c) => c.id === credentialId)
  const [name, setName] = useState('')
  const [model, setModel] = useState(credential ? (SUGGESTED_MODEL[credential.provider] ?? '') : '')
  const [modelEdited, setModelEdited] = useState(false)
  const [job, setJob] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { name: useId(), credential: useId(), model: useId(), job: useId() }

  const pickCredential = (id: string) => {
    setCredentialId(id)
    const next = usable.find((c) => c.id === id)
    if (!modelEdited) setModel(next ? (SUGGESTED_MODEL[next.provider] ?? '') : '')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!name.trim()) next.name = 'Give your teammate a name.'
    else if (name.trim().length > 80) next.name = 'Keep the name under 80 characters.'
    if (!model.trim()) next.model = 'Enter the model id your provider uses.'
    setErrors(next)
    const first = (['name', 'model'] as const).find((f) => next[f])
    if (first) {
      document.getElementById(ids[first])?.focus()
      return
    }
    create.mutate(
      {
        name: name.trim(),
        modelMain: formatModelRef({
          credentialId: credentialId as CredentialId,
          modelId: model.trim(),
        }),
        ...(job.trim() ? { personaMd: job.trim() } : {}),
      },
      {
        onSuccess: (profile) => {
          toast(`${profile.name} is ready`)
          onDone()
          void navigate({ to: '/t/$slug', params: { slug: profile.slug } })
        },
        onError: (err) =>
          setErrors({
            form:
              errorCode(err) === 'UNKNOWN_CREDENTIAL'
                ? 'That model connection was removed. Pick another one.'
                : errorCode(err) === 'VALIDATION'
                  ? "The server didn't accept these details. Check each field and try again."
                  : errorCode(err) === undefined
                    ? "Couldn't reach the Mawl server. Check that it's running, then try again."
                    : "Mawl couldn't create this teammate. Try again.",
          }),
      },
    )
  }

  const error = (id: string, message?: string) =>
    message ? (
      <p id={`${id}-error`} className="text-small text-danger">
        {message}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.name} className="text-small font-semibold text-text-2">
          Name
        </label>
        <input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Inbox Sweeper"
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? `${ids.name}-error` : undefined}
          className={`${fieldClass} h-11`}
        />
        {error(ids.name, errors.name)}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.credential} className="text-small font-semibold text-text-2">
          Model connection
        </label>
        <select
          id={ids.credential}
          value={credentialId}
          onChange={(e) => pickCredential(e.target.value)}
          className={`${fieldClass} h-11`}
        >
          {usable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.model} className="text-small font-semibold text-text-2">
          Model
        </label>
        <input
          id={ids.model}
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setModelEdited(true)
          }}
          placeholder="The model's id, as your provider names it"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.model)}
          aria-describedby={errors.model ? `${ids.model}-error` : undefined}
          className={`${fieldClass} h-11 font-mono text-small`}
        />
        {error(ids.model, errors.model)}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.job} className="text-small font-semibold text-text-2">
          Job (optional)
        </label>
        <textarea
          id={ids.job}
          value={job}
          onChange={(e) => setJob(e.target.value)}
          rows={3}
          placeholder="Keep my inbox tidy and draft replies to clients. Never send without asking."
          className={`${fieldClass} resize-none py-2.5`}
        />
        <p className="text-small text-text-2">One or two sentences. You can change it later.</p>
      </div>
      {errors.form ? (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-small text-danger">
          {errors.form}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create teammate'}
        </Button>
      </div>
    </form>
  )
}

/** Name, model and an optional one-line job. The full persona editor arrives in P2.1. */
export function NewTeammateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const credentials = useCredentials()
  const usable = (credentials.data ?? []).filter((c) => !c.reauthRequired)
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New teammate">
      {credentials.isPending ? (
        <p className="text-small text-text-2">Loading your model connections…</p>
      ) : credentials.isError ? (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-small text-danger">
          Couldn't load your model connections. Check that the Mawl server is running.
        </p>
      ) : usable.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-text-2">
            A teammate needs a model to think with. Connect one first, then come back.
          </p>
          <div className="flex justify-end">
            <Link
              to="/settings"
              hash="models"
              className={buttonClass('primary')}
              onClick={() => onOpenChange(false)}
            >
              Connect a model
            </Link>
          </div>
        </div>
      ) : (
        <Form credentials={usable} onDone={() => onOpenChange(false)} />
      )}
    </Modal>
  )
}
