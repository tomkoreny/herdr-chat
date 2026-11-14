// What an agent is doing right now (thinking, writing, running a tool), as its harness keeps it in a file
// beside its session log while it works. OMP does this through omp/herdr-chat-live.ts.

const KINDS = ["thinking", "text", "call", "tool"];
export const LIVE_CHARS = 700, LIVE_LINES = 6;

export function livePath(log, name) {
  // The live file `name` beside a session log, in the folder named after it; "" without either.
  if (!name || !/\.jsonl$/i.test(log || "")) return "";
  return `${log.replace(/\.jsonl$/i, "")}${log.includes("/") ? "/" : "\\"}${name}`;
}

export function parseLive(text) {
  // The activity in a live file's text; null when there is none: no file, a broken one, or the agent between turns.
  let o;
  try { o = JSON.parse(text ?? ""); } catch { return null; }
  if (!o || typeof o !== "object" || !KINDS.includes(o.kind)) return null;
  return { kind: o.kind, tool: String(o.tool ?? ""), intent: String(o.intent ?? ""), text: String(o.text ?? "") };
}

export function liveView(live) {
  // How an activity reads under the working spark: a title, and the end of what it streams, as lines; a tool's output
  // in monospace (its last lines, without terminal colours, each carriage return keeping what came after it).
  if (!live) return null;
  const doing = [live.tool, live.intent].filter(Boolean).join(" · ");
  const title = live.kind === "thinking" ? "Thinking" : live.kind === "text" ? "Writing" : live.kind === "call" ? `Preparing ${doing || "a tool call"}` : doing || "Running a tool";
  let lines;
  if (live.kind === "tool") {
    lines = live.text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").split("\n").map(l => l.split("\r").pop().replace(/\s+$/, "")).filter(Boolean).slice(-LIVE_LINES);
  } else {
    let text = live.text.replace(/\s+$/, "").replace(/\n\s*\n+/g, "\n");
    if (text.length > LIVE_CHARS) {
      const cut = text.slice(-LIVE_CHARS);
      text = `…${cut.slice(Math.max(0, cut.search(/\s/))).replace(/^\s+/, "")}`;
    }
    lines = text ? text.split("\n") : [];
  }
  return { title, lines, mono: live.kind === "tool", italic: live.kind === "thinking" };
}
