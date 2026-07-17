"use strict";

const { LifeEngine, PATTERNS } = require("../../version1/life.js");
const { Classifier } = require("../classify.js");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok - " + msg);
  else { failures++; console.error("  FAIL - " + msg); }
}

function classify(cells, maxGens) {
  const e = new LifeEngine();
  for (const [x, y] of cells) e.setCell(x, y, true);
  const c = new Classifier();
  let v = null, g = 0;
  while (g < maxGens) {
    e.step(); g++;
    v = c.observe(e.population);
    if (v) break;
  }
  if (!v) v = c.timeoutVerdict(cells.length, e.population);
  return { verdict: v, gensRun: g };
}

console.log("blinker -> ash");
{
  const { verdict } = classify(PATTERNS.blinker.cells, 5000);
  assert(verdict.class === "ash", `class ash (got ${verdict.class})`);
  assert(verdict.delta === 0, "delta 0");
}

console.log("gosper gun -> trivial-growth");
{
  const { verdict } = classify(PATTERNS.gosperGun.cells, 5000);
  assert(verdict.class === "trivial-growth", `class trivial-growth (got ${verdict.class})`);
  assert(verdict.period === 30 && verdict.delta === 5,
    `period 30 delta 5 (got T=${verdict.period} C=${verdict.delta})`);
}

console.log("lone pair -> died");
{
  const { verdict } = classify([[0, 0], [1, 0]], 100);
  assert(verdict.class === "died", `class died (got ${verdict.class})`);
  assert(verdict.lifespan === 1, `lifespan 1 (got ${verdict.lifespan})`);
}

console.log("r-pentomino -> ash after ~1100 gens");
{
  const { verdict, gensRun } = classify(PATTERNS.rpentomino.cells, 20000);
  assert(verdict.class === "ash", `class ash (got ${verdict.class})`);
  assert(gensRun > 1000 && gensRun < 2000,
    `settles near canonical 1103 (detected at gen ${gensRun})`);
}

console.log("acorn -> ash after ~5200 gens");
{
  const { verdict, gensRun } = classify(PATTERNS.acorn.cells, 20000);
  assert(verdict.class === "ash", `class ash (got ${verdict.class})`);
  assert(gensRun > 5000 && gensRun < 6000,
    `settles near canonical 5206 (detected at gen ${gensRun})`);
}

console.log("pulsar (period 3 oscillator) -> ash quickly");
{
  const { verdict, gensRun } = classify(PATTERNS.pulsar.cells, 5000);
  assert(verdict.class === "ash", `class ash (got ${verdict.class})`);
  assert(gensRun <= 128, `detected fast (gen ${gensRun})`);
}

if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall classify tests passed");
