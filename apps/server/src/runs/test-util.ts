import {
  type CredentialId,
  type MessagePart,
  newId,
  type ProfileId,
  type RunId,
  type ThreadId,
} from '@mawl/contracts'
import { schema } from '@mawl/db'
import type { ProvidersDb } from '../providers/types.ts'
import type { RunService } from './service.ts'

const { profiles, threads, runs, messages } = schema

export async function seedProfile(
  db: ProvidersDb,
  over: { modelMain?: string; personaMd?: string } = {},
): Promise<ProfileId> {
  const id = newId('profile')
  await db.insert(profiles).values({
    id,
    name: 'Ada',
    slug: `ada-${id.slice(-8).toLowerCase()}`,
    color: '#D8E88A',
    personaMd: over.personaMd ?? 'You are Ada.',
    modelMain: over.modelMain ?? `${newId('credential') as CredentialId}:fake`,
  })
  return id
}

export async function seedThread(
  db: ProvidersDb,
  profileId: ProfileId,
  lastEventAt: Date | null = null,
): Promise<ThreadId> {
  const id = newId('thread')
  await db.insert(threads).values({ id, profileId, channel: 'app', lastEventAt })
  return id
}

export async function seedRun(
  db: ProvidersDb,
  profileId: ProfileId,
  over: Partial<typeof runs.$inferInsert> = {},
): Promise<RunId> {
  const id = newId('run')
  await db.insert(runs).values({ id, profileId, trigger: 'user', ...over })
  return id
}

export async function seedMessage(
  db: ProvidersDb,
  threadId: ThreadId,
  role: 'user' | 'assistant',
  parts: MessagePart[],
  createdAt?: Date,
  runId?: RunId,
): Promise<void> {
  await db.insert(messages).values({
    id: newId('message'),
    threadId,
    role,
    parts,
    ...(createdAt ? { createdAt } : {}),
    ...(runId ? { runId } : {}),
  })
}

/** A run service for tests that never touch runs: any call is a test bug. */
export const unusedRuns: RunService = {
  start: () => Promise.reject(new Error('runs.start not stubbed')),
  get: () => Promise.reject(new Error('runs.get not stubbed')),
  cancel: () => Promise.reject(new Error('runs.cancel not stubbed')),
  pause: () => Promise.reject(new Error('runs.pause not stubbed')),
  resume: () => Promise.reject(new Error('runs.resume not stubbed')),
  listThreads: () => Promise.reject(new Error('runs.listThreads not stubbed')),
  threadMessages: () => Promise.reject(new Error('runs.threadMessages not stubbed')),
}
