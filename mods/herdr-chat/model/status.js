export function tokensShort(n) {
  // A token count in a few characters: 1M, 1.5M, 272k, 900.
  n = Math.round(Number(n) || 0);
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function statusParts(status, models = []) {
  // A session's status line as text: its model by name, its thinking level, how full its context is, and what it cost so far. The harness's list of models names the model and gives its context window; without it, the model's id and the token count stand in. Null without a status.
  if (!status) return null;
  const model = models.find(m => m.name === status.model);
  const window = model?.window || 0;
  const used = Number(status.context) || 0;
  return {
    model: model?.title || (status.model ? status.model.split("/").pop() : ""),
    effort: status.effort || "",
    context: !used ? "" : window ? `${(used / window * 100).toFixed(1)}% of ${tokensShort(window)}` : `${tokensShort(used)} tokens`,
    cost: status.cost ? `$${Number(status.cost).toFixed(2)}` : "",
  };
}

export function mergeStatus(before, read) {
  // A session's status after a read: what the read saw replaces what was known, and the cost it found adds to the cost so far (each read reports only its own entries).
  if (!read) return before;
  return { ...before, ...read, ...(before?.cost || read.cost ? { cost: (before?.cost ?? 0) + (read.cost ?? 0) } : {}) };
}
