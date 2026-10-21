import { useId, useRef, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import { cn } from '../ui/cn.ts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.tsx'
import { Input, Textarea } from '../ui/Input.tsx'
import { CONTEXT_MAX, isEmptyProfile, NAME_MAX } from './profile-prefs.ts'
import { useProfile, useSaveProfile } from './useProfile.ts'

/** What is wrong with each field, in words that say how to fix it; null when it is fine. */
function fieldErrors(name: string, context: string) {
  const over = context.length - CONTEXT_MAX
  return {
    name: name.trim().length > NAME_MAX ? `Keep your name to ${NAME_MAX} characters.` : null,
    context: over > 0 ? `Trim it by ${over} ${over === 1 ? 'character' : 'characters'}.` : null,
  }
}

function FieldSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="h-3.5 w-24 animate-pulse rounded-xs bg-surface-2" />
      <span
        className={cn('animate-pulse bg-surface-2', tall ? 'h-36 rounded-md' : 'h-10 rounded-pill')}
      />
    </div>
  )
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { profile, loading, failed } = useProfile()
  const save = useSaveProfile()
  const [name, setName] = useState(profile.name)
  const [context, setContext] = useState(profile.personalContext)
  const nameRef = useRef<HTMLInputElement>(null)
  const contextRef = useRef<HTMLTextAreaElement>(null)
  const ids = {
    name: useId(),
    nameError: useId(),
    context: useId(),
    contextHelp: useId(),
  }
  const errors = fieldErrors(name, context)

  // Nothing cached and the server hasn't answered: don't let the owner type over a profile
  // that is about to arrive.
  if (loading && isEmptyProfile(profile)) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading your profile</span>
        <FieldSkeleton />
        <FieldSkeleton tall />
      </div>
    )
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (save.isPending) return
        if (errors.name) return nameRef.current?.focus()
        if (errors.context) return contextRef.current?.focus()
        save.mutate({ name, personalContext: context }, { onSuccess: onDone })
      }}
    >
      {failed ? (
        <p role="status" className="rounded-md bg-warn-soft px-3.5 py-2.5 text-small text-text">
          Couldn't load your saved profile. You can still edit it here and save.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.name} className="text-small font-semibold">
          Name
        </label>
        <Input
          ref={nameRef}
          id={ids.name}
          value={name}
          autoComplete="off"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? ids.nameError : undefined}
          placeholder="What should your teammates call you?"
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name ? (
          <p id={ids.nameError} className="text-small text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.context} className="text-small font-semibold">
          Personal context
        </label>
        <Textarea
          ref={contextRef}
          id={ids.context}
          rows={6}
          value={context}
          aria-invalid={errors.context ? true : undefined}
          aria-describedby={ids.contextHelp}
          placeholder="Anything you'd like your teammates to always know about you"
          onChange={(e) => setContext(e.target.value)}
        />
        <div id={ids.contextHelp} className="flex items-start justify-between gap-3">
          <p className="text-small text-danger">{errors.context}</p>
          <p
            className={cn(
              'shrink-0 text-micro tabular-nums',
              errors.context ? 'font-semibold text-danger' : 'text-text-3',
            )}
          >
            {context.length} / {CONTEXT_MAX}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="soft" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
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
          Your teammates read this to know who they work for. It's saved on your Mawl server.
        </DialogDescription>
        {/* The form remounts on every open, so Cancel and Escape always drop unsaved edits. */}
        {open ? <ProfileForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
