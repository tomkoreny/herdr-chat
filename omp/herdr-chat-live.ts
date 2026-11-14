// herdr-chat's live view of an OMP session: what the agent is thinking, writing or running right now.
//
// OMP logs a message only once it is complete, so the chat can't show a thought, a reply or a
// tool's output while it streams. This extension keeps the latest of them in a small file beside
// the session's log, <session>/__live.json (the folder OMP keeps the session's own files in),
// rewritten at most four times a second while the agent works and set idle when its turn ends:
//
//   {"v": 1, "at": <ms>, "kind": "thinking" | "text" | "call" | "tool" | "idle",
//    "tool": "<tool name>", "intent": "<its intent>", "text": "<the last 2000 characters>"}
//
// Install it in ~/.omp/agent/extensions/. OMP loads extensions when it starts.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

const EVERY = 250;
const KEEP = 2000;

type Live = { kind: "thinking" | "text" | "call" | "tool" | "idle"; tool?: string; intent?: string; text?: string };
type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null;
}

function tail(value: unknown): string {
  // The end of a streamed text, as much as the chat may show.
  const text = typeof value === "string" ? value : "";
  return text.length > KEEP ? text.slice(-KEEP) : text;
}

export default function herdrChatLive(pi: ExtensionAPI) {
  // One copy per session (OMP binds the factory again for each subagent), so this state is the session's own.
  let file = "";
  let live: Live = { kind: "idle" };
  let pending = false;
  let closed = false;
  const running = new Map<string, Live>();

  const write = () => {
    if (!file || closed) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, at: Date.now(), ...live }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {}
  };

  const show = (next: Live, now = false) => {
    // The latest activity, written within EVERY ms (at once when `now`).
    live = next;
    if (now) write();
    else if (!pending) {
      pending = true;
      setTimeout(() => { pending = false; write(); }, EVERY).unref?.();
    }
  };

  const follow = (ctx: unknown) => {
    // The live file of the session `ctx` belongs to: beside its log, in the folder named after it.
    const manager = isFields(ctx) ? ctx.sessionManager : undefined;
    const log = isFields(manager) && typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
    file = typeof log === "string" && log.endsWith(".jsonl") ? path.join(log.slice(0, -".jsonl".length), "__live.json") : "";
  };

  pi.on("session_start", (_event, ctx) => follow(ctx));
  pi.on("session_switch", (_event, ctx) => { follow(ctx); running.clear(); show({ kind: "idle" }, true); });

  pi.on("message_update", (event, ctx) => {
    const message: unknown = event.message;
    if (!isFields(message) || message.role !== "assistant" || !Array.isArray(message.content)) return;
    if (!file) follow(ctx);
    const block: unknown = message.content.at(-1);
    if (!isFields(block)) return;
    if (block.type === "thinking") show({ kind: "thinking", text: tail(block.thinking) });
    else if (block.type === "text") show({ kind: "text", text: tail(block.text) });
    else if (block.type === "toolCall") {
      const args = isFields(block.arguments) ? block.arguments : {};
      show({ kind: "call", tool: String(block.name ?? ""), intent: typeof args.i === "string" ? args.i : "" });
    }
  });

  pi.on("message_end", (event) => {
    const message: unknown = event.message;
    if (isFields(message) && message.role === "assistant") show([...running.values()].at(-1) ?? { kind: "idle" }, true);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (!file) follow(ctx);
    const entry: Live = { kind: "tool", tool: String(event.toolName ?? ""), intent: String(event.intent ?? ""), text: "" };
    running.set(String(event.toolCallId ?? ""), entry);
    show(entry);
  });

  pi.on("tool_execution_update", (event) => {
    const id = String(event.toolCallId ?? "");
    const entry = running.get(id);
    if (!entry) return;
    const result: unknown = event.partialResult;
    const content = isFields(result) && Array.isArray(result.content) ? result.content : [];
    entry.text = tail(content.map(c => (isFields(c) && c.type === "text" && typeof c.text === "string" ? c.text : "")).join("\n"));
    running.delete(id);
    running.set(id, entry);
    show(entry);
  });

  pi.on("tool_execution_end", (event) => {
    running.delete(String(event.toolCallId ?? ""));
    show([...running.values()].at(-1) ?? { kind: "idle" });
  });

  pi.on("agent_end", () => { running.clear(); show({ kind: "idle" }, true); });

  pi.on("session_shutdown", () => {
    closed = true;
    try { if (file) fs.rmSync(file, { force: true }); } catch {}
  });
}
