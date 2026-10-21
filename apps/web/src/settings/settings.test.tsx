import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { validateSettingsSearch } from '../pages/search.ts'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

const sections = () => screen.getByRole('navigation', { name: 'Settings sections' })
const current = () =>
  within(sections())
    .getAllByRole('link')
    .filter((l) => l.getAttribute('aria-current') === 'page')
    .map((l) => l.textContent)

describe('settings page', () => {
  it('lists only the sections that exist, and opens on Appearance', async () => {
    await renderApp('/settings')
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    const links = within(sections()).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Appearance', 'Models and keys'])
    expect(current()).toEqual(['Appearance'])
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Models and keys' })).toBeNull()
  })

  it('keeps the open section in the URL', async () => {
    const { user, router } = await renderApp('/settings')
    await user.click(within(sections()).getByRole('link', { name: 'Models and keys' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ section: 'models' }))
    expect(await screen.findByRole('region', { name: 'Models and keys' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Appearance' })).toBeNull()
    expect(current()).toEqual(['Models and keys'])
    await user.click(within(sections()).getByRole('link', { name: 'Appearance' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(current()).toEqual(['Appearance'])
  })

  it('opens the section named in the URL and falls back to Appearance for an unknown one', async () => {
    const first = await renderApp('/settings?section=models')
    expect(await screen.findByRole('region', { name: 'Models and keys' })).toBeTruthy()
    first.unmount()
    await renderApp('/settings?section=billing')
    expect(await screen.findByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(current()).toEqual(['Appearance'])
  })

  it('validates the section with a fallback', () => {
    expect(validateSettingsSearch({ section: 'models' })).toEqual({ section: 'models' })
    expect(validateSettingsSearch({})).toEqual({ section: 'appearance' })
    expect(validateSettingsSearch({ section: 42 })).toEqual({ section: 'appearance' })
  })

  it('keeps the same section switcher at phone width', async () => {
    stubViewport(390)
    const { user } = await renderApp('/settings')
    await user.click(within(sections()).getByRole('link', { name: 'Models and keys' }))
    expect(await screen.findByRole('region', { name: 'Models and keys' })).toBeTruthy()
  })

  it('keeps the sidebar gear marked while any section is open', async () => {
    await renderApp('/settings?section=models')
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' })
    const gear = within(sidebar).getByRole('link', { name: 'Settings' })
    expect(gear.getAttribute('aria-current')).toBe('page')
  })

  it('groups appearance into calm cards: theme, accent color and motion', async () => {
    await renderApp('/settings')
    const region = screen.getByRole('region', { name: 'Appearance' })
    const headings = within(region)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['Theme', 'Accent color', 'Reduce motion'])
    const theme = within(region).getByRole('radiogroup', { name: 'Theme' })
    expect(
      within(theme)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Light', 'Dark', 'System'])
    const accents = within(region).getByRole('radiogroup', { name: 'Accent color' })
    expect(
      within(accents)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Lime', 'Sky', 'Peach', 'Lilac', 'Rose', 'Slate'])
    expect(within(region).getByText("Lime is Mawl's own color.")).toBeTruthy()
  })

  it('explains that a custom accent is adjusted to stay readable', async () => {
    localStorage.setItem(
      'mawl.appearance',
      JSON.stringify({ theme: 'system', accent: '#12A4B0', reduceMotion: false }),
    )
    await renderApp('/settings')
    const region = screen.getByRole('region', { name: 'Appearance' })
    expect(
      within(region).getByText(
        'Custom color. Mawl adjusts text and focus rings on it so they stay readable.',
      ),
    ).toBeTruthy()
  })
})

describe('links into settings', () => {
  it('the palette Settings entry wears the same gear as the sidebar', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    const item = within(palette).getByRole('option', { name: 'Settings' })
    const sidebarGear = within(screen.getByRole('complementary', { name: 'Sidebar', hidden: true }))
      .getByRole('link', { name: 'Settings', hidden: true })
      .querySelector('svg')
    expect(item.querySelector('svg')?.getAttribute('class')).toBe(
      sidebarGear?.getAttribute('class'),
    )
  })
})
