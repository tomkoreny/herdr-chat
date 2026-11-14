import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { stage, MOD } from "./stage.mjs";
const { HARNESSES, harnessFor, supportedNames, draftPastes, textOfBox, readBack } = await stage().load("harnesses/index.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const SHAPE = {
  id: v => typeof v === "string" && v.length > 0,
  label: v => typeof v === "string" && v.length > 0,
  images: v => ["mention", "paste", "path"].includes(v),
  mirror: v => typeof v === "boolean",
  prompt: v => v && typeof v === "object" && Object.keys(v).every(k => ["columns", "notes", "byNumber", "form"].includes(k)) && (v.form === undefined || v.form === "fields"),
  box: (v, h) => v === null ? h.mirror === false : Boolean(v && (v.style === "rules" || (v.style === "mark" && typeof v.mark === "string" && v.mark.length > 0))),
  skills: v => Boolean(v && Array.isArray(v.triggers) && v.triggers.length && typeof v.invoke === "string" && v.triggers.includes(v.invoke[0]) && Array.isArray(v.user) && Array.isArray(v.project) && Array.isArray(v.skip) && (v.commands === undefined || v.commands === true) && Object.keys(v).every(k => ["triggers", "invoke", "user", "project", "skip", "enterTwice", "commands"].includes(k))),
  status: v => v === undefined || Boolean(v && typeof v === "object" && Object.keys(v).length && Object.entries(v).every(([k, c]) => ["model", "effort"].includes(k) && typeof c === "string" && c.length > 0)),
  reader: v => typeof v === "string" && v.length > 0,
  live: v => v === undefined || (typeof v === "string" && /^[\w.-]+$/.test(v)),
};
for (const [app, h] of Object.entries(HARNESSES)) {
  check(`${app}: registered under its own id`, h.id, app);
  for (const [field, valid] of Object.entries(SHAPE)) check(`${app}: has a valid ${field}`, Boolean(valid(h[field], h)), true);
  check(`${app}: has no fields beyond the adapter shape`, Object.keys(h).filter(k => !(k in SHAPE)), []);
}
check("an unsupported app has no adapter", harnessFor("nope"), null);
check("the supported names read as one phrase", supportedNames(), "Claude Code, Codex, Pi, OpenCode or omp");

const paste = { images: "paste" }, mention = { images: "mention" }, path = { images: "path" };
check("a pasting harness gets the paths pasted ahead of the text", draftPastes(paste, ["/a.png"], "hi"), { pastes: ["/a.png", "hi"], pasted: "hi" });
check("a mentioning harness gets @paths", draftPastes(mention, ["/a b.png"], "hi").pasted, '@"/a b.png" hi');
check("pasted image placeholders are left out of the box's text", textOfBox(paste, "[Image #1] hi"), "hi");
const img = { file: "/a.png" }, mirror = { images: [img], paths: ["/a.png"], textBox: "", pasted: "" };
check("a path harness keeps the image whose path is still in its box", readBack(path, "/a.png hi", mirror), { text: "hi", kept: [img], foreign: false });

const ids = Object.keys(HARNESSES);
const literal = new RegExp(`["'](${ids.map(i => i.replace(/[-]/g, "\\-")).join("|")})["']`);
const ALLOWED = [/^harnesses\//, /^readers\/(?!common\.py$|main\.py$)/, /^vendor\//];
function files(dir) {
  // Every file under dir, as paths relative to the mod.
  return readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]);
}
for (const file of files(MOD).filter(f => /\.(js|py|ps1|sh)$/.test(f))) {
  const rel = relative(MOD, file);
  if (ALLOWED.some(r => r.test(rel))) continue;
  const hit = readFileSync(file, "utf8").split("\n").find(l => literal.test(l));
  check(`${rel} names no harness (harness behavior belongs in harnesses/)`, hit ?? null, null);
}

const readers = readdirSync(join(MOD, "readers")).filter(f => f.endsWith(".py")).map(f => readFileSync(join(MOD, "readers", f), "utf8")).join("\n");
const order = JSON.parse(readFileSync(join(MOD, "readers", "manifest.json"), "utf8"));
for (const h of Object.values(HARNESSES)) check(`${h.id}: its reader "${h.reader}" is registered in readers/`, readers.includes(`READERS["${h.reader}"] = `), true);
check("every reader file is in the manifest", readdirSync(join(MOD, "readers")).filter(f => f.endsWith(".py")).sort(), [...order].sort());
check("the manifest starts with common.py and ends with main.py", [order[0], order.at(-1)], ["common.py", "main.py"]);

process.exit(failed ? 1 : 0);
