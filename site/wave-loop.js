/** A capped, suspendable clock: hidden time never advances the wave. */
export function createWaveLoop({
  draw,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}) {
  let state = { paused: false, reduced: false, hidden: false }
  let frame = null
  let previous = null
  let elapsed = 0
  let disposed = false
  function tick(now) {
    frame = null
    if (previous === null) previous = now
    if (now - previous >= 1000 / 30) {
      elapsed += Math.min(now - previous, 100) / 1000
      previous = now
      draw(elapsed)
    }
    frame = requestFrame(tick)
  }
  return {
    setState(next) {
      if (disposed) return
      state = { ...state, ...next }
      if (state.paused || state.reduced || state.hidden) {
        if (frame !== null) cancelFrame(frame)
        frame = null
        previous = null
        if (!state.hidden) draw(elapsed)
      } else if (frame === null) {
        draw(elapsed)
        frame = requestFrame(tick)
      }
    },
    redraw() {
      if (!disposed && !state.hidden) draw(elapsed)
    },
    dispose() {
      disposed = true
      if (frame !== null) cancelFrame(frame)
      frame = null
    },
  }
}
