if A.skills:
    emit_skills()
    sys.exit(0)
label = A.label or A.app
if A.app not in READERS: done("Chat view doesn't read %s sessions yet." % label)
find, parse = READERS[A.app]
path = find()
if not path and state["need"]: emit("NEED|" + state["need"]); done("Finding this %s conversation…" % label)
if not path: done(state["waiting"] or "Waiting for this %s conversation to start." % label)
parse(path)
emit("PATH|" + esc(path))
emit("HINT|" + esc(state["hint"]))
emit("OFFSET|%d" % state["next"])
if state["chain"] is not None: emit("LEAF|" + esc(state["chain"]))
if state["status"]: emit("STATUS|" + esc(json.dumps(state["status"], separators=(",", ":"))))
if state["fresh"]: emit("RESET")
if state["clipped"]: emit("NOTE|" + esc("Showing the recent part of this session."))
if state["fresh"] and not entries: emit("NOTE|" + esc("No messages in this session yet."))
for e in (entries[-MAX_ENTRIES:] if state["fresh"] else entries):
    k = e["kind"]
    if k == "call": emit("C|" + esc(e["id"]) + "|" + esc(json.dumps(e["call"], separators=(",", ":"), ensure_ascii=False)))
    elif k == "out": emit("O|" + esc(e["id"]) + "|" + esc(e["text"]))
    elif k == "reasoning": emit("R|" + esc(e["text"]))
    else: emit("M|" + e["role"] + "|" + e["phase"] + "|" + esc(e["text"]) + ("|" + esc(json.dumps(e["images"])) if e.get("images") else ""))
flush()
