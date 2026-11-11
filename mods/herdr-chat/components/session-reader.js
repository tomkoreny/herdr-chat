import { appHome, shared, setShared, watchFolder } from "herdr";
import { readFile } from "fs/promises";
import { sessionOf, chatKey } from "../common.js";
import { base64Utf8, onWindows, python } from "../platform.js";
import { target, agentTargets, readScreen } from "../terminal.js";
import { supportedNames } from "../harnesses/index.js";
import { blankSession, parseReaderInSlices, applyRead, readerArgs, embeddedReader, readerFromFolder, compressProgram, compressedReader, readerProgram, batchProgram, splitBatch } from "../model/session.js";

const SESSIONS_KEPT = 32;
const READ_AFTER = [1000, 4000];
const QUIET_EVERY = 1500;
const WAIT_EVERY = 3000;
const RETRY_AFTER = 5000;
const STALE_AFTER = 3000, CHECK_AFTER = 300, SILENT_AFTER = 5000;
const PATHS_KEY = "herdr-chat.paths";

let readerBase64 = null;
async function readerSource() {
  // The session reader as one script: readers/*.py joined in manifest order, so another machine runs it from one `python3 -c`.
  if (!readerBase64) {
    const dir = `${appHome()}/mods/herdr-chat/readers`;
    const order = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
    readerBase64 = base64Utf8((await Promise.all(order.map(f => readFile(`${dir}/${f}`, "utf8")))).join("\n"));
  }
  return readerBase64;
}

let readerCompressed = null;
async function compressedSource(folder) {
  // The reader's source compressed by this computer's Python, once; null when that can't run.
  if (!readerCompressed) {
    const r = await python(["-c", compressProgram(folder)]).catch(() => null);
    if (r?.code === 0 && r.stdout.trim()) readerCompressed = r.stdout.trim();
  }
  return readerCompressed;
}

async function readerCode(machine) {
  // The reader for a Python run on `machine`. Windows' command line can't carry it whole: this computer reads the mod's folder, and other machines get it compressed.
  if (!onWindows()) return embeddedReader(await readerSource());
  const folder = base64Utf8(`${appHome()}/mods/herdr-chat/readers`);
  if (!machine) return readerFromFolder(folder);
  const compressed = await compressedSource(folder);
  return compressed ? compressedReader(compressed) : embeddedReader(await readerSource());
}

const NO_PYTHON = { code: 0, stdout: `NOTE|${encodeURIComponent("Reading conversations on Windows needs Python 3 (python.org, or the py launcher).")}\n`, stderr: "" };

async function runReader(t, at) {
  const boot = readerProgram(await readerCode(t.machine));
  return (await python(["-c", boot, ...readerArgs(t, at)], t.machine ? { on: t.machine } : undefined)) ?? NO_PYTHON;
}

export async function readSkills(t, path) {
  // The reader's list of an agent's skills (or all its commands, where the harness lists them), run on the agent's machine.
  const { user, project, skip, commands } = t.harness.skills;
  const boot = readerProgram(await readerCode(t.machine));
  const args = ["--app", t.harness.reader, "--pid", String(t.pid), "--skills", JSON.stringify({ user, project, skip, ...(commands ? { commands } : {}) })];
  if (t.cwd) args.push("--cwd", t.cwd);
  if (path) args.push("--known", path);
  return python(["-c", boot, ...args], t.machine ? { on: t.machine } : undefined);
}

async function runReaders(machine, list) {
  // Reads several sessions on one machine (null: this one) in one Python run; each one's output, or null.
  const program = batchProgram(await readerCode(machine));
  const r = await python(["-c", program, base64Utf8(JSON.stringify(list.map(([t, at]) => readerArgs(t, at))))], machine ? { on: machine } : undefined);
  return r?.code === 0 ? splitBatch(r.stdout) : null;
}

function peersOf(t, all = agentTargets()) {
  // Other agents of the same program on the same machine (the reader tells sessions apart by them).
  return all.filter(a => a.app === t.app && a.address !== t.address && a.machine === t.machine).length;
}

export class SessionReader {
  constructor(host) {
    // The shown conversation and the others kept in memory: read from the agents' logs, here and on other machines, and kept fresh. `host` is the view: its `card` (to read a question when the agent changes) and `list` (to follow new messages).
    this.host = host;
    this.session = blankSession();
    this.session.note = "Loading conversation…";
    this.key = ""; this.lastRead = 0; this.sessions = new Map();
    this.facts = null; this.dueReads = [];
  }

  noticeAgents(cx) {
    // Reads what changed in herdr's agent list since the last look: the session on screen, others in the background.
    const all = agentTargets();
    const now = new Map(all.map(t => [chatKey(t), `${t.status}|${t.activity}|${t.turn}|${t.statusMs}`]));
    const first = !this.facts;
    const at = Date.now();
    for (const t of all) {
      const key = chatKey(t);
      if (!first && this.facts.get(key) === now.get(key)) continue;
      if (key === this.key) {
        this.shownChangedAt = at;
        if (!first) { this.read(cx); this.host.card.read(cx, t); }
        for (const ms of READ_AFTER) this.dueReads.push({ key, at: at + ms });
      } else if (!first) {
        for (const ms of READ_AFTER) this.dueReads.push({ machine: t.machine, at: at + ms });
      }
    }
    this.facts = now;
    if (first) { this.warm(cx); return; }
    const shown = all.find(t => chatKey(t) === this.key);
    if ((shown?.status === "working" || shown?.status === "blocked") && at - Math.max(this.shownChangedAt ?? 0, this.quietReadAt ?? 0) >= QUIET_EVERY) {
      this.quietReadAt = at;
      if (shown.remote && shown.status === "working") this.read(cx);
      this.host.card.read(cx, shown);
    }
    const ready = this.dueReads.filter(d => d.at <= at);
    if (!ready.length) return;
    this.dueReads = this.dueReads.filter(d => d.at > at);
    if (ready.some(d => d.key !== undefined && d.key === this.key)) this.read(cx);
    const machines = new Set(ready.filter(d => d.key === undefined).map(d => d.machine));
    if (machines.size) this.warm(cx, machines);
  }

  switchTo(t, key) {
    // Shows another session: the one on screen kept, the new one restored (or started).
    this.shownChangedAt = Date.now();
    this.stash();
    this.key = key; this.lastId = ""; this.screenAskedAt = 0;
    this.watchToken = (this.watchToken ?? 0) + 1; this.watchedPath = ""; this.readError = ""; this.readStartedAt = 0;
    const kept = key ? this.sessions.get(key) : null;
    if (kept) this.session = kept;
    else {
      const known = t ? (shared(PATHS_KEY) ?? {})[sessionOf(t)] : null;
      this.session = blankSession(known?.path ?? "", known?.hint ?? "");
      this.session.note = !t ? `Select a ${supportedNames()} terminal to see it as a chat.` : `Opening this ${t.label} conversation…`;
    }
    this.needsFirstRead = Boolean(t);
  }

  stash() {
    // The session on screen kept in memory, to show at once when it is selected again.
    if (!this.key || !this.session.path) return;
    this.sessions.delete(this.key);
    this.sessions.set(this.key, this.session);
    this.trimSessions();
  }

  trimSessions(live) {
    // Down to SESSIONS_KEPT: sessions whose agent is gone go first, then the least recently shown.
    if (this.sessions.size <= SESSIONS_KEPT) return;
    if (live) for (const k of [...this.sessions.keys()]) if (this.sessions.size > SESSIONS_KEPT && !live.has(k) && k !== this.key) this.sessions.delete(k);
    while (this.sessions.size > SESSIONS_KEPT) this.sessions.delete(this.sessions.keys().next().value);
  }

  read(cx) {
    // Reads the session on screen from where it last stopped.
    const t = target();
    if (!t || chatKey(t) !== this.key) return;
    const key = this.key;
    if (this.reading === key) { this.dirty = true; return; }
    const token = this.readSeq = (this.readSeq ?? 0) + 1;
    this.reading = key; this.dirty = false; this.lastRead = Date.now();
    this.readStartedAt = Date.now(); this.readStaleFor = Date.now() - (this.session.readAt || 0);
    const mine = () => this.key === key && this.readSeq === token;
    cx.spawn(async cx => {
      try {
        const at = { path: this.session.path, hint: this.session.hint, offset: this.session.offset, peers: peersOf(t), leaf: this.session.leaf };
        let r = await runReader(t, at);
        if (!mine()) return;
        if (r.code === 0 && /^NEED\|screen/m.test(r.stdout) && Date.now() - (this.screenAskedAt ?? 0) > 15000) {
          this.screenAskedAt = Date.now();
          const shown = await readScreen(t, 40);
          if (!mine()) return;
          r = await runReader(t, { ...at, screen: shown != null ? shown.slice(-3000) : "" });
          if (!mine()) return;
        }
        if (r.code !== 0) throw new Error(r.stderr || `Reader exited ${r.code}`);
        const update = await parseReaderInSlices(r.stdout, () => cx.sleep(0));
        if (!mine()) return;
        this.merge(update, t);
        this.readError = "";
        if (!t.remote) this.watch(cx, this.session.path);
      } catch (e) {
        if (!mine()) return;
        if (this.session.messages.length) this.readError = String(e?.message ?? e).split("\n")[0] || "no answer";
        else {
          this.session.note = t.remote ? `${t.machine} is slow to answer. Trying again…` : `Couldn't read this conversation yet. Trying again…`;
          this.dueReads.push({ key, at: Date.now() + RETRY_AFTER });
        }
      }
      finally {
        if (this.readSeq === token) {
          this.readStartedAt = 0;
          if (this.reading === key) {
            this.reading = null;
            if (this.dirty) this.read(cx);
            else if (!this.session.path && this.key === key) this.dueReads.push({ key, at: Date.now() + WAIT_EVERY });
          }
        }
        cx.notify();
      }
    });
  }

  merge(update, t) {
    // Applies the reader's update to the session on screen and remembers its log, for the agent it was read from.
    applyRead(this.session, update);
    this.session.readAt = Date.now();
    this.rememberPath(sessionOf(t), this.session.path, this.session.hint);
    const last = this.session.messages[this.session.messages.length - 1];
    const id = last ? `${this.session.messages.length}:${last.kind}:${last.text ?? last.calls.length}:${last.calls?.at(-1)?.o?.length ?? 0}` : "";
    if (id !== this.lastId) { this.lastId = id; if (this.host.list.following) this.host.list.follow(); }
  }

  watch(cx, path) {
    // Reads again whenever the log's folder changes (agents on this computer).
    if (!path || path === this.watchedPath) return;
    this.watchedPath = path;
    const token = this.watchToken = (this.watchToken ?? 0) + 1;
    const dir = path.replace(/[\\/][^\\/]*$/, "");
    cx.spawn(async cx => {
      while (this.watchToken === token) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (this.watchToken !== token) return;
        if (changed.some(p => /\.jsonl$/i.test(p))) this.read(cx);
      }
    });
  }

  rememberPath(id, path, hint) {
    // Which log a session reads, kept across restarts (herdr's shared state), so it isn't searched for again.
    if (!id || !path) return;
    const all = { ...(shared(PATHS_KEY) ?? {}) };
    if (all[id]?.path === path && all[id]?.hint === (hint || "")) return;
    delete all[id];
    all[id] = { path, hint: hint || "" };
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete all[old];
    setShared(PATHS_KEY, all);
  }

  warm(cx, machines) {
    // Reads every other agent's session in the background (those on `machines`, or all), so switching to one shows it at once.
    if (this.warming) {
      this.warmNext = machines && this.warmNext !== 'all' ? new Set([...(this.warmNext ?? []), ...machines]) : 'all';
      return;
    }
    this.warming = true;
    cx.spawn(async cx => {
      try {
        const all = agentTargets(), live = new Set(), groups = new Map();
        for (const t of all) {
          const key = chatKey(t);
          live.add(key);
          if (key === this.key || !t.pid || (machines && !machines.has(t.machine))) continue;
          const s = this.sessions.get(key);
          const known = s ? null : (shared(PATHS_KEY) ?? {})[sessionOf(t)];
          const at = s ? { path: s.path, hint: s.hint, offset: s.offset, leaf: s.leaf } : { path: known?.path ?? "", hint: known?.hint ?? "", offset: 0, leaf: "" };
          at.peers = peersOf(t, all);
          const group = groups.get(t.machine) ?? [];
          group.push({ key, t, at, s });
          groups.set(t.machine, group);
        }
        await Promise.all([...groups].map(async ([machine, list]) => {
          let outs;
          try { outs = await runReaders(machine, list.map(x => [x.t, x.at])); } catch { return; }
          if (!outs) return;
          for (const [i, x] of list.entries()) {
            if (outs[i] == null || x.key === this.key || this.sessions.get(x.key) !== x.s) continue;
            const r = await parseReaderInSlices(outs[i], () => cx.sleep(0));
            if (!r.path || x.key === this.key || this.sessions.get(x.key) !== x.s) continue;
            const s = x.s ?? blankSession(x.at.path, x.at.hint);
            applyRead(s, r);
            s.readAt = Date.now();
            if (!x.s) this.sessions.set(x.key, s);
            this.rememberPath(sessionOf(x.t), s.path, s.hint);
          }
        }));
        this.trimSessions(live);
      } finally {
        this.warming = false;
        const next = this.warmNext;
        this.warmNext = null;
        if (next) this.warm(cx, next === 'all' ? undefined : next);
      }
    });
  }

  readCue() {
    // The row under the conversation while a read is slow: "checking", "silent" (no answer), or "".
    if (!this.session.messages.length) return "";
    const since = this.readStartedAt ? Date.now() - this.readStartedAt : 0;
    if (this.readError || since > SILENT_AFTER) return "silent";
    return since > CHECK_AFTER && this.readStaleFor > STALE_AFTER ? "checking" : "";
  }

  retry(cx) {
    // Retry on the "isn't answering" row: a new read, taking over from one that hangs.
    this.readError = ""; this.reading = null;
    this.read(cx);
    cx.notify();
  }
}
