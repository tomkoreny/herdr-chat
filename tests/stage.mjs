import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

export const MOD = join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "herdr-chat");

export function stage() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-chat-test-"));
  const home = join(dir, "herdr-home");
  mkdirSync(home);
  const pkg = (name, source) => {
    mkdirSync(join(dir, "node_modules", name), { recursive: true });
    writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
    writeFileSync(join(dir, "node_modules", name, "index.js"), source);
  };
  writeFileSync(join(dir, "element.js"), `export const el = () => new Proxy(function () {}, {
  get: (_t, k) => k === "then" ? undefined : k === "when" ? (c, f) => (c ? f(el()) : el()) : () => el(),
  apply: () => el(),
});`);
  pkg("gpui-kit", `import { el } from "../../element.js";
export const div = () => el(), svg = () => el(), image = () => el(); export class View {}
export const Background = { linear_gradient: () => ({}), stop: () => ({}) };`);
  pkg("gpui-base", `import { el } from "../../element.js";
export const v_flex = () => el(), h_flex = () => el(), TextView = { markdown: () => el() };
export const TextareaState = { new: () => new Proxy({}, { get: (_t, k) => k === "value" ? () => "" : () => {} }) };
export const Textarea = { new: () => el() }, VirtualListScrollHandle = { new: () => ({}) }, v_virtual_list = () => el(), set_theme = () => {};`);
  pkg("herdr", `export const appHome = () => ${JSON.stringify(home)};
export const exec = async () => ({ code: 0, stdout: '{"box": ""}', stderr: "" });
export const hc = async () => ({ code: 0, stdout: '{"path":"/x/placed.png"}' });
export const run = () => {}, shared = () => null, setShared = () => {}, terminals = () => [], settings = () => ({});
export const focused = () => ({ tab: "tb", space: "sp", terminal: "t1" });
export const agents = () => [{ address: "t1", tab: "tb", space: "sp", app: "claude-code", status: "working", pane: "p1" }];
export const panes = () => [], props = () => ({}), home = () => "/home/u", watchFolder = () => new Promise(() => {}), readTextFile = async () => null;
export const theme = () => new Proxy({}, { get: () => "#888888" });`);
  cpSync(MOD, join(dir, "mod"), { recursive: true });
  return {
    dir, home,
    load: name => import(pathToFileURL(join(dir, "mod", name)).href),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
