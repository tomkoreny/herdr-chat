export function skillToken(text, triggers) {
  // The skill being typed at the end of `text`: its start, trigger and query, or null. `/` only opens a message; the others start any word.
  const m = /(?:^|\s)([^\s]+)$/.exec(text);
  if (!m) return null;
  const start = text.length - m[1].length, trigger = m[1][0];
  if (!triggers?.includes(trigger) || (trigger === "/" && start !== 0)) return null;
  return { start, trigger, query: m[1].slice(1) };
}

function ownership(skill) {
  // Whose it is, nearest first: the project's, the person's, or what came with the harness.
  return skill.source === "project" ? 0 : skill.source === "personal" ? 1 : 2;
}

export function matchSkills(skills, query, invoke = "") {
  // The skills matching what's typed: name starts first, then names containing it, then descriptions; a project's, then the person's own, then what came with the harness, each alphabetical.
  const tail = invoke.slice(1);
  const typed = query.toLowerCase();
  const q = tail && typed.startsWith(tail) ? typed.slice(tail.length) : typed;
  const rank = s => {
    const name = s.name.toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : s.description.toLowerCase().includes(q) ? 2 : 3;
  };
  return skills.map(s => [rank(s), s]).filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0] || ownership(a[1]) - ownership(b[1]) || a[1].name.localeCompare(b[1].name)).map(([, s]) => s);
}

export function withSkill(text, token, invoke, name) {
  // The text with the token replaced by the skill as its harness takes it, ready for the rest of the message.
  return `${text.slice(0, token.start)}${invoke}${name} `;
}

export function choiceToken(text, invoke) {
  // The choice being typed after a command, as in `/effort hi`: the command's name, where the choice starts, and what's typed of it; null otherwise.
  const m = /^(\S+) (\S*)$/.exec(text);
  if (!m || !invoke || !m[1].startsWith(invoke) || m[1].length === invoke.length) return null;
  return { command: m[1].slice(invoke.length), start: m[1].length + 1, query: m[2] };
}

export function matchChoices(choices, query) {
  // The choices matching what's typed: name starts first, then names containing it, then descriptions, each kept in the harness's own order (levels low to high, models by provider).
  const q = query.toLowerCase();
  const rank = c => {
    const name = c.name.toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : (c.description ?? "").toLowerCase().includes(q) ? 2 : 3;
  };
  return choices.map((c, i) => [rank(c), i, c]).filter(([r]) => r < 3).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , c]) => c);
}

export function withChoice(text, token, name) {
  // The text with the typed choice replaced by `name`, ready to send.
  return `${text.slice(0, token.start)}${name} `;
}

export function parseSkills(stdout) {
  // The reader's S lines as skills, or commands with the choices that can follow them.
  return stdout.split("\n").filter(l => l.startsWith("S|")).map(l => {
    const [, name, description = "", source = "", choices] = l.split("|").map(decodeURIComponent);
    return choices ? { name, description, source, choices: JSON.parse(choices) } : { name, description, source };
  });
}
