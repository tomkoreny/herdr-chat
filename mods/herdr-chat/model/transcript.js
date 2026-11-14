import { hash } from "./hash.js";

export const KINDS = {
  shell:  { icon: "terminal",    label: "Ran",     one: "command",  many: "commands" },
  read:   { icon: "file-text",   label: "Read",    one: "file",     many: "files" },
  edit:   { icon: "square-pen",  label: "Edited",  one: "file",     many: "files" },
  search: { icon: "search",      label: "Searched", one: "pattern", many: "patterns" },
  web:    { icon: "globe",       label: "Searched the web", one: "", many: "" },
  image:  { icon: "image",       label: "Viewed",  one: "image",    many: "images" },
  agent:  { icon: "layers",      label: "Ran",     one: "agent",    many: "agents" },
  todo:   { icon: "circle-check", label: "Updated the to-do list", one: "", many: "" },
  other:  { icon: "settings",    label: "Used",    one: "tool",     many: "tools" },
};
export const STEP = { think: "Thought", shell: "Bash", read: "Read", edit: "Edit", search: "Search", web: "Web", image: "View", agent: "Agent", todo: "Todos", other: "Tool" };

export function summary(steps) {
  // A group of steps in a few words: "Ran 2 commands, edited main.js".
  const calls = steps.filter(c => c.k !== "think");
  if (!calls.length) return "Thought process";
  const order = [], counts = {}, files = {};
  for (const c of calls) {
    if (!(c.k in counts)) { order.push(c.k); counts[c.k] = 0; files[c.k] = new Set(); }
    counts[c.k] += c.n ?? 1;
    if (c.k === "edit") for (const f of (c.d || "").split(", ").filter(Boolean)) files.edit.add(f);
  }
  const parts = order.map(k => {
    const kind = KINDS[k] ?? KINDS.other, n = k === "edit" ? Math.max(1, files.edit.size) : counts[k];
    if (!kind.one) return kind.label;
    if (n === 1 && calls.length === 1 && calls[0].d && k !== "shell") return `${kind.label} ${calls[0].d}`;
    return `${kind.label} ${n} ${n === 1 ? kind.one : kind.many}`;
  });
  const text = parts.join(", ");
  return parts.length ? text[0].toUpperCase() + text.slice(1).replace(/, (\w)/g, (_m, c) => `, ${c.toLowerCase()}`) : "";
}

export function withoutRetracted(messages, retracted) {
  // The rows without the message the agent handed back (Claude Code, stopped before answering).
  if (!retracted) return { rows: messages, retracted: null };
  let last = messages.length - 1;
  while (last >= 0 && messages[last].kind !== "message") last--;
  const m = messages[last];
  if (!m || m.role !== "user" || m.text.trim() !== retracted.trim() || last !== messages.length - 1) return { rows: messages, retracted: null };
  return { rows: messages.slice(0, last), retracted };
}

export function foldActivity(messages) {
  // Folds each run of tool calls and thoughts into one group of steps, in order.
  const out = [];
  for (const m of messages) {
    if (m.kind !== "tools" && m.kind !== "reasoning") { out.push(m); continue; }
    if (m.kind === "reasoning" && !m.text?.trim()) continue;
    let group = out[out.length - 1];
    if (group?.kind !== "tools") { group = { kind: "tools", calls: [] }; out.push(group); }
    if (m.kind === "reasoning") group.calls.push({ k: "think", d: "", o: m.text });
    else group.calls.push(...m.calls);
  }
  return out;
}

export const OUTPUT_LINES = 6, OUTPUT_CHARS = 700, THOUGHT_CHARS = 360, THOUGHT_LINES = 4;

export function stepText(c, open) {
  // A step's text: all of it when `open`, else a preview of a few lines, and whether anything was left out.
  const text = (c.o || "").replace(/\s+$/, "").replace(/^\n+/, "");
  if (open || !text) return { text, more: false };
  if (c.k === "think") {
    const lines = text.split("\n");
    if (text.length <= THOUGHT_CHARS && lines.length <= THOUGHT_LINES) return { text, more: false };
    let cut = lines.slice(0, THOUGHT_LINES).join("\n").slice(0, THOUGHT_CHARS);
    const space = cut.lastIndexOf(" ");
    if (space > THOUGHT_CHARS * 0.6) cut = cut.slice(0, space);
    return { text: cut.replace(/[\s,;:.]+$/, "") + " \u2026", more: true };
  }
  const lines = text.split("\n");
  const shown = lines.slice(0, OUTPUT_LINES).join("\n");
  if (lines.length <= OUTPUT_LINES && shown.length <= OUTPUT_CHARS) return { text, more: false };
  return { text: shown.slice(0, OUTPUT_CHARS).replace(/\s+$/, "") + "\n\u2026", more: true, hidden: lines.length - Math.min(lines.length, OUTPUT_LINES) };
}

export function stepRows(group) {
  // An opened group's steps, as rows of their own below its title.
  return group.calls.map((c, j) => ({ kind: "step", call: c, last: j === group.calls.length - 1, key: `${group.key}/${j}.${callDigest(c)}` }));
}

const DIGESTS = new WeakMap();
const CALL_DIGESTS = new WeakMap();
export const CALL_SOURCE = new WeakMap();
const sample = s => s.length > 512 ? `${s.length}:${s.slice(0, 256)}:${s.slice(-256)}` : s;

function callDigest(c) {
  // A tool call's digest: its input once per call, plus its output's size and end, which arrive later.
  const source = CALL_SOURCE.get(c) ?? c;
  let base = CALL_DIGESTS.get(source);
  if (base === undefined) {
    base = hash(JSON.stringify(source, (k, v) => k === "o" ? undefined : typeof v === "string" ? sample(v) : v));
    CALL_DIGESTS.set(source, base);
  }
  const o = typeof c.o === "string" ? c.o : "";
  return `${base}.${o.length}.${hash(o.slice(-64))}`;
}

function digest(m) {
  // A row's content digest, computed once per row object.
  let d = DIGESTS.get(m);
  if (d === undefined) {
    d = m.text != null ? hash(sample(m.text) + (m.images ?? []).join("|")) : hash((m.calls ?? []).map(callDigest).join("|"));
    DIGESTS.set(m, d);
  }
  return d;
}

export function keyRows(rows) {
  const seen = {};
  for (const m of rows) {
    const base = `${m.kind}-${m.role ?? ""}-${digest(m)}`;
    seen[base] = (seen[base] ?? 0) + 1;
    m.key = `${base}-${seen[base]}`;
  }
  rows.forEach((m, i) => {
    const prev = rows[i - 1], user = m.kind === "message" && m.role === "user";
    const prevUser = prev?.kind === "message" && prev.role === "user";
    m.turnGap = Boolean(prev) && m.kind !== "note" && (user ? !prevUser : prevUser);
    if (m.turnGap) m.key += "-g";
  });
  return rows;
}

export function splitCode(text) {
  // An assistant message split around its fenced code blocks: text, a code row, text, … (null when it has none).
  const parts = text.split(/```([^\n`]*)\n([\s\S]*?)```/g);
  if (parts.length === 1) return null;
  const out = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) out.push({ kind: "text", text: parts[i].trim() });
    if (i + 2 < parts.length) out.push({ kind: "code", lang: parts[i + 1]?.trim() || "", text: parts[i + 2].replace(/\n$/, "") });
  }
  return out;
}

export function withCopyRows(rows, working) {
  // The rows with a copy row after each agent response (the run of rows up to the next message from the person); the one still being written gets none.
  const out = [];
  let texts = [];
  const close = last => {
    if (texts.length && !(last && working)) out.push({ kind: "copy", text: texts.join("\n\n") });
    texts = [];
  };
  for (const m of rows) {
    if (m.kind === "message" && m.role === "user") { close(false); out.push(m); continue; }
    if (m.kind === "message" && m.text?.trim()) texts.push(m.text.trim());
    out.push(m);
  }
  close(true);
  return out;
}
