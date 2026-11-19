const FOOTER = /enter to (select|confirm|submit)|↑\/↓|↑↓|to navigate|esc to cancel|esc (back|dismiss)/i;
const REVIEW = /ready to submit your answers\?/i;
const CHECKBOX = /^\[([ xX✓✔])\]\s*(.*)$/;
const NEXT_ROW = /^\s*(?:[❯›>▸➤]\s+)?Next$/;
const TEXT_ROW = /^(type something\.?|type your own answer|none of the above)$/i;
const CHAT_ROW = /^chat about this$/i;
const STEP_ROW = /\bsubmit\s*→?\s*$/i;
const CUT_STEP_ROW = /^\s*←\s.*[□☐■☑☒]/;
const REVIEW_TITLE = /^\s*review your answers\s*$/i;

export function promptText(screen) {
  // A screen's end as prompts are judged on: its lines with a picture's cells (kitty's placeholder characters, several to a cell) as one word, without the
  // padding a wide terminal puts at their end (or before a box's right border), then its last 4000 characters, so neither pushes a long prompt's top out.
  return screen.split("\n").map(l => l.replace(/(?:\u{10EEEE}\p{M}*)+/gu, "[picture]").replace(/\s+$/, "").replace(/\s{2,}([┃│])$/, " $1")).join("\n").trim().slice(-4000);
}

function screenLines(screen) {
  // The screen's lines without hc's notes, trailing space or the frame some harnesses draw around a prompt.
  return screen.replace(/\u00a0/g, " ").split("\n").filter(l => !l.startsWith("[hc]")).map(l => l.replace(/^\s*[┃│] ?/, "").replace(/\s*[┃│]?\s*$/, ""));
}

function pullPreview(screen) {
  // Takes a question's preview box off the lines it shares with the options: the screen without it, and what it showed (its text, how many lines it cut).
  const lines = screen.split("\n");
  let top = -1, bottom = -1;
  for (let y = lines.length - 1; y >= 0 && top < 0; y--) {
    if (bottom < 0 && /[└]─+[┘]\s*$/.test(lines[y])) bottom = y;
    else if (bottom >= 0 && /[┌]─+[┐]\s*$/.test(lines[y])) top = y;
  }
  if (top < 0) return { screen, preview: null };
  const text = [];
  let hidden = 0;
  for (let y = top; y <= bottom; y++) {
    const at = lines[y].search(/[┌│├└]/);
    if (at < 0) continue;
    const cell = lines[y].slice(at).trim();
    const cut = /(\d+) lines? hidden/.exec(cell);
    if (cut) hidden = Number(cut[1]);
    else if (cell[0] === "│") text.push(cell.slice(1).replace(/\s*│$/, "").replace(/^ /, ""));
    lines[y] = lines[y].slice(0, at).trimEnd();
  }
  for (let y = bottom + 1; y <= bottom + 3 && y < lines.length; y++) if (/^\s*Notes:/.test(lines[y])) lines[y] = "";
  return { screen: lines.join("\n"), preview: { text, hidden } };
}

function findFooter(lines, end) {
  // The line that closes a prompt, or -1. The review step has no footer, so its question closes it.
  for (let y = end; y >= Math.max(0, end - 6); y--) if (FOOTER.test(lines[y])) return y;
  for (let y = end; y >= Math.max(0, end - 6); y--) if (REVIEW.test(lines[y])) return lines.length;
  return -1;
}

export function looksLikePrompt(screen) {
  // Whether the screen ends like a prompt, even one whose choices can't be read.
  const lines = screenLines(screen);
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  return findFooter(lines, end) >= 0;
}

export function previewKey(prompt) {
  // What a preview belongs to: this question and the option the cursor is on.
  return `${prompt.sig}\u0000${prompt.options.find(o => o.selected)?.label ?? ""}`;
}

export function fullPreview(harness, screen, shown) {
  // The whole preview from a taller reading of the screen, when it's still the same question and option; null otherwise.
  const seen = parsePrompt(harness, screen);
  return seen?.preview && !seen.preview.hidden && previewKey(seen) === previewKey(shown) ? seen.preview.text : null;
}

export function parsePrompt(harness, screen) {
  // The prompt on an agent's screen, read the way its harness draws it. None for a harness whose form comes from its log (OMP's ask, see
  // ask-form.js): its other prompts show as the screen's last lines.
  return harness?.prompt?.form === "log" ? null : parseChoices(screen, harness?.prompt ?? {});
}

export function keysFor(harness, prompt, index) {
  // The keys that act on one option: its number where the harness takes one, else arrows from the selected one and Enter.
  const option = prompt.options[index];
  if (harness?.prompt?.byNumber) return option.next ? ["tab"] : [String(option.n)];
  if (option.next && option.hidden) return ["right"];
  return [...moves(prompt, index), "enter"];
}

function moves(prompt, index) {
  // The arrows from the selected option to one option.
  const from = prompt.options.findIndex(o => o.selected);
  return Array(Math.abs(index - from)).fill(index > from ? "down" : "up");
}

export function sameOption(a, b) {
  // Whether two readings of a prompt mean the same option, wherever a scrolled list puts it.
  return a.next ? Boolean(b.next) : a.input ? a.input === b.input : a.label === b.label;
}

export function typedAnswer(harness, prompt, index) {
  // The keys that put the cursor in a text row, ready for a typed answer.
  const option = prompt.options[index];
  const { byNumber, notes } = harness?.prompt ?? {};
  const to = byNumber ? [String(option.n)] : moves(prompt, index);
  if (option.input === "chat") return { before: [...to, "enter"] };
  return { before: notes ? [...to, "tab"] : to };
}

function reviewOf(lines, top, bottom) {
  // What a review page lists between two lines: its answers and any warning, or null on other pages.
  const from = lines.slice(top, bottom).findIndex(l => REVIEW_TITLE.test(l));
  if (from < 0 && !lines.slice(top, bottom + 1).some(l => REVIEW.test(l))) return null;
  const answers = [];
  let warning = "";
  for (const line of lines.slice(top, bottom)) {
    const asked = /^\s*●\s+(.+)$/.exec(line), given = /^\s*→\s+(.+)$/.exec(line), warned = /^\s*⚠\s*(.+)$/.exec(line);
    if (asked) answers.push({ question: asked[1].trim(), answer: "" });
    else if (given && answers.length) answers.at(-1).answer = given[1].trim();
    else if (warned) warning = warned[1].trim();
  }
  return { answers, warning };
}

function stepsOf(tabs) {
  // The steps in a prompt's tab row, each with whether it's answered.
  if (!tabs) return [];
  const bare = tabs.replace(/^←\s*/, "").replace(/\s*→$/, "").trim();
  return bare.split(/\s+(?=[□☐■☑☒✓✔])/).map(s => ({ label: s.replace(/^[□☐■☑☒✓✔]\s*/, ""), done: /^[■☑☒]/.test(s) }));
}

export function parseChoices(shown, { byNumber = false, columns = false } = {}) {
  const { screen, preview } = pullPreview(shown);
  const lines = screenLines(screen);
  const RULE = /^\s*[─━═]{8,}\s*$/;
  const SOFT_RULE = /^\s*[╌┄┈-]{8,}\s*$/;
  const CURSOR = /^(\s*)([❯›>▸➤])\s+(\S.*)$/;
  const NUMBERED = /^(\s*)(?:[❯›>▸➤]\s+)?(\d+)[.)]\s+(.+)$/;
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  const footer = findFooter(lines, end);
  if (footer < 0) return null;
  let y = footer - 1;
  let more = false;
  while (y >= 0 && (!lines[y].trim() || RULE.test(lines[y]) || /^\s*[↓↑]\s*$/.test(lines[y]))) { if (/↓/.test(lines[y])) more = true; y--; }
  const block = [];
  let numbered = null;
  for (; y >= 0 && footer - y < 40; y--) {
    const line = lines[y];
    const n = NUMBERED.exec(line), c = CURSOR.exec(line);
    if (numbered === null && preview && CHAT_ROW.test(line.replace(/^\s*[❯›>▸➤]?\s*/, ""))) { block.unshift({ y, line, chat: true }); continue; }
    if (numbered === null && preview && RULE.test(line)) continue;
    if (numbered !== false && NEXT_ROW.test(line)) { numbered = true; block.unshift({ y, line, next: true }); continue; }
    if (numbered !== false && n) { numbered = true; block.unshift({ y, line }); continue; }
    if (numbered === true && RULE.test(line)) continue;
    if (numbered === null && c) { numbered = false; block.unshift({ y, line }); continue; }
    if (numbered === false && block.length) {
      const col = CURSOR.exec(block.find(b => CURSOR.test(b.line))?.line ?? "")?.[1].length;
      const text = /^(\s*)(\S.*)$/.exec(line);
      if (c || (text && col != null && text[1].length === col + 2)) { block.unshift({ y, line }); continue; }
      break;
    }
    if (!line.trim() || /^\s{2,}\S/.test(line)) { block.unshift({ y, line, desc: true }); continue; }
    break;
  }
  while (block[0]?.desc) block.shift();
  const options = [];
  for (const b of block) {
    if (b.desc) {
      if (preview && options.length && /^\s{0,4}\S/.test(b.line)) options.at(-1).label += ` ${b.line.trim()}`;
      else if (options.length && b.line.trim()) options.at(-1).desc.push(b.line.trim());
      continue;
    }
    const n = NUMBERED.exec(b.line), c = CURSOR.exec(b.line);
    const selected = Boolean(c) || /^\s*[❯›>▸➤]/.test(b.line);
    if (b.next) { options.push({ n: null, label: "Next", desc: [], selected, next: true }); continue; }
    if (b.chat) { options.push({ n: null, label: b.line.replace(/^\s*[❯›>▸➤]?\s*/, "").trim(), desc: [], selected, input: "chat" }); continue; }
    const text = (n ? n[3] : c ? c[3] : b.line.trim()).trim();
    const box = CHECKBOX.exec(text);
    const [written, ...desc] = columns ? text.split(/\s{2,}/) : [box ? box[2] : text];
    const answered = /\s[✔✓]$/.test(written), label = written.replace(/\s[✔✓]$/, "");
    const input = TEXT_ROW.test(label) ? "text" : CHAT_ROW.test(label) ? "chat" : undefined;
    options.push({ n: n ? Number(n[2]) : options.length + 1, label, desc, selected, answered, ...(box ? { checked: box[1] !== " " } : {}), ...(input ? { input } : {}) });
  }
  if (options.at(-1)?.input === "chat" && options.at(-1).selected && preview) for (const o of options.slice(0, -1)) o.selected = false;
  const multi = options.some(o => o.checked !== undefined);
  if (more && !options.some(o => o.next || TEXT_ROW.test(o.label))) {
    options.push({ n: null, label: "Type something", desc: [], selected: false, input: "text", hidden: true, ...(multi ? { checked: false } : {}) });
    if (multi) options.push({ n: null, label: "Next", desc: [], selected: false, next: true, hidden: true });
  }
  const beforeNext = options[options.findIndex(o => o.next) - 1];
  if (beforeNext?.checked !== undefined && !beforeNext.hidden) {
    beforeNext.input = "text";
    beforeNext.typed = TEXT_ROW.test(beforeNext.label) ? "" : beforeNext.label;
  }
  if (byNumber && multi && !options.some(o => o.next)) options.push({ n: null, label: "Next", desc: [], selected: false, next: true });
  if (options.length < 2 || (!byNumber && options.filter(o => o.selected).length !== 1)) return null;
  const question = [];
  const asked = [];
  let tabs = null;
  for (let q = (block[0]?.y ?? footer) - 1, blanks = 0, whole = false; q >= 0 && question.length + asked.length < 16; q--) {
    const line = lines[q];
    if (RULE.test(line)) break;
    if (SOFT_RULE.test(line)) { whole = asked.length > 0; continue; }
    if (/^\s*[•●⎿⏺]/.test(line) || /^\s*[❯›]\s/.test(line)) break;
    if (!line.trim()) { whole = asked.length > 0; if (++blanks >= 2 && asked.length) break; continue; }
    blanks = 0;
    if (/^\s*Tip:/.test(line) || /^\s*[↑↓]\s*$/.test(line) || /^\s*[☐☒☑]\s+\S[^.?!]*$/.test(line)) continue;
    (whole ? question : asked).unshift(line.trim());
  }
  if (/^Question \d+\/\d+/.test(asked[0] ?? "")) tabs = asked.shift();
  question.push(asked.join(" "));
  let top = block[0].y;
  for (let q = block[0].y - 1; q >= 0 && block[0].y - q < 26; q--) {
    if ((STEP_ROW.test(lines[q]) && lines[q].trim().split(/\s{2,}/).length > 2) || CUT_STEP_ROW.test(lines[q])) { tabs = lines[q].trim(); top = q + 1; question.splice(0, question.indexOf(tabs) + 1); break; }
  }
  const review = reviewOf(lines, top, block[0].y);
  if (review) question.splice(0, question.length, "Review your answers");
  const sig = JSON.stringify([question, multi ? "multi" : options.map(o => o.input ? "" : o.label)]);
  return { question, tabs, steps: stepsOf(tabs), review, options, multi, more, preview, sig };
}
