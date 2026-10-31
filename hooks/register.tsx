import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Ev, Live } from '../types'
import {
  afterLines,
  cut,
  describe,
  ICON,
  isRisky,
  keepAgent,
  kindOf,
  liveField,
  liveMode,
  liveOf,
  LIVE_READ,
  outputOf,
  partialString,
  placeOf,
  STOPPED,
  str,
  trackBrowser,
  touchFile,
} from './describe'
import { registerPane } from './pane'
import { openHtml, saveHistory } from './report'
import {
  EMPTY,
  FRESH_VIEW,
  getOpts,
  IDLE_LIVE,
  LAYOUT,
  lives,
  liveOfLoop,
  loopOfKey,
  MAIN,
  MAX_EVENTS,
  norm,
  openPane,
  PANE,
  pushStatus,
  readOptions,
  setLive,
  setOpts,
  stepTokens,
  syncPaneOpen,
  typerProps,
} from './state'

// Declared here, not imported: the state scan only follows an atom written in the file that uses it.
// Same plugin and key as in state.ts, so the same state.
const dash = atom({ plugin: 'activity-dashboard', key: 'dash' } as const, EMPTY)
const view = atom({ plugin: 'activity-dashboard', key: 'view' } as const, FRESH_VIEW)

export const register: Register = (on, options) => {
  let seq = 0
  setOpts(readOptions(options ?? {}))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'activity', description: 'Open the live activity dashboard pane' })
    await $.command.register({ name: 'activity-open', description: 'Open the activity report in your browser' })
    const now = await $.clock.now()
    // Nothing can still be running when a session (re)starts: a turn whose end never arrived (an
    // interrupt, a reload mid-turn) would otherwise show as running forever. 'failed', not 'stopped',
    // so an agent that is in fact alive is not blocked; its next turn marks it running again.
    await update($, dash, d => ({
      ...d,
      startedAt: d.startedAt ?? now,
      status: { ...d.status, state: 'idle', label: 'Idle' },
      agents: d.agents.map(a => (a.status === 'running' ? { ...a, status: 'failed', current: 'Interrupted', endedAt: now } : a)),
    }))
    // Sizes, collapsed sections and compact mode are remembered across sessions.
    const layout = (await $.store.get(LAYOUT).catch(() => undefined)) as Partial<View> | undefined
    if (layout) await update($, view, v => norm({ ...norm(v), ...layout }))
    if (getOpts().autoOpen) void openPane($)
    else void syncPaneOpen($)
    void pushStatus($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'activity' }, async $ => {
    await openPane($)

    return { text: 'Activity dashboard opened.' }
  })

  on('command.run', { command: 'activity-open' }, async $ => {
    const path = await openHtml($)

    return { text: `Activity report opened: ${path}` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, view, v => ({ ...v, isPaneOpen: false }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const agentId = e.agentId
    await update($, dash, d =>
      agentId === undefined
        ? { ...d, status: { ...d.status, state: 'thinking', label: 'Thinking', turns: d.status.turns + 1, turnStartedAt: now } }
        : { ...d, agents: d.agents.map(a => (a.id === agentId && a.status !== 'stopped' ? { ...a, status: 'running' } : a)) },
    )
    void pushStatus($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Watches each response as it streams: which calls it asks for (to give them its tokens), and the
  // text it writes, for that loop's typing cursor (the main loop's or the subagent's).
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const loop = e.agentId ?? MAIN
    const toolIds: string[] = []
    if (isMain) {
      const model = e.model
      // Written only when it changed: every write redraws the pane.
      if ((await read($, dash)).status.model !== model)
        await update($, dash, d => ({ ...d, status: { ...d.status, model } })).catch(() => undefined)
    }

    const blocks = new Map<number, { id: string; name: string; json: string }>()
    const replies = new Map<number, string>()
    const send = (l: Live) => setLive(loop, l)
    const watch = (c: { kind: string; index?: number; text?: string; id?: string; name?: string; json?: string }) => {
      if (c.kind === 'tool' && c.id) toolIds.push(c.id)
      if (c.kind === 'thinking') send({ ...IDLE_LIVE, id: `think-${e.turnId}-${e.index}`, mode: 'think', isDone: false })
      else if (c.kind === 'text' && c.index !== undefined) {
        const text = (replies.get(c.index) ?? '') + (c.text ?? '')
        replies.set(c.index, text)
        send(liveOf(`reply-${e.turnId}-${e.index}-${c.index}`, 'reply', '', '', text, false))
      } else if (c.kind === 'tool' && c.index !== undefined && c.id && c.name) {
        blocks.set(c.index, { id: c.id, name: c.name, json: '' })
        const mode = liveMode(c.name)
        if (mode) send(liveOf(c.id, mode, '', '', '', false, c.name), true)
      } else if (c.kind === 'input' && c.index !== undefined) {
        const b = blocks.get(c.index)
        if (!b) return
        b.json += c.json ?? ''
        const mode = liveMode(b.name)
        if (!mode) return
        const field = liveField(b.name, mode)
        send(
          liveOf(
            b.id,
            mode,
            placeOf(k => partialString(b.json, k)),
            mode === 'edit' ? partialString(b.json, 'old_string') : '',
            field ? partialString(b.json, field) : '',
            false,
            b.name,
          ),
        )
      }
    }

    const it = next(e)[Symbol.asyncIterator]()
    for (;;) {
      const r = await it.next()
      if (r.done) {
        // The step's own cost (what was not served from the cache), shared by the calls it asked for.
        // One definition everywhere: input + cache writes + output, never cache reads, counted per step
        // so the header and the agent windows grow while the work runs, not only at its end.
        const u = r.value?.usage
        if (u) {
          const fresh = u.input_tokens + u.cache_creation_input_tokens
          await update($, dash, d =>
            isMain
              ? { ...d, status: { ...d.status, tokensIn: d.status.tokensIn + fresh, tokensOut: d.status.tokensOut + u.output_tokens } }
              : { ...d, agents: d.agents.map(a => (a.id === e.agentId ? { ...a, tokens: a.tokens + fresh + u.output_tokens } : a)) },
          ).catch(() => undefined)
        }
        if (u && toolIds.length) {
          const each = Math.round((u.input_tokens + u.cache_creation_input_tokens + u.output_tokens) / toolIds.length)
          for (const id of toolIds) stepTokens.set(id, each)
          while (stepTokens.size > 500) stepTokens.delete(stepTokens.keys().next().value as string)
          // A call can start before its response has ended: give the ones already recorded their share now.
          try {
            if ((await read($, dash)).events.some(x => toolIds.includes(x.id) && !x.tokens))
              await update($, dash, d => ({
                ...d,
                events: d.events.map(x => (toolIds.includes(x.id) && !x.tokens ? { ...x, tokens: each } : x)),
              }))
          } catch {
            // Tokens are a nicety; the stream's result matters more.
          }
        }
        return r.value
      }
      try {
        watch(r.value as Parameters<typeof watch>[0])
      } catch {
        // The dashboard never gets in the way of the stream.
      }
      yield r.value
    }
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const agentId = e.agentId
    // Tokens were counted step by step in turn.step; here only the outcome is recorded.
    await update($, dash, d =>
      agentId === undefined
        ? { ...d, status: { ...d.status, state: 'idle', label: 'Idle' } }
        : {
            ...d,
            agents: d.agents.map(a => {
              if (a.id !== agentId) return a
              const status = a.status === 'stopped' ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
              const current = status === 'done' ? 'Finished' : status === 'stopped' ? 'Stopped' : e.isAborted ? 'Interrupted' : 'Failed'
              return { ...a, status, endedAt: now, answer: cut(e.answer, 300), current }
            }),
          },
    )
    setLive(agentId ?? MAIN, { ...IDLE_LIVE, id: `idle-${e.turnId}` })
    if (agentId === undefined) void saveHistory($).catch(() => undefined)
    void pushStatus($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const agentId = r.deny === undefined ? r.agentId : undefined
    if (agentId !== undefined && r.deny === undefined) {
      const now = await $.clock.now()
      const agent: Agent = {
        id: agentId,
        ...(e.parentAgentId === undefined ? {} : { parentId: e.parentAgentId }),
        description: cut(e.description, 80),
        type: e.subagentType,
        model: r.model,
        status: 'running',
        startedAt: now,
        tools: 0,
        tokens: 0,
        current: 'Starting',
      }
      await update($, dash, d => ({ ...d, agents: keepAgent(d.agents, agent) }))
      void pushStatus($)
    }

    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const a = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const agentId = e.agentId
    const now = await $.clock.now()
    // Unique across reloads too, which reset `seq`.
    const id = e.tool_use_id ?? `local-${now}-${++seq}`
    let d0 = await read($, dash)
    // A subagent can act before its spawn has been recorded: keep a stub for it that the spawn fills in.
    if (agentId !== undefined && !d0.agents.some(x => x.id === agentId)) {
      const stub: Agent = { id: agentId, description: '', type: 'agent', model: '', status: 'running', startedAt: now, tools: 0, tokens: 0, current: '' }
      await update($, dash, d => (d.agents.some(x => x.id === agentId) ? d : { ...d, agents: keepAgent(d.agents, stub) }))
      d0 = await read($, dash)
    }
    const agent = agentId === undefined ? undefined : d0.agents.find(x => x.id === agentId)
    const kind = kindOf(tool)
    const info = describe(tool, a)
    const block = agent?.status === 'stopped' ? STOPPED : undefined
    const ev: Ev = {
      id,
      ts: now,
      tool,
      kind,
      ...(agentId === undefined ? {} : { agentId }),
      model: agent?.model ?? d0.status.model,
      summary: info.summary,
      ...(info.file ? { file: info.file } : {}),
      detail: info.detail,
      isRisky: isRisky(tool, a),
      state: block ? 'blocked' : 'running',
      tokens: stepTokens.get(id) ?? 0,
    }
    stepTokens.delete(id)

    await update($, dash, d => ({
      ...d,
      events: [...d.events, ev].slice(-MAX_EVENTS),
      // A blocked call never ran: it touches no file and counts as no tool.
      files: info.file && !block ? touchFile(d.files, info.file, kind) : d.files,
      browser: block ? d.browser : trackBrowser(d.browser, tool, a),
      agents: block ? d.agents : d.agents.map(x => (x.id === agentId ? { ...x, tools: x.tools + 1, current: info.summary } : x)),
      status: agentId === undefined && !block ? { ...d.status, state: 'tool', label: info.summary } : d.status,
    }))
    void pushStatus($)

    const loop = agentId ?? MAIN
    const mode = liveMode(tool)
    if (block) {
      // The preview stops on it rather than staying on "Writing…" for a call that will never run.
      setLive(loop, l => (l.id === id ? { ...l, isDone: true, isError: true, output: block } : l))
      return { deny: block }
    }

    if (mode) {
      // A call the stream did not show (a subagent's, or one with no stream): animate it from its arguments.
      if (liveOfLoop(loop).id !== id) {
        const field = liveField(tool, mode)
        setLive(loop, liveOf(id, mode, placeOf(k => str(a[k])), mode === 'edit' ? str(a.old_string) : '', field ? str(a[field]) : '', false, tool))
      }
    } else {
      // A tool with no animation of its own (an agent, an MCP tool...): the preview names it instead
      // of still showing the previous action as current.
      setLive(loop, { ...IDLE_LIVE, id, mode: 'idle', text: `${ICON[kind]} ${info.summary}`, isDone: false, tool })
    }

    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    // A read's text is what came back: the typer skims it at speed.
    const readText = mode === 'read' && !failed ? (ran.text ?? '').slice(0, LIVE_READ) : undefined
    const output = mode ? outputOf(mode, ran.deny ?? ran.text ?? '') : ''
    if (mode)
      setLive(loop, l =>
        l.id !== id
          ? l
          : readText === undefined
            ? { ...l, isDone: true, output, isError: failed }
            : { ...l, text: readText, offset: 0, isDone: true },
      )
    const extra = afterLines(tool, ran.text ?? '', failed, ran.deny)
    await update($, dash, d => ({
      ...d,
      events: d.events.map(x => (x.id === id ? { ...x, state: failed ? 'error' : 'done', detail: [...x.detail, ...extra] } : x)),
      status: agentId === undefined && d.status.state === 'tool' ? { ...d.status, state: 'thinking', label: 'Thinking' } : d.status,
    }))
    void pushStatus($)

    // Only a denial pops up: failures already stand out in red in the timeline and the ⚠ counter.
    if (ran.deny !== undefined) $.ui.toast(`Denied: ${agent ? `${agent.type}: ` : ''}${info.summary}`)

    return ran
  }).catch(($, e, next) => next(e))

  // A typer asks for what to show; it is answered only when its loop's text changed.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'typer' && !e.element.startsWith('typer-')) return next(e)
    const loop = loopOfKey(e.element)
    const seen = (e.data as { ver?: unknown } | null)?.ver
    if (seen === (lives.get(loop)?.ver ?? 0)) return {}

    return { props: typerProps(norm(await read($, view)), loop) }
  })

  // A pane opened at session start is often placed only once a screen attaches, after `ui.open`
  // answered "not placed": look again then, so the band knows the pane is showing.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await syncPaneOpen($)

    return r
  }).catch(($, e, next) => next(e))


  registerPane(on)
}
