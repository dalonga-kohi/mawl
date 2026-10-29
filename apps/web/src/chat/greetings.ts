/**
 * The landing's one-liners. `{name}` is the owner's first name; a line that has it reads fine
 * without it too (the placeholder and the comma before it just drop out).
 */
export const GREETINGS = [
  "What's next, {name}?",
  'How can I help you?',
  'What are we working on, {name}?',
  'Ready when you are.',
  'What should we tackle today?',
  'Good to see you, {name}.',
  'Where do we start?',
  'What is on your mind, {name}?',
] as const

let sessionIndex: number | undefined

/** The line for this session: picked at random on first use, then the same until the app reloads. */
export function greetingFor(ownerName: string): string {
  if (sessionIndex === undefined) sessionIndex = Math.floor(Math.random() * GREETINGS.length)
  const line = GREETINGS[sessionIndex] ?? GREETINGS[0]
  const first = ownerName.trim().split(/\s+/)[0] ?? ''
  if (first) return line.replace('{name}', first)
  return line
    .replace(/,?\s*\{name\}/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Forgets the session's pick. Tests only. */
export function resetSessionGreeting(): void {
  sessionIndex = undefined
}
