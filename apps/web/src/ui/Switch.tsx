import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/**
 * shadcn's switch at Mawl's size: 42 x 26, accent fill when on. It stays visually small, so a
 * pseudo-element widens the hit area to 44 px (DESIGN §11).
 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "tween relative inline-flex h-[26px] w-[42px] shrink-0 items-center rounded-full bg-line before:absolute before:-inset-[9px] before:content-['']",
        'data-[state=checked]:bg-accent-fill disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 translate-x-[3px] rounded-full bg-surface shadow-1 transition-transform duration-(--dur-slow) ease-out data-[state=checked]:translate-x-[19px]"
      />
    </SwitchPrimitive.Root>
  )
}
