import { stage } from "./stage.mjs";

const { SkillMenu } = await stage().load("components/skill-menu.js");
const { HARNESSES } = await stage().load("harnesses/index.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

let text = "";
const sent = [];
const host = {
  input: { value: () => text, set_value: v => { text = v; }, set_selected_range: () => {}, focus: () => {} },
  keepDraft: () => {},
  sendCommand: c => sent.push(c),
};
const cx = { notify: () => {}, spawn: () => {} };
const t = { address: "t1", created: 1, harness: HARNESSES.omp };
const menu = new SkillMenu(host);
const levels = ["off", "low", "medium", "high", "xhigh"].map(name => ({ name, description: "" }));
const models = [{ name: "anthropic/claude-opus-5-5", description: "Claude Opus 5.5" }, { name: "openai-codex/gpt-5.5", description: "GPT-5.5" }];
menu.lists.set("t1:1", { items: [
  { name: "compact", description: "Compact the context", source: "builtin" },
  { name: "effort", description: "Set the thinking level", source: "builtin", choices: levels },
  { name: "switch", description: "Switch model", source: "builtin", choices: models },
], at: Date.now(), path: "" });
const names = () => menu.view(t)?.items.map(i => i.name) ?? null;

text = "/eff";
check("a slash lists the commands", names(), ["effort"]);
check("in OMP's own form", (menu.accept(t, cx), text), "/effort ");
check("a space after a command lists its choices, in its order", names(), ["off", "low", "medium", "high", "xhigh"]);
text = "/effort hi";
check("typing filters them", names(), ["high", "xhigh"]);
check("Enter completes the choice, sending nothing yet", [menu.accept(t, cx), text, sent], [true, "/effort high ", []]);
check("then the menu is out of the way, so the next Enter sends", menu.view(t), null);
text = "/effort high";
check("so it is when the whole choice is typed", menu.view(t), null);
text = "/compact ";
check("a command without choices opens nothing", menu.view(t), null);

text = "a draft in progress";
menu.pick(t, "switch", "openai-codex/gpt-5.5", cx);
check("a status-line click lists the command's choices whatever the draft says", names(), ["anthropic/claude-opus-5-5", "openai-codex/gpt-5.5"]);
check("starting on the current one", menu.view(t).items[menu.index].name, "openai-codex/gpt-5.5");
menu.move(t, -1, cx);
check("picking runs the command at once and leaves the draft", [menu.accept(t, cx), sent, text], [true, ["/switch anthropic/claude-opus-5-5"], "a draft in progress"]);
check("and closes the menu", menu.view(t), null);
menu.pick(t, "effort", "high", cx);
text = "a draft in progress, now longer";
check("typing closes a pick, so Enter sends the message instead", menu.view(t), null);
const draft = text;
menu.pick(t, "effort", "high", cx);
text = `${draft}x`;
menu.edited(cx);
text = draft;
check("typing and undoing it doesn't bring the pick back", menu.view(t), null);
menu.pick(t, "effort", "high", cx);
text = `${draft}x`;
menu.view(t);
text = draft;
check("nor when only a redraw saw the change", menu.view(t), null);
menu.pick(t, "effort", "high", cx);
check("a click after that opens it again", menu.view(t)?.kind, "pick");
menu.pick(t, "effort", "high", cx);
check("and a second click closes it", menu.view(t), null);
menu.pick(t, "effort", "high", cx);
check("so does Esc", [menu.dismiss(t, cx), menu.view(t)], [true, null]);
menu.pick(t, "effort", "high", cx);
check("a question from the agent closes it, so a pick can't answer the question", menu.view({ ...t, status: "blocked" }), null);
check("for good", menu.view(t), null);
check("only commands with choices open", (menu.pick(t, "compact", "", cx), menu.view(t)), null);

process.exit(failed ? 1 : 0);
