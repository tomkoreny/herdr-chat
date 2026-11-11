import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { MOD } from "./stage.mjs";
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const read = f => readFileSync(join(MOD, f), "utf8");
const walk = dir => readdirSync(dir).flatMap(f => f === "vendor" ? [] : statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".js") ? [relative(MOD, join(dir, f))] : []);

const HOST = {
  "components/chat-list.js": [],
  "components/question-card.js": ["sending", "note", "key", "list.following", "list.follow"],
  "components/composer.js": ["sending", "note", "key", "list.following", "list.follow", "card.choices", "card.stillCurrent", "stop", "stopping"],
  "components/session-reader.js": ["card.read", "list.following", "list.follow"],
  "components/skill-menu.js": ["input", "keepDraft", "sendCommand"],
};
for (const [file, allowed] of Object.entries(HOST)) {
  const used = [...new Set([...read(file).matchAll(/this\.host\.(\w+)(?:\.(\w+))?/g)].map(m => {
    const top = m[1], sub = m[2];
    return ["list", "card", "composer", "reader"].includes(top) && sub ? `${top}.${sub}` : top;
  }))].sort();
  check(`${file} uses only its documented host API`, used.filter(u => !allowed.includes(u)), []);
}
for (const file of walk(MOD).filter(f => f.startsWith("components/"))) {
  check(`${file} has a host entry in this test`, file in HOST, true);
  check(`${file} doesn't reach into another component's fields`, read(file).match(/this\.(list|card|composer|reader)\.\w+/g) ?? [], []);
}
const mixins = [...read("main.js").matchAll(/Object\.assign\(HerdrChat\.prototype, (\w+)\)/g)].map(m => m[1]);
check("the view mixes in nothing", mixins, []);
for (const file of walk(MOD).filter(f => f.startsWith("model/")))
  check(`${file} is pure data (no gpui or herdr imports)`, read(file).match(/from "(gpui-kit|gpui-base|herdr)"/g) ?? [], []);
check("rows are drawn from (row, ctx), not from the view", /\bthis\./.test(read("ui/rows.js")), false);
for (const file of walk(MOD)) check(`${file} keeps state off other objects (no Object.assign onto this)`, /Object\.assign\(this,/.test(read(file)), false);
const methodsOf = file => new Set([...read(file).matchAll(/^  (?:async )?(\w+)\(.*\) \{$/gm)].map(m => m[1]));
const fieldsOf = file => new Set([...read(file).matchAll(/this\.(\w+)\s*(?:=[^=]|\?\?=)/g)].map(m => m[1]));
const COMPONENTS = { list: "components/chat-list.js", card: "components/question-card.js", composer: "components/composer.js", reader: "components/session-reader.js", menu: "components/skill-menu.js" };
for (const file of [...Object.values(COMPONENTS), "main.js"]) {
  const own = new Set([...methodsOf(file), ...fieldsOf(file)]);
  const called = [...read(file).matchAll(/\bthis\.(\w+)\(/g)].map(m => m[1]);
  check(`${file} calls only methods it has`, [...new Set(called.filter(n => !own.has(n)))], []);
  for (const [part, target] of Object.entries(COMPONENTS)) {
    const known = new Set([...methodsOf(target), ...fieldsOf(target)]);
    const through = [...read(file).matchAll(new RegExp(`this\\.(?:host\\.)?${part}\\.(\\w+)\\(`, "g"))].map(m => m[1]);
    check(`${file} calls only methods ${part} has`, [...new Set(through.filter(n => !known.has(n)))], []);
  }
}

const HERDR_FS = ["exists", "mkdir", "readdir", "readFile", "rmdir", "unlink", "writeFile"];
for (const file of walk(MOD)) {
  const named = [...read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*"fs\/promises"/g)].flatMap(m => m[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  check(`${file} imports only what herdr's fs/promises has`, named.filter(n => !HERDR_FS.includes(n)), []);
}

process.exit(failed ? 1 : 0);
