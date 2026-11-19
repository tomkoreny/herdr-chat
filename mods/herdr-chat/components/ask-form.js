import { div, image } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Textarea, TextareaState, TextView } from "gpui-base";
import { switchTo, sessionOf } from "../common.js";
import { onWindows } from "../platform.js";
import { target, readScreen, pressKeys, inputBox } from "../terminal.js";
import { pictureFor } from "../images.js";
import { designPx } from "../measure.js";
import { askForm, plain } from "../model/ask-html.js";
import { blankAnswers, reachable, fieldError, otherCounts, formProgram, checkKeys, askState } from "../model/ask-form.js";
import { COLUMN, mono, icon, keyButton, checkbox, radio, cardTitle } from "../ui/primitives.js";

// How many forms are kept filled in while other sessions are shown; how long (ms) a blocked OMP's form is waited for from its log, here and
// on another machine, before its screen is shown instead; how tall (px) a picture is drawn at most.
const KEPT = 6;
const SETTLE = 1200, SETTLE_REMOTE = 3000;
const PICTURE_HEIGHT = 320;

function spansHtml(spans) {
  // Styled spans as the HTML a TextView draws.
  const safe = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  return spans.map(s => s.s === "code" ? `<code>${safe(s.t)}</code>` : s.s === "strong" ? `<strong>${safe(s.t)}</strong>` : s.s === "em" ? `<em>${safe(s.t)}</em>` : safe(s.t)).join("");
}

function rich(id, spans) {
  // A label or a paragraph: plain text, or a TextView when it has code, emphasis or line breaks.
  return spans.some(s => s.s || s.t.includes("\n")) ? TextView.html(id, spansHtml(spans)).selectable(true) : div().child(plain(spans));
}

function question(form) {
  // What the form asks first, on one line: its first field's label, else the text or the title above it.
  for (const section of form.sections) {
    let above = "";
    for (const b of section.blocks) {
      if (b.kind !== "field") { above = b.kind === "text" ? plain(b.spans) : ""; continue; }
      const f = form.fields[b.field];
      return (plain(f.label) || above || plain(section.title) || plain(f.options?.[0]?.label) || f.name).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function guessHeight(form) {
  // Roughly how tall a form draws, for its first frame: after that it's measured.
  const lines = spans => Math.max(1, Math.ceil(plain(spans).length / 100));
  let tall = 0;
  for (const section of form.sections) {
    tall += 14 + (section.title.length ? 27 : 0);
    for (const b of section.blocks) {
      const f = b.kind === "field" ? form.fields[b.field] : null;
      if (f) tall += 7 + (f.label.length ? 23 : 0) + (f.kind === "choice" ? f.options.reduce((sum, o) => sum + 20 + lines(o.label) * 19, f.other ? 35 : 0) : f.multiline ? Math.max(2, Math.min(8, f.rows)) * 21 + 14 : 30);
      else tall += 7 + (b.kind === "text" ? lines(b.spans) * 21 : b.kind === "list" ? b.items.length * 23 : b.kind === "pre" ? Math.min(220, b.text.split("\n").length * 16 + 14) : b.kind === "table" ? b.rows.length * 30 : 28);
    }
  }
  return tall;
}

export class AskForm {
  constructor(host) {
    // An OMP ask form, shown whole and answered in one go: the form comes from the session's log (the reader's `ask`), the answers go into the
    // form OMP shows in its terminal, typed there as a person would (model/ask-form.js), and its Submit is pressed. `host` is the view: its
    // `sending` lock, `width`, `height`, `zoom` and `list`.
    this.host = host;
    // The forms being filled in, by their call's id, the shown one last: a form keeps what was typed while another session is shown.
    this.sheets = new Map();
    this.id = ""; this.formless = ""; this.answered = new Set(); this.folded = false; this.filling = false; this.blockedSince = 0; this.settling = false;
  }

  get sheet() { return this.sheets.get(this.id) ?? null; }

  get sent() {
    // Whether the form the log still says is waiting was answered from here: there's nothing to show until the log catches up.
    return this.answered.has(this.id);
  }

  visible(active) {
    // Whether the card shows the form: one waits unanswered in the shown agent, which is blocked on it (or being answered right now).
    return Boolean(this.sheet && !this.answered.has(this.id) && (active?.status === "blocked" || this.filling));
  }

  notice(cx, t, ask) {
    // Each tick: takes up the form the shown session's log says is waiting (the reader's `ask`, read as OMP reads it), and says (`settling`)
    // while a blocked OMP's form is still on its way from the log, so the card doesn't show the terminal's screen for that moment.
    let id = ask && t && !onWindows() ? ask.id : "";
    if (id && id !== this.id && !this.sheets.has(id)) {
      // A call OMP shows no form for is none here either; it's read once.
      const form = id === this.formless ? null : askForm(ask);
      if (form) this.open(cx, t, id, form);
      else { this.formless = id; id = ""; }
    }
    if (id !== this.id) {
      this.id = id;
      const kept = this.sheets.get(id);
      if (kept) { this.sheets.delete(id); this.sheets.set(id, kept); }
      cx.notify();
    }
    const waits = t?.status === "blocked" && t.harness.prompt?.form === "log" && !id;
    this.blockedSince = waits ? this.blockedSince || Date.now() : 0;
    const settling = waits && Date.now() - this.blockedSince < (t.remote ? SETTLE_REMOTE : SETTLE);
    if (settling !== this.settling) { this.settling = settling; cx.notify(); }
  }

  open(cx, t, id, form) {
    // A form's sheet: its answers as the form opens with them, a text box per text field and per Other row, and where its pictures are.
    const fields = form.fields;
    const s = { id, form, cwd: t.cwd, machine: t.machine, answers: blankAnswers(form), reach: reachable(form), errors: fields.map(() => ""), note: "", texts: [], others: [] };
    // One question with one answer to pick: picking it sends it.
    s.lone = fields.length === 1 && fields[0].kind === "choice" && !fields[0].multi && !fields[0].select;
    fields.forEach((f, i) => {
      s.texts[i] = f.kind !== "text" ? null : f.multiline
        ? TextareaState.new({ placeholder: f.placeholder, value: f.value, rows: Math.max(2, Math.min(8, f.rows)) })
        : InputState.new({ placeholder: f.placeholder, value: f.value });
      if (f.kind === "text" && f.multiline) s.texts[i].set_auto_grow(Math.max(2, Math.min(8, f.rows)), 14);
      if (f.type === "password") s.texts[i].set_masked(true);
      s.texts[i]?.on("change", (_e, cx) => { if (s.errors[i]) { s.errors[i] = ""; cx.notify(); } });
      s.others[i] = f.kind === "choice" && f.other ? InputState.new({ placeholder: "Other: type your own" }) : null;
      s.others[i]?.on("change", (_e, cx) => this.otherTyped(s, i, cx));
      s.others[i]?.on("submit", (_e, cx) => { if (s.lone) this.submit(cx); });
    });
    this.sheets.set(s.id, s);
    while (this.sheets.size > KEPT) {
      const [old, gone] = this.sheets.entries().next().value;
      this.sheets.delete(old);
      for (const box of [...gone.texts, ...gone.others]) box?.release();
    }
  }

  pick(s, i, j, cx) {
    // Picks an option: a radio group's one answer, or a checkbox flipped. A form of one radio group is sent with it.
    const f = s.form.fields[i], a = s.answers[i];
    if (this.host.sending) return;
    a.checked = !f.multi ? [j] : a.checked.includes(j) ? a.checked.filter(x => x !== j) : [...a.checked, j].sort((x, y) => x - y);
    a.unpicked = null;
    s.errors[i] = "";
    cx.notify();
    if (s.lone) this.submit(cx);
  }

  otherTyped(s, i, cx) {
    // A group's Other as it's typed. As in OMP, text in a radio group's Other is its answer, in place of the option picked; emptied, the
    // option is picked again.
    const f = s.form.fields[i], a = s.answers[i];
    a.other = s.others[i].value();
    if (!f.multi && a.other.trim() && a.checked.length) { a.unpicked = a.checked; a.checked = []; }
    else if (!f.multi && !a.other.trim() && !a.checked.length && a.unpicked) { a.checked = a.unpicked; a.unpicked = null; }
    s.errors[i] = "";
    cx.notify();
  }

  pickOther(s, i, cx) {
    // A click on the Other row: its box takes the keyboard, and the text a radio group's Other already holds is its answer again.
    const f = s.form.fields[i], a = s.answers[i];
    if (this.host.sending) return;
    s.others[i].focus();
    if (!f.multi && a.other.trim() && a.checked.length) { a.unpicked = a.checked; a.checked = []; cx.notify(); }
  }

  submit(cx) {
    // Sends the answers, once each passes the checks OMP makes on Submit: the terminal's form is filled in and its Submit pressed.
    const t = target(), s = this.sheet;
    if (!t || !s || this.host.sending) return;
    const answers = s.form.fields.map((f, i) => f.kind === "text" ? s.texts[i].value() : s.answers[i]);
    s.errors = s.form.fields.map((f, i) => s.reach[i] ? fieldError(f, answers[i]) : "");
    s.note = "";
    if (s.errors.some(Boolean)) { cx.notify(); return; }
    this.host.sending = true; this.filling = true; cx.notify();
    cx.spawn(async cx => {
      try {
        await this.fill(t, s.form, answers, cx);
        this.answered.add(s.id);
        if (this.answered.size > 32) this.answered.delete(this.answered.values().next().value);
      } catch (e) { s.note = String(e?.message ?? e); }
      finally { this.host.sending = false; this.filling = false; cx.notify(); }
    });
  }

  async fill(t, form, answers, cx) {
    // Types `answers` into the form on the terminal's screen and presses its Submit; throws, with what to tell the person, when the form
    // isn't there to take them or doesn't end up on Submit, before anything is sent. Every key goes the same way, typed through the
    // helper: hc holds its own `keys` back for seconds after keys typed there, as it would after a person's.
    const look = async () => askState((await readScreen(t, 0)) ?? "");
    const type = async writes => {
      const r = writes.length ? await inputBox("write", t, JSON.stringify(writes)) : null;
      if (r && !r.ok) throw new Error(`Couldn't type into the terminal: ${r.error}`);
    };
    // A screen read right after typing can predate OMP's drawing of the keys: what's looked for there is looked for a few times.
    const watch = async find => {
      for (const ms of [0, 120, 250, 500]) {
        await cx.sleep(ms);
        const found = find((await readScreen(t, 0)) ?? "");
        if (found != null) return found;
      }
      return null;
    };
    let at = await look();
    if (at.hidden) { await type(["\r"]); at = await look(); }
    if (!at.panel) throw new Error("This question isn't on the terminal's screen any more.");
    if (at.note) throw new Error("A note is being written in the terminal. Finish it there first.");
    // The keys a checkbox group's boxes call for lead the write that follows them.
    let writes = [], lead = "";
    for (const step of formProgram(form, answers)) {
      if (typeof step === "string") { writes.push(lead + step); lead = ""; continue; }
      await type(lead ? [...writes, lead] : writes);
      writes = [];
      lead = await watch(screen => checkKeys(form, step.checks, answers[step.checks], screen));
      if (lead == null) throw new Error("Couldn't read the checkboxes on the terminal's screen. Open the terminal to answer.");
    }
    await type(lead ? [...writes, lead] : writes);
    if (!(await watch(screen => askState(screen).submit || null))) throw new Error("Couldn't fill in the terminal's form. Open the terminal to check it.");
    await type(["\r"]);
    for (const ms of [0, 300, 700]) {
      await cx.sleep(ms);
      if (!(await look()).panel) return;
    }
    throw new Error("OMP didn't take these answers. Open the terminal to see what it wants.");
  }

  async stepAside(t, cx) {
    // Before a message is sent in place of an answer: Esc gives OMP's reply box the keys (OMP 19, where sending a message there closes the
    // form) or cancels the question (18.22), so the message isn't typed into the form.
    const r = await pressKeys(t, ["esc"]);
    if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
    await cx.sleep(300);
  }

  toggle(cx) {
    this.folded = !this.folded;
    if (this.host.list.following) this.host.list.follow();
    cx.notify();
  }

  render(t, active) {
    // The card: the form as OMP wrote it, section by section, each field answerable, over Submit.
    const s = this.sheet, busy = this.host.sending;
    const title = cardTitle(t, `${active.label} is asking`, this.folded, question(s.form), (_e, cx) => this.toggle(cx));
    const shell = v_flex().flex_none().w_full().max_w(COLUMN).rounded(12).border_1().border_color(t.blocked).bg(t.surface);
    if (this.folded) return shell.px(10).py(8).child(title);
    // A scrolling area needs a height of its own (a maximum alone doesn't scroll): its content's, as last measured, up to what the view has room for.
    const room = Math.max(180, Math.min(540, Math.floor(this.host.height) - 380));
    return shell.p(10).gap(8)
      .child(title)
      .child(div().id(`ask-form-${s.id}`).w_full().h(Math.min(room, s.tall ?? guessHeight(s.form))).overflow_y_scrollbar()
        .child(v_flex().id("ask-form-content").w_full().gap(16).pr(12)
          .on_size_change((size, cx) => { const tall = Math.ceil(designPx(size.height, this.host.zoom)); if (tall !== s.tall) { s.tall = tall; cx.notify(); } })
          .children(s.form.sections.map((section, at) => v_flex().w_full().flex_none().gap(8)
            .when(section.title.length > 0, el => el.child(rich(`ask-t${at}`, section.title).w_full().flex_none().text_size(13.5).font_semibold().text_color(t.foreground)))
            .children(section.blocks.map((b, i) => this.block(t, s, b, `${at}-${i}`)))))))
      .when(Boolean(s.note), el => el.child(div().w_full().text_size(12).text_color(t.blocked).child(s.note)))
      .child(h_flex().gap(8).items_center()
        .child(div().id("ask-submit").h(26).px(14).flex().items_center().rounded(7).flex_none().bg(t.accent).text_size(12.5).font_semibold().text_color(t.background)
          .when(busy, el => el.opacity(0.5))
          .when(!busy, el => el.cursor_pointer().on_click((_e, cx) => this.submit(cx)))
          .child(this.filling ? "Sending…" : "Submit"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
          .child(this.filling ? "Filling in the form in the terminal" : s.lone ? "Picking an answer sends it" : ""))
        .child(keyButton(t, "ask-terminal", "Open terminal", () => switchTo("terminal", sessionOf(active)))));
  }

  block(t, s, b, key) {
    // One block of a section: a paragraph or heading, a list, preformatted text, a table, a picture, or a field. Each keeps its own height
    // (flex_none): in a scrolling column, a block that clips or scrolls its content would be squeezed instead.
    if (b.kind === "field") return this.field(t, s, b.field);
    if (b.kind === "text") return rich(`ask-x${key}`, b.spans).w_full().flex_none().text_size(13).text_color(t.foreground).when(b.heading, el => el.font_semibold());
    if (b.kind === "list") return v_flex().w_full().flex_none().gap(3).children(b.items.map((item, i) => h_flex().w_full().gap(6).items_start()
      .child(div().flex_none().w(18).text_size(13).text_color(t.dim).child(b.ordered ? `${i + 1}.` : "•"))
      .child(rich(`ask-i${key}-${i}`, item).flex_1().min_w(0).text_size(13).text_color(t.foreground))));
    if (b.kind === "pre") {
      const lines = b.text.split("\n");
      return v_flex().id(`ask-p${key}`).w_full().flex_none().h(Math.min(220, lines.length * 16 + 14)).overflow_scrollbar().px(10).py(7).rounded(7).bg(t.background)
        .font_family(mono()).text_size(11.5).text_color(t.muted)
        .children(lines.map(l => div().flex_none().h(16).whitespace_nowrap().child(l.replace(/\t/g, "    ") || " ")));
    }
    if (b.kind === "table") return v_flex().w_full().flex_none().rounded(7).border_1().border_color(t.border).overflow_hidden()
      .children(b.rows.map((cells, r) => h_flex().w_full().flex_none().px(9).py(5).gap(12).items_start()
        .when(r > 0, el => el.border_t(1).border_color(t.border))
        .when(r < b.headerRows, el => el.bg(t.background))
        .children(cells.map((cell, c) => rich(`ask-c${key}-${r}-${c}`, cell).flex_1().min_w(0).text_size(12.5)
          .text_color(r < b.headerRows ? t.foreground : t.muted).when(r < b.headerRows, el => el.font_semibold())))));
    // A picture is copied from the agent's machine the first time the card draws it (images.js); the view redraws once it has arrived.
    const shown = b.kind === "image" ? pictureFor(b.src, s.cwd, s.machine, s.id) : null;
    if (shown?.state === "ready") {
      const width = Math.min(COLUMN, Math.floor(this.host.width ?? COLUMN) - 48) - 30;
      const scale = Math.min(1, width / shown.width, PICTURE_HEIGHT / shown.height);
      return div().id(`ask-m${key}`).flex_none().w(Math.round(shown.width * scale)).h(Math.round(shown.height * scale)).rounded(8).overflow_hidden()
        .border_1().border_color(t.border).tooltip(b.alt || b.src).child(image(shown.rel).size_full());
    }
    const where = shown?.state === "fetching" ? "loading" : "shown in the terminal";
    return h_flex().h(28).px(10).gap(6).flex_none().items_center().rounded(8).bg(t.background).text_size(12).text_color(t.muted)
      .child(icon("image", 14, t.muted))
      .child(div().flex_1().min_w(0).truncate().child(`${b.alt || (b.kind === "image" ? b.src.split("/").pop() : "Drawing")} · ${where}`));
  }

  field(t, s, i) {
    // A field: a text box under its label, or a group's options as rows with their dots or boxes, its Other a box of its own.
    const f = s.form.fields[i], error = s.errors[i], busy = this.host.sending;
    const edge = error ? t.blocked : t.border;
    const bounds = f.min !== undefined && f.max !== undefined ? `${f.min}–${f.max}` : f.min !== undefined ? `≥ ${f.min}` : f.max !== undefined ? `≤ ${f.max}` : "";
    const label = f.label.length > 0 ? h_flex().w_full().gap(5).items_baseline()
      .child(rich(`ask-l${i}`, f.label).flex_shrink(1).min_w(0).text_size(12.5).text_color(t.muted))
      .when(f.required, el => el.child(div().flex_none().text_size(12.5).text_color(t.blocked).child("*")))
      .when(Boolean(bounds), el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(bounds))) : null;
    const wrong = error ? div().w_full().text_size(11.5).text_color(t.blocked).child(error) : null;
    if (f.kind === "text") return v_flex().w_full().flex_none().gap(4)
      .when(Boolean(label), el => el.child(label))
      .child(f.multiline
        ? div().w_full().px(10).py(6).rounded(8).border_1().border_color(edge).bg(t.background)
          .child(Textarea.new(s.texts[i]).w_full().text_size(13).text_color(t.foreground))
        : Input.new(s.texts[i]).w_full().h(30).px(10).rounded(8).border_1().border_color(edge).bg(t.background).text_size(13))
      .when(Boolean(wrong), el => el.child(wrong));
    const a = s.answers[i], mark = f.multi ? checkbox : radio;
    const row = (id, on) => h_flex().id(id).w_full().flex_none().px(10).py(6).gap(8).items_start().rounded(8).border_1().border_color(on ? t.accent : edge).bg(t.background);
    return v_flex().w_full().flex_none().gap(5)
      .when(Boolean(label), el => el.child(label))
      .children(f.options.map((o, j) => {
        const on = a.checked.includes(j);
        return row(`ask-o${i}-${j}`, on)
          .when(o.disabled, el => el.opacity(0.5))
          .when(!o.disabled && !busy, el => el.cursor_pointer().hover(st => st.bg(t.hover)).on_click((_e, cx) => this.pick(s, i, j, cx)))
          .child(div().flex_none().pt(3).child(mark(t, on)))
          .child(rich(`ask-ol${i}-${j}`, o.label).flex_1().min_w(0).text_size(12.5).text_color(t.foreground));
      }))
      .when(Boolean(s.others[i]), el => el.child(row(`ask-oo${i}`, otherCounts(f, a)).items_center().py(3)
        .on_click((_e, cx) => this.pickOther(s, i, cx))
        .child(div().flex_none().child(mark(t, otherCounts(f, a))))
        .child(div().flex_1().min_w(0).child(Input.new(s.others[i]).w_full().text_size(12.5)))))
      .when(Boolean(wrong), el => el.child(wrong));
  }
}
