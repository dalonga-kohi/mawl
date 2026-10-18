/** Joins class names, skipping falsy parts. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')
