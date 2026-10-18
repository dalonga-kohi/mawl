import { type CredentialId, type ProviderCredential, parseModelRef } from '@faire/contracts'
import {
  ModelNotConfiguredError,
  PROVIDER_DESCRIPTORS,
  type ProfileRecord,
  ProviderFailureError,
  type ResolvedModel,
  type RunRecord,
} from '@faire/core'
import { CredentialNotFoundError, CredentialUnreadableError } from '../providers/types.ts'

/** The slice of the provider service the run engine needs. */
export interface ModelProviders {
  list(): Promise<ProviderCredential[]>
  createModel(id: CredentialId, modelId: string): Promise<ResolvedModel['model']>
}

/**
 * Turns the profile's `<credentialId>:<modelId>` into a model. An unparseable ref or an unknown
 * credential fails the run as `model_not_configured`; a credential that cannot be decrypted as
 * `config_error`. Provider failures (e.g. a ChatGPT plan that needs re-auth) pass through.
 */
export function createModelResolver(providers: ModelProviders) {
  return async (_run: RunRecord, profile: ProfileRecord): Promise<ResolvedModel> => {
    const ref = parseModelRef(profile.modelMain)
    if (!ref) throw new ModelNotConfiguredError()
    const credential = (await providers.list()).find((c) => c.id === ref.credentialId)
    if (!credential) throw new ModelNotConfiguredError()
    try {
      const model = await providers.createModel(ref.credentialId, ref.modelId)
      return {
        model,
        supportsTools: PROVIDER_DESCRIPTORS[credential.provider].capabilities.supportsTools,
      }
    } catch (err) {
      if (err instanceof CredentialNotFoundError) throw new ModelNotConfiguredError()
      if (err instanceof CredentialUnreadableError) throw new ProviderFailureError('config_error')
      throw err
    }
  }
}
