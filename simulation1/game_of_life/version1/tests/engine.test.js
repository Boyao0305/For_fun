"use strict";

const { LifeEngine, PATTERNS } = require("../life.js");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  ok - " + msg);
  } else {
    failures++;
    console.error("  FAIL - " + msg);
  }
}

console.log("blinker oscillates with period 2");
{
  const e = new LifeEngine();
  e.placePattern(PATTERNS.blinker.cells, 0, 0);
  assert(e.population === 3, "starts with 3 cells");
  e.step();
  assert(e.population === 3, "still 3 cells after step");
  assert(e.getCell(1, -1) && e.getCell(1, 0) && e.getCell(1, 1), "vertical phase");
  e.step();
  assert(e.getCell(0, 0) && e.getCell(1, 0) && e.getCell(2, 0), "back to horizontal");
}

console.log("block is a still life");
{
  const e = new LifeEngine();
  e.placePattern([[0, 0], [1, 0], [0, 1], [1, 1]], 5, 5);
  const before = JSON.stringify(e.cellList().sort());
  e.step();
  const after = JSON.stringify(e.cellList().sort());
  assert(before === after, "unchanged after step");
}

console.log("glider translates by (1,1) every 4 generations");
{
  const e = new LifeEngine();
  e.placePattern(PATTERNS.glider.cells, 0, 0);
  const start = e.cellList().map(([x, y]) => `${x},${y}`).sort().join(";");
  for (let i = 0; i < 4; i++) e.step();
  const moved = e.cellList().map(([x, y]) => `${x - 1},${y - 1}`).sort().join(";");
  assert(start === moved, "same shape shifted by (1,1)");
  assert(e.generation === 4, "generation counter is 4");
}

console.log("lone cell dies, empty world stays empty");
{
  const e = new LifeEngine();
  e.setCell(0, 0, true);
  e.step();
  assert(e.population === 0, "lone cell dies");
  e.step();
  assert(e.population === 0, "stays empty");
}

console.log("negative coordinates work");
{
  const e = new LifeEngine();
  e.placePattern(PATTERNS.blinker.cells, -1000, -2000);
  e.step();
  assert(e.population === 3, "blinker alive far in negative space");
  assert(e.getCell(-999, -2001), "correct oscillation position");
}

console.log("bounding box");
{
  const e = new LifeEngine();
  e.setCell(-5, 2, true);
  e.setCell(10, -7, true);
  const bb = e.boundingBox();
  assert(bb.width === 16 && bb.height === 10, `16x10 box (got ${bb.width}x${bb.height})`);
  assert(new LifeEngine().boundingBox() === null, "null when empty");
}

console.log("serialize / deserialize round-trip");
{
  const e = new LifeEngine();
  e.placePattern(PATTERNS.rpentomino.cells, 3, 4);
  for (let i = 0; i < 10; i++) e.step();
  const saved = e.serialize("test-run");
  const restored = LifeEngine.deserialize(JSON.parse(JSON.stringify(saved)));
  assert(restored.generation === e.generation, "generation restored");
  assert(restored.population === e.population, "population restored");
  restored.step();
  e.step();
  const a = e.cellList().map(String).sort().join(";");
  const b = restored.cellList().map(String).sort().join(";");
  assert(a === b, "identical evolution after restore");
  let threw = false;
  try { LifeEngine.deserialize({ foo: 1 }); } catch { threw = true; }
  assert(threw, "rejects invalid save data");
}

console.log("gosper gun grows without bound");
{
  const e = new LifeEngine();
  e.placePattern(PATTERNS.gosperGun.cells, 0, 0);
  const p0 = e.population;
  for (let i = 0; i < 120; i++) e.step();
  assert(e.population >= p0 + 20, `population grew from ${p0} to ${e.population}`);
  const bb = e.boundingBox();
  assert(bb.width > 40 || bb.height > 40, `bounding box expanded to ${bb.width}x${bb.height}`);
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
