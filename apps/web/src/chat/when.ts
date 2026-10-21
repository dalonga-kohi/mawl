const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** A short time for lists: the clock time today, the month and day otherwise. */
export function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? clock.format(d) : day.format(d)
}
