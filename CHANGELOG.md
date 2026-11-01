# Changelog

## 0.2.1

- Finished subagent windows can be closed: **✕** on each window, or **✕ Clear finished** above the tree for all of them. **show N closed** brings them back. Running agents can't be closed, and closing never removes an agent's actions from the timeline.
- Token counts of a million or more read as `29.3M`.

## 0.2.0

First public release.

- Live **Preview** of what Claude is doing: text typed in as it is written, edits backspaced then retyped, reads skimmed, commands in a mini terminal, searches sweeping for hits, web results dropping in.
- **Agents** tree with a window and a small live preview for every subagent, and a Stop button.
- **Timeline**, newest first: one line per action, repeats folded (`Read ×5`), rows open in place, filters by kind, agent and file, token cost per action.
- **⚠ counter** for failed, blocked and risky actions.
- **Open files** and an approximate **Browser** view of where clicks land.
- **📄 Report**: an HTML report of the session, with the last sessions kept as history.
- **✨ Summary**: an optional AI summary of the session (one small Haiku call, only when pressed).
- **⚙ Settings** in the pane: open automatically, animations on/off, sessions kept, report folder.
- Compact mode, collapsible and resizable sections, layout remembered across sessions.
