const MAX_PARTICLES = 96
const LIFETIME = 4.5
const FADE_START = 3.65
const FIXED_STEP = 1 / 120
const GRAVITY = 1100

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function randomGenerator(seed) {
  let state = finite(seed, 1) >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function targetRectangle(target, width, height) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)
    || !(target.width > 0) || !(target.height > 0)) return null
  const x = clamp(target.x, 0, width)
  const y = clamp(target.y, 0, height)
  const right = clamp(target.x + target.width, x, width)
  const bottom = clamp(target.y + target.height, y, height)
  return right > x && bottom > y ? { x, y, right, bottom, kind: target.kind } : null
}

function collideTarget(particle, previousX, previousY, target) {
  if (!target) return
  const dx = particle.x - previousX
  const dy = particle.y - previousY
  let first = null
  const consider = (fraction, axis, position) => {
    if (!(fraction >= 0 && fraction <= 1) || (first && fraction >= first.fraction)) return
    const cross = axis === 'y' ? previousX + dx * fraction : previousY + dy * fraction
    const size = axis === 'y' ? particle.width : particle.height
    const start = axis === 'y' ? target.x : target.y
    const end = axis === 'y' ? target.right : target.bottom
    if (cross + size > start && cross < end) first = { fraction, axis, position }
  }
  if (dy > 0 && previousY + particle.height <= target.y) {
    consider((target.y - particle.height - previousY) / dy, 'y', target.y - particle.height)
  } else if (dy < 0 && previousY >= target.bottom) {
    consider((target.bottom - previousY) / dy, 'y', target.bottom)
  }
  if (dx > 0 && previousX + particle.width <= target.x) {
    consider((target.x - particle.width - previousX) / dx, 'x', target.x - particle.width)
  } else if (dx < 0 && previousX >= target.right) {
    consider((target.right - previousX) / dx, 'x', target.right)
  }
  if (!first) return
  particle[first.axis] = first.position
  if (first.axis === 'y') {
    particle.vy = Math.abs(particle.vy) < 55 ? 0 : -particle.vy * 0.43
    particle.vx *= 0.76
  } else {
    particle.vx *= -0.43
    particle.vy *= 0.76
  }
  particle.angularVelocity *= -0.64
  particle.targetImpacts += 1
}

/** Transient viewport-space glyph physics. Positions are top-left CSS pixels; angles are radians. */
export function createTextImpactSimulation({ glyphs = [], mode = 'scatter', target, bounds, seed = 1 } = {}) {
  const width = clamp(finite(bounds?.width, 390), 1, 16384)
  const height = clamp(finite(bounds?.height, 844), 1, 16384)
  const obstacle = targetRectangle(target, width, height)
  const burst = mode === 'burst' && obstacle !== null
  const random = randomGenerator(seed)
  const particles = (Array.isArray(glyphs) ? glyphs : [])
    .filter((glyph) => glyph && typeof glyph.text === 'string' && glyph.text.length > 0)
    .slice(0, MAX_PARTICLES)
    .map((glyph, index) => {
      const glyphWidth = clamp(finite(glyph.width, 20), 1, Math.min(256, width))
      const glyphHeight = clamp(finite(glyph.height, 24), 1, Math.min(256, height))
      const x = clamp(finite(glyph.x, width / 2), 0, width - glyphWidth)
      const y = clamp(finite(glyph.y, height / 3), 0, height - glyphHeight)
      const arrival = 0.36 + random() * 0.27
      const aimX = obstacle ? obstacle.x + (obstacle.right - obstacle.x) * (0.25 + random() * 0.5) : 0
      const aimY = obstacle ? obstacle.y + (obstacle.bottom - obstacle.y) * (0.25 + random() * 0.5) : 0
      return {
        text: glyph.text,
        x,
        y,
        width: glyphWidth,
        height: glyphHeight,
        font: typeof glyph.font === 'string' ? glyph.font : '20px sans-serif',
        color: typeof glyph.color === 'string' ? glyph.color : '#ffffff',
        angle: 0,
        alpha: 1,
        vx: burst ? (aimX - glyphWidth / 2 - x) / arrival : (random() - 0.5) * 340,
        vy: burst ? (aimY - glyphHeight / 2 - y) / arrival - GRAVITY * arrival / 2 : -90 - random() * 210,
        angularVelocity: (random() - 0.5) * (burst ? 9 : 13),
        delay: burst ? index * 0.0025 : random() * 0.12,
        targetImpacts: 0,
        floorImpacts: 0,
      }
    })
  let elapsed = 0
  let simulated = 0
  let accumulator = 0
  let done = particles.length === 0

  function advance() {
    simulated += FIXED_STEP
    const occupiedLanes = new Map()
    // Lowest glyphs establish a shallow pile; a lane avoids an all-pairs collision pass.
    const falling = particles.slice().sort((left, right) => (right.y + right.height) - (left.y + left.height))
    for (const particle of falling) {
      if (simulated < particle.delay) continue
      const previousX = particle.x
      const previousY = particle.y
      particle.vy += GRAVITY * FIXED_STEP
      particle.x += particle.vx * FIXED_STEP
      particle.y += particle.vy * FIXED_STEP
      particle.angle += particle.angularVelocity * FIXED_STEP
      collideTarget(particle, previousX, previousY, obstacle)

      if (particle.x < 0 || particle.x + particle.width > width) {
        particle.x = clamp(particle.x, 0, width - particle.width)
        particle.vx *= -0.5
        particle.angularVelocity *= 0.75
      }
      if (particle.y < -particle.height) {
        particle.y = -particle.height
        particle.vy = Math.max(0, particle.vy * -0.35)
      }
      const laneWidth = Math.max(16, particle.width * 0.8)
      const lane = Math.floor((particle.x + particle.width / 2) / laneWidth)
      const surface = occupiedLanes.get(lane) ?? height
      const floor = Math.max(0, surface - particle.height)
      if (particle.y >= floor) {
        particle.y = floor
        if (particle.vy > 0) {
          particle.floorImpacts += 1
          particle.vy = particle.vy < 75 ? 0 : -particle.vy * 0.38
          particle.vx *= 0.68
          particle.angularVelocity *= 0.55
        }
        if (particle.vy === 0) {
          particle.vx *= 0.9
          particle.angularVelocity *= 0.85
          occupiedLanes.set(lane, Math.max(height - 96, particle.y))
        }
      }
    }
  }

  return {
    particles,
    get elapsed() { return elapsed },
    get done() { return done },
    step(deltaSeconds) {
      if (done || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
      elapsed = Math.min(LIFETIME, elapsed + deltaSeconds)
      if (elapsed >= LIFETIME) {
        for (const particle of particles) particle.alpha = 0
        done = true
        return
      }
      // A resumed background tab must not spend seconds catching up with old decorative frames.
      accumulator += Math.min(deltaSeconds, 0.1)
      while (accumulator + Number.EPSILON >= FIXED_STEP) {
        advance()
        accumulator -= FIXED_STEP
      }
      const opacity = 1 - clamp((elapsed - FADE_START) / (LIFETIME - FADE_START), 0, 1)
      for (const particle of particles) particle.alpha = opacity
    },
  }
}
