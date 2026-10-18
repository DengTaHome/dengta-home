import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextImpactSimulation } from '../src/text-impact-physics.js'

const glyphs = ['你', '好', '👨‍👩‍👧‍👦', 'e\u0301', '~'].map((text, index) => ({
  text, x: 100 + index * 24, y: 100, width: 22, height: 25,
  font: '22px system-ui', color: '#fae7da',
}))

function run(simulation, frames = 240, dt = 1 / 60) {
  for (let frame = 0; frame < frames; frame += 1) simulation.step(dt)
  return simulation
}

test('same seed reproduces motion, with copied input and intact grapheme strings', () => {
  const input = structuredClone(glyphs)
  const options = { glyphs: input, bounds: { width: 390, height: 844 }, seed: 26 }
  const first = run(createTextImpactSimulation(options), 120)
  const second = run(createTextImpactSimulation(options), 120)
  assert.deepEqual(first.particles, second.particles)
  assert.deepEqual(input, glyphs)
  assert.deepEqual(first.particles.map((particle) => particle.text), glyphs.map((glyph) => glyph.text))
  assert.equal(first.particles[0].font, glyphs[0].font)
  assert.equal(first.particles[0].color, glyphs[0].color)
  const different = run(createTextImpactSimulation({ ...options, seed: 27 }), 120)
  assert.notDeepEqual(first.particles.map((particle) => particle.x), different.particles.map((particle) => particle.x))
})

test('fixed steps give the same trajectory at 60 and 120 frames per second', () => {
  const options = { glyphs, bounds: { width: 390, height: 844 }, seed: 42 }
  const first = run(createTextImpactSimulation(options), 120, 1 / 60)
  const second = run(createTextImpactSimulation(options), 240, 1 / 120)
  assert.deepEqual(first.particles, second.particles)
})

test('scatter glyphs fall, bounce, and remain within the viewport', () => {
  const simulation = createTextImpactSimulation({ glyphs, bounds: { width: 390, height: 500 }, seed: 2 })
  let bounced = false
  for (let frame = 0; frame < 210; frame += 1) {
    simulation.step(1 / 60)
    for (const particle of simulation.particles) {
      assert.ok(particle.x >= 0 && particle.x + particle.width <= 390)
      assert.ok(particle.y + particle.height <= 500)
      if (particle.floorImpacts > 0 && particle.vy < 0) bounced = true
    }
  }
  assert.equal(bounced, true)
  assert.ok(simulation.particles.every((particle) => particle.floorImpacts > 0))
})

test('burst particles really collide with an avatar before falling', () => {
  const simulation = createTextImpactSimulation({
    glyphs, mode: 'burst', seed: 4, bounds: { width: 390, height: 844 },
    target: { x: 280, y: 320, width: 60, height: 60, kind: 'avatar' },
  })
  run(simulation, 90)
  assert.ok(simulation.particles.every((particle) => particle.targetImpacts > 0))
  assert.ok(simulation.particles.some((particle) => particle.y > 380))
})

test('composer top acts as a bounce surface without tunneling through it', () => {
  const simulation = createTextImpactSimulation({
    glyphs: [{ text: '弹', x: 190, y: 150, width: 24, height: 24 }],
    mode: 'burst', seed: 1, bounds: { width: 390, height: 844 },
    target: { x: 16, y: 700, width: 358, height: 80, kind: 'composer' },
  })
  let hitAndBounced = false
  for (let frame = 0; frame < 70; frame += 1) {
    simulation.step(1 / 60)
    const particle = simulation.particles[0]
    if (particle.targetImpacts > 0 && particle.vy < 0) hitAndBounced = true
    assert.ok(particle.y + particle.height <= 700)
  }
  assert.equal(hitAndBounced, true)
})

test('particle and frame work are bounded and malformed geometry never produces NaN', () => {
  const simulation = createTextImpactSimulation({
    glyphs: Array.from({ length: 1000 }, (_, index) => ({ text: String(index), x: NaN, y: Infinity, width: -1, height: Infinity })),
    bounds: { width: NaN, height: -10 }, seed: Infinity,
    target: { x: Infinity, y: 0, width: Infinity, height: 10 }, mode: 'burst',
  })
  assert.equal(simulation.particles.length, 96)
  simulation.step(NaN)
  simulation.step(Infinity)
  simulation.step(-1)
  assert.equal(simulation.elapsed, 0)
  simulation.step(0.25)
  for (const particle of simulation.particles) {
    for (const field of ['x', 'y', 'width', 'height', 'angle', 'alpha', 'vx', 'vy']) assert.ok(Number.isFinite(particle[field]))
  }
  simulation.step(Number.MAX_VALUE)
  assert.equal(simulation.done, true)
  assert.equal(simulation.elapsed, 4.5)
  assert.ok(simulation.particles.every((particle) => particle.alpha === 0))
})

test('fade finishes without lingering active particles and empty input is already done', () => {
  assert.equal(createTextImpactSimulation().done, true)
  const simulation = createTextImpactSimulation({ glyphs })
  run(simulation, 240)
  assert.equal(simulation.done, false)
  assert.ok(simulation.particles.every((particle) => particle.alpha > 0 && particle.alpha < 1))
  run(simulation, 31)
  assert.equal(simulation.done, true)
  const final = structuredClone(simulation.particles)
  simulation.step(1)
  assert.deepEqual(simulation.particles, final)
})
