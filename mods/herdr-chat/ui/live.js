import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { COLUMN, mono } from "./primitives.js";

const TAIL_HEIGHT = 64;

export function liveTail(t, view) {
  // The end of what the agent streams (from liveView), under the working spark: a box of fixed height that keeps its newest
  // lines at the bottom and lets the older ones slide out at the top, so the reply box below doesn't jump.
  return v_flex().id("live-tail").w_full().max_w(COLUMN).h(TAIL_HEIGHT).flex_none().overflow_hidden().justify_end()
    .ml(6).pl(16).border_l(1).border_color(t.border)
    .children(view.lines.map((line, i) => div().id(`live-${i}`).w_full().min_h(18).flex_none().text_color(t.muted)
      .when(view.mono, el => el.font_family(mono()).text_size(12).truncate())
      .when(!view.mono, el => el.text_size(12.5))
      .when(view.italic, el => el.italic())
      .child(line)));
}
