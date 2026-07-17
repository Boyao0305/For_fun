"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { openWritable, openReadonly, packCells, unpackCells } = require("../storage.js");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok - " + msg);
  else { failures++; console.error("  FAIL - " + msg); }
}

const dbPath = path.join(os.tmpdir(), `gol-storage-test-${Date.now()}.db`);

console.log("cell packing round-trip");
{
  const cells = [[0, 0], [-15, 42], [1048575, -1048575]];
  const back = unpackCells(packCells(cells));
  assert(JSON.stringify(back) === JSON.stringify(cells), "identical after pack/unpack");
}

console.log("write and read back a run");
{
  const store = openWritable(dbPath);
  const runId = store.createRun("test-run", { objective: "lifespan", soup: "20x20" });
  const metrics = {
    class: "ash", period: 2, delta: 0, lifespan: 1103, gensRun: 1152,
    startPop: 5, peakPop: 319, finalPop: 116, extentW: 51, extentH: 39,
    elapsedMs: 12.5,
  };
  const simId = store.insertSim({
    runId, gen: 0, parentId: null, origin: "soup",
    cells: [[0, 0], [1, 1], [2, 2]], metrics, fitness: 1103, selected: false,
  });
  store.markSelected(simId);
  store.insertGeneration(runId, 0, simId, 1103, 1103, { evaluated: 1 });
  store.close();

  const ro = openReadonly(dbPath);
  const runs = ro.listRuns();
  assert(runs.length === 1 && runs[0].name === "test-run", "run listed");
  const gens = ro.listGenerations(runId);
  assert(gens.length === 1 && Number(gens[0].best_sim_id) === simId, "generation row");
  const sims = ro.listSims(runId, 0);
  assert(sims.length === 1 && sims[0].class === "ash", "sim listed by generation");
  assert(Number(sims[0].selected) === 1, "selected flag persisted");
  const sim = ro.getSim(simId);
  assert(sim.cells.length === 3 && sim.cells[2][0] === 2, "cells blob decoded");
  assert(Number(sim.lifespan) === 1103, "metrics persisted");
  assert(ro.maxSimId() === simId, "maxSimId");
  const after = ro.simsAfter(0, 10);
  assert(after.length === 1, "simsAfter tail");
  ro.close();
}

console.log("readonly connection cannot write");
{
  const ro = openReadonly(dbPath);
  let threw = false;
  try { ro.createRun("nope", {}); } catch { threw = true; }
  assert(threw, "write on readonly throws");
  ro.close();
}

fs.rmSync(dbPath, { force: true });
fs.rmSync(dbPath + "-wal", { force: true });
fs.rmSync(dbPath + "-shm", { force: true });

if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall storage tests passed");
