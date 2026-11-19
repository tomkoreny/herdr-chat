import { readFileSync } from "fs";
import { formStops, blankAnswers, answerValue, fieldError, formData, formProgram, checkKeys, askState } from "../mods/herdr-chat/model/ask-form.js";
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const screen = name => readFileSync(new URL(`fixtures/prompts/${name}.txt`, import.meta.url), "utf8");

const label = text => [{ t: text }];
const option = (value, extra = {}) => ({ value, label: label(value), checked: false, disabled: false, ...extra });
const choice = (name, options, extra = {}) => ({ kind: "choice", name, multi: false, select: false, other: true, label: [], options, required: false, ...extra });
const input = (name, extra = {}) => ({ kind: "text", name, type: "text", multiline: false, label: label(name), value: "", placeholder: "", required: false, rows: 1, ...extra });
const form = {
  sections: [],
  fields: [
    choice("size", [option("s", { checked: true }), option("m", { disabled: true }), option("l")]),
    input("notes", { type: "textarea", multiline: true, value: "one\ntwo", rows: 3 }),
    choice("extras", [option("cheese", { checked: true }), option("ham"), option("olives")], { multi: true }),
    choice("region", [option("eu", { disabled: true }), option("us", { checked: true }), option("asia")], { select: true, other: false }),
    input("age", { type: "number", min: 1, max: 120 }),
    choice("agree", [option("on")], { multi: true, other: false }),
  ],
};

check("the form stops at each enabled option and Other row, each text field and dropdown, then Submit",
  formStops(form).map(s => [s.kind, s.field, s.option].filter(x => x !== undefined).join(":")),
  ["option:0:0", "option:0:2", "other:0", "text:1", "option:2:0", "option:2:1", "option:2:2", "other:2", "select:3", "text:4", "option:5:0", "submit"]);
check("it opens with the form's own answers", blankAnswers(form), [{ checked: [0], other: "" }, "one\ntwo", { checked: [0], other: "" }, { checked: [1], other: "" }, "", { checked: [], other: "" }]);
check("a radio group reports its option, or its Other when no option is picked; a checkbox group its list with its Other; a number field a number",
  [answerValue(form.fields[0], { checked: [2], other: "x" }), answerValue(form.fields[0], { checked: [], other: " mine " }), answerValue(form.fields[0], { checked: [], other: " " }),
    answerValue(form.fields[2], { checked: [0, 2], other: "own" }), answerValue(form.fields[5], { checked: [0], other: "" }), answerValue(form.fields[4], "42"), answerValue(form.fields[4], "")],
  ["l", "mine", null, ["cheese", "olives", "own"], "on", 42, ""].map(v => v === null ? undefined : v));
check("the data is keyed by name, a field without an answer left out",
  formData(form, [{ checked: [], other: "" }, "n", { checked: [], other: "" }, { checked: [2], other: "" }, "7", { checked: [], other: "" }]),
  { notes: "n", extras: [], region: "asia", age: 7 });

const wrong = (field, answer) => fieldError({ ...field, required: true }, answer);
check("OMP's checks on Submit are made here first, in its words",
  [wrong(form.fields[0], { checked: [], other: "" }), wrong(form.fields[2], { checked: [], other: " " }), wrong(form.fields[5], { checked: [], other: "" }), wrong(form.fields[1], "  "),
    fieldError(form.fields[4], "x"), fieldError(form.fields[4], "0"), fieldError(form.fields[4], "121"), fieldError(form.fields[4], "5"), fieldError(form.fields[4], ""),
    fieldError(input("e", { type: "email" }), "nope"), fieldError(input("u", { type: "url" }), "example.com"), fieldError(input("u", { type: "url" }), "https://example.com"),
    fieldError(input("p", { pattern: "[a-z]+-\\d" }), "abc-12"), fieldError(input("p", { pattern: "[a-z]+-\\d" }), "abc-1"), fieldError(input("p", { pattern: "(" }), "anything"),
    fieldError(input("l", { minLength: 3 }), "ab"), fieldError(input("l", { maxLength: 3 }), "abcd")],
  ["Required", "Select at least one", "Required", "Required", "Enter a number", "Must be at least 1", "Must be at most 120", "", "",
    "Enter an email address", "Enter a full URL", "", "Must match [a-z]+-\\d", "", "", "Needs at least 3 characters", "At most 3 characters"]);

// A stand-in for the form in OMP's terminal: what its keys do (packages/tui/src/html-form/dialog.ts), in 18.22, where Shift+Tab lands on a
// field's first stop and Page Up can turn a long form to a page without the cursor, and in 19, where Shift+Tab lands on the field's answer
// and ↑ at the top can leave the form peeking. Either way the next ↓ or Space is eaten.
function terminal(form, version, seed) {
  const stops = formStops(form);
  let n = seed * 2654435761;
  const rnd = max => { n = (n + 0x6d2b79f5) | 0; let x = Math.imul(n ^ (n >>> 15), 1 | n); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) % max; };
  const junk = () => ["", "x", "left\nover", "a b", "my own", "extra"][rnd(6)];
  const s = { focus: rnd(stops.length), peek: false, cursor: {}, seen: {}, held: form.fields.map(f => f.kind === "text" ? junk() : { checked: new Set(f.options.flatMap((o, i) => !o.disabled && rnd(2) ? [i] : [])), other: f.other ? junk().replace("\n", " ") : "" }) };
  form.fields.forEach((f, i) => {
    if (f.kind === "text") { s.cursor[i] = rnd(s.held[i].length + 1); return; }
    if (!f.multi) s.held[i].checked = new Set([...s.held[i].checked].slice(0, 1));
    if (f.select && !f.multi && !s.held[i].checked.size) s.held[i].checked.add(f.options.findIndex(o => !o.disabled));
    // An Other typed before an option was picked: OMP has seen its text, and the option stays picked.
    s.cursor[i] = s.held[i].other.length;
    s.seen[i] = s.held[i].other;
  });
  const fieldOf = at => stops[at].field;
  const otherChosen = i => { const h = s.held[i], f = form.fields[i]; return Boolean(h.other.trim()) && (f.multi || !h.checked.size); };
  const drawn = () => form.fields.forEach((f, i) => {
    // OMP notices a radio group's Other was typed, which unpicks its option, when it draws the row.
    if (f.kind !== "choice" || !f.other || f.multi || s.held[i].other === (s.seen[i] ?? "")) return;
    s.seen[i] = s.held[i].other;
    if (s.held[i].other.trim()) s.held[i].checked.clear();
  });
  const answerStop = field => {
    const mine = stops.flatMap((x, at) => x.field === field ? [at] : []);
    return mine.find(at => (stops[at].kind === "option" && s.held[field].checked.has(stops[at].option)) || (stops[at].kind === "other" && otherChosen(field))) ?? mine[0];
  };
  const text = at => stops[at].kind === "text" || stops[at].kind === "other";
  const get = () => { const i = fieldOf(s.focus); return stops[s.focus].kind === "text" ? s.held[i] : s.held[i].other; };
  const set = (value, cursor) => { const i = fieldOf(s.focus); if (stops[s.focus].kind === "text") s.held[i] = value; else s.held[i].other = value; s.cursor[i] = cursor; };
  const edit = key => {
    const i = fieldOf(s.focus), v = get(), c = s.cursor[i], lineEnd = v.indexOf("\n", c) < 0 ? v.length : v.indexOf("\n", c), lineStart = v.lastIndexOf("\n", c - 1) + 1;
    if (key === "\x0b") set(v.slice(0, c) + v.slice(lineEnd), c);
    else if (key === "\x1b[3~") set(v.slice(0, c) + v.slice(c + 1), c);
    else if (key === "\x15") set(v.slice(0, lineStart) + v.slice(c), lineStart);
    else if (key === "\x7f") set(v.slice(0, Math.max(0, c - 1)) + v.slice(c), Math.max(0, c - 1));
    else set(v.slice(0, c) + key + v.slice(c), c + key.length);
  };
  const press = key => {
    const at = stops[s.focus], i = at.field, f = form.fields[i];
    if (s.peek && key !== "\x1b[A") { s.peek = false; if (key === "\x1b[B" || key === " ") return; }
    if (s.away && (key === "\x1b[A" || key === "\x1b[B" || key === " ")) { s.away = false; return; }
    if (key === "\x1b[Z") {
      let to = s.focus;
      while (to > 0 && fieldOf(to) === i) to--;
      const target = fieldOf(to);
      while (to > 0 && fieldOf(to - 1) === target) to--;
      s.focus = version === 19 && target !== undefined ? answerStop(target) : to;
    } else if (key === "\x1b[5~") {
      // 19: to the question before, at its answer. 18.22: a page back, which the cursor may not be on.
      const before = stops.findLast(x => x.field < i || (i === undefined && x.field !== undefined))?.field;
      if (version === 19 && before !== undefined) s.focus = answerStop(before);
      if (version === 18) s.away = true;
    } else if (key === "\x1b[H") { if (text(s.focus)) s.cursor[i] = get().lastIndexOf("\n", s.cursor[i] - 1) + 1; }
    else if (key === "\x1b[A" || key === "\x1b[B") {
      const down = key === "\x1b[B", v = at.kind === "text" && f.multiline ? s.held[i] : null;
      if (v !== null && (down ? v.indexOf("\n", s.cursor[i]) >= 0 : v.lastIndexOf("\n", s.cursor[i] - 1) >= 0)) {
        s.cursor[i] = down ? v.indexOf("\n", s.cursor[i]) + 1 : v.lastIndexOf("\n", s.cursor[i] - 1);
      } else if (!down && s.focus === 0 && version === 19) s.peek = true;
      else s.focus = Math.max(0, Math.min(stops.length - 1, s.focus + (down ? 1 : -1)));
    } else if (at.kind === "submit") { /* nothing else acts on Submit here */ }
    else if (text(s.focus)) edit(key);
    else if (at.kind === "select" && (key === "\x1b[D" || key === "\x1b[C")) {
      let to = [...s.held[i].checked][0];
      for (let k = to + (key === "\x1b[C" ? 1 : -1); k >= 0 && k < f.options.length; k += key === "\x1b[C" ? 1 : -1) if (!f.options[k].disabled) { to = k; break; }
      s.held[i].checked = new Set([to]);
    } else if (at.kind === "option" && key === " ") {
      if (!f.multi) s.held[i].checked = new Set([at.option]);
      else if (!s.held[i].checked.delete(at.option)) s.held[i].checked.add(at.option);
    }
  };
  return {
    type(chunk) {
      for (const m of chunk.matchAll(/\x1b\[200~([\s\S]*?)\x1b\[201~|\x1b\[(?:[ABCDHZ]|\d~)|[\s\S]/g)) {
        if (m[1] !== undefined) { if (text(s.focus)) edit(m[1]); } else press(m[0]);
      }
      drawn();
    },
    screen() {
      // The focused group's rows as OMP draws them, cursor on the focused one.
      const i = fieldOf(s.focus), f = form.fields[i];
      if (i === undefined) return "╭─ Ask ───╮\n│ ❯ Submit │\n╰───╯";
      const rows = f.kind !== "choice" ? [] : [
        ...f.options.map((o, k) => `│ ${stops[s.focus].option === k ? "❯" : " "} ${f.multi ? (s.held[i].checked.has(k) ? "☑" : "☐") : s.held[i].checked.has(k) ? "◉" : "○"} ${o.value} │`),
        ...(f.other ? [`│ ${stops[s.focus].kind === "other" ? "❯" : " "} ${f.multi ? (otherChosen(i) ? "☑" : "☐") : "○"} Other: ${s.held[i].other || "type your own"} │`] : []),
      ];
      return ["╭─ Ask ───╮", "│ A question │", ...rows, "│ │", "│   Submit │", "╰───╯"].join("\n");
    },
    answers: () => form.fields.map((f, i) => f.kind === "text" ? s.held[i] : { checked: [...s.held[i].checked].filter(k => !f.options[k].disabled).sort((a, b) => a - b), other: otherChosen(i) ? s.held[i].other.trim() : "" }),
    onSubmit: () => s.focus === stops.length - 1,
  };
}

function fill(term, form, answers) {
  // The program run as the card runs it: each write typed and drawn, a checkbox group's keys read off the screen first and typed at the
  // head of the write after.
  let lead = "";
  for (const step of formProgram(form, answers)) {
    if (typeof step === "string") { term.type(lead + step); lead = ""; continue; }
    if (lead) term.type(lead);
    lead = checkKeys(form, step.checks, answers[step.checks], term.screen());
    if (lead == null) throw new Error("checkboxes unreadable");
  }
  if (lead) term.type(lead);
}

const wanted = [
  [{ checked: [2], other: "" }, "new\ntext\n", { checked: [1, 2], other: "" }, { checked: [2], other: "" }, "42", { checked: [0], other: "" }],
  [{ checked: [], other: "my own" }, "", { checked: [], other: "extra" }, { checked: [1], other: "" }, "", { checked: [], other: "" }],
  blankAnswers(form),
];
const reached = (answers, i) => form.fields.map((f, k) => f.kind === "text" ? answers[k] : { checked: answers[k].checked, other: f.other && (f.multi || !answers[k].checked.length) ? answers[k].other : "" })[i];
for (const version of [18, 19]) {
  const misses = [];
  for (let seed = 1; seed <= 60; seed++) for (const [w, answers] of wanted.entries()) {
    const term = terminal(form, version, seed);
    let got = null;
    try { fill(term, form, answers); got = term.answers(); } catch {}
    if (!got || !term.onSubmit() || form.fields.some((_f, i) => JSON.stringify(got[i]) !== JSON.stringify(reached(answers, i)))) misses.push(`seed ${seed}, answers ${w}`);
  }
  check(`OMP ${version}: from wherever the form's cursor is and whatever it holds, the keys leave it holding the answers, on Submit`, misses, []);
}

const cheese = { sections: [], fields: [choice("toppings", [option("Cheese", { checked: true }), option("Ham"), option("Olives")], { multi: true }), choice("size", [option("Small"), option("Large")])] };
const boxes = screen("omp-q2");
const set = [{ checked: [0], other: "" }, { checked: [1, 2], other: "" }];
const UP3 = "\x1b[A\x1b[A\x1b[A";
check("a checkbox group is set from what the terminal shows with the cursor on its last stop: ↑ back to its first box, then Space where a box differs and ↓ past each (OMP 18.22, every field shown)",
  set.map(a => checkKeys(cheese, 0, a, screen("omp18-boxes-last"))), [`${UP3}\x1b[B\x1b[B\x1b[B`, `${UP3} \x1b[B \x1b[B \x1b[B`]);
check("and from OMP 19's screen, where only the group in focus is open",
  set.map(a => checkKeys(cheese, 0, a, screen("omp19-boxes-last"))), [`${UP3}\x1b[B\x1b[B\x1b[B`, `${UP3} \x1b[B \x1b[B \x1b[B`]);
check("a screen read before the keys to the group's last stop were drawn, its cursor still on the first box, isn't taken (both versions)",
  [checkKeys(cheese, 0, set[0], boxes), checkKeys(cheese, 0, set[0], screen("omp19-boxes"))], [null, null]);
const other = { sections: [], fields: [choice("drinks", [option("Tea"), option("Ham"), option("Olives")], { multi: true })] };
check("nor a group of the same shape under other labels (the cursor still in the group before)",
  [checkKeys(other, 0, set[0], screen("omp19-boxes-last")), checkKeys(other, 0, set[0], screen("omp18-boxes-last"))], [null, null]);
check("a group the screen doesn't show whole (a note written over its rows) isn't guessed at", checkKeys(cheese, 0, set[0], screen("omp19-note")), null);
check("nor one the cursor isn't in", checkKeys(cheese, 0, set[0], screen("omp19-submit")), null);

check("the form's box on the terminal's screen is told from an answered call's above it, and its cursor on Submit from one elsewhere",
  [askState(boxes), askState(screen("omp19-boxes")), askState(screen("omp19-submit")), askState(screen("omp-answered"))].map(a => [a.panel, a.submit, a.hidden, a.note]),
  [[true, false, false, false], [true, false, false, false], [true, true, false, false], [false, false, false, false]]);
check("a form folded to one row is hidden, and one with a note being written says so",
  [askState(screen("omp19-hidden")), askState(screen("omp19-note"))].map(a => [a.panel, a.hidden, a.note]), [[false, true, false], [true, false, true]]);
check("a form with a countdown or a page in its title is still the form",
  ["╭─ Ask (25s) ───╮", "╭─ Ask · 2 of 4 answered (9s) ───╮", "╭─ Ask · 1/2 ───╮"].map(top => askState(`${top}\n│ ❯ Submit │\n╰───╯`).submit), [true, true, true]);
// As OMP 19 draws a picture that doesn't fit whole: a frame of its own inside the form's, beside the form's scrollbar.
const framed = ["╭─ Ask ──────────────────╮", "│ │ ▣ Ask card, opened   │ │ │", "│ │                      │ │ │", "│ ╰──────────────────────╯ │ │", "│ ✓ What next?             █ │", "│ ❯ Submit                 █ │", "╰──────────────────────────╯"];
check("a picture framed inside the form doesn't end it", [askState(framed.join("\n")).submit, askState(framed.join("\n").replace("❯", " ")).submit], [true, false]);

process.exit(failed ? 1 : 0);
