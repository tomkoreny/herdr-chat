import { onWindows } from "../platform.js";
import claudeCode from "./claude-code.js";
import codex from "./codex.js";
import pi from "./pi.js";
import opencode from "./opencode.js";
import omp from "./omp.js";

export const HARNESSES = Object.fromEntries([claudeCode, codex, pi, opencode, omp].map(h => [h.id, h]));
export const SUPPORTED = Object.fromEntries(Object.values(HARNESSES).map(h => [h.id, h.label]));

export function harnessFor(app) {
  // The adapter for an agent's app, or null when the chat doesn't support it.
  return HARNESSES[app] ?? null;
}

export function supportedNames() {
  // The supported harnesses' names as one phrase: "A, B or C".
  const names = Object.values(HARNESSES).map(h => h.label);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names.join("");
}

export function imageStyle(h) {
  // How this harness gets images here: pasting needs a pty, so on Windows a pasting harness gets the plain path.
  const style = h?.images ?? "path";
  return style === "paste" && onWindows() ? "path" : style;
}

export function canMirror(h) {
  // Whether the chat and this harness's own box keep one draft (input-box.py needs a pty: not on Windows).
  return Boolean(h?.mirror) && !onWindows();
}

function mention(path) { return /\s/.test(path) ? `@"${path}"` : `@${path}`; }

export function withImages(h, paths, text) {
  // The message as sent: images named the harness's way ahead of the text (pasted ones went first).
  if (!paths.length) return text;
  const style = imageStyle(h);
  if (style === "paste") return text;
  const refs = paths.map(p => style === "mention" ? mention(p) : p);
  return [refs.join(" "), text].filter(Boolean).join(" ");
}

export function draftPastes(h, paths, text) {
  // The chat's draft as the harness's own box shows it.
  if (h.images === "paste") return { pastes: [...paths, text], pasted: text };
  const refs = paths.map(p => h.images === "mention" ? mention(p) : p);
  const pasted = [refs.join(" "), text].filter(Boolean).join(" ");
  return { pastes: [pasted], pasted };
}

export function textOfBox(h, box) {
  // What the text became in the box, the images left out (pasted images show as placeholders).
  return h.images === "paste" ? box.replace(/\[Image #\d+\]\s?/g, "").trim() : box;
}

export function readBack(h, box, m) {
  // The harness's box read back into the chat's draft.
  let s = box;
  if (m && m.textBox && m.textBox !== m.pasted && s.includes(m.textBox)) s = s.replace(m.textBox, m.pasted);
  const kept = [];
  let foreign = false;
  const ours = i => (m && i >= 0 && i < m.images.length ? m.images[i] : null);
  if (h.images === "paste") {
    s = s.replace(/\[Image #(\d+)\]\s?/g, (all, k) => { const a = ours(Number(k) - 1); if (a) { kept.push(a); return ""; } foreign = true; return all; });
  } else if (h.images === "mention") {
    s = s.replace(/@"([^"]+)"\s?|@(\S+)\s?/g, (all, quoted, bare) => { const a = ours(m ? m.paths.indexOf(quoted ?? bare) : -1); if (a) { kept.push(a); return ""; } return all; });
    if (/\[Image #\d+\]/.test(s)) foreign = true;
  } else if (m) {
    m.paths.forEach((path, i) => { if (s.includes(path)) { kept.push(m.images[i]); s = s.replace(path, "").replace(/^\s+/, ""); } });
  }
  return { text: s.replace(/^\s+/, ""), kept, foreign };
}
