import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { stage, MOD } from "./stage.mjs";

const { parseReader, parseReaderInSlices, applyRead, blankSession, readerArgs, embeddedReader, readerFromFolder, compressProgram, compressedReader, readerProgram, batchProgram, splitBatch, quietRead, QUIET_EVERY, REMOTE_IDLE_EVERY } = await stage().load("model/session.js");
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; };
const enc = encodeURIComponent;
const said = s => s.messages.filter(m => m.kind === "message").map(m => m.text);

const s = blankSession();
applyRead(s, parseReader(["PATH|" + enc("/log.jsonl"), "OFFSET|100", "RESET", "M|user||" + enc("hi"), "C|c1|" + enc(JSON.stringify({ k: "read", d: "a.js" })), "M|assistant|final|" + enc("done")].join("\n")));
check("a fresh read sets path and offset", s.path === "/log.jsonl" && s.offset === 100);
{
  const r = parseReader(["M|user||" + enc("what colour?") + "|" + enc(JSON.stringify(["/x/herdr-core/d/files/t1/a.png", ""])), "M|user||" + enc("50%|done")].join("\n"));
  check("a message's images come through, and text with a bar or percent sign stays whole",
    JSON.stringify(r.added.map(m => [m.text, m.images ?? null])) === JSON.stringify([["what colour?", ["/x/herdr-core/d/files/t1/a.png", ""]], ["50%|done", null]]));
}
check("its messages and tool call", JSON.stringify(said(s)) === '["hi","done"]' && s.messages.some(m => m.kind === "tools"));
applyRead(s, parseReader(["PATH|" + enc("/log.jsonl"), "OFFSET|180", "O|c1|" + enc("file text"), "M|user||" + enc("more")].join("\n")));
check("a later read adds to it", JSON.stringify(said(s)) === '["hi","done","more"]' && s.offset === 180);
check("a tool's output reaches its call", s.calls.get("c1").o === "file text");
applyRead(s, parseReader(["PATH|" + enc("/log.jsonl"), "OFFSET|50", "RESET", "M|user||" + enc("rewound")].join("\n")));
check("RESET starts over", JSON.stringify(said(s)) === '["rewound"]');
applyRead(s, parseReader(["PATH|" + enc("/other.jsonl"), "OFFSET|10", "M|user||" + enc("new log")].join("\n")));
check("a new log starts over", JSON.stringify(said(s)) === '["new log"]' && s.path === "/other.jsonl");
check("an <hc> wrapper is taken off a user message", said((() => { const x = blankSession(); applyRead(x, parseReader("PATH|p\nM|user||" + enc('<hc from="a/b">steer</hc>'))); return x; })())[0] === "steer");

const home = mkdtempSync(join(tmpdir(), "herdr-chat-sessions-"));
const entry = (type, uuid, parent, content) => JSON.stringify({ parentUuid: parent, isSidechain: false, type, uuid, message: { role: type, content } });
const U = i => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
mkdirSync(join(home, ".claude", "projects", "-work"), { recursive: true });
for (const [pid, sid, words] of [[4101, "s1", ["one", "two"]], [4102, "s2", ["three", "four"]]]) {
  writeFileSync(join(home, ".claude", "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd: "/work" }));
  writeFileSync(join(home, ".claude", "projects", "-work", `${sid}.jsonl`),
    entry("user", U(pid), null, words[0]) + "\n" + entry("assistant", U(pid + 1), U(pid), [{ type: "text", text: words[1] }]) + "\n");
}
const order = JSON.parse(readFileSync(join(MOD, "readers", "manifest.json"), "utf8"));
const reader = Buffer.from(order.map(f => readFileSync(join(MOD, "readers", f), "utf8")).join("\n"));
const env = { ...process.env, HOME: home };
const claude = { reader: "claude-code" };
const terms = [{ app: "claude-code", harness: claude, label: "Claude Code", pid: 4101, created: 1, cwd: "/work" }, { app: "claude-code", harness: claude, label: "Claude Code", pid: 4102, created: 1, cwd: "/work" }];
const single = terms.map(t => execFileSync("python3", ["-c", reader.toString(), ...readerArgs(t, { offset: 0 })], { env }).toString().replace(/^/, ""));
const batch = splitBatch(execFileSync("python3", ["-c", batchProgram(embeddedReader(reader.toString("base64"))), Buffer.from(JSON.stringify(terms.map(t => readerArgs(t, { offset: 0 })))).toString("base64")], { env }).toString());
check("the batch gives one output per session", batch.length === 2);
check("and on Windows, where Python ends its lines with \\r\\n", splitBatch("--herdr-chat-session--\r\nPATH|a\r\n--herdr-chat-session--\r\nPATH|b\r\n").length === 2);
check("each the same as reading it alone", batch[0] === single[0] && batch[1] === single[1]);
const both = batch.map(o => { const x = blankSession(); applyRead(x, parseReader(o)); return said(x).join(","); });
check("and each its own conversation", both[0] === "one,two" && both[1] === "three,four");
const wrongHint = execFileSync("python3", ["-c", reader.toString(), ...readerArgs(terms[1], { offset: 0, hint: "4101" })], { env }).toString();
check("a remembered process from another terminal is not trusted", wrongHint === execFileSync("python3", ["-c", reader.toString(), ...readerArgs(terms[1], { offset: 0 })], { env }).toString());
const fromFolder = readerFromFolder(Buffer.from(join(MOD, "readers")).toString("base64"));
const WINDOWS_COMMAND_LIMIT = 32767;
check("reading from the folder fits Windows' command line, with room for a screen's text", readerProgram(fromFolder).length + 3000 < WINDOWS_COMMAND_LIMIT && batchProgram(fromFolder).length + 3000 < WINDOWS_COMMAND_LIMIT);
check("and reads the same as carrying the reader", execFileSync("python3", ["-c", readerProgram(fromFolder), ...readerArgs(terms[0], { offset: 0 })], { env }).toString() === single[0]);
const compressed = compressedReader(execFileSync("python3", ["-c", compressProgram(Buffer.from(join(MOD, "readers")).toString("base64"))], { env }).toString().trim());
check("compressed for another machine, it fits Windows' command line with room for a screen's text", readerProgram(compressed).length + 3000 < WINDOWS_COMMAND_LIMIT && batchProgram(compressed).length + 3000 < WINDOWS_COMMAND_LIMIT);
check("and reads the same too", execFileSync("python3", ["-c", readerProgram(compressed), ...readerArgs(terms[0], { offset: 0 })], { env }).toString() === single[0]);
const bad = splitBatch(execFileSync("python3", ["-c", batchProgram(embeddedReader(reader.toString("base64"))), Buffer.from(JSON.stringify([["--app", "pi", "--pid", "x"], readerArgs(terms[0], { offset: 0 })])).toString("base64")], { env }).toString());
check("a run that fails doesn't stop the others", bad.length === 2 && bad[1] === single[0]);
const long = ["PATH|" + enc("/l.jsonl"), "OFFSET|9", ...Array.from({ length: 300 }, (_, i) => `M|assistant|final|${enc("line " + i + "\r")}`)].join("\r\n");
let pauses = 0;
const sliced = await parseReaderInSlices(long, async () => { pauses++; }, -1);
check("read in slices, an update is the same as read at once", JSON.stringify(sliced) === JSON.stringify(parseReader(long)) && sliced.added.length === 300);
check("and it pauses between slices", pauses > 0);
const due = (t, status, since) => JSON.stringify(quietRead(t, status, since));
check("an idle agent on another machine has its log read every few seconds, since a model switched there changes nothing herdr reports",
  due({ status: "idle", remote: true }, null, REMOTE_IDLE_EVERY) === '{"card":false,"log":true}' && due({ status: "idle", remote: true }, null, REMOTE_IDLE_EVERY - 1) === "null");
check("one waiting on its subagents sooner", due({ status: "idle", remote: true }, { agents: [{ id: "A" }] }, QUIET_EVERY) === '{"card":false,"log":true}');
check("an idle agent here is left to its folder watch", due({ status: "idle", remote: false }, null, 60000) === "null");
check("a working one has its card read, and its log too on another machine",
  due({ status: "working", remote: false }, null, QUIET_EVERY) === '{"card":true,"log":false}' && due({ status: "working", remote: true }, null, QUIET_EVERY) === '{"card":true,"log":true}');
check("a blocked one only its card", due({ status: "blocked", remote: true }, null, QUIET_EVERY) === '{"card":true,"log":false}');
process.exit(failed ? 1 : 0);
