function onCharacter(text, at) {
  // Never between the two halves of a character outside the BMP (an emoji): offsets are UTF-16.
  const c = text.charCodeAt(at);
  return at > 0 && at < text.length && c >= 0xdc00 && c <= 0xdfff ? at - 1 : at;
}

export function lineMove(text, from, dir, goal = null) {
  // Where ↑ (dir -1) or ↓ (dir +1) takes the cursor at `from` in `text`, by lines between line breaks.
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const column = goal ?? from - start;
  if (dir < 0) {
    if (start === 0) return { at: 0, column };
    const prevEnd = start - 1, prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
    return { at: onCharacter(text, prevStart + Math.min(column, prevEnd - prevStart)), column };
  }
  const end = text.indexOf("\n", from);
  if (end < 0) return { at: text.length, column };
  const nextStart = end + 1, nextEnd = text.indexOf("\n", nextStart) < 0 ? text.length : text.indexOf("\n", nextStart);
  return { at: onCharacter(text, nextStart + Math.min(column, nextEnd - nextStart)), column };
}
