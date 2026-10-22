import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

/**
 * Every page: one h1, no skipped heading levels in the page itself (the sidebar is a landmark of its
 * own), and every button or link has a name.
 */
const PAGES = ['/tools', '/routines', '/approvals', '/settings?section=appearance', '/t']

describe.each(PAGES)('accessibility basics on %s', (path) => {
  it('has one h1, in-order headings, and named buttons and links', async () => {
    await renderApp(path)
    const main = screen.getByRole('main')
    await waitFor(() => expect(within(main).getAllByRole('heading', { level: 1 }).length).toBe(1))

    const levels = within(main)
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)))
    levels.forEach((level, i) => {
      const previous = levels[i - 1] ?? 0
      expect(level, `heading ${i} jumps from h${previous} to h${level}`).toBeLessThanOrEqual(
        previous + 1,
      )
    })

    const unnamed = [...document.querySelectorAll('button, a[href]')].filter(
      (el) =>
        !el.getAttribute('aria-label') &&
        !el.getAttribute('aria-labelledby') &&
        !(el as HTMLButtonElement).labels?.length &&
        !el.textContent?.trim(),
    )
    expect(unnamed.map((el) => el.outerHTML.slice(0, 80))).toEqual([])
  })
})
