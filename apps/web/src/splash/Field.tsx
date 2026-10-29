import { spring } from '@mawl/ui'
import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from 'motion/react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'

/**
 * The launch screens' background (U14): a slow palette-coloured gradient field with riso grain
 * and a few of the orb's glyph marks drifting in it. On a fine pointer the layers follow the
 * pointer a little (parallax), the glyphs more than the glows. Decorative only: `aria-hidden`,
 * no pointer events. Reduced motion stops the drift and the parallax (splash.css and below).
 */

interface FieldGlyph {
  mark: string
  left: string
  top: string
  size: number
  tilt: number
  float: number
  delay: number
}

/** Placed by hand around the edges, clear of the centre column where the orb and copy sit. */
export const FIELD_GLYPHS: readonly FieldGlyph[] = [
  { mark: '+', left: '9%', top: '16%', size: 34, tilt: -8, float: 13, delay: 0 },
  { mark: '*', left: '84%', top: '12%', size: 40, tilt: 10, float: 16, delay: -4 },
  { mark: '^', left: '15%', top: '74%', size: 30, tilt: 6, float: 15, delay: -9 },
  { mark: '?', left: '88%', top: '68%', size: 36, tilt: -12, float: 12, delay: -2 },
  { mark: '!', left: '72%', top: '88%', size: 28, tilt: 8, float: 17, delay: -6 },
  { mark: '+', left: '30%', top: '6%', size: 22, tilt: 14, float: 18, delay: -11 },
  { mark: '*', left: '4%', top: '45%', size: 24, tilt: -4, float: 14, delay: -7 },
]

/** How far, in px, each layer moves at the window's edge. */
const DEPTH = { glows: 10, glyphs: 26 } as const

export function SplashField({ dimmed = false }: { dimmed?: boolean }) {
  const reduce = useReducedMotionConfig() ?? false
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const x = useSpring(px, spring.gentle)
  const y = useSpring(py, spring.gentle)

  useEffect(() => {
    if (reduce || !window.matchMedia?.('(pointer: fine)').matches) return
    const onMove = (e: PointerEvent) => {
      // -1 to 1 from the window's centre.
      px.set((e.clientX / window.innerWidth) * 2 - 1)
      py.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduce, px, py])

  return (
    <motion.div
      aria-hidden="true"
      data-field=""
      className="splash-field"
      initial={false}
      animate={{ opacity: dimmed ? 0 : 1 }}
      transition={{ duration: 0.28 }}
    >
      <Layer x={x} y={y} depth={DEPTH.glows}>
        <span className="splash-glow splash-glow-a" />
        <span className="splash-glow splash-glow-b" />
      </Layer>
      <span className="splash-grain" />
      <Layer x={x} y={y} depth={DEPTH.glyphs}>
        {FIELD_GLYPHS.map((g) => (
          <span
            key={`${g.mark}${g.left}${g.top}`}
            className="splash-glyph"
            style={
              {
                left: g.left,
                top: g.top,
                fontSize: g.size,
                '--tilt': `${g.tilt}deg`,
                '--float': `${g.float}s`,
                '--delay': `${g.delay}s`,
              } as CSSProperties
            }
          >
            {g.mark}
          </span>
        ))}
      </Layer>
    </motion.div>
  )
}

function Layer({
  x,
  y,
  depth,
  children,
}: {
  x: MotionValue<number>
  y: MotionValue<number>
  depth: number
  children: ReactNode
}) {
  const tx = useTransform(x, (v) => v * -depth)
  const ty = useTransform(y, (v) => v * -depth)
  return (
    <motion.div className="splash-field-layer" style={{ x: tx, y: ty }}>
      {children}
    </motion.div>
  )
}
