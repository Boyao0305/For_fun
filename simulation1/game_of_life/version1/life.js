"use strict";

// Sparse, unbounded Game of Life engine (B3/S23).
// Cells are stored as packed integer keys in a Set. Coordinates are limited
// to +/- 2^20 (a ~2-million-cell-wide universe) so keys fit exactly in a
// float64 without bit-precision loss.

const COORD_LIMIT = 1 << 20;          // 1,048,576
const SPAN = COORD_LIMIT * 2;         // 2,097,152

function packKey(x, y) {
  return (x + COORD_LIMIT) * SPAN + (y + COORD_LIMIT);
}

function unpackKey(key) {
  const x = Math.floor(key / SPAN) - COORD_LIMIT;
  const y = (key % SPAN) - COORD_LIMIT;
  return [x, y];
}

class LifeEngine {
  constructor() {
    this.cells = new Set();
    this.generation = 0;
  }

  get population() {
    return this.cells.size;
  }

  setCell(x, y, alive) {
    if (Math.abs(x) >= COORD_LIMIT || Math.abs(y) >= COORD_LIMIT) return;
    const key = packKey(x, y);
    if (alive) this.cells.add(key);
    else this.cells.delete(key);
  }

  getCell(x, y) {
    return this.cells.has(packKey(x, y));
  }

  toggleCell(x, y) {
    this.setCell(x, y, !this.getCell(x, y));
  }

  clear() {
    this.cells = new Set();
    this.generation = 0;
  }

  step() {
    const counts = new Map();
    for (const key of this.cells) {
      const [x, y] = unpackKey(key);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (Math.abs(nx) >= COORD_LIMIT || Math.abs(ny) >= COORD_LIMIT) continue;
          const nk = packKey(nx, ny);
          counts.set(nk, (counts.get(nk) || 0) + 1);
        }
      }
    }
    const next = new Set();
    for (const [key, n] of counts) {
      if (n === 3 || (n === 2 && this.cells.has(key))) next.add(key);
    }
    this.cells = next;
    this.generation++;
  }

  boundingBox() {
    if (this.cells.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const key of this.cells) {
      const [x, y] = unpackKey(key);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  cellList() {
    const out = [];
    for (const key of this.cells) out.push(unpackKey(key));
    return out;
  }

  // --- serialization -------------------------------------------------------

  serialize(name) {
    return {
      format: "life-state",
      version: 1,
      rule: "B3/S23",
      name: name || "untitled",
      savedAt: new Date().toISOString(),
      generation: this.generation,
      cells: this.cellList(),
    };
  }

  static deserialize(data) {
    if (!data || data.format !== "life-state" || !Array.isArray(data.cells)) {
      throw new Error("Not a valid life-state save");
    }
    const engine = new LifeEngine();
    engine.generation = Number.isInteger(data.generation) ? data.generation : 0;
    for (const cell of data.cells) {
      if (Array.isArray(cell) && cell.length === 2) {
        engine.setCell(cell[0] | 0, cell[1] | 0, true);
      }
    }
    return engine;
  }

  // --- initial conditions --------------------------------------------------

  placePattern(patternCells, originX, originY) {
    for (const [dx, dy] of patternCells) {
      this.setCell(originX + dx, originY + dy, true);
    }
  }

  randomSoup(width, height, density, rng) {
    const rand = rng || Math.random;
    const x0 = -Math.floor(width / 2);
    const y0 = -Math.floor(height / 2);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (rand() < density) this.setCell(x0 + x, y0 + y, true);
      }
    }
  }
}

// Patterns as [dx, dy] offsets from their top-left corner.
const PATTERNS = {
  glider: {
    label: "Glider",
    cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  },
  blinker: {
    label: "Blinker",
    cells: [[0, 0], [1, 0], [2, 0]],
  },
  rpentomino: {
    label: "R-pentomino",
    cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  },
  acorn: {
    label: "Acorn",
    cells: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
  },
  gosperGun: {
    label: "Gosper glider gun",
    cells: [
      [24, 0],
      [22, 1], [24, 1],
      [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
      [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
      [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
      [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
      [10, 6], [16, 6], [24, 6],
      [11, 7], [15, 7],
      [12, 8], [13, 8],
    ],
  },
  pulsar: {
    label: "Pulsar",
    cells: [
      [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
      [0, 2], [5, 2], [7, 2], [12, 2],
      [0, 3], [5, 3], [7, 3], [12, 3],
      [0, 4], [5, 4], [7, 4], [12, 4],
      [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
      [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
      [0, 8], [5, 8], [7, 8], [12, 8],
      [0, 9], [5, 9], [7, 9], [12, 9],
      [0, 10], [5, 10], [7, 10], [12, 10],
      [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
    ],
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LifeEngine, PATTERNS, packKey, unpackKey };
}
