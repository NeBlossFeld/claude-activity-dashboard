// Surface module: a live text cursor. Words appear as I write them, and an
// edit's old text is backspaced away word by word before the new text types in.
import type { ClientModule } from 'claude-code'

import type { TyperProps } from '../types'

type State = {
  ref: { props: TyperProps }
  id: string
  oldLeft: number
  typed: number
  ticks: number
  // A command's clock: the tick it started and finished on (-1 while running), and output lines shown.
  since: number
  doneAt: number
  shownOut: number
  // The tick the current props arrived on: a command's `ageMs` counts on from it.
  propsTick: number
}

const START = (props: TyperProps): State => ({
  ref: { props },
  id: '',
  oldLeft: 0,
  typed: 0,
  ticks: 0,
  since: 0,
  doneAt: -1,
  shownOut: 0,
  propsTick: 0,
})

const TICK = 40
const POLL = 120
const LABEL: Record<TyperProps['mode'], string> = {
  idle: 'Waiting for you',
  think: 'Thinking',
  reply: 'Writing reply',
  write: 'Writing',
  edit: 'Editing',
  run: 'Typing command',
  read: 'Reading',
  search: 'Searching',
  web: 'Browsing',
}
const ICON: Record<TyperProps['mode'], string> = { idle: '○', think: '✦', reply: '💬', write: '✏️', edit: '✏️', run: '▶', read: '📖', search: '🔍', web: '🌐' }
// A read is skimmed in about this many ticks, whatever its length: it keeps up with how fast I read.
const READ_TICKS = 28

const wordsLeft = (s: string, from: number, to: number): number => (s.slice(from, to).match(/\S+/g) ?? []).length

// Moves forward over `n` words from `i`.
const forward = (s: string, i: number, n: number): number => {
  let j = i
  for (let k = 0; k < n && j < s.length; k++) {
    while (j < s.length && /\s/.test(s[j]!)) j++
    while (j < s.length && !/\s/.test(s[j]!)) j++
  }
  return j
}

// Moves back over `n` words from `i`.
const backward = (s: string, i: number, n: number): number => {
  let j = i
  for (let k = 0; k < n && j > 0; k++) {
    while (j > 0 && /\s/.test(s[j - 1]!)) j--
    while (j > 0 && !/\s/.test(s[j - 1]!)) j--
  }
  return j
}

const base = (p: string): string => p.split(/[\\/]/).pop() || p

const isStill = (p: TyperProps): boolean => (p as { still?: boolean }).still === true

// The wall clock, where the drawing environment has one.
const wallNow = (): number => (typeof Date !== 'undefined' ? Date.now() : 0)

const step = (st: State): State => {
  const p = st.ref.props
  const fresh = st.id !== p.id
  let oldLeft = fresh ? p.old.length : Math.min(st.oldLeft, p.old.length)
  // `typed` counts characters of the whole text; the visible part starts at `offset`.
  let typed = fresh ? p.offset : Math.max(st.typed, p.offset)
  const total = p.offset + p.text.length
  const isErasing = p.mode === 'edit' && oldLeft > 0 && (p.text.length > 0 || p.isDone)

  if (p.mode === 'read') {
    // `typed` is the scan line here.
    const count = p.text === '' ? 0 : p.text.split('\n').length
    typed = Math.min(count, (fresh ? 0 : st.typed) + Math.max(1, Math.ceil(count / READ_TICKS)))
  } else if (isErasing) {
    oldLeft = backward(p.old, oldLeft, Math.max(1, Math.ceil(wordsLeft(p.old, 0, oldLeft) / 10)))
  } else if (typed < total) {
    const local = typed - p.offset
    const behind = wordsLeft(p.text, local, p.text.length)
    typed = p.offset + forward(p.text, local, Math.max(1, Math.ceil(behind / 8)))
  }

  const ticks = st.ticks + 1
  const since = fresh ? ticks : st.since
  const doneAt = p.isDone ? (fresh || st.doneAt < 0 ? ticks : st.doneAt) : -1
  let shownOut = fresh ? 0 : st.shownOut
  if (p.mode === 'run' && p.isDone && typed >= total) {
    const count = outLines(p.output).length
    shownOut = Math.min(count, shownOut + Math.max(1, Math.ceil(count / 15)))
  } else if ((p.mode === 'search' || p.mode === 'web') && p.isDone) {
    const count = p.mode === 'web' ? webCount(p) : outLines(p.output).length
    shownOut = Math.min(count, shownOut + Math.max(1, Math.ceil(count / (p.mode === 'search' ? 15 : 12))))
  }

  if (isStill(p)) {
    // Animations off: jump every counter to its end value.
    if (p.mode === 'read') typed = p.text === '' ? 0 : p.text.split('\n').length
    else {
      if (isErasing) oldLeft = 0
      typed = total
    }
    if (p.mode === 'run' && p.isDone) shownOut = outLines(p.output).length
    else if ((p.mode === 'search' || p.mode === 'web') && p.isDone) shownOut = p.mode === 'web' ? webCount(p) : outLines(p.output).length
  }

  return { ref: st.ref, id: p.id, oldLeft, typed, ticks, since, doneAt, shownOut, propsTick: st.propsTick }
}

const outLines = (s: string): string[] => s.split(/\r?\n/).filter(l => l.trim() !== '')

const WAVE = '▁▂▃▄▅▆▇█▇▆▅▄▃▂'
const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

// Mini terminal: the command types in, a wave pulses while it runs, then the output rushes in and an exit badge lands.
const terminal = (props: TyperProps, surface: Parameters<ClientModule<TyperProps, State>>[1], st: State, isFresh: boolean) => {
  const { Box, Text } = surface.elements
  const rows = Math.max(4, props.rows)
  const cols = Math.max(20, surface.columns || 60)
  const typed = isFresh ? props.offset : st.typed
  const local = Math.max(0, typed - props.offset)
  const total = props.text.length
  const isTyping = local < total || (!props.isDone && total === 0)
  const ticks = st.ticks
  // The real run time: from the hooks' own clock when they sent one, plus the real time since they
  // sent it (the wall clock, not this window's ticks, which restart when the app is minimized and
  // pause while it is hidden); else from when this window first saw the command.
  const sinceSent = props.sentAt !== undefined ? Math.max(0, wallNow() - props.sentAt) : Math.max(0, ticks - st.propsTick) * TICK
  const ran =
    props.ageMs !== undefined
      ? props.isDone
        ? props.ageMs
        : props.ageMs + sinceSent
      : ((props.isDone && st.doneAt >= 0 ? st.doneAt : ticks) - (isFresh ? ticks : st.since)) * TICK
  const command = props.text.slice(0, local).replace(/\s+/g, ' ')
  const cursor = isStill(props) ? (props.isDone ? '' : '▌') : Math.floor((ticks * TICK) / 500) % 2 === 0 ? '▌' : ' '
  const wave = Array.from({ length: 14 }, (_, i) => WAVE[(i + ticks) % WAVE.length]).join('')
  const out = outLines(props.output)
  const shown = out.slice(0, isFresh ? 0 : st.shownOut)
  const isLanded = props.isDone && !isTyping && shown.length >= out.length
  const room = rows - 3
  const head = props.isDone && !isTyping ? '▶ Ran' : isTyping ? '▶ Typing command' : '▶ Running'

  return (
    <Box flexDirection="column" height={rows}>
      <Text color="claude" weight="semibold">
        {head}
      </Text>
      <Text mono wrap="truncate-start">
        <Text color="bashBorder">$ </Text>
        {command.length > cols - 4 ? `…${command.slice(-(cols - 5))}` : command}
        {isTyping && <Text color="claude">{cursor}</Text>}
      </Text>
      {!isTyping && !props.isDone && (
        // The words first and one line that cuts rather than wraps: a wide wave frame can only lose
        // its own tail, never push "running · time" onto a hidden second line.
        <Text mono wrap="truncate-end">
          <Text dimColor>running · {clock(ran)} </Text>
          <Text color="bashBorder">{wave}</Text>
        </Text>
      )}
      {props.isDone &&
        shown.slice(-room).map(line => (
          <Text mono dimColor wrap="truncate-end">
            {line.slice(0, cols - 1)}
          </Text>
        ))}
      {isLanded && (
        <Text color={props.isError ? 'error' : 'success'} weight="bold">
          {props.isError ? '✗ failed' : '✓ exit 0'} · {clock(ran)}
        </Text>
      )}
    </Box>
  )
}

// Speed-reading: the file's lines rush up past a scan bar, with a progress bar in the header.
const reading = (props: TyperProps, surface: Parameters<ClientModule<TyperProps, State>>[1], scan: number, ticks: number) => {
  const { Box, Text } = surface.elements
  const lines = props.text === '' ? [] : props.text.split('\n')
  const rows = Math.max(3, props.rows)
  const cols = Math.max(20, surface.columns || 60)
  const window = rows - 1
  const at = Math.min(scan, Math.max(0, lines.length - 1))
  const start = Math.max(0, Math.min(at - Math.floor(window * 0.6), lines.length - window))
  const isDone = props.isDone && lines.length > 0 && scan >= lines.length
  const barW = 12
  const filled = lines.length ? Math.round((Math.min(scan, lines.length) / lines.length) * barW) : (ticks % barW)
  const bar = lines.length ? `${'█'.repeat(filled)}${'░'.repeat(barW - filled)}` : `${'░'.repeat(filled)}▓${'░'.repeat(barW - filled - 1)}`
  const head = isDone
    ? `📖 Read ${base(props.file)} · ${lines.length} lines ✓`
    : `📖 Reading ${base(props.file)} ${bar} ${lines.length ? `${Math.min(scan, lines.length)}/${lines.length}` : 'opening'}`

  return (
    <Box flexDirection="column" height={rows}>
      <Text color="claude" weight="semibold" wrap="truncate-end">
        {head}
      </Text>
      {lines.slice(start, start + window).map((line, i) => {
        const n = start + i
        const isScan = n === at && !isDone

        return (
          <Text mono wrap="truncate-end" inverse={isScan} color={isScan ? 'claude' : n < at ? 'text' : 'subtle'} dimColor={!isScan && n < at}>
            {line.slice(0, cols - 1) || ' '}
          </Text>
        )
      })}
    </Box>
  )
}

// A bright block that bounces back and forth across `width` (one sweep each way takes about a second).
const sweep = (ticks: number, width: number, block: string): string => {
  const span = Math.max(1, width - block.length)
  const period = 25
  const t = ticks % (period * 2)
  const at = Math.round((span * (t < period ? t : period * 2 - t)) / period)
  return `${' '.repeat(at)}${block}${' '.repeat(span - at)}`
}

// Search: a beam sweeps the scope while it runs, then the hits pop in with the pattern lit up and a counter climbing.
const searching = (props: TyperProps, surface: Parameters<ClientModule<TyperProps, State>>[1], st: State, isFresh: boolean) => {
  const { Box, Text } = surface.elements
  const rows = Math.max(3, props.rows)
  const cols = Math.max(20, surface.columns || 60)
  const hits = outLines(props.output)
  const shown = hits.slice(0, isFresh ? 0 : st.shownOut)
  const isLanded = props.isDone && shown.length >= hits.length
  const room = Math.max(1, rows - 2)
  const needle = props.text.toLowerCase()
  const scope = props.file ? base(props.file) : 'here'
  const count = props.isError ? 'failed' : `${shown.length} hits`
  const head = `🔍 Searching "${props.text}" in ${scope}${props.isDone ? ` · ${isLanded && !props.isError ? '✓ ' : props.isError ? '✗ ' : ''}${count}` : ''}`
  const beam = sweep(st.ticks, Math.min(cols - 12, 30), '▓▒░')

  return (
    <Box flexDirection="column" height={rows}>
      <Text color={props.isError ? 'error' : 'claude'} weight="semibold" wrap="truncate-end">
        {head}
      </Text>
      {!props.isDone && (
        <Text mono wrap="truncate-end">
          <Text dimColor>scanning… </Text>
          <Text color="claude">[{beam}]</Text>
        </Text>
      )}
      {props.isDone &&
        !props.isError &&
        shown.slice(-room).map(line => {
          const text = line.slice(0, cols - 1)
          const i = needle === '' ? -1 : text.toLowerCase().indexOf(needle)

          return (
            <Text mono dimColor wrap="truncate-end">
              {i < 0 ? text : text.slice(0, i)}
              <Text color="claude" dimColor={false}>
                {i < 0 ? '' : text.slice(i, i + needle.length)}
              </Text>
              {i < 0 ? '' : text.slice(i + needle.length)}
            </Text>
          )
        })}
    </Box>
  )
}

type WebKind = 'search' | 'fetch' | 'browser'
type Link = { title: string; url: string }

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim())

const webKind = (p: TyperProps): WebKind => {
  const tool = p.tool ?? ''
  if (/browser|chrome/i.test(tool)) return 'browser'
  if (tool === 'WebSearch') return 'search'
  if (tool === '' && !isUrl(p.text)) return 'search'
  return 'fetch'
}

const hostOf = (url: string): string => url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1] ?? url
const pathOf = (url: string): string => url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? ''

const unquote = (s: string): string => {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

// The `Links: [...]` line of WebSearch output; recovers whole objects when the output was cut mid-JSON.
const parseLinks = (output: string): Link[] => {
  const line = output.split(/\r?\n/).find(l => l.trimStart().startsWith('Links:'))
  if (line === undefined) return []
  const raw = line.trimStart().slice('Links:'.length).trim()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).url === 'string')
        .map(x => ({ title: String(x.title ?? x.url), url: String(x.url) }))
    }
  } catch {
    // Cut off or malformed: fall through to the regex recovery.
  }
  const found: Link[] = []
  const re = /\{\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) found.push({ title: unquote(m[1]!), url: unquote(m[2]!) })
  return found
}

// The first few prose lines of a fetch summary, markdown markers stripped.
const proseLines = (output: string, max: number): string[] =>
  outLines(output)
    .map(l => l.replace(/^[\s#>*+-]+/, '').replace(/\*\*|`/g, '').trim())
    .filter(l => l !== '')
    .slice(0, max)

// How many things drop in one by one for this web call.
const webCount = (p: TyperProps): number => {
  const kind = webKind(p)
  if (kind === 'browser') return 0
  if (kind === 'fetch') return proseLines(p.output, 4).length
  const links = parseLinks(p.output)
  return links.length > 0 ? links.length : outLines(p.output).length
}

// Web: a loading bar while it loads, then the results drop in one by one. Search lists links, fetch shows a summary, browser tools a status.
const browsing = (props: TyperProps, surface: Parameters<ClientModule<TyperProps, State>>[1], st: State, isFresh: boolean) => {
  const { Box, Text } = surface.elements
  const rows = Math.max(3, props.rows)
  const cols = Math.max(20, surface.columns || 60)
  const kind = webKind(props)
  const dots = '.'.repeat(1 + (Math.floor((st.ticks * TICK) / 350) % 3)).padEnd(3)
  const bar = sweep(st.ticks, 24, '===')
  const room = Math.max(1, rows - 2)
  const count = isFresh ? 0 : st.shownOut
  const loading = !props.isDone && (
    <Text mono wrap="truncate-end">
      <Text dimColor>loading{dots} </Text>
      <Text color="claude">[{bar}]</Text>
    </Text>
  )
  const failed = props.isDone && props.isError && (
    <Text color="error" weight="bold">
      ✗ failed
    </Text>
  )

  if (kind === 'browser') {
    const target = isUrl(props.text) ? hostOf(props.text.trim()) : props.text
    const status = outLines(props.output)[0]?.trim() ?? ''

    return (
      <Box flexDirection="column" height={rows}>
        <Text color="claude" weight="semibold" wrap="truncate-end">
          🧭 {props.isDone ? 'Opened' : 'Opening'} {target}
        </Text>
        {loading}
        {props.isDone && !props.isError && status !== '' && (
          <Text mono dimColor wrap="truncate-end">
            {status.slice(0, cols - 1)}
          </Text>
        )}
        {props.isDone && !props.isError && (
          <Text color="success" weight="bold">
            ✓
          </Text>
        )}
        {failed}
      </Box>
    )
  }

  if (kind === 'fetch') {
    const url = props.text.trim()
    const path = pathOf(url)
    const target = `${hostOf(url)}${path.length > 30 ? `${path.slice(0, 29)}…` : path === '/' ? '' : path}`
    const prose = proseLines(props.output, 4)
    const shown = prose.slice(0, count)
    const isLanded = props.isDone && shown.length >= prose.length
    // Keep the wrapped lines inside the rows left under the header and above the badge.
    let budget = room
    const fit: string[] = []
    for (const line of shown) {
      if (budget <= 0) break
      const need = Math.max(1, Math.ceil(line.length / (cols - 1)))
      fit.push(need > budget ? line.slice(0, budget * (cols - 1) - 1) + '…' : line)
      budget -= need
    }

    return (
      <Box flexDirection="column" height={rows}>
        <Text color="claude" weight="semibold" wrap="truncate-end">
          🌐 Fetching {target}
        </Text>
        {loading}
        {props.isDone &&
          !props.isError &&
          fit.map((line, i) => {
            const isNewest = i === fit.length - 1 && !isLanded

            return (
              <Text wrap="wrap" weight={isNewest ? 'bold' : undefined} dimColor={!isNewest}>
                {line}
              </Text>
            )
          })}
        {props.isDone && !props.isError && isLanded && (
          <Text color="success" weight="bold">
            ✓ fetched
          </Text>
        )}
        {failed}
      </Box>
    )
  }

  const links = parseLinks(props.output)
  const isList = links.length > 0
  const fallback = outLines(props.output)
  const total = isList ? links.length : fallback.length
  const shownCount = Math.min(count, total)
  const isLanded = props.isDone && shownCount >= total
  const perItem = isList ? 2 : 1
  const keep = Math.max(1, Math.floor(room / perItem))

  return (
    <Box flexDirection="column" height={rows}>
      <Text color="claude" weight="semibold" wrap="truncate-end">
        🔎 Searching "{props.text}"
      </Text>
      {loading}
      {props.isDone &&
        !props.isError &&
        isList &&
        links.slice(0, shownCount).map((link, i) => ({ link, n: i + 1 })).slice(-keep).map(({ link, n }) => {
          // The result that just dropped in is bold for the tick it appears.
          const isNewest = n === shownCount && !isLanded

          return (
            <Box flexDirection="column">
              <Text wrap="truncate-end" weight={isNewest ? 'bold' : undefined}>
                {`${n} ${link.title}`.slice(0, cols - 1)}
              </Text>
              <Text dimColor wrap="truncate-end">
                {`  ${hostOf(link.url)}`.slice(0, cols - 1)}
              </Text>
            </Box>
          )
        })}
      {props.isDone &&
        !props.isError &&
        !isList &&
        fallback.slice(0, shownCount).slice(-keep).map((line, i, all) => {
          const isNewest = i === all.length - 1 && !isLanded

          return (
            <Text mono wrap="truncate-end" weight={isNewest ? 'bold' : undefined} dimColor={!isNewest}>
              {line.slice(0, cols - 1)}
            </Text>
          )
        })}
      {props.isDone && !props.isError && isLanded && (
        <Text color="success" weight="bold">
          ✓ {total} results
        </Text>
      )}
      {failed}
    </Box>
  )
}

const Typer: ClientModule<TyperProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(START(props))
    surface.every(TICK, () => {
      const cur = surface.state
      if (cur === undefined) return
      const next = step(cur)
      const mode = cur.ref.props.mode
      const isSame =
        next.id === cur.id && next.typed === cur.typed && next.oldLeft === cur.oldLeft && next.shownOut === cur.shownOut && next.doneAt === cur.doneAt
      const isBlinker = mode === 'idle' || mode === 'write' || mode === 'edit' || mode === 'reply'
      const phase = (t: number): number => Math.floor((t * TICK) / 500) % 2
      // Caught up and nothing moves: skip the redraw (blinkers redraw only when the cursor flips),
      // but keep the tick count current so the blink phase still advances.
      if (isSame && (isStill(cur.ref.props) || (isBlinker && phase(next.ticks) === phase(cur.ticks)) || (!isBlinker && mode !== 'think' && cur.ref.props.isDone))) {
        cur.ticks = next.ticks
        return
      }
      surface.setState(next)
    })
    // Asks the hooks module for newer text; it answers with new props only when there is some.
    surface.every(POLL, () => surface.post({ ver: (surface.state?.ref.props ?? props).ver }))
  }
  const real: State = surface.state ?? START(props)
  if (real.ref.props !== props) real.propsTick = real.ticks
  real.ref.props = props
  const still = isStill(props)
  // Still: a frozen clock, so no wave, beam or dots ever move.
  const st: State = still ? { ...real, ticks: 0 } : real

  const isFresh = st.id !== props.id
  const oldLeft = isFresh ? props.old.length : st.oldLeft
  const typed = isFresh ? props.offset : st.typed

  if (props.mode === 'read') return reading(props, surface, isFresh ? 0 : st.typed, st.ticks)
  if (props.mode === 'run') return terminal(props, surface, st, isFresh)
  if (props.mode === 'search') return searching(props, surface, st, isFresh)
  if (props.mode === 'web') return browsing(props, surface, st, isFresh)
  const local = Math.max(0, typed - props.offset)
  const isCaughtUp = local >= props.text.length && (props.mode !== 'edit' || oldLeft === 0)
  const isBlinkOn = !isCaughtUp || Math.floor((st.ticks * TICK) / 500) % 2 === 0
  const cursor = still ? (props.isDone ? '' : '▌') : isBlinkOn ? '▌' : ' '

  const cols = Math.max(20, surface.columns || 60)
  const rows = Math.max(3, props.rows)
  const dots = '.'.repeat(1 + (Math.floor((st.ticks * TICK) / 350) % 3))

  // The body: an edit's old text still standing (red), then the new text typed so far.
  const isErasing = props.mode === 'edit' && oldLeft > 0
  const body = isErasing ? props.old.slice(0, oldLeft) : props.text.slice(0, local)
  const tone = isErasing ? 'error' : props.mode === 'reply' ? 'text' : 'success'
  const lines = body.split('\n')
  const shown = lines.slice(-(rows - 1))
  const status = props.isDone && isCaughtUp && props.mode !== 'idle' && props.mode !== 'think' && props.mode !== 'reply' ? ' ✓ done' : ''
  const head =
    props.mode === 'think'
      ? `${ICON.think} Thinking${still ? '…' : dots}`
      : props.mode === 'idle' && props.text
        ? // A tool with no animation of its own: its name, while it runs.
          `${props.text}${props.isDone ? ' ✓' : ''}`
        : `${ICON[props.mode]} ${LABEL[props.mode]}${props.file ? ` ${base(props.file)}` : ''}${isErasing ? ' · removing old text' : ''}${status}`

  return (
    <Box flexDirection="column" height={rows}>
      <Text color="claude" weight="semibold" wrap="truncate-end">
        {head}
      </Text>
      {props.mode === 'idle' || props.mode === 'think' ? (
        <Text mono color="claude">
          {cursor}
        </Text>
      ) : (
        shown.map((line, i) => {
          const isLast = i === shown.length - 1
          const room = cols - 2
          // The cursor's line shows its tail so the cursor never scrolls out of view.
          const text = isLast && line.length > room ? `…${line.slice(-(room - 1))}` : line.slice(0, room)

          return (
            <Text mono wrap="truncate-end">
              <Text color={tone} dimColor={isErasing}>
                {text}
              </Text>
              {isLast && <Text color={isErasing ? 'error' : 'claude'}>{cursor}</Text>}
            </Text>
          )
        })
      )}
    </Box>
  )
}

export default Typer
