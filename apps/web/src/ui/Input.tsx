import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/**
 * The shared field look (shadcn input, reshaped): a hairline ring at rest, the accent ring on
 * focus, a danger ring when `aria-invalid`. Inputs and selects are pills; textareas use --r-card (24 px)
 * so several lines still read as one soft card.
 */
const fieldBase = cn(
  'w-full min-w-0 bg-surface text-body text-text shadow-[0_0_0_1px_var(--line)] outline-none',
  'transition-shadow duration-(--dur-fast) ease-out placeholder:text-text-3',
  'focus-visible:shadow-[0_0_0_2px_var(--accent-ring)] focus-visible:outline-none',
  'aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

/** For native controls that are not an Input (a `<select>`, say). Pills, 40 px or 44 px on touch. */
export const fieldClass = cn(fieldBase, 'h-10 rounded-pill px-4 pointer-coarse:h-11')

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(fieldClass, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, 'min-h-20 resize-none rounded-card px-4 py-3', className)}
      {...props}
    />
  )
}

/** A native select with the pill look and our own chevron, so it matches the inputs around it. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(fieldClass, 'cursor-pointer appearance-none pr-10', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-text-3"
      />
    </div>
  )
}
