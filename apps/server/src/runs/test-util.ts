import {
  type CredentialId,
  type MessagePart,
  newId,
  type ProfileId,
  type RunId,
  type ThreadId,
} from '@faire/contracts'
import { schema } from '@faire/db'
import type { ProvidersDb } from '../providers/types.ts'

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
    color: '#3b82f6',
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
