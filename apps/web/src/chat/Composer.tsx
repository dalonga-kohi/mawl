import { ArrowUp, Square } from 'lucide-react'
import { motion } from 'motion/react'
import {
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react'
import { press } from '../motion/presets.ts'
import { cx } from '../ui/cx.ts'
import { Tooltip } from '../ui/Tooltip.tsx'

const MAX_HEIGHT = 200

export interface ComposerHandle {
  focus(): void
}

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  /** A run is going: the send button becomes Stop. */
  busy: boolean
  /** The send itself is in flight. */
  sending: boolean
  stopping: boolean
  placeholder: string
  label: string
  /** Shown as a quiet chip: which model answers. */
  model?: string | undefined
  onFocusChange?: (focused: boolean) => void
}

/**
 * Autosizing input, model chip and the send button, which turns into Stop while the teammate works.
 * Enter sends and Shift+Enter adds a line; Enter that confirms an IME composition never sends.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    onStop,
    busy,
    sending,
    stopping,
    placeholder,
    label,
    model,
    onFocusChange,
  },
  ref,
) {
  const area = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), [])

  // Grow with the text up to MAX_HEIGHT, then scroll inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !busy && !sending

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (canSend) onSend()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  return (
    <div className="px-3 pt-2 pb-3 md:px-5 md:pb-4">
      <form
        onSubmit={submit}
        className="mx-auto flex max-w-[76ch] items-end gap-2 rounded-lg bg-surface py-2 pr-2 pl-3.5 shadow-[var(--shadow-1),0_0_0_1px_var(--line)] transition-shadow duration-[200ms] focus-within:shadow-[0_0_0_2px_var(--accent-ring)]"
      >
        <label className="flex min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <textarea
            ref={area}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder={placeholder}
            className="max-h-[200px] min-h-9 w-full resize-none bg-transparent py-1.5 text-body text-text outline-none placeholder:text-text-3"
          />
        </label>
        {model ? (
          <span
            title="This teammate's model"
            className="mb-1.5 hidden h-7 max-w-[22ch] items-center truncate rounded-pill bg-surface-2 px-2.5 font-mono text-micro text-text-2 md:inline-flex"
          >
            {model}
          </span>
        ) : null}
        {busy ? (
          <Tooltip label="Stop">
            <motion.button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              disabled={stopping}
              className="grid size-9 pointer-coarse:size-11 shrink-0 place-items-center rounded-sm bg-surface-2 text-text hover:bg-line disabled:opacity-50"
              {...press}
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </motion.button>
          </Tooltip>
        ) : (
          <motion.button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className={cx(
              'accent-tween grid size-9 pointer-coarse:size-11 shrink-0 place-items-center rounded-sm bg-accent-fill text-on-accent',
              'hover:bg-accent-hover active:bg-accent-press disabled:cursor-default disabled:opacity-45',
            )}
            {...press}
          >
            <ArrowUp className="size-[18px]" aria-hidden="true" />
          </motion.button>
        )}
      </form>
    </div>
  )
})
