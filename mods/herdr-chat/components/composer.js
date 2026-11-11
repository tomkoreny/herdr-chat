import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState } from "gpui-base";
import { shared, hc, exec } from "herdr";
import { ICONS, sessionOf } from "../common.js";
import { onWindows, modFile, removeFiles, pruneOld } from "../platform.js";
import { target, sendMessage, pressKeys, inputBox } from "../terminal.js";
import { imageStyle, canMirror, withImages, draftPastes, textOfBox, readBack } from "../harnesses/index.js";
import { savedDraft, storeDraft, keptImages } from "../draft.js";
import { IMAGE_FILE, attachDir, attachName, ATTACH_DIR, keepSent, sentNames, fetchSent, previewName, previewFile, staleSent, dropSent } from "../images.js";
import { caretOf, lineMove } from "../model/caret.js";
import { COLUMN, icon } from "../ui/primitives.js";
import { SkillMenu } from "./skill-menu.js";
import { skillToken } from "../model/skills.js";
import { statusParts } from "../model/status.js";

const DRAFT_PAUSE = 400;
const SENT_PRUNE_EVERY = 3600000;

export class Composer {
  constructor(host, cx) {
    // The reply box: one draft per session (text and images), mirrored into the agent's own box, and sending it. `host` is the view: its `sending` lock, `note`, `key`, `list`, `card`, `stop()` and `stopping`.
    this.host = host;
    this.input = TextareaState.new({ placeholder: "Reply…", rows: 1 });
    this.input.set_soft_wrap(true);
    this.input.set_auto_grow(1, 4);
    this.input.on("submit", (e, cx) => { if (!e?.shift) this.enter(cx); });
    this.input.on("change", (_e, cx) => {
      if (Date.now() - (this.enterAt ?? 0) < 400) {
        const v = this.input.value(), s = v.replace(/\r?\n$/, "");
        if (s !== v) this.input.set_value(s);
      }
      this.menu.edited(cx);
      this.keepDraft(cx);
      cx.notify();
    });
    this.input.on("paste_other", (_e, cx) => { if (Date.now() - (this.imagePasteAt ?? 0) > 800) this.pasteImage(cx); });
    if (!globalThis.herdrChatLineKeys) {
      globalThis.herdrChatLineKeys = cx.bind_keys([
        { keystroke: "up", action: "herdr_chat::LineUp", context: "HerdrChatReply > Input" },
        { keystroke: "down", action: "herdr_chat::LineDown", context: "HerdrChatReply > Input" },
      ]);
    }
    if (!globalThis.herdrChatStopKey) {
      globalThis.herdrChatStopKey = cx.bind_keys([{ keystroke: "escape", action: "herdr_chat::Stop", context: "HerdrChatReply > Input" }]);
    }
    this.menu = new SkillMenu(this);
    this.attachments = []; this.drafts = new Map();
    this.mirror = null; this.mirrorChain = Promise.resolve();
    this.lastMode = shared("herdr-chat.mode"); this.lastModeSession = "";
    this.pruneCache();
    this.sent = new Set(); this.fetching = new Set();
    cx.spawn(async cx => { for (const n of await sentNames()) this.sent.add(n); this.sentReady = true; await this.pruneSent(); cx.notify(); });
    cx.timer.every(SENT_PRUNE_EVERY, () => { this.pruneSent(); });
  }

  blank() {
    // Whether the box holds nothing to send.
    return !this.input.value().trim() && !this.attachments.length;
  }

  mirrorOnSwitch(cx) {
    // The chat box and the agent's own input box hold the same draft.
    const mode = shared("herdr-chat.mode"), t = target();
    const session = t ? sessionOf(t) : "";
    const was = this.lastMode, wasSession = this.lastModeSession;
    this.lastMode = mode; this.lastModeSession = session;
    if (mode === "chat" && was !== "chat") this.input.focus();
    if (mode === was || !t || session !== wasSession || !canMirror(t.harness) || this.host.sending || this.host.card.choices) return;
    if (was === "chat" && mode === "terminal") this.pushDraft(t, session, cx);
    else if (was === "terminal" && mode === "chat") this.pullDraft(t, session, cx);
  }

  queueMirror(cx, step) {
    // One mirror step at a time: a quick switch back waits for the push before reading the box.
    this.mirrorChain = this.mirrorChain.then(() => new Promise(done => cx.spawn(async cx => {
      try { await step(cx); } catch {} finally { done(); }
    })));
  }

  pushDraft(t, session, cx) {
    const text = this.input.value(), images = this.attachments.slice();
    const sig = `${text}\u0000${images.map(a => a.file).join("|")}`;
    if (this.mirror?.session === session && this.mirror.sig === sig) return;
    this.queueMirror(cx, async () => {
      const paths = await this.placeImages(t, images);
      const { pastes, pasted } = draftPastes(t.harness, paths, text);
      const r = await inputBox("set", t, JSON.stringify(pastes));
      if (!r.ok) return;
      const box = r.box ?? "";
      const textBox = textOfBox(t.harness, box);
      this.mirror = { session, sig, images, paths, pasted, textBox, box, foreign: false };
    });
  }

  pullDraft(t, session, cx) {
    // The agent's box back into the chat.
    this.queueMirror(cx, async cx => {
      const r = await inputBox("read", t);
      if (!r.ok) return;
      const box = r.box;
      if (box == null || target()?.address !== t.address || shared("herdr-chat.mode") !== "chat") return;
      const m = this.mirror?.session === session ? this.mirror : null;
      if (m && box === m.box) return;
      const { text, kept, foreign } = readBack(t.harness, box, m);
      if (foreign) {
        this.mirror = { ...(m ?? { session, sig: "", images: [], paths: [], pasted: "", textBox: "" }), box, foreign: true };
        this.host.note = `${t.label}'s input box has an image that was pasted into the terminal itself, and ${t.label} keeps that image where the chat can't read it. Send that draft from the Terminal view, or remove the image there.`;
        cx.notify();
        return;
      }
      const dropped = this.attachments.filter(a => m?.images.includes(a) && !kept.includes(a));
      this.forget(dropped.map(a => a.file));
      this.attachments = [...new Set([...kept, ...this.attachments.filter(a => !m?.images.includes(a))])];
      if (text !== this.input.value()) this.input.set_value(text);
      const sig = `${text}\u0000${this.attachments.map(a => a.file).join("|")}`;
      this.mirror = { ...(m ?? { session, images: [], paths: [], pasted: "", textBox: "" }), session, sig, box, foreign: false };
      this.keepDraft(cx);
      cx.notify();
    });
  }

  keepDraft(cx) {
    // Saves the reply box's draft (text and images) once typing pauses, so a reload of the chat keeps it.
    const key = this.host.key, token = this.draftToken = (this.draftToken ?? 0) + 1;
    if (!key) return;
    cx.spawn(async cx => {
      await cx.sleep(DRAFT_PAUSE);
      if (token !== this.draftToken || key !== this.host.key) return;
      storeDraft(key, { text: this.input.value(), attachments: this.attachments });
    });
  }

  swapDraft(key, from = this.host.key) {
    // The reply box's draft kept for session `from` (default: the one shown), and `key`'s put in it.
    if (from) {
      const text = this.input.value(), attachments = this.attachments;
      if (text || attachments.length) this.drafts.set(from, { text, attachments });
      else this.drafts.delete(from);
    }
    const draft = key ? this.drafts.get(key) ?? savedDraft(key) : null;
    this.input.set_value(draft?.text ?? "");
    this.attachments = draft?.attachments ?? [];
    this.mirror = null;
  }

  async placeImages(t, attached) {
    // `hc put` each image beside the agent's terminal (this computer or another) and return where they landed.
    const placed = [];
    const where = sessionOf(t);
    for (const a of attached) {
      if (a.placed?.[where]) { placed.push(a.placed[where]); continue; }
      const r = await hc(["put", "--json", t.address, a.file]);
      let path = null;
      try { path = r.code === 0 ? JSON.parse(r.stdout).path : null; } catch {}
      if (!path) throw new Error(`Couldn't send ${a.name}${t.machine ? ` to ${t.machine}` : ""}: ${(r.stderr || r.stdout || "hc put failed").trim()}`);
      (a.placed ??= {})[where] = path;
      placed.push(path);
    }
    return placed;
  }

  async prepare(args, label) {
    // Runs a prepare script; resolves with the preview copy's path, or null with the reason in the note.
    const r = onWindows()
      ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("prepare-image.ps1"), ...args.windows]).catch(e => ({ code: 1, stderr: String(e) }))
      : await exec("sh", args.unix).catch(e => ({ code: 1, stderr: String(e) }));
    const file = (r.stdout ?? "").trim().split(/\r?\n/).pop();
    if ((r.code === 0 || r.code === 5) && file) {
      if (r.code === 5) this.host.note = `${label} is over 250 KB and nothing here can shrink it (install ImageMagick), so the agent may not attach it.`;
      return file;
    }
    if (r.code === 3) return null;
    this.host.note = r.code === 4
      ? "Pasting images needs wl-paste (Wayland), xclip (X11) or pngpaste (macOS). Drop the file instead."
      : `Couldn't attach ${label}: ${(r.stderr || "it couldn't be read").trim()}`;
    return null;
  }

  attach(file, name, cx, owner = this.host.key) {
    // Adds an image to the draft of `owner`, the session it was added in, even if another one shows now.
    const a = { name, file, rel: `${ATTACH_DIR}/${file.split(/[\\/]/).pop()}` };
    if (owner === this.host.key) { this.attachments.push(a); this.keepDraft(cx); }
    else {
      const d = this.drafts.get(owner) ?? savedDraft(owner) ?? { text: "", attachments: [] };
      const next = { ...d, attachments: [...d.attachments, a] };
      this.drafts.set(owner, next);
      storeDraft(owner, next);
    }
    cx.notify();
  }

  forget(files) {
    // Deletes preview copies: after a send, or when one is removed from the box.
    removeFiles(files);
  }

  keepSent(attached, placed, t, cx) {
    // Sent images keep their previews in sent/, so the message's bubble can show them.
    cx.spawn(async cx => { for (const n of await keepSent(attached.map(a => a.file), placed, t.machine)) this.sent.add(n); cx.notify(); });
  }

  previewsFor(t, messages, cx) {
    // Fetches, once each, the images in `messages` that have no preview in sent/ yet, from the agent's machine.
    if (!t || !this.sentReady || messages === this.scanned) return;
    this.scanned = messages;
    for (const m of messages) for (const path of m.images ?? []) {
      const name = previewName(path, t.machine);
      if (previewFile(this.sent, path, t.machine) || this.fetching.has(name)) continue;
      this.fetching.add(name);
      cx.spawn(async cx => { const file = await fetchSent(path, t.machine); if (file) { this.sent.add(file); cx.notify(); } });
    }
  }

  async pruneSent() {
    // Drops the previews of terminals that are gone.
    const r = await hc(["ls", "--all", "--json"]).catch(() => null);
    let listing = null;
    try { listing = r?.code === 0 ? JSON.parse(r.stdout) : null; } catch {}
    const stale = staleSent([...this.sent], listing);
    await dropSent(stale);
    for (const n of stale) this.sent.delete(n);
  }

  pruneCache() {
    // Preview copies left by a copy that closed before sending them: anything older than a day.
    pruneOld(attachDir(), keptImages().map(f => f.split(/[\\/]/).pop()), ["sent"]);
  }

  dropFiles(paths, cx) {
    // Dropped files: images get a preview copy (shrunk when big) and are attached; anything else is ignored.
    const images = paths.filter(p => IMAGE_FILE.test(p));
    if (!images.length) { this.host.note = "Only images can be attached (png, jpg, gif, webp)."; cx.notify(); return; }
    const owner = this.host.key;
    cx.spawn(async cx => {
      for (const source of images) {
        const label = source.split(/[\\/]/).pop(), name = attachName(source);
        const file = await this.prepare({
          unix: [modFile("prepare-image.sh"), source, attachDir(), name],
          windows: ["-Source", source, "-Folder", attachDir(), "-Name", name],
        }, label);
        if (file) this.attach(file, label, cx, owner);
        else cx.notify();
      }
    });
  }

  pasteImage(cx) {
    // Ctrl+V with an image (and no text) on the clipboard: attached like a dropped file.
    const owner = this.host.key;
    cx.spawn(async cx => {
      const name = attachName("pasted");
      const file = await this.prepare({
        unix: [modFile("prepare-image.sh"), "--clipboard", attachDir(), name],
        windows: ["-Clipboard", "-Folder", attachDir(), "-Name", name],
      }, "the pasted image");
      if (file) this.attach(file, "Pasted image", cx, owner);
      else cx.notify();
    });
  }

  attachmentStrip(t) {
    return h_flex().w_full().flex_wrap().gap(8).pt(2).pb(4)
      .children(this.attachments.map((a, i) => div().id(`attachment-${i}`).relative().size(64).flex_none().rounded(10).overflow_hidden()
        .border_1().border_color(t.border).bg(t.raised)
        .tooltip(a.name)
        .child(image(a.rel).size_full())
        .child(div().id(`attachment-remove-${i}`).absolute().top(3).right(3).size(18).flex().items_center().justify_center()
          .rounded(9).bg(t.background).border_1().border_color(t.border).text_color(t.muted).cursor_pointer()
          .hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.forget(this.attachments.splice(i, 1).map(x => x.file)); this.keepDraft(cx); cx.notify(); })
          .child(icon("close", 10, t.muted)))));
  }

  lineKey(dir, cx) {
    // ↑ (dir -1) or ↓ (+1) in the reply box: the skill menu's selection while it's open.
    if (this.menu.move(target(), dir, cx)) return;
    const { start, end } = caretOf(this.input);
    const from = dir < 0 ? start : end;
    const goal = this.lineGoal && this.lineGoal.at === from ? this.lineGoal.column : null;
    const { at, column } = lineMove(this.input.value(), from, dir, goal);
    this.input.set_selected_range({ start: at, end: at });
    this.lineGoal = { at, column };
  }

  enter(cx) {
    // Enter (without Shift): sends, and never leaves a new line in the box.
    this.enterAt = Date.now();
    const v = this.input.value(), s = v.replace(/\r?\n$/, "");
    if (s !== v) this.input.set_value(s);
    if (this.menu.accept(target(), cx)) return;
    this.send(cx);
  }

  send(cx) {
    const t = target(), typed = this.input.value().trim(), attached = this.attachments.slice();
    if (!t || (!typed && !attached.length) || this.host.sending) return;
    this.host.sending = true;
    this.input.set_value("");
    this.attachments = this.attachments.filter(a => !attached.includes(a));
    this.keepDraft(cx);
    cx.notify();
    const owner = this.host.key;
    const restore = () => {
      if (this.host.key !== owner) {
        const d = this.drafts.get(owner) ?? { text: "", attachments: [] };
        this.drafts.set(owner, { text: d.text.trim() ? d.text : typed, attachments: [...attached, ...d.attachments] });
        storeDraft(owner, this.drafts.get(owner));
        return;
      }
      if (!this.input.value().trim()) this.input.set_value(typed);
      this.attachments = [...attached.filter(a => !this.attachments.includes(a)), ...this.attachments];
      storeDraft(owner, { text: this.input.value(), attachments: this.attachments });
    };
    cx.spawn(async cx => {
      try {
        if (t.status === "blocked" && !(await this.host.card.stillCurrent(t))) throw new Error("The prompt changed. Review it again before answering.");
        if (canMirror(t.harness) && t.status !== "blocked") {
          await this.mirrorChain;
          if (this.mirror?.session === sessionOf(t) && this.mirror.foreign)
            throw new Error(`${t.label}'s input box has an image pasted in the terminal. Send that draft from the terminal, or clear it there, first.`);
          if ((await inputBox("set", t, "[]")).ok) this.mirror = null;
        }
        const placed = await this.placeImages(t, attached);
        if (imageStyle(t.harness) === "paste") {
          for (const path of placed) {
            const p = await inputBox("paste", t, path);
            if (!p.ok) throw new Error(`Couldn't paste the image into ${t.label}: ${p.error}`);
          }
          if (!typed) {
            const k = await pressKeys(t, ["enter"]);
            if (k.code !== 0) throw new Error(k.stderr || "Send failed");
            this.keepSent(attached, placed, t, cx);
            this.host.list.follow();
            return;
          }
        }
        const r = await sendMessage(t, withImages(t.harness, placed, typed), t.status === "blocked");
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        if (t.harness.skills?.enterTwice && skillToken(typed, [t.harness.skills.invoke[0]])) { await cx.sleep(400); await pressKeys(t, ["enter"]); }
        this.mirror = { session: sessionOf(t), sig: "\u0000", images: [], paths: [], pasted: "", textBox: "", box: "", foreign: false };
        this.keepSent(attached, placed, t, cx);
        this.host.list.follow();
      } catch (e) { this.host.note = String(e); restore(); }
      finally { this.host.sending = false; cx.notify(); }
    });
  }

  sendCommand(text, cx) {
    // Runs one of the agent's commands (picked in the status line) in its terminal, leaving the draft alone. Never while the agent waits on a question: the keys would answer it.
    const t = target();
    if (!t || this.host.sending) return;
    if (t.status === "blocked") { this.host.note = `${t.label} is waiting on a question: answer it before running ${text}`; cx.notify(); return; }
    this.host.sending = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await sendMessage(t, text, false);
        if (r.code !== 0) throw new Error(r.stderr || "Send failed");
        this.host.list.follow();
      } catch (e) { this.host.note = `Couldn't run ${text}: ${e}`; }
      finally { this.host.sending = false; cx.notify(); }
    });
  }

  statusLine(t, active, status) {
    // The line under the box: the agent's model, thinking level, context and cost where its reader tells them (`status`; the model and the level open their choices), then where replies go.
    const hint = div().w_full().text_center().text_size(11.5).text_color(t.dim);
    if (!active) return hint.child("");
    const switches = active.harness.status ?? {};
    const parts = statusParts(status, this.menu.command(active, switches.model)?.choices);
    if (!parts) return hint.child(`Sends to the live ${active.label} terminal · drop or paste an image to attach it`);
    const chip = (id, label, command, current) => {
      const can = Boolean(command && this.menu.command(active, command)?.choices?.length) && active.status !== "blocked";
      return h_flex().id(id).flex_none().h(22).px(7).gap(3).items_center().rounded(6).text_color(t.muted)
        .when(can, el => el.cursor_pointer().hover(s => s.bg(t.raised).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.menu.pick(active, command, current, cx); }))
        .child(label)
        .when(can, el => el.child(icon("chevron-down", 11, t.dim)));
    };
    const facts = [parts.context, parts.cost].filter(Boolean).join(" · ");
    return h_flex().w_full().h(22).gap(2).items_center().text_size(11.5).text_color(t.dim)
      .when(Boolean(parts.model), el => el.child(chip("status-model", parts.model, switches.model, parts.modelId)))
      .when(Boolean(parts.effort), el => el.child(chip("status-effort", parts.effort, switches.effort, parts.effortId)))
      .when(Boolean(facts), el => el.child(div().flex_none().px(7).child(facts)))
      .child(div().flex_1().min_w(0).truncate().text_right().child(`Sends to the live ${active.label} terminal · drop or paste images`));
  }

  render(t, active, status) {
    // The reply box: attachments, the text, the send or stop button, and the status line under it (`status`, the shown session's).
    const ready = (Boolean(this.input.value().trim()) || this.attachments.length > 0) && !this.host.sending && Boolean(active);
    const stopping = active?.status === "working" && !this.input.value().trim() && !this.attachments.length;
    const menu = this.menu.render(t, active);
    return v_flex().w_full().max_w(COLUMN).gap(6).relative()
      .when(Boolean(menu), el => el.child(menu))
      .child(h_flex().id("composer-box").w_full().pl(16).pr(8).py(8).gap(8).items_end().rounded(18).border_1().border_color(t.input).bg(t.surface)
        .child(v_flex().flex_1().min_w(0)
          .when(this.attachments.length > 0, el => el.child(this.attachmentStrip(t)))
          .child(div().id("composer-input").w_full().min_w(0).py(4).key_context("HerdrChatReply")
          .on_action("herdr_chat::LineUp", (_e, cx) => this.lineKey(-1, cx))
          .on_action("herdr_chat::LineDown", (_e, cx) => this.lineKey(1, cx))
          .on_action("herdr_chat::Stop", (_e, cx) => { if (!this.menu.dismiss(target(), cx)) this.host.stop(cx); })
          .on_key_down((e, cx) => {
            const paste = e.key === "v" && (e.modifiers.control || e.modifiers.platform) && !e.modifiers.alt;
            if (paste && cx.read_from_clipboard() === undefined) { cx.stop_propagation(); this.imagePasteAt = Date.now(); this.pasteImage(cx); return; }
            if (e.key === "tab" && !e.modifiers.shift && this.menu.accept(target(), cx)) { cx.stop_propagation(); return; }
            if (e.key !== "enter" || e.modifiers.shift || e.modifiers.alt) return;
            cx.stop_propagation();
            this.enter(cx);
          })
          .child(Textarea.new(this.input).w_full().text_size(15).text_color(t.foreground))))
        .child(stopping
          ? div().id("stop").size(32).flex_none().flex().items_center().justify_center().rounded(16)
            .bg(t.foreground).text_color(t.background).tooltip("Stop (Esc)")
            .when(!this.host.stopping, el => el.cursor_pointer().hover(s => s.opacity(0.85)).on_click((_e, cx) => this.host.stop(cx)))
            .child(svg(`${ICONS}/stop.svg`).size(14))
          : div().id("send").size(32).flex_none().flex().items_center().justify_center().rounded(16)
            .bg(ready ? t.accent : t.raised).text_color(ready ? t.accent_foreground : t.dim)
            .when(ready, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => this.send(cx)))
            .child(svg(`${ICONS}/arrow-up.svg`).size(16))))
      .child(this.statusLine(t, active, status));
  }
}
