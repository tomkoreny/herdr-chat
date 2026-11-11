import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { sessionOf } from "../common.js";
import { skillToken, matchSkills, withSkill, parseSkills, choiceToken, matchChoices, withChoice } from "../model/skills.js";
import { readSkills } from "./session-reader.js";
import { mono } from "../ui/primitives.js";

const ROWS = 8;
const FRESH_MS = 30000;

export class SkillMenu {
  constructor(host) {
    // The list of an agent's skills (or commands) above the reply box, as the agent's own terminal offers them, and the choices that can follow a command. `host` is the composer: its `input`, `keepDraft` and `sendCommand`. Lists load in the background and filter in memory, so typing never waits.
    this.host = host;
    this.lists = new Map();
    this.index = 0;
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
      if (r?.code === 0) entry.items = parseSkills(r.stdout);
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
    // Opens the menu on a command's choices (a click in the status line), the current one selected: picking one runs the command with it. Clicking again, typing, or Esc closes it.
    const c = this.command(t, name), open = this.view(t);
    if ((open?.kind === "pick" && open.command === name) || !c?.choices?.length) { this.picking = null; cx.notify(); return; }
    this.picking = { session: sessionOf(t), command: name, current, text: this.host.input.value() };
    this.lastQuery = `pick:${name}`;
    this.index = Math.max(0, c.choices.findIndex(x => x.name === current));
    this.host.input.focus();
    cx.notify();
  }

  view(t) {
    // What the menu shows now: the skills or commands matching what's typed, the choices for a command, or a command picked from the status line; null when it's closed.
    const skills = t?.harness.skills;
    if (!skills) return null;
    const text = this.host.input.value(), p = this.picking;
    if (p && p.session === sessionOf(t) && p.text === text) {
      const c = this.command(t, p.command);
      if (c?.choices?.length) return this.shown({ kind: "pick", command: c.name, current: p.current, items: c.choices, invoke: skills.invoke }, `pick:${c.name}`);
    }
    if (text === this.dismissed) return null;
    const token = skillToken(text, skills.triggers);
    if (token) return this.shown({ kind: "skills", token, items: matchSkills(this.list(t), token.query, skills.invoke), invoke: skills.invoke, noun: skills.commands ? "command" : "skill" }, token.query);
    const typed = choiceToken(text, skills.invoke);
    const c = typed && this.command(t, typed.command);
    if (!c?.choices?.length || c.choices.some(x => x.name === typed.query)) return null;
    return this.shown({ kind: "choices", token: typed, command: c.name, items: matchChoices(c.choices, typed.query), invoke: skills.invoke }, `${c.name} ${typed.query}`);
  }

  shown(v, query) {
    // `v` with the selection in range, back at the top when what's typed changed; null when nothing matches.
    if (!v.items.length) return null;
    if (query !== this.lastQuery) { this.lastQuery = query; this.index = 0; }
    this.index = Math.min(this.index, v.items.length - 1);
    return v;
  }

  move(t, dir, cx) {
    // ↑ or ↓ while it's open moves the selection, wrapping; false when it's closed.
    const v = this.view(t);
    if (!v) return false;
    this.index = (this.index + dir + v.items.length) % v.items.length;
    cx.notify();
    return true;
  }

  accept(t, cx, index = this.index) {
    // Puts the skill, command or choice in the box, or runs a picked command with its choice; false when the menu is closed.
    const v = this.view(t);
    if (!v) return false;
    const name = v.items[index].name;
    if (v.kind === "pick") {
      this.picking = null;
      this.host.sendCommand(`${v.invoke}${v.command} ${name}`, cx);
      cx.notify();
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
    if (v.kind === "pick") this.picking = null;
    else this.dismissed = this.host.input.value();
    cx.notify();
    return true;
  }

  render(t, active) {
    // The menu, floating above the reply box so the conversation doesn't move; null when it's closed.
    const v = this.view(active);
    if (!v) return null;
    const first = Math.max(0, Math.min(this.index - Math.floor(ROWS / 2), v.items.length - ROWS));
    return v_flex().id("skill-menu").absolute().bottom_full().left(0).right(0).mb(6).p(4).rounded(14).border_1().border_color(t.border).bg(t.surface)
      .children(v.items.slice(first, first + ROWS).map((s, i) => {
        const at = first + i, chosen = at === this.index, now = v.kind === "pick" && s.name === v.current;
        return h_flex().id(`${v.kind}-${s.name}`).w_full().h(32).px(10).gap(12).items_center().rounded(9).cursor_pointer().border_1().border_color(chosen ? t.accent : "#00000000")
          .when(chosen, el => el.bg(t.raised)).hover(st => st.bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); this.accept(active, cx, at); })
          .child(div().flex_none().text_size(13).font_family(mono()).text_color(chosen ? t.accent : t.foreground).child(v.kind === "skills" ? `${v.invoke}${s.name}` : s.name))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(chosen ? t.foreground : t.muted).child(s.description))
          .when(now, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("current")))
          .when(s.source === "project", el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.source)));
      }))
      .child(div().w_full().px(10).pt(4).pb(2).text_size(11).text_color(t.dim).child(menuFooter(v)));
  }
}

function menuFooter(v) {
  // The line under the menu: how many there are, and the keys.
  const n = v.items.length;
  if (v.kind === "pick") return `${v.invoke}${v.command} · ↑↓ to choose · Enter to run it · Esc to close`;
  if (v.kind === "choices") return `${n} choice${n === 1 ? "" : "s"} for ${v.invoke}${v.command} · ↑↓ to choose · Enter or Tab to insert · Esc to close`;
  return `${n} ${v.noun}${n === 1 ? "" : "s"} · ↑↓ to choose · Enter or Tab to insert · Esc to close`;
}
