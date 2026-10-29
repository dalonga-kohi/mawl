import { createWaveLoop } from './wave-loop.js'

const vertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`
const fragment = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 navy;
uniform vec3 violet;
uniform vec3 peach;

float blob(vec2 p, vec2 center, vec2 shape) {
  vec2 d = (p - center) / shape;
  return exp(-dot(d, d) * 2.2);
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float t = time * .48;
  vec2 p = uv;
  p.x += .12 * sin(uv.y * 6.0 + t) + .055 * cos(uv.x * 8.0 - t * .8);
  p.y += .12 * cos(uv.x * 5.0 - t * .9) + .045 * sin(uv.y * 9.0 + t);
  float a = blob(p, vec2(.18 + .22 * sin(t * .73), .36 + .24 * cos(t * .61)), vec2(.38, .48));
  a += blob(p, vec2(.52 + .34 * cos(t * .57 + 1.0), .12 + .18 * sin(t)), vec2(.35, .28));
  float b = blob(p, vec2(.78 + .22 * cos(t * .67), .52 + .27 * sin(t * .83)), vec2(.36, .5));
  b += blob(p, vec2(.48 + .3 * sin(t * .51 + 2.0), .17 + .16 * cos(t * .9)), vec2(.38, .3));
  float field = a + b;
  float body = smoothstep(.16, 1.1, field);
  float rim = exp(-pow((field - .62) * 6.0, 2.0));
  vec3 warm = peach * vec3(1.0, .57, .27);
  vec3 hue = mix(warm, violet, smoothstep(.12, .88, b / max(field, .001)));
  vec3 color = navy + hue * (body * .92 + rim * .32);
  color += mix(peach, violet, .6) * pow(max(0.0, a * b), 2.0) * .16;
  color *= 1.0 - .22 * length(uv - .5);
  gl_FragColor = vec4(color, 1.0);
}
`

/** Failure leaves the CSS atmosphere and all HTML content intact. */
function startWave() {
  const canvas = document.querySelector('#wave')
  const button = document.querySelector('.motion-toggle')
  if (!(canvas instanceof HTMLCanvasElement) || !(button instanceof HTMLButtonElement)) return
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
  })
  if (!gl) return
  const shaders = []
  let program
  let buffer
  let loop
  const listeners = new AbortController()
  const cleanup = () => {
    loop?.dispose()
    listeners.abort()
    canvas.classList.remove('ready')
    button.hidden = true
    for (const shader of shaders) gl.deleteShader(shader)
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
  }
  try {
    program = gl.createProgram()
    if (!program) throw new Error('No shader program')
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ]) {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error('No shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unavailable')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader unavailable')
    gl.useProgram(program)
    buffer = gl.createBuffer()
    if (!buffer) throw new Error('No vertex buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const resolution = gl.getUniformLocation(program, 'resolution')
    const time = gl.getUniformLocation(program, 'time')
    const styles = getComputedStyle(document.documentElement)
    for (const [uniform, token] of [
      ['navy', '--bg'],
      ['violet', '--accent'],
      ['peach', '--peach'],
    ]) {
      const hex = styles.getPropertyValue(token).trim()
      if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('Invalid palette token')
      const values = [1, 3, 5].map(
        (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
      )
      gl.uniform3fv(gl.getUniformLocation(program, uniform), values)
    }
    const resize = () => {
      // Bound fragment work on retina/mobile displays; soft glass needs no full-DPR buffer.
      const scale = Math.min(devicePixelRatio || 1, 1.25, 1440 / innerWidth, 1000 / innerHeight)
      canvas.width = Math.max(1, Math.round(innerWidth * scale))
      canvas.height = Math.max(1, Math.round(innerHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(resolution, canvas.width, canvas.height)
      loop?.redraw()
    }
    resize()
    loop = createWaveLoop({
      draw: (elapsed) => {
        gl.uniform1f(time, elapsed)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
    })
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const opaque = matchMedia(
      '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)',
    )
    let paused = false
    const sync = () => {
      loop.setState({ paused, reduced: reduced.matches || opaque.matches, hidden: document.hidden })
      button.hidden = reduced.matches || opaque.matches
      button.setAttribute('aria-pressed', String(paused))
      button.setAttribute(
        'aria-label',
        paused ? 'Resume background animation' : 'Pause background animation',
      )
      button.querySelector('span').textContent = paused ? 'Resume motion' : 'Pause motion'
    }
    const options = { signal: listeners.signal }
    button.addEventListener(
      'click',
      () => {
        paused = !paused
        sync()
      },
      options,
    )
    reduced.addEventListener('change', sync, options)
    opaque.addEventListener('change', sync, options)
    document.addEventListener('visibilitychange', sync, options)
    addEventListener('resize', resize, options)
    // Suspend on bfcache navigation; pageshow restarts the same resources and clock.
    addEventListener(
      'pagehide',
      (event) => {
        if (event.persisted) loop.setState({ hidden: true })
        else cleanup()
      },
      options,
    )
    addEventListener('pageshow', sync, options)
    canvas.addEventListener('webglcontextlost', cleanup, options)
    sync()
    canvas.classList.add('ready')
  } catch {
    cleanup()
  }
}
startWave()
