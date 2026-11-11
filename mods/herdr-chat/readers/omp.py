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
    return {"k": "other", "d": (name + ": " + intent) if intent else name}

def omp_crumb():
    """The session OMP itself recorded for this terminal: (path, known).

    OMP writes ~/.omp/agent/terminal-sessions/<pty> whenever a session starts or
    changes: the folder on the first line, the session file on the second. A
    file older than the terminal belongs to an earlier owner of that pty.
    `known` without a path is a session OMP has opened but not written yet."""
    for pid in terminal_pids():
        try: tty = os.readlink("/proc/%d/fd/0" % pid)
        except OSError: continue
        if not tty.startswith("/dev/pts/"): continue
        crumb = os.path.join(HOME, ".omp", "agent", "terminal-sessions", "pts-" + tty[len("/dev/pts/"):])
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
    # No pty to go by (macOS, an OMP that keeps no session): the newest log of the terminal's folders.
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
    latest reply or compaction (`context`, None when unknown), and what the replies read here cost (`cost`,
    which the chat adds to what earlier reads found)."""
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
    if seen: state["status"] = dict(state["status"] or {}, **seen)

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
