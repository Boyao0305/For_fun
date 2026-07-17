"use strict";

// Seedable PRNG (mulberry32). Math.random() cannot be seeded, and the whole
// design depends on runs being reproducible from (seed, config) alone.

function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    getState: () => state,
    setState: (s) => { state = s >>> 0; },
  };
}

module.exports = { createRng };
