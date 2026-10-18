export {
  type ClaudeLoginTestOptions,
  resolveBundledClaudeBinary,
  testClaudeCodeLogin,
} from './auth-status.ts'
export { buildClaudeEnv, type ClaudeEnvOptions } from './env.ts'
export { type ClaudeCodeModelOptions, createClaudeCodeModel } from './model.ts'
export type {
  ClaudeQueryFn,
  ClaudeQueryHandle,
  ClaudeQueryOptions,
  ClaudeQueryParams,
} from './types.ts'
