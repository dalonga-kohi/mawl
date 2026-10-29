import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'
import { Tooltip } from './Tooltip.tsx'

/**
 * shadcn's button, reshaped for Mawl: every button is a soft rounded rectangle (--r-md), presses scale to .97 (DESIGN §7),
 * focus uses the global accent ring, and touch screens get 44 px targets while mouse users keep
 * the denser sizes (DESIGN §11).
 */
export const buttonVariants = cva(
  [
    'tween inline-flex shrink-0 items-center justify-center rounded-md font-semibold whitespace-nowrap select-none',
    'active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent-fill text-on-accent hover:bg-accent-hover active:bg-accent-press',
        soft: 'bg-surface-2 text-text hover:bg-line',
        ghost: 'text-text-2 hover:bg-hover hover:text-text active:bg-selected',
        /** Third-party sign-in ("Continue with ChatGPT"): neutral, never the accent, so it reads as theirs. */
        contrast: 'bg-text text-bg hover:bg-text-2 active:bg-text',
      },
      size: {
        sm: 'h-8 gap-1.5 px-3.5 text-small pointer-coarse:h-11',
        md: 'h-10 gap-2 px-5 text-body pointer-coarse:h-11',
        icon: 'size-9 pointer-coarse:size-11',
      },
    },
    defaultVariants: { variant: 'soft', size: 'md' },
  },
)

type Variants = VariantProps<typeof buttonVariants>
type Variant = NonNullable<Variants['variant']>
type Size = Exclude<NonNullable<Variants['size']>, 'icon'>

/** The button look for elements that are not buttons, such as router links. */
export const buttonClass = (variant: Variant = 'soft', size: Size = 'md') =>
  buttonVariants({ variant, size })

type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
  /** Render the single child (a link, say) with the button look instead of a `<button>`. */
  asChild?: boolean
}

export function Button({
  variant = 'soft',
  size = 'md',
  asChild = false,
  className,
  type,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      // A child element keeps its own semantics; only real buttons default to type="button".
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    />
  )
}

type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** Required: icon buttons are named for screen readers and get a matching tooltip. */
  label: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/** A square ghost button holding one icon, with the same rounded corners as every button. */
export function IconButton({ label, tooltipSide = 'bottom', className, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <button
        type="button"
        data-slot="icon-button"
        aria-label={label}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), className)}
        {...rest}
      />
    </Tooltip>
  )
}
