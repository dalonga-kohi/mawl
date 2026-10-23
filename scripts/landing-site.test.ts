import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const site = join(import.meta.dirname, '..', 'site')
const origin = 'https://landing.test/'
const repository = 'https://github.com/dalonga-kohi/mawl'

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

const htmlFiles = files(site).filter((path) => path.endsWith('.html'))
const html = (path: string) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const ids = (source: string) => tags(source).flatMap((tag) => tag.attributes.id ?? [])

function tags(source: string) {
  return [...source.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)].map((match) => ({
    name: match[1]?.toLowerCase(),
    attributes: Object.fromEntries(
      [...(match[2] ?? '').matchAll(/\b([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((attribute) => [
        attribute[1]?.toLowerCase(),
        attribute[3],
      ]),
    ) as Record<string, string | undefined>,
  }))
}

function localTarget(reference: string, source: string) {
  const base = new URL(relative(site, source).replaceAll('\\', '/'), origin)
  const url = new URL(reference, base)
  if (url.origin !== new URL(origin).origin) return undefined
  let path = join(site, decodeURIComponent(url.pathname))
  if (url.pathname.endsWith('/')) path = join(path, 'index.html')
  return { path, hash: decodeURIComponent(url.hash.slice(1)) }
}

describe('published landing site', () => {
  it('ships the local resources referenced by its HTML and stylesheets', () => {
    for (const path of files(site).filter((file) => /\.(html|css)$/.test(file))) {
      const source = path.endsWith('.html') ? html(path) : readFileSync(path, 'utf8')
      const references = [...source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map(
        (match) => match[1] ?? '',
      )
      if (path.endsWith('.html')) {
        for (const tag of tags(source)) {
          for (const attribute of [
            'src',
            'poster',
            'data',
            ...(tag.name === 'link' ? ['href'] : []),
          ]) {
            const value = tag.attributes[attribute]
            if (value) references.push(value)
          }
          if (tag.attributes.srcset) {
            references.push(
              ...tag.attributes.srcset
                .split(',')
                .map((entry) => entry.trim().split(/\s+/)[0] ?? ''),
            )
          }
        }
      }
      for (const reference of references) {
        if (reference.startsWith('#')) continue
        const target = localTarget(reference, path)
        if (target) {
          expect(
            () => statSync(target.path).isFile(),
            `${relative(site, path)} references ${reference}`,
          ).not.toThrow()
          expect(statSync(target.path).isFile()).toBe(true)
        }
      }
    }
  })

  it('keeps section ids unique and resolves every local navigation destination', () => {
    expect(htmlFiles.length).toBeGreaterThan(0)
    for (const path of htmlFiles) {
      const source = html(path)
      const pageIds = ids(source)
      expect(new Set(pageIds).size, `duplicate ids in ${relative(site, path)}`).toBe(pageIds.length)
      for (const tag of tags(source).filter((tag) => tag.name === 'a')) {
        const reference = tag.attributes.href
        expect(reference, 'every navigation link needs a destination').toBeTruthy()
        if (!reference) continue
        const target = localTarget(reference, path)
        if (!target) continue
        expect(() => statSync(target.path), `missing link destination ${reference}`).not.toThrow()
        if (target.hash) {
          expect(ids(html(target.path)), `missing section ${reference}`).toContain(target.hash)
        }
      }
    }
  })

  it('sends outbound calls to action to the Mawl repository without collecting signups', () => {
    const allTags = htmlFiles.flatMap((path) => tags(html(path)))
    expect(allTags.some((tag) => tag.name === 'form')).toBe(false)
    const outboundLinks = allTags
      .filter((tag) => tag.name === 'a')
      .map((tag) => tag.attributes.href ?? '')
      .filter((reference) => !localTarget(reference, htmlFiles[0] ?? join(site, 'index.html')))
    expect(outboundLinks.length).toBeGreaterThan(0)
    for (const reference of outboundLinks) {
      const url = new URL(reference)
      expect(url.protocol).toBe('https:')
      expect(`${url.origin}${url.pathname}`.replace(/\/$/, '')).toMatch(
        new RegExp(`^${repository.replaceAll('.', '\\.')}(/|$)`),
      )
    }
  })
})
