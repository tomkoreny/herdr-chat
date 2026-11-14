# OMP for herdr-chat's session reader. Joined after pi.py (see
# readers/manifest.json), whose words_of and shown_on it reuses.

def omp_call(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    intent = short(inp.get("i"), 80)
    if name == "bash": return {"k": "shell", "d": short(inp.get("command"), 400)}
    if name == "read":
        p = str(inp.get("path", ""))
        return {"k": "image" if re.search(r"\.(png|jpe?g|gif|webp)$", p, re.I) else "read", "d": leaf(p.split(":")[0]) or intent}
    if name in ("edit", "write"): return {"k": "edit", "d": leaf(inp.get("path")) or intent or name, "n": 1}
    if name in ("grep", "glob"): return {"k": "search", "d": short(inp.get("pattern") or inp.get("path"), 200) or intent}
    if name == "todo":
        ops = inp.get("ops") if isinstance(inp.get("ops"), list) else [inp]
        said = [": ".join(s for s in (str(o.get("op") or ""), short(o.get("task") or o.get("phase"), 120)) if s) for o in ops if isinstance(o, dict)]
        return {"k": "todo", "d": "; ".join(s for s in said if s) or intent}
    if name == "task":
        tasks = [t for t in (inp.get("tasks") if isinstance(inp.get("tasks"), list) else [inp]) if isinstance(t, dict)]
        names = [str(t.get("name") or t.get("id") or t.get("agent") or "") for t in tasks]
        return {"k": "agent", "d": short(", ".join(n for n in names if n), 200) or intent, "n": max(1, len(tasks))}
    return {"k": "other", "d": (name + ": " + intent) if intent else name}

def omp_tty(pid):
    """The terminal a process reads from, named as OMP names its crumb: pts-3 on Linux, ttys012 on macOS."""
    if os.path.isdir("/proc"):
        try: tty = os.readlink("/proc/%d/fd/0" % pid)
        except OSError: return None
        return "pts-" + tty[len("/dev/pts/"):] if tty.startswith("/dev/pts/") else None
    try:
        import subprocess
        tty = subprocess.run(["ps", "-o", "tty=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    except Exception: return None
    return tty if tty.startswith("ttys") else None

def omp_crumb():
    """The session OMP itself recorded for this terminal: (path, known).

    OMP writes ~/.omp/agent/terminal-sessions/<pty> whenever a session starts or
    changes: the folder on the first line, the session file on the second. A
    file older than the terminal belongs to an earlier owner of that pty.
    `known` without a path is a session OMP has opened but not written yet."""
    for pid in terminal_pids():
        name = omp_tty(pid)
        if not name: continue
        crumb = os.path.join(HOME, ".omp", "agent", "terminal-sessions", name)
        try:
            if os.path.getmtime(crumb) < A.created / 1000 - 10: return None, False
            with open(crumb, encoding="utf-8", errors="replace") as f: lines = f.read().split("\n")
        except OSError: return None, False
        path = lines[1] if len(lines) > 1 else ""
        if not path: return None, False
        return (path if os.path.isfile(path) else None), True
    return None, False

def omp_folders(cwd):
    """Where OMP keeps a folder's sessions: named after the folder, relative to home when inside it."""
    names = []
    if cwd == HOME or cwd.startswith(HOME + os.sep):
        names.append("-" + re.sub(r"[\\/:]", "-", cwd[len(HOME):].lstrip("\\/")))
    names.append("-" + re.sub(r"[\\/:]", "-", cwd.lstrip("\\/")))
    return [os.path.join(HOME, ".omp", "agent", "sessions", n) for n in names]

def find_omp():
    path, known = omp_crumb()
    if known: return path
    # No crumb to go by (Windows, an OMP that keeps no session): the newest log of the terminal's folders.
    since = A.created / 1000 - 10
    files = set()
    for cwd in candidate_cwds():
        for folder in omp_folders(cwd):
            files.update((os.path.getmtime(fp), fp) for fp in glob.glob(os.path.join(folder, "*.jsonl")))
    files = [f for f in files if f[0] >= since]
    if not files: return None
    newest = max(files)
    if A.known and newest[1] == A.known: return A.known
    if A.screen:
        screen = words_of(A.screen)
        hits = [f for f in files if shown_on(f[1], screen)]
        return max(hits)[1] if hits else None
    if len(files) > 1 or A.peers:
        state["need"] = "screen"
        return None
    return newest[1]

def omp_entry(o):
    m = o.get("message") or {}
    role = m.get("role")
    content = m.get("content") or []
    if role == "user":
        said = re.sub(r'(?s)<skill name="([^"]+)"[^>]*>.*?</skill>\s*', r"/skill:\1 ", content_text(content))
        add_message("user", "", *placed_images(said))
    elif role == "assistant":
        for c in content if isinstance(content, list) else []:
            if not isinstance(c, dict): continue
            if c.get("type") == "text": add_message("assistant", "final", c.get("text"))
            elif c.get("type") == "thinking": add_reasoning(c.get("thinking"))
            elif c.get("type") == "toolCall": add_call(omp_call(str(c.get("name", "")), c.get("arguments")), str(c.get("id", "")))
    elif role == "toolResult":
        set_output(str(m.get("toolCallId", "")), "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict) and c.get("type") == "text"))

def parse_omp(path):
    """An OMP log is a tree: each entry names its parent, and the conversation is
    the branch that ends at the newest entry. Entries carrying `activeLeafId`
    are side records (model usage) that name that end without moving it.
    Entries read since the last pass must continue the branch; when one starts
    another (/tree, a rewind), the whole log is read again."""
    nodes = []
    for line in read_tail(path):
        if '"id":"' not in line: continue
        o = loads(line)
        if isinstance(o, dict) and o.get("id") and o.get("type") != "session": nodes.append(o)
    if state["fresh"]:
        by = {o["id"]: o for o in nodes}
        tip = (nodes[-1].get("activeLeafId") or nodes[-1]["id"]) if nodes else ""
        live, x = set(), by.get(tip)
        while x and x["id"] not in live:
            live.add(x["id"])
            x = by.get(x.get("parentId"))
        branch = [o for o in nodes if o["id"] in live]
    else:
        tip, branch = A.leaf, []
        for o in nodes:
            end = o.get("activeLeafId")
            if not tip or (end or o.get("parentId")) != tip:
                A.offset = 0
                return parse_omp(path)
            if not end:
                tip = o["id"]
                branch.append(o)
    state["chain"] = tip
    for o in branch:
        omp_status(o)
        if o.get("type") == "message": omp_entry(o)
    agents = omp_agents(path)
    if agents is not None: state["status"] = dict(state["status"] or {}, agents=agents)

def omp_context(usage):
    """The tokens a reply's context held, counted as OMP counts them (calculateContextTokens): the
    provider's own context count where it gives one, else every token less the provider's orchestration."""
    if usage.get("contextTokens") is not None: return max(0, int(usage["contextTokens"]))
    side = usage.get("orchestration") or {}
    every = int(usage.get("totalTokens") or 0) or sum(int(usage.get(k) or 0) for k in ("input", "output", "cacheRead", "cacheWrite"))
    return max(0, every - sum(int(side.get(k) or 0) for k in ("input", "output", "cacheRead")))

def omp_status(o):
    """What an entry tells about the session, into state["status"], as OMP rebuilds it: the model of the
    default role (`model`; until one is logged, the latest reply's as `inferredModel`), the thinking level
    chosen (`effort`, such as auto) and the one in force (`level`), the tokens the context held after the
    latest reply or compaction (`context`, None when unknown), what the replies read here cost (`cost`,
    which the chat adds to what earlier reads found), the to-do list (`todo`: the entry that set it, and
    its phases) and whether OMP's TUI hid it (`todoHud`: the entry it judged, and `dismissed` or `revealed`)."""
    m, kind, seen = o.get("message") or {}, o.get("type"), {}
    if kind == "model_change" and o.get("model") and (o.get("role") or "default") == "default": seen["model"] = str(o["model"])
    elif kind == "thinking_level_change":
        seen["level"] = str(o.get("thinkingLevel") or "off")
        seen["effort"] = str(o.get("configured") or seen["level"])
    elif kind == "compaction": seen["context"] = int(o["tokensAfter"]) if o.get("tokensAfter") else None
    elif kind == "message" and m.get("role") == "assistant":
        usage = m.get("usage") or {}
        if m.get("provider") and m.get("model"): seen["inferredModel"] = "%s/%s" % (m["provider"], m["model"])
        used = omp_context(usage) if m.get("stopReason") not in ("aborted", "error") else 0
        if used: seen["context"] = used
        cost = float((usage.get("cost") or {}).get("total") or 0)
        if cost: seen["cost"] = (state["status"] or {}).get("cost", 0) + cost
    elif kind == "custom" and o.get("customType") == "todo_hud_state":
        d = o.get("data") or {}
        seen["todoHud"] = {"id": str(d.get("sourceEntryId") or ""), "visibility": str(d.get("visibility") or "")}
    phases = omp_todo(o)
    if phases is not None: seen["todo"] = {"id": str(o["id"]), "phases": phases}
    if seen: state["status"] = dict(state["status"] or {}, **seen)

def omp_todo(o):
    """The to-do list an entry sets, as OMP rebuilds it (canonicalTodoPhases): a todo call's result (not a
    view) or the person's own edit, each phase with its tasks' content and status ("blocked" counts as
    pending); None when the entry sets none."""
    m = o.get("message") or {}
    if o.get("type") == "custom" and o.get("customType") == "user_todo_edit": phases = (o.get("data") or {}).get("phases")
    elif (o.get("type") == "message" and m.get("role") == "toolResult" and m.get("toolName") == "todo" and not m.get("isError")
          and (m.get("details") or {}).get("op") != "view"): phases = (m.get("details") or {}).get("phases")
    else: return None
    if not isinstance(phases, list): return None
    return [{"name": str(p.get("name") or ""),
             "tasks": [{"content": str(t.get("content") or ""), "status": "pending" if t.get("status") == "blocked" else str(t.get("status") or "pending")}
                       for t in p.get("tasks") or [] if isinstance(t, dict)]}
            for p in phases if isinstance(p, dict)]

def omp_started():
    """When the OMP in this terminal started, in seconds since the epoch, from /proc or ps (its workers left
    out); None when it can't be told."""
    import time
    def ours(argv): return any(os.path.basename(a) in ("omp", ".omp-wrapped") for a in argv[:2]) and not any(a.startswith("__omp_") for a in argv[1:2])
    if os.path.isdir("/proc"):
        try:
            with open("/proc/stat") as f: boot = next(int(l.split()[1]) for l in f if l.startswith("btime "))
        except (OSError, StopIteration, ValueError, IndexError): return None
        for pid in terminal_pids():
            try:
                with open("/proc/%d/cmdline" % pid, "rb") as f: argv = f.read().decode("utf-8", "replace").split("\0")
                if not ours(argv): continue
                with open("/proc/%d/stat" % pid) as f: ticks = int(f.read().rsplit(")", 1)[1].split()[19])
                return boot + ticks / os.sysconf("SC_CLK_TCK")
            except (OSError, ValueError, IndexError): continue
        return None
    if os.name == "nt": return None
    try:
        import subprocess
        rows = [r.split(None, 2) for r in subprocess.run(["ps", "-A", "-o", "pid=,etime=,args="], capture_output=True, text=True).stdout.splitlines()]
        running = {int(r[0]): (r[1], r[2].split()) for r in rows if len(r) == 3 and r[0].isdigit()}
        for pid in terminal_pids():
            if pid not in running or not ours(running[pid][1]): continue
            days, _, clock = running[pid][0].rpartition("-")
            secs = 0
            for part in clock.split(":"): secs = secs * 60 + int(part)
            return time.time() - secs - int(days or 0) * 86400
    except Exception: pass
    return None

def omp_agents(path):
    """The subagents at work in this session, oldest first; None when the session keeps no folder. Each one
    writes a log of its own in the folder named after the session's (<session>/<id>.jsonl; OMP's side logs,
    such as the advisor's, start with "__"), and is at work until its reply ends a turn without calling a
    tool (OMP closes the log with session_exit only minutes later), unless an earlier OMP than the one
    running here started it: that one was cut off."""
    import time
    folder = path[:-len(".jsonl")] if path.endswith(".jsonl") else ""
    try: names = sorted(n for n in os.listdir(folder) if n.endswith(".jsonl") and not n.startswith("__"))
    except OSError: return None
    started = omp_started() if names else None
    # ps tells the start only to the second, so both checks allow a few seconds before it.
    since = started - 5 if started is not None else time.time() - 3600
    agents = []
    for n in names:
        fp = os.path.join(folder, n)
        try:
            if os.path.getmtime(fp) < since: continue
            a = omp_agent(fp, n[:-len(".jsonl")])
        except OSError: continue
        if a and (started is None or a["started"] >= since * 1000): agents.append(a)
    return sorted(agents, key=lambda a: a["started"])

def omp_agent(fp, name):
    """A subagent as the chat lists it: its id, its kind ("task", "reviewer", …), when it started (ms), and
    what it does now (the intent of the tool it ran last, and the tool); None once it is done: its latest
    message is a reply that ended its turn (or was stopped, or failed), or its log is closed."""
    with open(fp, "rb") as f:
        head = f.read(131072)
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - 262144))
        tail = f.read()
    lines = [l for l in tail.split(b"\n")[1 if size > 262144 else 0:] if l.strip()]
    for line in reversed(lines):
        if b'"session_exit"' not in line and b'"type":"message"' not in line and b'"type":"custom_message"' not in line: continue
        o = loads(line)
        if not isinstance(o, dict): continue
        if o.get("type") == "custom" and o.get("customType") == "session_exit": return None
        m = o.get("message") or {}
        if o.get("type") == "message" and m.get("role") == "assistant" and m.get("stopReason") in ("stop", "aborted", "error"): return None
        if o.get("type") in ("message", "custom_message"): break
    agent, started, intent, tool = "", 0, "", ""
    for line in head.split(b"\n")[:8]:
        o = loads(line) if line.startswith(b'{"type":"session') else None
        if not isinstance(o, dict): continue
        if o.get("type") == "session": started = iso_ms(str(o.get("timestamp") or "")) or 0
        elif o.get("type") == "session_init": agent = str(o.get("agent") or "")
    for line in reversed(lines):
        if b'"tool_execution_start"' not in line and b'"toolCall"' not in line: continue
        o = loads(line)
        if not isinstance(o, dict): continue
        if o.get("type") == "custom" and o.get("customType") == "tool_execution_start":
            d = o.get("data") or {}
            intent, tool = str(d.get("intent") or ""), str(d.get("toolName") or "")
            break
        calls = [c for c in (o.get("message") or {}).get("content") or [] if isinstance(c, dict) and c.get("type") == "toolCall"] if o.get("type") == "message" else []
        if calls:
            args = calls[-1].get("arguments") if isinstance(calls[-1].get("arguments"), dict) else {}
            intent, tool = str(calls[-1].get("intent") or args.get("i") or ""), str(calls[-1].get("name") or "")
            break
    return {"id": name, "agent": agent, "started": int(started), "intent": short(intent, 160), "tool": tool}

def omp_rpc(*requests):
    """OMP's answers to `requests`, from its RPC mode run briefly in the terminal's folder: one per
    request, None where it failed (all of them when OMP can't be run here)."""
    import subprocess
    cwd = next((c for c in candidate_cwds() if os.path.isdir(c)), HOME)
    lines = "".join(json.dumps(dict(r, id=str(i))) + "\n" for i, r in enumerate(requests))
    try: r = subprocess.run(["omp", "--mode", "rpc", "--no-session"], input=lines, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=cwd, timeout=30)
    except (OSError, subprocess.SubprocessError): return [None] * len(requests)
    answers = {}
    for line in r.stdout.splitlines():
        o = loads(line)
        if isinstance(o, dict) and o.get("type") == "response" and o.get("success"): answers[str(o.get("id"))] = o.get("data") or {}
    return [answers.get(str(i)) for i in range(len(requests))]

def tokens_short(n):
    """A token count in a few characters: 1M, 272k, 900."""
    n = int(n or 0)
    return "%gM" % round(n / 1e6, 1) if n >= 1e6 else "%dk" % round(n / 1e3) if n >= 1e3 else str(n)

def omp_commands(spec):
    """OMP's slash commands as it lists them, each with the choices that can follow it: its subcommands,
    or for /switch the models OMP can use (with their context windows, which the status line reads).
    When OMP can't be asked, the skills in its folders, as the /skill: commands they are, with a note saying so."""
    listed, models = omp_rpc({"type": "get_available_commands"}, {"type": "get_available_models"})
    if not listed:
        emit("NOTE|" + esc("OMP didn't list its commands here, so only its skills are offered"))
        return [("skill:" + n, d, s, []) for n, d, s in scan_skills(spec)]
    usable = [{"name": "%s/%s" % (m["provider"], m["id"]), "title": str(m.get("name") or m["id"]), "window": int(m.get("contextWindow") or 0),
               "description": "%s · %s context" % (m.get("name") or m["id"], tokens_short(m.get("contextWindow"))) if m.get("contextWindow") else str(m.get("name") or m["id"])}
              for m in (models or {}).get("models") or [] if m.get("provider") and m.get("id")]
    out = []
    for c in listed.get("commands") or []:
        if not c.get("name"): continue
        choices = usable if c["name"] == "switch" else [{"name": str(s["name"]), "description": str(s.get("description") or "")} for s in c.get("subcommands") or [] if s.get("name")]
        out.append((str(c["name"]), str(c.get("description") or ""), str(c.get("source") or ""), choices))
    return out

READERS["omp"] = (find_omp, parse_omp)
COMMANDS["omp"] = omp_commands
