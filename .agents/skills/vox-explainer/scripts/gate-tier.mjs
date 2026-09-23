#!/usr/bin/env node
/**
 * gate-tier.mjs — 门禁的「产物存在性分档」共享判定。
 *
 * 【为什么需要它】本 effort（VOX 拼贴管线落地）给管线加了一批**新产物**：
 *   `tools/theme.json`（令牌源，issues/13）/ `tools/assemble-table.json`（装配表，issues/22）
 *   / `ledger.json`（接缝与材料账本，issues/20·23）。
 * 新门禁规则一旦无条件报 error，就会把 **4 部已交付项目判红** —— 它们是只读归档，没有这些产物。
 * 铁律（issues/01）：**缺新产物 → 只报 info，绝不判红。**
 *
 * ⇒ 所有新门禁规则**一律经本模块**决定级别，不要各自实现分档。
 *
 * 【规则作者用法】
 *   import { tierFor, resolveLevel } from "./gate-tier.mjs";
 *   const tier = tierFor(project);
 *   const d = resolveLevel(tier, ["theme"], "error");
 *   emit(d.level, "theme_token_drift", …);   // 产物齐备 → error；缺 → info（d.reason 说明）
 *
 * 【自证】
 *   node gate-tier.mjs --self-test
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 新产物：key → 相对项目根的路径。**这张表是唯一事实来源。** */
export const PRODUCTS = Object.freeze({
  theme: "tools/theme.json",
  assembleTable: "tools/assemble-table.json",
  ledger: "ledger.json", // 接缝账本（issues/20）
  material: ".media/manifest.jsonl", // 材料账本（issues/23）
});

/** 级别序：error > warning > info。 */
export const LEVELS = Object.freeze(["error", "warning", "info"]);

/** 探测项目里存在哪些新产物。 */
export function detectProducts(project) {
  const dir = resolve(project);
  const products = {};
  for (const [key, rel] of Object.entries(PRODUCTS)) {
    products[key] = existsSync(join(dir, rel));
  }
  return products;
}

/**
 * 项目分档。
 * @returns {{products: Record<string,boolean>, present: string[], missing: string[],
 *            tier: "legacy"|"partial"|"v2"}}
 *   legacy = 无任何新产物（4 部已交付项目即此档）；
 *   partial = 有部分；v2 = 全有。
 */
export function tierFor(project) {
  const products = detectProducts(project);
  const present = Object.keys(products).filter((k) => products[k]);
  const missing = Object.keys(products).filter((k) => !products[k]);
  const tier = missing.length === 0 ? "v2" : present.length === 0 ? "legacy" : "partial";
  return { products, present, missing, tier };
}

/**
 * 按产物存在性决定一条规则的级别。
 * @param tier tierFor() 的结果，或项目目录字符串
 * @param requires 该规则依赖的产物 key（全部齐备才 `applicable`）
 * @param level 产物齐备时规则的级别（默认 "error"）
 * @returns {{level: string, applicable: boolean, reason: string|null}}
 *   缺产物时降档为 "info" 并给出 `reason`；齐备时返回 `level` 与 `applicable:true`。
 */
export function resolveLevel(tier, requires = [], level = "error") {
  const t = typeof tier === "string" ? tierFor(tier) : tier;
  const missing = requires.filter((k) => !t.products[k]);
  if (missing.length === 0) return { level, applicable: true, reason: null };
  const names = missing.map((k) => PRODUCTS[k] ?? k).join(", ");
  return {
    level: "info",
    applicable: false,
    reason: `缺产物 ${names}（${t.tier} 项目，按分档只报 info）`,
  };
}

/** 自证：legacy / partial / v2 三档 + 降档方向 + 确定性。 */
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "gate-tier-"));
  const fails = [];
  const check = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    }
  };
  try {
    // ── legacy：空项目 → 全部缺失，规则降为 info
    const legacy = join(root, "legacy");
    mkdirSync(legacy, { recursive: true });
    check("legacy.tier", tierFor(legacy).tier, "legacy");
    check("legacy.present", tierFor(legacy).present, []);
    check("legacy.resolve", resolveLevel(tierFor(legacy), ["theme"], "error"), {
      level: "info",
      applicable: false,
      reason: `缺产物 ${PRODUCTS.theme}（legacy 项目，按分档只报 info）`,
    });

    // ── partial：只有 theme
    const partial = join(root, "partial");
    mkdirSync(join(partial, "tools"), { recursive: true });
    writeFileSync(join(partial, "tools", "theme.json"), "{}");
    check("partial.tier", tierFor(partial).tier, "partial");
    check("partial.present", tierFor(partial).present, ["theme"]);
    check("partial.resolve.theme", resolveLevel(tierFor(partial), ["theme"], "error"), {
      level: "error",
      applicable: true,
      reason: null,
    });
    check("partial.resolve.ledger", resolveLevel(tierFor(partial), ["ledger"], "warning"), {
      level: "info",
      applicable: false,
      reason: `缺产物 ${PRODUCTS.ledger}（partial 项目，按分档只报 info）`,
    });

    // ── v2：三者齐备 → 规则按原级别
    const v2 = join(root, "v2");
    for (const rel of Object.values(PRODUCTS)) {
      mkdirSync(dirname(join(v2, rel)), { recursive: true });
      writeFileSync(join(v2, rel), "{}");
    }
    check("v2.tier", tierFor(v2).tier, "v2");
    check("v2.missing", tierFor(v2).missing, []);
    check("v2.resolve", resolveLevel(tierFor(v2), ["theme", "assembleTable", "ledger"], "error"), {
      level: "error",
      applicable: true,
      reason: null,
    });

    // ── 确定性：同输入两次一致
    check("determinism", tierFor(v2), tierFor(v2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (fails.length) {
    console.error(`gate-tier self-test FAILED:\n  - ${fails.join("\n  - ")}`);
    return 1;
  }
  console.log("gate-tier self-test OK（legacy/partial/v2 · 降档双向 · 确定性）");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  console.log("usage: node gate-tier.mjs --self-test");
  process.exit(2);
}
