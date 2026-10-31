// Surface module: an approximate picture of the browser. The cursor glides to
// each new click and a ripple spreads where it lands.
import type { ClientModule } from 'claude-code'

import type { BrowserProps } from '../types'

type Point = { x: number; y: number }
type State = { key: string; from: Point; to: Point; t: number; still: boolean }

const TICK = 50
const GLIDE = 500
const RIPPLE = 700
const TALL = 7

const ease = (k: number): number => 1 - (1 - k) ** 3

const BrowserView: ClientModule<BrowserProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const w = Math.max(16, (surface.columns || 40) - 4)
  const maxX = Number.isFinite(props.maxX) && props.maxX > 0 ? props.maxX : 1280
  const maxY = Number.isFinite(props.maxY) && props.maxY > 0 ? props.maxY : 800
  const toCell = (c: { x: number; y: number }): Point => {
    const cx = Number.isFinite(c.x) ? c.x : 0
    const cy = Number.isFinite(c.y) ? c.y : 0
    return {
      x: Math.max(0, Math.min(w - 1, Math.round((cx / maxX) * (w - 1)))),
      y: Math.max(0, Math.min(TALL - 1, Math.round((cy / maxY) * (TALL - 1)))),
    }
  }
  const last = props.clicks.at(-1)
  const key = last ? `${props.clicks.length}:${last.x},${last.y}:${last.label}` : ''
  const target = last ? toCell(last) : { x: Math.floor(w / 2), y: Math.floor(TALL / 2) }

  const still = (props as { still?: boolean }).still === true

  if (surface.state === undefined) {
    surface.setState({ key, from: target, to: target, t: GLIDE + RIPPLE, still })
    surface.every(TICK, () => {
      const cur = surface.state
      if (cur !== undefined && cur.t < GLIDE + RIPPLE && !cur.still) surface.setState({ ...cur, t: cur.t + TICK })
    })
  }
  // The timer reads the flag from state, so keep it current.
  if (surface.state !== undefined) surface.state.still = still
  let st = surface.state ?? { key, from: target, to: target, t: GLIDE + RIPPLE, still }
  if (still) {
    // Animations off: the cursor sits at the latest click, no glide, no ripple.
    st = { key, from: target, to: target, t: GLIDE + RIPPLE, still }
  } else if (st.key !== key) {
    // A new click: glide from wherever the cursor is now.
    const k = ease(Math.min(1, st.t / GLIDE))
    const now = { x: Math.round(st.from.x + (st.to.x - st.from.x) * k), y: Math.round(st.from.y + (st.to.y - st.from.y) * k) }
    st = { key, from: now, to: target, t: 0, still }
    surface.setState(st)
  }

  const k = ease(Math.min(1, st.t / GLIDE))
  const cur = { x: Math.round(st.from.x + (st.to.x - st.from.x) * k), y: Math.round(st.from.y + (st.to.y - st.from.y) * k) }
  const ring = st.t >= GLIDE && st.t < GLIDE + RIPPLE ? 1 + Math.floor(((st.t - GLIDE) / RIPPLE) * 4) : 0

  // Paint the grid: earlier clicks dim, the ripple ring, then the cursor on top.
  const grid: Array<Array<{ ch: string; tone: string }>> = Array.from({ length: TALL }, () =>
    Array.from({ length: w }, () => ({ ch: ' ', tone: 'subtle' })),
  )
  for (const c of props.clicks.slice(0, -1)) {
    const p = toCell(c)
    grid[p.y]![p.x] = { ch: '·', tone: 'subtle' }
  }
  if (ring > 0) {
    for (let y = 0; y < TALL; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.sqrt(((x - cur.x) / 2) ** 2 + (y - cur.y) ** 2)
        if (Math.round(d) === ring) grid[y]![x] = { ch: ring < 3 ? '○' : '·', tone: 'ide' }
      }
    }
  }
  if (last || st.t < GLIDE) grid[cur.y]![cur.x] = { ch: st.t < GLIDE ? '➤' : '●', tone: 'claude' }

  const row = (cells: Array<{ ch: string; tone: string }>) => {
    const parts: Array<{ text: string; tone: string }> = []
    for (const c of cells) {
      const prev = parts.at(-1)
      if (prev && prev.tone === c.tone) prev.text += c.ch
      else parts.push({ text: c.ch, tone: c.tone })
    }
    return (
      <Text mono>
        {parts.map(p => (
          <Text color={p.tone}>{p.text}</Text>
        ))}
      </Text>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ide" paddingX={1}>
      <Text wrap="truncate-end" dimColor>
        🌐 {props.url || 'browser'}
      </Text>
      {grid.map(row)}
      <Text wrap="truncate-end">
        {last ? `${st.t < GLIDE ? '➤' : '●'} ${last.action.replace(/_/g, ' ')}${last.label ? `: ${last.label}` : ''}` : 'No clicks yet'}
      </Text>
    </Box>
  )
}

export default BrowserView
