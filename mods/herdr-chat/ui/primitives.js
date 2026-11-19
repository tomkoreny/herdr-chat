import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, run } from "herdr";
import { ICONS } from "../common.js";

export const COLUMN = 740;

export function icon(name, size, color) { return svg(`${ICONS}/${name}.svg`).size(size).flex_none().text_color(color); }
export function mono() { return settings().font_family || settings().font || "JetBrains Mono"; }

export function programIcon(p, size, color) {
  // A program's icon, as herdr's program table says to draw it.
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).size(size).flex_none();
}

export function paneButtons(t, pane, zoomed, prefix) {
  // A pane's split right, split down, zoom and close buttons, for a header shown while it's hovered.
  const button = (id, glyph, command, args) => div().id(`${prefix}-${id}`).p(3).rounded(4).flex_none().cursor_pointer()
    .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
    .child(svg(`${ICONS}/${glyph}.svg`).size(14));
  return [
    button("split-right", "split-right", "pane.split", { direction: "right", pane }),
    button("split-down", "split-down", "pane.split", { direction: "down", pane }),
    button("zoom", zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }),
    button("close", "close", "pane.close", { pane }),
  ];
}

export function statusBadge(t, status) {
  // An agent's status in a header: a spinner while working, "Needs you" when blocked, a dot when done.
  if (status === "working") return svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26")
    .text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you");
  if (status === "done") return div().size(7).flex_none().rounded(4).bg(t.done);
  return null;
}

export function viewToggle(t, shown, prefix, toChat, toTerminal) {
  // The Chat | Terminal switch: the shown view highlighted, the other one switches when clicked.
  const segment = (id, label, selected, go) => div().id(`${prefix}-${id}`).px(10).h(24).flex().items_center().rounded(6)
    .text_size(12.5).text_color(selected ? t.foreground : t.muted).when(selected, el => el.bg(t.selected))
    .when(!selected, el => el.cursor_pointer().hover(s => s.text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); go(); }))
    .child(label);
  return h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border)
    .child(segment("chat", "Chat", shown === "chat", toChat))
    .child(segment("terminal", "Terminal", shown === "terminal", toTerminal));
}

export function clock(ms) {
  // A time as the clock shows it (3:42 PM).
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function disclosure(t, glyph, title, open) {
  // A row that opens and closes: an icon, its title, and a chevron saying which way it's set.
  return h_flex().h(30).gap(8).items_center().text_size(13.5).text_color(open ? t.foreground : t.muted)
    .child(icon(glyph, 14, t.muted))
    .child(div().flex_shrink(1).min_w(0).truncate().child(title))
    .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim));
}

export function bubble(t, width, body) {
  // A message from the person: right-aligned, in a rounded bubble up to `width`.
  return h_flex().w_full().justify_end()
    .child(div().max_w(width).px(16).py(11).rounded(18).bg(t.raised).text_size(15).text_color(t.foreground).child(body));
}

export function keyButton(t, id, label, onClick, accent = false) {
  // A small key-like button, as the question card uses for ←, ↑, Esc and the like.
  return div().id(id).h(24).px(9).flex().items_center().rounded(6).cursor_pointer()
    .border_1().border_color(accent ? t.accent : t.border).bg(t.background).text_size(12).text_color(t.foreground)
    .hover(s => s.bg(t.hover)).on_click(onClick).child(label);
}

export function checkbox(t, checked) {
  // A multi-select row's box.
  return div().flex_none().size(12).flex().items_center().justify_center().rounded(3).border_1()
    .border_color(checked ? t.accent : t.dim).bg(checked ? t.accent : t.background)
    .text_size(9).text_color(t.background).child(checked ? "✓" : "");
}

export function radio(t, checked) {
  // A single-choice row's dot.
  return div().flex_none().size(12).flex().items_center().justify_center().rounded(6).border_1()
    .border_color(checked ? t.accent : t.dim).bg(t.background)
    .child(div().size(6).rounded(3).bg(checked ? t.accent : t.background));
}

export function cardTitle(t, title, folded, about, onToggle) {
  // A prompt card's title row: its dot and title, what it asks beside them while folded, and the chevron; a click folds or opens the card.
  return h_flex().id("card-title").gap(8).items_center().cursor_pointer().on_click(onToggle)
    .child(div().size(7).rounded(4).flex_none().bg(t.blocked))
    .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
    .when(folded && Boolean(about), el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(`· ${about}`)))
    .when(!folded, el => el.child(div().flex_1()))
    .child(icon(folded ? "chevron-right" : "chevron-down", 14, t.dim));
}
