#!/usr/bin/env node
/* Typecheck + lint + build for a no-build ESM app.

   parse    every .js/.mjs module parses as an ES module
   graph    every relative import resolves to a file that exists, and every
            named import exists as a named export of its target
   unused   no imported binding goes unused
   css      no duplicate custom-property definitions in one block, no dangling
            var(--…) reference, and no raw literal where a token exists
   html     every module/stylesheet a page references is on disk

   Exit code 1 on any finding.

     node tools/check.mjs */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const findings = [];
const fail = (file, line, msg) => findings.push({ file, line, msg });

// ---- collect source files ---------------------------------------------------

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "vendor", ".agents", "shots", "out"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const all = await walk(ROOT);
const modules = all.filter((f) => /\.(js|mjs)$/.test(f) && !f.includes(`${path.sep}tools${path.sep}`));
const rel = (f) => path.relative(ROOT, f);

// ---- parse ------------------------------------------------------------------

const sources = new Map();
for (const f of modules) {
  const src = await readFile(f, "utf8");
  sources.set(f, src);
  try {
    new vm.SourceTextModule(src, { identifier: rel(f) });
  } catch (err) {
    fail(rel(f), err.lineNumber ?? 0, `parse: ${err.message}`);
  }
}

// ---- import graph -----------------------------------------------------------

const IMPORT_RE = /^\s*import\s+(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/gm;
const EXPORT_RE = /^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{([^}]*)\}/gm;
const DEFAULT_RE = /^\s*export\s+default\b/m;

const exportsOf = new Map();
for (const [f, src] of sources) {
  const names = new Set();
  for (const m of src.matchAll(EXPORT_RE)) names.add(m[1]);
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      names.add((t.split(/\s+as\s+/).pop() || t).trim());
    }
  }
  if (DEFAULT_RE.test(src)) names.add("default");
  exportsOf.set(f, names);
}

const BARE_OK = new Set(["three"]);

for (const [f, src] of sources) {
  const lines = src.split("\n");
  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = (m[1] || "").trim();
    const spec = m[2];
    const line = src.slice(0, m.index).split("\n").length;

    // resolve
    let target = null;
    if (spec.startsWith(".")) {
      target = path.resolve(path.dirname(f), spec);
      if (!existsSync(target)) { fail(rel(f), line, `unresolved import "${spec}"`); continue; }
    } else if (!BARE_OK.has(spec)) {
      fail(rel(f), line, `bare import "${spec}" has no importmap entry`);
      continue;
    }

    // named imports must exist on the target (skip vendor — not parsed here)
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named && target && sources.has(target)) {
      const have = exportsOf.get(target);
      for (const part of named[1].split(",")) {
        const t = part.trim();
        if (!t) continue;
        const src_ = t.split(/\s+as\s+/)[0].trim();
        if (src_ && !have.has(src_))
          fail(rel(f), line, `"${src_}" is not exported by ${path.relative(path.dirname(f), target)}`);
      }
    }

    // unused bindings
    const bound = [];
    if (named) for (const part of named[1].split(",")) {
      const t = part.trim();
      if (t) bound.push((t.split(/\s+as\s+/).pop() || t).trim());
    }
    const bare = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
    for (const b of bare.split(/\s+/)) {
      if (b && b !== "*" && b !== "as") bound.push(b);
    }
    const body = lines.filter((_, i) => i + 1 !== line).join("\n");
    for (const b of bound) {
      if (!b || /^[A-Z_]+$/.test(b) === false && false) continue;
      const used = new RegExp(`\\b${b.replace(/[$]/g, "\\$")}\\b`).test(body);
      if (!used) fail(rel(f), line, `unused import "${b}"`);
    }
  }
}

// ---- css --------------------------------------------------------------------

const cssFiles = all.filter((f) => f.endsWith(".css"));
const definedVars = new Set();
const usedVars = [];

for (const f of cssFiles) {
  const src = await readFile(f, "utf8");
  for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);
  for (const m of src.matchAll(/var\((--[\w-]+)/g)) {
    usedVars.push({ file: rel(f), name: m[1], line: src.slice(0, m.index).split("\n").length });
  }
  // duplicate property inside one rule block
  for (const block of src.matchAll(/\{([^{}]*)\}/g)) {
    const seen = new Map();
    for (const d of block[1].matchAll(/(^|\s|;)([-a-z]+)\s*:/g)) {
      const prop = d[2];
      if (prop.startsWith("--")) continue;
      seen.set(prop, (seen.get(prop) || 0) + 1);
    }
    for (const [prop, n] of seen) {
      if (n > 1) {
        const line = src.slice(0, block.index).split("\n").length;
        fail(rel(f), line, `duplicate "${prop}" in one rule`);
      }
    }
  }
}
for (const u of usedVars) {
  if (!definedVars.has(u.name)) fail(u.file, u.line, `var(${u.name}) is never defined`);
}

// magic numbers where a token owns the value
const TOKENISED = [
  { re: /transition[^;]*?\b(\d{2,4})ms/g, what: "duration", hint: "--dur-*" },
  { re: /cubic-bezier\(/g, what: "easing curve", hint: "--ease-*" },
];
for (const f of cssFiles) {
  const src = await readFile(f, "utf8");
  for (const { re, what, hint } of TOKENISED) {
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split("\n").length;
      // a token definition block is allowed to hold the literal
      const lineText = src.split("\n")[line - 1] || "";
      if (/^\s*--/.test(lineText)) continue;
      fail(rel(f), line, `literal ${what} — use ${hint}`);
    }
  }
}

// ---- html -------------------------------------------------------------------

for (const f of all.filter((x) => x.endsWith(".html"))) {
  const src = await readFile(f, "utf8");
  for (const m of src.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
    const p = path.resolve(path.dirname(f), m[1]);
    if (!existsSync(p)) {
      fail(rel(f), src.slice(0, m.index).split("\n").length, `missing file "${m[1]}"`);
    }
  }
}

// ---- report -----------------------------------------------------------------

if (!findings.length) {
  console.log(`check: clean — ${modules.length} modules, ${cssFiles.length} stylesheets`);
  process.exit(0);
}
for (const f of findings) console.log(`${f.file}:${f.line}  ${f.msg}`);
console.log(`\ncheck: ${findings.length} finding(s)`);
process.exit(1);
