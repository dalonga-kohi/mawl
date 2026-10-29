import { PALETTE_IDS } from '@mawl/ui'
import { z } from 'zod'

/**
 * "Connect to a remote Mawl" as the splash sees it (Rust `mawl_host::remote` and the shell's
 * commands). Everything the host sends is parsed here; the owner token only ever travels from the
 * form to `connect_remote`, never back.
 */

export const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }),
  z.object({ kind: z.literal('remote'), origin: z.string().min(1) }),
])
export type Target = z.infer<typeof TargetSchema>

export const HEALTHS = ['ready', 'unreachable', 'not_mawl', 'token_refused', 'unhealthy'] as const
export type RemoteHealth = (typeof HEALTHS)[number]
const HealthSchema = z.enum(HEALTHS)

const UrlErrorSchema = z.enum([
  'empty',
  'too_long',
  'not_a_url',
  'scheme',
  'insecure',
  'user_info',
  'no_host',
  'not_an_origin',
])
const TokenErrorSchema = z.enum(['empty', 'length', 'characters'])

export const ConnectErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), reason: UrlErrorSchema }),
  z.object({ kind: z.literal('token'), reason: TokenErrorSchema }),
  z.object({ kind: z.literal('remote'), health: HealthSchema }),
  z.object({ kind: z.literal('store') }),
])
export type ConnectError = z.infer<typeof ConnectErrorSchema>

/**
 * The owner's look as the host last read it from the app (`mawl_host::appearance`). The host only
 * checks the palette's shape; which names exist is this build's call, so an unknown one is `null`
 * (the splash then wears Mawl) rather than a reason to drop the theme too. The host also sends the
 * window background it painted (`bg`), which the splash does not need and strips.
 */
export const HostAppearanceSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  palette: z.enum(PALETTE_IDS).nullable().catch(null),
  reduceMotion: z.boolean(),
})
export type HostAppearance = z.infer<typeof HostAppearanceSchema>

export function parseTarget(value: unknown): Target {
  const parsed = TargetSchema.safeParse(value)
  return parsed.success ? parsed.data : { kind: 'local' }
}

export function parseHealth(value: unknown): RemoteHealth {
  const parsed = HealthSchema.safeParse(value)
  return parsed.success ? parsed.data : 'unreachable'
}

/** A rejected `connect_remote`. Anything that is not one of ours (an ACL refusal) is a store error. */
export function parseConnectError(value: unknown): ConnectError {
  const parsed = ConnectErrorSchema.safeParse(value)
  return parsed.success ? parsed.data : { kind: 'store' }
}

export function parseHostAppearance(value: unknown): HostAppearance | null {
  const parsed = HostAppearanceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** `mawl.example.com`, or `192.168.1.20:7420` when the port matters. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/** Why a check failed and what to do about it. */
export function describeRemote(health: Exclude<RemoteHealth, 'ready'>, host: string): string {
  switch (health) {
    case 'unreachable':
      return `Mawl couldn’t reach ${host}. Check that it’s running and that this PC can reach it.`
    case 'not_mawl':
      return `Something answered at ${host}, but it isn’t Mawl. Check the address. Behind a proxy, add this address to that Mawl’s MAWL_ALLOWED_ORIGINS.`
    case 'token_refused':
      return `${host} didn’t accept the owner token. Enter the current one.`
    case 'unhealthy':
      return `${host} is running but lost its database. Try again in a moment.`
  }
}

export interface FieldMessage {
  /** Which part of the form the message belongs to. */
  field: 'url' | 'token' | 'form'
  message: string
}

const URL_COPY: Record<z.infer<typeof UrlErrorSchema>, string> = {
  empty: 'Enter the address of the remote Mawl.',
  too_long: 'That address is too long.',
  not_a_url: 'That doesn’t look like a web address.',
  no_host: 'That doesn’t look like a web address.',
  scheme: 'Use an address that starts with https://.',
  insecure:
    'Use an https:// address. Mawl never sends the owner token unencrypted over a network; plain http works only for a Mawl on this PC.',
  user_info: 'Leave the user name and password out of the address.',
  not_an_origin: 'Use just the address, with no path after it, like https://mawl.example.com.',
}

const TOKEN_COPY: Record<z.infer<typeof TokenErrorSchema>, string> = {
  empty: 'Enter the owner token.',
  length: 'Owner tokens are 32 to 512 characters long.',
  characters: 'Owner tokens use only letters, digits, - and _.',
}

export function connectErrorCopy(error: ConnectError): FieldMessage {
  switch (error.kind) {
    case 'url':
      return { field: 'url', message: URL_COPY[error.reason] }
    case 'token':
      return { field: 'token', message: TOKEN_COPY[error.reason] }
    case 'remote':
      return error.health === 'token_refused'
        ? { field: 'token', message: 'That Mawl didn’t accept this token. Check it and try again.' }
        : {
            field: 'url',
            message:
              error.health === 'ready'
                ? 'Mawl couldn’t finish connecting. Try again.'
                : describeRemote(error.health, 'That address'),
          }
    case 'store':
      return { field: 'form', message: 'Mawl couldn’t save the connection on this PC. Try again.' }
  }
}
