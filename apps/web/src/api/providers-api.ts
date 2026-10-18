import type {
  ChatGptAttemptStatus,
  ChatGptStartResult,
  CredentialId,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialRemoved,
  ProviderDescriptor,
  ProviderTestResult,
} from '@faire/contracts'

/**
 * What the Models settings need from the server. The app implements it with the typed client from
 * @faire/client; tests pass an in-memory fake. Errors carry the oRPC `code` (for example
 * `SIGN_IN_UNAVAILABLE`), never provider text.
 */
export interface ProvidersApi {
  catalog(): Promise<ProviderDescriptor[]>
  list(): Promise<ProviderCredential[]>
  create(input: ProviderCredentialInput): Promise<ProviderCredential>
  remove(id: CredentialId): Promise<ProviderCredentialRemoved>
  test(target: { id: CredentialId } | ProviderCredentialInput): Promise<ProviderTestResult>
  chatgptStart(): Promise<ChatGptStartResult>
  chatgptStatus(attemptId: string): Promise<ChatGptAttemptStatus>
  /** How often to poll a pending sign-in; defaults to 1.5 s. */
  chatgptPollMs?: number
}

/** The oRPC error code of a failed call, when there is one. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}
