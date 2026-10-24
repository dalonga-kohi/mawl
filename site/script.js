import { createScrollExperience } from './scroll-experience.js'

const motion = window.Motion
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const root = document.documentElement
const motionToggle = document.querySelector('#motion-toggle')
const garden = document.querySelector('.garden')
const mochi = document.querySelector('#say-hello')
const speech = document.querySelector('#mochi-speech')
const ambient = []
let paused = reducedMotion.matches
let gardenVisible = true
let greetingAnimation
let speechTimeout
let greetingIndex = 0

try {
  paused ||= localStorage.getItem('mawl-motion') === 'paused'
} catch {
  /* Storage is optional. */
}

const scrollExperience = createScrollExperience({ motion, reducedMotion, isPaused: () => paused })

function animate(element, keyframes, options) {
  return motion?.animate(element, keyframes, options)
}

function syncMotion() {
  root.classList.toggle('motion-paused', paused)
  root.classList.toggle('page-hidden', document.hidden)
  document
    .querySelector('.studio-scene')
    .classList.toggle('scene-still', paused || !gardenVisible || document.hidden)
  motionToggle.setAttribute('aria-pressed', String(paused))
  motionToggle.querySelector('span').textContent = paused ? 'Resume motion' : 'Pause motion'
  motionToggle.querySelector('use').setAttribute('href', paused ? '#play' : '#pause')
  for (const animation of ambient) {
    if (paused || !gardenVisible || document.hidden || garden.contains(document.activeElement)) {
      animation.pause()
    } else {
      animation.play()
    }
  }
  scrollExperience.sync()
}

motionToggle.addEventListener('click', () => {
  paused = !paused
  try {
    localStorage.setItem('mawl-motion', paused ? 'paused' : 'playing')
  } catch {
    /* Storage is optional. */
  }
  syncMotion()
})
reducedMotion.addEventListener('change', () => {
  paused = reducedMotion.matches
  syncMotion()
})
document.addEventListener('visibilitychange', syncMotion)
garden.addEventListener('focusin', syncMotion)
garden.addEventListener('focusout', () => queueMicrotask(syncMotion))

if (motion) {
  ambient.push(
    animate(
      '.night-spark-one',
      { rotate: [0, 360] },
      { duration: 80, repeat: Infinity, ease: 'linear' },
    ),
    animate(
      '.night-spark-two',
      { x: [0, -8, 0], y: [0, -9, 0] },
      { duration: 6, repeat: Infinity, ease: 'easeInOut' },
    ),
    animate(
      '.studio-window-light',
      { opacity: [0.35, 0.7, 0.35] },
      { duration: 8, repeat: Infinity, ease: 'easeInOut' },
    ),
    animate(
      '.studio-motes',
      { y: [0, -8, 0], opacity: [0.4, 0.85, 0.4] },
      { duration: 10, repeat: Infinity, ease: 'easeInOut' },
    ),
    animate(
      '.hero-mochi-body',
      { y: [0, -2.2, 0], scaleX: [1, 1.012, 1], rotate: [0, -0.8, 0] },
      { duration: 3.8, repeat: Infinity, ease: 'easeInOut' },
    ),
  )
  const route = document.querySelector('#studio-route')
  const signal = document.querySelector('.studio-signal')
  const routeLength = route.getTotalLength()
  ambient.push(
    motion.animate(0, 1, {
      duration: 12,
      repeat: Infinity,
      ease: 'linear',
      onUpdate: (progress) => {
        const point = route.getPointAtLength(routeLength * progress)
        signal.setAttribute('cx', point.x)
        signal.setAttribute('cy', point.y)
      },
    }),
  )
  document.fonts.ready.then(() => {
    if (paused || document.hidden || scrollY > 1) return
    // Keep the layout still while fonts settle; entrance motion changes only opacity.
    animate('.hero-copy', { opacity: [0.92, 1] }, { duration: 0.5, ease: 'easeOut' })
    animate('.garden', { opacity: [0.92, 1] }, { duration: 0.65, ease: 'easeOut' })
  })
}
new IntersectionObserver(
  ([entry]) => {
    gardenVisible = entry.isIntersecting
    syncMotion()
  },
  { threshold: 0.15 },
).observe(garden)
syncMotion()

const infographicVisibility = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-asleep', !entry.isIntersecting)
  },
  { threshold: 0.1 },
)
for (const illustration of document.querySelectorAll('.ownership-art'))
  infographicVisibility.observe(illustration)

const greetings = [
  'What can we take off your list?',
  'A good handoff goes a long way.',
  'Less routine. More creating.',
  'Your next idea has a team.',
]
mochi.addEventListener('click', () => {
  clearTimeout(speechTimeout)
  greetingAnimation?.stop()
  speech.textContent = greetings[greetingIndex++ % greetings.length]
  speech.style.opacity = '1'
  speech.style.transform = 'translateY(0)'
  if (!paused) {
    greetingAnimation = animate(
      '.hero-mochi-body',
      { y: [0, -3, 0], rotate: [0, -3, 2, 0], scaleX: [1, 0.985, 1.025, 1] },
      { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
    )
    animate(speech, { opacity: [0, 1], y: [8, 0] }, { duration: 0.25 })
  }
  speechTimeout = setTimeout(() => {
    speech.style.opacity = '0'
  }, 3300)
})

const scenarios = {
  idea: {
    prompt:
      'Turn my weekly project notes into a client update. Flag anything that needs my attention.',
    response: [
      'Let’s turn the repeat work into a clear routine.',
      'The workflow: gather the notes, group progress by project, draft a concise update, then bring the exceptions back for your review.',
    ],
    note: 'A repeatable workflow, with you in the loop.',
    followup: 'Have Nori check the details and Sora draft the update.',
    next: [
      'Nori checks the source notes and passes the useful context to Sora.',
      'Sora turns that handoff into a client-ready draft. Mochi brings back the decisions that need your attention. You review the result before anything is sent.',
    ],
    nextNote: 'Example result: one update, one open question, ready for your review.',
    handoff: ['Mochi · Plan the routine', 'Nori · Check the details', 'Sora · Draft the update'],
  },
  story: {
    prompt:
      'Turn this creative brief into a visual direction and an animated canvas for our launch.',
    response: [
      'Let’s move from a brief to something you can see.',
      'Nori gathers the references, Mochi keeps the brief in focus, and Sora explores the typography, composition, and motion. You can steer the direction as it takes shape.',
    ],
    note: 'Canvas vision: design, preview, refine. Dedicated motion tools come later.',
    followup: 'Explore a Tokyo-night poster with a simple animated motif.',
    next: [
      'A first direction, ready to react to.',
      'Sora pairs a bold typographic composition with a slow orbital motif. The next pass could refine the palette, adjust the motion, or carry the design into a site.',
    ],
    nextNote: 'Illustrative canvas below. Design and motion are part of the roadmap.',
    handoff: ['Nori · Gather references', 'Mochi · Shape the brief', 'Sora · Design the canvas'],
  },
  plan: {
    prompt:
      'Research an idea, challenge the assumptions, and turn the strongest direction into a plan.',
    response: [
      'Give the work a team, with a clear role for each mind.',
      'Nori investigates the question. Sora looks for the strongest way to explain it. Mochi keeps the decisions connected, so the handoff carries the point rather than the entire conversation.',
    ],
    note: 'Teammate communication is on the roadmap. This handoff is a preview.',
    followup: 'Show how the teammates would pass the work forward.',
    next: [
      'Nori to Sora: “Here are the findings, the evidence, and the two open questions.”',
      'Sora turns that focused context into a draft. Mochi brings the draft and unresolved choices back to you. Each teammate contributes a different perspective to one shared goal.',
    ],
    nextNote: 'A focused handoff, with the important decisions kept in view.',
    handoff: ['Nori · Research', 'Sora · Shape the result', 'Mochi · Bring it together'],
  },
}
let scenario = 'story'
let demoAdvanced = false
let demoTimer
const response = document.querySelector('#demo-response')
const prompt = document.querySelector('#demo-prompt')
const followup = document.querySelector('#demo-followup')
const send = document.querySelector('#demo-send')
const status = document.querySelector('#demo-status')

function renderResponse(paragraphs, note, advanced = false) {
  const fragment = document.createDocumentFragment()
  for (const text of paragraphs) {
    const paragraph = document.createElement('p')
    paragraph.textContent = text
    fragment.append(paragraph)
  }
  const aside = document.createElement('div')
  aside.className = 'idea-note'
  aside.textContent = note
  fragment.append(aside)
  if (advanced) {
    const handoff = document.createElement('ol')
    handoff.className = 'workflow-handoff'
    handoff.setAttribute('aria-label', 'Illustrative teammate handoff')
    for (const label of scenarios[scenario].handoff) {
      const step = document.createElement('li')
      step.textContent = label
      handoff.append(step)
    }
    fragment.append(handoff)
  }
  if (scenario === 'story') {
    const art = document.createElement('figure')
    art.className = 'canvas-preview'
    art.innerHTML =
      '<div class="canvas-poster"><span class="canvas-edition">A studio for what comes next</span><svg class="canvas-disc" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="91" fill="var(--pink)"/><path d="M100 9v182M9 100h182M36 36l128 128M36 164 164 36" stroke="var(--ink)" stroke-width="2"/><circle cx="100" cy="100" r="26" fill="var(--ink)"/></svg><strong>AFTER<br>HOURS</strong><span class="canvas-caption">Ideas move differently here.</span></div><figcaption>Illustrative canvas · Design + motion direction</figcaption>'
    fragment.append(art)
  }
  response.replaceChildren(fragment)
  scrollExperience.refresh()
}

function resetDemo() {
  clearTimeout(demoTimer)
  demoAdvanced = false
  send.disabled = false
  send.classList.remove('is-restart')
  send.querySelector('use').setAttribute('href', '#arrow')
  send.setAttribute('aria-label', 'Continue example workflow')
  const current = scenarios[scenario]
  prompt.textContent = current.prompt
  followup.textContent = current.followup
  renderResponse(current.response, current.note)
  status.textContent = 'Continue the handoff. This is a scripted preview of planned workflows.'
}

for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', () => {
    scenario = button.dataset.scenario
    for (const item of document.querySelectorAll('[data-scenario]'))
      item.setAttribute('aria-pressed', String(item === button))
    resetDemo()
    if (!paused)
      animate('.conversation-body', { opacity: [0.45, 1], y: [3, 0] }, { duration: 0.25 })
    status.textContent = `${button.textContent.trim()} selected. Continue the workflow with the send button.`
  })
}

send.addEventListener('click', () => {
  if (demoAdvanced) {
    resetDemo()
    return
  }
  const current = scenarios[scenario]
  prompt.textContent = current.followup
  response.replaceChildren()
  const dots = document.createElement('span')
  dots.className = 'thinking-dots'
  dots.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 3; i++) dots.append(document.createElement('span'))
  response.append(dots)
  send.disabled = true
  status.textContent = 'Your teammates are shaping the next step…'
  demoTimer = setTimeout(
    () => {
      renderResponse(current.next, current.nextNote, true)
      demoAdvanced = true
      send.disabled = false
      send.setAttribute('aria-label', 'Restart example workflow')
      send.classList.add('is-restart')
      send.querySelector('use').setAttribute('href', '#replay')
      followup.textContent = 'A workflow taking shape. Try another direction?'
      status.textContent =
        'Handoff complete in this preview. Choose another workflow or restart this one.'
      if (!paused) animate(response, { opacity: [0, 1], y: [4, 0] }, { duration: 0.3 })
    },
    paused ? 150 : 750,
  )
})

resetDemo()

const dialog = document.querySelector('#film-dialog')
const canvas = document.querySelector('#film-canvas')
const filmPlay = document.querySelector('#film-play')
const filmSound = document.querySelector('#film-sound')
const timeline = document.querySelector('#film-timeline')
const timeLabel = document.querySelector('#film-time')
const filmFeedback = document.querySelector('#film-feedback')
let filmModule
let filmModulePromise
let filmPosition = 0
let filmPlaying = false
let filmSoundOn = false
let filmBase = 0
let frameId
let lastFrame = 0
let audioContext
let audioSource
let audioBuffer
let audioBufferPromise
let audioGeneration = 0
let openingGeneration = 0

function stopAudio() {
  audioGeneration++
  try {
    audioSource?.stop()
  } catch {
    /* A completed source is already stopped. */
  }
  audioSource = undefined
}

async function syncAudio() {
  stopAudio()
  if (!filmSoundOn || !filmPlaying || !dialog.open) return
  const generation = audioGeneration
  try {
    audioContext ||= new AudioContext()
    await audioContext.resume()
    audioBufferPromise ||= filmModule.PaperScore()
    audioBuffer = await audioBufferPromise
    if (generation !== audioGeneration || !filmPlaying || !filmSoundOn || !dialog.open) return
    audioSource = audioContext.createBufferSource()
    audioSource.buffer = audioBuffer
    audioSource.connect(audioContext.destination)
    audioSource.start(0, Math.min(filmPosition, 29.99))
  } catch {
    filmSoundOn = false
    filmSound.setAttribute('aria-pressed', 'false')
    filmSound.textContent = 'Retry sound'
    filmFeedback.textContent = 'Sound could not start. You can keep watching, or try sound again.'
    audioBufferPromise = undefined
  }
}

function paintFilm() {
  filmModule?.PaperFilm({ canvas, time: Math.min(filmPosition, 29.999) })
  timeline.value = String(filmPosition)
  timeLabel.textContent = `0:${String(Math.floor(filmPosition)).padStart(2, '0')} / 0:30`
}

function setFilmPlaying(value) {
  filmPlaying = value
  cancelAnimationFrame(frameId)
  filmPlay.textContent = value ? 'Pause film' : filmPosition >= 30 ? 'Replay film' : 'Play film'
  if (value) {
    if (filmPosition >= 30) filmPosition = 0
    filmBase = performance.now() - filmPosition * 1000
    lastFrame = 0
    frameId = requestAnimationFrame(filmFrame)
  }
  syncAudio()
}

function filmFrame(now) {
  if (!filmPlaying || !dialog.open) return
  filmPosition = Math.min((now - filmBase) / 1000, 30)
  if (now - lastFrame >= 1000 / 30) {
    paintFilm()
    lastFrame = now
  }
  if (filmPosition >= 30) {
    paintFilm()
    setFilmPlaying(false)
    return
  }
  frameId = requestAnimationFrame(filmFrame)
}

for (const trigger of document.querySelectorAll('[data-open-film]')) {
  trigger.addEventListener('click', async () => {
    const generation = ++openingGeneration
    dialog.showModal()
    document.querySelector('#film-close').focus()
    filmPlay.disabled = true
    filmSound.disabled = true
    timeline.disabled = true
    filmFeedback.textContent = 'Preparing the paper film…'
    try {
      filmModulePromise ||= import('./paper-film.js')
      filmModule = await filmModulePromise
      await Promise.all([
        document.fonts.load('750 100px Figtree'),
        document.fonts.load('750 100px Bricolage'),
      ])
      if (generation !== openingGeneration || !dialog.open) return
      filmPlay.disabled = false
      filmSound.disabled = false
      timeline.disabled = false
      paintFilm()
      filmFeedback.textContent =
        'A product vision, including planned capabilities. Sound starts only when you turn it on.'
      if (!paused) setFilmPlaying(true)
    } catch {
      filmModulePromise = undefined
      filmFeedback.textContent =
        'The film could not load. Close it and try again; the rest of the page is ready to explore.'
    }
  })
}
document.querySelector('#film-close').addEventListener('click', () => dialog.close())
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close()
  }
})
dialog.addEventListener('close', () => {
  openingGeneration++
  setFilmPlaying(false)
})
filmPlay.addEventListener('click', () => setFilmPlaying(!filmPlaying))
filmSound.addEventListener('click', () => {
  filmSoundOn = !filmSoundOn
  filmSound.setAttribute('aria-pressed', String(filmSoundOn))
  filmSound.textContent = filmSoundOn ? 'Sound on' : 'Sound off'
  syncAudio()
})
timeline.addEventListener('input', () => {
  filmPosition = Number(timeline.value)
  filmBase = performance.now() - filmPosition * 1000
  paintFilm()
  if (filmPosition >= 30) {
    setFilmPlaying(false)
  } else {
    filmPlay.textContent = filmPlaying ? 'Pause film' : 'Play film'
    syncAudio()
  }
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setFilmPlaying(false)
})
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) setFilmPlaying(false)
})
