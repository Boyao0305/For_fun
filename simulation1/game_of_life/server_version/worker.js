"use strict";

// Persistent evaluation worker: receives { taskId, cells, config }, runs one
// soup to classification or maxGens, replies with { taskId, metrics }.

const { parentPort } = require("node:worker_threads");
const { LifeEngine } = require("../version1/life.js");
const { Classifier } = require("./classify.js");

function evaluate(cells, config) {
  const engine = new LifeEngine();
  for (const [x, y] of cells) engine.setCell(x, y, true);

  const startPop = engine.population;
  const classifier = new Classifier(config.classifier);
  const extentEvery = config.extentEvery || 256;

  let peakPop = startPop;
  let maxExtentW = 0;
  let maxExtentH = 0;
  let verdict = null;

  const trackExtent = () => {
    const bb = engine.boundingBox();
    if (bb) {
      if (bb.width > maxExtentW) maxExtentW = bb.width;
      if (bb.height > maxExtentH) maxExtentH = bb.height;
    }
  };
  trackExtent();

  const t0 = process.hrtime.bigint();
  let gen = 0;
  while (gen < config.maxGens) {
    engine.step();
    gen++;
    const pop = engine.population;
    if (pop > peakPop) peakPop = pop;
    if (gen % extentEvery === 0) trackExtent();
    verdict = classifier.observe(pop);
    if (verdict) break;
  }
  if (!verdict) verdict = classifier.timeoutVerdict(startPop, engine.population);
  trackExtent();
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  return {
    class: verdict.class,
    period: verdict.period,
    delta: verdict.delta,
    lifespan: verdict.lifespan,
    gensRun: gen,
    startPop,
    peakPop,
    finalPop: engine.population,
    extentW: maxExtentW,
    extentH: maxExtentH,
    elapsedMs,
  };
}

parentPort.on("message", ({ taskId, cells, config }) => {
  try {
    parentPort.postMessage({ taskId, metrics: evaluate(cells, config) });
  } catch (err) {
    parentPort.postMessage({ taskId, error: err.message });
  }
});
