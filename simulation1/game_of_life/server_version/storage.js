"use strict";

// SQLite storage (built-in node:sqlite, Node >= 22.5 — no npm dependencies).
// Single writer: only evolve.js opens read-write. monitor.js opens readonly.
// WAL mode lets the monitor read while the harness writes.

const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
  run_id       INTEGER NOT NULL REFERENCES runs(id),
  gen          INTEGER NOT NULL,
  best_sim_id  INTEGER,
  incumbent_fitness REAL,
  alltime_fitness   REAL,
  stats_json   TEXT,
  PRIMARY KEY (run_id, gen)
);
CREATE TABLE IF NOT EXISTS sims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  gen           INTEGER NOT NULL,
  parent_id     INTEGER,
  origin        TEXT NOT NULL,       -- 'soup' | 'mutation' | 'basin-hop'
  initial_cells BLOB NOT NULL,       -- packed Int32 [x0,y0,x1,y1,...]
  class         TEXT NOT NULL,
  period        INTEGER NOT NULL,
  delta         INTEGER NOT NULL,
  lifespan      INTEGER NOT NULL,
  gens_run      INTEGER NOT NULL,
  start_pop     INTEGER NOT NULL,
  peak_pop      INTEGER NOT NULL,
  final_pop     INTEGER NOT NULL,
  extent_w      INTEGER NOT NULL,
  extent_h      INTEGER NOT NULL,
  fitness       REAL NOT NULL,
  selected      INTEGER NOT NULL DEFAULT 0,
  elapsed_ms    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sims_run_gen ON sims(run_id, gen);
CREATE INDEX IF NOT EXISTS idx_sims_fitness ON sims(run_id, fitness DESC);
`;

function packCells(cells) {
  const arr = new Int32Array(cells.length * 2);
  cells.forEach(([x, y], i) => { arr[i * 2] = x; arr[i * 2 + 1] = y; });
  return new Uint8Array(arr.buffer);
}

function unpackCells(blob) {
  const bytes = new Uint8Array(blob);
  const arr = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const cells = [];
  for (let i = 0; i < arr.length; i += 2) cells.push([arr[i], arr[i + 1]]);
  return cells;
}

function openWritable(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  return new Store(db);
}

function openReadonly(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  return new Store(db);
}

class Store {
  constructor(db) {
    this.db = db;
  }

  close() { this.db.close(); }

  // --- writes (harness only) ----------------------------------------------

  createRun(name, config) {
    const r = this.db.prepare(
      "INSERT INTO runs (name, started_at, config_json) VALUES (?, ?, ?)"
    ).run(name, new Date().toISOString(), JSON.stringify(config));
    return Number(r.lastInsertRowid);
  }

  insertSim(sim) {
    const r = this.db.prepare(`
      INSERT INTO sims (run_id, gen, parent_id, origin, initial_cells,
        class, period, delta, lifespan, gens_run, start_pop, peak_pop,
        final_pop, extent_w, extent_h, fitness, selected, elapsed_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sim.runId, sim.gen, sim.parentId, sim.origin, packCells(sim.cells),
      sim.metrics.class, sim.metrics.period, sim.metrics.delta,
      sim.metrics.lifespan, sim.metrics.gensRun, sim.metrics.startPop,
      sim.metrics.peakPop, sim.metrics.finalPop, sim.metrics.extentW,
      sim.metrics.extentH, sim.fitness, sim.selected ? 1 : 0,
      sim.metrics.elapsedMs
    );
    return Number(r.lastInsertRowid);
  }

  markSelected(simId) {
    this.db.prepare("UPDATE sims SET selected = 1 WHERE id = ?").run(simId);
  }

  insertGeneration(runId, gen, bestSimId, incumbentFitness, alltimeFitness, stats) {
    this.db.prepare(`
      INSERT OR REPLACE INTO generations
        (run_id, gen, best_sim_id, incumbent_fitness, alltime_fitness, stats_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, gen, bestSimId, incumbentFitness, alltimeFitness, JSON.stringify(stats));
  }

  // --- reads (monitor + resume) --------------------------------------------

  listRuns() {
    return this.db.prepare(
      "SELECT id, name, started_at, config_json FROM runs ORDER BY id DESC"
    ).all();
  }

  getRun(runId) {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  }

  listGenerations(runId) {
    return this.db.prepare(
      `SELECT gen, best_sim_id, incumbent_fitness, alltime_fitness, stats_json
       FROM generations WHERE run_id = ? ORDER BY gen`
    ).all(runId);
  }

  listSims(runId, gen) {
    return this.db.prepare(
      `SELECT id, gen, parent_id, origin, class, period, delta, lifespan,
              gens_run, start_pop, peak_pop, final_pop, extent_w, extent_h,
              fitness, selected, elapsed_ms
       FROM sims WHERE run_id = ? AND gen = ? ORDER BY fitness DESC`
    ).all(runId, gen);
  }

  getSim(simId) {
    const row = this.db.prepare("SELECT * FROM sims WHERE id = ?").get(simId);
    if (!row) return null;
    row.cells = unpackCells(row.initial_cells);
    delete row.initial_cells;
    return row;
  }

  topSims(runId, limit) {
    return this.db.prepare(
      `SELECT id, gen, class, lifespan, peak_pop, fitness
       FROM sims WHERE run_id = ? ORDER BY fitness DESC LIMIT ?`
    ).all(runId, limit);
  }

  simsAfter(lastId, limit) {
    return this.db.prepare(
      `SELECT id, run_id, gen, class, lifespan, peak_pop, final_pop, fitness, selected
       FROM sims WHERE id > ? ORDER BY id LIMIT ?`
    ).all(lastId, limit);
  }

  maxSimId() {
    const row = this.db.prepare("SELECT MAX(id) AS m FROM sims").get();
    return row && row.m ? Number(row.m) : 0;
  }
}

module.exports = { openWritable, openReadonly, packCells, unpackCells };
