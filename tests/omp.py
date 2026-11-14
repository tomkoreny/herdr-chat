import json, os, subprocess, sys, tempfile, urllib.parse
from reader_bundle import bundle

reader = bundle()
failed = 0

def check(name, got, want):
    global failed
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": got %r" % (got,)))
    if not ok: failed += 1

def tagged(out):
    return [(l.split("|")[0], [urllib.parse.unquote(x) for x in l.split("|")[1:]]) for l in out.splitlines() if l]

def status(out):
    """The STATUS the reader reported, or None."""
    return next((json.loads(f[0]) for tag, f in out if tag == "STATUS"), None)

home = tempfile.mkdtemp()
work = os.path.join(home, "work")
os.makedirs(work)
folder = os.path.join(home, ".omp", "agent", "sessions", "-work")
os.makedirs(folder)
log = os.path.join(folder, "2026-11-11T10-00-00-000Z_s1.jsonl")

def write(entries, mode="w"):
    """Entries into the session log, compact as OMP writes them."""
    with open(log, mode) as f:
        for e in entries: f.write(json.dumps(e, separators=(",", ":"), ensure_ascii=False) + "\n")

def read(offset=0, leaf="", pid=0):
    """The reader's tagged output for an OMP terminal in `work`, from `offset` on; `pid`, the terminal's process."""
    args = [sys.executable, "-I", str(reader), "--app", "omp", "--label", "omp", "--cwd", work, "--known", log, "--offset", str(offset)]
    if leaf: args += ["--leaf", leaf]
    if pid: args += ["--pid", str(pid)]
    return tagged(subprocess.run(args, capture_output=True, text=True, env={**os.environ, "HOME": home}).stdout)

said = lambda text: [{"type": "text", "text": text}]
write([
    {"type": "session", "version": 3, "id": "s1", "cwd": work},
    {"type": "model_change", "id": "a1", "parentId": None, "model": "anthropic/claude-opus-5-5"},
    {"type": "thinking_level_change", "id": "a2", "parentId": "a1", "thinkingLevel": "high", "configured": "auto"},
    {"type": "model_change", "id": "a3", "parentId": "a2", "model": "openai-codex/gpt-5.5", "role": "advisor"},
    {"type": "message", "id": "a4", "parentId": "a3", "message": {"role": "user", "content": said("hi")}},
    {"type": "message", "id": "a5", "parentId": "a4", "message": {"role": "assistant", "provider": "anthropic", "model": "claude-opus-5-5", "content": said("hello"),
     "usage": {"input": 10, "output": 50, "cacheRead": 900, "cacheWrite": 90, "totalTokens": 1050, "orchestration": {"input": 20, "output": 5, "cacheRead": 25}, "cost": {"total": 0.25}}}},
    {"type": "message", "id": "a6", "parentId": "a5", "message": {"role": "assistant", "provider": "anthropic", "model": "claude-opus-5-5", "content": said("hel"), "stopReason": "aborted",
     "usage": {"input": 4000, "output": 3, "totalTokens": 4003, "cost": {"total": 0.125}}}},
    {"type": "model_usage", "id": "u1", "parentId": "a6", "activeLeafId": "a6", "usage": {"cost": {"total": 9}}},
])
first = read()
check("a fresh read reports the default role's model (not the advisor's), the level chosen and the one in force, the context as OMP counts it "
      "(less the provider's orchestration, not from an aborted reply), and what the replies cost (not side work like titles)",
      status(first), {"model": "anthropic/claude-opus-5-5", "level": "high", "effort": "auto", "inferredModel": "anthropic/claude-opus-5-5", "context": 1000, "cost": 0.375})
check("and starts the chat over", ("RESET", []) in first, True)
offset = next(int(f[0]) for tag, f in first if tag == "OFFSET")
leaf = next(f[0] for tag, f in first if tag == "LEAF")

write([
    {"type": "model_change", "id": "b1", "parentId": "a6", "model": "openai-codex/gpt-5.5"},
    {"type": "message", "id": "b2", "parentId": "b1", "message": {"role": "user", "content": said("again")}},
    {"type": "message", "id": "b3", "parentId": "b2", "message": {"role": "assistant", "provider": "openai-codex", "model": "gpt-5.5", "content": said("ok"),
     "usage": {"contextTokens": 2100, "input": 3000, "output": 100, "cost": {"total": 0.5}}}},
], "a")
more = read(offset, leaf)
check("a later read reports only what it saw: the switch, the context the provider counted, and its own cost",
      status(more), {"model": "openai-codex/gpt-5.5", "inferredModel": "openai-codex/gpt-5.5", "context": 2100, "cost": 0.5})
check("without starting over", ("RESET", []) in more, False)
offset = next(int(f[0]) for tag, f in more if tag == "OFFSET")
check("a read with nothing new reports no status", status(read(offset, "b3")), None)

write([{"type": "compaction", "id": "c1", "parentId": "b3", "firstKeptEntryId": "b2", "tokensBefore": 2100, "tokensAfter": 400}], "a")
compacted = read(offset, "b3")
check("a compaction resets the context to what it kept", status(compacted), {"context": 400})
offset = next(int(f[0]) for tag, f in compacted if tag == "OFFSET")
write([{"type": "compaction", "id": "c2", "parentId": "c1", "firstKeptEntryId": "b2", "tokensBefore": 400}], "a")
check("or to unknown when it doesn't say", status(read(offset, "c1")), {"context": None})

def todo_result(id, parent, op, phases, error=False):
    return {"type": "message", "id": id, "parentId": parent, "message": {"role": "toolResult", "toolCallId": "t" + id, "toolName": "todo",
            "isError": error, "content": said("ok"), "details": {"op": op, "phases": phases}}}
phase = lambda name, *tasks: {"name": name, "tasks": [{"content": c, "status": s} for c, s in tasks]}
write([
    {"type": "message", "id": "d1", "parentId": "c2", "message": {"role": "assistant", "content": [
        {"type": "toolCall", "id": "td1", "name": "todo", "arguments": {"i": "Tracking", "op": "done", "task": "Map the code"}},
        {"type": "toolCall", "id": "tk1", "name": "task", "arguments": {"i": "Spawning", "context": "x", "tasks": [{"name": "Audit", "task": "a"}, {"name": "Review", "agent": "reviewer", "task": "b"}]}}]}},
    todo_result("d2", "d1", "init", [phase("Find", ("Map the code", "completed"), ("Read the tests", "blocked")), phase("Ship", ("Push", "pending"))]),
], "a")
fresh = read()
check("a todo call names its operation and task, and a task call its agents, counting them", [json.loads(f[1]) for tag, f in fresh if tag == "C"][-2:],
      [{"k": "todo", "d": "done: Map the code"}, {"k": "agent", "d": "Audit, Review", "n": 2}])
check("the to-do list is the latest todo result's, a blocked task counted as pending", status(fresh)["todo"], {"id": "d2", "phases": [
    {"name": "Find", "tasks": [{"content": "Map the code", "status": "completed"}, {"content": "Read the tests", "status": "pending"}]},
    {"name": "Ship", "tasks": [{"content": "Push", "status": "pending"}]}]})
write([
    todo_result("d3", "d2", "view", [phase("Viewed", ("x", "pending"))]),
    todo_result("d4", "d3", "done", [phase("Failed", ("x", "pending"))], error=True),
    {"type": "custom", "customType": "todo_hud_state", "id": "d5", "parentId": "d4", "data": {"sourceEntryId": "d2", "fingerprint": "f", "visibility": "dismissed"}},
], "a")
hidden = status(read())
check("a view or a failed call leaves the list as it was, and OMP's TUI hiding it is reported with the entry it hid",
      (hidden["todo"]["id"], hidden["todoHud"]), ("d2", {"id": "d2", "visibility": "dismissed"}))
write([{"type": "custom", "customType": "user_todo_edit", "id": "d6", "parentId": "d5", "data": {"phases": [phase("Mine", ("Edit by hand", "in_progress"))]}}], "a")
check("the person's own edit replaces the list", status(read())["todo"], {"id": "d6", "phases": [{"name": "Mine", "tasks": [{"content": "Edit by hand", "status": "in_progress"}]}]})

import time
from datetime import datetime, timezone
folder = log[:-len(".jsonl")]
os.makedirs(folder)
iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def agent_log(name, started, tail, agent="task"):
    """A subagent's log beside the session's, as OMP starts it (title, session, session_init), then `tail`."""
    with open(os.path.join(folder, name + ".jsonl"), "w") as f:
        for e in [{"type": "title", "v": 1, "title": "", "pad": "    "}, {"type": "session", "version": 3, "id": "s" + name, "timestamp": started, "cwd": work},
                  {"type": "session_init", "id": "i1", "parentId": None, "task": "do it", "systemPrompt": ["long"], "agent": agent}] + tail:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")
call = {"type": "message", "id": "a1", "parentId": "i1", "message": {"role": "assistant", "stopReason": "toolUse", "content": [
    {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"i": "Reading the plan", "path": "x"}, "intent": "Reading the plan"}]}}
result = {"type": "message", "id": "a2", "parentId": "a1", "message": {"role": "toolResult", "toolCallId": "c1", "toolName": "read", "content": said("plan")}}
began = {"type": "custom", "customType": "tool_execution_start", "id": "s1", "parentId": "a2", "data": {"toolCallId": "c2", "toolName": "bash", "intent": "Running the tests"}}
answered = {"type": "message", "id": "a3", "parentId": "a2", "message": {"role": "assistant", "stopReason": "stop", "content": said("Done: the plan holds.")}}
usage = {"type": "model_usage", "id": "u1", "parentId": "a3", "activeLeafId": "a3", "usage": {}}
asked = {"type": "message", "id": "a4", "parentId": "a3", "message": {"role": "user", "content": said("One more thing")}}
closed = {"type": "custom", "customType": "session_exit", "id": "e1", "parentId": "a1", "data": {"reason": "dispose"}}
earlier = iso(time.time() - 60)
agent_log("Audit", earlier, [call, result, began])
agent_log("Review", earlier, [call, result], agent="reviewer")
agent_log("Finished", earlier, [call, result, answered, usage])
agent_log("Revived", earlier, [call, result, answered, asked])
agent_log("Closed", earlier, [call, closed])
agent_log("__advisor", earlier, [call])
at = int(datetime.fromisoformat(earlier.replace("Z", "+00:00")).timestamp() * 1000)
check("subagents are at work, with their kind and the tool they ran last (its intent), until a reply ends their turn (one given more to do "
      "is again); a closed log and OMP's side logs are not listed",
      [(a["id"], a["agent"], a["intent"], a["tool"], a["started"]) for a in status(read())["agents"]],
      [("Audit", "task", "Running the tests", "bash", at), ("Review", "reviewer", "Reading the plan", "read", at), ("Revived", "task", "Reading the plan", "read", at)])
standin = os.path.join(home, "standin", "omp")
os.makedirs(os.path.dirname(standin))
with open(standin, "w") as f: f.write("#!%s\nimport time\ntime.sleep(60)\n" % sys.executable)
os.chmod(standin, 0o755)
running = subprocess.Popen([standin], cwd=work, stdin=subprocess.DEVNULL)
try:
    time.sleep(0.3)
    agent_log("Fresh", iso(time.time() + 1), [call])
    check("once OMP was started again, the subagents an earlier one left open are not at work", [a["id"] for a in status(read(pid=running.pid))["agents"]], ["Fresh"])
finally: running.kill()

bin_dir = os.path.join(home, "bin")
os.makedirs(bin_dir)
fake = os.path.join(bin_dir, "omp")
with open(fake, "w") as f:
    f.write("#!%s\n" % sys.executable + r'''import json, os, sys
if sys.argv[1:] != ["--mode", "rpc", "--no-session"] or os.environ.get("OMP_BROKEN"): sys.exit(1)
answers = {
    "get_available_commands": {"commands": [
        {"name": "switch", "description": "Switch model for this session only", "source": "builtin"},
        {"name": "effort", "description": "Set or show reasoning effort", "source": "builtin",
         "subcommands": [{"name": "low", "description": "Light"}, {"name": "high", "description": "Deep"}]},
        {"name": "skill:tidy", "description": "Tidy up", "source": "skill"}]},
    "get_available_models": {"models": [
        {"provider": "anthropic", "id": "claude-opus-5-5", "name": "Claude Opus 5.5", "contextWindow": 1000000},
        {"provider": "openai-codex", "id": "gpt-5.5", "name": "GPT-5.5", "contextWindow": 272000}]},
}
for line in sys.stdin:
    r = json.loads(line)
    print(json.dumps({"type": "response", "id": r["id"], "command": r["type"], "success": True, "data": answers[r["type"]]}))
''')
os.chmod(fake, 0o755)
skills = os.path.join(home, ".omp", "agent", "skills", "tidy")
os.makedirs(skills)
with open(os.path.join(skills, "SKILL.md"), "w") as f: f.write("---\nname: tidy\ndescription: Tidy up\n---\n")
spec = json.dumps({"commands": True, "user": ["~/.omp/agent/skills"], "project": [".omp/skills"], "skip": []})

def commands(path, **env):
    """The commands the reader lists for an OMP terminal in `work` (name -> (description, source, choices)), and its note, if any."""
    out = tagged(subprocess.run([sys.executable, "-I", str(reader), "--app", "omp", "--cwd", work, "--skills", spec],
                                capture_output=True, text=True, env={**os.environ, "HOME": home, "PATH": path, **env}).stdout)
    return {f[0]: (f[1], f[2], json.loads(f[3]) if len(f) > 3 else []) for tag, f in out if tag == "S"}, next((f[0] for tag, f in out if tag == "NOTE"), None)

py = os.path.dirname(sys.executable)
listed, note = commands(bin_dir + os.pathsep + py)
check("OMP's own list is offered, in its order, with no note", (list(listed), note), (["switch", "effort", "skill:tidy"], None))
check("/switch offers the models, each with its window", listed["switch"][2], [
    {"name": "anthropic/claude-opus-5-5", "title": "Claude Opus 5.5", "window": 1000000, "description": "Claude Opus 5.5 · 1M context"},
    {"name": "openai-codex/gpt-5.5", "title": "GPT-5.5", "window": 272000, "description": "GPT-5.5 · 272k context"}])
check("a command's subcommands are its choices", listed["effort"][2], [{"name": "low", "description": "Light"}, {"name": "high", "description": "Deep"}])
fallback = ({"skill:tidy": ("Tidy up", "personal", [])}, "OMP didn't list its commands here, so only its skills are offered")
check("without OMP to ask, the skills in its folders, as /skill: commands, saying so", commands(py), fallback)
check("and when OMP fails", commands(bin_dir + os.pathsep + py, OMP_BROKEN="1"), fallback)

sys.exit(1 if failed else 0)
