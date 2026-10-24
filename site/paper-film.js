// Adapted from the owner-provided paper-world film. See README.md.
const P = {
  ink: '#161323',
  paper: '#f1eddf',
  lilac: '#ad8ce6',
  purple: '#7853d7',
  lime: '#d6ea95',
  pink: '#f4a6ba',
  blue: '#7cbed3',
}
const beats = [
  0, 1.2, 2.4, 3.6, 4.8, 6.4, 9.6, 10.4, 11.2, 13.2, 15.2, 17.2, 18.8, 20.4, 22.8, 25.2, 26.4, 30,
]
const ease = (v) => (v === 1 ? 1 : 1 - 2 ** (-10 * v))
const spring = (v) => 1 + 2.6 * (v - 1) ** 3 + 1.6 * (v - 1) ** 2
const smooth = (v) => (v < 0.5 ? 8 * v ** 4 : 1 - (-2 * v + 2) ** 4 / 2)
let c, t, T, grain
const sat = (n) => Math.max(0, Math.min(1, n))
const q = (a = 0, d = 0.6) => ease(sat((t - a) / d))
function at(x, y, s, r, fn, a = 1) {
  c.save()
  c.globalAlpha *= a
  c.translate(x, y)
  c.rotate(r)
  c.scale(s, s)
  fn()
  c.restore()
}
function bg(color) {
  c.fillStyle = color
  c.fillRect(0, 0, 1920, 1080)
}
function circle(x, y, r, color) {
  c.fillStyle = color
  c.beginPath()
  c.arc(x, y, Math.max(0.01, r), 0, 7)
  c.fill()
}
function box(x, y, w, h, color, r = 0) {
  c.fillStyle = color
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}
function words(s, x, y, size, color = P.ink, align = 'left', weight = 800, font = 'Figtree') {
  c.font = `${weight} ${size}px ${font}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillStyle = color
  c.fillText(s, x, y)
}
function title(s, x, y, size, color = P.ink, delay = 0) {
  const v = q(delay, 0.55)
  at(x, y + (1 - v) * 130, 1, 0, () => words(s, 0, 0, size, color), v)
}
function path(points, color) {
  c.beginPath()
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y)
    else c.moveTo(x, y)
  })
  c.closePath()
  c.fillStyle = color
  c.fill()
}
function star(x, y, r, color, turn = 0, n = 8) {
  at(x, y, 1, turn, () => {
    const points = []
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n,
        R = i % 2 ? r * 0.36 : r
      points.push([Math.cos(a) * R, Math.sin(a) * R])
    }
    path(points, color)
  })
}
function hatch(fn, color, spacing = 15) {
  c.save()
  fn()
  c.clip()
  c.strokeStyle = color
  c.globalAlpha *= 0.35
  c.lineWidth = 1.4
  for (let x = -1600; x < 3400; x += spacing) {
    c.beginPath()
    c.moveTo(x, -300)
    c.lineTo(x + 900, 1400)
    c.stroke()
  }
  c.restore()
}
function blob(x, y, s, color = P.lime, r = 0, squash = 1) {
  at(x, y, s, r, () => {
    c.scale(1 / squash, squash)
    circle(-53, -57, 18, color)
    circle(53, -57, 18, color)
    c.beginPath()
    c.moveTo(-85, 30)
    c.bezierCurveTo(-85, -40, -48, -80, 0, -80)
    c.bezierCurveTo(48, -80, 85, -40, 85, 30)
    c.bezierCurveTo(85, 65, 45, 69, 0, 69)
    c.bezierCurveTo(-45, 69, -85, 65, -85, 30)
    c.fillStyle = color
    c.fill()
    c.lineWidth = 8
    c.lineCap = 'round'
    c.strokeStyle = P.ink
    for (const x of [-23, 23]) {
      c.beginPath()
      c.moveTo(x, -10)
      c.lineTo(x, T % 4.4 > 4.2 ? -8 : 5)
      c.stroke()
    }
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(-9, 22)
    c.quadraticCurveTo(0, 32, 9, 22)
    c.stroke()
    circle(-50, 18, 7, '#ee91a480')
    circle(50, 18, 7, '#ee91a480')
  })
}
function petal(x, y, s, color, turn) {
  at(x, y, s, turn, () => {
    c.beginPath()
    c.moveTo(-80, 0)
    c.bezierCurveTo(-35, -72, 65, -72, 80, 0)
    c.bezierCurveTo(35, 72, -65, 72, -80, 0)
    c.fillStyle = color
    c.fill()
    c.strokeStyle = P.ink
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(-65, 0)
    c.lineTo(65, 0)
    c.stroke()
  })
}
function seed(x, y, s = 1, r = 0) {
  at(x, y, s, r, () => {
    circle(0, 0, 26, P.pink)
    star(0, 0, 17, P.ink, r * 0.3, 4)
  })
}
function arch(x, y, w, h, color) {
  c.beginPath()
  c.moveTo(x - w / 2, y + h / 2)
  c.lineTo(x - w / 2, y - h / 2 + w / 2)
  c.arc(x, y - h / 2 + w / 2, w / 2, Math.PI, Math.PI * 2)
  c.lineTo(x + w / 2, y + h / 2)
  c.closePath()
  c.fillStyle = color
  c.fill()
}
function hill(y, color, phase = 0) {
  c.beginPath()
  c.moveTo(-200, 1250)
  c.lineTo(-200, y)
  for (let x = -200; x <= 2150; x += 20) c.lineTo(x, y + Math.sin(x / 350 + phase) * 95)
  c.lineTo(2150, 1250)
  c.closePath()
  c.fillStyle = color
  c.fill()
}
function landscape(time, moon = true) {
  bg(P.lilac)
  circle(1480, 250, 140, P.paper)
  if (moon) circle(1545, 205, 125, P.lilac)
  hill(730, P.ink, time * 0.1)
  c.save()
  hill(850, P.lime, time * 0.17)
  hatch(() => {
    c.beginPath()
    c.moveTo(-100, 1400)
    for (let x = -100; x < 2050; x += 20) c.lineTo(x, 850 + Math.sin(x / 350 + time * 0.17) * 95)
    c.lineTo(2050, 1400)
    c.closePath()
  }, P.ink)
  c.restore()
  hill(1050, P.purple, time * 0.25)
}
function _relay() {
  bg(P.ink)
  const camera = (t / 3.3) * 160
  at(-camera, 0, 1, 0, () => {
    for (let i = 0; i < 3; i++) {
      const x = 420 + i * 650
      arch(x, 640, 440, 660, [P.lilac, P.pink, P.lime][i])
      hatch(
        () => {
          arch(x, 640, 440, 660, 'transparent')
        },
        P.ink,
        21,
      )
      circle(x, 580, 150, P.ink)
      blob(x, 590, 1.25, [P.lilac, P.pink, P.lime][i], Math.sin(t * 4 + i) * 0.05)
      words(['Nori', 'Sora', 'Mochi'][i], x, 865, 44, P.ink, 'center')
      words(
        ['finds the spark', 'shapes the idea', 'brings it to life'][i],
        x,
        916,
        25,
        P.ink,
        'center',
        550,
      )
    }
    const u = sat(t / 3.0),
      x = 420 + u * 1300,
      y = 390 - Math.sin(u * Math.PI * 4) * 110
    seed(x, y, 1.65, t * 6)
    for (let i = 0; i < 9; i++) {
      const u2 = sat(u - i * 0.014)
      circle(420 + u2 * 1300, 390 - Math.sin(u2 * Math.PI * 4) * 110, 9 - i * 0.8, P.paper)
    }
  })
  title('Ideas travel better together.', 110, 170, 91, P.paper, 0.12)
}
function memory() {
  bg(P.paper)
  at(1030, 650, 1 + q(0, 2) * 0.2, -0.04, () => {
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * 260
      const y = Math.sin(i + t) * 30
      at(x, y, 1, (i - 2.5) * 0.05, () => {
        arch(0, 0, 235, 460, [P.ink, P.purple, P.lilac, P.lime, P.pink, P.blue][i])
        circle(0, -75, 55, P.paper)
        petal(0, 90, 0.7, P.paper, Math.sin(t + i) * 0.4)
      })
    }
  })
  title('A little context.', 110, 240, 116, P.ink)
  title('A lot further.', 110, 370, 116, P.ink, 0.18)
  seed(1550 - q(0, 2) * 1050, 840, 1.2, t * 3)
}
function make() {
  bg(P.ink)
  title('Make the leap.', 110, 200, 121, P.paper)
  const v = q(0.1, 0.65)
  at(1010, 640, v, -0.025 + Math.sin(t) * 0.012, () => {
    box(-620, -340, 1240, 720, P.paper, 18)
    box(-620, -340, 1240, 50, P.lilac, 18)
    for (let i = 0; i < 3; i++) circle(-585 + i * 23, -315, 6, P.ink)
    c.save()
    box(-595, -265, 1190, 585, P.lilac, 3)
    c.beginPath()
    c.rect(-595, -265, 1190, 585)
    c.clip()
    circle(360, -90, 92, P.paper)
    at(-600, -300, 0.65, 0, () => {
      hill(650, P.ink, t)
      hill(800, P.lime, t + 0.9)
      hill(1070, P.purple, t + 0.3)
    })
    for (let i = 0; i < 4; i++) {
      const k = q(0.3 + i * 0.15, 0.45)
      petal(-370 + i * 210, 155 - (i % 2) * 75, k, P.pink, t * 0.18 + i)
    }
    blob(300, 130, 1.1, P.lime, 0.05)
    c.restore()
  })
  const x = 1500 - 350 * q(0.1, 0.7),
    y = 600 + 90 * Math.sin(t * 2)
  at(x, y, 1, -0.15, () =>
    path(
      [
        [0, 0],
        [0, 115],
        [30, 86],
        [66, 143],
        [88, 133],
        [55, 77],
        [104, 77],
      ],
      P.ink,
    ),
  )
  star(x + 40, y + 30, 70 * (1 - q(0.6, 0.7)), P.lime, t * 4)
}
function daynight() {
  landscape(t, true)
  const v = smooth(sat(t / 2.6))
  circle(1480, 250, 140, P.paper)
  circle(1545 + v * 250, 205, 125, P.lilac)
  for (let i = 0; i < 7; i++)
    star(220 + i * 235, 250 + Math.sin(i * 2) * 110, 10 * (1 - v), P.paper, t * 0.2)
  title('Off you go.', 110, 300, 135, P.ink)
  title('On they go.', 110, 455, 135, P.ink, 0.22)
  for (let i = 0; i < 3; i++)
    blob(
      410 + i * 480,
      870 + Math.sin(t * 3 + i) * 25,
      1.3,
      [P.lime, P.pink, P.paper][i],
      Math.sin(t * 2 + i) * 0.06,
    )
  at(1510, 650, 1, t * 0.8, () => {
    circle(0, 0, 130, P.ink)
    for (let i = 0; i < 12; i++) at(0, 0, 1, (i * Math.PI) / 6, () => box(-2, -113, 4, 13, P.paper))
    c.strokeStyle = P.lime
    c.lineWidth = 9
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(0, -70)
    c.lineTo(0, 0)
    c.lineTo(58, 24)
    c.stroke()
  })
}
function models() {
  bg(P.lime)
  title('Different minds.', 110, 235, 122, P.ink)
  at(1030, 760, 1, t * 0.35, () => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      petal(
        Math.cos(a) * 320,
        Math.sin(a) * 260,
        1.65,
        [P.paper, P.purple, P.pink, P.lilac][i % 4],
        a,
      )
    }
    circle(0, 0, 155, P.ink)
    blob(0, 5, 1.22, P.lime, -t * 0.35)
  })
  at(1430, 330, 1, -0.07, () => {
    box(-265, -49, 530, 98, P.ink, 49)
    words('Your choice of model.', 0, 15, 34, P.paper, 'center', 650)
  })
}
function home() {
  bg(P.paper)
  title('Your little', 110, 300, 132, P.ink)
  title('corner of AI.', 110, 450, 132, P.ink, 0.12)
  at(1440, 660, q(0.1, 0.6), 0.04, () => {
    path(
      [
        [-350, -65],
        [0, -350],
        [350, -65],
      ],
      P.lilac,
    )
    box(-290, -65, 580, 420, P.ink)
    arch(0, 170, 220, 340, P.lime)
    blob(0, 205, 1.0, P.lime, 0)
    petal(-205, 220, 0.7, P.pink, -1.5)
    petal(205, 220, 0.7, P.pink, 1.5)
  })
  at(505, 720, q(0.45, 0.5), -0.04, () => {
    box(-395, -55, 790, 110, P.ink, 55)
    words('Your models. Your machine.', 0, 16, 42, P.paper, 'center', 650)
  })
}

// A single pink spark connects the edit. All artwork is drawn as flat paper.
function line(points, color = P.ink, width = 4) {
  c.strokeStyle = color
  c.lineWidth = width
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y)
    else c.moveTo(x, y)
  })
  c.stroke()
}
function burst(x, y, r, color, n = 16) {
  for (let j = 0; j < n; j++) {
    const a = (j * Math.PI * 2) / n
    line(
      [
        [x + Math.cos(a) * r * 0.77, y + Math.sin(a) * r * 0.77],
        [x + Math.cos(a) * r, y + Math.sin(a) * r],
      ],
      color,
      3,
    )
  }
}
function flower(x, y, s, rot = 0, color = P.pink) {
  at(x, y, s, rot, () => {
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4
      at(Math.cos(a) * 65, Math.sin(a) * 65, 1, a, () => {
        c.beginPath()
        c.ellipse(0, 0, 57, 27, 0, 0, 7)
        c.fillStyle = color
        c.fill()
        line(
          [
            [-20, 0],
            [39, 0],
          ],
          P.ink,
          1.3,
        )
      })
    }
    circle(0, 0, 32, P.ink)
    star(0, 0, 19, P.paper, 0, 6)
  })
}
function plane(x, y, s, r = 0) {
  at(x, y, s, r, () => {
    path(
      [
        [-95, -52],
        [110, 0],
        [-95, 58],
        [-48, 0],
      ],
      P.paper,
    )
    path(
      [
        [-48, 0],
        [110, 0],
        [-76, 25],
      ],
      P.lilac,
    )
    line(
      [
        [-95, -52],
        [-48, 0],
        [110, 0],
      ],
      P.ink,
      2,
    )
  })
}
function kinetic(text, y, size, color, delay = 0, tilt = 0) {
  c.font = `800 ${size}px Figtree`
  let widths = [...text].map((ch) => c.measureText(ch).width),
    x = 960 - widths.reduce((a, b) => a + b, 0) / 2
  ;[...text].forEach((ch, j) => {
    const u = sat((t - delay - j * 0.028) / 0.44),
      v = spring(u)
    at(
      x + widths[j] / 2,
      y + (1 - v) * 200,
      1 + (1 - v) * 0.16,
      tilt * (1 - u),
      () => words(ch, 0, 0, size, color, 'center'),
      sat(u * 6),
    )
    x += widths[j]
  })
}
function rip(v, color) {
  const left = [],
    right = []
  for (let y = -60; y < 1160; y += 35) {
    const x = 960 + Math.sin(y * 0.09) * 11 + Math.sin(y * 0.036) * 17
    left.push([x - v * 1350, y])
    right.push([x + v * 1350, y])
  }
  path([[-300, -100], ...left, [-300, 1200]], color)
  path([[2200, -100], ...right, [2200, 1200]], color)
}
function sparkTrail(x, y, angle, scale = 1) {
  at(x, y, scale, angle, () => {
    for (let j = 8; j > 0; j--) circle(-j * 32, Math.sin(j * 0.6) * 15, Math.max(1, 11 - j), P.pink)
    seed(0, 0, 1.4, T * 4)
  })
}
function opening() {
  bg(P.ink)
  const open = q(0.18, 0.8)
  flower(960, 540, 2.8 + open * 1.6, t * 0.22, P.lilac)
  rip(open, P.paper)
  at(960, 610, 1 + 0.03 * Math.sin(t * 4), -0.035, () =>
    words('WHAT', 0, 80, 385, open > 0.4 ? P.paper : P.ink, 'center'),
  )
  seed(960, 540, 1.8 + q(0.5, 0.6) * 0.5, t * 3)
}
function question() {
  bg(P.lilac)
  kinetic('IF?', 800, 660, P.ink, 0, -0.15)
  flower(1570, 240, 1.4, t, P.lime)
  sparkTrail(210 + q(0, 1.1) * 1300, 230, 0, 1.1)
}
function idea() {
  bg(P.ink)
  kinetic('ONE LITTLE', 390, 159, P.paper)
  kinetic('IDEA.', 755, 350, P.paper, 0.08)
  seed(1480, 690, 3.7, t * 2)
  burst(1480, 690, 140 + q(0, 1) * 90, P.lilac, 12)
}
function bloomIntro() {
  bg(P.pink)
  const z = 1 + smooth(sat((t - 0.6) / 0.6)) * 2.5
  at(960, 540, z, -t * 0.2, () => {
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4
      petal(
        Math.cos(a) * 230 * q(0, 0.55),
        Math.sin(a) * 230 * q(0, 0.55),
        1.65,
        [P.paper, P.lime, P.lilac][j % 3],
        a,
      )
    }
    circle(0, 0, 145, P.ink)
    blob(0, 10, 1.18, P.lime, t * 0.2)
  })
  at(960, 1010, 1, 0, () => words('LET IT GROW.', 0, 0, 87, P.ink, 'center'))
}
function company() {
  bg(P.lime)
  kinetic('GOOD', 310, 215, P.ink)
  kinetic('COMPANY.', 530, 215, P.ink, 0.07)
  for (let j = 0; j < 3; j++) {
    const v = spring(sat((t - 0.05 - j * 0.1) / 0.55))
    blob(
      420 + j * 540,
      815 - 35 * Math.sin(t * 5 + j),
      2.1 * v,
      [P.lilac, P.pink, P.paper][j],
      Math.sin(t * 3 + j) * 0.09,
      1 + Math.sin(t * 7 + j) * 0.035,
    )
  }
  sparkTrail(250 + t * 920, 625, 0, 1)
}
function conversation() {
  bg(P.ink)
  const z = 1 + 0.035 * t
  at(960, 540, z, 0, () => {
    at(-960, -540, 1, 0, () => {
      title('Great minds. In conversation.', 100, 165, 95, P.paper)
      const xs = [365, 960, 1555],
        cols = [P.lilac, P.pink, P.lime]
      for (let j = 0; j < 3; j++) {
        const v = spring(sat((t - j * 0.16) / 0.6))
        at(xs[j], 660, v, (j - 1) * 0.025, () => {
          arch(0, 40, 430, 635, cols[j])
          hatch(() => arch(0, 40, 430, 635, 'transparent'), P.ink, 24)
          circle(0, -20, 150, P.ink)
          blob(0, -6, 1.4, cols[j], Math.sin(t * 4 + j) * 0.055)
          words(['Nori', 'Sora', 'Mochi'][j], 0, 260, 43, P.ink, 'center')
        })
      }
      const phase = sat((t - 0.45) / 2.3),
        b = 1 - phase,
        x =
          b * b * b * 365 +
          3 * b * b * phase * 720 +
          3 * b * phase * phase * 1110 +
          phase * phase * phase * 1555,
        y =
          b * b * b * 385 +
          3 * b * b * phase * 70 +
          3 * b * phase * phase * 690 +
          phase * phase * phase * 385
      c.save()
      c.setLineDash([3, 16])
      c.strokeStyle = P.paper
      c.lineWidth = 3
      c.beginPath()
      c.moveTo(365, 385)
      c.bezierCurveTo(720, 70, 1110, 690, 1555, 385)
      c.stroke()
      c.restore()
      plane(x, y, 0.8, Math.cos(phase * 6) * 0.2)
      seed(x, y - 45, 0.85, t * 5)
      const j = Math.min(2, Math.floor(phase * 3))
      at(xs[j], 287, 1, -0.025, () => {
        box(-180, -49, 360, 98, P.paper, 40)
        path(
          [
            [-20, 40],
            [20, 40],
            [0, 75],
          ],
          P.paper,
        )
        words(
          ['Found a spark.', 'Let’s build on it.', 'I’ll bring it to life.'][j],
          0,
          11,
          29,
          P.ink,
          'center',
          700,
        )
      })
    })
  })
}
function pass() {
  bg(P.lilac)
  kinetic('PASS IT.', 710, 350, P.ink)
  plane(-200 + q(0, 0.75) * 2400, 370, 2.5, -0.1)
  sparkTrail(-400 + q(0, 0.75) * 2300, 390, 0, 1.8)
}
function build() {
  bg(P.pink)
  const v = q(0, 0.6)
  at(960, 560, 1, 0, () => {
    at(-410, -100 + (1 - v) * 600, 1, -0.04, () => words('BUILD', 0, 0, 270, P.ink))
    at(-410, 190 - (1 - v) * 600, 1, 0.025, () => words('ON IT.', 0, 0, 270, P.ink))
  })
  flower(1610, 330, 1.4, t, P.paper)
}
function garden() {
  bg(P.ink)
  const _grow = q(0.02, 1.5),
    zoom = 1 + 0.055 * t
  at(960, 1080, zoom, 0, () => {
    for (let j = 0; j < 13; j++) {
      const x = (j - 6) * 170,
        top = -260 - (Math.sin(j * 2.1) * 0.5 + 0.5) * 550,
        g = spring(sat((t - j * 0.045) / 0.85))
      c.save()
      c.beginPath()
      c.rect(-2000, -1600, 4000, 1600)
      c.clip()
      c.strokeStyle = [P.lime, P.lilac, P.pink][j % 3]
      c.lineWidth = 8
      c.beginPath()
      c.moveTo(x, 100)
      c.bezierCurveTo(x - 80, -180, x + 80, top * 0.5 * g, x, top * g)
      c.stroke()
      for (let k = 0; k < 3; k++)
        petal(
          x + (k % 2 ? 45 : -45),
          top * g * (0.25 + k * 0.19),
          0.6 * g,
          [P.lilac, P.lime, P.pink][(j + k) % 3],
          k % 2 ? -0.7 : 0.7,
        )
      flower(
        x,
        top * g,
        (0.6 + (j % 3) * 0.28) * g,
        t * 0.15 + j,
        [P.lilac, P.pink, P.paper, P.lime][j % 4],
      )
      c.restore()
    }
  })
  // The headline is carried on one clean paper strip as the world grows behind it.
  at(960, 455, q(0.15, 0.5), -0.045, () => {
    box(-690, -120, 1380, 225, P.paper)
    words('LOOK WHAT GREW.', 0, 36, 123, P.ink, 'center')
  })
  for (let j = 0; j < 3; j++)
    blob(
      680 + j * 285,
      900 + Math.sin(t * 4 + j) * 14,
      1.2 * q(0.4 + j * 0.1, 0.5),
      [P.lilac, P.lime, P.pink][j],
      Math.sin(t + j) * 0.04,
    )
  for (let j = 0; j < 12; j++) {
    const a = j * 2.4,
      r = 230 + t * 160
    petal(
      960 + Math.cos(a) * r,
      520 + Math.sin(a) * r,
      0.22,
      [P.lime, P.pink, P.paper][j % 3],
      a + t,
    )
  }
}
function catchSpark() {
  bg(P.paper)
  const bob = Math.sin(t * 3) * 8
  blob(960, 735 + bob, 4.2, P.lime, -0.025, 1 + 0.025 * Math.sin(t * 5))
  seed(960, 120 + q(0, 0.7) * 260, 1.4, t * 0.7)
  burst(960, 385, 70 * (1 - q(0.65, 0.4)), P.ink, 8)
  words('Oh.', 1460, 640, 150, P.ink, 'center')
}
function finale() {
  bg(P.ink)
  kinetic('Small team.', 210, 109, P.lime, 0)
  kinetic('Wild possibilities.', 345, 109, P.paper, 0.1)
  const v = spring(sat((t - 0.15) / 0.65))
  at(770, 810 + (1 - v) * 260, v, 0, () =>
    words('mawl', 0, 0, 440, P.paper, 'center', 750, 'Bricolage'),
  )
  flower(1600, 645, 1.65 * q(0.55, 0.65), -0.15 + t * 0.12, P.lilac)
  at(1600, 645, q(0.65, 0.5), 0, () => blob(0, 3, 0.45, P.lime, 0))
  // A solid dark field keeps the full closing line readable through the final hold.
  at(
    960,
    965,
    1,
    0,
    () => words('AI teammates. Entirely yours.', 0, 0, 46, P.paper, 'center', 650),
    q(0.75, 0.5),
  )
}
function texture() {
  if (!grain) {
    const g = document.createElement('canvas')
    g.width = g.height = 256
    const gc = g.getContext('2d'),
      im = gc.createImageData(256, 256)
    let sd = 91
    for (let k = 0; k < im.data.length; k += 4) {
      sd = (sd * 16807) % 2147483647
      const n = sd % 256
      im.data[k] = im.data[k + 1] = im.data[k + 2] = n
      im.data[k + 3] = 15
    }
    gc.putImageData(im, 0, 0)
    grain = c.createPattern(g, 'repeat')
  }
  c.fillStyle = grain
  c.fillRect(0, 0, 1920, 1080)
}
export function PaperFilm({ canvas, time }) {
  c = canvas.getContext('2d')
  T = time
  let i = beats.findIndex((b, j) => j < beats.length - 1 && time >= b && time < beats[j + 1])
  if (i < 0) i = 16
  t = time - beats[i]
  c.clearRect(0, 0, 1920, 1080)
  if (i === 0) opening()
  else if (i === 1) question()
  else if (i === 2) idea()
  else if (i === 3) bloomIntro()
  else if (i === 4) company()
  else if (i === 5) conversation()
  else if (i === 6) pass()
  else if (i === 7) build()
  else if (i === 8) {
    const old = t
    t *= 1.2
    memory()
    t = old
  } else if (i === 9) make()
  else if (i === 10) {
    const old = t
    t *= 1.3
    daynight()
    t = old
  } else if (i === 11) models()
  else if (i === 12) home()
  else if (i === 13) {
    const j = Math.min(5, Math.floor(t / 0.4)),
      u = (t % 0.4) / 0.4
    bg([P.lilac, P.lime, P.pink, P.paper, P.lime, P.lilac][j])
    if (j === 1 || j === 4) {
      at(960, 540, 1 + u * 0.4, 0, () => {
        for (let k = 0; k < 9; k++)
          blob(
            ((k % 3) - 1) * 560,
            (Math.floor(k / 3) - 1) * 420,
            1.5,
            [P.ink, P.pink, P.paper][k % 3],
            Math.sin(k + u) * 0.1,
          )
      })
    } else if (j === 3) {
      at(960, 540, 1 + u * 0.7, u * 0.3, () => {
        for (let k = 0; k < 10; k++)
          flower(
            Math.cos(k * 0.63) * 440,
            Math.sin(k * 0.63) * 330,
            1.6,
            k + u,
            [P.pink, P.lilac, P.lime][k % 3],
          )
      })
    } else {
      at(960, 650, 1 + u * 0.1, (j % 2 ? 1 : -1) * 0.025, () =>
        words(
          ['THINK.', '', 'MAKE.', '', '', 'TOGETHER.'][j],
          0,
          30,
          j === 5 ? 225 : 340,
          P.ink,
          'center',
        ),
      )
    }
  } else if (i === 14) garden()
  else if (i === 15) catchSpark()
  else finale()
  // One directional paper tear and two expanding match cuts, timed to the score.
  const d = beats[i + 1] - beats[i]
  if ([7, 9, 12].includes(i) && t > d - 0.16) {
    const v = smooth(sat((t - d + 0.16) / 0.16))
    circle(960, 540, v * 1210, [P.paper, P.lilac, P.lilac][[7, 9, 12].indexOf(i)])
  }
  texture()
}

export async function PaperScore() {
  const ac = new OfflineAudioContext(2, 48000 * 30, 48000),
    out = ac.createGain(),
    comp = ac.createDynamicsCompressor()
  out.gain.value = 0.55
  comp.threshold.value = -14
  comp.ratio.value = 3
  out.connect(comp)
  comp.connect(ac.destination)
  const noise = ac.createBuffer(1, 24000, 48000),
    nd = noise.getChannelData(0)
  let sd = 7
  for (let k = 0; k < nd.length; k++) {
    sd = (sd * 16807) % 2147483647
    nd[k] = (sd / 2147483647) * 2 - 1
  }
  function tone(f, at, d, a, type = 'sine', pan = 0) {
    const o = ac.createOscillator(),
      g = ac.createGain(),
      p = ac.createStereoPanner()
    o.type = type
    o.frequency.value = f
    p.pan.value = pan
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(a, at + 0.007)
    g.gain.exponentialRampToValueAtTime(0.0001, Math.min(30, at + d))
    o.connect(g)
    g.connect(p)
    p.connect(out)
    o.start(at)
    o.stop(Math.min(30, at + d + 0.02))
  }
  function flick(at, a = 0.06, d = 0.065, hz = 2400, pan = 0) {
    const s = ac.createBufferSource(),
      g = ac.createGain(),
      f = ac.createBiquadFilter(),
      p = ac.createStereoPanner()
    s.buffer = noise
    f.type = 'bandpass'
    f.frequency.value = hz
    f.Q.value = 0.7
    p.pan.value = pan
    g.gain.setValueAtTime(a, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + d)
    s.connect(f)
    f.connect(g)
    g.connect(p)
    p.connect(out)
    s.start(at)
    s.stop(at + d)
  }
  function kick(at, a = 0.33) {
    const o = ac.createOscillator(),
      g = ac.createGain()
    o.frequency.setValueAtTime(135, at)
    o.frequency.exponentialRampToValueAtTime(44, at + 0.12)
    g.gain.setValueAtTime(a, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    o.connect(g)
    g.connect(out)
    o.start(at)
    o.stop(at + 0.23)
  }
  function whoosh(at, d = 0.25) {
    const s = ac.createBufferSource(),
      g = ac.createGain(),
      f = ac.createBiquadFilter()
    s.buffer = noise
    f.type = 'bandpass'
    f.frequency.setValueAtTime(400, at)
    f.frequency.exponentialRampToValueAtTime(4800, at + d)
    g.gain.setValueAtTime(0.001, at)
    g.gain.linearRampToValueAtTime(0.19, at + d * 0.65)
    g.gain.exponentialRampToValueAtTime(0.0001, at + d)
    s.connect(f)
    f.connect(g)
    g.connect(out)
    s.start(at)
    s.stop(at + d)
  }
  // 150 bpm. Sparse hook -> syncopated handoff -> double-time build -> breath -> brand chord.
  const notes = [0, 7, 12, 19, 16, 12, 7, 14, 0, 7, 12, 24, 19, 16, 12, 7]
  for (let k = 0; k < 66; k++) {
    const at = k * 0.4
    if (at >= 25.2) break
    const root = k < 28 ? 146.83 : k < 44 ? 130.81 : 146.83
    const amp = at < 2.4 ? 0.1 : 0.18
    tone(
      root * 2 ** (notes[k % 16] / 12),
      at,
      k % 4 === 3 ? 0.26 : 0.12,
      amp,
      'triangle',
      Math.sin(k * 1.2) * 0.32,
    )
    if (k % 2 === 0) kick(at, at > 20.4 ? 0.4 : 0.29)
    if (k % 2) flick(at, 0.16, 0.1, 1300)
    flick(at + 0.2, 0.055, 0.045, 5000, k % 2 ? 0.4 : -0.4)
    if (at > 4.8 && k % 2 === 0) tone(root / 2, at, 0.3, 0.19, 'triangle')
    if (at > 17.2 && at < 25.2) {
      flick(at + 0.1, 0.035, 0.035, 7000, -0.5)
      flick(at + 0.3, 0.045, 0.04, 7000, 0.5)
    }
  }
  for (const at of beats.slice(1, -2)) {
    flick(at, 0.17, 0.1, 1600)
    if (![10.4, 11.2].includes(at)) whoosh(Math.max(0, at - 0.2), 0.2)
  }
  for (const at of [6.7, 7.5, 8.3]) {
    tone(587.33, at, 0.13, 0.13, 'sine', at < 7 ? -0.7 : at > 8 ? 0.7 : 0)
    flick(at, 0.1, 0.08, 1900)
  }
  for (let j = 0; j < 6; j++) {
    const at = 20.4 + j * 0.4
    tone(146.83 * 2 ** ((j * 2) / 12), at, 0.18, 0.23, 'triangle')
    kick(at, 0.39)
  }
  ;[293.66, 369.99, 440, 587.33].forEach((f, j) => {
    tone(f, 22.8 + j * 0.07, 1.3, 0.13, 'triangle', j / 3 - 0.5)
  })
  // The tiny catch gets a quiet bell; the final cut gets the only sustained resolution.
  tone(1174.66, 25.82, 0.4, 0.1)
  flick(25.82, 0.12, 0.04, 2800)
  whoosh(26.16, 0.24)
  kick(26.4, 0.5)
  ;[73.415, 146.83, 220, 293.66, 369.99, 587.33].forEach((f, j) => {
    tone(f, 26.4 + j * 0.015, 3.1, j < 2 ? 0.2 : 0.11, 'sine', j < 2 ? 0 : (j - 3.5) * 0.22)
  })
  ;[587.33, 739.99, 880].forEach((f, j) => {
    tone(f, 26.8 + j * 0.2, 0.8, 0.09, 'triangle', j * 0.25 - 0.25)
  })
  out.gain.setValueAtTime(0.55, 29.3)
  out.gain.linearRampToValueAtTime(0, 30)
  return ac.startRendering()
}
