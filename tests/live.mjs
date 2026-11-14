import { stage } from "./stage.mjs";

const { livePath, parseLive, liveView, LIVE_LINES, LIVE_CHARS } = await stage().load("model/live.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

check("the live file sits in the folder named after the session's log, with the log's own separators",
  [livePath("/h/.omp/agent/sessions/-w/2026_s1.jsonl", "__live.json"), livePath("C:\\Users\\u\\s1.jsonl", "__live.json")],
  ["/h/.omp/agent/sessions/-w/2026_s1/__live.json", "C:\\Users\\u\\s1\\__live.json"]);
check("no log, or a harness without a live file, has none", [livePath("", "__live.json"), livePath("/a/s.jsonl", undefined)], ["", ""]);

check("an activity is read with its tool, intent and text", parseLive('{"v":1,"at":1,"kind":"tool","tool":"bash","intent":"Running tests","text":"ok\\n"}'),
  { kind: "tool", tool: "bash", intent: "Running tests", text: "ok\n" });
check("no file, a broken one, or an agent between turns is no activity", [parseLive(null), parseLive("{\"kind\":"), parseLive('{"kind":"idle"}')], [null, null, null]);

const thought = liveView(parseLive(JSON.stringify({ kind: "thinking", text: "First check 17.\n\n\nThen 51 = 3 × 17.  \n" })));
check("a thought reads as Thinking, its lines without the blank ones between paragraphs", thought, { title: "Thinking", lines: ["First check 17.", "Then 51 = 3 × 17."], mono: false, italic: true });
const long = liveView({ kind: "text", tool: "", intent: "", text: "word ".repeat(400) + "end" });
check("a long reply keeps its end, cut at a word and marked as cut", [long.lines.length, long.lines[0].startsWith("…word"), long.lines[0].endsWith(" end"), long.lines[0].length <= LIVE_CHARS + 1],
  [1, true, true, true]);
const output = Array.from({ length: 12 }, (_, i) => `\x1b[32mline ${i}\x1b[0m`).join("\n") + "\nprogress 10%\rprogress 90%\n";
check("a tool's output keeps its last lines, in monospace, without colours, and what follows a carriage return",
  liveView({ kind: "tool", tool: "bash", intent: "Running tests", text: output }),
  { title: "bash · Running tests", lines: [...Array.from({ length: LIVE_LINES - 1 }, (_, i) => `line ${12 - LIVE_LINES + 1 + i}`), "progress 90%"], mono: true, italic: false });
check("a tool call still being written names the tool and its intent", liveView({ kind: "call", tool: "edit", intent: "Fixing the reader", text: "" }).title, "Preparing edit · Fixing the reader");
check("no activity, no view", liveView(null), null);

process.exit(failed ? 1 : 0);
