import type { ReactNode } from 'react'

/** A full-width page beside the rail: title, one line of purpose, then content. */
export function PageShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-7 pb-10 md:px-[clamp(16px,4vw,48px)]">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">{title}</h1>
        <p className="max-w-[68ch] text-text-2">{description}</p>
      </header>
      {children}
    </section>
  )
}
