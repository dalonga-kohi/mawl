import type { ProviderService } from './service.ts'

/** A provider service for tests that never touch credentials: any call is a test bug. */
export const unusedProviders: ProviderService = {
  list: () => Promise.reject(new Error('providers.list not stubbed')),
  create: () => Promise.reject(new Error('providers.create not stubbed')),
  delete: () => Promise.reject(new Error('providers.delete not stubbed')),
  test: () => Promise.reject(new Error('providers.test not stubbed')),
  resolveCredential: () => Promise.reject(new Error('providers.resolveCredential not stubbed')),
}
