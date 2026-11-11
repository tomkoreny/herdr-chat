import { stage } from "./stage.mjs";

const { skillToken, matchSkills, withSkill, parseSkills, choiceToken, matchChoices } = await stage().load("model/skills.js");
const { HARNESSES } = await stage().load("harnesses/index.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const S = (name, description = "") => ({ name, description, source: "" });

check("a slash opening the message starts one", skillToken("/om", ["/"]), { start: 0, trigger: "/", query: "om" });
check("alone too", skillToken("/", ["/"]), { start: 0, trigger: "/", query: "" });
check("a slash mid-message doesn't: it's a path", skillToken("look at /etc", ["/"]), null);
check("$ starts any word where the harness takes it", skillToken("first $im", ["$", "/"]), { start: 6, trigger: "$", query: "im" });
check("a harness without that trigger ignores it", skillToken("$im", ["/"]), null);
check("a finished word closes it", skillToken("/omarchy ", ["/"]), null);
check("nor does plain text open it", skillToken("hello", ["/", "$", "@"]), null);
check("no harness info, no menu", skillToken("/om", undefined), null);

const list = [S("zeta", "about omarchy things"), S("omarchy-app"), S("my-omarchy"), S("omarchy"), S("other")];
check("name starts first, then names containing it, then descriptions", matchSkills(list, "om").map(s => s.name), ["omarchy", "omarchy-app", "my-omarchy", "zeta"]);
check("any case", matchSkills(list, "OMARCHY-A").map(s => s.name), ["omarchy-app"]);
check("empty query lists everything, alphabetical", matchSkills(list, "").map(s => s.name), ["my-omarchy", "omarchy", "omarchy-app", "other", "zeta"]);
const owned = (name, source) => ({ ...S(name), source });
check("a project's come first, then the person's own, then what came with the harness, however they sort by name",
  matchSkills([owned("anthropic:docs", "built-in"), owned("explore-effort", "personal"), owned("zzz-here", "project"), owned("anthropic:pdf", "built-in"), owned("implement-tasks", "personal")], "").map(s => s.name),
  ["zzz-here", "explore-effort", "implement-tasks", "anthropic:docs", "anthropic:pdf"]);
check("a better match still beats ownership", matchSkills([owned("my-docs-tool", "personal"), owned("docs", "built-in")], "docs").map(s => s.name), ["docs", "my-docs-tool"]);
check("no match is empty, so the menu stays out of the way", matchSkills(list, "compact"), []);
check("typing Pi's own /skill: form still filters", matchSkills(list, "skill:omarchy-", "/skill:").map(s => s.name), ["omarchy-app"]);

for (const [id, want] of [["claude-code", "/omarchy "], ["codex", "$omarchy "], ["pi", "/skill:omarchy "], ["opencode", "@omarchy "]]) {
  const { triggers, invoke } = HARNESSES[id].skills;
  check(`${id} inserts its own form`, withSkill(`${invoke[0]}om`, skillToken(`${invoke[0]}om`, triggers), invoke, "omarchy"), want);
}
check("Codex's / still inserts $, which is what runs a skill", withSkill("/om", skillToken("/om", HARNESSES.codex.skills.triggers), "$", "omarchy"), "$omarchy ");
check("OpenCode's / still inserts @", withSkill("/om", skillToken("/om", HARNESSES.opencode.skills.triggers), "@", "omarchy"), "@omarchy ");
check("words before it stay", withSkill("first $im", { start: 6 }, "$", "imagegen"), "first $imagegen ");

const enc = encodeURIComponent;
check("the reader's lines become skills, odd characters intact",
  parseSkills(`NOTE|x\nS|${enc("a:b")}|${enc("does 50% | more")}|project\nS|c||\n`), [{ name: "a:b", description: "does 50% | more", source: "project" }, { name: "c", description: "", source: "" }]);
check("a command's choices come with it",
  parseSkills(`S|switch|${enc("Switch model")}|builtin|${enc(JSON.stringify([{ name: "a/b", window: 5 }]))}\n`), [{ name: "switch", description: "Switch model", source: "builtin", choices: [{ name: "a/b", window: 5 }] }]);

check("a space after a whole command starts its choice", choiceToken("/effort ", "/"), { command: "effort", start: 8, query: "" });
check("a second word ends it: the rest is the message", choiceToken("/effort high please", "/"), null);
check("a bare slash names no command", choiceToken("/ x", "/"), null);
check("text that doesn't start with the command form has none", choiceToken("effort hi", "/"), null);
check("Pi's /skill: form names what follows it", choiceToken("/skill:x a", "/skill:"), { command: "x", start: 9, query: "a" });
check("a description matches after names do", matchChoices([{ name: "anthropic/claude-opus-5-5", description: "Claude Opus 5.5 · 1M context" }, { name: "openai-codex/gpt-5.5", description: "GPT-5.5 · 272k context" }], "1m").map(c => c.name), ["anthropic/claude-opus-5-5"]);

process.exit(failed ? 1 : 0);
