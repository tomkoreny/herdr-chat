# Herdr Chat

A coding agent's terminal, shown as a chat. A Chat / Terminal toggle in the
pane header swaps one for the other in place, and the agent keeps running in its terminal either
way. The chat reads the agent's own session log, so it works for agents on every machine herdr
reaches.

![Herdr Chat](preview.png)

## Install

Ask your Herdr agent to add this layout, or copy `mods/herdr-chat/` and `layouts/herdr-chat.json`
into `~/.config/herdr-app/` and switch to `herdr-chat` with `ctrl-shift-l`. Your own layout stays
as it was, one `ctrl-shift-l` away.

Each machine with agents needs Python 3: `python3`, or `py -3` / `python` on Windows.

For OMP's live activity under the working spark, copy `omp/herdr-chat-live.ts` into
`~/.omp/agent/extensions/` on each machine that runs OMP. OMP loads it when it starts, so sessions
already running show it once restarted. Without it the chat works as before.

**To add the chat to your own layout**, wrap its `{ "tab": "active" }` block in this stack and give
its pane look the mod as a header. The mod looks for these names:

```json
{ "id": "chat-view", "type": "stack", "active": "chat-panel", "children": [
  { "id": "chat-panel", "type": "block", "content": { "mod": "herdr-chat", "props": { "role": "chat" } } },
  { "id": "terminal-panel", "type": "block", "content": { "tab": "active", "pane": {
      "header": { "content": { "mod": "herdr-chat" }, "height": 42, "position": "top", "reveal": "always" } } } }
] }
```

## What you see

The layout is herdr's `main` (Spaces and Agents on the left, tab pills, Files and Changes panels,
status bar) with the chat and the terminal sharing the work area.

- **Header** (42 px, on both views): the program's icon, name and folder; on hover split right,
  split down, zoom and close; the agent's status (a spinner while working, "Needs you" while
  blocked, a dot when it finished while you were away); and the **Chat | Terminal** toggle at the
  far right.
- **Chat** (a centred column, 740 px wide):
  - your messages as bubbles on the right, with their images above them as 120 px thumbnails;
    the agent's replies on the left as markdown, with code blocks;
  - tools and thinking folded into one grey line per run ("Ran 3 commands, read 2 files ›"),
    opening to each step with its output;
  - mermaid blocks drawn as diagrams in the reply;
  - while the agent works, an accent spark and its live status; on OMP with its extension (see
    Install), what it is doing right now under it: "Thinking…" with the end of the thought,
    "Writing…" with the end of the reply, or the tool and its intent with the last lines of its
    output, in a box of fixed height whose newest lines stay at the bottom;
  - OMP's to-do list and subagents in a card above the reply box, as OMP's TUI shows them above its
    prompt: the tasks closed of all with a bar, the active phase (Roman-numbered) with its tasks
    (ticked, turning while in progress, crossed out when abandoned) and the phases after it with
    their counts; then each subagent at work with its kind, how long it has run and the intent of
    the tool it ran last. Its title folds it to one line with the task at hand. The list goes when
    OMP's TUI dismisses it (by hand, or a while after the last task closed); a subagent goes when
    its reply ends its turn. The card folds while a question card shows;
  - a question card above the reply box when the agent asks something;
  - a reply box that grows to four lines, with a round send button in the theme's accent (a Stop
    button while the agent works) and a line under it naming the terminal it sends to, led by the
    agent's status where its log tells it (OMP: model, thinking level, context, cost);
  - a jump-to-bottom button when the newest message is off screen.
- **Empty chat:** herdr's logo with "Opening this … conversation…", "Waiting for this …
  conversation to start." or "No messages in this session yet."

Colours come from the active theme; icons are the mod's own SVGs in the theme's text colour.

## How it behaves

- **Agents:** a terminal gets the toggle when its program has an adapter in `harnesses/` (see
  Adding an agent below). Every other tab shows its terminal.
- **View:** a new agent session opens on Chat. Each session keeps the view it was left in, across
  restarts (the latest 200, shared key `herdr-chat.views`).
- **Sending:** Enter sends, Shift+Enter starts a new line, ↑ and ↓ move between lines. The text
  reaches the live terminal as plain typing (`hc send` from the agent's machine, without hc's
  `<hc from="…">` wrapper). A send that can't be delivered puts the text back in the box.
- **Stop:** while the agent works, the send button stops it (also Esc). A message the agent hands
  back on Stop returns to the reply box.
- **Images:** drop png, jpg, gif or webp files on the chat, or paste one with Ctrl+V. Images over
  250 KB are shrunk, placed beside the agent's terminal with `hc put`, and attached the way each
  agent attaches images: Claude Code as an `@path` mention, Codex as a pasted path, Pi, OpenCode
  and OMP as the plain path. Images in the conversation show as thumbnails, fetched from the agent's
  machine.
- **Questions:** when an agent asks a question with choices, the card lists them: ↑↓ move, Enter
  or a click answers, multi-select questions tick rows, multi-step questions step through, and
  Claude Code's previews show beside the options. The card folds to one line. Each key is sent
  only while the screen still shows the same question. The screen is judged on its last 4000
  characters after each line's end padding is dropped and a picture's cells become one word. Other
  prompts show the screen's last lines with key buttons.
- **OMP's ask form:** the card shows the whole form as OMP wrote it: its text, lists, tables and
  pictures (copied from the agent's machine), and every field at once, radio buttons and checkboxes
  as rows with OMP's own "Other" answer, a `<select>` as rows too, inputs and textareas as text
  boxes. It's filled in in the card and sent with Submit, after the checks OMP makes on Submit; a
  form of one radio question is sent by picking its answer. A form half filled in is kept while
  another session is shown. The form comes from the session's log (`prompt.form: "log"`: the
  reader's `ask` is the waiting call's HTML, which `model/ask-html.js` reads as OMP's own parser
  does), not off the screen, so it's the same whichever OMP drew it. The answers go into the form
  in OMP's terminal, typed there through `hc attach` (`model/ask-form.js`): every field is set to
  what the card shows, whatever the terminal's form held, and Submit is pressed only once the
  form's cursor has reached it. Checkboxes can only be flipped, so each group's boxes are read off
  the screen first, with the cursor on the group's last stop (where OMP 19, which folds every
  field but the one in focus, shows it whole) and only from rows that carry the group's own
  labels. OMP redraws a waiting question some 30 times a second, so the screen never pauses: the
  keys go in as few writes as the form allows, each given a moment rather than a quiet screen,
  and what's read back is read again when it predates them. OMP 18.22 and 19 take the same keys.
  A message sent from the reply box while a form waits is sent in place of an answer (Esc first,
  so it isn't typed into the form). On Windows the card shows the screen's last lines instead.
- **Skills and commands:** typing `/` (also `$` on Codex, `@` on OpenCode) opens the agent's
  skills, a list that scrolls with the wheel or ↑↓: ↑↓ choose, Enter or Tab insert, Esc closes. OMP
  lists all its slash commands instead, as its RPC mode reports them (`omp --mode rpc --no-session`,
  run for a moment in the terminal's folder), and after a command and a space offers what can
  follow it: `/effort`'s levels, `/switch`'s models, other commands' subcommands. Without OMP to
  ask, its skills show as `/skill:` commands.
- **Status line (OMP):** the session's model, thinking level, how full its context is and what its
  replies cost, read from its log. The model is the one in use: one chosen for this session only
  (`/switch`, the TUI's model cycling, plan and prewalk hand-offs, a retry's fallback) until the
  default role changes again, as OMP itself restores it. Clicking the model or the level lists the
  choices, the current one selected; a list longer than eight rows (the models) has a search field
  that takes the keyboard and matches names and descriptions. Picking one sends `/switch <model>`
  or `/effort <level>` to the terminal and leaves the draft alone. Typing in the reply box, a
  second click or Esc closes the list. Not clickable while the agent waits on a question.
- **One draft:** on Linux and macOS, the reply box and the agent's own input box share one draft,
  images included, as you switch between Chat and Terminal.
- **Reading:** each session log is found once and remembered. The first read takes its last 24 MB
  (up to 400 entries), and later reads take what was added. Agents are read again whenever herdr
  reports a change in them, whenever the shown agent's log folder changes (the watch on the folder
  shown before is released, since herdr watches at most 64 folders for all mods), and the working
  agent on screen every 1.5 s. Another machine's folders can't be watched, so an idle agent there
  is read every 5 s while it's on screen: a model switched in its terminal changes nothing herdr
  reports. The 32 most recent conversations stay in memory, so switching back is instant.
- **Following:** the chat stays at the bottom while you're there, and holds still when you scroll
  up.
- **Highlight:** selected text, in the chat and in herdr's text boxes, and the bar behind inline
  code in replies use a dimmed accent.

## Built from

**Layout** `layouts/herdr-chat.json`: `main` with its tab block inside the `chat-view` stack above.
The swap is `layout.select { stack: "chat-view", child: "chat-panel" | "terminal-panel" }`, since
the terminal itself belongs to the layout. The same mod runs twice: as the chat
(`props.role: "chat"`) and as the terminal's pane header (it gets `{ pane, terminal }`).

**Mod** `mods/herdr-chat/` (`mod.json` is `{"place":"none"}`):

| Path | Role |
|---|---|
| `main.js` | the chat view: sessions, timers, header, list, card and composer, Stop |
| `header.js` | the terminal pane header with the toggle |
| `common.js` | session keys, each session's view, `layout.select` |
| `components/` | `chat-list.js` (rows, measuring, following), `question-card.js`, `ask-form.js` (OMP's ask form, filled in and sent), `composer.js` (reply box, drafts, images, sending, status line), `session-reader.js` (reading and keeping conversations), `skill-menu.js` (skills, commands and their choices) |
| `model/` | pure data, free of gpui and herdr imports: transcript folding, session state, status line, the to-do list and subagents card, the live activity, prompt parsing, OMP's ask form (its HTML read, and the keys that fill it in), caret, hash |
| `ui/` | `primitives.js` (icons, buttons, badges, toggle), `rows.js` (each conversation row), `hud.js` (the to-do list and subagents card) and `live.js` (the live activity under the working spark) |
| `harnesses/` | one adapter per agent: label, image style, drafts, prompt options, input box, skills, reader. All agent-specific behaviour lives here |
| `readers/` | the session reader in Python 3.6+, one file per agent beside `common.py` and `main.py`, joined in `manifest.json` order |
| `terminal.js`, `platform.js` | the target agent and its screen; Windows and Unix differences |
| `images.js`, `prepare-image.sh` / `.ps1` | image previews: where they go, shrinking, the clipboard |
| `input-box.py`, `send.ps1` | the agent's own input box, and keys typed as a terminal sends them, through `hc attach` (Linux and macOS); sending on Windows |
| `diagrams.js`, `vendor/pele/` | mermaid through [Pele](https://github.com/obsidianmd/pele), pinned in `package.json` and copied into `vendor/` |
| `icons/` | the mod's SVG icons |

**OMP extension** `omp/herdr-chat-live.ts`, outside the mod: run by OMP itself, it keeps what the
agent is doing right now in `<session>/__live.json` beside its log (see Adding an agent).

## Watch out

**What it accesses:**

- runs programs, on this computer and on other machines (`exec(…, { on })`): `python3` (`py -3`
  or `python` on Windows), `hc` (`send`, `keys`, `interrupt`, `put`, `get`, `ls`, `exec`, `read`,
  `attach`, including `attach --observe`), `sh`, `env`, `rm`, `find`, `powershell.exe`, the
  clipboard tools (`wl-paste`, `xclip`, `pngpaste`) and ImageMagick or `sips`, and `omp --mode rpc
  --no-session` for OMP's commands and models (no session is written). The reader travels
  with each run, so other machines need only Python 3 and `hc`;
- reads the agents' session logs (`~/.claude`, including `~/.claude/sessions`, `~/.codex/sessions`,
  `~/.pi/agent/sessions`, `~/.omp/agent/sessions` and OMP's `~/.omp/agent/terminal-sessions`,
  OpenCode's database), OMP's live file beside its log, their skill folders, terminal screens, and
  the process list, to find which session runs in each terminal;
- its OMP extension, where installed, writes only `<session>/__live.json` beside each OMP session's
  log (thinking and tool output included, readable by the user alone) and removes it when OMP
  closes the session;
- types into terminals and stops a working agent with its own stop key;
- writes image copies and drawn diagrams under `cache/herdr-chat/` in the Herdr home, and deletes
  its own files there after a day (delete that folder along with the mod to remove everything);
- sets the app's `accent` and `selection` colours to a dimmed accent while it runs, so selected
  text stays visible in herdr's text boxes and inline code in replies stays readable (gpui's
  markdown draws a bar in the accent behind it). Theme files stay as they are;
- works entirely offline.

**Notes for building it:**

- **Windows command line:** the reader is longer than Windows' 32,767-character command line, so on
  Windows the mod loads it from `readers/` for local agents and sends it zlib-compressed to other
  machines. Elsewhere it's sent whole.
- **Windows processes:** the reader walks a terminal's processes through `kernel32` on Windows and
  `/proc` or `ps` elsewhere. Python on Windows ends lines with `\r\n`, so split batch output on
  either.
- **Binary files:** read a written image back to confirm its size before using it.
- **Thumbnails:** `image()` draws files inside the herdr home, so each preview is a copy in
  `cache/herdr-chat/sent/`.
- **Diagrams:** write the theme's colours into Pele's SVG directly; herdr's SVG renderer draws
  inline colours.
- **List rows:** handle clicks with the virtual list's `on_item_click`.
- **↑ and ↓:** bind them in the textarea's `Input` context, and read the caret with
  `selected_range()` (Herdr 0.1.16 and newer).
- **`herdr-app check`:** it runs `init()` for real, so the view starts no reads, timers or theme
  change while `checking()` says so, and the composer leaves the image cache alone.
- **Sizes:** measured sizes include the app's zoom and layout sizes take unzoomed px, so every
  measured size goes through `measure.js`.
- **Theme colours:** `set_theme` restarts every mod copy, so apply it from a timer and only when
  the colour changed.
- **Sending:** send from the agent's machine without `HC_TERMINAL_ID` and `HC_SCOPE`, so the text
  arrives as plain typing.
- **Debug files:** write them outside the mod's folder, since any write inside reloads the mod.
- **Its name:** `mods/herdr-chat/` is written into its paths (`platform.js`, `common.js`,
  `terminal.js`, `components/session-reader.js`) and its shared keys start with `herdr-chat.`,
  so a renamed copy needs those changed too.
- **Agent logs:** Codex continues a resumed session in its older logs and splits long ones into
  parts, and writes its reviewer's logs beside them (read only the session's own). Claude Code logs
  messages sent mid-turn as `queued_command` attachments. A resumed Pi keeps writing to its first
  file. An OMP log is a tree whose conversation is the branch ending at the newest entry; side
  records (model usage) name that end in `activeLeafId` without moving it.
- **Adding an agent:** a `harnesses/<id>.js` adapter listed in `harnesses/index.js`, and a
  `readers/<id>.py` registering `READERS["<id>"]` listed in `readers/manifest.json` before
  `main.py`. `tests/harnesses.mjs` checks that agent names stay inside `harnesses/`. A reader can
  set `state["status"]` for the status line: `model` (or `inferredModel` until one is logged),
  `effort` with the `level` in force, `context` (None when unknown) and `cost`. The chat keeps the
  latest of each and adds up each read's `cost`. OMP's reader follows OMP's own rules: the default
  role's model, the context as `calculateContextTokens` counts it, reset by a compaction. For the
  card above the reply box it also sets `todo` (the entry that set the list, and its phases, rebuilt
  as `canonicalTodoPhases` does), `todoHud` (the entry OMP's TUI dismissed or revealed), `ask` (the
  ask call waiting for an answer: its id and its form's HTML; None once its result, the person's
  message or a later reply ends the wait) and, on
  every read, `agents`: the subagents in their own logs (`<session>/<id>.jsonl`, not OMP's `__` side
  logs) whose latest message isn't a reply that ended their turn (OMP writes `session_exit` only
  minutes later) and that began after the OMP in the terminal started, since one an earlier OMP left
  open was cut off. An agent on another machine waiting on its subagents is read
  every 1.5 s. An agent that can list its commands registers `COMMANDS["<id>"]` and sets
  `skills.commands`; the adapter's `status` names the commands the status line's model and level
  run. An adapter's `live` names the file, in the folder named after the session's log, where the
  agent keeps what it is doing right now (`model/live.js` reads it: `kind` thinking, text, call,
  tool or idle, with `tool`, `intent` and `text`); the chat reads it every 0.3 s while the agent
  works (1 s on another machine, 3 s while there is no file). OMP writes it through
  `omp/herdr-chat-live.ts`, since OMP logs a message only once it ends.

**Platform notes:**

- The chat shows the last 24 MB of each session log.
- On Windows, the draft lives in the reply box, a question card shows long previews in part with a
  count of the remaining lines, a multi-select's own-answer row is typed in the terminal, OMP's ask
  form shows as the screen's last lines, and Codex receives a pasted image as its path.
- OpenCode is read from its `session_v2` tables.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/herdr-chat` passes (Herdr 0.1.16 or newer) and
  `herdr-app status` shows no errors on the `herdr-chat` layout.
- `npm test` passes on Linux or macOS.
- A new tab for each supported agent opens on its chat, with the toggle in the header;
  Terminal brings the terminal back, and each session keeps its view after a restart.
- A message sent from the chat reaches the terminal as plain text, and the reply appears as it's
  written.
- An agent on another machine shows its conversation the same way.
- A pasted screenshot shows as a thumbnail and reaches the agent as an image.
- A question with choices shows as a card, and answering it in the chat answers it in the terminal.
- An OMP ask form shows whole in the card, and Submit there submits it in the terminal with the
  answers the card shows (OMP 18.22 or 19).
- A mermaid block shows as a diagram in the theme's colours.
- On OMP, `/` lists its commands, `/effort ` offers its levels, and picking a model in the status
  line switches the session's model, which the line shows once OMP has logged it.
- Changing the theme changes the chat's colours.
