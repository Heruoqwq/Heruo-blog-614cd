import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "../docs");
const target = path.join(root, "dist");
const origin = "https://tony-journal-heruo.prime-gleam-7947.chatgpt.site";
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
let changed = 0;
async function rewrite(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, file.name);
    if (file.isDirectory()) await rewrite(name);
    else if (file.name.endsWith(".js")) {
      const input = await readFile(name, "utf8");
      const count = input.split(origin).length - 1;
      if (count) {
        await writeFile(name, input.replaceAll(origin, ""));
        changed += count;
      }
    }
  }
}
await rewrite(target);
if (!changed) throw new Error("未找到原 API 地址；请核对 docs 前端构建，停止发布。");
await readFile(path.join(target, "index.html"), "utf8");
await writeFile(path.join(target, "build.json"), JSON.stringify({ revision: process.env.COMMIT_REF || "local", built_at: new Date().toISOString() }) + "\n");
console.log(`Mirror ready: ${changed} API origin replacement(s); requests use /api on this site.`);
