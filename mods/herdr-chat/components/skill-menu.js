import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { sessionOf } from "../common.js";
import { target } from "../terminal.js";
import { skillToken, matchSkills, withSkill, parseSkills, menuNote, choiceToken, matchChoices, withChoice } from "../model/skills.js";
import { readSkills } from "./session-reader.js";
import { mono } from "../ui/primitives.js";

const ROWS = 8, ROW = 32;
const FRESH_MS = 30000;

export class SkillMenu {
  constructor(host, cx) {
    // The list of an agent's skills (or commands) above the reply box, as the agent's own terminal offers them, and the choices that can follow a command. `host` is the composer: its `input`, `keepDraft` and `sendCommand`. Lists load in the background and filter in memory, so typing never waits.
    this.host = host;
    this.lists = new Map();
    this.index = 0;
    this.scroll = ScrollHandle.new();
    // The search field of a long list opened from the status line (models): typing filters, ↑↓ choose, Enter runs, Esc closes.
    this.search = InputState.new({ placeholder: "Search…" });
    this.search.on("change", (_e, cx) => { this.scroll.scroll_to_item(0); cx.notify(); });
    this.search.on("submit", (_e, cx) => this.accept(target(), cx));
    if (!globalThis.herdrChatPickKeys) {
      globalThis.herdrChatPickKeys = cx.bind_keys([
        { keystroke: "up", action: "herdr_chat::PickUp", context: "HerdrChatPick > Input" },
        { keystroke: "down", action: "herdr_chat::PickDown", context: "HerdrChatPick > Input" },
        { keystroke: "escape", action: "herdr_chat::PickClose", context: "HerdrChatPick > Input" },
      ]);
    }
  }

  warm(t, path, cx) {
    // Keeps the shown agent's list fresh: on switching to it, when its session starts, and every so often while the menu shows.
    if (!t?.harness.skills) return;
    const key = sessionOf(t), have = this.lists.get(key);
    const open = Boolean(this.view(t));
    if (have && (have.loading || (have.path === path && (!open || Date.now() - have.at < FRESH_MS)))) return;
    const entry = { items: have?.items ?? [], at: have?.at ?? 0, path, loading: true };
    this.lists.set(key, entry);
    cx.spawn(async cx => {
      const r = await readSkills(t, path).catch(() => null);
      if (r?.code === 0) { entry.items = parseSkills(r.stdout); entry.note = menuNote(r.stdout); }
      entry.at = Date.now(); entry.loading = false;
      cx.notify();
    });
  }

  list(t) {
    // The shown agent's skills or commands, as last read.
    return this.lists.get(sessionOf(t))?.items ?? [];
  }

  command(t, name) {
    // One of the agent's commands by name, with its choices; null when the list hasn't got it.
    return this.list(t).find(s => s.name === name) ?? null;
  }

  pick(t, name, current, cx) {
    // Opens the menu on a command's choices (a click in the status line), the current one selected: picking one runs the command with it. A list longer than the menu gets a search field, which takes the keyboard. Clicking again, typing in the reply box, or Esc closes it.
    const c = this.command(t, name), open = this.view(t);
    if ((open?.kind === "pick" && open.command === name) || !c?.choices?.length) { this.close(cx); return; }
    this.picking = { session: sessionOf(t), command: name, current, text: this.host.input.value() };
    this.search.set_value("");
    this.lastQuery = `pick:${name}:`;
    this.index = Math.max(0, c.choices.findIndex(x => x.name === current));
    this.scroll.scroll_to_item(this.index);
    if (c.choices.length > ROWS) this.search.focus(); else this.host.input.focus();
    cx.notify();
  }

  close(cx) {
    // Closes a list opened from the status line, giving the keyboard back to the reply box.
    this.picking = null;
    this.host.input.focus();
    cx.notify();
  }

  edited(cx) {
    // The draft changed: a pick from the status line closes for good, so Enter sends the draft, even once an undo brings the old text back.
    if (!this.picking) return;
    this.picking = null;
    cx.notify();
  }

  view(t) {
    // What the menu shows now: the skills or commands matching what's typed, the choices for a command, or a command picked from the status line; null when it's closed.
    const skills = t?.harness.skills;
    if (!skills) return null;
    const text = this.host.input.value();
    if (this.picking && (this.picking.session !== sessionOf(t) || this.picking.text !== text || t.status === "blocked")) this.picking = null;
    const p = this.picking;
    if (p) {
      const c = this.command(t, p.command);
      const query = c?.choices?.length > ROWS ? this.search.value().trim() : "";
      if (c?.choices?.length) return this.shown({ kind: "pick", command: c.name, current: p.current, items: query ? matchChoices(c.choices, query) : c.choices, total: c.choices.length, searchable: c.choices.length > ROWS, invoke: skills.invoke }, `pick:${c.name}:${query}`);
    }
    if (text === this.dismissed) return null;
    const token = skillToken(text, skills.triggers);
    if (token) return this.shown({ kind: "skills", token, items: matchSkills(this.list(t), token.query, skills.invoke), invoke: skills.invoke, noun: skills.commands ? "command" : "skill", note: this.lists.get(sessionOf(t))?.note ?? "" }, token.query);
    const typed = choiceToken(text, skills.invoke);
    const c = typed && this.command(t, typed.command);
    if (!c?.choices?.length || c.choices.some(x => x.name === typed.query)) return null;
    return this.shown({ kind: "choices", token: typed, command: c.name, items: matchChoices(c.choices, typed.query), invoke: skills.invoke }, `${c.name} ${typed.query}`);
  }

  shown(v, query) {
    // `v` with the selection in range, back at the top when what's typed changed; null when nothing matches (a list opened from the status line stays open, to search again).
    if (!v.items.length && v.kind !== "pick") return null;
    if (query !== this.lastQuery) { this.lastQuery = query; this.index = 0; }
    this.index = Math.max(0, Math.min(this.index, v.items.length - 1));
    return v;
  }

  move(t, dir, cx) {
    // ↑ or ↓ while it's open moves the selection, wrapping, and keeps it in view; false when it's closed.
    const v = this.view(t);
    if (!v) return false;
    if (v.items.length) this.index = (this.index + dir + v.items.length) % v.items.length;
    this.scroll.scroll_to_item(this.index);
    cx.notify();
    return true;
  }

  accept(t, cx, index = this.index) {
    // Puts the skill, command or choice in the box, or runs a picked command with its choice; false when the menu is closed.
    const v = this.view(t);
    if (!v) return false;
    if (!v.items.length) return true;
    const name = v.items[index].name;
    if (v.kind === "pick") {
      this.close(cx);
      this.host.sendCommand(`${v.invoke}${v.command} ${name}`, cx);
      return true;
    }
    const text = v.kind === "choices" ? withChoice(this.host.input.value(), v.token, name) : withSkill(this.host.input.value(), v.token, v.invoke, name);
    this.host.input.set_value(text);
    this.host.input.set_selected_range({ start: text.length, end: text.length });
    this.host.input.focus();
    this.host.keepDraft(cx);
    cx.notify();
    return true;
  }

  dismiss(t, cx) {
    // Esc closes it (a typed menu until the text changes); false when it's closed.
    const v = this.view(t);
    if (!v) return false;
    if (v.kind === "pick") { this.close(cx); return true; }
    this.dismissed = this.host.input.value();
    cx.notify();
    return true;
  }

  render(t, active) {
    // The menu, floating above the reply box so the conversation doesn't move: a scrolling list of up to ROWS rows at a time, under
    // a search field when it's a long list opened from the status line; null when it's closed.
    const v = this.view(active);
    if (!v) return null;
    return v_flex().id("skill-menu").absolute().bottom_full().left(0).right(0).mb(6).p(4).rounded(14).border_1().border_color(t.border).bg(t.surface)
      .when(Boolean(v.searchable), el => el.child(div().id("skill-menu-search").key_context("HerdrChatPick").w_full().px(4).pt(2).pb(6)
        .on_action("herdr_chat::PickUp", (_e, cx) => this.move(active, -1, cx))
        .on_action("herdr_chat::PickDown", (_e, cx) => this.move(active, 1, cx))
        .on_action("herdr_chat::PickClose", (_e, cx) => this.dismiss(active, cx))
        .child(Input.new(this.search).w_full().h(30).px(10).rounded(9).border_1().border_color(t.border).bg(t.background).text_size(13))))
      .when(!v.items.length, el => el.child(div().w_full().h(ROW).px(10).flex().items_center().text_size(12.5).text_color(t.dim).child("Nothing matches")))
      .child(v_flex().id("skill-menu-list").w_full().max_h(ROWS * ROW).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(v.items.map((s, at) => {
          const chosen = at === this.index, now = v.kind === "pick" && s.name === v.current;
          return h_flex().id(`${v.kind}-${s.name}`).w_full().h(ROW).flex_none().px(10).gap(12).items_center().rounded(9).cursor_pointer().border_1().border_color(chosen ? t.accent : "#00000000")
            .when(chosen, el => el.bg(t.raised)).hover(st => st.bg(t.raised))
            .on_click((_e, cx) => { cx.stop_propagation(); this.accept(active, cx, at); })
            .child(div().flex_none().text_size(13).font_family(mono()).text_color(chosen ? t.accent : t.foreground).child(v.kind === "skills" ? `${v.invoke}${s.name}` : s.name))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(chosen ? t.foreground : t.muted).child(s.description))
            .when(now, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("current")))
            .when(s.source === "project", el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.source)));
        })))
      .child(div().w_full().px(10).pt(4).pb(2).text_size(11).text_color(t.dim).child(menuFooter(v)));
  }
}

function menuFooter(v) {
  // The line under the menu: how many there are (after the reader's note, when the list is short of what the agent offers), and the keys.
  const n = v.items.length;
  if (v.kind === "pick") return v.searchable
    ? `${v.invoke}${v.command} · ${n} of ${v.total} · type to search · ↑↓ to choose · Enter to run it · Esc to close`
    : `${v.invoke}${v.command} · ↑↓ to choose · Enter to run it · Esc to close`;
  if (v.kind === "choices") return `${n} choice${n === 1 ? "" : "s"} for ${v.invoke}${v.command} · ↑↓ to choose · Enter or Tab to insert · Esc to close`;
  return `${v.note ? `${v.note} · ` : ""}${n} ${v.noun}${n === 1 ? "" : "s"} · ↑↓ to choose · Enter or Tab to insert · Esc to close`;
}
