import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { UnsupportedFunctionalityError } from '@ai-sdk/provider'

export interface ClaudePrompt {
  /** System messages joined, or undefined when there are none. */
  system: string | undefined
  /** The conversation as one user prompt. */
  prompt: string
}

/**
 * Text only. The binary takes one prompt string plus a system prompt, so earlier turns become a
 * labelled transcript that ends on the last user message. Files, images and tool traffic are
 * refused rather than silently dropped: the model would answer a different question.
 */
export function toClaudePrompt(prompt: LanguageModelV4Prompt): ClaudePrompt {
  const system: string[] = []
  const turns: { role: 'User' | 'Assistant'; text: string }[] = []
  for (const message of prompt) {
    if (message.role === 'system') {
      system.push(message.content)
    } else if (message.role === 'tool') {
      throw new UnsupportedFunctionalityError({ functionality: 'tool results' })
    } else {
      let text = ''
      for (const part of message.content) {
        if (part.type === 'text') text += part.text
        // Reasoning from earlier turns is private to the model that wrote it.
        else if (part.type === 'reasoning') continue
        else {
          throw new UnsupportedFunctionalityError({
            functionality: part.type === 'file' ? 'file input' : `${part.type} content`,
          })
        }
      }
      turns.push({ role: message.role === 'user' ? 'User' : 'Assistant', text })
    }
  }
  const only = turns.length === 1 && turns[0]?.role === 'User' ? turns[0] : undefined
  return {
    system: system.length > 0 ? system.join('\n\n') : undefined,
    prompt: only ? only.text : turns.map((t) => `${t.role}: ${t.text}`).join('\n\n'),
  }
}
