import { ArrowUp, Paperclip, Plus, Square } from 'lucide-react'
import { motion } from 'motion/react'
import {
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react'
import { transitions } from '../motion/presets.ts'
import { cx } from '../ui/cx.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.tsx'
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

/** The send and stop circles press a little deeper than ordinary buttons. */
const circlePress = { whileTap: { scale: 0.94 }, transition: transitions.snappy } as const

const circle =
  'grid size-11 shrink-0 place-items-center rounded-pill accent-tween disabled:cursor-default'

/**
 * The pill composer (UI-REDESIGN.md §2): a round `+` menu, the autosizing input, the model chip and
 * a round send button that turns into Stop while the teammate works. The container's 28 px radius is
 * a pill at its one-line height of 56 px and reads as a soft card once the text wraps.
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
    <form
      onSubmit={submit}
      className={cx(
        'flex w-full items-end gap-1 rounded-panel bg-surface p-1.5',
        'shadow-[0_0_0_1px_var(--line),var(--shadow-1)]',
      )}
    >
      <AddMenu />
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
          className="max-h-[200px] min-h-11 w-full resize-none bg-transparent px-1 py-2.5 text-body text-text outline-none placeholder:text-text-3"
        />
      </label>
      {model ? (
        <span
          title="This teammate's model"
          className="mb-2 hidden h-7 max-w-[22ch] shrink-0 items-center truncate rounded-pill bg-surface-2 px-2.5 font-mono text-micro text-text-2 md:inline-flex"
        >
          {model}
        </span>
      ) : null}
      {busy ? (
        <Tooltip label="Stop" side="top">
          <motion.button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            disabled={stopping}
            className={cx(
              circle,
              'bg-accent-fill text-on-accent hover:bg-accent-hover active:bg-accent-press',
              'disabled:bg-surface-2 disabled:text-text-3',
            )}
            {...circlePress}
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
            circle,
            'bg-accent-fill text-on-accent hover:bg-accent-hover active:bg-accent-press',
            'disabled:bg-surface-2 disabled:text-text-3',
          )}
          {...circlePress}
        >
          <ArrowUp className="size-5" aria-hidden="true" />
        </motion.button>
      )}
    </form>
  )
})

/**
 * The `+` menu. Attachments have no upload path on the server yet, so the one item is shown
 * disabled rather than hidden: the control stays honest about what it will do.
 */
function AddMenu() {
  return (
    <DropdownMenu>
      <Tooltip label="Add to message" side="top">
        <DropdownMenuTrigger
          aria-label="Add to message"
          className={cx(
            circle,
            'text-text-2 hover:bg-surface-2 hover:text-text active:scale-[.94] data-[state=open]:bg-surface-2',
          )}
        >
          <Plus className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={10}>
        <DropdownMenuItem disabled>
          <Paperclip aria-hidden="true" />
          Attach files, soon
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
