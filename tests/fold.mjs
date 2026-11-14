import { stage } from "./stage.mjs";
const { foldActivity, stepText, stepRows, summary, OUTPUT_LINES } = await stage().load("model/transcript.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const say = text => ({ kind: "message", role: "assistant", text });
const think = text => ({ kind: "reasoning", text });
const run = d => ({ kind: "tools", calls: [{ k: "shell", d }] });
const shape = rows => rows.map(r => r.kind === "tools" ? `tools(${r.calls.map(c => c.k === "think" ? `think:${c.o}` : c.d).join(",")})` : r.text);

check("thoughts and calls between replies fold into one group, in order",
  shape(foldActivity([think("look first"), run("a"), think("now b"), run("b"), say("done")])),
  ["tools(think:look first,a,think:now b,b)", "done"]);
check("a thought with no text is left out", shape(foldActivity([think("  "), run("a")])), ["tools(a)"]);
check("the input rows aren't changed", (() => { const r = run("a"); foldActivity([r, run("b")]); return r.calls.length; })(), 1);

check("a short thought shows whole", stepText({ k: "think", o: "Check the file." }, false), { text: "Check the file.", more: false });
const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
const preview = stepText({ k: "think", o: long }, false);
check("a long thought previews a few lines, ending in an ellipsis", [preview.more, preview.text.endsWith("…"), preview.text.length <= 362], [true, true, true]);
check("an opened thought shows whole", stepText({ k: "think", o: long }, true).text, long);
const out = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
const shown = stepText({ k: "shell", o: out }, false);
check("long output previews its first lines and counts the rest", [shown.more, shown.text.split("\n").length, shown.hidden], [true, OUTPUT_LINES + 1, 20 - OUTPUT_LINES]);
check("a one-line JSON body is wrapped, not cut, up to the preview's size", stepText({ k: "shell", o: '{"a":1}' }, false), { text: '{"a":1}', more: false });
check("an opened output shows whole", stepText({ k: "shell", o: out }, true).text, out);
const group = { kind: "tools", key: "g1", calls: [{ k: "think", o: "x" }, { k: "shell", d: "ls", o: "a" }] };
check("an opened group's steps are keyed by the group and their place", stepRows(group).map(r => [r.kind, r.key.split(".")[0], r.last]), [["step", "g1/0", false], ["step", "g1/1", true]]);
check("a call that starts several agents counts each of them, and a single agent is named",
  [summary([{ k: "agent", d: "Audit, Review", n: 2 }, { k: "todo", d: "done: map" }]), summary([{ k: "agent", d: "Audit", n: 1 }])],
  ["Ran 2 agents, updated the to-do list", "Ran Audit"]);
process.exit(failed ? 1 : 0);
