"use strict";

// Headless evolution harness: (1 + lambda) hill climbing over soups with
// mutation escalation and basin hopping. Writes everything to SQLite.
// Opens no network sockets — monitoring happens via monitor.js reading the db.
//
// Usage:
//   node evolve.js --name myrun [--objective lifespan] [--soup 64x64]
//     [--density 0.3] [--max-gens 20000] [--workers auto] [--lambda N]
//     [--rounds N] [--seed 12345] [--db runs.db]
//   node evolve.js --resume myrun [--db runs.db] [--rounds N]

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { createRng } = require("./prng.js");
const { openWritable } = require("./storage.js");

// ---------- config ----------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/);
    if (!m) continue;
    const key = m[1];
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}

const OBJECTIVES = {
  lifespan: (m) => m.lifespan,
  peak_pop: (m) => m.peakPop,
  lifespan_pop: (m) => m.lifespan * m.peakPop,
  // population growth per generation; trivial growth (guns/puffers) scores 0
  growth: (m) => m.class === "trivial-growth"
    ? 0
    : Math.max(0, (m.finalPop - m.startPop) / m.gensRun),
};

function buildConfig(args) {
  const soup = String(args.soup || "64x64").split("x").map(Number);
  const objective = args.objective || "lifespan";
  if (!OBJECTIVES[objective]) {
    throw new Error(`unknown objective "${objective}" (${Object.keys(OBJECTIVES).join(", ")})`);
  }
  const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  const workers = args.workers && args.workers !== "auto"
    ? Math.max(1, parseInt(args.workers, 10))
    : Math.max(1, cores - 1);
  return {
    objective,
    soupW: soup[0] || 64,
    soupH: soup[1] || 64,
    density: parseFloat(args.density || "0.3"),
    maxGens: parseInt(args["max-gens"] || "20000", 10),
    workers,
    lambda: parseInt(args.lambda || String(workers), 10),
    seed: parseInt(args.seed || String((Date.now() % 0xffffffff) >>> 0), 10),
    mutationLadder: [1, 4, 16, 64],
    patience: parseInt(args.patience || "10", 10), // failed rounds before escalating
    classifier: { maxPeriod: 120, repeats: 3, checkEvery: 64 },
    extentEvery: 256,
  };
}

// ---------- soup + mutation ----------

function randomSoup(rng, w, h, density) {
  const cells = [];
  const x0 = -Math.floor(w / 2);
  const y0 = -Math.floor(h / 2);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (rng.next() < density) cells.push([x0 + x, y0 + y]);
    }
  }
  return cells.length ? cells : [[0, 0]];
}

function mutate(rng, cells, flips) {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const margin = 2;
  const spanX = maxX - minX + 1 + margin * 2;
  const spanY = maxY - minY + 1 + margin * 2;
  for (let i = 0; i < flips; i++) {
    if (rng.next() < 0.5 && set.size > 1) {
      const keys = [...set];
      set.delete(keys[rng.int(keys.length)]);
    } else {
      const x = minX - margin + rng.int(spanX);
      const y = minY - margin + rng.int(spanY);
      const key = `${x},${y}`;
      if (set.has(key)) set.delete(key);
      else set.add(key);
    }
  }
  return [...set].map((k) => k.split(",").map(Number));
}

// ---------- worker pool ----------

class WorkerPool {
  constructor(size) {
    this.idle = [];
    this.pending = new Map(); // taskId -> {resolve, reject}
    this.queue = [];
    this.nextTaskId = 1;
    for (let i = 0; i < size; i++) {
      const w = new Worker(path.join(__dirname, "worker.js"));
      w.on("message", (msg) => {
        const p = this.pending.get(msg.taskId);
        this.pending.delete(msg.taskId);
        this.idle.push(w);
        this._drain();
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.metrics);
      });
      w.on("error", (err) => { console.error("worker crashed:", err); process.exit(1); });
      this.idle.push(w);
    }
  }

  evaluate(cells, config) {
    return new Promise((resolve, reject) => {
      const taskId = this.nextTaskId++;
      this.queue.push({ taskId, cells, config });
      this.pending.set(taskId, { resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const task = this.queue.shift();
      w.postMessage(task);
    }
  }

  async destroy() {
    const workers = new Set(this.idle);
    for (const w of workers) await w.terminate();
  }
}

// ---------- checkpointing ----------

function checkpointPath(name) {
  return path.join(__dirname, "checkpoints", `${name}.json`);
}

function writeCheckpoint(name, state) {
  const p = checkpointPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, p); // atomic: never leaves a half-written checkpoint
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);
  const dbPath = path.resolve(__dirname, args.db || "runs.db");
  const maxRounds = args.rounds ? parseInt(args.rounds, 10) : Infinity;

  let name, config, runId, round, rng, incumbent, alltime, failStreak, ladderIdx;
  const store = openWritable(dbPath);

  if (args.resume) {
    name = args.resume === true ? "run" : args.resume;
    const cp = JSON.parse(fs.readFileSync(checkpointPath(name), "utf8"));
    ({ config, runId, round, incumbent, alltime, failStreak, ladderIdx } = cp);
    rng = createRng(0);
    rng.setState(cp.rngState);
    console.log(`resuming "${name}" (run ${runId}) at round ${round}`);
  } else {
    name = args.name || `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
    config = buildConfig(args);
    rng = createRng(config.seed);
    runId = store.createRun(name, config);
    round = 0;
    incumbent = null;
    alltime = { fitness: -Infinity, simId: null };
    failStreak = 0;
    ladderIdx = 0;
    console.log(`run "${name}" (run ${runId}) — objective=${config.objective} ` +
      `soup=${config.soupW}x${config.soupH}@${config.density} workers=${config.workers} ` +
      `lambda=${config.lambda} seed=${config.seed}`);
  }

  const fitnessOf = OBJECTIVES[config.objective];
  const pool = new WorkerPool(config.workers);
  const evalConfig = {
    maxGens: config.maxGens,
    classifier: config.classifier,
    extentEvery: config.extentEvery,
  };

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("\nfinishing current round, then stopping (Ctrl+C again to force)");
  });

  const endRound = round + maxRounds;
  while (round < endRound && !stopping) {
    // --- build candidates ---
    const candidates = [];
    if (!incumbent) {
      for (let i = 0; i < config.lambda; i++) {
        candidates.push({ cells: randomSoup(rng, config.soupW, config.soupH, config.density), origin: "soup", parentId: null });
      }
    } else {
      const flips = config.mutationLadder[ladderIdx];
      for (let i = 0; i < config.lambda; i++) {
        candidates.push({ cells: mutate(rng, incumbent.cells, flips), origin: "mutation", parentId: incumbent.simId });
      }
    }

    // --- evaluate in parallel ---
    const t0 = Date.now();
    const results = await Promise.all(
      candidates.map((c) => pool.evaluate(c.cells, evalConfig))
    );
    const wallMs = Date.now() - t0;

    // --- record ---
    let best = null;
    const classCounts = {};
    let totalGens = 0;
    for (let i = 0; i < candidates.length; i++) {
      const metrics = results[i];
      const fitness = fitnessOf(metrics);
      const simId = store.insertSim({
        runId, gen: round, parentId: candidates[i].parentId,
        origin: candidates[i].origin, cells: candidates[i].cells,
        metrics, fitness, selected: false,
      });
      classCounts[metrics.class] = (classCounts[metrics.class] || 0) + 1;
      totalGens += metrics.gensRun;
      if (!best || fitness > best.fitness) {
        best = { simId, fitness, cells: candidates[i].cells, metrics };
      }
    }

    // --- select ---
    if (!incumbent || best.fitness > incumbent.fitness) {
      incumbent = { simId: best.simId, fitness: best.fitness, cells: best.cells };
      store.markSelected(best.simId);
      failStreak = 0;
      ladderIdx = 0;
    } else {
      failStreak++;
      if (failStreak >= config.patience) {
        failStreak = 0;
        if (ladderIdx < config.mutationLadder.length - 1) {
          ladderIdx++;
          console.log(`  stagnated -> mutation escalated to ${config.mutationLadder[ladderIdx]} flips`);
        } else {
          console.log("  ladder exhausted -> basin hop (fresh soup)");
          incumbent = null; // next round seeds fresh soups
          ladderIdx = 0;
        }
      }
    }
    if (best.fitness > alltime.fitness) {
      alltime = { fitness: best.fitness, simId: best.simId };
    }

    const gps = Math.round((totalGens / wallMs) * 1000);
    store.insertGeneration(runId, round, best.simId,
      incumbent ? incumbent.fitness : null, alltime.fitness, {
        classCounts, wallMs, totalGens, gps,
        mutationFlips: incumbent ? config.mutationLadder[ladderIdx] : "soup",
        failStreak,
      });

    writeCheckpoint(name, {
      config, runId, round: round + 1, rngState: rng.getState(),
      incumbent, alltime, failStreak, ladderIdx,
    });

    console.log(
      `[round ${round}] best=${best.fitness.toFixed(1)} (${best.metrics.class})` +
      ` incumbent=${incumbent ? incumbent.fitness.toFixed(1) : "-"}` +
      ` alltime=${alltime.fitness.toFixed(1)}` +
      ` | ${JSON.stringify(classCounts)} | ${(gps / 1000).toFixed(1)}k gens/s`
    );
    round++;
  }

  await pool.destroy();
  store.close();
  console.log(`stopped at round ${round}. resume with: node evolve.js --resume ${name}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
