import { readFileSync } from "node:fs";
import { parseChoices, parsePrompt, keysFor, looksLikePrompt, typedAnswer, previewKey, fullPreview, promptText } from "../mods/herdr-chat/model/prompts.js";
import claudeCode from "../mods/herdr-chat/harnesses/claude-code.js";
import codex from "../mods/herdr-chat/harnesses/codex.js";
import pi from "../mods/herdr-chat/harnesses/pi.js";
import opencode from "../mods/herdr-chat/harnesses/opencode.js";
import omp from "../mods/herdr-chat/harnesses/omp.js";

let failed = false;
const check = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"}  ${name}`); if (!ok) failed = true; };

const footer = " Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel …";
const rule = "─".repeat(95);

const cutOff = parseChoices([
  rule,
  " ←  ■ Version   □ Ships from   □ Acceptance   □ Offer scope   ✓ Submit  →",
  "",
  "",
  " What exactly should count as ships_from being Amazon?",
  "",
  "❯ 1. Exact Amazon.com (Recommended)",
  "     Only normalize + exact-match ships_from == 'Amazon.com'. Captured AOD fixtures use this",
  "     value; no fuzzy containment.",
  "  2. Accepted identity set",
  "     Accept ships_from when it is Amazon.com, Amazon Resale, or Amazon Warehouse, matching the",
  "↓",
  rule,
  "",
  footer,
].join("\n"));
check("a list cut off inside a description is still a question", cutOff?.options.length === 3 && cutOff.options[2].hidden && cutOff.options[2].input === "text");
check("its descriptions stay with their options", cutOff?.options[1].desc.length === 1 && cutOff?.options[0].desc.length === 2);
check("the first one is selected", cutOff?.options[0].selected === true && cutOff?.options[1].selected === false);
check("more choices are noted", cutOff?.more === true);
check("the question is read", cutOff?.question.at(-1) === "What exactly should count as ships_from being Amazon?");

const whole = parseChoices([
  " Pick one",
  "",
  "❯ 1. First",
  "     About the first",
  "  2. Second",
  "     About the second",
  "",
  footer,
].join("\n"));
check("a whole list ending on a description is read", whole?.options.map(o => o.label).join() === "First,Second" && whole?.more === false);

const none = parseChoices(["     some indented text", "     more of it", "", footer].join("\n"));
check("indented text alone is no question", none === null);

const screen = name => readFileSync(new URL(`fixtures/prompts/${name}.txt`, import.meta.url), "utf8").trim();
const read = (app, name) => parsePrompt(app, screen(name));
const labels = p => p?.options.map(o => o.label).join();

check("Claude: single choice past the rule", labels(read(claudeCode, "claude-single")) === "Cat,Dog,Type something.,Chat about this");
check("Claude: the question and step tabs", read(claudeCode, "claude-q1")?.question.at(-1) === "Pick a color" && /Submit/.test(read(claudeCode, "claude-q1").tabs));
const claudeMulti = read(claudeCode, "claude-q2-toggled");
check("Claude: multi-select with its Next row", claudeMulti?.multi && labels(claudeMulti) === "Cheese,Olives,Basil,Type something,Next,Chat about this");
check("Claude: what's checked", claudeMulti?.options.map(o => o.checked).join() === "false,true,false,false,,");
check("Claude: Next is reached by arrows past the options", keysFor(claudeCode, claudeMulti, 4).join() === "down,down,down,enter");
check("Claude: the review step", labels(read(claudeCode, "claude-review")) === "Submit answers,Cancel");
check("Claude: a permission prompt", labels(read(claudeCode, "claude-perm")).endsWith(",No"));
check("Claude: a permission prompt drops its tip", !read(claudeCode, "claude-perm").question.some(l => l.startsWith("Tip:")));

const claudeOne = read(claudeCode, "claude-q1");
check("Claude: steps with what's answered", claudeOne.steps.map(s => s.label).join() === "Color,Toppings,Size,Submit" && claudeOne.steps.every(s => !s.done));
check("Claude: its text rows are inputs", claudeOne.options.map(o => o.input ?? "").join() === ",,,text,chat");
check("Claude: typing goes to the row with arrows only", typedAnswer(claudeCode, claudeOne, 3).before.join() === "down,down,down");
check("Claude: chatting leaves the question first", typedAnswer(claudeCode, claudeOne, 4).before.join() === "down,down,down,down,enter");
check("Claude: a multi-select's text row stays an input", claudeMulti.options[3].input === "text" && claudeMulti.options[3].typed === "");
const typedRow = parsePrompt(claudeCode, screen("claude-q2-toggled").replace("[ ] Type something", "[✔] anchovy"));
check("Claude: typed text stays in its input row", typedRow.options[3].input === "text" && typedRow.options[3].typed === "anchovy" && typedRow.options[3].checked);
check("Claude: typing doesn't change which question this is", typedRow.sig === claudeMulti.sig);

const submit = read(claudeCode, "claude-submit-page");
check("Claude: the review keeps its steps", submit.steps.length === 4 && submit.review.warning === "You have not answered all questions");
const answered = read(claudeCode, "claude-review-answered");
check("Claude: a review with answers keeps its steps and lists them", answered.steps.length === 4 && answered.review.answers.at(-1).answer === "Small" && answered.review.answers.length === 3);
const noted = parsePrompt(claudeCode, `${screen("claude-review-answered")}\n[hc] only its screen: it is blocked; history is not scrolled in this state`);
check("Claude: hc's note under a screen doesn't hide a review", noted?.steps.length === 4 && noted.options.length === 2);
const piSubmit = read(pi, "pi-submit-page");
check("Pi: the review keeps its steps past the rule", piSubmit.steps.length === 4 && piSubmit.review.warning.startsWith("Answer remaining"));
check("Pi: the review's title stands as the question", piSubmit.question.join() === "Review your answers");
const piReview = read(pi, "pi-review");
check("Pi: the review lists the answers", piReview.review.answers.map(a => `${a.question}=${a.answer}`).join() === "Color=Green,Toppings=Olives,Size=Small");

const piCut = parsePrompt(pi, screen("pi-q2").replace(/\n[^\n]*Type something\.[^\n]*\n[^\n]*Next[^\n]*\n/, "\n↓\n"));
check("Pi: a cut-off multi-select still offers its text row and Next", piCut.more && piCut.options.at(-2).input === "text" && piCut.options.at(-2).hidden && piCut.options.at(-1).next);
check("Pi: Next past the cut-off moves on with the arrow", keysFor(pi, piCut, piCut.options.length - 1).join() === "right");
check("Pi: scrolling doesn't change which question this is", piCut.sig === read(pi, "pi-q2").sig);

const narrow = parsePrompt(pi, ["────────────", " ←  □ Color   ■ Toppings", "", " Pick a size", "", "❯ 1. Small", "  2. Large", "────────────", " Enter to select · ↑/↓ to …"].join("\n"));
check("Pi: a step row cut off by a narrow window keeps its steps", narrow.steps.map(s => s.label).join() === "Color,Toppings" && narrow.steps[1].done);

const wrapped = parsePrompt(claudeCode, [
  "─".repeat(40),
  "←  ☒ Scope  ☐ Extras  ✔ Submit  →",
  "",
  "│ Which related fixes should this effort include? Both were planned, and neither",
  "│ is needed for it to work. The other one matters too, and I found no fix for",
  "│ that in the code.",
  "",
  "❯ 1. [ ] Cleanup (Recommended)",
  "         Remove the unused fields, as the story decided. Small, but it changes the",
  "         working client and four test fakes.",
  "  2. [ ] Other fix",
  "         Normalize uploads first.",
  "  3. [ ] Type something",
  "     Next",
  "─".repeat(40),
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n"));
check("Claude: a wrapped question stays one question", wrapped.question.length === 1 && wrapped.question[0].startsWith("Which related") && wrapped.question[0].endsWith("in the code."));
check("Claude: a wrapped description stays with its option", wrapped.options[0].desc.length === 2);
const perm = read(claudeCode, "claude-perm");
check("Claude: a permission prompt keeps details apart from its question", perm.question.at(-1) === "Do you want to proceed?" && perm.question.some(l => l.startsWith("touch")));

const piSingleCut = parsePrompt(pi, screen("pi-q1").replace(/\n[^\n]*Type something\.[^\n]*\n/, "\n↓\n"));
check("Pi: a cut-off single choice still offers its text row", piSingleCut.more && piSingleCut.options.at(-1).input === "text" && piSingleCut.options.at(-1).hidden && piSingleCut.options.at(-1).checked === undefined);

const piMulti = read(pi, "pi-q2-toggled");
check("Pi: multi-select with short descriptions", piMulti?.multi && labels(piMulti) === "Cheese,Olives,Basil,Type something.,Next" && piMulti.options[1].checked === true);
check("Pi: descriptions stay with their options", read(pi, "pi-q2").options[0].desc[0] === "Add cheese.");
check("Pi: step tabs", /Submit/.test(read(pi, "pi-q1").tabs ?? ""));
check("Pi: the review step", labels(read(pi, "pi-review")) === "Submit answers,Cancel");

const pv = read(claudeCode, "claude-preview");
check("preview: options parse off the lines they share with the box", labels(pv) === "Hybrid (Recommended),Pure alias,Keep native,Chat about this");
check("preview: the first is selected", pv.options[0].selected && pv.options.filter(o => o.selected).length === 1);
check("preview: the box's text and what it cut", pv.preview.text.join("|") === "connector:" && pv.preview.hidden === 19);
check("preview: the tabs and the whole question come through", pv.steps.map(s => s.label).join() === "Connector,Probe,Submit" && /^Should the `connector` route.*features\.$/.test(pv.question.at(-1)));
check("preview: no box or notes text leaks into the question or options", !JSON.stringify([pv.question, pv.options]).match(/[┌│├└✂]|Notes:|hidden/));
check("preview: Chat about this is a chat row, reached by arrows", pv.options.at(-1).input === "chat" && keysFor(claudeCode, pv, 3).join() === "down,down,down,enter");
const tall = read(claudeCode, "claude-preview-tall");
check("preview: a whole preview comes through, indented, nothing hidden", tall.preview.hidden === 0 && tall.preview.text.length === 20 && tall.preview.text[0] === "connector:" && tall.preview.text[1] === "  name: example-connector" && tall.preview.text[6] === "    retry:");
check("preview: its options parse the same", labels(tall) === labels(pv));
const pvWrapped = read(claudeCode, "claude-preview-wrapped");
check("preview: a label that wraps stays one option, and no description", pvWrapped.options[0].label === "Hybrid: /v1 calls, native lookup (Recommended)" && pvWrapped.options[0].desc.length === 0 && pvWrapped.options.length === 4);
check("preview: a lone question's header tab isn't part of the question", JSON.stringify(pvWrapped.question) === JSON.stringify(["How should the connector work?"]));
check("a description under an option still is one where there's no preview", read(claudeCode, "claude-q1").options[0].desc.length > 0);
const pv2 = read(claudeCode, "claude-preview-second");
check("preview: moving the cursor moves the selection, the question unchanged", pv2.options[1].selected && pv2.sig === pv.sig);
check("preview: an option is answered with arrows from where the cursor is", keysFor(claudeCode, pv2, 2).join() === "down,enter" && keysFor(claudeCode, pv2, 0).join() === "up,enter");
check("preview: a taller reading of the same option gives the whole text", fullPreview(claudeCode, screen("claude-preview-tall"), pv)?.length === 20);
check("preview: not for another option", fullPreview(claudeCode, screen("claude-preview-tall"), pv2) === null);
check("preview: not when it's still cut", fullPreview(claudeCode, screen("claude-preview"), pv) === null);
check("preview: not for another question", fullPreview(claudeCode, screen("claude-preview-tall"), pvWrapped) === null);
check("preview: each option has its own place", previewKey(pv) !== previewKey(pv2));
const pvc = read(claudeCode, "claude-preview-chat");
check("preview: on the chat row its mark wins over the option keeping the preview", pvc.options.at(-1).selected && pvc.options.filter(o => o.selected).length === 1);
const pvAll = parseChoices(["\u2190  \u2610 A  \u2714 Submit  \u2192", "Pick?", "\u276f 1. One          \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510", "  2. Two          \u2502 a: 1  \u2502", "                  \u2502   b \u2502 c \u2502", "                  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518", "                  Notes: press n to add notes", rule, "  Chat about this", footer].join("\n"));
check("preview: nothing hidden, indentation and inner bars kept", pvAll.preview.hidden === 0 && pvAll.preview.text.join("|") === "a: 1|  b \u2502 c");
check("a question without a preview has none", read(claudeCode, "claude-q1").preview === null);
const oc = read(opencode, "opencode-q1");
check("OpenCode: a choice with no cursor mark", labels(oc) === "Red,Green,Blue,Type your own answer");
check("OpenCode: picks by number", keysFor(opencode, oc, 1).join() === "2");
const ocMulti = read(opencode, "opencode-q2-toggled");
check("OpenCode: multi-select gets a Next that tabs on", ocMulti?.multi && ocMulti.options.at(-1).next && keysFor(opencode, ocMulti, ocMulti.options.length - 1).join() === "tab");

const codexQ = read(codex, "codex-q2");
check("Codex: label and description in one row are split", labels(codexQ) === "Cheese,Olives,Basil,None of the above" && codexQ.options[0].desc[0] === "Add cheese.");
check("Codex: the step shows apart from the question", /^Question 2\/3/.test(codexQ.tabs) && codexQ.question[0].startsWith("Pick toppings"));
check("Codex: picks with arrows and Enter", keysFor(codex, read(codex, "codex-q1"), 2).join() === "down,down,enter");
check("Codex: typing goes into the notes", typedAnswer(codex, codexQ, 3).before.at(-1) === "tab" && codexQ.options[3].input === "text");
check("Codex: the step row is one step", codexQ.steps.length === 1 && /^Question 2\/3/.test(codexQ.steps[0].label));
const codexPerm = read(codex, "codex-perm");
check("Codex: a permission prompt keeps its command", codexPerm?.options.length === 3 && codexPerm.question.some(l => l.includes("touch perm-test.txt")));
check("a footer with unreadable choices still looks like a prompt", read(claudeCode, "claude-trust") === null && looksLikePrompt(screen("claude-trust")));
check("an agent's idle screen is no prompt", !looksLikePrompt("› Ask Codex to do anything\n\n  GPT · medium\n  ? for shortcuts"));

const ompRead = name => parsePrompt(omp, promptText(readFileSync(new URL(`fixtures/prompts/omp-${name}.txt`, import.meta.url), "utf8")));
const ompKeys = (p, label) => keysFor(omp, p, p.options.findIndex(o => o.label === label));
const oneField = ompRead("q1-down");
check("OMP: a one-field question reads its legend and choices, the cursor's selected",
  JSON.stringify([oneField.question, oneField.options.map(o => [o.label, o.selected])]) === JSON.stringify([["Pick a fruit"], [["Apple", false], ["Banana", true], ["Cherry", false], ["Type your own answer", false]]]));
check("OMP: a choice is picked with Enter, and a one-field form sent with Enter again", JSON.stringify([ompKeys(oneField, "Banana"), ompKeys(oneField, "Apple")]) === JSON.stringify([["enter", "enter"], ["up", "enter", "enter"]]));
const own = oneField.options.findIndex(o => o.input === "text");
check("OMP: its own-answer row is typed in place: the arrows reach it, Ctrl+A Ctrl+K clear it, then the text and Enter",
  JSON.stringify(typedAnswer(omp, oneField, own).before) === JSON.stringify(["down", "down", "ctrl+a", "ctrl+k"]));
const ticks = ompRead("q2");
check("OMP: a checkbox field ticks with Space and moves on with Next (Enter); its own answer stays in the terminal",
  JSON.stringify([ticks.multi, ticks.options.map(o => [o.label, o.checked ?? null, keysFor(omp, ticks, ticks.options.indexOf(o))])]) === JSON.stringify([true, [["Cheese", true, ["space"]], ["Ham", false, ["down", "space"]], ["Olives", false, ["down", "down", "space"]], ["Next", null, ["enter"]]]]));
check("OMP: a tick keeps it the same question", ompRead("q2-toggled").sig === ticks.sig && ompRead("q2-toggled").options[1].checked === true);
const second = ompRead("q2-next");
check("OMP: a form's later field says which it is, and picking in it doesn't send the form", JSON.stringify([second.question, ompKeys(second, "Large")]) === JSON.stringify([["Size (2 of 2)"], ["down", "enter"]]));
const review = ompRead("q2-typed");
check("OMP: on Submit, the answers are reviewed (a typed one included), and Send presses it",
  JSON.stringify([review.review.answers, review.options.map(o => [o.label, o.keys])]) === JSON.stringify([[{ question: "Toppings", answer: "Cheese, Ham" }, { question: "Size", answer: "Huge" }], [["Send", ["enter"]], ["Change an answer", ["up"]]]]));
check("OMP: an answered form is no question", ompRead("answered") === null);
const plain = screen("omp-q1-down").replace(/\uF054/g, "❯").replace(/\uF192/g, "◉").replace(/\uF10C/g, "○");
const ascii = screen("omp-q1-down").replace(/\uF054/g, ">").replace(/\uF192/g, "(o)").replace(/\uF10C/g, "( )");
check("OMP: its unicode and ascii symbols read the same", [plain, ascii].every(s => parsePrompt(omp, s)?.sig === oneField.sig && ompKeys(parsePrompt(omp, s), "Cherry").join() === "down,enter,enter"));
const typing = parsePrompt(omp, screen("omp-q2-next").replace("\uF054 \uF192 Small", "  \uF192 Small").replace("  \uF10C Other: type your own", "\uF054 \uF10C Other: Hu"));
check("OMP: with the cursor in its own-answer row, what's typed so far shows", JSON.stringify(typing.options.at(-1)) === JSON.stringify({ n: 3, label: "Hu", desc: [], selected: true, input: "text", typed: "Hu", before: ["ctrl+a", "ctrl+k"] }));
const reedit = ompRead("q4-reedit");
check("OMP: a typed answer edited again replaces it, and the card shows what it held",
  JSON.stringify([reedit.options.at(-1).typed, typedAnswer(omp, reedit, reedit.options.length - 1).before]) === JSON.stringify(["Huge", ["ctrl+a", "ctrl+k"]]));
const name = ompRead("q3");
check("OMP: a text field is a text row holding its value, cleared before it's typed over",
  JSON.stringify([name.question, name.multi, name.options.map(o => [o.input, o.typed, typedAnswer(omp, name, 0).before])]) === JSON.stringify([["Name (1 of 4)"], false, [["text", "Tom", ["ctrl+a", "ctrl+k"]]]]));
check("OMP: an empty number field or textarea is an empty text row", ["q3-age", "q3-notes"].map(n => { const p = ompRead(n); return [p.question.at(-1), p.options[0].typed]; }).join("|") === "Age (3 of 4),|Notes (4 of 4),");
const color = ompRead("q3-color");
check("OMP: a select steps through its values with → and ←, and Enter keeps the one shown",
  JSON.stringify([color.question, color.multi, color.options.map(o => [o.label, o.desc, keysFor(omp, color, color.options.indexOf(o))])]) ===
  JSON.stringify([["Color (2 of 4)"], true, [["Red", ["1 of 3"], ["enter"]], ["Next choice", [], ["right"]], ["Previous choice", [], ["left"]]]]));
check("OMP: stepping a select keeps it the same question", parsePrompt(omp, promptText(screen("omp-q3-color").replace("‹ Red ›  1/3", "‹ Green ›  2/3"))).sig === color.sig);
check("OMP: the review shows each kind of field's answer", JSON.stringify(ompRead("q3-typed").review.answers) ===
  JSON.stringify([{ question: "Name", answer: "Jan" }, { question: "Color", answer: "Green" }, { question: "Age", answer: "42" }, { question: "Notes", answer: "hello" }]));
const wide = readFileSync(new URL("fixtures/prompts/omp-q3.txt", import.meta.url), "utf8");
check("a wide terminal's padding doesn't push a long form's top past the 4000 characters judged",
  wide.trim().length > 4000 && parsePrompt(omp, wide.trim().slice(-4000))?.question.at(-1) !== "Name (1 of 4)" && promptText(wide).length <= 4000 && name.question.at(-1) === "Name (1 of 4)");
const ompWrapped = parsePrompt(omp, ["╭─ Ask ─────", "│ What next?", "│ \uF054 \uF192 Switch the window to the Win98", "│     layout", "│   \uF10C Stay", "│", "│   Submit", "├──────", "│ \uF0311 choose · ↑/↓ move · \uF12B7 cancel", "╰──────"].join("\n"));
check("OMP: a long choice wraps onto the next line", ompWrapped?.options[0].label === "Switch the window to the Win98 layout");

process.exit(failed ? 1 : 0);
