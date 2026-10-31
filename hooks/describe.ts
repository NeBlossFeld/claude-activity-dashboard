import type { Agent, Browser, Dash, Kind, Line, Live } from '../types'

export const LIVE_TAIL = 3000
export const LIVE_OLD = 1500
export const LIVE_READ = 6000
export const liveMode = (tool: string): Live['mode'] | undefined =>
  tool === 'Write' || tool === 'NotebookEdit'
    ? 'write'
    : tool === 'Edit' || tool === 'MultiEdit'
      ? 'edit'
      : tool === 'Bash' || tool === 'PowerShell'
        ? 'run'
        : tool === 'Read'
          ? 'read'
          : tool === 'Grep' || tool === 'Glob'
            ? 'search'
            : tool === 'WebFetch' || tool === 'WebSearch' || /(browser|chrome)__navigate$/i.test(tool)
              ? 'web'
              : undefined
// The argument the typer shows as it streams in; a read has none (its text is the file, after the call).
export const liveField = (tool: string, mode: Live['mode']): string =>
  mode === 'run'
    ? 'command'
    : mode === 'edit'
      ? 'new_string'
      : mode === 'read'
        ? ''
        : mode === 'search'
          ? 'pattern'
          : mode === 'web'
            ? tool === 'WebSearch'
              ? 'query'
              : 'url'
            : tool === 'NotebookEdit'
              ? 'new_source'
              : 'content'
// Where a call points: its file, or a search's path.
export const placeOf = (get: (key: string) => string): string => get('file_path') || get('notebook_path') || get('path')
// What came back, as the typer shows it: a command's tail, a search's or a page's head.
export const outputOf = (mode: Live['mode'], text: string): string =>
  mode === 'run' ? text.slice(-LIVE_TAIL) : mode === 'search' || mode === 'web' ? text.slice(0, LIVE_TAIL) : ''
// Builds the live record for a call from its (possibly partial) arguments, sending only the tail of long text.
export const liveOf = (id: string, mode: Live['mode'], file: string, old: string, text: string, isDone: boolean, tool?: string): Live => {
  const offset = Math.max(0, text.length - LIVE_TAIL)
  return { id, mode, ...(tool ? { tool } : {}), file, old: old.slice(-LIVE_OLD), text: text.slice(offset), offset, isDone, output: '', isError: false }
}

// Adds or refreshes an agent, keeping what a stub already counted. Past 12 agents the oldest
// finished ones go; running ones always stay.
export const keepAgent = (agents: Agent[], agent: Agent): Agent[] => {
  const had = agents.find(a => a.id === agent.id)
  const merged = had ? { ...had, ...agent, tools: had.tools, tokens: had.tokens, current: had.current || agent.current } : agent
  const list = [...agents.filter(a => a.id !== agent.id), merged]
  while (list.length > 12) {
    const at = list.findIndex(a => a.status !== 'running')
    if (at < 0) break
    list.splice(at, 1)
  }
  return list
}

// Reads a string field out of JSON that is still streaming in: what has arrived of it so far.
export const partialString = (json: string, key: string): string => {
  const at = json.indexOf(`"${key}"`)
  if (at < 0) return ''
  let i = at + key.length + 2
  while (i < json.length && /[\s:]/.test(json[i]!)) i++
  if (json[i] !== '"') return ''
  i++
  let out = ''
  while (i < json.length) {
    const ch = json[i]!
    if (ch === '"') break
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const esc = json[i + 1]
    if (esc === undefined) break
    if (esc === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) break
      out += String.fromCharCode(parseInt(hex, 16))
      i += 6
      continue
    }
    out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '' : esc === 'b' || esc === 'f' ? '' : esc
    i += 2
  }
  return out
}

export const STOPPED =
  'The user stopped this subagent from the dashboard. Do not call any more tools: return what you have now.'

export const RISKY_CMD = /\b(rm|rmdir|del|Remove-Item|git\s+push|git\s+reset\s+--hard|drop\s+table|Format-Volume|shutdown|Stop-Process|taskkill|kill)\b|(^|\s)--force\b/i
export const RISKY_TOOL = /(delete|trash|send_message|SendUserFile|publish|share_file|push|merge|archive|stop_session|upload)/i
export const RISKY_CLICK = /\b(send|submit|delete|publish|post|confirm|buy|pay|purchase|remove|checkout)\b/i

export const ICON: Record<Kind, string> = { read: '📖', write: '✏️', run: '▶', web: '🌐', agent: '🤖', other: '•' }
export const KIND_COLOR: Record<Kind, string> = {
  read: 'suggestion',
  write: 'success',
  run: 'bashBorder',
  web: 'ide',
  agent: 'merged',
  other: 'subtle',
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v))
export const cut = (t: string, n = 120): string => {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
export const base = (p: string): string => p.split(/[\\/]/).pop() || p
export const tail = (tool: string): string => tool.split('__').pop() || tool
export const pad = (n: number): string => String(n).padStart(2, '0')
export const clock = (ts: number): string => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export const span = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${pad(s % 60)}s`
}
export const kilo = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
export const shortModel = (m: string): string =>
  /haiku/i.test(m) ? 'Haiku' : /sonnet/i.test(m) ? 'Sonnet' : /opus/i.test(m) ? 'Opus' : /fable/i.test(m) ? 'Fable' : m ? cut(m, 12) : '?'
export const modelColor = (m: string): string =>
  /haiku/i.test(m) ? 'success' : /sonnet/i.test(m) ? 'suggestion' : /opus/i.test(m) ? 'claude' : 'merged'
export const color = (c: string | undefined) => (c ? { color: c } : {})
export const lines = (text: string, n: number, tone?: Line['tone']): Line[] =>
  text
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .slice(0, n)
    .map(l => (tone ? { text: cut(l, 160), tone } : { text: cut(l, 160) }))

export const kindOf = (tool: string): Kind => {
  if (/^(Read|Grep|Glob|NotebookRead|LS)$/.test(tool)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'write'
  if (/^(Bash|PowerShell)$/.test(tool) || /run_in_terminal/.test(tool)) return 'run'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'agent'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /Browser|chrome|firecrawl/i.test(tool)) return 'web'
  return 'other'
}

export type Described = { summary: string; file?: string; detail: Line[] }

export const describeBrowser = (name: string, a: Record<string, unknown>): string => {
  if (name === 'navigate') return `Open ${cut(str(a.url), 70)}`
  if (name === 'browser_batch') return `${Array.isArray(a.actions) ? a.actions.length : 0} browser steps`
  if (name === 'find') return `Find on page "${cut(str(a.query), 40)}"`
  if (name === 'form_input') return `Fill field: ${cut(str(a.action_summary), 60)}`
  if (name === 'computer') {
    const act = str(a.action)
    const what = str(a.action_summary)
    if (act === 'type') return `Type "${cut(str(a.text), 40)}"`
    if (act === 'scroll') return `Scroll ${str(a.scroll_direction)}`
    if (act === 'screenshot' || act === 'zoom') return 'Look at the page'
    return `${act.replace(/_/g, ' ')}${what ? `: ${cut(what, 60)}` : ''}`
  }
  if (/page_text|read_page/.test(name)) return 'Read the page'
  return name.replace(/_/g, ' ')
}

export const describe = (tool: string, a: Record<string, unknown>): Described => {
  const fp = str(a.file_path || a.notebook_path)
  switch (tool) {
    case 'Read':
      return { summary: `Read ${base(fp)}`, file: fp, detail: [{ text: fp, tone: 'dim' }] }
    case 'Edit':
    case 'MultiEdit':
      return {
        summary: `Edit ${base(fp)}`,
        file: fp,
        detail: [...lines(str(a.old_string), 4, 'del'), ...lines(str(a.new_string), 4, 'add')],
      }
    case 'Write':
      return { summary: `Write ${base(fp)}`, file: fp, detail: lines(str(a.content), 6, 'add') }
    case 'NotebookEdit':
      return { summary: `Edit notebook ${base(fp)}`, file: fp, detail: lines(str(a.new_source), 4, 'add') }
    case 'Grep':
      return { summary: `Search "${cut(str(a.pattern), 40)}"`, detail: [{ text: str(a.path) || 'here', tone: 'dim' }] }
    case 'Glob':
      return { summary: `Find files ${cut(str(a.pattern), 50)}`, detail: [] }
    case 'Bash':
    case 'PowerShell':
      return {
        summary: `Run ${cut(str(a.description) || str(a.command), 60)}`,
        detail: [{ text: `$ ${cut(str(a.command), 200)}`, tone: 'dim' }],
      }
    case 'Agent':
    case 'Task':
      return { summary: `Start ${str(a.subagent_type) || 'agent'}: ${cut(str(a.description), 50)}`, detail: [] }
    case 'WebSearch':
      return { summary: `Search web "${cut(str(a.query), 50)}"`, detail: [] }
    case 'WebFetch':
      return { summary: `Fetch ${cut(str(a.url), 70)}`, detail: [] }
  }
  if (/Browser|chrome/i.test(tool)) return { summary: describeBrowser(tail(tool), a), detail: [] }
  // Other tools: the most telling string argument, never an id (a Studio instance's UUID says nothing).
  const PREFERRED = ['description', 'action_summary', 'query', 'command', 'path', 'file_path', 'name', 'title', 'url', 'code', 'source', 'text', 'prompt']
  const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^(toolu|local)[-_]/.test(s)
  const strings = Object.entries(a).filter(
    ([k, v]) => k !== 'tool' && k !== 'tool_use_id' && k !== 'agentId' && typeof v === 'string' && v.trim() !== '' && !isId(v),
  ) as Array<[string, string]>
  const first = strings.sort((p, q) => (PREFERRED.indexOf(p[0]) + 1 || 99) - (PREFERRED.indexOf(q[0]) + 1 || 99))[0]
  return { summary: `${tail(tool).replace(/_/g, ' ')}${first ? ` ${cut(first[1], 60)}` : ''}`, detail: [] }
}

export const isRisky = (tool: string, a: Record<string, unknown>): boolean => {
  if (/^(Bash|PowerShell)$/.test(tool)) return RISKY_CMD.test(str(a.command))
  if (/Browser|chrome/i.test(tool)) {
    const words = `${str(a.action_summary)} ${JSON.stringify(a.actions ?? '')}`
    return RISKY_CLICK.test(words)
  }
  if (tool === 'Artifact') return /publish|delete/.test(str(a.action) || 'publish')
  return RISKY_TOOL.test(tool)
}

export const afterLines = (tool: string, text: string, failed: boolean, deny?: string): Line[] => {
  if (deny !== undefined) return [{ text: `Denied: ${cut(deny, 160)}`, tone: 'del' }]
  if (failed) return lines(text, 3, 'del')
  if (/^(Bash|PowerShell)$/.test(tool)) return lines(text.split(/\r?\n/).slice(-5).join('\n'), 5, 'dim')
  if (tool === 'Grep' || tool === 'Glob') {
    const n = text.split(/\r?\n/).filter(l => l.trim() !== '').length
    return [{ text: `${n} results`, tone: 'dim' }]
  }
  return []
}

// Approximate browser picture: the clicks this call made, against the largest coordinates seen so far.
export const trackBrowser = (b: Browser | null, tool: string, a: Record<string, unknown>): Browser | null => {
  if (!/Browser|chrome/i.test(tool)) return b
  const next: Browser = b ?? { url: '', clicks: [], maxX: 1280, maxY: 800 }
  const steps: Array<{ name: string; input: Record<string, unknown> }> =
    tail(tool) === 'browser_batch' && Array.isArray(a.actions)
      ? (a.actions as Array<{ name?: unknown; input?: unknown }>).map(s => ({
          name: str(s.name),
          input: (s.input ?? {}) as Record<string, unknown>,
        }))
      : [{ name: tail(tool), input: a }]
  let { url, clicks, maxX, maxY } = next
  for (const s of steps) {
    if ((s.name === 'navigate' || s.name === 'preview_start') && s.input.url) url = str(s.input.url)
    const at = s.input.coordinate
    if (s.name === 'computer' && Array.isArray(at) && at.length === 2 && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
      const [x, y] = at as [number, number]
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      clicks = [...clicks, { x, y, label: cut(str(s.input.action_summary), 40), action: str(s.input.action) }].slice(-4)
    }
  }
  return { url, clicks, maxX, maxY }
}

export const touchFile = (files: Dash['files'], path: string, kind: Kind): Dash['files'] => {
  const has = files.some(f => f.path === path)
  const list = has ? files : [...files, { path, reads: 0, edits: 0 }]
  return list.map(f =>
    f.path === path ? { ...f, reads: f.reads + (kind === 'read' ? 1 : 0), edits: f.edits + (kind === 'write' ? 1 : 0) } : f,
  )
}
export const runningAgents = (d: Dash): number => d.agents.filter(a => a.status === 'running').length
