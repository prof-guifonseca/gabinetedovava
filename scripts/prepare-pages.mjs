import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const clientDir = resolve(root, "dist/client");
const workerDir = resolve(root, "dist/gabinetedovava");
const workerFile = resolve(workerDir, "index.js");
const pagesDir = resolve(root, "dist/pages");
const legacyWorkerDir = resolve(root, "dist/camara_cyberpunk_2048");

if (!existsSync(clientDir)) {
  throw new Error("dist/client não encontrado. Rode `npm run build` primeiro.");
}
if (!existsSync(workerFile)) {
  throw new Error("dist/gabinetedovava/index.js não encontrado. Rode `npm run build` primeiro.");
}

// Clean legacy worker output directory if present so stale secrets/bundles never linger
if (existsSync(legacyWorkerDir)) {
  rmSync(legacyWorkerDir, { recursive: true, force: true });
}

// Never leave plaintext .dev.vars inside dist/
const workerDevVars = resolve(workerDir, ".dev.vars");
if (existsSync(workerDevVars)) {
  rmSync(workerDevVars, { force: true });
}

rmSync(pagesDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });
cpSync(clientDir, pagesDir, { recursive: true });

// Remove .assetsignore or stray .dev.vars if present
for (const unwanted of [".assetsignore", ".dev.vars"]) {
  const target = resolve(pagesDir, unwanted);
  if (existsSync(target)) {
    rmSync(target, { force: true });
  }
}

// Install compiled Worker bundle as Cloudflare Pages Advanced Mode `_worker.js`
cpSync(workerFile, resolve(pagesDir, "_worker.js"));

// Restrict Pages Function invocations strictly to /api/* so static assets bypass Worker execution
writeFileSync(
  resolve(pagesDir, "_routes.json"),
  JSON.stringify(
    {
      version: 1,
      include: ["/api/*"],
      exclude: [],
    },
    null,
    2
  ) + "\n"
);

console.log(
  "[prepare-pages] Pacote pronto em dist/pages/ (client + _worker.js + _routes.json + _headers)"
);
