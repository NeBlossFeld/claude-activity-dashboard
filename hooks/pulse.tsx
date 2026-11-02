// Surface module: a status spinner with a live elapsed timer, ticking on the surface's own clock.
// With `still` (animations off) it draws a fixed dot and the elapsed time as last handed over.
import type { ClientModule } from 'claude-code'

import type { PulseProps } from '../types'

type State = { base: number; ms: number; frame: number; isActive: boolean }

const TICK = 100
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const COLOR: Record<PulseProps['state'], string> = {
  idle: 'subtle',
  thinking: 'claude',
  tool: 'success',
  running: 'merged',
  done: 'subtle',
  failed: 'error',
  stopped: 'error',
}
const WORD: Record<PulseProps['state'], string> = {
  idle: 'IDLE',
  thinking: 'THINKING',
  tool: 'WORKING',
  running: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

const span = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const Pulse: ClientModule<PulseProps, State> = (props, surface) => {
  const { Text } = surface.elements
  const isLive = props.state === 'thinking' || props.state === 'tool' || props.state === 'running'
  // Ticks only while something runs and animations are on; otherwise nothing redraws on its own.
  const active = isLive && !props.still
  if (surface.state === undefined) {
    surface.setState({ base: props.elapsedMs, ms: 0, frame: 0, isActive: active })
    surface.every(TICK, () => {
      const cur = surface.state
      if (cur !== undefined && cur.isActive) surface.setState({ ...cur, ms: cur.ms + TICK, frame: cur.frame + 1 })
    })
  }
  const st = surface.state ?? { base: props.elapsedMs, ms: 0, frame: 0, isActive: active }
  // New props carry a fresh elapsed time: count on from it by the wall clock when they say when they
  // were measured (a spinner rebuilt after the app was minimized, or whose timers were paused while
  // it was hidden, still shows the right time), else by this spinner's own ticks.
  const hasClock = props.sentAt !== undefined && typeof Date !== 'undefined'
  const sinceSent = hasClock ? Math.max(0, Date.now() - (props.sentAt ?? 0)) : st.base === props.elapsedMs ? st.ms : 0
  const elapsed = props.elapsedMs + sinceSent
  const rebase = st.base !== props.elapsedMs
  if (rebase || st.isActive !== active) {
    surface.setState({ ...st, base: props.elapsedMs, ms: rebase ? 0 : st.ms, isActive: active })
  }

  const glyph = isLive ? (props.still ? '●' : SPIN[st.frame % SPIN.length]) : props.state === 'done' ? '✓' : props.state === 'idle' ? '○' : '✗'

  return (
    <Text wrap="truncate-end">
      <Text color={COLOR[props.state]} weight="bold">
        {glyph} {WORD[props.state]}
      </Text>
      {props.label ? ` ${props.label}` : ''}
      {isLive ? <Text dimColor> · {span(elapsed)}</Text> : ''}
    </Text>
  )
}

export default Pulse
