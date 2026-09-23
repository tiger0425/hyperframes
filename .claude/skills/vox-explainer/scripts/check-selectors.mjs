import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2]);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));

let problems = 0;

function collectIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

function collectClasses(html) {
  const cls = new Set();
  for (const m of html.matchAll(/\sclass="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) cls.add(c);
  }
  return cls;
}

for (const f of files) {
  const html = fs.readFileSync(path.join(dir, f), "utf8");
  const ids = collectIds(html);
  const classes = collectClasses(html);
  const script = html.slice(html.indexOf("<script>"));
  const selectors = new Set();
  for (const m of script.matchAll(/(?:tl\.(?:to|from|fromTo|set)|gsap\.set)\(\s*"([^"]*)"/g)) {
    selectors.add(m[1]);
  }
  for (const m of script.matchAll(/querySelector(?:All)?\(\s*"([^"]*)"/g)) selectors.add(m[1]);
  for (const sel of selectors) {
    if (!sel) {
      console.log(`[EMPTY]      ${f}`);
      problems += 1;
      continue;
    }
    for (const part of sel.split(",").map((s) => s.trim())) {
      const idMatches = [...part.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      const classMatches = [...part.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      for (const id of idMatches) {
        if (!ids.has(id)) {
          console.log(`[MISSING id] ${f}  ${sel}  -> #${id}`);
          problems += 1;
        }
      }
      for (const c of classMatches) {
        if (!classes.has(c) && !["js-hide", "clip"].includes(c)) {
          console.log(`[MISSING cls]${f}  ${sel}  -> .${c}`);
          problems += 1;
        }
      }
    }
  }
}

console.log(problems === 0 ? "OK: all referenced selectors exist" : `PROBLEMS: ${problems}`);
