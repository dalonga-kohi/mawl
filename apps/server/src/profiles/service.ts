import { newId, type Profile, type ProfileId, parseModelRef } from '@faire/contracts'
import { schema } from '@faire/db'
import { asc, count, eq, inArray, isNull, like, or } from 'drizzle-orm'
import type { ProvidersDb } from '../providers/types.ts'
import { EntityNotFoundError } from '../runs/errors.ts'
import { ACCENT_PRESETS, SlugTakenError, UnknownCredentialError } from './errors.ts'

const { profiles, providerCredentials } = schema

const SLUG_MAX = 40
const SLUG_FALLBACK = 'teammate'
const UNIQUE_VIOLATION = '23505'
/** Derived slugs lose a race to a concurrent create at most this often before we give up. */
const DERIVE_ATTEMPTS = 5

export interface ProfileCreateInput {
  name: string
  slug?: string | undefined
  color?: string | undefined
  personaMd?: string | undefined
  modelMain: string
  modelHelper?: string | undefined
}

export interface ProfilePatch {
  name?: string | undefined
  slug?: string | undefined
  color?: string | undefined
  personaMd?: string | undefined
  modelMain?: string | undefined
  modelHelper?: string | null | undefined
  heartbeatCron?: string | null | undefined
}

export interface ProfileService {
  list(options?: { includeArchived?: boolean | undefined } | undefined): Promise<Profile[]>
  get(id: ProfileId): Promise<Profile>
  create(input: ProfileCreateInput): Promise<Profile>
  update(id: ProfileId, patch: ProfilePatch): Promise<Profile>
  archive(id: ProfileId): Promise<Profile>
}

export interface ProfileServiceDeps {
  db: ProvidersDb
}

const toProfile = (row: typeof profiles.$inferSelect): Profile => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  color: row.color,
  personaMd: row.personaMd,
  modelMain: row.modelMain,
  modelHelper: row.modelHelper,
  heartbeatCron: row.heartbeatCron,
  createdAt: row.createdAt.toISOString(),
  archivedAt: row.archivedAt?.toISOString() ?? null,
})

/** Lowercase ascii, runs of anything else become one dash, at most 40 characters. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug === '' ? SLUG_FALLBACK : slug
}

/** `base`, then `base-2`, `base-3`..., the suffix always fitting inside the length cap. */
function candidate(base: string, n: number): string {
  if (n === 1) return base
  const suffix = `-${n}`
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
}

function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return (
    code(err) === UNIQUE_VIOLATION ||
    code((err as { cause?: unknown } | null)?.cause) === UNIQUE_VIOLATION
  )
}

export function createProfileService({ db }: ProfileServiceDeps): ProfileService {
  /** Every credential a model ref names must exist. Refs are validated by the contract already. */
  async function checkCredentials(refs: Array<string | null | undefined>): Promise<void> {
    const wanted = refs.flatMap((ref) => {
      const parsed = ref ? parseModelRef(ref) : null
      return parsed ? [parsed.credentialId] : []
    })
    if (wanted.length === 0) return
    const rows = await db
      .select({ id: providerCredentials.id })
      .from(providerCredentials)
      .where(inArray(providerCredentials.id, wanted))
    const found = new Set(rows.map((r) => r.id))
    const missing = wanted.find((id) => !found.has(id))
    if (missing) throw new UnknownCredentialError(missing)
  }

  async function row(id: ProfileId) {
    const [found] = await db.select().from(profiles).where(eq(profiles.id, id))
    if (!found) throw new EntityNotFoundError('profile', id)
    return found
  }

  async function takenSlugs(base: string): Promise<Set<string>> {
    const rows = await db
      .select({ slug: profiles.slug })
      .from(profiles)
      .where(or(eq(profiles.slug, base), like(profiles.slug, `${base.slice(0, SLUG_MAX - 2)}%-%`)))
    return new Set(rows.map((r) => r.slug))
  }

  async function freeSlug(name: string): Promise<string> {
    const base = slugify(name)
    const taken = await takenSlugs(base)
    for (let n = 1; ; n++) {
      const slug = candidate(base, n)
      if (!taken.has(slug)) return slug
    }
  }

  return {
    async list(options) {
      const query = db.select().from(profiles)
      const rows = await (options?.includeArchived
        ? query
        : query.where(isNull(profiles.archivedAt))
      ).orderBy(asc(profiles.createdAt), asc(profiles.id))
      return rows.map(toProfile)
    },

    async get(id) {
      return toProfile(await row(id))
    },

    async create(input) {
      await checkCredentials([input.modelMain, input.modelHelper])
      const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(profiles)
      const values = {
        name: input.name,
        color: input.color ?? ACCENT_PRESETS[total % ACCENT_PRESETS.length] ?? ACCENT_PRESETS[0],
        personaMd: input.personaMd ?? '',
        modelMain: input.modelMain,
        modelHelper: input.modelHelper ?? null,
      }
      for (let attempt = 0; attempt < DERIVE_ATTEMPTS; attempt++) {
        const slug = input.slug ?? (await freeSlug(input.name))
        try {
          const [inserted] = await db
            .insert(profiles)
            .values({ id: newId('profile'), slug, ...values })
            .returning()
          if (!inserted) throw new Error('profile insert returned no row')
          return toProfile(inserted)
        } catch (err) {
          if (!isUniqueViolation(err)) throw err
          if (input.slug !== undefined) throw new SlugTakenError(slug)
          // A derived slug lost a race: look again.
        }
      }
      throw new Error('could not find a free profile slug')
    },

    async update(id, patch) {
      const current = await row(id)
      // An archived teammate is gone from the app's view: editing it is a not-found, like start.
      if (current.archivedAt) throw new EntityNotFoundError('profile', id)
      await checkCredentials([patch.modelMain, patch.modelHelper])
      if (patch.slug !== undefined && patch.slug !== current.slug) {
        const [other] = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.slug, patch.slug))
        if (other) throw new SlugTakenError(patch.slug)
      }
      const set: Partial<typeof profiles.$inferInsert> = {}
      if (patch.name !== undefined) set.name = patch.name
      if (patch.slug !== undefined) set.slug = patch.slug
      if (patch.color !== undefined) set.color = patch.color
      if (patch.personaMd !== undefined) set.personaMd = patch.personaMd
      if (patch.modelMain !== undefined) set.modelMain = patch.modelMain
      if (patch.modelHelper !== undefined) set.modelHelper = patch.modelHelper
      if (patch.heartbeatCron !== undefined) set.heartbeatCron = patch.heartbeatCron
      if (Object.keys(set).length === 0) return toProfile(current)
      try {
        const [updated] = await db.update(profiles).set(set).where(eq(profiles.id, id)).returning()
        if (!updated) throw new EntityNotFoundError('profile', id)
        return toProfile(updated)
      } catch (err) {
        if (isUniqueViolation(err) && patch.slug !== undefined) throw new SlugTakenError(patch.slug)
        throw err
      }
    },

    async archive(id) {
      const current = await row(id)
      if (current.archivedAt) return toProfile(current)
      const [archived] = await db
        .update(profiles)
        .set({ archivedAt: new Date() })
        .where(eq(profiles.id, id))
        .returning()
      if (!archived) throw new EntityNotFoundError('profile', id)
      return toProfile(archived)
    },
  }
}
