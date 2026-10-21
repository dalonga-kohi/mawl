import type { ReactNode, Ref } from 'react'
import { cx } from '../ui/cx.ts'

/** The raised card every settings group sits on: round, on --surface, airy. */
export const settingsCard = 'rounded-card bg-surface p-5 shadow-1'

/** A section's own title and one line of purpose, above its cards. */
export function SettingsSectionHeader({
  id,
  title,
  children,
  headingRef,
}: {
  id: string
  title: string
  children: ReactNode
  /** For sections that hand focus back to their heading (after a removal, say). */
  headingRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <header className="flex flex-col gap-1 pb-1">
      <h2
        id={id}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="scroll-mt-6 text-heading outline-none"
      >
        {title}
      </h2>
      <p className="text-small text-text-2">{children}</p>
    </header>
  )
}

/**
 * One settings card: a heading and a one-line helper, then the control. `inline` puts the control
 * to the right when there is room (it wraps below on phones); `stacked` always puts it below.
 */
export function SettingCard({
  title,
  helper,
  htmlFor,
  layout = 'inline',
  children,
}: {
  title: string
  helper: string
  /** Makes the title the control's label (for a lone switch, say). */
  htmlFor?: string
  layout?: 'inline' | 'stacked'
  children: ReactNode
}) {
  return (
    <div
      className={cx(
        settingsCard,
        'flex flex-col gap-4',
        layout === 'inline' && 'sm:flex-row sm:items-center sm:justify-between',
      )}
    >
      <div className="max-w-[46ch]">
        <h3 className="text-body font-semibold">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="cursor-pointer">
              {title}
            </label>
          ) : (
            title
          )}
        </h3>
        <p className="text-small text-text-2">{helper}</p>
      </div>
      {children}
    </div>
  )
}
