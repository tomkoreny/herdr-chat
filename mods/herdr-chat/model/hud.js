// The to-do list and the subagents at work, shown above the reply box the way OMP's TUI shows them above its prompt,
// from what the reader put in a session's status (`todo`, `todoHud`, `agents`).

const CLOSED = new Set(["completed", "abandoned"]);
export const TASK_CAP = 5, LATER_PHASES = 4, AGENT_CAP = 5;

const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function roman(n) {
  // A phase's number as OMP writes it: I, II, … IV.
  let out = "";
  for (const [value, sym] of ROMAN) while (n >= value) { out += sym; n -= value; }
  return out;
}

const closed = t => CLOSED.has(t.status);

function withinCap(tasks) {
  // At most TASK_CAP of `tasks`: the one in progress first, then those after it (selectWithinCap).
  if (tasks.length <= TASK_CAP + 1) return { items: tasks, more: 0 };
  const active = tasks.filter(t => t.status === "in_progress");
  if (active.length > TASK_CAP) return { items: active.slice(0, TASK_CAP), more: tasks.length - TASK_CAP };
  const fill = [];
  for (let i = active.length ? tasks.indexOf(active[0]) : 0; i < tasks.length && active.length + fill.length < TASK_CAP; i++)
    if (tasks[i].status !== "in_progress") fill.push(tasks[i]);
  const items = [...active, ...fill];
  return { items, more: tasks.length - items.length };
}

function shownTasks(tasks) {
  // The active phase's tasks as OMP lists them folded (selectCollapsedTodos): the last one closed, then the open ones.
  const open = tasks.filter(t => !closed(t));
  if (!open.length) return withinCap(tasks);
  const picked = withinCap(open);
  return { items: [...tasks.filter(closed).slice(-1), ...picked.items], more: picked.more };
}

export function todoView(status) {
  // The to-do list to show, or null when there is none or OMP's TUI hid it (by hand, or a while after the last task closed):
  // how many tasks are closed of all, the task at hand, and the phases from the active one on (the one with open tasks,
  // else the last), the active one with its tasks.
  const todo = status?.todo;
  if (!todo || (status.todoHud?.id === todo.id && status.todoHud.visibility === "dismissed")) return null;
  const phases = (todo.phases ?? []).filter(p => p.tasks?.length);
  if (!phases.length) return null;
  let active = phases.findIndex(p => p.tasks.some(t => !closed(t)));
  if (active < 0) active = phases.length - 1;
  const tasks = phases.flatMap(p => p.tasks);
  const current = tasks.find(t => t.status === "in_progress") ?? tasks.find(t => t.status === "pending");
  const shown = phases.slice(active, active + 1 + LATER_PHASES);
  return {
    done: tasks.filter(closed).length,
    total: tasks.length,
    current: current?.content ?? "",
    phases: shown.map((p, i) => ({
      name: phases.length > 1 ? `${roman(active + i + 1)}. ${p.name}` : p.name,
      done: p.tasks.filter(closed).length,
      total: p.tasks.length,
      active: i === 0,
      ...(i === 0 ? shownTasks(p.tasks) : { items: [], more: 0 }),
    })),
    morePhases: phases.length - active - shown.length,
  };
}

export function elapsed(ms) {
  // A running time in a few characters: 40s, 14m, 1h 05m.
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function agentsView(status, now) {
  // The subagents at work, oldest first: each one's id, its kind unless it is the plain "task" agent, what it does now
  // and for how long it has run; at most AGENT_CAP of them, with how many more there are.
  const all = status?.agents ?? [];
  return {
    count: all.length,
    shown: all.slice(0, AGENT_CAP).map(a => ({
      id: a.id,
      kind: a.agent && a.agent !== "task" ? a.agent : "",
      doing: a.intent || a.tool || "",
      time: a.started ? elapsed(now - a.started) : "",
    })),
    more: Math.max(0, all.length - AGENT_CAP),
  };
}
