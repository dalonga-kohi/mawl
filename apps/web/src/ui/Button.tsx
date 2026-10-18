import { motion } from 'motion/react'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { press } from '../motion/presets.ts'
import { cx } from './cx.ts'
import { Tooltip } from './Tooltip.tsx'

type Variant = 'primary' | 'soft' | 'ghost'
type Size = 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-accent-fill text-on-accent hover:bg-accent-hover active:bg-accent-press',
  soft: 'bg-surface-2 text-text hover:bg-line',
  ghost: 'text-text-2 hover:bg-surface-2 hover:text-text',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-small gap-1.5',
  md: 'h-10 px-4 text-body gap-2 font-semibold',
}

export const buttonClass = (variant: Variant = 'soft', size: Size = 'md') =>
  cx(
    'accent-tween inline-flex items-center justify-center rounded-sm font-semibold whitespace-nowrap',
    'disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0',
    variants[variant],
    sizes[size],
  )

type ButtonProps = Omit<
  ComponentPropsWithRef<typeof motion.button>,
  'children' | 'whileTap' | 'transition'
> & {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      className={cx(buttonClass(variant, size), className)}
      {...press}
      {...rest}
    />
  )
}

type IconButtonProps = Omit<ButtonProps, 'aria-label' | 'variant' | 'size'> & {
  /** Required: icon buttons are named for screen readers and get a matching tooltip. */
  label: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function IconButton({ label, tooltipSide = 'bottom', className, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <motion.button
        type="button"
        aria-label={label}
        className={cx(
          'grid size-9 place-items-center rounded-sm text-text-2 transition-colors duration-[120ms]',
          'hover:bg-surface-2 hover:text-text disabled:opacity-50 [&_svg]:size-[18px]',
          className,
        )}
        {...press}
        {...rest}
      />
    </Tooltip>
  )
}
