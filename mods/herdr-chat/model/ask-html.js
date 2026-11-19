// An OMP `ask` call's form, read from its HTML as OMP itself reads it. OMP draws the form in its terminal and takes the answers there; the chat
// answers by typing into that form (ask-form.js), so it needs the same fields in the same order with the same options. This follows OMP's
// packages/tui/src/html-form/parse.ts, over the tree its packages/utils/src/dom/parser.ts builds (OMP 18.22 and 19 read a form alike).

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const CLOSED_BY = { li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr"], th: ["th", "td"], td: ["th", "td"], option: ["option"],
  thead: ["thead", "tbody", "tfoot"], tbody: ["thead", "tbody", "tfoot"], tfoot: ["thead", "tbody", "tfoot"] };
const ENDS_P = new Set("address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr menu nav ol p pre section table ul".split(" "));
const SKIPPED = new Set("button head iframe link meta noscript script style template title".split(" "));
const BLOCK = new Set("address article aside blockquote dd details div dl dt figure figcaption footer header li main nav p section".split(" "));
const HEADING = new Set("h1 h2 h3 h4 h5 h6 summary".split(" "));
const STYLE = { b: "strong", code: "code", em: "em", i: "em", kbd: "code", samp: "code", strong: "strong", tt: "code" };
const NO_INPUT = new Set("button file image reset submit hidden".split(" "));
const CONTROLS = new Set(["input", "select", "textarea"]);
// The named entities OMP's parser knows; any other is left as written.
const ENTITIES = { AElig: "Æ", Aacute: "Á", Acirc: "Â", Agrave: "À", Aring: "Å", Atilde: "Ã", Auml: "Ä", Ccedil: "Ç", ETH: "Ð", Eacute: "É", Ecirc: "Ê", Egrave: "È", Euml: "Ë",
  Iacute: "Í", Icirc: "Î", Igrave: "Ì", Iuml: "Ï", Ntilde: "Ñ", Oacute: "Ó", Ocirc: "Ô", Ograve: "Ò", Oslash: "Ø", Otilde: "Õ", Ouml: "Ö", THORN: "Þ", Uacute: "Ú", Ucirc: "Û",
  Ugrave: "Ù", Uuml: "Ü", Yacute: "Ý", aacute: "á", acirc: "â", aelig: "æ", agrave: "à", aring: "å", atilde: "ã", auml: "ä", amp: "&", apos: "'", bull: "•", brvbar: "¦",
  ccedil: "ç", cedil: "¸", cent: "¢", copy: "©", deg: "°", curren: "¤", divide: "÷", emsp: "\u2003", ensp: "\u2002", euro: "€", eacute: "é", ecirc: "ê", egrave: "è", eth: "ð",
  euml: "ë", frac12: "½", frac14: "¼", frac34: "¾", gt: ">", iacute: "í", icirc: "î", iexcl: "¡", igrave: "ì", iquest: "¿", iuml: "ï", hellip: "…", laquo: "«", ldquo: "“",
  lsquo: "‘", lt: "<", mdash: "—", macr: "¯", micro: "µ", middot: "·", nbsp: "\u00a0", ndash: "–", ntilde: "ñ", oacute: "ó", ocirc: "ô", ograve: "ò", ordf: "ª", ordm: "º",
  oslash: "ø", otilde: "õ", ouml: "ö", para: "¶", pound: "£", plusmn: "±", quot: '"', raquo: "»", rdquo: "”", reg: "®", rsquo: "’", sect: "§", shy: "\u00ad", szlig: "ß",
  thorn: "þ", sup1: "¹", sup2: "²", sup3: "³", thinsp: "\u2009", times: "×", trade: "™", uacute: "ú", ucirc: "û", ugrave: "ù", uml: "¨", uuml: "ü", yacute: "ý", yuml: "ÿ", yen: "¥" };

function decode(text) {
  // Text with its character references read: the named ones above, and every valid numbered one.
  if (!text.includes("&")) return text;
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, entity) => {
    if (entity[0] !== "#") return ENTITIES[entity] ?? ENTITIES[entity.toLowerCase()] ?? whole;
    const hex = entity[1].toLowerCase() === "x", code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return !Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\ufffd" : String.fromCodePoint(code);
  });
}

function tagEnd(html, start) {
  // Where the tag opened before `start` closes: its `>`, not one inside a quoted value.
  let quote = "";
  for (let i = start; i < html.length; i++) {
    if (quote) { if (html[i] === quote) quote = ""; }
    else if (html[i] === '"' || html[i] === "'") quote = html[i];
    else if (html[i] === ">") return i;
  }
  return html.length - 1;
}

function startTag(source) {
  // A start tag's name, its attributes (names lowercased; one written twice keeps its first value) and whether it ends in `/`; null without a name.
  const space = () => { while (/\s/.test(source[i] ?? "")) i++; };
  const match = (pattern) => { pattern.lastIndex = i; const m = pattern.exec(source)?.[0] ?? ""; i += m.length; return m; };
  let i = 0, closed = false;
  space();
  const name = match(/[^\s/>]+/y).toLowerCase(), attrs = {};
  if (!name) return null;
  while (i < source.length) {
    space();
    if (source[i] === "/") { closed = true; break; }
    const attr = match(/[^\s=/>]+/y).toLowerCase();
    if (!attr) break;
    space();
    let value = "";
    if (source[i] === "=") {
      i++;
      space();
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, i + 1);
        value = source.slice(i + 1, end < 0 ? source.length : end);
        i = end < 0 ? source.length : end + 1;
      } else value = match(/[^\s>]+/y);
    }
    if (!(attr in attrs)) attrs[attr] = decode(value);
  }
  return { name, attrs, closed };
}

function tree(html) {
  // The HTML as a tree of elements ({ tag, attrs, kids, up, svg }) and strings under a root, with the few end tags OMP's parser supplies.
  const root = { tag: "", attrs: {}, kids: [], up: null, svg: false }, open = [];
  let parent = root, i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) { const end = html.indexOf("-->", i + 4); i = end < 0 ? html.length : end + 3; continue; }
    if (html[i] !== "<") {
      const next = html.indexOf("<", i), end = next < 0 ? html.length : next;
      parent.kids.push(decode(html.slice(i, end)));
      i = end;
      continue;
    }
    if (html.startsWith("<![CDATA[", i)) {
      const end = html.indexOf("]]>", i + 9);
      parent.kids.push(html.slice(i + 9, end < 0 ? html.length : end));
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[i + 1] === "/") {
      const end = tagEnd(html, i + 2), name = html.slice(i + 2, end).trim().split(/\s/, 1)[0].toLowerCase();
      const at = open.findLastIndex(e => e.tag === name);
      if (at >= 0) open.length = at;
      parent = open.at(-1) ?? root;
      i = end + 1;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") { const end = html.indexOf(">", i + 2); i = end < 0 ? html.length : end + 1; continue; }
    const end = tagEnd(html, i + 1), tag = startTag(html.slice(i + 1, end));
    if (!tag) { parent.kids.push("<"); i++; continue; }
    const top = open.at(-1);
    if (top && ((top.tag === "p" && ENDS_P.has(tag.name)) || CLOSED_BY[tag.name]?.includes(top.tag))) open.pop();
    parent = open.at(-1) ?? root;
    const element = { tag: tag.name, attrs: tag.attrs, kids: [], up: parent, svg: tag.name === "svg" || parent.svg };
    parent.kids.push(element);
    i = end + 1;
    if ((tag.name === "script" || tag.name === "style") && !tag.closed) {
      const close = new RegExp(`</${tag.name}\\s*>`, "ig");
      close.lastIndex = i;
      const found = close.exec(html);
      element.kids.push(html.slice(i, found ? found.index : html.length));
      i = found ? close.lastIndex : html.length;
    } else if (!VOID.has(tag.name) && !(element.svg && tag.closed)) { open.push(element); parent = element; }
  }
  return root;
}

function all(node, tags) {
  // The elements under `node` with one of `tags`, in document order.
  return node.kids.flatMap(kid => typeof kid === "string" ? [] : [...(tags.has(kid.tag) ? [kid] : []), ...all(kid, tags)]);
}

function textOf(node) { return node.kids.map(kid => typeof kid === "string" ? kid : textOf(kid)).join(""); }

function closest(node, tag, within) {
  // `node` or its nearest ancestor with `tag`, looking no further up than `within`; null when there's none.
  while (node && node.tag !== tag) node = node === within ? null : node.up;
  return node ?? null;
}

function number(node, name) {
  const raw = node.attrs[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
}

function span(spans, text, style) {
  // Adds `text` to `spans`, into the last one when the style is the same.
  if (!text) return;
  const last = spans.at(-1);
  if (last && last.s === style) last.t += text;
  else spans.push(style ? { t: text, s: style } : { t: text });
}

function tidy(spans) {
  // Spans with whitespace collapsed as HTML lays text out: runs to one space, none beside a line break or at the ends.
  const out = [];
  for (const s of spans) span(out, s.t.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n"), s.s);
  if (out.length) { out[0].t = out[0].t.replace(/^\s+/, ""); out.at(-1).t = out.at(-1).t.replace(/\s+$/, ""); }
  return out.filter(s => s.t !== "");
}

export function plain(spans) {
  // A label's or a paragraph's text without its styling.
  return (spans ?? []).map(s => s.t).join("");
}

export function parseForm(html) {
  // An ask form's HTML as { sections, fields }: what OMP draws, a <fieldset> under its legend or the loose content between two at a time, and
  // the fields a person answers, in OMP's order. A section's blocks are text (spans, each { t: text, s: "code" | "strong" | "em" }), a list,
  // pre, a table, an image, an svg (its name only) or a field (its index in `fields`). A field is a choice (a radio group, a checkbox group
  // or a <select>; `other` when OMP adds its own free-text answer) or a text (an <input> or a <textarea>). Content outside the first <form>
  // is left out when there is one.
  const document = tree(String(html ?? "")), root = all(document, new Set(["form"]))[0] ?? document;
  let section = { title: [], blocks: [], fieldset: false }, inline = [], depth = 0;
  const sections = [section], fields = [], groups = new Map(), labelFor = new Map();

  const flush = heading => {
    const spans = tidy(inline);
    inline = [];
    if (spans.length) section.blocks.push({ kind: "text", spans, heading });
  };
  const add = field => { fields.push(field); section.blocks.push({ kind: "field", field: fields.length - 1 }); };
  const startSection = (title, fieldset) => {
    if (!section.blocks.length && !section.title.length) { section.title = title; section.fieldset = fieldset; return; }
    section = { title, blocks: [], fieldset };
    sections.push(section);
  };
  const spansOf = element => {
    // An element's text without its controls, whose label it is.
    const spans = [];
    const visit = (node, style) => {
      if (typeof node === "string") return span(spans, node, style);
      if (SKIPPED.has(node.tag) || CONTROLS.has(node.tag) || node.tag === "svg") return;
      if (node.tag === "br") return span(spans, "\n");
      if (node.tag === "img") return span(spans, node.attrs.alt ?? "", style);
      if (BLOCK.has(node.tag) || HEADING.has(node.tag)) span(spans, " ");
      for (const kid of node.kids) visit(kid, STYLE[node.tag] ?? style);
    };
    for (const kid of element.kids) visit(kid);
    return tidy(spans);
  };
  const control = (node, wrapping) => {
    flush(false);
    const detached = () => {
      // The label of a control outside any <label>: its <label for>, else its aria-label or title.
      const label = node.attrs.id ? labelFor.get(node.attrs.id) : undefined;
      if (label) return spansOf(label);
      const text = node.attrs["aria-label"] ?? node.attrs.title;
      return text ? tidy([{ t: text }]) : [];
    };
    const label = wrapping?.length ? wrapping : detached();
    const name = node.attrs.name ?? "", required = "required" in node.attrs;
    const named = name ? [{ t: name.replace(/[_-]+/g, " ") }] : [];
    const limits = Object.fromEntries([["min", "min"], ["max", "max"], ["minLength", "minlength"], ["maxLength", "maxlength"]]
      .map(([key, attr]) => [key, number(node, attr)]).filter(([, n]) => n !== undefined));
    if (node.tag === "select") {
      const multi = "multiple" in node.attrs;
      const options = all(node, new Set(["option"])).map(o => {
        const text = textOf(o).replace(/\s+/g, " ").trim();
        return { value: o.attrs.value ?? text, label: [{ t: text }], checked: "selected" in o.attrs, disabled: "disabled" in o.attrs };
      });
      // A single select always has a selection: the first enabled option unless one is marked.
      const first = !multi && !options.some(o => o.checked) ? options.find(o => !o.disabled) : null;
      if (first) first.checked = true;
      return add({ kind: "choice", name, multi, select: true, other: false, label, options, required });
    }
    if (node.tag === "textarea") {
      const { minLength, maxLength } = limits;
      return add({ kind: "text", name, type: "textarea", multiline: true, label: label.length ? label : named, value: textOf(node).replace(/^\r?\n/, ""),
        placeholder: node.attrs.placeholder ?? "", required, ...(minLength !== undefined && { minLength }), ...(maxLength !== undefined && { maxLength }), rows: number(node, "rows") ?? 4 });
    }
    const type = (node.attrs.type ?? "text").toLowerCase(), value = node.attrs.value;
    if (NO_INPUT.has(type)) return;
    if (type === "radio" || type === "checkbox") {
      const option = { value: value ?? "on", label: label.length ? label : [{ t: value ?? name }], checked: "checked" in node.attrs, disabled: "disabled" in node.attrs };
      const group = groups.get(`${type}\0${name}`);
      if (group) { group.options.push(option); group.required ||= required; return; }
      const field = { kind: "choice", name, multi: type === "checkbox", select: false, other: false, label: [], options: [option], required };
      groups.set(`${type}\0${name}`, field);
      return add(field);
    }
    add({ kind: "text", name, type, multiline: false, label: label.length ? label : named, value: value ?? "", placeholder: node.attrs.placeholder ?? "", required,
      ...limits, ...("pattern" in node.attrs && { pattern: node.attrs.pattern }), rows: 1 });
  };
  const table = node => {
    flush(false);
    const rows = all(node, new Set(["tr"])).filter(r => closest(r, "table") === node);
    const cellsOf = row => row.kids.filter(c => typeof c !== "string" && (c.tag === "td" || c.tag === "th"));
    if (!all(node, CONTROLS).length) {
      const cells = rows.map(r => cellsOf(r).map(spansOf));
      let head = 0;
      while (head < rows.length && (closest(rows[head], "thead") || cellsOf(rows[head]).every(c => c.tag === "th"))) head++;
      if (cells.some(r => r.length)) section.blocks.push({ kind: "table", rows: cells, headerRows: head });
      return;
    }
    // A table of controls: each row's text is a line, and a control without a label takes its column's header.
    let header = [];
    for (const row of rows) {
      const cells = cellsOf(row);
      if (cells.every(c => c.tag === "th") && !all(row, CONTROLS).length) { header = cells.map(spansOf); continue; }
      const text = [];
      for (const cell of cells) {
        const spans = all(cell, CONTROLS).length ? [] : spansOf(cell);
        if (!spans.length) continue;
        if (text.length) span(text, " · ");
        for (const s of spans) span(text, s.t, s.s);
      }
      if (text.length) section.blocks.push({ kind: "text", spans: text, heading: false });
      cells.forEach((cell, column) => {
        for (const c of all(cell, CONTROLS)) {
          const spans = spansOf(closest(c, "label", cell) ?? cell);
          control(c, spans.length ? spans : header[column] ?? []);
        }
      });
    }
  };
  const children = (node, style) => { for (const kid of node.kids) walk(kid, style); };
  const walk = (node, style) => {
    if (typeof node === "string") return span(inline, node, style);
    const tag = node.tag;
    if (SKIPPED.has(tag)) return;
    if (tag === "br") return span(inline, "\n");
    if (tag === "hr") return flush(false);
    if (CONTROLS.has(tag)) return control(node);
    if (tag === "table") return table(node);
    if (tag === "label") {
      if (node.attrs.for && labelFor.get(node.attrs.for) === node) return;
      const controls = all(node, CONTROLS);
      if (!controls.length) return children(node, style);
      flush(false);
      const spans = spansOf(node);
      for (const c of controls) control(c, spans);
    } else if (tag === "fieldset") {
      flush(false);
      const legend = node.kids.find(k => typeof k !== "string" && k.tag === "legend");
      // A fieldset inside another stays in its section, its legend a heading.
      if (!depth) startSection(legend ? spansOf(legend) : [], true);
      else if (legend) walk(legend);
      depth++;
      for (const kid of node.kids) if (kid !== legend) walk(kid);
      flush(false);
      if (!--depth) startSection([], false);
    } else if (tag === "ul" || tag === "ol") {
      flush(false);
      // A list of controls is layout, not content.
      if (all(node, CONTROLS).length) { children(node); return flush(false); }
      const items = node.kids.filter(k => typeof k !== "string" && k.tag === "li").map(spansOf).filter(s => s.length);
      if (items.length) section.blocks.push({ kind: "list", items, ordered: tag === "ol" });
    } else if (tag === "pre") {
      flush(false);
      section.blocks.push({ kind: "pre", text: textOf(node).replace(/^\n/, "").trimEnd() });
    } else if (tag === "img") {
      const src = (node.attrs.src ?? "").trim();
      if (!src) return;
      flush(false);
      section.blocks.push({ kind: "image", src, alt: (node.attrs.alt ?? "").trim() });
    } else if (tag === "svg") {
      flush(false);
      const title = node.kids.find(k => typeof k !== "string" && k.tag === "title");
      section.blocks.push({ kind: "svg", alt: (node.attrs["aria-label"] ?? "").trim() || (title ? textOf(title).replace(/\s+/g, " ").trim() : "") });
    } else if (HEADING.has(tag) || tag === "legend") {
      flush(false);
      children(node, style);
      flush(true);
    } else if (BLOCK.has(tag)) {
      flush(false);
      children(node, style);
      flush(false);
    } else children(node, STYLE[tag] ?? style);
  };

  const ids = new Set(all(root, CONTROLS).map(c => c.attrs.id).filter(Boolean));
  for (const label of all(root, new Set(["label"]))) {
    const target = label.attrs.for;
    if (target && ids.has(target) && !labelFor.has(target)) labelFor.set(target, label);
  }
  children(root);
  flush(false);
  // OMP adds an Other answer to a radio or checkbox group of two or more options that offers none of its own.
  for (const f of fields) if (f.kind === "choice" && !f.select && f.options.length >= 2) f.other = !f.options.some(o => /^\s*other\b/i.test(plain(o.label)));
  return { sections: sections.filter(s => s.blocks.length || s.title.length), fields };
}

function questionsHtml(questions) {
  // The older `questions` list of an ask call as the form OMP makes of it; null when it isn't one.
  const safe = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const sets = [];
  for (const [at, item] of questions.entries()) {
    if (!item || typeof item !== "object" || typeof item.question !== "string") return null;
    const name = safe(typeof item.id === "string" && item.id ? item.id : `q${at + 1}`), kind = item.multi === true ? "checkbox" : "radio", inputs = [];
    for (const [nth, option] of (Array.isArray(item.options) ? item.options : []).entries()) {
      const label = option && typeof option === "object" ? option.label : option;
      if (typeof label !== "string") return null;
      const about = option && typeof option === "object" && typeof option.description === "string" ? ` — ${safe(option.description)}` : "";
      inputs.push(`<label><input type="${kind}" name="${name}" value="${safe(label)}"${item.recommended === nth ? " checked" : ""}> ${safe(label)}${about}</label>`);
    }
    sets.push(`<fieldset><legend>${safe(item.question)}</legend>${inputs.join("") || `<textarea name="${name}"></textarea>`}</fieldset>`);
  }
  return `<form>${sets.join("")}</form>`;
}

export function askForm(ask) {
  // The form OMP shows for an ask call (the reader's `ask`: its `html`, or the older `questions` list), or null when it shows none: no form, or
  // none with a named field.
  const html = typeof ask?.html === "string" ? ask.html : Array.isArray(ask?.questions) && ask.questions.length ? questionsHtml(ask.questions) : null;
  const form = html == null ? null : parseForm(html);
  return form?.fields.some(f => f.name) ? form : null;
}
