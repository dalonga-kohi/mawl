import { useId, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.tsx'
import { Input, Textarea } from '../ui/Input.tsx'
import { CONTEXT_MAX, NAME_MAX } from './profile-prefs.ts'
import { useProfile } from './useProfile.ts'

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { profile, save } = useProfile()
  const [name, setName] = useState(profile.name)
  const [context, setContext] = useState(profile.context)
  const ids = { name: useId(), context: useId(), count: useId() }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save({ name, context })
        onDone()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.name} className="text-small font-semibold">
          Name
        </label>
        <Input
          id={ids.name}
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          placeholder="What should your teammates call you?"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.context} className="text-small font-semibold">
          Personal context
        </label>
        <Textarea
          id={ids.context}
          rows={6}
          value={context}
          maxLength={CONTEXT_MAX}
          aria-describedby={ids.count}
          placeholder="Anything you'd like your teammates to always know about you"
          onChange={(e) => setContext(e.target.value)}
        />
        <p id={ids.count} className="self-end text-micro text-text-3 tabular-nums">
          {context.length} / {CONTEXT_MAX}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="soft" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Opened from the sidebar's profile row: who you are, and what Mawl should always know. */
export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          // Start on the name field, not the Close button.
          const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('input')
          if (first) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Your teammates read this to know who they work for. It stays on this device for now.
        </DialogDescription>
        {/* The form remounts on every open, so Cancel always drops unsaved edits. */}
        {open ? <ProfileForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
