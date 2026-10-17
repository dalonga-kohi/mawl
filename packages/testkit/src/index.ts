export const packageName = '@faire/testkit'
export type {
  FakeModel,
  FakeModelOptions,
  RecordedCall,
  ScriptedToolCall,
  Turn,
  TurnUsage,
} from './fake-model'
export { fakeModel } from './fake-model'
export type { FixedClock } from './fixtures'
export { fixedClock, seededRandom, seq } from './fixtures'
export type { PostgresHandle } from './postgres'
export {
  DEFAULT_PG_IMAGE,
  describeWithPostgres,
  isDockerAvailable,
  startPostgres,
} from './postgres'
