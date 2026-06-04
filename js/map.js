// map.js — MapGen: procedural world generator.
// The world is infinite in width (any x ≥ 0) and HEIGHT tiles tall. The four
// starting ore patches (one of every type) are pre-seeded near spawn as organic
// blobs; everywhere past the starting screen, ore is computed on demand from
// smooth value-noise at a uniform density and blob size (same at any distance),
// with rare resources (oil from screen 3, uranium from screen 5) joining the mix.
// A new seed each game ⇒ a new layout; only the seed is stored in the save, so
// the whole world is regenerated deterministically on load. Ore is infinite —
// mining never depletes a tile, so no per-tile state needs persisting.

export const MAP_HEIGHT = 20;

// deterministic PRNG (mulberry32) — same seed ⇒ same sequence
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MapGen = {
  HEIGHT: MAP_HEIGHT,
  ORES: ['ironOre', 'coal', 'copperOre', 'stone'],
  START_W: 40,              // columns [0, START_W) are the hand-authored starting region
  SCREEN: 40,               // one "screen" of columns; screen 1 = the starting region
  OIL_SCREEN: 3,            // crude oil starts appearing from this screen out
  URANIUM_SCREEN: 5,        // uranium ore starts appearing from this screen out
  OIL_FRAC: 0.16,           // share of the type-noise band reserved for oil deposits
  URA_FRAC: 0.14,           // share reserved for uranium deposits
  OIL_DOTS: 0.18,           // within an oil region, fraction of tiles that are actual wells

  // build a fresh map object. `ores` holds ONLY the starting-region blobs as
  // "x,y" -> resource key; tiles beyond START_W are generated procedurally.
  generate(seed = Date.now()) {
    const r = rng(seed);
    const map = { seed, height: MAP_HEIGHT, ores: {} };

    // one organic blob of every ore type, in roughly evenly spaced columns.
    const ores = [...this.ORES];
    for (let i = ores.length - 1; i > 0; i--) {        // Fisher–Yates shuffle
      const j = Math.floor(r() * (i + 1));
      [ores[i], ores[j]] = [ores[j], ores[i]];
    }
    const cols = [4, 13, 22, 31];
    ores.forEach((ore, i) => {
      const cx = cols[i] + Math.floor(r() * 3);                   // 0..2 jitter
      const cy = 3 + Math.floor(r() * (MAP_HEIGHT - 6));          // keep off the edges
      this.growBlob(r, ore, cx, cy, 14 + Math.floor(r() * 6), map.ores);
    });
    return map;
  },

  // grow a connected, irregular blob of `n` tiles from a seed cell via random walk.
  growBlob(r, ore, x0, y0, n, out) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const seen = new Set();
    const place = (x, y) => { seen.add(x + ',' + y); out[x + ',' + y] = ore; };
    const tiles = [[x0, y0]]; place(x0, y0);
    let guard = 0;
    while (tiles.length < n && guard++ < n * 30) {
      const [bx, by] = tiles[Math.floor(r() * tiles.length)];
      const [dx, dy] = dirs[Math.floor(r() * 4)];
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || ny < 0 || ny >= MAP_HEIGHT) continue;
      const key = nx + ',' + ny;
      if (seen.has(key) || out[key]) continue;          // don't grow over another ore
      place(nx, ny); tiles.push([nx, ny]);
    }
  },

  oreAt(map, x, y) {
    if (!map || x < 0 || y < 0 || y >= MAP_HEIGHT) return null;
    if (x < this.START_W) return map.ores[`${x},${y}`] || null;   // hand-authored start
    return this.procOre(map, x, y);
  },

  // procedural ore for the open world: smooth value-noise thresholded so that,
  // the farther from spawn, the rarer ore is (rising threshold) and the larger
  // each deposit grows (coarser noise cell).
  procOre(map, x, y) {
    const cell = 5;                                      // constant blob size — same everywhere
    const present = this.vnoise(map.seed ^ 0x9e3779b9, x, y, cell);
    const thr = 0.85;                                    // constant density — ore doesn't thin out with distance
    if (present <= thr) return null;
    // a slower-varying field picks the type, so a deposit is mostly one ore
    const tv = this.vnoise(map.seed ^ 0x85ebca6b, x, y, cell * 2.5);
    const ore = this.pickOre(x, tv);
    // crude oil isn't a solid patch: only scattered wells dot its region, the rest is grass
    if (ore === 'crudeOil' && this.hash2(x, y, map.seed ^ 0x27d4eb2f) >= this.OIL_DOTS) return null;
    return ore;
  },

  // map the type-noise value to an ore. The top of the noise band is reserved for
  // rare resources once their screen is reached (uranium first, then oil), so each
  // forms coherent patches; the rest of the band is split among the basic ores.
  pickOre(x, tv) {
    const screen = Math.floor(x / this.SCREEN) + 1;     // 1-based screen index
    let hi = 1;                                          // shrinking band left for basics
    if (screen >= this.URANIUM_SCREEN) {
      if (tv >= hi - this.URA_FRAC) return 'uraniumOre';
      hi -= this.URA_FRAC;
    }
    if (screen >= this.OIL_SCREEN) {
      if (tv >= hi - this.OIL_FRAC) return 'crudeOil';
      hi -= this.OIL_FRAC;
    }
    const f = tv / hi;                                   // renormalise to the basics' band
    return this.ORES[Math.min(this.ORES.length - 1, Math.floor(f * this.ORES.length))];
  },

  // smooth value noise in [0,1] — hashed lattice corners, smoothstep-interpolated
  hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (s | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },
  vnoise(seed, x, y, cell) {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = this.hash2(x0, y0, seed),     v10 = this.hash2(x0 + 1, y0, seed);
    const v01 = this.hash2(x0, y0 + 1, seed), v11 = this.hash2(x0 + 1, y0 + 1, seed);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  },

  // deterministic grass shade index (0..2) for subtle terrain variation
  grassShade(map, x, y) {
    const h = (x * 73856093) ^ (y * 19349663) ^ ((map?.seed || 0) | 0);
    return (h >>> 3) % 3;
  },
};
