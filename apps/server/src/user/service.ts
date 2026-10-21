import type { UserProfile, UserProfileUpdate } from '@mawl/contracts'
import { schema } from '@mawl/db'
import { eq, sql } from 'drizzle-orm'
import type { ProvidersDb } from '../providers/types.ts'

const { userProfile } = schema

/** The single row's id; a check constraint in the table pins it. */
const ROW_ID = 1

/**
 * The owner's own profile. It is user-typed text and stays data: when the `user` core memory
 * block is built from it (D4.1), it must be placed as quoted owner data, never as instructions.
 */
export interface UserService {
  /** Empty strings until the owner saves; reading never writes a row. */
  get(): Promise<UserProfile>
  /** Replaces both fields in one statement and returns what was stored. Input is contract-validated. */
  update(input: UserProfileUpdate): Promise<UserProfile>
}

export interface UserServiceDeps {
  db: ProvidersDb
}

const EMPTY: UserProfile = Object.freeze({ name: '', personalContext: '' })

const toPublic = (row: { name: string; personalContext: string }): UserProfile => ({
  name: row.name,
  personalContext: row.personalContext,
})

export function createUserService({ db }: UserServiceDeps): UserService {
  // reason: nothing reads this into a prompt yet. D4.1 wires it into the `user` core block; it
  // must go in wrapped as untrusted owner data (server rules), not concatenated as instructions.
  return {
    async get() {
      const [row] = await db
        .select({ name: userProfile.name, personalContext: userProfile.personalContext })
        .from(userProfile)
        .where(eq(userProfile.id, ROW_ID))
      return row ? toPublic(row) : { ...EMPTY }
    },

    async update({ name, personalContext }) {
      // One upsert: concurrent saves serialize on the primary key, and a reader sees either the
      // old profile or the new one, never half of each.
      const [row] = await db
        .insert(userProfile)
        .values({ id: ROW_ID, name, personalContext })
        .onConflictDoUpdate({
          target: userProfile.id,
          set: { name, personalContext, updatedAt: sql`now()` },
        })
        .returning({ name: userProfile.name, personalContext: userProfile.personalContext })
      if (!row) throw new Error('user profile upsert returned no row')
      return toPublic(row)
    },
  }
}
