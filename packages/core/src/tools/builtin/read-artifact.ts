import { ArtifactId } from '@mawl/contracts'
import { z } from 'zod'
import { defineTool } from '../define.ts'
import type { ArtifactStore, Tool } from '../types.ts'

/** Largest page, in characters: about 3k tokens, under the artifact threshold, so a page never becomes an artifact. */
export const READ_ARTIFACT_MAX_CHARS = 12_000
const DEFAULT_LIMIT = 8_000

/**
 * `read_artifact`: pages through a stored large output by character offset. Reads are scoped to
 * the run's profile; another profile's artifact reads exactly like a missing one.
 */
export function readArtifactTool(artifacts: ArtifactStore): Tool {
  return defineTool({
    name: 'read_artifact',
    description:
      'Read part of a saved large tool output (an artifact) by character offset. Use the ' +
      'artifactId from an earlier result, and read only the part you need.',
    inputSchema: z.strictObject({
      artifactId: ArtifactId,
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(READ_ARTIFACT_MAX_CHARS).default(DEFAULT_LIMIT),
    }),
    actionClass: 'read',
    artifacts: false,
    run: async ({ artifactId, offset, limit }, ctx) => {
      const found = await artifacts.read(artifactId, ctx.profileId)
      if (!found) {
        return {
          kind: 'error',
          code: 'artifact_not_found',
          message: `No artifact ${artifactId} is available to this teammate.`,
        }
      }
      const total = found.content.length
      if (offset >= total) {
        return {
          kind: 'ok',
          text: '',
          note: `Offset ${offset} is past the end: the artifact has ${total} characters.`,
        }
      }
      const end = Math.min(total, offset + limit)
      const next =
        end < total ? `Call again with offset ${end} for more.` : 'This is the end of the artifact.'
      return {
        kind: 'ok',
        text: found.content.slice(offset, end),
        note: `Characters ${offset} to ${end} of ${total}. ${next}`,
      }
    },
  })
}
