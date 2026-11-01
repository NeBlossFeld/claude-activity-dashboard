import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Dash, Live, Options, Section, View } from '../types'
import { cut, runningAgents } from './describe'

export const PANE = 'activity'
export const TITLE = 'Activity'
export const MAX_EVENTS = 300

export const EMPTY: Dash = {
  events: [],
  agents: [],
  files: [],
  browser: null,
  status: { state: 'idle', label: 'Idle', model: '', turns: 0, turnStartedAt: 0, tokensIn: 0, tokensOut: 0 },
}
export const FRESH_VIEW: View = {
  filter: { agent: 'all', kind: 'all', file: '' },
  selected: null,
  expanded: null,
  isPaneOpen: false,
  summary: null,
  isSummarizing: false,
  isCompact: false,
  collapsed: [],
  sizes: { live: 9, timeline: 20 },
  issuesSeen: 0,
  isSettingsOpen: false,
  settingsNote: null,
  closedAgents: [],
}
export const SIZE_LIMITS = { live: [4, 30], timeline: [5, 80] } as const
export const ALL_SECTIONS: Section[] = ['live', 'agents', 'timeline', 'files', 'browser']
// A view stored by an older version of the mod lacks the newer fields, or holds retired ones.
export const norm = (v: View): View => ({
  ...FRESH_VIEW,
  ...v,
  sizes: { ...FRESH_VIEW.sizes, ...(v.sizes ?? {}) },
  collapsed: (v.collapsed ?? []).filter(s => ALL_SECTIONS.includes(s)),
  closedAgents: v.closedAgents ?? [],
})
export const HISTORY = 'history'
export const LAYOUT = 'layout'

// The settings (plugin.json `userConfig`), filled in by register(); defaults until then.
let opts: Options = { autoOpen: true, animations: true, historySize: 10, reportFolder: '' }
export const readOptions = (raw: Readonly<Record<string, unknown>>): Options => ({
  autoOpen: raw.autoOpen !== false,
  animations: raw.animations !== false,
  historySize: Math.max(1, Math.min(50, Math.round(Number(raw.historySize ?? 10)) || 10)),
  reportFolder: typeof raw.reportFolder === 'string' ? raw.reportFolder.trim() : '',
})
// `opts` is reassigned, so other modules go through these rather than holding a copy.
export const getOpts = (): Options => opts
export const setOpts = (next: Options) => {
  opts = next
}

export const IDLE_LIVE: Live = { id: 'idle', mode: 'idle', file: '', old: '', text: '', offset: 0, isDone: true, output: '', isError: false }

export const dash = atom({ plugin: 'activity-dashboard', key: 'dash' } as const, EMPTY)
export const view = atom({ plugin: 'activity-dashboard', key: 'view' } as const, FRESH_VIEW)
// What the typer shows. Kept out of $.state on purpose: it changes many times a second while I
// write, and a state write would redraw the whole pane each time, swallowing presses. The typer
// polls it instead (ui.message), so only that small window redraws.
// One live record per loop: 'main', or a subagent's id, each with the version it was last set at.
export const MAIN = 'main'
export const AGENT_ROWS = 5
export const lives = new Map<string, { live: Live; ver: number }>()
let liveVer = 0
export const liveOfLoop = (loop: string): Live => lives.get(loop)?.live ?? IDLE_LIVE
export const setLive = (loop: string, next: Live | ((l: Live) => Live)) => {
  const live = typeof next === 'function' ? next(liveOfLoop(loop)) : next
  liveVer += 1
  // Re-inserted so the map runs from least to most recently updated; the main loop is never evicted.
  lives.delete(loop)
  lives.set(loop, { live, ver: liveVer })
  for (const key of lives.keys()) {
    if (lives.size <= 20) break
    if (key !== MAIN) lives.delete(key)
  }
}
export const typerProps = (v: View, loop = MAIN) => ({
  ...liveOfLoop(loop),
  rows: loop !== MAIN ? AGENT_ROWS : v.isCompact ? Math.min(5, v.sizes.live) : v.sizes.live,
  ver: lives.get(loop)?.ver ?? 0,
  ...(opts.animations ? {} : { still: true }),
})
// A typer Client's key names its loop: `typer` for the main loop, `typer-<agent id>` for a subagent.
export const typerKey = (loop: string) => (loop === MAIN ? 'typer' : `typer-${loop}`)
export const loopOfKey = (key: string) => (key === 'typer' ? MAIN : key.slice('typer-'.length))
// Tokens a model step cost, waiting for the calls it asked for (by tool_use_id).
export const stepTokens = new Map<string, number>()

// One wording for the status line, the band and the pane: not "Idle" while subagents still work.
export const headline = (d: Dash, room: number): string => {
  const n = runningAgents(d)
  if (d.status.state !== 'idle') return `● ${cut(d.status.label, room)}`
  return n ? `◌ Waiting on ${n} agent${n > 1 ? 's' : ''}` : '○ Idle'
}

export async function pushStatus($: EngineInterface) {
  const d = await read($, dash)
  const n = runningAgents(d)
  const head = headline(d, 50)
  $.ui.status(`${head}${n && d.status.state !== 'idle' ? ` · ${n} agent${n > 1 ? 's' : ''} running` : ''}`)
}

export async function isPaneShowing($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isPlaced)
}

export async function syncPaneOpen($: EngineInterface) {
  const isShowing = await isPaneShowing($)
  if ((await read($, view)).isPaneOpen !== isShowing) await update($, view, v => ({ ...v, isPaneOpen: isShowing }))
}

export async function openPane($: EngineInterface) {
  const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
  await update($, view, v => ({ ...v, isPaneOpen: isPlaced }))
}
