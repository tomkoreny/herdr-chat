import assert from "node:assert/strict";
import { withCopyRows, splitCode, splitPictures, pictureBox } from "../mods/herdr-chat/model/transcript.js";

const u = text => ({ kind: "message", role: "user", text });
const a = text => ({ kind: "message", role: "assistant", text });
const tools = { kind: "tools", calls: [] };

const rows = withCopyRows([u("hi"), a("one"), tools, a("two"), u("again"), a("three")], false);
assert.deepEqual(rows.filter(r => r.kind === "copy").map(r => r.text), ["one\n\ntwo", "three"]);
assert.equal(rows[4].kind, "copy");
assert.equal(rows.at(-1).kind, "copy");

const live = withCopyRows([u("hi"), a("one"), u("again"), a("partial")], true);
assert.deepEqual(live.filter(r => r.kind === "copy").map(r => r.text), ["one"]);

assert.deepEqual(withCopyRows([u("hi"), tools], false).filter(r => r.kind === "copy"), []);

const parts = splitCode("before\n```js\nlet x = 1;\n```\nafter");
assert.deepEqual(parts, [
  { kind: "text", text: "before" },
  { kind: "code", lang: "js", text: "let x = 1;" },
  { kind: "text", text: "after" },
]);
assert.equal(splitCode("plain"), null);

// A reply's pictures, as OMP's final replies write them and as markdown does.
const reply = 'Your form:\n\n<img src="../shots/a&amp;b.png" alt="The form" width="80%">\n\nAnd its end: ![The end](shots/end.png "last") done.';
const pics = splitPictures(reply);
assert.deepEqual(pics.map(p => p.kind === "picture" ? [p.src, p.alt, p.width] : p.text), [
  "Your form:", ["../shots/a&b.png", "The form", "80%"], "And its end:", ["shots/end.png", "The end", ""], "done.",
]);
assert.ok(reply.slice(0, pics[1].end).endsWith('width="80%">') && reply.slice(0, pics[3].end).endsWith('"last")'), "a picture's end is where its tag ends in the reply");
assert.deepEqual(splitPictures("<img alt='x' src='one.png'/>").map(p => [p.kind, p.src, p.alt]), [["picture", "one.png", "x"]]);
assert.equal(splitPictures("Write `<img src=\"a.png\">` or `![x](b.png)` to show one."), null, "a picture in inline code is text");
assert.equal(splitPictures("No pictures, [a link](x.png) and <b>bold</b>."), null);

// How big a picture is drawn in a column 700 px wide.
const shot = { width: 2400, height: 1500 }, icon = { width: 64, height: 64 }, tall = { width: 400, height: 2000 };
assert.deepEqual(pictureBox(shot, 700), { width: 700, height: 438 }, "a big screenshot fits the column");
assert.deepEqual(pictureBox(icon, 700), { width: 64, height: 64 }, "a small picture keeps its size");
assert.deepEqual(pictureBox(shot, 700, { width: "50%" }), { width: 350, height: 219 }, "a percentage is of the column");
assert.deepEqual(pictureBox(icon, 700, { width: "128px" }), { width: 128, height: 128 }, "pixels as asked");
assert.deepEqual(pictureBox(shot, 700, { width: "5000" }), { width: 700, height: 438 }, "never wider than the column");
assert.deepEqual(pictureBox(icon, 700, { height: "32" }), { width: 32, height: 32 }, "a height alone sets the size too");
assert.deepEqual(pictureBox(tall, 700), { width: 112, height: 560 }, "a tall one is capped at 560 px high");
console.log("copy rows: ok");
