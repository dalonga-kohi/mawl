// Runs before the first paint: index.html loads it as a blocking classic script from this origin
// (the CSP allows no inline script). It puts the saved theme, palette and reduced motion on <html>,
// so a palette other than Mawl never flashes one Mawl frame on a cold load. It mirrors
// applyAppearance in src/appearance/prefs.ts; src/appearance/prepaint.test.ts keeps the two and
// the palette list in step.
;(() => {
  const PALETTES = ['mawl', 'dracula', 'catppuccin', 'gruvbox', 'claude', 'rose-pine', 'nord']
  try {
    const raw = window.localStorage.getItem('mawl.appearance')
    const look = raw ? JSON.parse(raw) : null
    if (!look || typeof look !== 'object' || Array.isArray(look)) return
    const root = document.documentElement
    if (look.theme === 'light' || look.theme === 'dark') root.setAttribute('data-theme', look.theme)
    root.setAttribute('data-palette', PALETTES.indexOf(look.palette) >= 0 ? look.palette : 'mawl')
    if (look.reduceMotion === true) root.classList.add('reduce-motion')
  } catch (_e) {
    // Blocked storage or a hand-edited value: the stylesheet's defaults apply until the app loads.
  }
})()
