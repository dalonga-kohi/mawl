import { ProviderFailureError, type ResolvedModel, type RunRecord } from '@mawl/core'
import { fakeModelFrom } from '@mawl/testkit'

// Dev and test only. Nothing in the production entry (src/main.ts) imports this file, and a
// build test checks that the marker below never reaches dist/server.mjs.

/** Model id of the scripted model. Doubles as the marker the bundle test looks for. */
export const ECHO_MODEL_ID = 'mawl-e2e-echo-model'
/** Label of the credential the e2e server seeds, so the UI can pick it. */
export const E2E_CREDENTIAL_LABEL = 'E2E fake model'

/** About 630 characters of plain words: long enough that the UI's Stop button has time to be used. */
export const SLOW_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(14).trim()

const CHUNK_SIZE = 3
const ECHO_DELAY_MS = 30
const SLOW_DELAY_MS = 25

type Prompt = Parameters<ReturnType<typeof fakeModelFrom>['doStream']>[0]['prompt']

function lastUserText(prompt: Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i]
    if (message?.role !== 'user') continue
    return message.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
  }
  return ''
}

/**
 * Picks the scripted behaviour from the run's own prompt:
 * default echoes it, `/slow` streams a long paragraph, `/fail` fails the run with a plan limit.
 * `promptOf` reads the user message that started the run.
 */
export function createEchoResolver(promptOf: (run: RunRecord) => Promise<string>) {
  const echo = fakeModelFrom((o) => ({ text: `Echo: ${lastUserText(o.prompt)}` }), {
    chunkSize: CHUNK_SIZE,
    chunkDelayMs: ECHO_DELAY_MS,
    modelId: ECHO_MODEL_ID,
  })
  const slow = fakeModelFrom(() => ({ text: SLOW_TEXT }), {
    chunkSize: CHUNK_SIZE,
    chunkDelayMs: SLOW_DELAY_MS,
    modelId: ECHO_MODEL_ID,
  })
  return async (run: RunRecord, _profile: unknown): Promise<ResolvedModel> => {
    const prompt = await promptOf(run)
    if (prompt.includes('/fail')) throw new ProviderFailureError('plan_limit_reached')
    return { model: prompt.includes('/slow') ? slow : echo, supportsTools: false }
  }
}
