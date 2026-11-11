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

def read(offset=0, leaf=""):
    """The reader's tagged output for an OMP terminal in `work`, from `offset` on."""
    args = [sys.executable, "-I", str(reader), "--app", "omp", "--label", "omp", "--cwd", work, "--known", log, "--offset", str(offset)]
    if leaf: args += ["--leaf", leaf]
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
