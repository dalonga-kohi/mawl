import type { CredentialId } from '@faire/contracts'

/** Accent presets from DESIGN.md. New teammates rotate through them when no color is given. */
export const ACCENT_PRESETS = [
  '#3D8BFD',
  '#3FA36B',
  '#E09A1E',
  '#EF6F5E',
  '#8E6BE8',
  '#5B6B82',
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
