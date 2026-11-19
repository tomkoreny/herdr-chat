// OMP's ask form as the chat answers it. The form itself comes from the session's log (ask-html.js reads the call's
// HTML as OMP does); OMP draws it in the terminal and takes the answers there, so the chat fills the terminal's
// form in, key by key, and presses its Submit.
//
// The keys don't depend on how OMP draws the form (18.22 shows every field, 19 folds all but the one in focus),
// only on what both do with them: the form's stops are, in order, each text field, each dropdown, each enabled
// option of a radio or checkbox group and the group's Other row, then Submit; ↑ and ↓ move one stop, Shift+Tab
// goes back a field and stays in the first, Space picks a radio button or flips a checkbox, ← and → step a
// dropdown, and a text field takes what is typed. So the walk starts at the first stop and goes down once
// through all of them, setting each as the answers have it, whatever the terminal's form held before. Only a
// checkbox can't be set outright: its group's boxes are read from the screen first, and flipped where they differ.

import { plain } from "./ask-html.js";

const KEY = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", back: "\x1b[Z", home: "\x1b[H", space: " " };
// Empties a text field wherever its cursor is: each line's end and the break after it, then each line's start and the break before it.
const CLEAR = "\x0b\x1b[3~".repeat(64) + "\x15\x7f".repeat(64);
const CURSOR = "(?:\uF054|❯|>)";
const BOX_ROW = new RegExp(`^\\s*(${CURSOR}\\s+)?(\uF14A|\uF096|☑|☐|\\[x\\]|\\[ \\])\\s(.*)$`);
const TICKED = new Set(["\uF14A", "☑", "[x]"]);
const PANEL_TOP = /^\s*╭─ Ask(?: · [^─(]*?)?(?: \(\d+s\))? ─/;
const HIDDEN_ROW = /^\s*Ask(?: · [^:(]*?)?(?: \(\d+s\))? hidden:/;

function paste(text) {
  // Text as a terminal pastes it, without the control characters that would end the paste or press keys.
  const clean = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  return clean ? `\x1b[200~${clean}\x1b[201~` : "";
}

export function isDropdown(field) {
  // A single <select>: one row stepped through, not a list of options.
  return field.kind === "choice" && field.select && !field.multi;
}

export function formStops(form) {
  // Where the terminal's form stops, in its order: { kind: text | select | option | other | submit, field, option }.
  const stops = [];
  form.fields.forEach((f, field) => {
    if (f.kind === "text") stops.push({ kind: "text", field });
    else if (isDropdown(f)) { if (f.options.some(o => !o.disabled)) stops.push({ kind: "select", field }); }
    else {
      f.options.forEach((o, option) => { if (!o.disabled) stops.push({ kind: "option", field, option }); });
      if (f.other) stops.push({ kind: "other", field });
    }
  });
  stops.push({ kind: "submit" });
  return stops;
}

export function reachable(form) {
  // Whether each field has a stop: one with only disabled options can't be answered, here or in the terminal.
  const fields = new Set(formStops(form).map(s => s.field));
  return form.fields.map((_f, i) => fields.has(i));
}

export function blankAnswers(form) {
  // The answers the form opens with: a text field's value; a choice's checked options (a radio group's last one) and no Other.
  return form.fields.map(f => {
    if (f.kind === "text") return f.value;
    const checked = f.options.flatMap((o, i) => o.checked ? [i] : []);
    return { checked: f.multi ? checked : checked.slice(-1), other: "" };
  });
}

export function otherCounts(field, answer) {
  // Whether a group's Other is part of its answer: it has text and, in a radio group, no option is picked.
  return Boolean(field.other && answer.other.trim() && (field.multi || !answer.checked.length));
}

export function answerValue(field, answer) {
  // What a field submits for an answer, as OMP reports it: a text (a number for a number field), a choice's value, a checkbox group's list; undefined for none.
  if (field.kind === "text") {
    const n = (field.type === "number" || field.type === "range") && answer.trim() !== "" ? Number(answer) : NaN;
    return Number.isFinite(n) ? n : answer;
  }
  const values = field.options.flatMap((o, i) => answer.checked.includes(i) && !o.disabled ? [o.value] : []);
  const typed = otherCounts(field, answer) ? answer.other.trim() : "";
  if (field.multi && field.options.length > 1) return typed ? [...values, typed] : values;
  return typed || values[0];
}

function matches(pattern, text) {
  // Whether `text` is all of `pattern`, as HTML matches one; true for a pattern that isn't a regular expression.
  for (const flags of ["v", "u", ""]) {
    try { return new RegExp(`^(?:${pattern})$`, flags).test(text); } catch {}
  }
  return true;
}

function isUrl(text) {
  try { new URL(text); return true; } catch { return false; }
}

export function fieldError(field, answer) {
  // Why OMP would refuse this answer on Submit (in its words), or "".
  const value = answerValue(field, answer);
  if (field.kind === "choice") {
    const empty = value === undefined || (Array.isArray(value) && !value.length);
    return field.required && empty ? (field.multi && field.options.length > 1 ? "Select at least one" : "Required") : "";
  }
  const text = String(value);
  if (!text.trim()) return field.required ? "Required" : "";
  if (field.type === "number" || field.type === "range") {
    const n = Number(text);
    if (!Number.isFinite(n)) return "Enter a number";
    if (field.min !== undefined && n < field.min) return `Must be at least ${field.min}`;
    if (field.max !== undefined && n > field.max) return `Must be at most ${field.max}`;
  }
  if (field.minLength !== undefined && text.length < field.minLength) return `Needs at least ${field.minLength} characters`;
  if (field.maxLength !== undefined && text.length > field.maxLength) return `At most ${field.maxLength} characters`;
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+$/.test(text)) return "Enter an email address";
  if (field.type === "url" && !isUrl(text)) return "Enter a full URL";
  if (field.pattern && !matches(field.pattern, text)) return `Must match ${field.pattern.length > 40 ? `${field.pattern.slice(0, 39)}…` : field.pattern}`;
  return "";
}

export function formData(form, answers) {
  // The data OMP reports for these answers, by field name (hidden inputs aside).
  const data = {};
  form.fields.forEach((f, i) => {
    const value = f.name ? answerValue(f, answers[i]) : undefined;
    if (value !== undefined) data[f.name] = value;
  });
  return data;
}

export function formProgram(form, answers) {
  // What to type into the terminal's form so it holds `answers`, ending with the cursor on Submit: strings to write one after another, each
  // taken in by OMP before the next, and { checks: field } where a checkbox group's boxes are read first and checkKeys says what to press.
  // The writes are as few as the form allows (a waiting OMP redraws without pause, so each one costs a wait of its own): the way to the
  // first stop, then the fields in one, cut only where OMP must have drawn what came before. The group is read with the cursor on its last
  // stop: 19 scrolls a tall form only as far as the stop in focus, and from the last one back up to the group's head when that fits, so
  // that's where the screen shows the group whole.
  const stops = formStops(form), steps = [];
  const lead = stops.findIndex(s => s.field !== stops[0].field);
  let keys = "";
  const cut = () => { if (keys) steps.push(keys); keys = ""; };
  // To the first stop: ↑ gives the form the keys when OMP's reply box holds them, Shift+Tab once per field reaches the first field, at its
  // first stop (18.22) or at its answer (19), from where ↑ can't overshoot the top. Those ↑ can leave 19 peeking at rows above, which eats
  // the next ↓ or Space; Home ends that, and does nothing else on an option in either (Page Up would turn 18.22's page).
  keys = KEY.up + KEY.back.repeat(form.fields.length + 2) + KEY.up.repeat(Math.max(0, lead - 1)) + (lead > 1 ? KEY.home : "");
  cut();
  form.fields.forEach((f, i) => {
    const mine = stops.filter(s => s.field === i), a = answers[i];
    if (!mine.length) return;
    if (f.kind === "text") { keys += CLEAR + paste(a) + KEY.down; return; }
    if (mine[0].kind === "select") {
      const want = f.options.slice(0, a.checked[0] ?? 0).filter(o => !o.disabled).length;
      keys += KEY.left.repeat(f.options.length) + KEY.right.repeat(want) + KEY.down;
      return;
    }
    const options = mine.filter(s => s.kind === "option");
    if (f.multi && options.length) { keys += KEY.down.repeat(mine.length - 1); cut(); steps.push({ checks: i }); }
    else if (options.length) keys += options.map(s => (a.checked.includes(s.option) ? KEY.space : "") + KEY.down).join("");
    if (!f.other) return;
    // A radio group's Other is emptied in one write and typed in the next: OMP notices that it was typed (which unpicks the group's
    // option) only by its text having changed since it last drew the row, so the same text typed over itself at once would go unseen.
    const text = otherCounts(f, a) ? a.other.trim() : "";
    keys += CLEAR;
    if (text && !f.multi) cut();
    keys += paste(text) + KEY.down;
  });
  cut();
  return steps;
}

function screenRows(screen) {
  // The screen's rows without the frame OMP draws around the form.
  return String(screen ?? "").replace(/\u00a0/g, " ").split("\n").map(l => l.replace(/^\s*│ ?/, "").replace(/\s*│?\s*$/, ""));
}

function sameStart(shown, label) {
  // Whether a row's text begins as a label does, by their letters and digits (the screen spaces, cuts and decorates a label its own way).
  const letters = text => String(text ?? "").replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12).toLowerCase();
  const a = letters(shown), b = letters(label), n = Math.min(a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

export function checkKeys(form, index, answer, screen) {
  // The keys that set a checkbox group's boxes as `answer` has them, from how the terminal shows the group now: ↑ back to the first box,
  // then Space where a box differs and ↓ past each. null unless the screen shows this very group whole, with the cursor on its last stop,
  // where the keys typed before leave it: every option under its own label, then the Other row. A screen read before OMP has drawn
  // those keys shows the cursor elsewhere, or in another group, and is to be read again.
  const rows = screenRows(screen), field = form.fields[index];
  const at = rows.findLastIndex(l => BOX_ROW.exec(l)?.[1]);
  if (at < 0) return null;
  const part = l => BOX_ROW.test(l) || /^\s{4,}\S/.test(l);
  let top = at, end = at;
  while (top > 0 && part(rows[top - 1])) top--;
  while (end + 1 < rows.length && part(rows[end + 1])) end++;
  const shown = rows.slice(top, end + 1).map(l => BOX_ROW.exec(l)).filter(Boolean);
  const labels = [...field.options.map(o => plain(o.label)), ...(field.other ? ["Other"] : [])];
  if (shown.length !== labels.length || shown.some((m, i) => !sameStart(m[3], labels[i]))) return null;
  const last = field.other ? labels.length - 1 : field.options.findLastIndex(o => !o.disabled);
  if (!shown[last]?.[1]) return null;
  const stops = field.options.filter(o => !o.disabled).length + (field.other ? 1 : 0);
  return KEY.up.repeat(stops - 1)
    + field.options.map((o, i) => o.disabled ? "" : (TICKED.has(shown[i][2]) !== answer.checked.includes(i) ? KEY.space : "") + KEY.down).join("");
}

export function askState(screen) {
  // What the terminal shows of an ask form: `panel` when its box is on screen, `submit` when the cursor is on its Submit row, `hidden` when
  // it's folded to its one row (Enter opens it again), `note` while a note on an option is being written there (the keys go to the note).
  // The box is the last one titled Ask whose edge starts its row: a picture that doesn't fit is drawn as a frame of its own inside it.
  const rows = String(screen ?? "").replace(/\u00a0/g, " ").split("\n");
  const top = rows.findLastIndex(l => PANEL_TOP.test(l));
  const below = top < 0 ? [] : rows.slice(top + 1), end = below.findIndex(l => /^\s*╰/.test(l));
  const inside = screenRows((end < 0 ? below : below.slice(0, end)).join("\n"));
  return {
    panel: top >= 0,
    submit: inside.some(l => new RegExp(`^\\s*${CURSOR}\\s+Submit\\b`).test(l)),
    hidden: top < 0 && rows.slice(-12).some(l => HIDDEN_ROW.test(l)),
    note: inside.some(l => /^\s{2,}Note for .+ · \S/.test(l)),
  };
}
