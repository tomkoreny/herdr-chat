import { mkdirSync, rmdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, copyFileSync, symlinkSync, truncateSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { stage } from "./stage.mjs";

const s = stage();
const { previewName, previewFile, keepSent, sentNames, staleSent, dropSent, imageSize, picturePath, pictureName } = await s.load("images.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 176, 0, 0, 4, 126, 8, 6, 0, 0, 0]);
const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 0x40, 0x01, 0xf0, 0x00, 0, 0, 0]);
// A JPEG whose size comes after another segment (APP0) and its table (DHT), in a start-of-frame segment: height first, then width.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc4, 0, 5, 9, 9, 9, 0xff, 0xc2, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 2, 3, 4]);
check("a picture's size is read from its PNG, GIF or JPEG header, and no size from anything else",
  [imageSize(png), imageSize(gif), imageSize(jpeg), imageSize(new Uint8Array([60, 115, 118, 103, 62])), imageSize(new Uint8Array([0xff, 0xd8, 0xff]))],
  [{ width: 1200, height: 1150 }, { width: 320, height: 240 }, { width: 800, height: 600 }, null, null]);
// WebP: an extended (VP8X) one 1201×901, a lossless (VP8L) one 320×240, a lossy (VP8 ) one 640×480.
const riff = (kind, rest) => new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, ...[...kind].map(c => c.charCodeAt(0)), 0, 0, 0, 0, ...rest, ...new Array(16).fill(0)]);
const lossless = ((320 - 1) | ((240 - 1) << 14)) >>> 0;
check("and from a WebP's, of each kind",
  [imageSize(riff("VP8X", [0, 0, 0, 0, 0xb0, 0x04, 0x00, 0x84, 0x03, 0x00])), imageSize(riff("VP8L", [0x2f, lossless & 255, (lossless >> 8) & 255, (lossless >> 16) & 255, lossless >>> 24])),
    imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01]))],
  [{ width: 1201, height: 901 }, { width: 320, height: 240 }, { width: 640, height: 480 }]);
check("a picture an agent shows is found from its session's folder, or where its path says; a web or inline one isn't a file",
  [picturePath("shots/a.png", "/home/tom/nixos2"), picturePath("./a.png", "/w/"), picturePath("../../tmp/b.png", "/home/tom/nixos2"), picturePath("/tmp/c.png", "/w"),
    picturePath("file:///tmp/my%20d.png", "/w"), picturePath(String.raw`C:\shots\e.png`, "/w"), picturePath("https://x.cz/f.png", "/w"), picturePath("data:image/png;base64,AA", "/w"), picturePath("g.png", "")],
  ["/home/tom/nixos2/shots/a.png", "/w/a.png", "/home/tom/nixos2/../../tmp/b.png", "/tmp/c.png", "/tmp/my d.png", String.raw`C:\shots\e.png`, null, null, null]);
check("a picture's copy is named for its machine, its path and what showed it, keeping its own name and type",
  [pictureName("/tmp/shots/01 form.png", "box", "r1").replace(/~\w+~/, "~#~"), pictureName("/tmp/a.png", null, "r1") === pictureName("/tmp/a.png", null, "r2"),
    pictureName("/tmp/a.png", null, "r1") === pictureName("/tmp/b/a.png", null, "r1"), pictureName("/tmp/a.png", null, "r1") === pictureName("/tmp/a.png", "box", "r1")],
  ["box~#~01-form.png", false, false, false]);

const placed = (t, name) => `/home/a/.local/state/herdr-core/default/files/${t}/${name}`;
check("a preview name says where the image was placed", previewName(placed("t4k", "same.png")), "local~t4k~same.png");
check("the same name in two terminals stays apart", previewName(placed("t4k", "same.png")) === previewName(placed("t4s", "same.png")), false);
check("the same terminal on two machines stays apart", previewName(placed("t7", "same.png"), "server") === previewName(placed("t7", "same.png")), false);
check("a Windows path and an odd machine name give a plain file name", previewName(String.raw`C:\Users\a\herdr-core\default\files\t7\x.png`, "my box/1"), "my-box-1~t7~x.png");

const cache = join(s.home, "cache", "herdr-chat"), sent = join(cache, "sent");
mkdirSync(cache, { recursive: true });
const a = join(cache, "a.png"), b = join(cache, "b.png");
writeFileSync(a, new Uint8Array([1, 2, 255])); writeFileSync(b, new Uint8Array([9]));
const kept = await keepSent([a, b], [placed("t4k", "same.png"), placed("t4s", "same.png")], null);
check("sent previews move under their placed names", kept, ["local~t4k~same.png", "local~t4s~same.png"]);
check("their bytes are kept, whole", [...readFileSync(join(sent, kept[0]))], [1, 2, 255]);
check("the originals are gone", [existsSync(a), existsSync(b)], [false, false]);

check("sent/ lists them", [...await sentNames()].sort(), ["local~t4k~same.png", "local~t4s~same.png"]);

const blocked = join(cache, "blocked.png");
writeFileSync(blocked, new Uint8Array([7]));
mkdirSync(join(sent, "local~t4b~same.png"));
check("a preview that isn't written whole isn't claimed, so it gets fetched instead", await keepSent([blocked], [placed("t4b", "same.png")], null), []);
rmdirSync(join(sent, "local~t4b~same.png"));

const on = new Set(["local~t4k~same.png", "local~t4s~big.png.jpg"]);
check("a preview is found under its name", previewFile(on, placed("t4k", "same.png")), "local~t4k~same.png");
check("or as the shrunk .jpg", previewFile(on, placed("t4s", "big.png")), "local~t4s~big.png.jpg");
check("or not at all", previewFile(on, placed("t9", "same.png")), null);

const names = ["local~t1~a.png", "local~gone~a.png", "local~t1~b.png.jpg", "box~t2~a.png", "box~gone~a.png", "down~t3~a.png", "down~t9~a.png", "removed~t1~a.png"];
const listing = { machines: [{ name: "box", state: "connected" }, { name: "down", state: "needs_login" }], terminals: [{ address: "t1" }, { address: "box/t2" }] };
check("only previews of terminals that are gone go; a machine that isn't connected keeps its own",
  staleSent(names, listing), ["local~gone~a.png", "box~gone~a.png", "removed~t1~a.png"]);
check("a failed listing deletes nothing", [staleSent(names, null), staleSent(names, { path: "/x" })], [[], []]);
check("a machine name with odd characters still matches", staleSent(["my-box-1~t1~a.png"], { machines: [{ name: "my box/1", state: "connected" }], terminals: [{ address: "my box/1/t1" }] }), []);
await dropSent(["local~t4k~same.png", "not-there.png"]);
check("dropping removes the file, and a missing one is fine", readdirSync(sent), ["local~t4s~same.png"]);

const real = stage();
writeFileSync(join(real.dir, "node_modules", "herdr", "index.js"), `import { execFile } from "child_process";
export const appHome = () => ${JSON.stringify(real.home)};
export const hc = async () => ({ code: 1, stdout: "" });
export const exec = (cmd, args) => new Promise(done => execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (e, stdout, stderr) => done({ code: e ? (e.code ?? 1) : 0, stdout, stderr })));`);
const live = await real.load("images.js");
mkdirSync(join(real.home, "cache", "herdr-chat"), { recursive: true });
mkdirSync(join(real.home, "mods", "herdr-chat"), { recursive: true });
copyFileSync(join(real.dir, "mod", "prepare-image.sh"), join(real.home, "mods", "herdr-chat", "prepare-image.sh"));
const away = join(real.dir, "herdr-core", "default", "files", "t7"), sentHere = join(real.home, "cache", "herdr-chat", "sent");
mkdirSync(away, { recursive: true });
const tiny = join(away, "tiny.png"), tinyBytes = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
writeFileSync(tiny, tinyBytes);
check("a small placed image is fetched as it is", await live.fetchSent(tiny, null), "local~t7~tiny.png");
check("byte for byte", [...readFileSync(join(sentHere, "local~t7~tiny.png"))], [...tinyBytes]);
check("a missing one gives nothing", await live.fetchSent(join(away, "gone.png"), null), null);
const fakeBin = join(real.dir, "bin"), elsewhere = join(away, "from-box.png");
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, "hc"), `#!/bin/sh\n[ "$1 $2 $3" = "exec --on box" ] || exit 9\nshift 3\nexec "$@"\n`, { mode: 0o755 });
const moreBytes = new Uint8Array(Array.from({ length: 2048 }, (_, i) => i % 256));
writeFileSync(elsewhere, moreBytes);
process.env.PATH = `${fakeBin}:${process.env.PATH}`;
check("one from another machine comes through hc exec", await live.fetchSent(elsewhere, "box"), "box~t7~from-box.png");
check("every byte intact, zero bytes and all", [...readFileSync(join(sentHere, "box~t7~from-box.png"))], [...moreBytes]);
check("one that isn't there leaves nothing behind", [await live.fetchSent(join(away, "gone2.png"), "box"), existsSync(join(sentHere, "box~t7~gone2.png"))], [null, false]);
const hasMagick = spawnSync("sh", ["-c", "command -v magick || command -v convert"]).status === 0;
if (hasMagick) {
  const big = join(away, "big.png");
  spawnSync(spawnSync("sh", ["-c", "command -v magick"]).status === 0 ? "magick" : "convert", ["-size", "900x700", "plasma:fractal", big]);
  const name = await live.fetchSent(big, null);
  check("a big one is shrunk to its .jpg name", name, "local~t7~big.png.jpg");
  check("under the size limit", statSync(join(sentHere, name)).size <= 250000, true);
  check("and it's a real JPEG", [...readFileSync(join(sentHere, name)).subarray(0, 2)], [255, 216]);
  check("no working copies stay behind", readdirSync(join(real.home, "cache", "herdr-chat")).sort(), ["sent"]);
  check("the bubble finds it", live.previewFile(new Set(await live.sentNames()), big, null), "local~t7~big.png.jpg");
}
// A picture a reply shows: fetching while it's copied, then ready with its size, from this machine or another; a missing one fails.
const shownPng = join(away, "shown.png"), shownBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
writeFileSync(shownPng, shownBytes);
const settled = async get => { for (let i = 0; i < 100 && get().state === "fetching"; i++) await new Promise(r => setTimeout(r, 30)); return get(); };
const before = live.picturesChanged();
const here = live.pictureFor("shown.png", away, null, "reply-1");
check("a picture starts out on its way", here.state, "fetching");
const hereDone = await settled(() => live.pictureFor("shown.png", away, null, "reply-1"));
check("then it's in pictures/, measured", [hereDone.state, hereDone.width, hereDone.height, hereDone.rel.startsWith("cache/herdr-chat/pictures/local~")], ["ready", 3, 2, true]);
check("byte for byte", [...readFileSync(join(real.home, hereDone.rel))], [...shownBytes]);
const boxDone = await settled(() => live.pictureFor(shownPng, "/elsewhere", "box", "reply-1"));
check("one on another machine comes through hc exec", [boxDone.state, boxDone.rel.includes("/box~")], ["ready", true]);
check("a missing one fails, and nothing is left of it", [(await settled(() => live.pictureFor("gone.png", away, null, "reply-1"))).state,
  readdirSync(join(real.home, "cache", "herdr-chat", "pictures")).length], ["failed", 2]);
check("a web picture isn't fetched", live.pictureFor("https://x.cz/a.png", away, null, "reply-1").state, "none");
check("each arrival is counted, so the view redraws", live.picturesChanged() - before, 3);
// Only a picture is ever copied: the checks run where the file is, so nothing else leaves its machine or reaches the cache.
const pictures = join(real.home, "cache", "herdr-chat", "pictures");
writeFileSync(join(away, "notes.png"), "secret = 1\n");
writeFileSync(join(away, "huge.png"), shownBytes);
truncateSync(join(away, "huge.png"), 21 * 1024 * 1024);
mkdirSync(join(away, "folder.png"));
symlinkSync(shownPng, join(away, "linked.png"));
// The device is /dev/null: a broken check copying it ends at once, where /dev/zero would fill the disk.
const refused = [];
for (const [src, machine] of [["notes.png", null], ["notes.png", "box"], ["/dev/null", null], ["/dev/null", "box"], ["huge.png", null], ["huge.png", "box"], ["folder.png", null]])
  refused.push((await settled(() => live.pictureFor(src, away, machine, "reply-2"))).state);
check("a file that isn't a picture, a device, one over 20 MB or a folder is refused, here and on another machine", refused, new Array(7).fill("failed"));
check("and leaves nothing in the cache", readdirSync(pictures).length, 2);
check("a link to a picture is followed", (await settled(() => live.pictureFor("linked.png", away, null, "reply-2"))).state, "ready");
real.cleanup();
s.cleanup();
process.exit(failed ? 1 : 0);
