import { div, svg } from "gpui-kit";
import { v_flex, h_flex, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { ICONS } from "../common.js";
import { COLUMN } from "../ui/primitives.js";
import { designPx, designHeight } from "../measure.js";

const TAIL = 32;
const MEASURE_AT_ONCE = 12;
const FADE = 20;
const rowPadding = m => m.kind === "step" ? 0 : 8;

export class ChatList {
  constructor() {
    // The conversation's scrolling list: row heights, measuring, and staying at the newest message.
    this.scroll = VirtualListScrollHandle.new();
    this.following = true; this.visibleEnd = 0; this.rowCount = 0;
    this.needsScroll = true; this.scrollAskedAt = Date.now(); this.lastAsk = Date.now(); this.laidOut = 0;
    this.pendingCount = -1; this.settling = true; this.isEmpty = true;
    this.heights = {}; this.changedAt = {}; this.lastHeight = {}; this.measuredAt = "";
    this.listH = 0; this.sig = ""; this.settledSig = "";
  }

  follow(restart = false) {
    // Keeps the chat at its newest message.
    this.following = true;
    this.lastAsk = Date.now();
    if (!this.needsScroll || restart) { this.needsScroll = true; this.scrollAskedAt = Date.now(); }
  }

  reset() {
    // Another conversation is shown: hidden until its newest messages are measured and in view.
    this.needsScroll = false; this.settling = true; this.pendingCount = -1;
    this.follow();
  }

  revisit() {
    // Back to Chat from elsewhere: to the newest message, hidden until it lands if anything changed.
    if (this.sig !== this.settledSig) this.settling = true;
    this.follow(true);
  }

  tick(cx) {
    // The scrolling part of the view's timer: lands a pending scroll, then keeps `following` true to what's on screen.
    if (this.following && this.needsScroll) {
      const drawn = this.laidOut >= this.lastAsk;
      if (drawn && (this.pendingCount === 0 || Date.now() - this.scrollAskedAt > 1500)) {
        this.needsScroll = false;
        this.settledSig = this.sig;
        if (!this.isEmpty) this.settling = false;
        this.scroll.scroll_to_bottom();
      }
      cx.notify();
      return;
    }
    if (this.settling) { if (!this.isEmpty) this.follow(); return; }
    const atBottom = this.isEmpty || this.rowCount === 0 || this.visibleEnd >= this.rowCount;
    if (atBottom !== this.following) { this.following = atBottom; cx.notify(); }
  }

  render(cx, { rows, empty, t, inner, zoom, heightKey, waitsFor, row, onItemClick, canJump, beforeScroll }) {
    // The list's body and its off-screen measurer (null when nothing needs measuring).
    this.isEmpty = empty;
    const measuredAt = `${inner}@${window.rem_size()}`;
    if (measuredAt !== this.measuredAt) { this.heights = {}; this.changedAt = {}; this.lastHeight = {}; this.measuredAt = measuredAt; }
    const unmeasured = rows.filter(m => !(heightKey(m) in this.heights)).slice(-MEASURE_AT_ONCE);
    const now = Date.now();
    const settling = rows.filter(m => { const k = heightKey(m); return k in this.heights && now - (this.changedAt[k] ?? 0) < 2000; });
    const pending = [...settling, ...unmeasured];
    const sizes = rows.map(m => (this.heights[heightKey(m)] ?? this.lastHeight[m.key] ?? 40) + rowPadding(m) * 2);
    let bottom = rows.length;
    for (let h = 0; bottom > 0 && h < (this.listH || 900) + 240; ) h += sizes[--bottom];
    const near = rows.slice(bottom);
    this.pendingCount = near.filter(m => !(heightKey(m) in this.heights)).length + near.filter(waitsFor).length;
    this.sig = `${rows.length}:${sizes.reduce((a, b) => a + b, 0)}`;
    beforeScroll?.();
    if (this.needsScroll && this.following && this.pendingCount === 0 && rows.length) {
      this.scroll.scroll_to_bottom();
      this.needsScroll = false; this.settledSig = this.sig;
      if (this.settling) {
        // scroll_to_bottom puts the last row on screen before the next frame (0.1.16), so the list shows from that frame on.
        const token = this.revealToken = (this.revealToken ?? 0) + 1;
        try { cx.timer.after(20, cx => { if (this.revealToken === token) { this.settling = false; cx.notify(); } }); } catch { this.settling = false; }
      }
    }
    this.rowCount = rows.length + 1;
    const body = v_flex().relative().flex_1().min_h(0).when(this.settling, el => el.opacity(0))
      .on_size_change(size => { this.listH = designPx(size.height, zoom); })
      .child(v_virtual_list("herdr-chat-messages", rows.length + 1, [...sizes, TAIL], i => i < rows.length ? rows[i].key : "end-of-chat", range => {
        this.visibleEnd = range.end;
        this.laidOut = Date.now();
        const out = [];
        for (let i = range.start; i < range.end; i++)
          out.push(i < rows.length
            ? h_flex().w_full().justify_center().px(24).py(rowPadding(rows[i])).child(div().w_full().max_w(COLUMN).child(row(rows[i])))
            : div().w_full().h(TAIL));
        return out;
      }).track_scroll(this.scroll).on_item_click(onItemClick).size_full())
      .child(v_flex().absolute().bottom(0).left(0).right(0).h(FADE)
        .children(Array.from({ length: 8 }, (_, i) => div().w_full().flex_1().bg(t.background).opacity((i + 1) / 8))))
      .when(!this.following && !this.needsScroll && canJump, el => el.child(h_flex().absolute().bottom(12).left(0).right(0).justify_center()
        .child(div().id("jump-bottom").size(34).flex().items_center().justify_center().rounded(17).cursor_pointer()
          .bg(t.popover ?? t.surface).border_1().border_color(t.border).shadow_md().text_color(t.foreground)
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.follow(); cx.notify(); })
          .child(svg(`${ICONS}/chevron-down.svg`).size(16)))));
    const measure = pending.length === 0 ? null : v_flex().id("herdr-chat-measure").absolute().top(0).left(-20000).w(inner)
      .children(pending.map(m => {
        const k = heightKey(m);
        return div().id(`measure-${k}`).w(inner).flex_none()
          .on_size_change((size, cx) => {
            const height = designHeight(size, inner);
            if (Math.abs((this.heights[k] ?? -1) - height) > 0.5) {
              this.heights[k] = height; this.lastHeight[m.key] = height; this.changedAt[k] = Date.now();
              if (this.following) this.follow();
              cx.notify();
              cx.timer.after(2100, cx => cx.notify());
            }
          })
          .child(row(m));
      }));
    return { body, measure };
  }
}
