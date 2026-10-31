import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Dash, Ev, PastSession } from '../types'
import { clock, ICON, kilo, shortModel } from './describe'
import { EMPTY, FRESH_VIEW, getOpts, HISTORY, LAYOUT, norm } from './state'

// Declared here, not imported: the state scan only follows an atom written in the file that uses it.
// Same plugin and key as in state.ts, so the same state.
const dash = atom({ plugin: 'activity-dashboard', key: 'dash' } as const, EMPTY)
const view = atom({ plugin: 'activity-dashboard', key: 'view' } as const, FRESH_VIEW)

export const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function pastSessions($: EngineInterface): Promise<PastSession[]> {
  const got = await $.store.get(HISTORY).catch(() => undefined)
  return Array.isArray(got) ? (got as PastSession[]) : []
}

// Keeps this session's record in the history, replacing its earlier one.
export async function saveHistory($: EngineInterface) {
  const d = await read($, dash)
  if (!d.startedAt || d.events.length === 0) return
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const record: PastSession = {
    startedAt: d.startedAt,
    endedAt: now,
    cwd,
    turns: d.status.turns,
    tokens: d.status.tokensIn + d.status.tokensOut,
    events: d.events.map(e => ({ ts: e.ts, tool: e.tool, kind: e.kind, summary: e.summary, state: e.state, tokens: e.tokens || 0, model: e.model })),
  }
  const kept = (await pastSessions($)).filter(s => s.startedAt !== d.startedAt)
  await $.store.set(HISTORY, [...kept, record].slice(-getOpts().historySize))
}

export async function saveLayout($: EngineInterface) {
  const v = norm(await read($, view))
  await $.store.set(LAYOUT, { sizes: v.sizes, collapsed: v.collapsed, isCompact: v.isCompact }).catch(() => undefined)
}

export const historyHtml = (past: PastSession[], current?: number): string => {
  const earlier = past.filter(s => s.startedAt !== current).reverse()
  if (earlier.length === 0) return ''
  return `<h2>Earlier sessions</h2>${earlier
    .map(
      s => `<details><summary>${esc(new Date(s.startedAt).toLocaleString())} · ${esc(s.cwd)} · ${s.turns} turns · ${s.events.length} actions · ${kilo(
        s.tokens,
      )} tokens</summary><table>${s.events
        .map(
          e =>
            `<tr class="${e.state}"><td>${clock(e.ts)}</td><td>${esc(shortModel(e.model))}</td><td>${ICON[e.kind]} ${e.kind}</td><td>${esc(e.summary)}</td><td>${kilo(
              e.tokens,
            )}</td><td>${e.state}</td></tr>`,
        )
        .join('')}</table></details>`,
    )
    .join('\n')}`
}

export const reportHtml = (d: Dash, summary: string | null, now: number, past: PastSession[] = []): string => {
  const who = (e: Ev) => (e.agentId ? d.agents.find(a => a.id === e.agentId)?.type ?? 'agent' : 'main')
  const rows = d.events
    .map(
      e =>
        `<tr class="${e.isRisky ? 'risky' : ''} ${e.state}"><td>${clock(e.ts)}</td><td>${esc(who(e))}</td><td>${esc(shortModel(e.model))}</td><td>${ICON[e.kind]} ${e.kind}</td><td>${esc(e.summary)}${
          e.detail.length ? `<pre>${e.detail.map(l => esc(`${l.tone === 'add' ? '+ ' : l.tone === 'del' ? '- ' : ''}${l.text}`)).join('\n')}</pre>` : ''
        }</td><td>${kilo(e.tokens || 0)}</td><td>${e.state}</td></tr>`,
    )
    .join('\n')
  const agents = d.agents
    .map(a => `<li><b>${esc(a.type)}</b> (${esc(shortModel(a.model))}) · ${a.status} · ${a.tools} tools · ${kilo(a.tokens)} tokens — ${esc(a.description)}</li>`)
    .join('')
  const files = d.files.map(f => `<li>${esc(f.path)} · read ${f.reads} · edited ${f.edits}</li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Activity Report</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#e5e5ea;--risk:#fde8e8;--err:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#f2f2f7;--mute:#98989f;--line:#2c2c2e;--risk:#3b1d1d;--err:#ff6b5e}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1100px;margin:auto}
h1{font-size:22px;margin:0 0 4px}.mute{color:var(--mute)}table{border-collapse:collapse;width:100%;margin-top:12px}
td{border-top:1px solid var(--line);padding:6px 8px;vertical-align:top}tr.risky{background:var(--risk)}tr.error td:last-child{color:var(--err)}
pre{margin:4px 0 0;font-size:12px;white-space:pre-wrap;color:var(--mute)}.wrap{overflow-x:auto}
</style></head><body><h1>Claude activity report</h1><p class="mute">Exported ${esc(new Date(now).toLocaleString())} · ${d.events.length} actions · ${d.status.turns} turns · ${kilo(
    d.status.tokensIn + d.status.tokensOut,
  )} main-loop tokens</p>
${summary ? `<h2>Summary</h2><p>${esc(summary).replace(/\n/g, '<br>')}</p>` : ''}
${agents ? `<h2>Subagents</h2><ul>${agents}</ul>` : ''}
${files ? `<h2>Files</h2><ul>${files}</ul>` : ''}
<h2>Timeline</h2><div class="wrap"><table>${rows}</table></div>
${historyHtml(past, d.startedAt)}</body></html>`
}

// Where reports go: the setting, else ~/.claude/activity-reports, so nothing lands in the project.
export async function reportFolder($: EngineInterface): Promise<string> {
  const setting = getOpts().reportFolder
  if (setting) return setting.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || (await $.session.cwd())
  const sep = home.includes('\\') ? '\\' : '/'
  return `${home.replace(/[\\/]+$/, '')}${sep}.claude${sep}activity-reports`
}

// Writes the report and opens it in the default browser.
export async function openHtml($: EngineInterface): Promise<string> {
  const d = await read($, dash)
  const v = await read($, view)
  const now = await $.clock.now()
  const folder = await reportFolder($)
  const isWindows = /^[A-Za-z]:[\\/]/.test(folder) || /^\\\\/.test(folder)
  const name = `claude-activity-${new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.html`
  const path = `${folder}${isWindows ? '\\' : '/'}${name}`
  await saveHistory($).catch(() => undefined)
  await $.fs.write(path, reportHtml(d, v.summary, now, await pastSessions($)))
  const argv = isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', path] : ['open', path]
  const opened = await $.process.run(argv).catch(() => undefined)
  if (!isWindows && (opened === undefined || opened.exitCode !== 0)) await $.process.run(['xdg-open', path]).catch(() => undefined)
  return path
}

export async function summarize($: EngineInterface) {
  if ((await read($, view)).isSummarizing) return
  await update($, view, v => ({ ...v, isSummarizing: true }))
  const d = await read($, dash)
  const log = d.events
    .slice(-150)
    .map(e => `${clock(e.ts)} ${e.agentId ? 'subagent' : 'main'} ${e.tool}: ${e.summary} [${e.state}]`)
    .join('\n')
  let summary = 'Summary failed.'
  try {
    const r = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 400,
      timeoutMs: 45000,
      system:
        "You summarize an AI coding agent's activity log for its user. Write 3-6 short bullet points in plain language: what was done, which files changed, anything that failed. No preamble.",
      prompt: log || 'No activity yet.',
    })
    summary = r.isAnswered ? r.text : `Summary failed (${r.reason}).`
  } finally {
    // Always released, so a refused request never leaves the button stuck on "Summarizing…".
    await update($, view, v => ({ ...v, isSummarizing: false, summary }))
  }
}
