import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { ICONS } from "../common.js";
import { COLUMN, icon } from "./primitives.js";

function spinner(t, size) { return svg(`${ICONS}/spinner.svg`).size(size).flex_none().text_color(t.accent).spin(900); }

function slot(child) {
  // A fixed-width column for a row's glyph, so the texts line up.
  return div().w(14).h(20).flex_none().flex().items_center().justify_center().child(child);
}

function progressBar(t, done, total) {
  return div().w(56).h(4).flex_none().rounded(2).bg(t.border).overflow_hidden()
    .child(div().h_full().w(`${total ? Math.round(done / total * 100) : 0}%`).rounded(2).bg(t.accent));
}

function taskRow(t, task, i, working) {
  // A task: ticked when completed, crossed out when abandoned, turning while in progress (a dot while the agent waits), a ring while pending.
  const shut = task.status === "completed" || task.status === "abandoned";
  const glyph = task.status === "completed" ? icon("check", 12, t.done)
    : task.status === "abandoned" ? icon("close", 11, t.dim)
    : task.status === "in_progress" ? (working ? spinner(t, 11) : div().size(7).rounded(4).bg(t.accent))
    : div().size(9).rounded(5).border_1().border_color(t.dim);
  return h_flex().id(`hud-task-${i}`).w_full().gap(6).items_center().tooltip(task.content)
    .child(slot(glyph))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5)
      .text_color(task.status === "in_progress" ? t.foreground : shut ? t.dim : t.muted)
      .when(shut, el => el.line_through())
      .child(task.content));
}

function phaseBlock(t, p, i, working) {
  // A phase's name and count; the active one with its tasks beneath it.
  const head = h_flex().h(22).gap(6).items_center()
    .child(div().text_size(12.5).text_color(p.active ? t.foreground : t.muted).when(p.active, el => el.font_semibold()).child(p.name))
    .child(div().text_size(12).text_color(t.dim).child(`${p.done}/${p.total}`));
  if (!p.items.length) return head;
  return v_flex().w_full()
    .child(head)
    .child(v_flex().w_full().ml(4).pl(8).border_l(1).border_color(t.border)
      .children(p.items.map((task, k) => taskRow(t, task, `${i}-${k}`, working)))
      .when(p.more > 0, el => el.child(div().h(20).pl(20).flex().items_center().text_size(12).text_color(t.dim).child(`${p.more} more`))));
}

function agentRow(t, a, i) {
  // A subagent at work: its id and kind, how long it has run, and what it does now.
  return v_flex().id(`hud-agent-${i}`).w_full()
    .child(h_flex().h(22).gap(6).items_center()
      .child(slot(spinner(t, 11)))
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(a.id))
      .when(Boolean(a.kind), el => el.child(div().flex_none().px(6).h(16).flex().items_center().rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(a.kind)))
      .child(div().flex_1())
      .when(Boolean(a.time), el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(a.time))))
    .when(Boolean(a.doing), el => el.child(div().w_full().min_w(0).pl(20).truncate().text_size(12).text_color(t.muted).child(a.doing)));
}

function agentsTitle(t, agents) {
  return h_flex().gap(6).items_center()
    .child(slot(icon("layers", 13, t.muted)))
    .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("Subagents"))
    .child(div().flex_none().text_size(12).text_color(t.muted).child(`${agents.count} running`));
}

export function hud(t, { todo, agents, folded, working, onToggle }) {
  // The card above the reply box with the to-do list (from todoView) and the subagents at work (from agentsView), or null
  // with neither. Its title folds it to one line with the task at hand; `working` turns the glyph of the task in progress.
  const busy = agents.count > 0;
  if (!todo && !busy) return null;
  const title = h_flex().id("hud-title").w_full().h(22).gap(6).items_center().cursor_pointer().on_click((_e, cx) => onToggle(cx))
    .when(Boolean(todo), el => el
      .child(slot(icon("circle-check", 13, t.accent)))
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("To-do"))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(`${todo.done}/${todo.total}`))
      .child(progressBar(t, todo.done, todo.total)))
    .when(!todo, el => el.child(agentsTitle(t, agents)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(folded && todo?.current ? `· ${todo.current}` : ""))
    .when(folded && Boolean(todo) && busy, el => el
      .child(spinner(t, 11))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(`${agents.count} ${agents.count === 1 ? "subagent" : "subagents"}`)))
    .child(icon(folded ? "chevron-right" : "chevron-down", 13, t.dim));
  const card = v_flex().id("hud").flex_none().w_full().max_w(COLUMN).px(12).py(8).gap(6).rounded(12).border_1().border_color(t.border).bg(t.surface)
    .child(title);
  if (folded) return card;
  return card.child(v_flex().id("hud-body").w_full().max_h(300).overflow_y_scrollbar().gap(2)
    .when(Boolean(todo), el => el
      .children(todo.phases.map((p, i) => phaseBlock(t, p, i, working)))
      .when(todo.morePhases > 0, el => el.child(div().h(22).flex().items_center().text_size(12).text_color(t.dim)
        .child(`${todo.morePhases} more ${todo.morePhases === 1 ? "phase" : "phases"}`))))
    .when(Boolean(todo) && busy, el => el.child(div().w_full().h(1).my(6).bg(t.border)).child(agentsTitle(t, agents)))
    .when(busy, el => el
      .children(agents.shown.map((a, i) => agentRow(t, a, i)))
      .when(agents.more > 0, el => el.child(div().h(20).pl(20).flex().items_center().text_size(12).text_color(t.dim).child(`${agents.more} more running`)))));
}
