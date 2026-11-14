import { stage } from "./stage.mjs";

const { todoView, agentsView, elapsed } = await stage().load("model/hud.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const task = (content, status = "pending") => ({ content, status });
const todo = (phases, extra = {}) => ({ todo: { id: "e9", phases }, ...extra });
const plan = todo([
  { name: "Discovery", tasks: [task("map", "completed"), task("audit", "in_progress"), task("review")] },
  { name: "Empty", tasks: [] },
  { name: "Build", tasks: [task("package"), task("enable", "completed")] },
  { name: "Ship", tasks: [task("push")] },
]);
const view = todoView(plan);
check("counts every closed task of all, and names the one in progress", [view.done, view.total, view.current], [2, 6, "audit"]);
check("phases are numbered as OMP numbers them, empty ones left out, the active one first with its tasks",
  view.phases.map(p => [p.name, p.done, p.total, p.active, p.items.map(t => t.content)]),
  [["I. Discovery", 1, 3, true, ["map", "audit", "review"]], ["II. Build", 1, 2, false, []], ["III. Ship", 0, 1, false, []]]);

const later = todoView(todo([
  { name: "Done", tasks: [task("a", "completed"), task("b", "abandoned")] },
  { name: "Now", tasks: [task("c", "completed"), task("d", "completed"), task("e")] },
]));
check("a finished phase before the active one is left out, and the active one shows its last closed task and the open ones",
  later.phases.map(p => [p.name, p.items.map(t => t.content)]), [["II. Now", ["d", "e"]]]);
check("without a task in progress, the next pending one is at hand", later.current, "e");

const long = todoView(todo([{ name: "Only", tasks: [task("t0", "completed"), ...Array.from({ length: 9 }, (_, i) => task(`t${i + 1}`, i === 3 ? "in_progress" : "pending"))] }]));
check("a long phase shows the task in progress and those after it, up to five, and counts the rest",
  [long.phases[0].name, long.phases[0].items.map(t => t.content), long.phases[0].more], ["Only", ["t0", "t4", "t5", "t6", "t7", "t8"], 4]);

const many = todoView(todo(Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, tasks: [task("x")] }))));
check("at most four phases follow the active one, and the rest are counted", [many.phases.length, many.morePhases], [5, 3]);

const done = todoView(todo([{ name: "A", tasks: [task("a", "completed")] }, { name: "B", tasks: [task("b", "abandoned")] }]));
check("with every task closed, the last phase is the active one and nothing is at hand", [done.phases.map(p => p.name), done.done, done.current], [["II. B"], 2, ""]);

check("a list OMP's TUI dismissed is hidden", todoView({ ...plan, todoHud: { id: "e9", visibility: "dismissed" } }), null);
check("a dismissal of an earlier list doesn't hide a newer one", todoView({ ...plan, todoHud: { id: "e3", visibility: "dismissed" } })?.total, 6);
check("a list shown again after a dismissal shows", todoView({ ...plan, todoHud: { id: "e9", visibility: "revealed" } })?.total, 6);
check("no list, or one without tasks, shows nothing", [todoView(null), todoView({}), todoView(todo([{ name: "A", tasks: [] }]))], [null, null, null]);

const now = Date.parse("2026-11-14T10:00:00Z");
const agents = agentsView({ agents: [
  { id: "Audit", agent: "task", started: now - 14 * 60000, intent: "Checking PATHs", tool: "bash" },
  { id: "Review", agent: "reviewer", started: now - 40000, intent: "", tool: "read" },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `W${i}`, agent: "task", started: 0, intent: "", tool: "" })),
] }, now);
check("each subagent shows its kind unless it's a plain task, what it does now (its intent, else its tool) and how long it has run",
  agents.shown.slice(0, 2), [{ id: "Audit", kind: "", doing: "Checking PATHs", time: "14m" }, { id: "Review", kind: "reviewer", doing: "read", time: "40s" }]);
check("at most five are listed, the rest counted", [agents.count, agents.shown.length, agents.more], [7, 5, 2]);
check("no subagents, none listed", agentsView(null, now), { count: 0, shown: [], more: 0 });
check("running times stay short", [5000, 59000, 60000, 3599000, 3600000, 3900000].map(elapsed), ["5s", "59s", "1m", "59m", "1h 00m", "1h 05m"]);

process.exit(failed ? 1 : 0);
