SKILL_LOGS = {}
COMMANDS = {}
SKILLS_MOST = 500

def frontmatter(path):
    """The fields a SKILL.md's frontmatter gives as text, block scalars folded into one line."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(16384)
    except OSError:
        return {}
    m = re.match(r"(?s)\A---\r?\n(.*?)\r?\n---", text)
    fields, key = {}, None
    for line in (m.group(1).splitlines() if m else []):
        top = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if top:
            key, value = top.group(1), top.group(2).strip()
            fields[key] = "" if value in (">", "|", ">-", "|-", ">+", "|+") else value.strip("\"'")
        elif key and line[:1] in (" ", "\t"):
            fields[key] = (fields[key] + " " + line.strip()).strip()
    return fields

def skill_files(root, skip):
    """Every SKILL.md under a skills folder, its links followed; a skill's own subfolders aren't searched."""
    top = root.count(os.sep)
    for at, dirs, files in os.walk(root, followlinks=True):
        if "SKILL.md" in files:
            dirs[:] = []
            yield at
            continue
        dirs[:] = [d for d in dirs if d not in skip and (d == ".system" or not d.startswith(".")) and at.count(os.sep) - top < 4]

def project_folders():
    """The terminal's folders and those above them, stopping below the home folder, whose skills are the person's own."""
    seen = []
    for cwd in candidate_cwds():
        at = os.path.abspath(cwd)
        while at != HOME and at not in seen:
            seen.append(at)
            up = os.path.dirname(at)
            if up == at: break
            at = up
    return seen

def scan_skills(spec):
    """The skills in the harness's folders as (name, description, source: project or personal), a project's winning over the person's own."""
    skip, found = set(spec.get("skip") or []), {}
    roots = [(os.path.join(cwd, r), "project") for cwd in project_folders() for r in spec.get("project") or []]
    roots += [(os.path.expanduser(r), "personal") for r in spec.get("user") or []]
    for root, source in roots:
        for at in skill_files(root, skip):
            fields = frontmatter(os.path.join(at, "SKILL.md"))
            name = fields.get("name") or os.path.basename(at)
            if str(fields.get("user-invocable", "")).lower() == "false" or name in found: continue
            found[name] = (name, fields.get("description", ""), source)
            if len(found) >= SKILLS_MOST: return list(found.values())
    return list(found.values())

def log_lines(path, marker):
    """The lines holding `marker` near a session log's start and end, where harnesses list what's available."""
    span = 8 * 1024 * 1024
    try:
        with open(path, "rb") as f:
            size = os.fstat(f.fileno()).st_size
            head = f.read(span)
            f.seek(max(span, size - span))
            tail = f.read()
    except OSError:
        return []
    return [l.decode("utf-8", "replace") for chunk in (head, tail) for l in chunk.split(b"\n") if marker in l]

def emit_skills():
    """Writes the harness's skills: what its own log lists, then its folders' others. A harness that lists
    all its commands (`commands` in its spec, a reader in COMMANDS) gets that list instead, each command
    with the choices that can follow it."""
    spec = loads(A.skills) or {}
    if spec.get("commands") and A.app in COMMANDS:
        for name, desc, source, choices in COMMANDS[A.app](spec):
            emit("S|" + esc(name) + "|" + esc(short(desc, 240)) + "|" + esc(source) + ("|" + esc(json.dumps(choices, separators=(",", ":"), ensure_ascii=False)) if choices else ""))
        flush()
        return
    listed = SKILL_LOGS[A.app](A.known) if A.app in SKILL_LOGS and A.known else []
    scanned = scan_skills(spec)
    sources = {n: s for n, _, s in scanned}
    names = {n for n, _, _ in listed}
    for name, desc, source in [(n, d, sources.get(n, "built-in")) for n, d, _ in listed] + [s for s in scanned if s[0] not in names]:
        emit("S|" + esc(name) + "|" + esc(short(desc, 240)) + "|" + esc(source))
    flush()
