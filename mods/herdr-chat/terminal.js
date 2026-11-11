import { hc, exec, appHome, focused, agents, terminals } from "herdr";
import { onWindows, modFile, base64Utf8 } from "./platform.js";
import { harnessFor } from "./harnesses/index.js";
import { promptText } from "./model/prompts.js";

export function target() {
  // The agent the chat shows: the focused tab's agent, the focused one when there are several.
  const f = focused();
  if (!f) return null;
  const mine = agents().filter(x => x.tab === f.tab && x.space === f.space && harnessFor(x.app));
  const a = mine.find(x => x.address === f.terminal) ?? mine[0];
  return a ? agentTarget(a, terminals()) : null;
}

export function agentTargets() {
  // Every agent the chat can show, as target() describes one (the background keeps them read).
  const terms = terminals();
  return agents().filter(x => harnessFor(x.app)).map(a => agentTarget(a, terms));
}

function agentTarget(a, terms) {
  const term = terms.find(x => x.address === a.address), harness = harnessFor(a.app);
  return {
    address: a.address, pane: a.pane, app: a.app, harness, label: harness.label, program: a.program,
    status: a.status, title: a.title, remote: a.address.includes("/"),
    machine: a.address.includes("/") ? a.address.split("/")[0] : null,
    pid: term?.pid ?? 0, created: term?.created_ms ?? 0, cwd: term?.cwd ?? "",
    activity: term?.report?.msg ?? term?.status?.msg ?? "",
    kind: term?.report?.kind ?? term?.status?.kind ?? "",
    turn: term?.turn ?? null, statusMs: term?.status_ms ?? null,
  };
}

export async function readScreen(t, lines) {
  // The screen plus `lines` of history, or null when it can't be read.
  const r = await hc(["read", t.address, "--lines", String(lines)]);
  return r.code === 0 ? r.stdout : null;
}

export async function readPrompt(t) {
  // The screen's end as prompts are judged on (what the question card and its checks compare).
  const screen = await readScreen(t, 26);
  return screen == null ? null : promptText(screen);
}

export function sendMessage(t, text, force) {
  // Types `text` into the agent and presses Enter, as the person.
  const forced = force ? ["--force"] : [];
  if (t.remote) return exec("sh", ["-c", 'h=$(command -v hc || echo "$HOME/.local/bin/hc"); exec env -u HC_TERMINAL_ID -u HC_SCOPE "$h" send "$@"',
    "hc-send", ...forced, t.address.slice(t.address.indexOf("/") + 1), text], { on: t.machine });
  if (onWindows()) return exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    `${appHome()}\\mods\\herdr-chat\\send.ps1`, "-Address", t.address, "-Text64", base64Utf8(text), ...(force ? ["-Force"] : [])]);
  return exec("env", ["-u", "HC_TERMINAL_ID", "-u", "HC_SCOPE", "hc", "send", ...forced, t.address, text]);
}

export async function interruptAgent(t) {
  // Presses the agent's stop key (Esc for an agent, Ctrl+C otherwise) and reports what happened.
  const r = await hc(["interrupt", "--json", "--timeout", "5", t.address]);
  try { return JSON.parse(r.stdout); } catch { return { outcome: r.code === 0 ? "unknown" : "failed", error: (r.stderr || "").trim() }; }
}

export function pressKeys(t, keys) {
  // Presses named keys in the terminal (up, down, enter, esc, …).
  return hc(["keys", t.address, ...keys]);
}

export async function inputBox(command, t, ...args) {
  // input-box.py: `read`, `set` (a JSON list of pastes) or `paste` on the agent's own input box, or `step` for a prompt's current step.
  const shape = command === "read" || command === "set" ? [JSON.stringify(t.harness.box)] : [];
  const r = await exec("python3", ["-I", modFile("input-box.py"), command, t.address, ...shape, ...args]).catch(e => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) return { ok: false, box: null, error: (r.stderr || r.stdout || `input-box.py ${command} failed`).trim() };
  let box = null;
  try { box = r.stdout.trim() ? JSON.parse(r.stdout).box ?? null : null; } catch {}
  return { ok: true, box, error: "" };
}
