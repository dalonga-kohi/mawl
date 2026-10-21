export const packageName = '@mawl/client'

export type {
  MawlClient,
  MawlClientHandle,
  MawlClientOptions,
  MawlQueryUtils,
  MawlSocket,
  MawlSocketConstructor,
} from './client.ts'
export { createMawlClient } from './client.ts'
export type {
  EventStore,
  EventStoreOptions,
  EventStoreStatus,
  EventsApi,
  EventsSubscribeInput,
} from './event-store.ts'
export { createEventStore } from './event-store.ts'
