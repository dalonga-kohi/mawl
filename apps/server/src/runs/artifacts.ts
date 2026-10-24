import { type ArtifactId, newId } from '@mawl/contracts'
import type { ArtifactStore } from '@mawl/core'
import { schema } from '@mawl/db'
import { and, eq } from 'drizzle-orm'
import type { ProvidersDb } from '../providers/types.ts'

const { artifacts } = schema

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Drizzle implementation of the tool registry's artifact store. Text is kept inline as UTF-8 bytes
 * (`content`); on-disk bodies (`path`) are not used yet. Every read filters on the profile, so one
 * teammate can never page through another's artifacts, and a foreign id reads as missing.
 */
export function createArtifactStore(db: ProvidersDb): ArtifactStore {
  return {
    async create(a): Promise<ArtifactId> {
      const id = newId('artifact')
      const bytes = encoder.encode(a.content)
      await db.insert(artifacts).values({
        id,
        profileId: a.profileId,
        runId: a.runId,
        mime: a.mime,
        sizeBytes: bytes.byteLength,
        preview: a.preview,
        tokenCount: a.tokenCount,
        content: bytes,
      })
      return id
    },

    async read(artifactId, profileId) {
      const [row] = await db
        .select({ content: artifacts.content })
        .from(artifacts)
        .where(and(eq(artifacts.id, artifactId), eq(artifacts.profileId, profileId)))
      if (!row || row.content === null) return null
      return { content: decoder.decode(row.content) }
    },
  }
}
