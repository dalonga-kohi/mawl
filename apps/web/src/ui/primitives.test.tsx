import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from './Badge.tsx'
import { Button, buttonClass, IconButton } from './Button.tsx'
import { Input, Textarea } from './Input.tsx'
import { Modal } from './Modal.tsx'
import { Switch } from './Switch.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.tsx'
import { Toaster } from './Toaster.tsx'
import { Tooltip, TooltipProvider } from './Tooltip.tsx'

const classes = (el: Element) => el.className.split(/\s+/)

describe('Button', () => {
  it('is a soft rounded rectangle with a press scale, a type of button and the touch-size bump', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('button')
    expect(classes(button)).toEqual(
      expect.arrayContaining(['rounded-md', 'active:scale-[.97]', 'pointer-coarse:h-11']),
    )
  })

  it('fills primary buttons with the accent fill and its on-accent text', () => {
    render(<Button variant="primary">Create</Button>)
    expect(classes(screen.getByRole('button', { name: 'Create' }))).toEqual(
      expect.arrayContaining(['bg-accent-fill', 'text-on-accent', 'hover:bg-accent-hover']),
    )
  })

  it('does not fire when disabled and dims itself', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(classes(button)).toContain('disabled:opacity-50')
  })

  it('lets a caller class win over the variant class', () => {
    render(<Button className="bg-danger">Remove</Button>)
    const c = classes(screen.getByRole('button', { name: 'Remove' }))
    expect(c).toContain('bg-danger')
    expect(c).not.toContain('bg-surface-2')
  })

  it('renders its child instead of a button with asChild, keeping the button look', () => {
    render(
      <Button asChild variant="primary">
        <a href="/t">Open teammates</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Open teammates' })
    expect(classes(link)).toEqual(expect.arrayContaining(['rounded-md', 'bg-accent-fill']))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps buttonClass for links styled as buttons', () => {
    expect(buttonClass('primary').split(' ')).toEqual(
      expect.arrayContaining(['rounded-md', 'bg-accent-fill']),
    )
  })
})

describe('IconButton', () => {
  it('is a named circle with a 44 px touch target and a matching tooltip', async () => {
    render(
      <TooltipProvider>
        <IconButton label="New teammate">+</IconButton>
      </TooltipProvider>,
    )
    const button = screen.getByRole('button', { name: 'New teammate' })
    expect(classes(button)).toEqual(
      expect.arrayContaining(['rounded-md', 'size-9', 'pointer-coarse:size-11']),
    )
    await userEvent.hover(button)
    expect((await screen.findByRole('tooltip')).textContent).toBe('New teammate')
  })
})

describe('Tooltip', () => {
  it('opens on keyboard focus as well as hover', async () => {
    render(
      <TooltipProvider>
        <Tooltip label="Search">
          <button type="button">s</button>
        </Tooltip>
      </TooltipProvider>,
    )
    await userEvent.tab()
    expect((await screen.findByRole('tooltip')).textContent).toBe('Search')
  })
})

function ModalHarness({ onChange }: { onChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <TooltipProvider>
      <Modal
        open={open}
        onOpenChange={(next) => {
          onChange?.(next)
          setOpen(next)
        }}
        title="New teammate"
      >
        <label>
          Name
          <input />
        </label>
      </Modal>
    </TooltipProvider>
  )
}

describe('Modal', () => {
  it('is a dialog named by its title that starts focus on the first field', () => {
    render(<ModalHarness />)
    const dialog = screen.getByRole('dialog', { name: 'New teammate' })
    expect(classes(dialog)).toContain('rounded-dialog')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
  })

  it('closes from the Close button and from Escape', async () => {
    const onChange = vi.fn()
    const { unmount } = render(<ModalHarness onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()

    render(<ModalHarness onChange={onChange} />)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Input and Textarea', () => {
  it('draws inputs and textareas as rounded cards, both marking invalid state', () => {
    render(
      <>
        <Input aria-label="Name" aria-invalid />
        <Textarea aria-label="Job" />
      </>,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(classes(input)).toEqual(
      expect.arrayContaining([
        'rounded-card',
        'pointer-coarse:h-11',
        'aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]',
      ]),
    )
    expect(classes(screen.getByRole('textbox', { name: 'Job' }))).toContain('rounded-card')
  })
})

describe('Switch', () => {
  it('toggles, and widens its hit area to 44 px without growing', async () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Reduce motion" onCheckedChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Reduce motion' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(classes(toggle)).toContain('before:-inset-[9px]')
  })
})

describe('Tabs', () => {
  it('switches panels with rounded triggers', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Panels">
          <TabsTrigger value="a">Computer</TabsTrigger>
          <TabsTrigger value="b">Memory</TabsTrigger>
        </TabsList>
        <TabsContent value="a">first</TabsContent>
        <TabsContent value="b">second</TabsContent>
      </Tabs>,
    )
    const memory = screen.getByRole('tab', { name: 'Memory' })
    expect(classes(memory)).toEqual(expect.arrayContaining(['rounded-md', 'pointer-coarse:h-11']))
    await userEvent.click(memory)
    expect(screen.getByRole('tabpanel').textContent).toBe('second')
  })
})

describe('Badge', () => {
  it('is a small rounded badge in the soft accent by default', () => {
    render(<Badge>3</Badge>)
    expect(classes(screen.getByText('3'))).toEqual(
      expect.arrayContaining(['rounded-sm', 'bg-accent-soft', 'text-accent-ink']),
    )
  })
})

describe('Toaster', () => {
  it('sits on the raised surface of the current theme, not an inverted ink pill', async () => {
    render(<Toaster />)
    act(() => {
      toast('Saved')
    })
    const text = await screen.findByText('Saved')
    const card = text.closest('[data-sonner-toast]') as HTMLElement
    expect(card.className).toContain('bg-surface')
    expect(card.className).toContain('text-text')
    expect(card.className).not.toContain('bg-text')
  })
})
