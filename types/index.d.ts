export type Kind = 'read' | 'write' | 'run' | 'web' | 'agent' | 'other'

export type Line = { text: string; tone?: 'add' | 'del' | 'dim' }

export type Ev = {
  id: string
  ts: number
  tool: string
  kind: Kind
  agentId?: string
  model: string
  summary: string
  file?: string
  detail: Line[]
  isRisky: boolean
  state: 'running' | 'done' | 'error' | 'blocked'
  // Tokens the model step that asked for this call cost, split across that step's calls.
  tokens: number
}

export type Agent = {
  id: string
  // The agent that started this one; absent when the main loop did.
  parentId?: string
  description: string
  type: string
  model: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  tools: number
  tokens: number
  current: string
  answer?: string
}

export type FileTouch = { path: string; reads: number; edits: number }

export type Click = { x: number; y: number; label: string; action: string }

export type Browser = { url: string; clicks: Click[]; maxX: number; maxY: number }

export type Status = {
  state: 'idle' | 'thinking' | 'tool'
  label: string
  model: string
  turns: number
  turnStartedAt: number
  tokensIn: number
  tokensOut: number
}

export type Dash = {
  events: Ev[]
  agents: Agent[]
  files: FileTouch[]
  browser: Browser | null
  status: Status
  // When this session's dashboard began: the key its record in the history is kept under.
  startedAt?: number
}

// `issues` shows only what needs attention: failed, blocked or risky actions.
export type Filter = { agent: string; kind: Kind | 'all' | 'issues'; file: string }

// The pane's sections, each collapsible. ('live' is the Preview.)
export type Section = 'live' | 'agents' | 'timeline' | 'files' | 'browser'

// Rows the resizable sections take.
export type Sizes = { live: number; timeline: number }

export type View = {
  filter: Filter
  // The timeline row opened in place (its details, or the actions folded into it).
  selected: string | null
  expanded: string | null
  isPaneOpen: boolean
  summary: string | null
  isSummarizing: boolean
  isCompact: boolean
  collapsed: Section[]
  sizes: Sizes
  // How many issues there were when the person last looked at them: more than that marks "new".
  issuesSeen: number
  // The ⚙ panel, and what it last said (a refused change), if anything.
  isSettingsOpen: boolean
  settingsNote: string | null
}

// The plugin's settings (plugin.json `userConfig`), as register() receives them.
export type Options = {
  autoOpen: boolean
  animations: boolean
  historySize: number
  // Where HTML reports are saved; empty means ~/.claude/activity-reports.
  reportFolder: string
}

// What the typing cursor animates: what one loop (main or a subagent) is doing right now.
export type Live = {
  id: string
  mode: 'idle' | 'think' | 'reply' | 'write' | 'edit' | 'run' | 'read' | 'search' | 'web'
  // The tool behind it (WebSearch, WebFetch, a browser tool...), so one mode can draw each its own way.
  tool?: string
  // The file written, edited or read; for a search, where it searches; for web, unused.
  file: string
  old: string
  // Only the tail of a long text is sent; `offset` is how many characters came before it.
  // For a search: the pattern. For web: the URL or the query.
  text: string
  offset: number
  isDone: boolean
  // What came back once it ran (its tail): a command's output, a search's hits, a page's or a search's results.
  output: string
  isError: boolean
}

// A session kept in $.store for the HTML report's history.
export type PastSession = {
  startedAt: number
  endedAt: number
  cwd: string
  turns: number
  tokens: number
  events: Array<Pick<Ev, 'ts' | 'tool' | 'kind' | 'summary' | 'state' | 'tokens' | 'model'>>
}

// Props of the client modules (plain JSON).
export type TyperProps = Live & { rows: number; ver: number; still?: boolean }
export type PulseProps = {
  state: 'idle' | 'thinking' | 'tool' | 'running' | 'done' | 'failed' | 'stopped'
  label: string
  elapsedMs: number
  // Animations off: no spinner, no ticking.
  still?: boolean
}
export type BrowserProps = Browser & { still?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'activity-dashboard': { dash: Dash; view: View }
  }
}
