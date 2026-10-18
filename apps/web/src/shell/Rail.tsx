import { Link } from '@tanstack/react-router'
import { Beaver } from '../mascot/Beaver.tsx'
import { cx } from '../ui/cx.ts'
import { Tooltip } from '../ui/Tooltip.tsx'
import { MAIN_NAV, type NavItem, SETTINGS_NAV } from './nav.ts'

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <Tooltip label={item.label} side="right">
      <Link
        to={item.to}
        aria-label={item.label}
        className={cx(
          'accent-tween grid size-11 place-items-center rounded-sm text-text-2',
          'hover:bg-surface-2 hover:text-text active:scale-[.94]',
          'aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-ink',
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </Link>
    </Tooltip>
  )
}

/**
 * The 64 px rail (DESIGN.md §5). Below 760 px it becomes the bottom tab bar and the mascot steps
 * aside, since the screen belongs to the conversation.
 */
export function Rail() {
  return (
    <nav
      aria-label="Main"
      className={cx(
        'order-last flex items-center justify-around border-t border-line bg-surface px-2 py-1.5',
        'md:order-none md:flex-col md:justify-start md:gap-1.5 md:border-t-0 md:border-r md:px-0 md:py-3.5',
      )}
    >
      <div className="mb-2.5 hidden size-12 place-items-center rounded-md bg-accent-softer md:grid">
        <Beaver size={40} state="idle" />
      </div>
      {MAIN_NAV.map((item) => (
        <RailLink key={item.to} item={item} />
      ))}
      <span className="hidden flex-1 md:block" />
      <RailLink item={SETTINGS_NAV} />
    </nav>
  )
}
