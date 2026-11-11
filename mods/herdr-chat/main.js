import { View, div, image } from "gpui-kit";
import { set_theme, v_flex, h_flex } from "gpui-base";
import { panes, focused, props, hc, theme, shared } from "herdr";
import { switchTo, showView, preferredView, sessionOf, chatKey } from "./common.js";
import { target, inputBox, interruptAgent } from "./terminal.js";
import { keyRows, splitCode, withCopyRows, stepRows, stepText, withoutRetracted } from "./model/transcript.js";
import { row } from "./ui/rows.js";
import { COLUMN, programIcon, paneButtons, statusBadge, viewToggle, clock } from "./ui/primitives.js";
import { diagramFor, renderQueuedDiagrams, hasQueuedDiagrams, splitDiagrams } from "./diagrams.js";
import { canMirror } from "./harnesses/index.js";
import { isHeader, terminalHeader } from "./header.js";
import { designPx, zoomProbe } from "./measure.js";
import { ChatList } from "./components/chat-list.js";
import { QuestionCard } from "./components/question-card.js";
import { Composer } from "./components/composer.js";
import { SessionReader } from "./components/session-reader.js";

function inputHighlight(cx) {
  const t = theme(), th = cx.theme();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(t.accent), b = rgb(t.surface), k = th.is_dark ? 0.32 : 0.28;
  const want = "#" + a.map((v, i) => Math.round(v * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
  const see = `${t.accent.slice(0, 7)}${th.is_dark ? "47" : "40"}`;
  if (th.colors.accent.slice(0, 7).toLowerCase() === want && th.colors.selection.slice(0, 7).toLowerCase() === see.slice(0, 7).toLowerCase()) return;
  set_theme({ appearance: th.appearance, tokens: { colors: { ...th.colors, accent: want, selection: see }, spacing: th.spacing, radius: th.radius } });
}

const SPARK = ["·", "✢", "✶", "✻", "✽", "✻", "✶", "✢"];

export default class HerdrChat extends View {
  init(_props, cx) {
    try { this.initInner(cx); }
    catch (e) { this.initError = String(e?.stack ?? e); }
  }

  initInner(cx) {
    if (isHeader(props())) { this.asHeader = true; this.hovered = false; return; }
    this.list = new ChatList();
    this.reader = new SessionReader(this);
    this.card = new QuestionCard(this);
    this.composer = new Composer(this, cx);
    this.width = 900; this.zoom = 1; this.rootPx = 0;
    this.visit = shared("herdr-chat.visit");
    this.refresh(cx);
    cx.timer.every(1500, cx => inputHighlight(cx));
    cx.timer.every(100, cx => {
      this.applyView();
      this.composer.mirrorOnSwitch(cx);
      const t = target();
      if (chatKey(t) !== this.key || this.reader.needsFirstRead || this.composer.pendingDraft) this.refresh(cx);
      this.reader.noticeAgents(cx);
      this.composer.previewsFor(t, this.reader.session.messages, cx);
      this.composer.menu.warm(t, this.reader.session.path, cx);
      if (t) this.card.showPreview(cx, t);
      this.noticeVisit();
      const cue = this.reader.readCue();
      if (cue !== this.shownCue) { this.shownCue = cue; cx.notify(); }
      if (shared("herdr-chat.mode") !== "chat") return;
      if (hasQueuedDiagrams() && !this.drawingDiagram) {
        this.drawingDiagram = true;
        cx.spawn(async cx => { try { if (await renderQueuedDiagrams()) cx.notify(); } finally { this.drawingDiagram = false; } });
      }
      this.list.tick(cx);
    });
  }

  get key() { return this.reader?.key ?? ""; }
  get note() { return this.reader?.session.note ?? ""; }
  set note(text) { if (this.reader) this.reader.session.note = text; }

  refresh(cx) {
    // Switches to the selected agent's session and reads it, and its screen for a question.
    const t = target();
    const key = chatKey(t);
    if (key !== this.key) { this.switchSession(t, key); cx.notify(); }
    if (this.composer.pendingDraft) { this.composer.swapDraft(this.key, this.composer.pendingDraft.from); this.composer.pendingDraft = null; cx.notify(); }
    const switched = this.reader.needsFirstRead;
    this.reader.needsFirstRead = false;
    if (!t) return;
    if (switched) { this.reader.read(cx); this.card.read(cx, t); }
  }

  switchSession(t, key) {
    // Shows another session: its draft swapped in once read, the reader on it, the list and card reset.
    if (!this.composer.pendingDraft) this.composer.pendingDraft = { from: this.key };
    this.reader.switchTo(t, key);
    this.list.reset();
    this.card.clear();
  }

  applyView() {
    const f = focused(), t = target();
    const focus = `${f?.space ?? ""}:${f?.tab ?? ""}:${t ? sessionOf(t) : "-"}`;
    if (focus === this.viewFocus) return;
    this.viewFocus = focus;
    showView(t ? preferredView(sessionOf(t)) : "terminal");
  }

  noticeVisit() {
    // On a switch to Chat: back to the newest message, hidden until it lands if anything changed.
    const visit = shared("herdr-chat.visit");
    if (visit === this.visit) return;
    this.visit = visit;
    this.list.revisit();
  }


  stop(cx) {
    // Stops the working agent (its own stop key, through hc interrupt).
    const t = target();
    if (!t || t.status !== "working" || this.stopping) return;
    this.stopping = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await interruptAgent(t);
        if (r.outcome === "failed") throw new Error(r.error || `Couldn't stop ${t.label}.`);
        await cx.sleep(600);
        if (canMirror(t.harness)) {
          const box = (await inputBox("read", t)).box;
          const last = [...this.reader.session.messages].reverse().find(m => m.kind === "message");
          if (box && last?.role === "user" && box.trim() === last.text.trim()) this.retracted = { key: this.key, text: last.text };
          if (this.composer.blank()) this.composer.pullDraft(t, sessionOf(t), cx);
        }
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.stopping = false; cx.notify(); }
    });
  }



  fresh(active) {
    // Whether the agent's conversation hasn't started: no log yet, rather than loading or failing.
    return Boolean(active) && !this.reader.session.path && !this.reader.readError && /hasn't written|Waiting for this/.test(this.note || "");
  }

  welcome(t, active) {
    // The empty chat for a conversation that hasn't started: the agent's logo and an invitation to write.
    const logo = programIcon(active.program, 44, t.foreground) ?? image("frame/welcome/herdr.png").size(44).rounded(10).flex_none();
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(12).px(24)
      .child(logo)
      .child(div().text_center().text_size(17).font_semibold().text_color(t.foreground).child("What would you like to build today?"))
      .child(div().max_w(420).text_center().text_size(13).text_color(t.muted).child(`Send a message to start this conversation with ${active.label}.`));
  }

  header(t, active) {
    const glyph = programIcon(active?.program, 15, t.muted), badge = statusBadge(t, active?.status);
    const pane = active?.pane, zoomed = Boolean(pane && panes().find(p => p.pane === pane)?.zoomed);
    return h_flex().id("chat-header").h(42).px(14).gap(9).items_center().flex_none()
      .on_hover((hovered, cx) => { if (this.headerHovered !== hovered) { this.headerHovered = hovered; cx.notify(); } })
      .when(Boolean(glyph), el => el.child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(active?.title || active?.label || ""))
      .when(Boolean(this.headerHovered && pane), el => el.children(paneButtons(t, pane, zoomed, "chat")))
      .when(Boolean(badge), el => el.child(badge))
      .child(viewToggle(t, "chat", "view", () => {}, () => switchTo("terminal", active ? sessionOf(active) : "")));
  }

  status(t, active) {
    const card = this.card.render(t, active);
    if (card) return card;
    const cue = this.reader.readCue();
    if (cue === "silent") {
      const who = active?.machine ? `${active.machine} isn't answering` : "Couldn't read new messages";
      return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
        .child(div().size(8).mx(3).rounded(4).flex_none().bg(t.blocked ?? t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
          .child(this.reader.session.readAt ? `${who} · messages as of ${clock(this.reader.session.readAt)}` : who))
        .child(div().id("read-retry").px(10).h(24).flex().items_center().rounded(12).cursor_pointer()
          .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.reader.retry(cx)).child("Retry"));
    }
    if (active?.status === "working") return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
      .child(div().w(14).text_size(15).text_color(t.accent).frames(SPARK, 120).child(SPARK[0]))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child((active.activity ? `${active.activity}…`.replace(/……$/, "…") : "Working…") + (cue === "checking" ? " · checking for new messages" : "")));
    if (cue === "checking") return h_flex().w_full().max_w(COLUMN).h(26).gap(8).items_center()
      .child(div().size(8).mx(3).rounded(4).flex_none().bg(t.accent).loop("opacity", { from: 0.25, to: 1, period: 900 }))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.muted)
        .loop("opacity", { from: 0.55, to: 1, period: 1600 }).child("Checking for new messages…"));
    return null;
  }

  placeholder(t) {
    // Grey stand-ins for a conversation being read for the first time, in the shape of one.
    const line = (w, op) => div().h(12).w(w).rounded(6).bg(t.raised).opacity(op);
    return v_flex().flex_1().min_h(0).justify_end().items_center().px(24).pb(8)
      .loop("opacity", { from: 0.45, to: 1, period: 1400 })
      .child(v_flex().w_full().max_w(COLUMN).gap(22)
        .child(h_flex().w_full().justify_end().child(div().h(44).w(260).rounded(18).bg(t.raised)))
        .child(v_flex().w_full().gap(10).child(line(520, 1)).child(line(460, 1)).child(line(300, 1)))
        .child(h_flex().w_full().justify_end().child(div().h(44).w(180).rounded(18).bg(t.raised)))
        .child(v_flex().w_full().gap(10).child(line(480, 1)).child(line(380, 1))));
  }


  render(cx) {
    if (this.initError) return div().p(20).text_color(theme().blocked).child(`herdr-chat init error: ${this.initError}`);
    try { return this.renderInner(cx); }
    catch (e) { return div().p(20).text_color(theme().blocked).child(`herdr-chat render error: ${e?.stack ?? e}`); }
  }

  renderInner(cx) {
    if (this.asHeader) return terminalHeader(this);
    const t = theme();
    const active = target();
    if (chatKey(active) !== this.key) this.switchSession(active, chatKey(active));
    const shown = withoutRetracted(this.reader.session.messages, this.retracted?.key === this.key ? this.retracted.text : null);
    if (!shown.retracted && this.retracted?.key === this.key) this.retracted = null;
    const rows = withCopyRows(shown.rows, active?.status === "working").flatMap(m => {
      const parts = m.kind === "message" && m.role !== "user" && m.text?.includes("```mermaid") ? splitDiagrams(m.text) : null;
      const pieces = parts ? parts.map(p => p.kind === "diagram" ? { kind: "diagram", text: p.text } : { ...m, text: p.text }) : [m];
      return pieces.flatMap(r => {
        const code = r.kind === "message" && r.role !== "user" && r.text?.includes("```") ? splitCode(r.text) : null;
        return code ? code.map(c => c.kind === "code" ? c : { ...r, text: c.text }) : [r];
      });
    });
    if (this.note) rows.push({ kind: "note", text: this.note });
    const empty = rows.length === 0 || (rows.length === 1 && rows[0].kind === "note" && !this.reader.session.messages.length);
    keyRows(rows);
    rows.splice(0, rows.length, ...rows.flatMap(r => r.kind === "tools" && this.reader.session.open[r.key] ? [r, ...stepRows(r)] : [r]));
    const inner = Math.min(COLUMN, Math.max(280, Math.floor(this.width) - 50));
    const { body, measure } = this.list.render(cx, {
      rows, empty, t, inner, zoom: this.zoom, beforeScroll: () => this.noticeVisit(),
      heightKey: m => `${m.key}${this.reader.session.open[m.key] ? ":open" : ""}${m.kind === "diagram" ? `:${diagramFor(m.text, t).state}` : ""}`,
      waitsFor: m => m.kind === "diagram" && diagramFor(m.text, t).state === "queued",
      row: m => row(m, { t, open: this.reader.session.open, width: this.width, sent: this.composer.sent, machine: target()?.machine, copied: this.copied }),
      onItemClick: (key, cx) => {
        const row = rows.find(r => r.key === key);
        if (row?.kind === "code" || row?.kind === "copy") {
          cx.write_to_clipboard(row.text);
          this.copied = key; cx.notify();
          cx.timer.after(1500, cx => { if (this.copied === key) { this.copied = null; cx.notify(); } });
          return;
        }
        const opens = row?.kind === "tools" || (row?.kind === "step" && (this.reader.session.open[key] || stepText(row.call, false).more));
        if (opens) { this.reader.session.open[key] = !this.reader.session.open[key]; cx.notify(); }
      },
      canJump: !this.card.showing && active?.status !== "blocked",
    });
    const status = this.status(t, active);
    return v_flex().id("herdr-chat-root").relative().size_full().min_h(0).rounded(10).border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { this.rootPx = size.width; const w = designPx(size.width, this.zoom); if (w >= 200 && Math.abs(w - this.width) > 8) { this.width = w; cx.notify(); } })
      .child(zoomProbe((zoom, cx) => { if (Math.abs(zoom - this.zoom) > 0.001) { this.zoom = zoom; if (this.rootPx) this.width = designPx(this.rootPx, zoom); cx.notify(); } }))
      .on_drop((e, cx) => this.composer.dropFiles(e.paths ?? [], cx))
      .child(this.header(t, active))
      .when(empty && /^Opening/.test(this.note || ""), el => el.child(this.placeholder(t)))
      .when(empty && this.fresh(active), el => el.child(this.welcome(t, active)))
      .when(empty && !/^Opening/.test(this.note || "") && !this.fresh(active), el => el.child(v_flex().flex_1().min_h(0).items_center().justify_center().gap(14).px(24)
        .child(image("frame/welcome/herdr.png").size(64).rounded(14).flex_none()
          .when(/^(Opening|Finding)/.test(this.note || ""), el => el.loop("opacity", { from: 0.4, to: 1, period: 1600 })))
        .child(div().max_w(420).text_center().text_size(14).text_color(t.muted).child(this.note))))
      .when(!empty, el => el.child(body))
      .when(Boolean(measure), el => el.child(measure))
      .child(v_flex().w_full().flex_none().items_center().px(24).pt(12).pb(14).gap(12)
        .when(Boolean(status), el => el.child(status))
        .child(this.composer.render(t, active, this.reader.session.status)));
  }
}


