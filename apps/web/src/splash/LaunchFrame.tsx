import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { transitions } from '../motion/presets.ts'
import { SplashField } from './Field.tsx'

/** The ring, the copy and the field fade away on Ready; the orb stays for the app to pick up. */
export const EXIT_MS = 280

/**
 * Every launch screen (the splash, the token gate): the field behind, the stage in the exact centre
 * of the window below the title bar (the top and bottom rows share the rest), copy and actions
 * under it. When the copy and actions need more room than the bottom row has, the stage glides up
 * instead of clipping.
 */
export function LaunchFrame({
  stage,
  leaving = false,
  children,
}: {
  stage: ReactNode
  leaving?: boolean
  children?: ReactNode
}) {
  return (
    <main className="relative grid min-h-[calc(100dvh-var(--titlebar-h))] overflow-hidden bg-bg text-text">
      <SplashField dimmed={leaving} />
      <div className="relative grid grid-rows-[1fr_auto_1fr] justify-items-center px-6 py-8">
        <span aria-hidden="true" />
        <motion.div layout="position" transition={transitions.glide}>
          {stage}
        </motion.div>
        <motion.div
          className="flex w-full max-w-[360px] flex-col items-center self-start pt-4 text-center"
          initial={false}
          animate={{
            opacity: leaving ? 0 : 1,
            y: leaving ? 6 : 0,
            transition: leaving ? { duration: EXIT_MS / 1000 } : transitions.gentle,
          }}
        >
          {children}
        </motion.div>
      </div>
    </main>
  )
}

/** A title and a line that cross-fade when they change, announced politely. */
export function Caption({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[4.5rem] flex-col items-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${title}|${detail}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: transitions.fade }}
          exit={{ opacity: 0, transition: transitions.exit }}
          className="flex flex-col items-center"
        >
          <h1 className="font-display text-title text-balance">{title}</h1>
          <p className="mt-1.5 max-w-[34ch] text-pretty text-text-2">{detail}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** A failed screen's actions: one primary, then quieter ways out, all on the keyboard path. */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: transitions.gentle }}
      className="mt-6 flex w-full max-w-[300px] flex-col items-stretch gap-3"
    >
      {children}
    </motion.div>
  )
}

export function Secondary({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-1">{children}</div>
}
