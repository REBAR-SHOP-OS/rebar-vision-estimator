#!/usr/bin/env node
// Fails CI when any single JS chunk in dist/assets exceeds the budget.
// Budgets are tuned to the post-split baseline (May 2026).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist/assets";
const BUDGETS = [
  { match: /^index-.*\.js$/, maxKB: 500, label: "main entry" },
  { match: /^pdf-.*\.js$/, maxKB: 1100, label: "pdf libs" },
  { match: /^excel-.*\.js$/, maxKB: 1100, label: "excel libs" },
  { match: /^radix-.*\.js$/, maxKB: 400, label: "radix" },
  { match: /.*\.js$/, maxKB: 600, label: "other chunk" },
];

let failed = 0;
for (const file of readdirSync(DIST).filter((f) => f.endsWith(".js"))) {
  const sizeKB = statSync(join(DIST, file)).size / 1024;
  const budget = BUDGETS.find((b) => b.match.test(file));
  if (!budget) continue;
  const ok = sizeKB <= budget.maxKB;
  const tag = ok ? "OK " : "FAIL";
  console.log(`${tag}  ${file.padEnd(50)} ${sizeKB.toFixed(1)} KB  (budget ${budget.maxKB} KB, ${budget.label})`);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`\n${failed} chunk(s) exceed budget.`);
  process.exit(1);
}