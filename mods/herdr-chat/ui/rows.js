import { div, image } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { COLUMN, icon, mono, disclosure, bubble } from "./primitives.js";
import { SENT_DIR, previewFile, pictureFor } from "../images.js";
import { KINDS, STEP, summary, stepText, pictureBox } from "../model/transcript.js";
import { diagramFor } from "../diagrams.js";

const TURN_GAP = 28;

function codeBox(id, lang, source, t, copied) {
  // A code block in a box titled with its language; with `copied` set (true once copied), a copy icon sits at the top right.
  const lines = source.replace(/\n$/, "").split("\n");
  return v_flex().id(id).w_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
    .child(h_flex().h(30).px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(lang || "text"))
      .when(copied === true, el => el.child(div().text_size(11.5).text_color(t.muted).child("Copied")))
      .when(copied !== undefined, el => el.child(icon(copied ? "check" : "copy", 14, t.muted))))
    .child(v_flex().px(12).py(8).font_family(mono()).text_size(12.5).text_color(t.foreground)
      .children(lines.map((l, k) => div().id(`${id}-l${k}`).w_full().min_h(18).child(l.replace(/\t/g, "    ") || " "))));
}

function codeRow(m, { t, copied }) {
  // A fenced code block of a reply as a row of its own: clicking it copies the code (see onItemClick in main.js).
  return codeBox(`code-${m.key}`, m.lang, m.text, t, copied === m.key);
}

function copyRow(m, { t, copied }) {
  // The copy button under an agent's response, at the right, drawn as a button only while hovered: clicking the row copies the response (see onItemClick in main.js).
  const done = copied === m.key;
  return h_flex().w_full().h(32).items_center().justify_end()
    .child(div().id(`copy-${m.key}`).size(30).flex_none().flex().items_center().justify_center().rounded(8).border_1().border_color(t.background)
      .hover(s => s.bg(t.raised).border_color(t.border))
      .child(icon(done ? "check" : "copy", 15, done ? t.foreground : t.muted)));
}

function markdown(id, source, t) {
  // Markdown with each fenced code block in a titled box of its own.
  const parts = source.split(/```([^\n`]*)\n([\s\S]*?)```/g);
  if (parts.length === 1) return TextView.markdown(id, source).selectable(true);
  const blocks = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) blocks.push(TextView.markdown(`${id}-t${i}`, parts[i].trim()).selectable(true));
    if (i + 2 < parts.length) {
      blocks.push(codeBox(`${id}-c${i}`, parts[i + 1]?.trim(), parts[i + 2], t));
    }
  }
  return v_flex().w_full().gap(12).children(blocks);
}

function toolsRow(m, { t, open }) {
  // A group's title line; opened, its steps follow as rows of their own (stepRows).
  const kinds = [...new Set(m.calls.map(c => c.k).filter(k => k !== "think"))];
  const glyph = !kinds.length ? "brain" : kinds.length === 1 ? (KINDS[kinds[0]] ?? KINDS.other).icon : "layers";
  return v_flex().w_full().child(disclosure(t, glyph, summary(m.calls), Boolean(open[m.key])));
}

function stepRow(m, { t, open: opened }) {
  // One step of an opened group: a thought in full markdown, or a call with its output in a box.
  const i = m.key, c = m.call, open = Boolean(opened[i]), shown = stepText(c, open);
  const toggle = shown.more || open && stepText(c, false).more;
  const body = !shown.text ? null
    : c.k === "think" ? div().w_full().pb(4).child(TextView.markdown(`think-${i}`, shown.text).selectable(true).text_size(13).text_color(t.muted))
    : v_flex().w_full().px(10).py(7).rounded(7).bg(t.surface).font_family(mono()).text_size(12).text_color(t.muted)
      .children(shown.text.split("\n").map((l, k) => div().id(`o-${i}-${k}`).w_full().min_h(18).child(l || " ")));
  return v_flex().w_full().ml(6).pl(16).border_l(1).border_color(t.border).pb(m.last ? 6 : 2)
    .child(h_flex().h(28).gap(10).items_center().min_w(0)
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(STEP[c.k] ?? c.k))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(mono()).text_color(t.muted).child(c.d || ""))
      .when(toggle, el => el.child(h_flex().flex_none().gap(4).items_center().text_size(12).text_color(t.dim)
        .child(open ? "Show less" : shown.hidden ? `${shown.hidden} more lines` : "Show all")
        .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim)))))
    .when(body, el => el.child(body));
}

function sentImage(t, id, path, sent, machine) {
  // An image in the person's message: its preview in sent/, else a chip with its name.
  const name = path.split(/[\\/]/).pop(), preview = previewFile(sent, path, machine);
  if (preview) return div().id(id).size(120).flex_none().rounded(12).overflow_hidden().border_1().border_color(t.border).bg(t.raised)
    .tooltip(name).child(image(`${SENT_DIR}/${preview}`).size_full());
  return h_flex().id(id).h(32).px(10).gap(6).flex_none().items_center().rounded(8).bg(t.raised).text_size(12.5).text_color(t.muted)
    .child(icon("image", 14, t.muted)).child(name || "Pasted image");
}

function messageRow(m, { t, width, sent, machine }) {
  // A message: the person's in a bubble (its images above it), the agent's as plain markdown across the column.
  if (m.role === "user") {
    const room = Math.min(620, Math.round(Math.min(COLUMN, width - 48) * 0.85));
    const text = m.text ? bubble(t, room, markdown(`body-${m.key}`, m.text, t)) : null;
    if (!m.images?.length) return text;
    return v_flex().w_full().gap(8)
      .child(h_flex().w_full().justify_end().flex_wrap().gap(8).children(m.images.map((p, i) => sentImage(t, `img-${m.key}-${i}`, p, sent, machine))))
      .when(Boolean(text), el => el.child(text));
  }
  return div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${m.key}`, m.text, t));
}

function diagramRow(m, { t, width }) {
  // A ```mermaid block from a reply, as its own row: the picture alone, in the reply's column.
  const d = diagramFor(m.text, t);
  if (d.state === "queued") return div().w_full().h(24).flex().items_center().text_size(12.5).text_color(t.dim).child("Drawing diagram…");
  if (d.state === "failed") return v_flex().w_full().gap(6)
    .child(markdown(`diagram-src-${m.key}`, "```mermaid\n" + m.text + "\n```", t))
    .child(div().text_size(12).text_color(t.dim).child(`Couldn't draw this diagram: ${d.error}`));
  const room = Math.min(COLUMN, Math.max(280, Math.floor(width) - 50));
  const w = Math.min(d.width, room), h = Math.round(d.height * w / d.width);
  return div().w_full().child(image(d.rel).w(w).h(h));
}

function pictureRow(m, { t, width, machine, cwd }) {
  // A picture a reply shows, copied from the agent's machine (images.js): drawn once it has arrived, a line saying so until then; a web
  // address as a link, as the chat opens no connections of its own.
  const p = pictureFor(m.src, cwd, machine, m.owner), label = m.alt || m.src.split(/[\\/]/).pop() || "Picture";
  const line = (glyph, text) => h_flex().h(28).px(10).gap(6).items_center().rounded(8).bg(t.surface).text_size(12.5).text_color(t.muted)
    .child(icon(glyph, 14, t.muted)).child(div().min_w(0).truncate().child(text));
  if (p.state === "ready") {
    const room = Math.min(COLUMN, Math.max(280, Math.floor(width) - 50));
    const size = pictureBox(p, room, m);
    return div().w_full().child(div().id(`pic-${m.key}`).w(size.width).h(size.height).rounded(10).overflow_hidden().border_1().border_color(t.border)
      .tooltip(m.alt || m.src).child(image(p.rel).size_full()));
  }
  if (p.state === "fetching") return div().w_full().child(line("image", `${label} · loading`));
  if (/^https?:/i.test(m.src)) return div().w_full().text_size(15).child(TextView.markdown(`pic-${m.key}`, `[${label.replace(/[[\]]/g, "")}](${m.src})`));
  return div().w_full().child(line("image", `${label} · ${p.state === "failed" ? "couldn't be copied from the agent's machine" : "not shown here"}`));
}

export function row(m, ctx) {
  // One conversation row, drawn from the row alone and `ctx` ({ t, open, width, sent, machine, cwd }), with the gap that starts a turn.
  const body = m.kind === "tools" ? toolsRow(m, ctx)
    : m.kind === "step" ? stepRow(m, ctx)
    : m.kind === "note" ? div().w_full().text_size(12.5).text_color(ctx.t.dim).child(m.text)
    : m.kind === "diagram" ? diagramRow(m, ctx)
    : m.kind === "picture" ? pictureRow(m, ctx)
    : m.kind === "code" ? codeRow(m, ctx)
    : m.kind === "copy" ? copyRow(m, ctx)
    : messageRow(m, ctx);
  return m.turnGap ? v_flex().w_full().pt(TURN_GAP).child(body) : body;
}
