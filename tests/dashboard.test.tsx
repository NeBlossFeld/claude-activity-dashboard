import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'activity-dashboard',
  component: 'Pane',
  requestId: 'activity',
  props: {
    title: 'Activity',
    isFocused: false,
    bodyColumns: 110,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// The id the engine stand-in last saw a tool call run under.
let lastToolId = ''
// How many times the plugin asked to open its pane, and the last status line it set.
let opens = 0
let lastStatus = ''

const engine = (on: Parameters<Parameters<typeof test>[1]>[1], env: Record<string, string> = { USERPROFILE: 'C:\\Users\\me' }) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  mock.env(on, env)
  opens = 0
  lastStatus = ''
  on('ui.status', (_, e) => ((lastStatus = (e as unknown as { text: string }).text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => (opens++, { value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => ({
    ...((lastToolId = e.tool_use_id ?? ''), {}),
    result: {},
    text:
      e.tool === 'Bash'
        ? 'line one\nline two'
        : e.tool === 'Grep'
          ? 'a.lua:1:hit one\na.lua:2:hit two\nb.lua:9:hit three'
          : e.tool === 'WebSearch'
            ? (e as unknown as { query?: string }).query === 'plugins docs'
            ? 'Web search results for query: "plugins docs"\n\nLinks: [{"title":"Plugins reference","url":"https://code.claude.com/docs/en/plugins-reference"},{"title":"Claude Code plugins","url":"https://anthropic.com/news/claude-code-plugins"}]\n\nPlugins let you extend Claude Code with commands and hooks.'
            : 'Result A\nResult B'
        : e.tool === 'Read'
          ? Array.from({ length: 80 }, (_, i) => `${i + 1}\tline number ${i + 1}`).join('\n')
          : '',
  }))
}

test('the pane shows edits, risky commands and the browser box', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/p/game.lua', old_string: 'local hp = 100', new_string: 'local hp = MAX_HP' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  await $.tool.call({
    tool: 'mcp__Claude_Browser__computer',
    action: 'left_click',
    coordinate: [640, 400],
    action_summary: 'Opens the Filters menu',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Edit game\.lua/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Risky action/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Opens the Filters menu/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /game\.lua/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Open HTML writes the report and opens it in the browser', async ($, on) => {
  engine(on)
  const written: string[] = []
  const ran: string[][] = []
  on('session.cwd', () => ({ value: 'C:\\proj' }))
  on('fs.write', (_, e) => (written.push(e.path), { value: undefined }))
  on('process.run', (_, e) => (
    ran.push([...e.argv]),
    { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  ))
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-html' })
  expect(written[0]).toMatch(/^C:\\Users\\me\\\.claude\\activity-reports\\claude-activity-.*\.html$/)
  expect(ran[0]?.[0]).toBe('rundll32')
  expect(ran[0]?.[2]).toBe(written[0])
  await ui.unmount()
})

test('the typing cursor types new text in word by word', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/p/notes.md', content: 'alpha beta gamma delta epsilon zeta eta theta' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Writing notes\.md/, in: 'typer' })).toBeDefined()
  await ui.advance(40)
  expect(await ui.find({ type: 'Text', text: /theta/, in: 'typer' })).toBeUndefined()
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /theta/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /done/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('an edit backspaces the old text before typing the new', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/p/game.lua', old_string: 'local hp = 100', new_string: 'local hp = MAX_HP' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.advance(40)
  expect(await ui.find({ type: 'Text', text: /removing old text/, in: 'typer' })).toBeDefined()
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /MAX_HP/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('a read skims the file past a scan bar', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/big.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', text: /Reading big\.lua/, in: 'typer' })).toBeDefined()
  await ui.advance(3000)
  expect(await ui.find({ type: 'Text', text: /Read big\.lua · 80 lines/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('a command runs in the mini terminal and lands an exit badge', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /npm test/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /line two/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ exit 0/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('the typer picks up new text without a pane redraw', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Write', file_path: '/p/late.md', content: 'arrives after the pane drew' })
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Writing late\.md/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /arrives after the pane drew/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('a streamed reply gives its tokens to a call that already started', async ($, on) => {
  // The engine's stream beneath: the reply asks for that call, then ends with its usage.
  on('turn.step', async function* (_, e) {
    yield { kind: 'tool', index: 0, id: lastToolId, name: 'Read' }
    yield { kind: 'input', index: 0, json: '{"file_path":"/p/early.lua"}' }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: { model: 'claude-opus', input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50000, cache_creation_input_tokens: 300 },
    }
  })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/early.lua' })
  const id = lastToolId
  expect(id).not.toBe('')
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus', messageCount: 3 } as never)
  for await (const _ of stream) {
    // drain
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1\.5k/ })).toBeDefined()
  await ui.unmount()
})

test('a filter chip narrows the timeline', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'fk-run' })
  expect(await ui.find({ type: 'Text', text: /Read one\.lua/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Timeline/ })).toBeDefined()
  await ui.unmount()
})

test('a grep sweeps then lands its hits', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Grep', pattern: 'hit', path: '/p' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Searching "hit"/, in: 'typer' })).toBeDefined()
  await ui.advance(3000)
  expect(await ui.find({ type: 'Text', text: /✓ 3 hits/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('a web search drops its results in', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'WebSearch', query: 'lua tables' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(3000)
  expect(await ui.find({ type: 'Text', text: /lua tables/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Result B/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ 2 results/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('sections collapse one by one and all at once', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeDefined()
  await ui.press({ key: 'sec-timeline' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▸ Timeline/ })).toBeDefined()
  await ui.press({ key: 'sec-timeline' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeDefined()
  await ui.press({ key: 'collapse-all' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'fk-read' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /▸ All/ })).toBeDefined()
  await ui.press({ key: 'collapse-all' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'fk-read' })).toBeDefined()
  await ui.unmount()
})

test('the timeline size buttons change how many rows show', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Alternating tools, so nothing folds into a ×N row.
  for (let i = 0; i < 30; i++)
    await (i % 2 ? $.tool.call({ tool: 'Bash', command: `echo ${i}` }) : $.tool.call({ tool: 'Read', file_path: `/p/f${i}.lua` }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rows = async () => (await ui.findAll({ type: 'Button', text: /Read f\d+\.lua|Run echo \d+/ })).length
  expect(await rows()).toBe(20)
  await ui.press({ key: 'sz-timeline-less' })
  expect(await rows()).toBe(15)
  await ui.press({ key: 'sz-timeline-more' })
  await ui.press({ key: 'sz-timeline-more' })
  expect(await rows()).toBe(25)
  await ui.unmount()
})

test('compact keeps only the header and the live box', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'fk-read' })).toBeDefined()
  await ui.press({ key: 'compact' })
  expect(await ui.find({ type: 'Button', key: 'fk-read' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Timeline/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'open-html' })).toBeDefined()
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', text: /Reading one\.lua/, in: 'typer' })).toBeDefined()
  await ui.press({ key: 'compact' })
  expect(await ui.find({ type: 'Button', key: 'fk-read' })).toBeDefined()
  await ui.unmount()
})

test('consecutive reads of the same tool fold into one x N row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/p/${f}.lua` })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Button', text: /Read ×3/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Button', text: /Read one|Read a\.lua/ })).toBeUndefined()
  await ui.unmount()
})

test('a web search with links shows titles, hosts and the result count', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'WebSearch', query: 'plugins docs' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(3000)
  expect(await ui.find({ type: 'Text', text: /Plugins reference/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /code\.claude\.com/, in: 'typer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ 2 results/, in: 'typer' })).toBeDefined()
  await ui.unmount()
})

test('npm publish --force is flagged as risky', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm publish --force' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /⚠ Risky action/ })).toBeUndefined()
  await ui.press({ key: `ev-${lastToolId}` })
  expect(await ui.find({ type: 'Text', text: /⚠ Risky action/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call from an unknown agent adds a stub agent window', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Read', file_path: '/p/ghost.lua', agentId: 'ghost' })
  expect(ran.deny).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'stop-ghost' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◆ Main/ })).toBeDefined()
  await ui.unmount()
})

test('a browser click with non-numeric coordinates does not break the pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__Claude_Browser__computer',
    action: 'left_click',
    coordinate: ['a', 'b'] as never,
    action_summary: 'Clicks nowhere',
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Clicks nowhere/ })).toBeDefined()
  await ui.unmount()
})

test('the agent button cycles the agent filter', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'look around', description: 'Look around', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Read', file_path: '/p/main.lua' })
  await $.tool.call({ tool: 'Grep', pattern: 'spawn', agentId: 'ag1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const read = async () => (await ui.find({ type: 'Button', text: /Read main\.lua/ })) !== undefined
  const grep = async () => (await ui.find({ type: 'Button', text: /Search "spawn"/ })) !== undefined
  expect([await read(), await grep()]).toEqual([true, true])
  await ui.press({ key: 'fa-cycle' })
  expect(await ui.find({ type: 'Button', key: 'fa-cycle', text: /main/ })).toBeDefined()
  expect([await read(), await grep()]).toEqual([true, false])
  await ui.press({ key: 'fa-cycle' })
  expect(await ui.find({ type: 'Button', key: 'fa-cycle', text: /Explore/ })).toBeDefined()
  expect([await read(), await grep()]).toEqual([false, true])
  await ui.press({ key: 'fa-cycle' })
  expect(await ui.find({ type: 'Button', key: 'fa-cycle', text: /everyone/ })).toBeDefined()
  expect([await read(), await grep()]).toEqual([true, true])
  await ui.unmount()
})

test('a kind filter shows a usage line', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Σ/ })).toBeUndefined()
  await ui.press({ key: 'fk-run' })
  expect(await ui.find({ type: 'Text', text: /Timeline · 1 action.*Σ 0 tokens/ })).toBeDefined()
  await ui.unmount()
})

test('subagents hang under Main in a tree', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'look around', description: 'Look around', subagentType: 'Explore' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /◆ Main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /└─/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
  await ui.unmount()
})

test('the agents section collapses, and keeps one line for running agents', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'look around', description: 'Look around', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'spawn', agentId: 'ag1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(500)
  await ui.press({ key: 'sec-agents' })
  expect(await ui.find({ type: 'Text', text: /◆ Main/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▸ Agents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Search "spawn"/ })).toBeDefined()
  await ui.press({ key: 'sec-agents' })
  expect(await ui.find({ type: 'Text', text: /◆ Main/ })).toBeDefined()
  await ui.unmount()
})

test('Open HTML saves the session to history and the report lists it', async ($, on) => {
  engine(on)
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => (kept.set(e.key, e.value), { value: undefined }))
  const html: string[] = []
  on('session.cwd', () => ({ value: 'C:\\proj' }))
  on('fs.write', (_, e) => (html.push(e.text), { value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-html' })
  const past = kept.get('history') as unknown[]
  expect(past).toHaveLength(1)
  expect(html[0]).toContain('Claude activity report')
  await ui.unmount()
})

test('a subagent window has its own live typer', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'write', description: 'Write', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Write', file_path: '/p/agent.md', content: 'subagent writes this', agentId: 'ag1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Writing agent\.md/, in: 'typer-ag1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /subagent writes this/, in: 'typer-ag1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /subagent writes this/, in: 'typer' })).toBeUndefined()
  await ui.unmount()
})

test('a subagent streamed reply updates its own typer', async ($, on) => {
  on('turn.step', async function* (_, e) {
    yield { kind: 'tool', index: 0, id: 'toolu_sub', name: 'Edit' }
    yield {
      kind: 'input',
      index: 0,
      json: '{"file_path":"/p/sub.lua","old_string":"old body","new_string":"streamed replacement"}',
    }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: { model: 'claude-haiku-4', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'edit', description: 'Edit', subagentType: 'Explore' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const stream = $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-4', messageCount: 1, agentId: 'ag1' } as never)
  for await (const _ of stream) {
    // drain
  }
  await ui.advance(2000)
  await ui.advance(2000)
  expect(await ui.find({ type: 'Text', text: /streamed replacement/, in: 'typer-ag1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /streamed replacement/, in: 'typer' })).toBeUndefined()
  await ui.unmount()
})

test('the issues button filters to the risky call and opens its details', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  const riskyId = lastToolId
  await $.tool.call({ tool: 'Grep', pattern: 'hit', path: '/p' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'issues', text: /⚠ 1 new/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠ Risky action/ })).toBeUndefined()
  await ui.press({ key: 'issues' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Search "hit"/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `ev-${riskyId}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠ Risky action/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'issues', text: /^⚠ 1$/ })).toBeDefined()
  // Pressing it again clears the filter.
  await ui.press({ key: 'issues' })
  expect(await ui.find({ type: 'Button', text: /Read one\.lua/ })).toBeDefined()
  await ui.unmount()
})

test('pressing a timeline row opens its details inline', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/p/game.lua', old_string: 'local hp = 100', new_string: 'local hp = MAX_HP' })
  const id = lastToolId
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^\+ local hp = MAX_HP/ })).toBeUndefined()
  await ui.press({ key: `ev-${id}` })
  expect(await ui.find({ type: 'Text', text: /^\+ local hp = MAX_HP/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- local hp = 100/ })).toBeDefined()
  await ui.press({ key: `ev-${id}` })
  expect(await ui.find({ type: 'Text', text: /^\+ local hp = MAX_HP/ })).toBeUndefined()
  await ui.unmount()
})

test('a folded row lists its members when pressed', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ids: string[] = []
  for (const f of ['a', 'b', 'c']) {
    await $.tool.call({ tool: 'Read', file_path: `/p/${f}.lua` })
    ids.push(lastToolId)
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Read b\.lua/ })).toBeUndefined()
  // The lead of a folded row is the newest call.
  await ui.press({ key: `ev-${ids[2]}` })
  for (const f of ['a', 'b', 'c']) expect(await ui.find({ type: 'Text', text: new RegExp(`Read ${f}\\.lua`) })).toBeDefined()
  await ui.unmount()
})

test('autoOpen off does not open the pane at session start', { options: { autoOpen: false } }, async ($, on) => {
  engine(on)
  on('ui.panes', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(0)
})

test('autoOpen on (the default) opens the pane at session start', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(1)
})

test('animations off draws the main preview still', { options: { animations: false } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/p/notes.md', content: 'alpha beta gamma delta epsilon zeta eta theta' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(200)
  // The pulse shows a fixed dot, not a spinner frame.
  expect(await ui.find({ type: 'Text', text: /●/, in: 'pulse-main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, in: 'pulse-main' })).toBeUndefined()
  await ui.unmount()
})

test('animations on (the default) spin the pulse', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/p/notes.md', content: 'alpha beta gamma delta epsilon zeta eta theta' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', text: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, in: 'pulse-main' })).toBeDefined()
  await ui.unmount()
})

test('the status says waiting on agents when main is idle but an agent runs', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'look around', description: 'Look around', subagentType: 'Explore' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(100)
  expect(lastStatus).toBe('◌ Waiting on 1 agent')
  await ui.unmount()
})

test('two agents of the same type are told apart by number', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-4', agentId: `ag${++n}` }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'one', description: 'First', subagentType: 'Explore' })
  await $.agent.spawn({ prompt: 'two', description: 'Second', subagentType: 'Explore' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Explore#2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore#3/ })).toBeUndefined()
  await ui.unmount()
})

test('the report goes under the home folder when no report folder is set', async ($, on) => {
  engine(on, { HOME: '/home/me' })
  const written: string[] = []
  on('fs.write', (_, e) => (written.push(e.path), { value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-html' })
  // The test kit may put a drive letter in front of a rooted path on Windows.
  expect(written[0]).toMatch(/^(C:)?[\\/]home[\\/]me[\\/]\.claude[\\/]activity-reports[\\/]claude-activity-.*\.html$/)
  await ui.unmount()
})

test('the report goes under the report folder setting when set', { options: { reportFolder: 'D:\\reports\\' } }, async ($, on) => {
  engine(on)
  const written: string[] = []
  on('fs.write', (_, e) => (written.push(e.path), { value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/one.lua' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-html' })
  expect(written[0]).toMatch(/^D:\\reports\\claude-activity-.*\.html$/)
  await ui.unmount()
})

type SetCall = { key: string; value: unknown }
// Stand-ins for the /config rows; `deny` makes every config.set refuse.
const settings = (on: Parameters<Parameters<typeof test>[1]>[1], deny?: string) => {
  const calls: SetCall[] = []
  on('config.list', () => ({
    value: ['autoOpen', 'animations', 'historySize', 'reportFolder'].map(f => ({ key: `activity-dashboard.${f}`, label: f })) as never,
  }))
  on('config.set', (_, e) => {
    calls.push({ key: e.key, value: e.value })
    return deny === undefined ? { value: e.value } : { deny }
  })
  return calls
}

test('the gear button opens the settings panel and the cross closes it', async ($, on) => {
  engine(on)
  settings(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'settings', text: /⚙/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚙ Settings/ })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /⚙ Settings/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set-animations' })).toBeDefined()
  await ui.press({ key: 'settings-close' })
  expect(await ui.find({ type: 'Text', text: /⚙ Settings/ })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /⚙ Settings/ })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /⚙ Settings/ })).toBeUndefined()
  await ui.unmount()
})

test('turning animations off in the panel saves it and stills the pulse', async ($, on) => {
  engine(on)
  const calls = settings(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/p/notes.md', content: 'alpha beta gamma delta epsilon zeta eta theta' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: 'set-animations', text: /◉ On/ })).toBeDefined()
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', text: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, in: 'pulse-main' })).toBeDefined()
  await ui.press({ key: 'set-animations' })
  expect(calls).toEqual([{ key: 'activity-dashboard.animations', value: false }])
  expect(await ui.find({ type: 'Button', key: 'set-animations', text: /○ Off/ })).toBeDefined()
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', text: /●/, in: 'pulse-main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, in: 'pulse-main' })).toBeUndefined()
  await ui.unmount()
})

test('the sessions kept buttons step by one and stop at 1 and 50', { options: { historySize: 1 } }, async ($, on) => {
  engine(on)
  const calls = settings(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set-history-less' })
  await ui.press({ key: 'set-history-more' })
  expect(calls).toEqual([
    { key: 'activity-dashboard.historySize', value: 1 },
    { key: 'activity-dashboard.historySize', value: 2 },
  ])
  await ui.press({ key: 'set-history-less' })
  expect(calls[2]).toEqual({ key: 'activity-dashboard.historySize', value: 1 })
  await ui.unmount()
})

test('the sessions kept + button stops at 50', { options: { historySize: 50 } }, async ($, on) => {
  engine(on)
  const calls = settings(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set-history-more' })
  expect(calls).toEqual([{ key: 'activity-dashboard.historySize', value: 50 }])
  await ui.press({ key: 'set-history-less' })
  expect(calls[1]).toEqual({ key: 'activity-dashboard.historySize', value: 49 })
  expect(typeof calls[1]?.value).toBe('number')
  await ui.unmount()
})

test('the report folder input saves the trimmed path and reset clears it', async ($, on) => {
  engine(on)
  const calls = settings(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: 'set-reportFolder-reset' })).toBeUndefined()
  await ui.input({ key: 'set-reportFolder', text: '  D:\\out  ' })
  expect(calls).toEqual([{ key: 'activity-dashboard.reportFolder', value: 'D:\\out' }])
  expect(await ui.find({ type: 'Button', key: 'set-reportFolder-reset' })).toBeDefined()
  await ui.press({ key: 'set-reportFolder-reset' })
  expect(calls[1]).toEqual({ key: 'activity-dashboard.reportFolder', value: '' })
  expect(await ui.find({ type: 'Button', key: 'set-reportFolder-reset' })).toBeUndefined()
  await ui.unmount()
})

test('a refused setting shows Not saved and leaves the switch as it was', async ($, on) => {
  engine(on)
  const calls = settings(on, 'locked by policy')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /Not saved/ })).toBeUndefined()
  await ui.press({ key: 'set-animations' })
  expect(calls).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /Not saved: locked by policy/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set-animations', text: /◉ On/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set-animations', text: /○ Off/ })).toBeUndefined()
  await ui.unmount()
})