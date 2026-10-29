import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/**
 * shadcn's dropdown menu, reshaped: a rounded card (--r-card) whose rows (--r-sm) nest inside its
 * 6 px padding, a soft --hover highlight, 44 px rows on touch, and a quick settle-in that grows
 * from the trigger (Radix's transform origin).
 */
export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) flex-col gap-0.5 overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1.5 text-text shadow-2',
          'animate-in fade-in-0 zoom-in-[.98] duration-(--dur-fast) ease-out',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[.98]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export const menuItemClass = cn(
  'relative flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-small outline-none select-none pointer-coarse:min-h-11',
  'transition-colors duration-(--dur-fast) data-[highlighted]:bg-hover',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-2",
)

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'danger' }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        menuItemClass,
        variant === 'danger' && 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2.5 pt-1.5 pb-1 text-micro text-text-2', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1.5 my-1 h-px bg-line', className)}
      {...props}
    />
  )
}
