import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/**
 * The shared field look (shadcn input, reshaped): a hairline ring at rest, the accent ring on
 * focus, a danger ring when `aria-invalid`. Inputs and selects are pills; textareas use --r-md so
 * several lines still read as one box.
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
      className={cn(fieldBase, 'min-h-20 resize-none rounded-md px-4 py-2.5', className)}
      {...props}
    />
  )
}
