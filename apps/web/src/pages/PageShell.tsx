import type { ReactNode } from 'react'
import { ShowSidebarButton } from '../shell/ShowSidebarButton.tsx'

/** A full-width page inside the window panel: title, one line of purpose, then content. */
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
    <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-5 pb-10 md:px-[clamp(16px,4vw,48px)]">
      <header className="flex items-start gap-2">
        {/* Renders nothing while the sidebar is in view. */}
        <ShowSidebarButton />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title">{title}</h1>
          <p className="max-w-[68ch] text-text-2">{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}
