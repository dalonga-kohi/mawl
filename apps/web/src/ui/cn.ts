import { radii, typeScale } from '@mawl/ui'
import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's default scale names. Mawl's type sizes (`text-small`) would
 * otherwise read as text colors and be dropped next to `text-text-2`, so the scales come from the
 * same @mawl/ui tokens that tokens.css is generated from.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: Object.keys(typeScale),
      radius: Object.keys(radii),
      shadow: ['1', '2'],
    },
  },
})

/** shadcn's class helper: joins like clsx, then lets later Tailwind classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
