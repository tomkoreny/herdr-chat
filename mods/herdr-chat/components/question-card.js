import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState } from "gpui-base";
import { switchTo, sessionOf, chatKey } from "../common.js";
import { onWindows } from "../platform.js";
import { target, readPrompt, pressKeys, sendMessage, inputBox } from "../terminal.js";
import { parsePrompt, looksLikePrompt, keysFor, typedAnswer, sameOption, previewKey, fullPreview } from "../model/prompts.js";
import { shared } from "herdr";
import { COLUMN, mono, keyButton, checkbox, cardTitle } from "../ui/primitives.js";
import { AskForm } from "./ask-form.js";

const BODY_HEIGHT = 264;
const ROW_CHARS = 96;
const DESC_CHARS = 110;
const PREVIEW_OPTIONS = 0.36;
const PREVIEW_LABEL_CHARS = 28;
const ROW_PAUSE = 500;
const SCROLL_TRIES = 12;
const ROW_SETTLE = 3000;

function stacked(o) {
  // Whether an option's description needs a line of its own.
  return o.desc.length > 0 && o.label.length + o.desc.join(" ").length > ROW_CHARS;
}

function bodyHeight(q) {
  // The height of a prompt's answers and options, up to where they scroll.
  const shown = q.options.filter(o => !o.next);
  const wrapped = o => q.preview ? (Math.ceil(o.label.length / PREVIEW_LABEL_CHARS) - 1) * 19 : 0;
  const rows = shown.reduce((sum, o) => sum + 34 + wrapped(o) + (stacked(o) ? Math.ceil(o.desc.join(" ").length / DESC_CHARS) * 19 : 0), 0) + (shown.length - 1) * 6;
  const answers = q.review?.answers.length ? q.review.answers.length * 21 + 24 : 0;
  const preview = q.preview ? q.preview.text.length * 17 + (q.preview.hidden ? 40 : 18) : 0;
  return Math.min(BODY_HEIGHT, Math.max(rows + answers, preview));
}

export class QuestionCard {
  constructor(host) {
    // A question on the agent's screen: read, shown as a card, answered with the harness's keys. An OMP ask form is shown and answered whole
    // instead, from the session's log (see AskForm). `host` is the view: its `sending` lock, `note`, `key` and `list`.
    this.host = host;
    this.form = new AskForm(host);
    this.choices = null; this.screen = ""; this.unread = false; this.currentStep = "";
    this.cardFold = ""; this.cardFolded = false;
    this.rowInputs = {
      text: TextareaState.new({ placeholder: "Type something…", rows: 1 }),
      chat: TextareaState.new({ placeholder: "Chat about this…", rows: 1 }),
    };
    for (const [kind, box] of Object.entries(this.rowInputs)) {
      box.on("submit", (e, cx) => { if (!e?.shift) this.answerRow(kind, cx); });
      box.on("change", (_e, cx) => this.rowChanged(kind, cx));
    }
  }

  get showing() {
    // Whether a question, a form or an unparsed prompt is shown.
    return Boolean(this.choices || this.unread || this.form.visible(target()));
  }

  notice(cx, t, ask) {
    // Each tick, with the form the shown session's log says is waiting (the reader's `ask`).
    this.form.notice(cx, t, ask);
  }

  formWaits(t) {
    // Whether an ask form is shown for agent `t`, waiting to be filled in.
    return this.form.visible(t);
  }

  async stepAside(t, cx) {
    // Makes way for a message sent in place of an answer; false when no form is waiting for one.
    if (!this.form.visible(t)) return false;
    await this.form.stepAside(t, cx);
    return true;
  }

  clear() {
    // Forgets the question: another conversation is shown.
    this.screen = ""; this.choices = null; this.unread = false;
    this.previews = new Map();
  }

  showPreview(cx, t) {
    // Fills in a preview the terminal's height cut: in Chat, where the terminal isn't in view, it's read once per option at the height it needs, and remembered.
    const q = this.choices;
    if (!q?.preview) return;
    this.previews ??= new Map();
    const key = previewKey(q);
    if (!q.preview.hidden) { this.previews.set(key, q.preview.text); return; }
    const known = this.previews.get(key);
    if (known) { q.preview = { text: known, hidden: 0 }; cx.notify(); return; }
    if (this.fetchingPreview || known === null || onWindows() || shared("herdr-chat.mode") !== "chat") return;
    this.fetchingPreview = true;
    this.previews.set(key, null);
    cx.spawn(async cx => {
      const r = await inputBox("tall", t, String(q.preview.hidden)).catch(() => null);
      const text = r?.box ? fullPreview(t.harness, r.box, q) : null;
      const moved = !this.choices || previewKey(this.choices) !== key;
      if (text) this.previews.set(key, text);
      else if (moved) this.previews.delete(key);
      this.fetchingPreview = false;
      if (target()?.address === t.address) this.showPreview(cx, t);
      cx.notify();
    });
  }

  async stillCurrent(t) {
    // Whether the prompt shown is still the one on screen.
    if (target()?.address !== t.address) return false;
    const text = await readPrompt(t);
    if (text == null) return false;
    if (this.choices) return parsePrompt(t.harness, text)?.sig === this.choices.sig;
    return (target()?.status === "blocked" || this.unread) && Boolean(this.screen) && text === this.screen;
  }

  choose(index, cx) {
    // Acts on a choice of the prompt on screen, with the keys its harness takes.
    const t = target(), shown = this.choices;
    if (!t || !shown || this.host.sending) return;
    this.host.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        await this.flushRow(t, cx);
        const text = await readPrompt(t);
        const now = text != null ? parsePrompt(t.harness, text) : null;
        if (!now || now.sig !== shown.sig || target()?.address !== t.address) throw new Error("The question changed. Review it again before answering.");
        const at = now.options.findIndex(o => sameOption(shown.options[index], o));
        if (at < 0) throw new Error("The question changed. Review it again before answering.");
        const r = await pressKeys(t, keysFor(t.harness, now, at));
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
        if (!now.multi) { this.choices = null; this.screen = ""; this.unread = false; }
      } catch (e) { this.host.note = String(e?.message ?? e); }
      finally { this.host.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  }

  rowChanged(kind, cx) {
    // Keeps a multi-select's text row on the terminal as it's typed, once typing pauses.
    const t = target();
    if (kind !== "text" || !this.choices?.multi || this.rowSetting || !t) return;
    this.rowDirty = true;
    this.rowEditedAt = Date.now();
    const token = this.rowToken = (this.rowToken ?? 0) + 1;
    cx.notify();
    cx.spawn(async cx => {
      await cx.sleep(ROW_PAUSE);
      if (token !== this.rowToken) return;
      await this.flushRow(t, cx);
      this.lookAgain(cx, t);
    });
  }

  async revealRow(t, cx) {
    // The prompt with its text row on screen, scrolling a list cut off below it.
    const read = async () => { const screen = await readPrompt(t); return screen != null ? parsePrompt(t.harness, screen) : null; };
    let now = await read();
    for (let i = 0; i < SCROLL_TRIES && now?.options.find(o => o.input === "text")?.hidden; i++) {
      await pressKeys(t, ["down"]);
      await cx.sleep(200);
      now = await read();
    }
    return now;
  }

  flushRow(t, cx) {
    // Puts a multi-select's typed text on the terminal, where text ticks the row and no text unticks it.
    this.rowChain = (this.rowChain ?? Promise.resolve()).then(async () => {
      if (!this.rowDirty) return;
      this.rowDirty = false;
      const now = await this.revealRow(t, cx);
      const index = now?.options.findIndex(o => o.input === "text" && !o.hidden) ?? -1;
      if (index < 0) return;
      const { before } = typedAnswer(t.harness, now, index);
      if (before.length) await pressKeys(t, before);
      await cx.sleep(150);
      await inputBox("fill", t, this.rowInputs.text.value().trim());
      this.rowEditedAt = Date.now();
      await cx.sleep(300);
    }).catch(e => { this.host.note = String(e?.message ?? e); });
    return this.rowChain;
  }

  answerRow(kind, cx) {
    // Sends what's typed in a text row of the prompt; an empty row is picked like any choice.
    const shown = this.choices, index = shown?.options.findIndex(o => o.input === kind) ?? -1;
    if (index < 0) return;
    const box = this.rowInputs[kind], text = box.value().trim();
    const t = target();
    if (shown.multi && kind === "text") {
      if (t) cx.spawn(async cx => { this.rowToken = (this.rowToken ?? 0) + 1; await this.flushRow(t, cx); this.lookAgain(cx, t); });
      return;
    }
    if (!text) { this.choose(index, cx); return; }
    if (!t || this.host.sending) return;
    this.host.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const now = kind === "text" ? await this.revealRow(t, cx) : parsePrompt(t.harness, (await readPrompt(t)) ?? "");
        if (!now || now.sig !== shown.sig || target()?.address !== t.address) throw new Error("The question changed. Review it again before answering.");
        const at = now.options.findIndex(o => o.input === kind && !o.hidden);
        if (at < 0) throw new Error("Couldn't reach that row. Open the terminal to answer.");
        const { before } = typedAnswer(t.harness, now, at);
        const moved = await pressKeys(t, before);
        if (moved.code !== 0) throw new Error(moved.stderr || "Key send failed");
        await cx.sleep(300);
        const sent = await sendMessage(t, text, true);
        if (sent.code !== 0) throw new Error(sent.stderr || "Send failed");
        box.set_value("");
        this.choices = null; this.screen = ""; this.unread = false;
      } catch (e) { this.host.note = String(e?.message ?? e); }
      finally { this.host.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  }

  press(key, cx) {
    const t = target();
    if (!t || this.host.sending) return;
    this.host.sending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (key !== "esc") await this.flushRow(t, cx);
        if (key !== "esc" && !(await this.stillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        const r = await pressKeys(t, [key]);
        if (r.code !== 0) throw new Error(r.stderr || "Key send failed");
      } catch (e) { this.host.note = String(e); }
      finally { this.host.sending = false; cx.notify(); this.lookAgain(cx, t); }
    });
  }

  lookAgain(cx, t) {
    // Reads the screen soon after keys, since a blocked agent reports no change when a question moves on.
    cx.spawn(async cx => {
      for (const ms of [250, 700]) {
        await cx.sleep(ms);
        if (target()?.address === t.address) this.read(cx, target());
      }
    });
  }

  toggle(cx) {
    // Folds the prompt card down to its title row, or opens it again.
    this.cardFolded = !this.cardFolded;
    if (this.host.list.following) this.host.list.follow();
    cx.notify();
  }

  render(t, active) {
    // The card for a prompt on screen: a form, a question with its choices, or a blocked agent's last lines.
    if (this.form.visible(active)) return this.form.render(t, active);
    if (this.form.settling || this.form.sent) return null;
    const q = active && (active.status === "blocked" || active.status === "working") ? this.choices : null;
    if (active?.status !== "blocked" && !q && !this.unread) return null;
    const fold = q ? JSON.stringify(q.steps.length ? q.steps.map(s => s.label) : q.question) : `screen:${active?.address}`;
    if (fold !== this.cardFold) { this.cardFold = fold; this.cardFolded = false; }
    const title = active.kind === "permission" ? `${active.label} needs permission` : q ? `${active.label} is asking` : `${active.label} needs your input`;
    const titleRow = cardTitle(t, title, this.cardFolded, q?.question.at(-1), (_e, cx) => this.toggle(cx));
    if (this.cardFolded) return v_flex().flex_none().w_full().max_w(COLUMN).px(10).py(8).rounded(12).border_1().border_color(t.blocked).bg(t.surface).child(titleRow);
    const key = (id, label, k) => keyButton(t, id, label, (_e, cx) => k === "terminal" ? switchTo("terminal", active ? sessionOf(active) : "") : this.press(k, cx));
    return v_flex().flex_none().w_full().max_w(COLUMN).p(10).gap(7).rounded(12).border_1().border_color(t.blocked).bg(t.surface)
      .child(titleRow)
      .when(Boolean(q), el => el
        .when(q.steps.length > 0, el => el.child(h_flex().gap(2).items_center().flex_wrap()
          .child(key("k-back", "←", "left"))
          .children(q.steps.map((s, i) => {
            const here = q.steps.length === 1 || s.label === this.currentStep;
            return div().id(`step-${i}`).h(24).px(9).flex().items_center().rounded(6).text_size(12)
              .text_color(here ? t.foreground : s.done ? t.accent : t.muted)
              .when(here, el => el.bg(t.selected))
              .child(s.label);
          }))
          .child(key("k-forward", "→", "right"))))
        .when(q.question.length > 1, el => el.child(div().flex_none().h(Math.min(90, q.question.slice(0, -1).length * 17 + 10)).overflow_y_scrollbar().px(8).py(4).rounded(6).bg(t.background)
          .font_family(mono()).text_size(11).text_color(t.muted).child(q.question.slice(0, -1).join("\n"))))
        .child(div().text_size(13).text_color(t.foreground).child(q.question.at(-1) ?? ""))
        .when(Boolean(q.review?.warning), el => el.child(div().text_size(11.5).text_color(t.blocked).child(q.review.warning)))
        .child(h_flex().flex_none().w_full().gap(8).items_start()
        .child(v_flex().id("prompt-body").flex_none().when(!q.preview, el => el.w_full()).when(Boolean(q.preview), el => el.w(COLUMN * PREVIEW_OPTIONS)).h(bodyHeight(q)).overflow_y_scrollbar().gap(6)
          .when(Boolean(q.review?.answers.length), el => el.child(v_flex().flex_none().gap(2).px(10).py(6).rounded(8).bg(t.background)
            .children(q.review.answers.map(a => h_flex().gap(8).items_baseline()
              .child(div().flex_none().w(150).truncate().text_size(11.5).text_color(t.muted).child(a.question))
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(a.answer || "Not answered"))))))
          .children(q.options.map((o, i) => o.next ? null : o.input && q.multi && o.input === "text" && onWindows() ? h_flex().id(`choice-${i}`).flex_none().w_full().px(10).py(5).gap(7).items_center().rounded(7)
          .border_1().border_color(t.border).bg(t.background).cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click(() => switchTo("terminal", sessionOf(active)))
          .child(checkbox(t, Boolean(o.checked)))
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.muted).child(o.typed ? `${o.typed} (edit it in the terminal)` : "Type your own answer in the terminal"))
          : o.input ? v_flex().id(`choice-${i}`).flex_none().w_full().px(10).py(5).rounded(7)
          .border_1().border_color(t.border).bg(t.background)
          .child(h_flex().gap(7).items_center()
            .child(o.checked === undefined
              ? div().flex_none().text_size(12).text_color(t.dim).child(o.n ? `${o.n}.` : "")
              : checkbox(t, Boolean(this.rowInputs.text.value().trim())))
            .child(div().flex_1().min_w(0).child(Textarea.new(this.rowInputs[o.input]).w_full().text_size(12.5).text_color(t.foreground))))
          : v_flex().id(`choice-${i}`).flex_none().w_full().px(10).py(5).rounded(7)
          .border_1().border_color((q.options.some(x => x.answered) ? o.answered : o.selected) ? t.accent : t.border).bg(t.background).cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(h_flex().gap(7).items_center()
            .child(o.checked === undefined
              ? div().flex_none().text_size(12).text_color(t.dim).child(o.n ? `${o.n}.` : "→")
              : checkbox(t, o.checked))
            .child(div().when(o.desc.length > 0 && !stacked(o), el => el.flex_none()).when(o.desc.length === 0 || stacked(o), el => el.flex_1().min_w(0)).text_size(12.5).text_color(t.foreground).child(o.label))
            .when(o.desc.length > 0 && !stacked(o), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(o.desc.join(" "))))
            .when(Boolean(o.answered), el => el.child(div().flex_none().text_size(12).text_color(t.accent).child("✓"))))
          .when(stacked(o), el => el.child(div().pl(19).text_size(11.5).text_color(t.muted).child(o.desc.join(" "))))).filter(Boolean)))
        .when(Boolean(q.preview), el => el.child(v_flex().id("prompt-preview").flex_1().min_w(0).h(bodyHeight(q)).overflow_scrollbar().gap(6).px(10).py(6).rounded(7).bg(t.background)
          .child(v_flex().flex_none().font_family(mono()).text_size(11.5).text_color(t.foreground)
            .children(q.preview.text.map(line => div().flex_none().min_h(16).whitespace_nowrap().child(line || " "))))
          .when(q.preview.hidden > 0, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${q.preview.hidden} more line${q.preview.hidden === 1 ? "" : "s"} hidden: open the terminal to read them`))))))
        .when(q.more, el => el.child(div().text_size(11.5).text_color(t.dim).child("More choices below: use ↓ or open the terminal."))))
      .when(!q, el => el.child(div().max_h(220).overflow_y_scrollbar().px(10).py(8).rounded(8).bg(t.background)
        .font_family(mono()).text_size(12).text_color(t.muted)
        .child(this.screen ? this.screen.split("\n").filter(l => l.trim()).slice(-12).join("\n") : "Open the terminal to review the request.")))
      .child(h_flex().gap(6).flex_wrap()
        .when(!q || q.more || Boolean(q.preview), el => el.child(key("k-up", "↑", "up")).child(key("k-down", "↓", "down")))
        .when(!q, el => el.child(key("k-enter", "Enter", "enter")))
        .child(key("k-esc", "Esc", "esc"))
        .when(Boolean(q?.options.some(o => o.next)), el => el.child(keyButton(t, "k-next", "Next →", (_e, cx) => this.choose(q.options.findIndex(o => o.next), cx), true)))
        .child(div().flex_1())
        .child(key("k-term", "Open terminal", "terminal")));
  }

  read(cx, t) {
    // Reads the agent's screen for a question while it works or is blocked (Pi asks while working).
    if (t.status !== "blocked" && t.status !== "working") {
      if (this.screen) { this.screen = ""; this.choices = null; this.unread = false; cx.notify(); }
      return;
    }
    if (this.readingScreen) { this.screenAgain = true; return; }
    this.readingScreen = true;
    cx.spawn(async cx => {
      try {
        const text = (await readPrompt(t)) ?? "";
        if (text !== this.screen) {
          this.screen = text; this.choices = parsePrompt(t.harness, text);
          this.showPreview(cx, t);
          this.unread = !this.choices && looksLikePrompt(text);
          this.syncRowBox();
          this.readStep(cx, t);
          cx.notify();
        }
      } finally {
        this.readingScreen = false;
        if (this.screenAgain) { this.screenAgain = false; const now = target(); if (now && chatKey(now) === this.host.key) this.read(cx, now); }
      }
    });
  }

  syncRowBox() {
    // Shows a multi-select's typed text in its box, and clears the box when the question changes.
    if (this.rowDirty) return;
    const q = this.choices, page = q?.question.join("\n") ?? "";
    const box = this.rowInputs.text, kept = this.rowKept ??= new Map();
    const typed = q?.options.find(o => o.input === "text")?.typed;
    const moved = page !== this.rowPage;
    if (moved && this.rowPage) kept.set(this.rowPage, box.value());
    this.rowPage = page;
    if (typed === undefined && !moved) return;
    if (!moved && Date.now() - (this.rowEditedAt ?? 0) < ROW_SETTLE) return;
    const text = typed ?? kept.get(page) ?? "";
    if (box.value() === text) return;
    this.rowSetting = true;
    box.set_value(text);
    this.rowSetting = false;
  }

  readStep(cx, t) {
    // Finds which step a prompt is on when it changes page: the screen's text doesn't show it, only its colours.
    const sig = JSON.stringify([this.choices?.question, this.choices?.steps]);
    if (sig === this.stepSig) return;
    this.stepSig = sig; this.currentStep = "";
    if (!(this.choices?.steps.length > 1) || onWindows()) return;
    cx.spawn(async cx => {
      const r = await inputBox("step", t);
      if (this.stepSig === sig && r.box) { this.currentStep = r.box; cx.notify(); }
    });
  }
}
