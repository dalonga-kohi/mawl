import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })

const mix = (hex, to, t) => {
  const n = parseInt(hex.slice(1), 16)
  const m = (v) => Math.round(v + (to - v) * t)
  const r = m((n >> 16) & 255),
    g = m((n >> 8) & 255),
    b = m(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
const lighten = (h, t) => mix(h, 255, t)
const darken = (h, t) => mix(h, 0, t)

const WAYS = {
  orange: { body: '#FF9A4D', ink: '#35170A' },
  lavender: { body: '#BDA4ED', ink: '#1B1233' },
  purple: { body: '#7950E8', ink: '#F2F5FC' },
  night: { body: '#1B2433', ink: '#BDA4ED' },
  teal: { body: '#80DACE', ink: '#0B2F33' },
  peach: { body: '#F8B79B', ink: '#3A1A10' },
  rose: { body: '#F4A9C0', ink: '#3A1021' },
  sky: { body: '#A9C8F4', ink: '#12264A' },
}

const SW = 15
const stroke = (ink, extra = '', width = SW) =>
  `fill="none" stroke="${ink}" stroke-width="${width}" stroke-linejoin="miter" ${extra}`

// each eye glyph is drawn around (0,0), roughly 44 px wide
const GLYPH = {
  bar: (ink) => `<rect x="-9" y="-26" width="18" height="52" rx="9" fill="${ink}"/>`,
  up: (ink) => `<path d="M-22 12L0 -14L22 12" ${stroke(ink)}/>`,
  x: (ink) => `<path d="M-18 -18L18 18M18 -18L-18 18" ${stroke(ink)}/>`,
  plus: (ink) => `<path d="M-21 0H21M0 -21V21" ${stroke(ink)}/>`,
  star: (ink) =>
    [0, 60, 120]
      .map((a) => `<path d="M0 -22V22" ${stroke(ink, `transform="rotate(${a})"`, 12)}/>`)
      .join(''),
  ring: (ink) => `<circle r="16" ${stroke(ink, '', 11)}/>`,
  l: (ink) => `<path d="M-22 14V-6H22" ${stroke(ink)}/>`,
  r: (ink) => `<path d="M22 14V-6H-22" ${stroke(ink)}/>`,
}

const STATES = {
  idle: { l: 'bar', r: 'bar' },
  thinking: { l: 'ring', r: 'ring', dx: 10, dy: -14, extra: 'think' },
  working: { l: 'star', r: 'star' },
  waiting: { l: 'plus', r: 'plus', extra: 'ask' },
  done: { l: 'up', r: 'up' },
  oops: { l: 'x', r: 'x' },
  sleepy: { l: 'l', r: 'r', extra: 'z' },
}

let uid = 0
const CX = 200,
  CY = 200,
  R = 165

function orb(way, state = 'idle', treat = 'soft') {
  const id = ++uid
  const { body, ink } = way
  const s = STATES[state]
  const ex = 62,
    ey = 226
  const eyes =
    `<g transform="translate(${CX - ex + (s.dx ?? 0)} ${ey + (s.dy ?? 0)})">${GLYPH[s.l](ink)}</g>` +
    `<g transform="translate(${CX + ex + (s.dx ?? 0)} ${ey + (s.dy ?? 0)})">${GLYPH[s.r](ink)}</g>`

  let fill = body
  let defs = ''
  let over = ''
  if (treat === 'soft' || treat === 'grain') {
    const hi = lighten(body, 0.22),
      lo = darken(body, 0.14)
    defs += `<radialGradient id="g${id}" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${body}"/><stop offset="1" stop-color="${lo}"/></radialGradient>`
    fill = `url(#g${id})`
  }
  if (treat === 'grain') {
    const speck = darken(body, 0.38)
    defs +=
      `<filter id="n${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="t"/>` +
      `<feColorMatrix in="t" values="0 0 0 0 ${parseInt(speck.slice(1, 3), 16) / 255} 0 0 0 0 ${parseInt(speck.slice(3, 5), 16) / 255} 0 0 0 0 ${parseInt(speck.slice(5, 7), 16) / 255} 11 0 0 0 -5.9"/></filter>` +
      `<radialGradient id="m${id}" cx=".72" cy=".8" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>` +
      `<mask id="k${id}"><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#m${id})"/></mask>`
    over = `<g mask="url(#k${id})"><rect x="${CX - R}" y="${CY - R}" width="${2 * R}" height="${2 * R}" filter="url(#n${id})"/></g>`
  }

  let extra = ''
  if (s.extra === 'think')
    extra = `<g fill="${body}"><circle cx="350" cy="92" r="7"/><circle cx="372" cy="62" r="10"/></g>`
  if (s.extra === 'ask')
    extra = `<text x="318" y="76" font-family="system-ui,Segoe UI,Arial,sans-serif" font-weight="800" font-size="54" fill="${body}">?!</text>`
  if (s.extra === 'z')
    extra = `<g font-family="system-ui,Segoe UI,Arial,sans-serif" font-weight="800" fill="${body}"><text x="322" y="92" font-size="44">z</text><text x="354" y="58" font-size="30">z</text></g>`

  return (
    `<defs>${defs}</defs>` +
    `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${fill}"/>` +
    over +
    eyes +
    extra
  )
}

const svg = (inner, vb = '0 0 400 400', label = 'Mawl orb') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${label}">${inner}</svg>`

function icon(bg, way) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Mawl icon">` +
    `<rect width="1024" height="1024" fill="${bg}"/>` +
    `<g transform="translate(512 512) scale(1.95) translate(-200 -205)">${orb(way, 'idle', 'flat')}</g></svg>`
  )
}
const iconDark = icon('#0B1019', WAYS.orange)
const iconLight = icon('#F5F7FC', WAYS.orange)

writeFileSync(`${OUT}/mawl-flat.svg`, svg(orb(WAYS.orange, 'idle', 'flat')))
writeFileSync(`${OUT}/mawl-soft.svg`, svg(orb(WAYS.orange, 'idle', 'soft')))
writeFileSync(`${OUT}/mawl-grain.svg`, svg(orb(WAYS.orange, 'idle', 'grain')))
writeFileSync(`${OUT}/app-icon-dark.svg`, iconDark)
writeFileSync(`${OUT}/app-icon-light.svg`, iconLight)

const tile = (inner, label, size = 150) =>
  `<figure><div class="art" style="width:${size}px;height:${size}px">${svg(inner, '0 0 400 400', `Mawl orb: ${label}`)}</div><figcaption>${label}</figcaption></figure>`
const iconTile = (s, label, cls) =>
  `<figure><div class="icon ${cls}">${s}</div><figcaption>${label}</figcaption></figure>`

const treat = ['flat', 'soft', 'grain']
  .map((t) => tile(orb(WAYS.orange, 'idle', t), t, 220))
  .join('')
const states = Object.keys(STATES)
  .map((k) => tile(orb(WAYS.orange, k, 'soft'), k))
  .join('')
const ways = ['orange', 'lavender', 'purple', 'night', 'teal', 'peach', 'rose', 'sky']
  .map((k) => tile(orb(WAYS[k], 'idle', 'soft'), k))
  .join('')
const happy = ['orange', 'lavender', 'purple', 'night', 'teal', 'peach', 'rose', 'sky']
  .map((k) => tile(orb(WAYS[k], 'done', 'soft'), k))
  .join('')
const sizes = [96, 48, 32, 20]
  .map((s) => tile(orb(WAYS.orange, 'idle', 'flat'), `${s}px`, s))
  .join('')

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mawl orb</title>
<style>
:root{--bg:#F5F7FC;--panel:#fff;--tx:#1B2432;--tx2:#58677D}
@media (prefers-color-scheme:dark){:root{--bg:#0B1019;--panel:#1B2433;--tx:#F2F5FC;--tx2:#A7B2C4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,Segoe UI,sans-serif;padding:32px 24px 64px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--tx2);margin:36px 0 12px}
p{color:var(--tx2);margin:0}.wrap{max-width:1000px;margin:0 auto}
.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
figure{margin:0;text-align:center;background:var(--panel);border-radius:24px;padding:12px}
figcaption{font-size:12px;color:var(--tx2);margin-top:6px}
.art svg{width:100%;height:100%;display:block;overflow:visible}
.icon{width:220px;height:220px;border-radius:50px;overflow:hidden}.icon svg{width:100%;height:100%;display:block}
.icon.sm{width:64px;height:64px;border-radius:15px}.icon.xs{width:32px;height:32px;border-radius:8px}
.lt{background:#F5F7FC}.dk{background:#0B1019}
</style></head><body><div class="wrap">
<h1>Mawl orb</h1><p>One circle, one colour, glyph eyes. Expression comes from the eyes only; hats and accessories can sit on top later.</p>
<h2>Surface treatment (pick one)</h2><div class="row">${treat}</div>
<h2>States</h2><div class="row">${states}</div>
<h2>Colourways, idle</h2><div class="row">${ways}</div>
<h2>Colourways, done</h2><div class="row">${happy}</div>
<h2>On light and dark</h2><div class="row"><figure class="lt"><div class="art" style="width:200px;height:200px">${svg(orb(WAYS.purple, 'idle', 'soft'))}</div></figure><figure class="dk"><div class="art" style="width:200px;height:200px">${svg(orb(WAYS.orange, 'idle', 'soft'))}</div></figure></div>
<h2>Small sizes</h2><div class="row">${sizes}</div>
<h2>App icon</h2><div class="row">${iconTile(iconDark, 'dark', '')}${iconTile(iconLight, 'light', '')}${iconTile(iconDark, '64', 'sm')}${iconTile(iconLight, '64', 'sm')}${iconTile(iconDark, '32', 'xs')}${iconTile(iconLight, '32', 'xs')}</div>
</div></body></html>`
writeFileSync(`${OUT}/sheet.html`, html)
console.log('ok')
