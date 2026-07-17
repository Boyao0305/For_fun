"use strict";

// Classifies a simulation from its population history alone.
//
// Trivial growth (guns, puffers, escaped gliders) has an arithmetic
// signature: the population becomes eventually affine-periodic, i.e. there
// exist T and C with p(t+T) = p(t) + C for all large t. C = 0 additionally
// covers ash (still lifes + oscillators + escaped gliders at constant count).
//
// Classes:
//   died             population reached 0
//   ash              affine-periodic with C = 0 (stabilized)
//   trivial-growth   affine-periodic with C > 0 (gun/puffer-like)
//   aperiodic-growth hit maxGens still growing, never periodic (interesting!)
//   timeout          hit maxGens, no verdict

const DEFAULTS = {
  maxPeriod: 120,   // largest emission/oscillation period detectable
  repeats: 3,       // how many consecutive periods must confirm the relation
  checkEvery: 64,   // run the O(maxPeriod^2-ish) scan only every N generations
};

class Classifier {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.capacity = (this.opts.repeats + 1) * this.opts.maxPeriod + 1;
    this.history = [];
    this.gen = 0;
  }

  // Feed one generation's population. Returns a verdict object once
  // classification is possible, otherwise null.
  observe(pop) {
    this.gen++;
    this.history.push(pop);
    if (this.history.length > this.capacity * 2) {
      this.history = this.history.slice(-this.capacity);
    }

    if (pop === 0) {
      return { class: "died", period: 0, delta: 0, lifespan: this.gen };
    }

    if (this.gen % this.opts.checkEvery !== 0) return null;
    const h = this.history;
    const n = h.length;

    for (let T = 1; T <= this.opts.maxPeriod; T++) {
      const span = (this.opts.repeats + 1) * T;
      if (n < span + 1) break; // longer periods need more history than we have
      const C = h[n - 1] - h[n - 1 - T];
      let ok = true;
      for (let i = n - this.opts.repeats * T; i < n - 1; i++) {
        if (h[i] - h[i - T] !== C) { ok = false; break; }
      }
      if (ok) {
        if (C < 0) continue; // shrinking "periodicity" is transient noise
        return {
          class: C === 0 ? "ash" : "trivial-growth",
          period: T,
          delta: C,
          // the relation already held for repeats*T gens, so stabilization
          // began at or before this point (upper bound)
          lifespan: this.gen - this.opts.repeats * T,
        };
      }
    }
    return null;
  }

  // Called when maxGens is reached without a verdict.
  timeoutVerdict(startPop, finalPop) {
    const h = this.history;
    const w = Math.min(100, Math.floor(h.length / 2));
    let early = 0, late = 0;
    for (let i = 0; i < w; i++) {
      early += h[i];
      late += h[h.length - w + i];
    }
    const growing = late / w > Math.max(early / w, startPop) * 1.2 && finalPop > startPop;
    return {
      class: growing ? "aperiodic-growth" : "timeout",
      period: 0,
      delta: 0,
      lifespan: this.gen,
    };
  }
}

module.exports = { Classifier, CLASSIFIER_DEFAULTS: DEFAULTS };
