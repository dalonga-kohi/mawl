import { type ArtifactId, newId, type ProfileId, type RunId } from '@mawl/contracts'
import type { ArtifactStore, ToolCallKey, ToolEmit, ToolLedger, ToolResultRecord } from './types.ts'

export interface LedgerEvent {
  type: 'run.tool_call' | 'run.tool_result' | 'notify'
  runId: RunId
  payload: Record<string, unknown>
}

const keyOf = (runId: RunId, k: ToolCallKey) => `${runId}|${k.stepIdx}|${k.toolCallId}`

/** In-memory ToolLedger with the same first-writer-wins rule as the Drizzle store. */
export class MemoryLedger implements ToolLedger {
  readonly results = new Map<string, ToolResultRecord>()
  readonly events: LedgerEvent[] = []

  async toolResult(runId: RunId, key: ToolCallKey): Promise<ToolResultRecord | null> {
    return this.results.get(keyOf(runId, key)) ?? null
  }

  async recordToolCall(
    runId: RunId,
    call: Parameters<ToolLedger['recordToolCall']>[1],
  ): Promise<void> {
    this.events.push({ type: 'run.tool_call', runId, payload: { ...call } })
  }

  async recordToolResult(
    runId: RunId,
    key: ToolCallKey,
    record: ToolResultRecord,
    emit: readonly ToolEmit[],
  ): Promise<ToolResultRecord> {
    const k = keyOf(runId, key)
    const existing = this.results.get(k)
    if (existing) return existing
    this.results.set(k, record)
    this.events.push({
      type: 'run.tool_result',
      runId,
      payload: {
        toolCallId: key.toolCallId,
        preview: record.preview,
        isError: record.isError,
        ...(record.artifactId ? { artifactId: record.artifactId } : {}),
      },
    })
    for (const e of emit) this.events.push({ type: e.type, runId, payload: { ...e.payload } })
    return record
  }
}

/** In-memory ArtifactStore; reads are scoped to the owning profile. */
export class MemoryArtifacts implements ArtifactStore {
  readonly rows = new Map<
    ArtifactId,
    {
      profileId: ProfileId
      runId: RunId
      mime: string
      content: string
      preview: string
      tokenCount: number
    }
  >()

  async create(a: Parameters<ArtifactStore['create']>[0]): Promise<ArtifactId> {
    const id = newId('artifact')
    this.rows.set(id, { ...a })
    return id
  }

  async read(artifactId: ArtifactId, profileId: ProfileId): Promise<{ content: string } | null> {
    const row = this.rows.get(artifactId)
    return row && row.profileId === profileId ? { content: row.content } : null
  }
}
