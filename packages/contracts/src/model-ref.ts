import { z } from 'zod'
import { CredentialId } from './ids'

/**
 * A model choice as stored in `profiles.model_main`: `<credentialId>:<modelId>`. The credential
 * says which provider account to call, the model id is passed to that provider untouched.
 */
export const ModelRef = z.object({
  credentialId: CredentialId,
  modelId: z.string().trim().min(1),
})
export type ModelRef = z.infer<typeof ModelRef>

/**
 * Splits at the FIRST colon only: credential ids never contain one, but model ids may
 * (`llama3:70b`) and may hold slashes (`meta/llama-3`). Null for anything that is not a ref,
 * including the old `provider:model` form.
 */
export function parseModelRef(value: string): ModelRef | null {
  if (typeof value !== 'string') return null
  const at = value.indexOf(':')
  if (at < 0) return null
  const parsed = ModelRef.safeParse({
    credentialId: value.slice(0, at),
    modelId: value.slice(at + 1),
  })
  return parsed.success ? parsed.data : null
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.credentialId}:${ref.modelId}`
}
