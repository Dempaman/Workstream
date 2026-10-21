import { readFile, writeFile, mkdir } from "node:fs/promises";

// Pin the versions already verified in package-lock, without upgrading the dependency graph.
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const group of ["dependencies", "devDependencies"]) {
  for (const name of Object.keys(pkg[group])) {
    const version = lock.packages[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Missing installed version for ${name}`);
    pkg[group][name] = version;
    lock.packages[""][group][name] = version;
  }
}
pkg.description =
  "A local task-to-pull-request workspace with independent development and review agents.";
pkg.author = "Workstream";
delete pkg.build.win.signAndEditExecutable;
pkg.build.win.signExecutable = false;
pkg.build.win.icon = "build/icon.ico";
pkg.scripts["test:desktop"] = "node scripts/smoke.mjs";
pkg.scripts["test:live"] = "node scripts/live-smoke.mjs";
await writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
await writeFile("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

// A small code-native application mark, written as a standard 32-bit Windows icon.
await mkdir("build", { recursive: true });
const size = 256;
const pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const markX = x / 4;
    const markY = y / 4;
    let color = [248, 250, 255, 255];
    const cornerDistance = Math.hypot(
      Math.max(11 - markX, 0, markX - 52),
      Math.max(11 - markY, 0, markY - 52),
    );
    if (cornerDistance > 11) color = [0, 0, 0, 0];
    const bars = [
      { x: 16, top: 26, bottom: 46, color: [71, 107, 227, 255] },
      { x: 29, top: 17, bottom: 46, color: [115, 138, 240, 255] },
      { x: 42, top: 17, bottom: 39, color: [161, 177, 250, 255] },
    ];
    for (const bar of bars)
      if (
        markX >= bar.x &&
        markX < bar.x + 8 &&
        markY >= bar.top - (markX - bar.x) * 0.2 &&
        markY < bar.bottom - (markX - bar.x) * 0.2
      )
        color = bar.color;
    const i = ((size - y - 1) * size + x) * 4;
    pixels[i] = color[2];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[0];
    pixels[i + 3] = color[3];
  }
const mask = Buffer.alloc((size * size) / 8);
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(size, 4);
dib.writeInt32LE(size * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(pixels.length, 20);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(dib.length + pixels.length + mask.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("build/icon.ico", Buffer.concat([header, dib, pixels, mask]));
