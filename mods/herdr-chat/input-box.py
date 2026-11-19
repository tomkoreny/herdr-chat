import fcntl, json, os, pty, re, select, struct, subprocess, sys, termios, time

ENV = {k: v for k, v in os.environ.items() if k not in ("HC_TERMINAL_ID", "HC_SCOPE")}


def size(terminal):
    info = json.loads(subprocess.run(["hc", "get", "--json", terminal], capture_output=True, text=True, env=ENV, check=True).stdout)
    return int(info.get("rows") or 40), int(info.get("cols") or 120)


def attach(terminal, observe, rows, cols):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe("hc", ["hc", "attach", *(["--observe"] if observe else []), terminal], ENV)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    return pid, fd


REPLIES = [
    (b"\x1b]10;?", b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\"),
    (b"\x1b]11;?", b"\x1b]11;rgb:0000/0000/0000\x1b\\"),
    (b"\x1b]12;?", b"\x1b]12;rgb:ffff/ffff/ffff\x1b\\"),
    (b"\x1b[16t", b"\x1b[6;20;10t"),
    (b"\x1b[c", b"\x1b[?62;22c"),
]


def answer(fd, chunk):
    for ask, reply in REPLIES:
        if ask in chunk:
            try:
                os.write(fd, reply)
            except OSError:
                pass


def drain(fd, quiet, limit, busy=None):
    """What the attach prints until it has been quiet for `quiet` seconds (at most `limit`). With `busy`, a screen that never pauses (OMP
    redraws a waiting question some 30 times a second) is given that long from where its paint began in earnest, past the attach's opening
    questions, and no longer."""
    got, start, last, began = b"", time.time(), None, None
    while time.time() - start < limit:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            answer(fd, chunk)
            got, last = got + chunk, time.time()
            if began is None and len(got) > 256:
                began = last
        elif last is not None and time.time() - last >= quiet:
            break
        if busy is not None and began is not None and time.time() - began >= busy:
            break
    return got


def detach(pid, fd):
    try:
        os.write(fd, b"\x1c")
    except OSError:
        pass
    drain(fd, 0.1, 1.0)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


CSI = re.compile(r"\x1b\[([0-9;?:=!>]*)([ -/]*)([@-~])")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def render(paint, rows, cols):
    """The screen as rows of (char, dim) cells, from a first paint (cursor moves, SGR, text)."""
    blank = (" ", False)
    grid = [[blank] * cols for _ in range(rows)]
    r = c = 0
    dim = False
    i, n = 0, len(paint)
    while i < n:
        ch = paint[i]
        if ch == "\x1b":
            m = CSI.match(paint, i)
            if m:
                params, _, final = m.groups()
                private = params[:1] in ("?", "=", ">", "!")
                nums = [int(x) if x.isdigit() else 0 for x in params.lstrip("?=>!").split(";")] if params else []
                arg = lambda k, d=1: nums[k] if len(nums) > k and nums[k] else d
                if private:
                    pass
                elif final in "Hf":
                    r, c = arg(0) - 1, arg(1) - 1
                elif final == "G":
                    c = arg(0) - 1
                elif final == "d":
                    r = arg(0) - 1
                elif final == "A":
                    r -= arg(0)
                elif final in "Be":
                    r += arg(0)
                elif final in "Ca":
                    c += arg(0)
                elif final == "D":
                    c -= arg(0)
                elif final == "K":
                    mode = nums[0] if nums else 0
                    span = range(c, cols) if mode == 0 else range(0, c + 1) if mode == 1 else range(cols)
                    if 0 <= r < rows:
                        for x in span:
                            grid[r][x] = blank
                elif final == "J" and nums[:1] in ([2], [3]):
                    grid = [[blank] * cols for _ in range(rows)]
                elif final == "m":
                    codes, k = nums or [0], 0
                    while k < len(codes):
                        x = codes[k]
                        if x == 0 or x == 22:
                            dim = False
                        elif x == 2:
                            dim = True
                        elif x in (38, 48) and k + 1 < len(codes):
                            k += 4 if codes[k + 1] == 2 else 2
                        k += 1
                r, c = max(0, min(rows - 1, r)), max(0, min(cols - 1, c))
                i = m.end()
                continue
            m = OSC.match(paint, i)
            if m:
                i = m.end()
                continue
            i += 3 if i + 1 < n and paint[i + 1] in "()*+-./#%" else 2
            continue
        if ch == "\r":
            c = 0
        elif ch == "\n":
            if r == rows - 1:
                grid.pop(0)
                grid.append([blank] * cols)
            else:
                r += 1
        elif ch == "\b":
            c = max(0, c - 1)
        elif ord(ch) >= 32:
            grid[r][c] = (ch, dim)
            c = min(cols - 1, c + 1)
        i += 1
    return grid


def text_of(row):
    return "".join(ch for ch, _ in row).replace("\u00a0", " ").rstrip()


def typed_of(row, skip):
    """A row's typed characters after its first `skip` cells: dim ones (placeholders, suggestions) left out."""
    return "".join(ch for ch, d in row[skip:] if not d).replace("\u00a0", " ").rstrip()


def is_rule(row):
    t = text_of(row).strip()
    return len(t) >= 10 and set(t) <= set("─━═-")


def join(lines):
    """Box rows back into text: a row filled to the box's width ran on into the next one."""
    out = ""
    for k, (line, full) in enumerate(lines):
        out += line
        if k < len(lines) - 1 and not full:
            out += "\n"
    return out


PROMPT_KEYS = re.compile(r"enter to (select|confirm|submit)|↑/↓|↑↓|to navigate|esc to cancel|esc (back|dismiss)", re.I)


def box(grid, shape):
    """The text typed in the input box, found the way `shape` (the harness adapter's `box`) describes it, or None."""
    rows, cols = len(grid), len(grid[0]) if grid else 0
    texts = [text_of(row) for row in grid]
    if any(PROMPT_KEYS.search(line) for line in [x for x in texts if x.strip()][-6:]):
        return None
    if shape.get("style") == "mark":
        mark = shape["mark"]
        start = next((y for y in range(rows - 1, -1, -1) if texts[y].startswith(mark + " ") or texts[y] == mark), None)
        if start is None:
            return None
        lines = []
        for y in range(start, rows):
            if y > start and (not texts[y].startswith("  ") or is_rule(grid[y])):
                break
            if y > start and shape.get("stopAtBlank") and not texts[y].strip():
                break
            line = typed_of(grid[y], 2)
            lines.append((line, len(texts[y]) >= cols - 1))
        while lines and not lines[-1][0]:
            lines.pop()
        return join(lines)
    if shape.get("style") == "rules":
        rules = [y for y in range(rows) if is_rule(grid[y])]
        if len(rules) < 2:
            return None
        top, bottom = rules[-2], rules[-1]
        lines = [(typed_of(grid[y], 0), len(texts[y]) >= cols - 1) for y in range(top + 1, bottom)]
        while lines and not lines[-1][0]:
            lines.pop()
        while lines and not lines[0][0]:
            lines.pop(0)
        if lines and (lines[0][0] == " >" or lines[0][0].startswith(" > ")):
            lines = [(line[3:] if k == 0 or line.startswith("   ") else line, full) for k, (line, full) in enumerate(lines)]
        return join(lines)
    return None


def quiet_for(terminal):
    """How long the paint must pause before it's taken as whole: another machine's arrives in bursts."""
    return 0.5 if "/" in terminal else 0.15


def read(terminal, shape):
    rows, cols = size(terminal)
    pid, fd = attach(terminal, True, rows, cols)
    paint = drain(fd, quiet_for(terminal), 4.0).decode("utf-8", "replace")
    detach(pid, fd)
    return box(render(paint, rows, cols), shape) if paint else None


STEP_ROW = re.compile(r"(?:Submit\s*→|←[^\r\n]*[□☐■☑☒])[^\r\n]*\r?\n")


def highlighted(paint):
    """The step with a background colour in a prompt's step row, or None."""
    rows = [l for l in paint.split("\n") if re.search(r"Submit\s*→|^\s*←.*[□☐■☑☒]", OSC.sub("", CSI.sub("", l)))]
    if not rows:
        return None
    line, back, at = OSC.sub("", rows[-1]), False, 0
    for m in [*CSI.finditer(line), None]:
        text = line[at:m.start() if m else len(line)]
        if back and re.search(r"\w", text):
            return re.sub(r"[^\w\s-]", "", text).strip()
        if m is None:
            return None
        at = m.end()
        if m.group(3) == "m":
            codes = m.group(1).split(";")
            if codes[0] in ("", "0", "49", "27"):
                back = False
            elif codes[0] in ("48", "7") or "48" in codes:
                back = True


def step(terminal):
    """Prints the step a prompt is on, stopping as soon as the step row has been painted."""
    rows, cols = size(terminal)
    pid, fd = attach(terminal, True, rows, cols)
    got, start = b"", time.time()
    while time.time() - start < 3:
        if select.select([fd], [], [], 0.05)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            answer(fd, chunk)
            got += chunk
            if STEP_ROW.search(CSI.sub("", got.decode("utf-8", "replace"))):
                break
    detach(pid, fd)
    print(json.dumps({"box": highlighted(got.decode("utf-8", "replace"))}))


def type_into(terminal, erase, pastes):
    """One attach: `erase` Deletes and Backspaces (empties the box wherever the cursor is), then each paste."""
    rows, cols = size(terminal)
    pid, fd = attach(terminal, False, rows, cols)
    if not drain(fd, quiet_for(terminal), 4.0):
        detach(pid, fd)
        sys.exit("hc attach printed nothing")
    if erase:
        for _ in range(0, erase, 20):
            os.write(fd, b"\x1b[3~" * 20 + b"\x7f" * 20)
            drain(fd, 0.02, 0.1)
    for text in pastes:
        if text:
            os.write(fd, b"\x1b[200~" + text.encode() + b"\x1b[201~")
            drain(fd, 0.15, 0.6)
    drain(fd, 0.1, 0.4)
    detach(pid, fd)


def paste(terminal, text):
    type_into(terminal, 0, [text])


def write(terminal, chunks):
    """One attach: each chunk typed as it is (keys as the bytes a terminal sends, a paste inside its brackets), the program given time to
    take it in before the next: until its paint pauses, or a moment where it never does (longer on another machine, whose paint comes in
    bursts)."""
    rows, cols = size(terminal)
    pid, fd = attach(terminal, False, rows, cols)
    away = "/" in terminal
    if not drain(fd, quiet_for(terminal), 4.0, 1.0 if away else 0.3):
        detach(pid, fd)
        sys.exit("hc attach printed nothing")
    quiet, limit = (0.2, 0.5) if away else (0.05, 0.15)
    for chunk in chunks:
        data = chunk.encode()
        while data:
            data = data[os.write(fd, data):]
        drain(fd, quiet, limit)
    detach(pid, fd)


def tall(terminal, hidden):
    """The screen with `hidden` more rows, for a moment: an attach at that height, and back as soon as nothing is cut."""
    rows, cols = size(terminal)
    pid, fd = attach(terminal, False, rows + hidden + 4, cols)
    screen, end = "", time.time() + 2.5
    try:
        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], 0.15)
            if ready:
                try:
                    answer(fd, os.read(fd, 65536))
                except OSError:
                    break
            screen = subprocess.run(["hc", "read", terminal], capture_output=True, text=True, env=ENV).stdout
            if re.search(r"[┌][─]+[┐]", screen) and not re.search(r"\d+ lines? hidden", screen):
                break
    finally:
        try:
            os.write(fd, b"\x1c")
            time.sleep(0.1)
            os.close(fd)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
    return screen


def main():
    cmd = sys.argv[1]
    if cmd == "read":
        print(json.dumps({"box": read(sys.argv[2], json.loads(sys.argv[3]))}))
    elif cmd == "tall":
        print(json.dumps({"box": tall(sys.argv[2], int(sys.argv[3]))}))
    elif cmd == "step":
        step(sys.argv[2])
    elif cmd == "fill":
        type_into(sys.argv[2], 200, [sys.argv[3]])
    elif cmd == "paste":
        paste(sys.argv[2], sys.argv[3])
    elif cmd == "write":
        write(sys.argv[2], json.loads(sys.argv[3]))
    elif cmd == "set":
        terminal, shape, pastes = sys.argv[2], json.loads(sys.argv[3]), [p for p in json.loads(sys.argv[4]) if p]
        now = read(terminal, shape)
        if now is None:
            sys.exit("no input box on screen")
        if now or pastes:
            type_into(terminal, len(now) + now.count("\n") + 8 if now else 0, pastes)
            time.sleep(0.15)
            now = read(terminal, shape)
        print(json.dumps({"box": now}))


if __name__ == "__main__":
    main()
