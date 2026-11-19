import { appHome, exec } from "herdr";
import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { onWindows, python, modFile } from "./platform.js";
import { hash } from "./model/hash.js";

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
export const ATTACH_DIR = "cache/herdr-chat";
export function attachDir() { return onWindows() ? `${appHome()}\\cache\\herdr-chat` : `${appHome()}/${ATTACH_DIR}`; }
export const SENT_DIR = `${ATTACH_DIR}/sent`;
function sentDir() { return onWindows() ? `${attachDir()}\\sent` : `${appHome()}/${SENT_DIR}`; }
// Pictures an agent shows, in its replies and its ask forms, copied from its machine; pruned with the rest of the cache after a day.
export const PICTURE_DIR = `${ATTACH_DIR}/pictures`;
function pictureDir() { return onWindows() ? `${attachDir()}\\pictures` : `${appHome()}/${PICTURE_DIR}`; }

function cleanPart(s) { return String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "-"); }

export function previewName(path, machine) {
  // A placed image's name in sent/: its machine, its terminal's folder under files/, and its file name, so images named alike elsewhere stay apart.
  const parts = path.split(/[\\/]/);
  return `${cleanPart(machine) || "local"}~${cleanPart(parts.at(-2))}~${parts.at(-1)}`;
}

export async function keepSent(previews, placed, machine) {
  // Moves sent images' previews into sent/, under the names their placed paths give; returns the names kept.
  if (!previews.length) return [];
  await mkdir(sentDir(), { recursive: true }).catch(() => null);
  const kept = [];
  for (const [i, f] of previews.entries()) {
    const name = previewName(placed[i], machine);
    const bytes = await readFile(f).catch(() => null);
    if (!bytes) continue;
    // Herdr's writeFile can report success having written no bytes, so a preview only counts once it reads back whole; fetchSent makes one otherwise.
    const dest = `${sentDir()}/${name}`;
    await writeFile(dest, bytes).catch(() => null);
    const whole = await readFile(dest).then(back => back.length === bytes.length, () => false);
    if (whole) kept.push(name);
    else await unlink(dest).catch(() => null);
    await unlink(f).catch(() => null);
  }
  return kept;
}

const FETCH = `
import shutil, subprocess, sys
machine, path, dest = sys.argv[1:4]
if machine:
    read = "import sys;sys.stdout.buffer.write(open(sys.argv[1],'rb').read())"
    got = subprocess.run(["hc", "exec", "--on", machine, "python3", "-c", read, path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
    if got.returncode: sys.exit(1)
    open(dest, "wb").write(got.stdout)
    print(len(got.stdout))
else:
    shutil.copyfile(path, dest)
    import os
    print(os.path.getsize(dest))
`;
const SHRINK_OVER = 250000;

// A picture an agent shows is checked where it is, before a byte leaves its machine: a regular file (a link to one counts), at most
// PICTURE_LIMIT bytes, starting as a PNG, JPEG, GIF or WebP does. Anything else (a device, a folder, a key, a log) is never copied, and
// leaves nothing in the cache. The check runs in its own Python, there or here, bounded in time.
const PICTURE_LIMIT = 20 * 1024 * 1024;
const PICTURE_COPY = `
import subprocess, sys
machine, path, dest, limit = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
CHECK = r'''
import os, stat, sys
path, limit = sys.argv[1], int(sys.argv[2])
try:
    st = os.stat(path)
except OSError:
    sys.exit(2)
if not stat.S_ISREG(st.st_mode) or st.st_size > limit:
    sys.exit(3)
with open(path, "rb") as f:
    data = f.read(limit + 1)
head = data[:12]
if len(data) > limit or not (head.startswith(b"\\x89PNG\\r\\n\\x1a\\n") or head.startswith(b"\\xff\\xd8\\xff") or head[:6] in (b"GIF87a", b"GIF89a") or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")):
    sys.exit(4)
sys.stdout.buffer.write(data)
'''
run = ["hc", "exec", "--on", machine, "python3"] if machine else [sys.executable]
try:
    got = subprocess.run(run + ["-c", CHECK, path, limit], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
except Exception:
    sys.exit(1)
if got.returncode or not got.stdout:
    sys.exit(1)
open(dest, "wb").write(got.stdout)
print(len(got.stdout))
`;

async function shrink(dir, name) {
  // A big image in `dir` through the reply box's prepare script, as <name>.jpg in place of it; the name kept, or null when it can't be shrunk here.
  const source = `${dir}/${name}`;
  const r = await (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), "-Source", source, "-Folder", dir, "-Name", name])
    : exec("sh", [modFile("prepare-image.sh"), source, dir, name])).catch(() => null);
  const made = (r?.stdout ?? "").trim().split(/\r?\n/).pop().split(/[\\/]/).pop();
  if (r?.code === 0 && made === `${name}.jpg`) { await unlink(source).catch(() => null); return made; }
  if (made && made !== name) await unlink(`${dir}/${made}`).catch(() => null);
  return null;
}

async function copyIn(dir, name, path, machine, program = [FETCH]) {
  // Copies the file at `path` on its machine (null: this one) into `dir` as `name` with `program` (FETCH, or PICTURE_COPY with its limit),
  // shrunk when big; the file's name there, or null, leaving nothing behind.
  await mkdir(dir, { recursive: true }).catch(() => null);
  const r = await python(["-c", program[0], machine ?? "", path, `${dir}/${name}`, ...program.slice(1)]).catch(() => null);
  if (!r || r.code !== 0) { await unlink(`${dir}/${name}`).catch(() => null); return null; }
  return Number(r.stdout) > SHRINK_OVER ? (await shrink(dir, name).catch(() => null)) ?? name : name;
}

export async function fetchSent(path, machine) {
  // Copies an image herdr placed beside a terminal, on its machine (null: this one), into sent/, shrunk when big; the file's name there, or null.
  return copyIn(sentDir(), previewName(path, machine), path, machine);
}

export function picturePath(src, cwd) {
  // Where a picture an agent shows (an <img> or ![]() source) is on its machine: its path, from the session's folder when relative; null
  // for one that isn't a file there (a web address, inline data).
  if (/^(https?|data):/i.test(src)) return null;
  let path = src.replace(/^file:\/\//i, "");
  try { if (path !== src) path = decodeURIComponent(path); } catch {}
  if (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) return path;
  return cwd ? `${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}` : null;
}

export function pictureName(path, machine, owner) {
  // A picture's file name in pictures/: its machine, a digest of its path and of what shows it (`owner`: the reply or the ask), and its own
  // name. A path shown again by a later reply is copied again, as the file there may have changed since.
  const file = path.split(/[\\/]/).pop(), dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  return `${cleanPart(machine) || "local"}~${hash(`${path}\n${owner}`)}~${cleanPart(stem).slice(-40)}${ext ? `.${ext}` : ""}`;
}

const PICTURES = new Map(), NOT_A_FILE = Object.freeze({ state: "none" });
let pictureChanges = 0;
// A session's history can show many pictures at once: at most this many are copied at a time.
const COPYING_AT_ONCE = 3;
let copying = 0;
const waiting = [];

export function pictureFor(src, cwd, machine, owner) {
  // A picture an agent shows, as the chat can draw it: { state: "none" } for one that isn't a file on the agent's machine; "fetching" the
  // first time it's asked for, while it's copied into pictures/ (kept there from an earlier run when it still is) and measured; then
  // "ready" with `rel` (for image()), `width` and `height`, or "failed". picturesChanged() tells when one has arrived.
  const path = picturePath(String(src ?? ""), cwd);
  if (!path) return NOT_A_FILE;
  const name = pictureName(path, machine, owner);
  let p = PICTURES.get(name);
  if (!p) {
    p = { state: "fetching" };
    PICTURES.set(name, p);
    loadPicture(p, name, path, machine);
  }
  return p;
}

async function loadPicture(p, name, path, machine) {
  // A slot freed by one copy passes straight to the next waiting, so no more than COPYING_AT_ONCE ever run.
  if (copying >= COPYING_AT_ONCE) await new Promise(go => waiting.push(go));
  else copying++;
  try {
    const kept = (await readdir(pictureDir()).catch(() => [])).find(f => f === name || f === `${name}.jpg`);
    const file = kept ?? await copyIn(pictureDir(), name, path, machine, [PICTURE_COPY, String(PICTURE_LIMIT)]);
    const bytes = file ? await readFile(`${pictureDir()}/${file}`).catch(() => null) : null;
    const size = bytes ? imageSize(new Uint8Array(bytes)) : null;
    if (size?.width && size.height) Object.assign(p, { state: "ready", rel: `${PICTURE_DIR}/${file}`, ...size });
    else {
      // A file the checks let through that still can't be measured goes too: nothing stays that isn't drawn.
      if (file) await unlink(`${pictureDir()}/${file}`).catch(() => null);
      p.state = "failed";
    }
  } catch {
    p.state = "failed";
  } finally {
    const next = waiting.shift();
    if (next) next();
    else copying--;
  }
  pictureChanges++;
}

export function picturesChanged() {
  // A count that goes up each time a picture has arrived or failed: a view drawing pictures redraws when it moves.
  return pictureChanges;
}

export function previewFile(sent, path, machine) {
  // The file in sent/ that shows a placed image, as `sent` lists them: under its preview name, or that with .jpg when it was shrunk; null when there's none.
  const name = previewName(path, machine);
  return sent?.has(name) ? name : sent?.has(`${name}.jpg`) ? `${name}.jpg` : null;
}

export async function sentNames() {
  // The previews in sent/.
  return readdir(sentDir()).catch(() => []);
}

export function staleSent(names, listing) {
  // The previews whose terminal is gone, from `hc ls --all --json`; a machine that isn't connected keeps its own, since its terminals only look gone.
  if (!Array.isArray(listing?.machines) || !Array.isArray(listing?.terminals)) return [];
  const down = new Set(listing.machines.filter(m => m.state !== "connected").map(m => cleanPart(m.name)));
  const live = new Set(listing.terminals.map(t => {
    const at = t.address.lastIndexOf("/");
    return at < 0 ? `local~${cleanPart(t.address)}` : `${cleanPart(t.address.slice(0, at))}~${cleanPart(t.address.slice(at + 1))}`;
  }));
  return names.filter(n => {
    const [machine, terminal] = n.split("~");
    return !down.has(machine) && !live.has(`${machine}~${terminal}`);
  });
}

export async function dropSent(names) {
  // Deletes these previews from sent/.
  await Promise.all(names.map(n => unlink(`${sentDir()}/${n}`).catch(() => null)));
}

export function imageSize(bytes) {
  // A PNG's, GIF's, JPEG's or WebP's width and height in pixels, from its bytes; null for any other file.
  const b = bytes, pair = at => (b[at] << 8) | b[at + 1], low = (at, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + b[at + i]; return v; };
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === "VP8X") return { width: low(24, 3) + 1, height: low(27, 3) + 1 };
    if (kind === "VP8L") { const v = low(21, 4); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8 ") return { width: low(26, 2) & 0x3fff, height: low(28, 2) & 0x3fff };
    return null;
  }
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) return { width: pair(16) * 65536 + pair(18), height: pair(20) * 65536 + pair(22) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let at = 2; at + 8 < b.length; at += 2 + pair(at + 2)) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    // A start-of-frame segment holds the size; C4, C8 and CC are tables in the same range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: pair(at + 7), height: pair(at + 5) };
  }
  return null;
}

export function attachName(source) {
  // A unique name for the preview copy, without its extension (the prepare script picks it).
  const base = source.split(/[\\/]/).pop().replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(-40) || "image";
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${base}`;
}
