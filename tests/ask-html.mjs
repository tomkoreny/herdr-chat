import { parseForm, askForm, plain } from "../mods/herdr-chat/model/ask-html.js";
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
// A form's fields, each as its kind, name and what it offers.
const shape = form => form.fields.map(f => f.kind === "text"
  ? [f.multiline ? "textarea" : f.type, f.name, plain(f.label), f.value]
  : [f.select ? "select" : f.multi ? "checkbox" : "radio", f.name, f.options.map(o => [o.value, plain(o.label), o.checked]), f.other]);

const kube = parseForm(`<form>
  <p>Tokens expired (kubectl returns 401). Fix is on <code>fix/import</code>.</p>
  <fieldset><legend>New kubeconfigs</legend>
    <label>Production <textarea name="prod" rows="3" placeholder="apiVersion: v1 ..."></textarea></label>
    <label>Test <textarea name="test" required>
kept: yes</textarea></label>
  </fieldset>
  <fieldset><legend>Which account</legend>
    <p>The import needs a signed-in user.</p>
    <label><input type="radio" name="account" value="token" checked> Your account, by token</label>
    <label><input type="radio" name="account" value="self"> I sign in myself</label>
  </fieldset>
</form>`);
check("a form's fields come in order, a radio group as one field with OMP's own Other answer", shape(kube),
  [["textarea", "prod", "Production", ""], ["textarea", "test", "Test", "kept: yes"], ["radio", "account", [["token", "Your account, by token", true], ["self", "I sign in myself", false]], true]]);
check("a textarea keeps its rows, placeholder and whether it's required (4 rows when it says none)",
  kube.fields.slice(0, 2).map(f => [f.rows, f.placeholder, f.required]), [[3, "apiVersion: v1 ...", false], [4, "", true]]);
check("loose content is a section of its own and each fieldset one under its legend",
  kube.sections.map(s => [plain(s.title), s.fieldset, s.blocks.map(b => b.kind)]),
  [["", false, ["text"]], ["New kubeconfigs", true, ["field", "field"]], ["Which account", true, ["text", "field"]]]);
check("inline code is a span of its own", kube.sections[0].blocks[0].spans, [{ t: "Tokens expired (kubectl returns 401). Fix is on " }, { t: "fix/import", s: "code" }, { t: "." }]);
check("a field block says which field it is", kube.sections.flatMap(s => s.blocks).filter(b => b.kind === "field").map(b => b.field), [0, 1, 2]);

const split = parseForm(`<form><table><tr><td><label><input type=radio name=size value=s> Small</label></td>
  <td><label><input type=radio name=size value=l disabled> Large</label></td></tr></table>
  <ul><li><label><input type="checkbox" name="extra" value="a" checked> Olives</label>
      <li><label><input type="checkbox" name="extra" value="b"> Other toppings</label></ul>
  <label><input type="checkbox" name="agree"> I agree</label></form>`);
check("radios and checkboxes with one name are one field wherever they sit; a group that offers its own Other gets none, nor does a lone checkbox", shape(split),
  [["radio", "size", [["s", "Small", false], ["l", "Large", false]], true], ["checkbox", "extra", [["a", "Olives", true], ["b", "Other toppings", false]], false], ["checkbox", "agree", [["on", "I agree", false]], false]]);
check("a disabled option is marked", split.fields[0].options.map(o => o.disabled), [false, true]);

const picks = parseForm(`<label for="region">Region</label>
<select id="region" name="region"><option value="eu" disabled>Europe<option>Asia<option value="us">America</select>
<select name="tags" multiple aria-label="Tags"><option selected>one</option><option>two</option></select>
<input name="sentry_dsn" type="URL" value="https://x" pattern="https://.*" minlength="3" maxlength="90">
<input name="age" type="number" min="1" max="120" title="Age">
<input type="hidden" name="token" value="x"><input type="submit" value="Go"><button>Send</button>`);
check("a select is a choice without an Other, its first enabled option picked unless one is; a multiple one picks only what's marked", shape(picks).slice(0, 2),
  [["select", "region", [["eu", "Europe", false], ["Asia", "Asia", true], ["us", "America", false]], false], ["select", "tags", [["one", "one", true], ["two", "two", false]], false]]);
check("a control takes its label from <label for>, aria-label, title or its name, and its limits from its attributes",
  picks.fields.map(f => [plain(f.label), Object.fromEntries(["min", "max", "minLength", "maxLength", "pattern"].filter(k => k in f).map(k => [k, f[k]]))]),
  [["Region", {}], ["Tags", {}], ["sentry dsn", { minLength: 3, maxLength: 90, pattern: "https://.*" }], ["Age", { min: 1, max: 120 }]]);
check("hidden inputs, submit inputs and buttons are no fields, and a multiple select says it takes several",
  picks.fields.map(f => [f.name, Boolean(f.multi)]), [["region", false], ["tags", true], ["sentry_dsn", false], ["age", false]]);

const blocks = parseForm(`<h2>Plan</h2><p>First<p>Second<br>line <b>bold</b> <em>soft</em></p>
<ol><li>one<li>two</ol><pre>
a
  b
</pre><table><tr><th>K<th>V</tr><tr><td>x<td><code>1</code></table>
<img src=" shots/a.png " alt="A shot"><svg aria-label="Drawing"><text>ignored</text></svg><img alt="no source">
<input name="q">`).sections[0].blocks;
check("context comes as headings, paragraphs (an open <p> ends at the next block), lists, preformatted text, tables and pictures",
  blocks.map(b => [b.kind, b.heading ?? null]),
  [["text", true], ["text", false], ["text", false], ["list", null], ["pre", null], ["table", null], ["image", null], ["svg", null], ["field", null]]);
check("a paragraph keeps its line break and its emphasis", blocks[2].spans, [{ t: "Second\nline " }, { t: "bold", s: "strong" }, { t: " " }, { t: "soft", s: "em" }]);
check("a list keeps its order and its items", [blocks[3].ordered, blocks[3].items.map(plain)], [true, ["one", "two"]]);
check("preformatted text keeps its indentation", blocks[4].text, "a\n  b");
check("a table keeps its cells and how many rows head it", [blocks[5].rows.map(row => row.map(plain)), blocks[5].headerRows], [[["K", "V"], ["x", "1"]], 1]);
check("a picture is its source and its name; an svg only its name", [blocks[6], blocks[7]], [{ kind: "image", src: "shots/a.png", alt: "A shot" }, { kind: "svg", alt: "Drawing" }]);

const matrix = parseForm(`<table><tr><th>Area</th><th>Risk</th><th>Note</th></tr>
<tr><td>Login</td><td><select name="login_risk"><option>low<option>high</select></td><td><input name="login_note"></td></tr></table>`);
check("in a table of controls each row's text is a line and a control without a label takes its column's header",
  [matrix.sections[0].blocks.filter(b => b.kind === "text").map(b => plain(b.spans)), matrix.fields.map(f => [f.name, plain(f.label)])],
  [["Login"], [["login_risk", "Risk"], ["login_note", "Note"]]]);

check("content outside the first form is left out", parseForm('<input name="out"><form><input name="in"></form><form><input name="later"></form>').fields.map(f => f.name), ["in"]);
check("a second value of an attribute is ignored, entities are read (unknown ones kept), and a > inside a quoted value doesn't end its tag",
  shape(parseForm('<label>A &amp; B &mdash; &#233; &bogus; <input NAME="x" name="y" value="1 &lt; 2 > 0"></label>')), [["text", "x", "A & B — é &bogus;", "1 < 2 > 0"]]);
check("comments, scripts and styles are no content", parseForm("<!-- note --><style>p { color: red }</style><script>if (a < b) {}</script><p>Shown</p><input name=q>").sections[0].blocks.map(b => b.kind), ["text", "field"]);

check("a call's form is read from its html; one without a named field is no form, as OMP shows none for it",
  [askForm({ id: "a", html: '<form><input name="q"></form>' })?.fields.length, askForm({ id: "b", html: "<form><p>Nothing to fill in.</p><input></form>" }), askForm({ id: "c" }), askForm(null)],
  [1, null, null, null]);
const legacy = askForm({ id: "d", questions: [
  { id: "db", question: "Which <db>?", options: [{ label: "SQLite", description: "one file" }, "Postgres"], recommended: 1 },
  { question: "Extras?", multi: true, options: [{ label: "Cache" }, { label: "Queue" }] },
  { question: "Anything else?" }] });
check("an older questions list reads as fieldsets: radio or checkbox groups (the recommended option picked), or a textarea without options",
  [legacy.sections.map(s => plain(s.title)), shape(legacy)],
  [["Which <db>?", "Extras?", "Anything else?"],
    [["radio", "db", [["SQLite", "SQLite — one file", false], ["Postgres", "Postgres", true]], true], ["checkbox", "q2", [["Cache", "Cache", false], ["Queue", "Queue", false]], true], ["textarea", "q3", "q3", ""]]]);
check("a questions list that isn't one is no form", askForm({ id: "e", questions: [{ question: 1 }] }), null);

process.exit(failed ? 1 : 0);
