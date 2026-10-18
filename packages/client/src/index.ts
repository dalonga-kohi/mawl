export const packageName = '@faire/client'

export type {
  FaireClient,
  FaireClientHandle,
  FaireClientOptions,
  FaireQueryUtils,
  FaireSocket,
  FaireSocketConstructor,
} from './client.ts'
export { createFaireClient } from './client.ts'
export type {
  EventStore,
  EventStoreOptions,
  EventStoreStatus,
  EventsApi,
  EventsSubscribeInput,
} from './event-store.ts'
export { createEventStore } from './event-store.ts'
