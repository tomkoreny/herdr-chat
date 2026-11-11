import { stage } from "./stage.mjs";

const { statusParts, tokensShort } = await stage().load("model/status.js");
const { blankSession, parseReader, applyRead } = await stage().load("model/session.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const models = [{ name: "anthropic/claude-opus-5-5", title: "Claude Opus 5.5", window: 1000000, description: "" }];
check("the model is named from the harness's list, and the context measured against its window",
  statusParts({ model: "anthropic/claude-opus-5-5", effort: "xhigh", context: 293095, cost: 6.2995 }, models),
  { model: "Claude Opus 5.5", effort: "xhigh", context: "29.3% of 1M", cost: "$6.30" });
check("a model the list hasn't got shows its id, and its context as a count",
  statusParts({ model: "openai-codex/gpt-5.5", context: 2100 }, models), { model: "gpt-5.5", effort: "", context: "2k tokens", cost: "" });
check("no list yet works the same way", statusParts({ model: "anthropic/claude-opus-5-5" }).model, "claude-opus-5-5");
check("no status, no status line", statusParts(null, models), null);
check("token counts stay short", [900, 1500, 272000, 1000000, 1450000].map(tokensShort), ["900", "2k", "272k", "1M", "1.5M"]);

const enc = s => encodeURIComponent(JSON.stringify(s));
const s = blankSession();
applyRead(s, parseReader(`PATH|%2Fa.jsonl\nSTATUS|${enc({ model: "m1", effort: "high", context: 1050, cost: 0.25 })}\nRESET\n`));
applyRead(s, parseReader(`PATH|%2Fa.jsonl\nSTATUS|${enc({ model: "m2", context: 2100, cost: 0.5 })}\n`));
check("a later read replaces what it saw, keeps what it didn't, and adds its cost", s.status, { model: "m2", effort: "high", context: 2100, cost: 0.75 });
applyRead(s, parseReader(`PATH|%2Fa.jsonl\nOFFSET|10\n`));
check("a read without a status changes nothing", s.status, { model: "m2", effort: "high", context: 2100, cost: 0.75 });
applyRead(s, parseReader(`PATH|%2Fa.jsonl\nSTATUS|${enc({ model: "m2", cost: 0.1 })}\nRESET\n`));
check("a fresh read starts over, the cost too", s.status, { model: "m2", cost: 0.1 });
applyRead(s, parseReader(`PATH|%2Fb.jsonl\n`));
check("another session's log drops it", s.status, null);

process.exit(failed ? 1 : 0);
