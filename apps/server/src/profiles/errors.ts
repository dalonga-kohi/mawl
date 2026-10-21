import type { CredentialId } from '@mawl/contracts'

/**
 * The soft accent presets of DESIGN.md §3 (the same values as `accentPresets` in @mawl/ui), Lime
 * first: the first teammate wears Mawl's own color. New teammates rotate through them when no color
 * is given; a teammate's stored color is never rewritten. The avatar pins the tint's lightness, so
 * every one keeps the mascot's eyes readable.
 */
export const ACCENT_PRESETS = [
  '#D8E88A',
  '#A9D3F5',
  '#F7C4A3',
  '#CBB9F4',
  '#F4B6C4',
  '#B9C3CF',
] as const

/** An explicit slug already belongs to another profile (archived ones keep theirs). */
export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super('Profile slug is already taken')
    this.name = 'SlugTakenError'
  }
}

/** A model ref names a credential that does not exist. */
export class UnknownCredentialError extends Error {
  constructor(readonly credentialId: CredentialId) {
    super('Model credential does not exist')
    this.name = 'UnknownCredentialError'
  }
}
