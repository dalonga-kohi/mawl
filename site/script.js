const preview = document.querySelector('.app-preview')
const previewControls = document.querySelector('.preview-controls')

if (preview instanceof HTMLElement && previewControls instanceof HTMLElement) {
  const themeButtons = previewControls.querySelectorAll('button[data-theme]')
  const screenButtons = previewControls.querySelectorAll('button[data-screen]')
  const chatScreen = document.getElementById('preview-chat')
  const connectionsScreen = document.getElementById('preview-connections')

  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      if (!(button instanceof HTMLButtonElement)) return
      const theme = button.dataset.theme
      if (theme !== 'light' && theme !== 'dark') return
      preview.dataset.previewTheme = theme
      for (const themeButton of themeButtons) {
        themeButton.setAttribute('aria-pressed', String(themeButton === button))
      }
    })
  }

  for (const button of screenButtons) {
    button.addEventListener('click', () => {
      if (!(button instanceof HTMLButtonElement)) return
      const screen = button.dataset.screen
      if (screen !== 'chat' && screen !== 'connections') return
      if (!chatScreen || !connectionsScreen) return
      chatScreen.hidden = screen !== 'chat'
      connectionsScreen.hidden = screen !== 'connections'
      for (const screenButton of screenButtons) {
        screenButton.setAttribute('aria-pressed', String(screenButton === button))
      }
    })
  }

  previewControls.hidden = false
}

const heroScene = document.querySelector('.hero-scene')
const mascotButton = document.querySelector('.mascot-greeting')
const motionToggle = document.querySelector('.motion-toggle')

if (
  heroScene instanceof HTMLElement &&
  mascotButton instanceof HTMLButtonElement &&
  motionToggle instanceof HTMLButtonElement
) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let paused = false
  let inView = true
  let greetingTimer

  const updateMotion = () => {
    heroScene.classList.toggle(
      'is-animated',
      !paused && inView && !document.hidden && !reducedMotion.matches,
    )
    motionToggle.hidden = reducedMotion.matches
    motionToggle.setAttribute('aria-pressed', String(paused))
    motionToggle.setAttribute(
      'aria-label',
      paused ? 'Resume mascot animation' : 'Pause mascot animation',
    )
  }

  motionToggle.addEventListener('click', () => {
    paused = !paused
    updateMotion()
  })

  mascotButton.addEventListener('click', () => {
    if (heroScene.classList.contains('is-greeting')) return
    heroScene.classList.add('is-greeting')
    clearTimeout(greetingTimer)
    greetingTimer = setTimeout(() => heroScene.classList.remove('is-greeting'), 1100)
  })

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? false
        updateMotion()
      },
      { threshold: 0.1 },
    )
    observer.observe(heroScene)
  }

  reducedMotion.addEventListener('change', updateMotion)
  document.addEventListener('visibilitychange', updateMotion)
  mascotButton.disabled = false
  document.documentElement.classList.add('motion-ready')
  updateMotion()
}
