export function createScrollExperience({ motion, reducedMotion, isPaused }) {
  const root = document.documentElement
  const track = document.querySelector('#custom-scroller')
  const thumb = document.querySelector('#scroll-thumb')
  const location = document.querySelector('.scroll-location')
  const desktopPointer = matchMedia('(min-width: 761px) and (pointer: fine)')
  const sections = [
    ['#top', 'Welcome'],
    ['#playground', 'Workflows'],
    ['#your-space', 'Memory'],
    ['#at-home', 'Your space'],
    ['#questions', 'Good to know'],
    ['.closing', 'Start creating'],
  ].map(([selector, label]) => ({ element: document.querySelector(selector), label }))
  const bindings = []
  let motionEnabled = false
  let enabled = false
  let frame = 0
  let layoutReady = document.fonts?.status !== 'loading'
  let measurementFrame = 0
  let drag

  function metrics() {
    const height = track.clientHeight
    const maxScroll = Math.max(0, root.scrollHeight - innerHeight)
    const thumbHeight = Math.min(height, Math.max(48, (height * innerHeight) / root.scrollHeight))
    return { height, maxScroll, thumbHeight, travel: Math.max(1, height - thumbHeight) }
  }

  function update() {
    frame = 0
    if (!enabled) return
    const { maxScroll, thumbHeight, travel } = metrics()
    const progress = maxScroll ? Math.max(0, Math.min(1, scrollY / maxScroll)) : 0
    let label = sections[0].label
    for (const section of sections) {
      if (section.element.getBoundingClientRect().top <= innerHeight * 0.4) label = section.label
    }
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${progress * travel}px)`
    thumb.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
    thumb.setAttribute('aria-valuetext', `${Math.round(progress * 100)} percent, ${label}`)
    location.textContent = label
  }

  function requestUpdate() {
    if (!frame) frame = requestAnimationFrame(update)
  }

  function enableScroller() {
    enabled = desktopPointer.matches
    root.classList.toggle('has-custom-scrollbar', enabled)
    track.setAttribute('aria-hidden', String(!enabled))
    thumb.tabIndex = enabled ? 0 : -1
    requestUpdate()
  }

  function moveTo(top, smooth = false) {
    scrollTo({
      top,
      behavior: smooth && !reducedMotion.matches && !isPaused() ? 'smooth' : 'instant',
    })
    requestUpdate()
  }

  thumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag = { pointerId: event.pointerId, y: event.clientY, scroll: scrollY }
    thumb.setPointerCapture(event.pointerId)
    root.classList.add('is-scroll-dragging')
  })
  thumb.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const { maxScroll, travel } = metrics()
    moveTo(
      Math.max(
        0,
        Math.min(maxScroll, drag.scroll + ((event.clientY - drag.y) * maxScroll) / travel),
      ),
    )
  })
  function endDrag() {
    if (!drag) return
    const pointerId = drag.pointerId
    drag = undefined
    root.classList.remove('is-scroll-dragging')
    if (thumb.hasPointerCapture(pointerId)) thumb.releasePointerCapture(pointerId)
  }
  thumb.addEventListener('pointerup', endDrag)
  thumb.addEventListener('pointercancel', endDrag)
  thumb.addEventListener('lostpointercapture', endDrag)
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || thumb.contains(event.target)) return
    const { maxScroll, thumbHeight, travel } = metrics()
    const progress = (event.clientY - track.getBoundingClientRect().top - thumbHeight / 2) / travel
    moveTo(Math.max(0, Math.min(1, progress)) * maxScroll, true)
  })
  thumb.addEventListener('keydown', (event) => {
    const targets = {
      ArrowDown: scrollY + 48,
      ArrowUp: scrollY - 48,
      PageDown: scrollY + innerHeight * 0.85,
      PageUp: scrollY - innerHeight * 0.85,
      Home: 0,
      End: root.scrollHeight - innerHeight,
    }
    if (!(event.key in targets)) return
    event.preventDefault()
    moveTo(targets[event.key])
  })
  addEventListener('scroll', requestUpdate, { passive: true })
  addEventListener('resize', requestUpdate, { passive: true })
  desktopPointer.addEventListener('change', enableScroller)
  new ResizeObserver(requestUpdate).observe(document.body)
  enableScroller()

  function bind(selector, keyframes, offset, targetSelector = selector) {
    const element = document.querySelector(selector)
    const target = document.querySelector(targetSelector)
    if (!element || !target) return
    const animation = motion.animate(element, keyframes, { ease: 'linear', autoplay: false })
    const cancel = motion.scroll(animation, { target, offset })
    bindings.push(() => {
      cancel()
      animation.cancel()
      animation.stop()
      element.style.removeProperty('transform')
      element.style.removeProperty('opacity')
    })
  }

  function sync() {
    const shouldAnimate =
      layoutReady && Boolean(motion?.scroll) && !isPaused() && !reducedMotion.matches
    if (motionEnabled === shouldAnimate) return
    for (const cleanup of bindings.splice(0)) cleanup()
    motionEnabled = shouldAnimate
    if (!shouldAnimate) {
      // Motion may flush a sampled keyframe after cancellation; restore the static view after it.
      requestAnimationFrame(() => {
        if (motionEnabled) return
        document.querySelector('.app-window').style.opacity = '1'
      })
      return
    }
    // Each effect follows the page's story; text stays readable at every position.
    bind('.studio-scene', { y: [0, -54] }, ['start start', 'end start'], '.hero')
    bind('.manifesto-spark', { rotate: [-65, 65] }, ['start end', 'end start'], '.manifesto')
    bind('.app-window', { y: [78, 0], scale: [0.955, 1], opacity: [0.72, 1] }, [
      'start 96%',
      'start 25%',
    ])
    bind('.memory-art', { y: [48, 0], rotate: [-5, 0], scale: [0.88, 1] }, [
      'start end',
      'center center',
    ])
    bind('.home-art', { y: [70, 0] }, ['start end', 'center center'])
    bind('.home-art .orbit-one', { rotate: [-80, 20] }, ['start end', 'end start'], '.home-art')
    bind(
      '.closing-flower',
      { rotate: [-90, 45], scale: [0.8, 1] },
      ['start end', 'end start'],
      '.closing',
    )
  }

  if (!layoutReady && document.fonts?.ready) {
    document.fonts.ready.then(() => {
      layoutReady = true
      sync()
      requestUpdate()
    })
  }

  return {
    sync,
    refresh() {
      sync()
      requestUpdate()
      // Re-measure changed content without clearing and recreating the hero's active timeline.
      if (!measurementFrame) {
        measurementFrame = requestAnimationFrame(() => {
          measurementFrame = 0
          if (motionEnabled) window.dispatchEvent(new Event('resize'))
        })
      }
    },
  }
}
