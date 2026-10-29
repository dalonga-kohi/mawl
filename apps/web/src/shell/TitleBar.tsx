import { Copy, Minus, Square, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { transitions } from '../motion/presets.ts'
import { cn } from '../ui/cn.ts'
import type { WindowControls } from './window-controls.ts'

/** Windows' own caption buttons are 46 px wide; ours keep that hit area. */
const CAPTION_BUTTON = cn(
  'tween grid h-full w-[46px] shrink-0 place-items-center text-text-2',
  'hover:bg-hover hover:text-text active:scale-[.97] active:bg-selected',
  // The global accent ring, drawn inside so the bar's edge does not clip it.
  'focus-visible:outline-offset-[-2px]',
)

function CaptionButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(CAPTION_BUTTON, className)}
    >
      {children}
    </button>
  )
}

/**
 * The window's own title bar, replacing the native one (`decorations: false`). The bar and its
 * empty stretch are Tauri drag regions (a drag moves the window, a double click maximizes);
 * `children` are the app's items on the left and stay clickable. It reserves its height through
 * `html[data-titlebar]` (`--titlebar-h`), so the rest of the layout can subtract it. It wears the
 * palette through tokens and dims while the window is in the background.
 */
export function TitleBar({
  controls,
  children,
}: {
  controls: WindowControls
  children?: ReactNode
}) {
  const [maximized, setMaximized] = useState(false)
  const [focused, setFocused] = useState(true)

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-titlebar', '')
    return () => document.documentElement.removeAttribute('data-titlebar')
  }, [])

  useEffect(() => {
    let stop: (() => void) | undefined
    let gone = false
    void controls.watch({ onMaximized: setMaximized, onFocus: setFocused }).then((off) => {
      if (gone) off()
      else stop = off
    })
    return () => {
      gone = true
      stop?.()
    }
  }, [controls])

  const ToggleIcon = maximized ? Copy : Square
  return (
    <section
      data-tauri-drag-region
      aria-label="Title bar"
      data-focused={focused}
      data-maximized={maximized}
      className="flex h-(--titlebar-h) shrink-0 select-none items-stretch border-b border-line bg-bg text-text"
    >
      <div
        data-tauri-drag-region
        className={cn(
          'tween flex min-w-0 flex-1 items-center gap-1 pl-2',
          focused ? 'opacity-100' : 'opacity-60',
        )}
      >
        {children}
        <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
      </div>
      <div className={cn('tween flex', focused ? 'opacity-100' : 'opacity-60')}>
        <CaptionButton label="Minimize" onClick={() => void controls.minimize()}>
          <Minus aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </CaptionButton>
        <CaptionButton
          label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void controls.toggleMaximize()}
        >
          <motion.span
            key={maximized ? 'restore' : 'maximize'}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: transitions.bouncy }}
            className="grid place-items-center"
          >
            <ToggleIcon
              aria-hidden="true"
              className={maximized ? 'size-3.5' : 'size-3'}
              strokeWidth={1.5}
            />
          </motion.span>
        </CaptionButton>
        <CaptionButton
          label="Close"
          onClick={() => void controls.close()}
          className="hover:bg-danger hover:text-bg active:bg-danger"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </CaptionButton>
      </div>
    </section>
  )
}
