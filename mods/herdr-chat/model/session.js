import { foldActivity, CALL_SOURCE } from "./transcript.js";
import { mergeStatus } from "./status.js";

export function blankSession(path = "", hint = "") {
  // A session's state before anything is read.
  return { raw: [], calls: new Map(), offset: 0, leaf: "", path, hint, messages: [], clipped: false, note: "", open: {}, readAt: 0, status: null };
}

export function parseReader(stdout) {
  // The reader's output as one update: its tags, and the entries it read, in order.
  const r = blankUpdate();
  for (let at = 0; at <= stdout.length; ) at = parseLine(r, stdout, at);
  return r;
}

export async function parseReaderInSlices(stdout, pause, sliceMs = 15) {
  // parseReader in slices of about `sliceMs`, with `pause()` between them, so herdr doesn't stop a long read.
  const r = blankUpdate();
  let since = Date.now();
  for (let at = 0; at <= stdout.length; ) {
    at = parseLine(r, stdout, at);
    if (Date.now() - since > sliceMs) { await pause(); since = Date.now(); }
  }
  return r;
}

function blankUpdate() {
  return { path: null, hint: null, note: "", offset: null, leaf: null, reset: false, need: false, status: null, added: [] };
}

function parseLine(r, stdout, at) {
  // Reads the line of `stdout` starting at `at` into `r`; returns where the next line starts.
  let end = stdout.indexOf("\n", at);
  if (end < 0) end = stdout.length;
  const line = stdout.charCodeAt(end - 1) === 13 ? stdout.slice(at, end - 1) : stdout.slice(at, end);
  parseTagged(r, line);
  return end + 1;
}

function parseTagged(r, line) {
  // One tagged line of the reader's output (PATH, NOTE, M, C, O, …) into `r`.
  const bar = line.indexOf("|"), tag = bar < 0 ? line : line.slice(0, bar), rest = line.slice(bar + 1);
  if (tag === "PATH") r.path = decodeURIComponent(rest);
  else if (tag === "HINT") r.hint = decodeURIComponent(rest);
  else if (tag === "NOTE") r.note = decodeURIComponent(rest);
  else if (tag === "OFFSET") r.offset = Number(rest) || 0;
  else if (tag === "LEAF") r.leaf = decodeURIComponent(rest);
  else if (tag === "RESET") r.reset = true;
  else if (tag === "NEED") r.need = true;
  else if (tag === "STATUS") r.status = JSON.parse(decodeURIComponent(rest));
  else if (tag === "R") r.added.push({ kind: "reasoning", text: decodeURIComponent(rest) });
  else if (tag === "C") {
    const [id, json] = rest.split("|");
    r.added.push({ kind: "call", id: decodeURIComponent(id), call: JSON.parse(decodeURIComponent(json)) });
  } else if (tag === "O") {
    const [id, ...text] = rest.split("|");
    r.added.push({ kind: "out", id: decodeURIComponent(id), text: decodeURIComponent(text.join("|")) });
  } else if (tag === "M") {
    const [role, phase, text = "", images] = rest.split("|");
    let body = decodeURIComponent(text);
    if (role === "user") body = body.replace(/^\s*<hc from="[^"]*"[^>]*>([\s\S]*?)<\/hc>\s*$/, "$1");
    const m = { kind: "message", role, phase, text: body };
    if (images) m.images = JSON.parse(decodeURIComponent(images));
    r.added.push(m);
  }
}

export function applyRead(s, r) {
  // Applies the reader's update `r` to session `s`: new entries added, rows rebuilt, note set.
  if (r.hint != null) s.hint = r.hint;
  if (r.offset != null) s.offset = r.offset;
  if (r.leaf != null) s.leaf = r.leaf;
  const path = r.path ?? s.path;
  if (r.reset || path !== s.path) { s.raw = []; s.calls = new Map(); s.status = null; }
  s.status = mergeStatus(s.status, r.status);
  s.path = path;
  for (const e of r.added) {
    if (e.kind === "call") { s.raw.push(e); if (e.id) s.calls.set(e.id, e.call); }
    else if (e.kind === "out") { const c = s.calls.get(e.id); if (c) c.o = e.text; }
    else s.raw.push(e);
  }
  if (s.raw.length > 600) s.raw = s.raw.slice(-500);
  const shaped = [];
  for (const e of s.raw) {
    if (e.kind !== "call") { shaped.push(e); continue; }
    const last = shaped[shaped.length - 1];
    const copy = { ...e.call };
    CALL_SOURCE.set(copy, e.call);
    if (last?.kind === "tools") last.calls.push(copy); else shaped.push({ kind: "tools", calls: [copy] });
  }
  s.messages = foldActivity(shaped);
  if (r.note || r.reset) {
    s.clipped = r.note.startsWith("Showing the recent part");
    s.note = s.clipped ? "" : r.note;
  } else if (s.note && s.messages.length) s.note = "";
}

const REMOTE_TAIL_MB = 6;
const REMOTE_ENTRIES = 150;

export function readerArgs(t, at) {
  // The reader's arguments for a terminal, from where its session was last read.
  const args = ["--app", t.harness.reader, "--label", t.label, "--pid", String(t.pid), "--created", String(t.created), "--offset", String(at.offset || 0)];
  if (at.screen != null) args.push("--screen", at.screen);
  if (at.peers) args.push("--peers", String(at.peers));
  if (t.cwd) args.push("--cwd", t.cwd);
  if (at.path) args.push("--known", at.path);
  if (at.hint) args.push("--hint", at.hint);
  if (at.leaf) args.push("--leaf", at.leaf);
  if (t.remote) args.push("--tail", String(REMOTE_TAIL_MB), "--entries", String(REMOTE_ENTRIES));
  return args;
}

const SPLIT = "--herdr-chat-session--";

export function embeddedReader(readerBase64) {
  // A Python expression for the reader's code, carried whole in the command: for machines that don't have the mod's files.
  return `compile(__import__('base64').b64decode('${readerBase64}'),'read_session.py','exec')`;
}

function folderSource(folderBase64) {
  // A Python expression for the reader's source, joined from readers/ in manifest order.
  return `(lambda d:'\\n'.join(open(d+'/'+f,encoding='utf-8').read() for f in __import__('json').load(open(d+'/manifest.json'))))(__import__('base64').b64decode('${folderBase64}').decode('utf-8'))`;
}

export function readerFromFolder(folderBase64) {
  // A Python expression for the reader's code, loaded from readers/: short enough for Windows' 32767-character command line, which the whole reader isn't.
  return `compile(${folderSource(folderBase64)},'read_session.py','exec')`;
}

export function compressProgram(folderBase64) {
  // A `python3 -c` program that prints the reader's source, compressed, for compressedReader.
  return `import base64,zlib;print(base64.b64encode(zlib.compress(${folderSource(folderBase64)}.encode('utf-8'),9)).decode())`;
}

export function compressedReader(zlibBase64) {
  // A Python expression for the reader's code, compressed in the command: how Windows, with its short command line, sends it to other machines.
  return `compile(__import__('zlib').decompress(__import__('base64').b64decode('${zlibBase64}')),'read_session.py','exec')`;
}

export function readerProgram(code) {
  // A `python3 -c` program that runs the reader once, with the arguments that follow it.
  return `import sys;sys.argv[0]='read_session';exec(${code})`;
}

export function batchProgram(code) {
  // A `python3 -c` program that runs the reader once per argument list, in one process for all of a machine's agents.
  return [
    "import base64,io,json,sys",
    `code=${code}`,
    "for argv in json.loads(base64.b64decode(sys.argv[1]).decode('utf-8')):",
    "  buf=io.StringIO(); real=sys.stdout; sys.stdout=buf",
    "  try:",
    "    sys.argv=['read_session']+argv; exec(code,{'__name__':'read_session'})",
    "  except SystemExit: pass",
    "  except Exception as e: buf=io.StringIO(); buf.write('ERROR|'+repr(e)+'\\n')",
    "  finally: sys.stdout=real",
    `  sys.stdout.write(${JSON.stringify(SPLIT)}+'\\n'+buf.getvalue())`,
  ].join("\n");
}

export function splitBatch(stdout) {
  // A batch run's output, split into each session's own (in the order they were asked for).
  return stdout.split(new RegExp(SPLIT + "\\r?\\n")).slice(1);
}
