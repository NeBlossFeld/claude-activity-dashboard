import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Agent, Browser, Ev, Kind, Line, Options, PulseProps, Section, View } from '../types'
import { base, clock, color, cut, ICON, kilo, KIND_COLOR, modelColor, runningAgents, shortModel, span, tail } from './describe'
import { openHtml, saveLayout, summarize } from './report'
import {
  AGENT_ROWS,
  ALL_SECTIONS,
  EMPTY,
  FRESH_VIEW,
  getOpts,
  headline,
  isPaneShowing,
  MAIN,
  norm,
  openPane,
  setOpts,
  SIZE_LIMITS,
  typerKey,
  typerProps,
} from './state'

// Declared here, not imported: the state scan only follows an atom written in the file that uses it.
// Same plugin and key as in state.ts, so the same state.
const dash = atom({ plugin: 'activity-dashboard', key: 'dash' } as const, EMPTY)
const view = atom({ plugin: 'activity-dashboard', key: 'view' } as const, FRESH_VIEW)

// The pane's two render hooks: the band above the prompt, and the dashboard itself.
export const registerPane = (on: On) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    const d = await read($, dash)
    const n = runningAgents(d)
    if (e.props.hasSurvey || v.isPaneOpen || (d.status.state === 'idle' && n === 0)) return next(e)
    // The engine's own word beats the stored flag: never offer to open a pane that is on screen.
    if (await isPaneShowing($)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const head = headline(d, 60)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>
          {head}
          {n && d.status.state !== 'idle' ? ` · ${n} agent${n > 1 ? 's' : ''} running` : ''}
        </Text>
        <Button key="open" label="Open dashboard" onPress={() => openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'activity' }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // Animations run in client modules, on surfaces that have them (the terminal and desktop).
    const Client = (table as unknown as { Client?: typeof Box }).Client
    const d = await read($, dash)
    const v = norm(await read($, view))
    const now = await $.clock.now()
    const still = getOpts().animations ? {} : { still: true }
    const waitingOn = d.status.state === 'idle' ? runningAgents(d) : 0
    const mainPulse: PulseProps = {
      // Idle while subagents still work reads as running ("waiting on N agents"), not IDLE.
      state: d.status.state === 'idle' ? (waitingOn ? 'running' : 'idle') : d.status.state === 'tool' ? 'tool' : 'thinking',
      label: d.status.state === 'idle' ? (waitingOn ? `waiting on ${waitingOn} agent${waitingOn > 1 ? 's' : ''}` : '') : cut(d.status.label, 60),
      // Idle has no running clock.
      elapsedMs: d.status.state !== 'idle' && d.status.turnStartedAt ? now - d.status.turnStartedAt : 0,
      ...still,
    }
    const cols = e.props.bodyColumns ?? 80
    const isWide = cols >= 96
    const f = v.filter
    // Agents of the same type are told apart by number, in the order they started (Explore, Explore#2).
    const nameOf = new Map<string, string>()
    const typeSeen = new Map<string, number>()
    for (const a of [...d.agents].sort((p, q) => p.startedAt - q.startedAt)) {
      const n = (typeSeen.get(a.type) ?? 0) + 1
      typeSeen.set(a.type, n)
      nameOf.set(a.id, n > 1 ? `${a.type}#${n}` : a.type)
    }
    const agentName = (id?: string) => (id ? nameOf.get(id) ?? 'agent' : 'main')

    const setView = (fn: (x: View) => View) => update($, view, x => fn(norm(x)))
    // Layout changes (sizes, collapsed sections, compact mode) are also kept for the next session.
    const setLayout = async (fn: (x: View) => View) => {
      await setView(fn)
      await saveLayout($)
    }
    const setFilter = (patch: Partial<View['filter']>) => setView(x => ({ ...x, filter: { ...x.filter, ...patch } }))
    const stateColor = d.status.state === 'idle' ? 'subtle' : d.status.state === 'tool' ? 'success' : 'claude'
    const stateWord = d.status.state === 'idle' ? 'IDLE' : d.status.state === 'tool' ? 'WORKING' : 'THINKING'
    const elapsed = d.status.state === 'idle' || !d.status.turnStartedAt ? '' : ` · ${span(now - d.status.turnStartedAt)}`

    // What needs attention: failed, blocked or risky actions. New ones since the person last looked light up.
    const isIssue = (x: Ev) => x.state === 'error' || x.state === 'blocked' || x.isRisky
    const issues = d.events.filter(isIssue)
    const newIssues = Math.max(0, issues.length - v.issuesSeen)

    const shown = d.events.filter(
      x =>
        (f.agent === 'all' || (f.agent === 'main' ? x.agentId === undefined : x.agentId === f.agent)) &&
        (f.kind === 'all' || (f.kind === 'issues' ? isIssue(x) : x.kind === f.kind)) &&
        (f.file === '' || x.file === f.file),
    )
    const isFiltered = f.agent !== 'all' || f.kind !== 'all' || f.file !== ''
    const allTokens = d.events.reduce((n, x) => n + (x.tokens || 0), 0)

    const stateMark = (x: Ev) => (x.state === 'running' ? '…' : x.state === 'error' ? '✗' : x.state === 'blocked' ? '⛔' : '✓')
    // No badge until a model is known, rather than "[?]".
    const badge = (m: string) => (m ? <Text color={modelColor(m)}>[{shortModel(m)}]</Text> : '')
    const detail = (ls: Line[]) =>
      ls.map(l => (
        <Text mono wrap="truncate-end" {...color(l.tone === 'add' ? 'success' : l.tone === 'del' ? 'error' : undefined)} dimColor={l.tone === 'dim'}>
          {l.tone === 'add' ? '+ ' : l.tone === 'del' ? '- ' : '  '}
          {l.text}
        </Text>
      ))

    // A section: a header that collapses it, size buttons where it can be resized, then its body.
    const isOpen = (id: Section) => !v.collapsed.includes(id)
    const section = (id: Section, title: string, body: unknown, size?: keyof typeof SIZE_LIMITS, whenClosed?: unknown) => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Button
            key={`sec-${id}`}
            plain
            onPress={() =>
              setLayout(x => ({ ...x, collapsed: x.collapsed.includes(id) ? x.collapsed.filter(s => s !== id) : [...x.collapsed, id] }))
            }
          >
            <Text weight="semibold">
              {isOpen(id) ? '▾' : '▸'} {title}
            </Text>
          </Button>
          {size && isOpen(id) && (
            <Box flexDirection="row" gap={1}>
              <Button
                key={`sz-${id}-less`}
                plain
                dimColor
                label="−"
                onPress={() =>
                  setLayout(x => ({ ...x, sizes: { ...x.sizes, [size]: Math.max(SIZE_LIMITS[size][0], x.sizes[size] - (size === 'timeline' ? 5 : 1)) } }))
                }
              />
              <Text dimColor>{v.sizes[size]}</Text>
              <Button
                key={`sz-${id}-more`}
                plain
                dimColor
                label="+"
                onPress={() =>
                  setLayout(x => ({ ...x, sizes: { ...x.sizes, [size]: Math.min(SIZE_LIMITS[size][1], x.sizes[size] + (size === 'timeline' ? 5 : 1)) } }))
                }
              />
            </Box>
          )}
        </Box>
        {isOpen(id) ? body : whenClosed}
      </Box>
    )

    const browserStill = (b: Browser) => {
      const w = Math.max(16, Math.min(34, (isWide ? 34 : cols) - 4))
      const tall = 7
      const grid = Array.from({ length: tall }, () => Array.from({ length: w }, () => ' '))
      b.clicks.forEach((c, i) => {
        const gx = Math.max(0, Math.min(w - 1, Math.round((c.x / (b.maxX || 1280)) * (w - 1))))
        const gy = Math.max(0, Math.min(tall - 1, Math.round((c.y / (b.maxY || 800)) * (tall - 1))))
        grid[gy]![gx] = i === b.clicks.length - 1 ? '●' : '·'
      })
      const last = b.clicks.at(-1)

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="ide" paddingX={1}>
          <Text wrap="truncate-end" dimColor>
            🌐 {b.url ? cut(b.url, w) : 'browser'}
          </Text>
          {grid.map(r => (
            <Text mono>{r.join('')}</Text>
          ))}
          <Text wrap="truncate-end">{last ? `● ${last.action.replace(/_/g, ' ')}${last.label ? `: ${last.label}` : ''}` : 'No clicks yet'}</Text>
        </Box>
      )
    }
    const browserBox = (b: Browser) =>
      Client ? <Client key="browser" module="./browserview.tsx" props={{ ...b, ...still }} width={isWide ? 36 : '100%'} /> : browserStill(b)

    const mainTyper = typerProps(v)
    const previewBox = Client && (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Client key={typerKey(MAIN)} module="./typer.tsx" props={mainTyper} width="100%" height={mainTyper.rows} />
      </Box>
    )

    // The top bar: short labels so the row fits a narrow pane.
    const header = (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
          {Client ? (
            <Client key="pulse-main" module="./pulse.tsx" props={mainPulse} />
          ) : (
            <Text wrap="truncate-end">
              <Text color={stateColor} weight="bold">
                ● {stateWord}
              </Text>{' '}
              {d.status.state === 'idle' ? '' : cut(d.status.label, Math.max(20, cols - 40))}
            </Text>
          )}
          <Text dimColor tabular>
            {badge(d.status.model)} turn {d.status.turns}
            {elapsed} · {kilo(d.status.tokensIn)} in / {kilo(d.status.tokensOut)} out
          </Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {issues.length > 0 && (
            <Button
              key="issues"
              variant={newIssues > 0 || f.kind === 'issues' ? 'primary' : 'secondary'}
              label={`⚠ ${issues.length}${newIssues > 0 ? ' new' : ''}`}
              onPress={() =>
                setView(x => ({
                  ...x,
                  issuesSeen: issues.length,
                  filter: { ...x.filter, kind: x.filter.kind === 'issues' ? 'all' : 'issues' },
                  selected: x.filter.kind === 'issues' ? x.selected : issues.at(-1)?.id ?? null,
                }))
              }
            />
          )}
          <Button key="open-html" label="📄 Report" onPress={() => openHtml($)} />
          <Button key="summary" label={v.isSummarizing ? '✨ …' : '✨ Summary'} onPress={() => summarize($)} />
          <Button
            key="compact"
            variant={v.isCompact ? 'primary' : 'secondary'}
            label={v.isCompact ? '⤢ Full' : '⤡ Compact'}
            onPress={() => setLayout(x => ({ ...x, isCompact: !x.isCompact }))}
          />
          <Button
            key="settings"
            variant={v.isSettingsOpen ? 'primary' : 'secondary'}
            label="⚙"
            onPress={() => setView(x => ({ ...x, isSettingsOpen: !x.isSettingsOpen, settingsNote: null }))}
          />
          {!v.isCompact && (
            <Button
              key="collapse-all"
              dimColor
              label={v.collapsed.length >= ALL_SECTIONS.length ? '▸ All' : '▾ All'}
              onPress={() => setLayout(x => ({ ...x, collapsed: x.collapsed.length >= ALL_SECTIONS.length ? [] : [...ALL_SECTIONS] }))}
            />
          )}
        </Box>
      </Box>
    )

    // The ⚙ panel: the plugin's settings, changed the way /config would (`$.config.set`), which also
    // saves them and reloads the plugin with the new values. Shown at once from the local copy.
    const setOption = async <K extends keyof Options>(field: K, value: Options[K]) => {
      const rows = await $.config.list().catch(() => [])
      const key = rows.find(r => r.key === `activity-dashboard.${field}` || r.key.endsWith(`activity-dashboard.${field}`))?.key ?? `activity-dashboard.${field}`
      const r = await $.config.set({ key, value }).catch((err: unknown) => ({ deny: String(err) }))
      if (r.deny === undefined) setOpts({ ...getOpts(), [field]: value })
      await setView(x => ({ ...x, settingsNote: r.deny === undefined ? null : `Not saved: ${r.deny}` }))
    }
    const o = getOpts()
    const Input = (table as unknown as { Input?: typeof Box }).Input
    const toggle = (field: 'autoOpen' | 'animations', label: string, hint: string) => (
      <Box flexDirection="row" gap={1}>
        <Button
          key={`set-${field}`}
          variant={o[field] ? 'primary' : 'secondary'}
          label={o[field] ? '◉ On ' : '○ Off'}
          onPress={() => setOption(field, !o[field])}
        />
        <Text wrap="truncate-end">
          {label} <Text dimColor>· {hint}</Text>
        </Text>
      </Box>
    )
    const settingsBox = v.isSettingsOpen && (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text weight="semibold">⚙ Settings</Text>
          <Button key="settings-close" plain dimColor label="✕" onPress={() => setView(x => ({ ...x, isSettingsOpen: false, settingsNote: null }))} />
        </Box>
        {toggle('autoOpen', 'Open automatically', 'when a session starts')}
        {toggle('animations', 'Animations', 'off draws everything still')}
        <Box flexDirection="row" gap={1}>
          <Button key="set-history-less" label="−" onPress={() => setOption('historySize', Math.max(1, o.historySize - 1))} />
          <Text tabular>{String(o.historySize).padStart(2)}</Text>
          <Button key="set-history-more" label="+" onPress={() => setOption('historySize', Math.min(50, o.historySize + 1))} />
          <Text wrap="truncate-end">
            Sessions kept <Text dimColor>· in the HTML report</Text>
          </Text>
        </Box>
        <Text>
          Report folder <Text dimColor>· {o.reportFolder ? 'custom' : 'default'}</Text>
        </Text>
        {Input ? (
          <Input
            key="set-reportFolder"
            value={o.reportFolder}
            placeholder="~/.claude/activity-reports"
            submitLabel="save"
            onSubmit={(value: string) => setOption('reportFolder', value.trim())}
          />
        ) : (
          <Text dimColor wrap="truncate-start">
            {o.reportFolder || '~/.claude/activity-reports'}
          </Text>
        )}
        {o.reportFolder !== '' && <Button key="set-reportFolder-reset" plain dimColor label="use default folder" onPress={() => setOption('reportFolder', '')} />}
        {v.settingsNote && <Text color="error">{v.settingsNote}</Text>}
      </Box>
    )

    const summaryBox = v.summary && (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text weight="semibold">Summary</Text>
          <Button key="summary-close" plain dimColor label="✕" onPress={() => setView(x => ({ ...x, summary: null }))} />
        </Box>
        <Text>{v.summary}</Text>
      </Box>
    )

    // The filter row: one line. Icon buttons for the kinds that occur (pressing the active one
    // clears it), one button that cycles through the agents, the file in use, and a reset.
    const KINDS: Kind[] = ['write', 'run', 'read', 'web', 'agent', 'other']
    const kindsSeen = KINDS.filter(k => k === f.kind || d.events.some(x => x.kind === k))
    const agentCycle = ['all', 'main', ...d.agents.map(a => a.id)]
    const agentLabel = f.agent === 'all' ? 'everyone' : f.agent === 'main' ? 'main' : cut(agentName(f.agent), 14)
    const filters = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {kindsSeen.map(k => (
          <Button
            key={`fk-${k}`}
            variant={f.kind === k ? 'primary' : 'secondary'}
            dimColor={f.kind !== k}
            label={ICON[k]}
            onPress={() => setFilter({ kind: f.kind === k ? 'all' : k })}
          />
        ))}
        {f.kind === 'issues' && <Button key="fk-issues" variant="primary" label="⚠ issues ✕" onPress={() => setFilter({ kind: 'all' })} />}
        {d.agents.length > 0 && (
          <Button
            key="fa-cycle"
            variant={f.agent === 'all' ? 'secondary' : 'primary'}
            dimColor={f.agent === 'all'}
            label={`👤 ${agentLabel} ▾`}
            onPress={() => setFilter({ agent: agentCycle[(agentCycle.indexOf(f.agent) + 1) % agentCycle.length] ?? 'all' })}
          />
        )}
        {f.file !== '' && <Button key="ff" variant="primary" label={`${cut(base(f.file), 16)} ✕`} onPress={() => setFilter({ file: '' })} />}
        {isFiltered && <Button key="f-reset" plain dimColor label="reset" onPress={() => setFilter({ agent: 'all', kind: 'all', file: '' })} />}
      </Box>
    )

    // What the filter picked, for the Timeline header: actions, their tokens, their share of all.
    const shownTokens = shown.reduce((n, x) => n + (x.tokens || 0), 0)

    // Rows, newest first. A run of the same tool by the same agent folds into one row (×N), unless
    // one of them failed, was risky or is still running: those always get a row of their own.
    type Row = { lead: Ev; members: Ev[]; tokens: number; places: string[] }
    const rowsAll: Row[] = []
    for (const x of [...shown].reverse()) {
      const last = rowsAll.at(-1)
      const isPlain = (y: Ev) => y.state === 'done' && !y.isRisky
      if (last && isPlain(x) && isPlain(last.lead) && last.lead.tool === x.tool && last.lead.agentId === x.agentId) {
        last.members.push(x)
        last.tokens += x.tokens || 0
        if (x.file && !last.places.includes(base(x.file))) last.places.push(base(x.file))
      } else {
        rowsAll.push({ lead: x, members: [x], tokens: x.tokens || 0, places: x.file ? [base(x.file)] : [] })
      }
    }
    const rows = rowsAll.slice(0, v.sizes.timeline)
    // The header counts actions; it says so when folding or the size limit shows fewer rows.
    const timelineTitle = `Timeline · ${shown.length} action${shown.length === 1 ? '' : 's'}${
      rowsAll.length > rows.length ? ` (${rows.length} rows shown)` : ''
    }${isFiltered ? ` · Σ ${kilo(shownTokens)} tokens${allTokens ? ` · ${Math.round((shownTokens / allTokens) * 100)}%` : ''}` : ''}`
    const rowWidth = Math.max(24, (isWide ? cols - 38 : cols) - 2)

    // A row opened in place: one action's details (its diff, command, output), or the actions folded into it.
    const opened = (row: Row) => {
      const x = row.lead
      if (row.members.length > 1) {
        return (
          <Box flexDirection="column" paddingLeft={2} width={rowWidth}>
            {row.members.map(m => (
              <Text dimColor wrap="truncate-end">
                {clock(m.ts)} {m.summary} {stateMark(m)}
                {m.tokens ? ` ${kilo(m.tokens)}` : ''}
              </Text>
            ))}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" paddingLeft={2} width={rowWidth}>
          <Text dimColor wrap="truncate-end">
            {clock(x.ts)} · {agentName(x.agentId)} {badge(x.model)}
            {x.tokens ? ` · ${kilo(x.tokens)} tokens` : ''}
          </Text>
          {x.isRisky && <Text color="error">⚠ Risky action: deletes, sends, publishes or force-changes something.</Text>}
          {x.state === 'blocked' && <Text color="error">⛔ Blocked: the agent was stopped from the dashboard.</Text>}
          {detail(x.detail.slice(0, 12))}
        </Box>
      )
    }

    const timelineRows = (
      <Box flexDirection="column" flexGrow={1}>
        {filters}
        {shown.length === 0 && <Text dimColor>{d.events.length === 0 ? 'Nothing yet: actions appear here as soon as I start working.' : 'No actions match.'}</Text>}
        {rows.map((row, i) => {
          const x = row.lead
          const isNewest = i === 0 && now - x.ts < 3000
          const isSelected = v.selected === x.id
          const prevAgent = i === 0 ? null : rows[i - 1]!.lead.agentId ?? MAIN
          const thisAgent = x.agentId ?? MAIN
          // The agent is named only where it changes, and the main loop only when it takes back over.
          const tag = prevAgent === thisAgent || (i === 0 && thisAgent === MAIN) ? '' : `${thisAgent === MAIN ? 'main' : cut(agentName(x.agentId), 10)} › `
          const tokens = row.tokens >= 1000 ? ` ${kilo(row.tokens)}` : ''
          const mark = stateMark(x)
          const time = clock(x.ts).slice(0, 5)
          const count = row.members.length
          // A folded row is named by its tool: the summary's first word works for built-ins (Read,
          // Edit...) but not for MCP tools ("get ×3"), which use the tool's own name.
          const verb = /^mcp__/.test(x.tool) ? tail(x.tool).replace(/_/g, ' ') : x.summary.split(' ')[0]
          const summary = count > 1 ? `${verb} ×${count}${row.places.length ? ` · ${row.places.join(', ')}` : ''}` : x.summary
          const room = Math.max(8, rowWidth - (time.length + 1 + 3 + tag.length + 2 + tokens.length + 2))
          const tone = isIssue(x) ? 'error' : isNewest ? KIND_COLOR[x.kind] : undefined

          return (
            <Box flexDirection="column">
              <Box width={rowWidth}>
                <Button key={`ev-${x.id}`} plain onPress={() => setView(y => ({ ...y, selected: y.selected === x.id ? null : x.id }))}>
                  <Text dimColor>{isSelected ? '▾' : '›'}</Text> <Text dimColor>{time}</Text> {ICON[x.kind]} {tag ? <Text color="merged">{tag}</Text> : ''}
                  <Text {...color(tone)} weight={isNewest || isSelected ? 'semibold' : 'regular'}>
                    {cut(summary, room)}
                  </Text>{' '}
                  <Text dimColor>
                    {mark}
                    {tokens}
                  </Text>
                </Button>
              </Box>
              {isSelected && opened(row)}
            </Box>
          )
        })}
      </Box>
    )

    const files = [...d.files].sort((p, q) => q.edits - p.edits || q.reads - p.reads).slice(0, 12)
    // Two files of one name from different folders get their folder in front.
    const shortPath = (p: string) => {
      const name = base(p)
      if (files.filter(o => base(o.path) === name).length < 2) return name
      const parts = p.split(/[\\/]/)
      return `${parts.at(-2) ?? ''}/${name}`
    }
    const fileList = (
      <Box flexDirection="column">
        {files.length === 0 && <Text dimColor>None yet.</Text>}
        {files.map(fl => (
          <Button key={`f-${fl.path}`} plain onPress={() => setFilter({ file: f.file === fl.path ? '' : fl.path })}>
            <Text {...color(fl.edits ? 'success' : undefined)}>{cut(shortPath(fl.path), 26)}</Text>{' '}
            <Text dimColor>
              R{fl.reads}
              {fl.edits ? ` E${fl.edits}` : ''}
            </Text>
          </Button>
        ))}
      </Box>
    )

    // A subagent's window, `width` columns wide so it never runs past the pane. Its buttons come
    // first on their row, so a long action can only push text out of view, never them.
    const agentWin = (ag: Agent, width: number) => {
      const isBig = v.expanded === ag.id
      // Newest first, like the main timeline.
      const mine = d.events.filter(x => x.agentId === ag.id).slice(-8).reverse()
      const tone = ag.status === 'running' ? 'success' : ag.status === 'done' ? 'subtle' : 'error'
      const took = span((ag.endedAt ?? now) - ag.startedAt)
      const inner = Math.max(10, width - 4)

      return (
        <Box flexDirection="column" borderStyle="round" borderColor={ag.status === 'running' ? 'merged' : 'subtle'} paddingX={1} width={width}>
          <Box flexDirection="row" gap={1} width={inner}>
            {Client ? (
              <Client
                key={`pulse-${ag.id}`}
                module="./pulse.tsx"
                props={{ state: ag.status, label: '', elapsedMs: (ag.endedAt ?? now) - ag.startedAt, ...still } satisfies PulseProps}
              />
            ) : (
              <Text color={tone}>
                {ag.status === 'running' ? '●' : ag.status === 'done' ? '✓' : '✗'} {ag.status} · {took}
              </Text>
            )}
            <Text wrap="truncate-end">
              🤖 <Text weight="semibold">{agentName(ag.id)}</Text> {badge(ag.model)} <Text dimColor>{ag.description}</Text>
            </Text>
          </Box>
          <Box flexDirection="row" gap={1} width={inner}>
            <Box flexDirection="row" gap={1}>
              {ag.status === 'running' && (
                <Button
                  key={`stop-${ag.id}`}
                  label="Stop"
                  onPress={() =>
                    update($, dash, x => ({
                      ...x,
                      agents: x.agents.map(y => (y.id === ag.id ? { ...y, status: 'stopped', current: 'Stopping…' } : y)),
                    }))
                  }
                />
              )}
              <Button
                key={`exp-${ag.id}`}
                dimColor
                label={isBig ? 'Less' : 'More'}
                onPress={() => setView(x => ({ ...x, expanded: x.expanded === ag.id ? null : ag.id }))}
              />
            </Box>
            <Text wrap="truncate-end">
              ▶ {ag.current} <Text dimColor>· {ag.tools} tools · {kilo(ag.tokens)} tok</Text>
            </Text>
          </Box>
          {/* The same preview the main loop has, smaller, while the agent works. */}
          {Client && ag.status === 'running' && (
            <Box borderStyle="round" borderColor="merged" paddingX={1} width={inner}>
              <Client key={typerKey(ag.id)} module="./typer.tsx" props={typerProps(v, ag.id)} width={Math.max(8, inner - 4)} height={AGENT_ROWS} />
            </Box>
          )}
          {isBig &&
            mine.map(x => (
              <Text dimColor wrap="truncate-end" {...color(isIssue(x) ? 'error' : undefined)}>
                {clock(x.ts)} {ICON[x.kind]} {x.summary} {stateMark(x)}
              </Text>
            ))}
          {isBig && ag.answer && <Text wrap="wrap">↩ {ag.answer}</Text>}
        </Box>
      )
    }

    // The agent tree: the main loop at the root, each subagent under the agent that started it,
    // newest first. Running agents always make the cut of 8, so none that counts as running hides.
    const byNewest = [...d.agents].sort((p, q) => q.startedAt - p.startedAt)
    const recent = [...byNewest.filter(a => a.status === 'running'), ...byNewest.filter(a => a.status !== 'running')].slice(0, 8)
    const ids = new Set(recent.map(a => a.id))
    const childrenOf = (parent?: string) =>
      recent.filter(a => (parent === undefined ? a.parentId === undefined || !ids.has(a.parentId) : a.parentId === parent)).sort((p, q) => q.startedAt - p.startedAt)
    const treeRows = (parent: string | undefined, lead: string): unknown[] =>
      childrenOf(parent).flatMap((ag, i, all) => {
        const isLast = i === all.length - 1
        return [
          <Box flexDirection="row">
            <Text dimColor mono>
              {lead}
              {isLast ? '└─ ' : '├─ '}
            </Text>
            {agentWin(ag, Math.max(24, cols - lead.length - 3))}
          </Box>,
          ...treeRows(ag.id, `${lead}${isLast ? '   ' : '│  '}`),
        ]
      })
    const running = runningAgents(d)
    // With the section collapsed (or in compact mode), one line still says what the running agents do.
    const agentsLine = running > 0 && (
      <Text wrap="truncate-end">
        {d.agents
          .filter(a => a.status === 'running')
          .map((a, i) => (
            <Text>
              {i > 0 ? <Text dimColor> · </Text> : '🤖 '}
              <Text color="merged">{agentName(a.id)}</Text> <Text dimColor>▶</Text> {cut(a.current, 40)}
            </Text>
          ))}
      </Text>
    )
    const agentTree = (
      <Box flexDirection="column">
        <Text>
          ◆ <Text weight="semibold">Main</Text> {badge(d.status.model)}
        </Text>
        {treeRows(undefined, '')}
      </Box>
    )

    if (v.isCompact) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {settingsBox}
          {previewBox}
          {agentsLine}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {settingsBox}
        {summaryBox}
        {previewBox && section('live', 'Preview', previewBox, 'live')}
        {d.agents.length > 0 && section('agents', `Agents${running ? ` · ${running} running` : ''}`, agentTree, undefined, agentsLine)}
        {isWide ? (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="column" flexGrow={1}>
              {section('timeline', timelineTitle, timelineRows, 'timeline')}
            </Box>
            <Box flexDirection="column" width={36} gap={1}>
              {section('files', 'Open files', fileList)}
              {d.browser && section('browser', 'Browser', browserBox(d.browser))}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {section('timeline', timelineTitle, timelineRows, 'timeline')}
            {section('files', 'Open files', fileList)}
            {d.browser && section('browser', 'Browser', browserBox(d.browser))}
          </Box>
        )}
      </Box>
    )
  })
}
