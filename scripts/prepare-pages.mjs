import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const clientDir = resolve(root, "dist/client");
const workerFile = resolve(root, "dist/gabinetedovava/index.js");
const pagesDir = resolve(root, "dist/pages");

if (!existsSync(clientDir)) {
  throw new Error("dist/client não encontrado. Rode `npm run build` primeiro.");
}
if (!existsSync(workerFile)) {
  throw new Error("dist/gabinetedovava/index.js não encontrado. Rode `npm run build` primeiro.");
}

rmSync(pagesDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });
cpSync(clientDir, pagesDir, { recursive: true });

// Remove .assetsignore if present so Cloudflare Pages serves all static files cleanly
const assetsIgnore = resolve(pagesDir, ".assetsignore");
if (existsSync(assetsIgnore)) {
  rmSync(assetsIgnore, { force: true });
}

// Install compiled Worker bundle as Cloudflare Pages Advanced Mode `_worker.js`
cpSync(workerFile, resolve(pagesDir, "_worker.js"));

console.log("[prepare-pages] Pacote pronto em dist/pages/ (client + _worker.js)");
