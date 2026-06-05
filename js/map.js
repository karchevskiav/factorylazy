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
    const ore = x < this.START_W ? (map.ores[`${x},${y}`] || null)  // hand-authored start
                                  : this.procOre(map, x, y);
    if (ore) { const t = this.terrainType(map, x, y); if (t === 'sand' || t === 'water') return null; } // no resources on beaches or water
    return ore;
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

  // deterministic water (lakes) from coarse value-noise. Ore wins over water, and
  // the first few columns stay dry so spawn is always buildable. You can't build
  // on water (see GameState.free) — it renders as a textured patch like ore.
  // ---- elevation & terrain types ----
  // A continuous height field (fBm: several value-noise octaves) drives terrain by
  // band: below WATER_LVL is lake, then a SAND beach, then GRASS, then dry HIGHLAND.
  // Because bands follow the smooth contour, beaches aren't a square ring and new
  // terrain types are just new thresholds. The spawn region is nudged up to stay dry.
  WATER_LVL: 0.34, SAND_LVL: 0.46, DRYGRASS_LVL: 0.62, HIGHLAND_LVL: 0.72,
  elevation(map, x, y) {
    const s = map.seed;
    let e = 0.55 * this.vnoise(s ^ 0x1a1f, x, y, 16)
          + 0.30 * this.vnoise(s ^ 0x2b2e, x, y, 7)
          + 0.15 * this.vnoise(s ^ 0x3c3d, x, y, 3.3);
    if (x < this.START_W) e += (this.START_W - x) / this.START_W * 0.12;   // bias spawn to land
    return e;
  },
  // a coarse biome field: some mid-elevation regions are orange desert instead of grass
  isDesert(map, x, y) { return this.vnoise(map.seed ^ 0x5eed0d, x, y, 26) > 0.62; },
  terrainType(map, x, y) {
    if (!map || y < 0 || y >= map.height) return 'grass';
    const e = this.elevation(map, x, y);
    // bands: water → sand beach → grass → drygrass (intermediate) → highland
    let t = e < this.WATER_LVL ? 'water' : e < this.SAND_LVL ? 'sand'
          : e > this.HIGHLAND_LVL ? 'highland' : e > this.DRYGRASS_LVL ? 'drygrass' : 'grass';
    if (t === 'grass' && this.isDesert(map, x, y)) t = 'desert';  // occasional orange desert
    if (x < 6 && t === 'water') t = 'grass';                      // guarantee a dry start
    if (x < this.START_W && (t === 'highland' || t === 'drygrass' || t === 'desert')) t = 'grass';
    return t;
  },
  // terrain is purely elevation-driven — independent of the resource layer, so ore can
  // sit on any terrain (the ground under it shows through). Ore is suppressed on sand.
  waterAt(map, x, y)    { return !!map && x >= 0 && this.terrainType(map, x, y) === 'water'; },
  beachAt(map, x, y)    { return !!map && this.terrainType(map, x, y) === 'sand'; },
  drygrassAt(map, x, y) { return !!map && this.terrainType(map, x, y) === 'drygrass'; },
  desertAt(map, x, y)   { return !!map && this.terrainType(map, x, y) === 'desert'; },
  highlandAt(map, x, y) { return !!map && this.terrainType(map, x, y) === 'highland'; },

  // deterministic grass shade index (0..2) for subtle terrain variation
  grassShade(map, x, y) {
    const h = (x * 73856093) ^ (y * 19349663) ^ ((map?.seed || 0) | 0);
    return (h >>> 3) % 3;
  },

  // deterministic obstacle at a tile (or null): clustered forests + rare boulders.
  // Ore tiles stay clear so resource patches are always buildable. Returns
  // {kind:'tree'|'rock', variant} — `variant` indexes the sprite list in the renderer.
  obstacleAt(map, x, y) {
    if (!map || x < 0 || y < 0 || y >= map.height) return null;
    if (this.oreAt(map, x, y)) return null;
    if (this.terrainType(map, x, y) !== 'grass') return null;   // forests grow only on grass
    const seed = (map.seed || 0) | 0;
    const H = (a, b) => {
      let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    };
    const h = H(x, y);
    if (h % 100 < 2) return { kind: 'rock', variant: (h >>> 7) };           // ~2% boulders
    const fc = H(Math.floor(x / 5) * 7 + 1, Math.floor(y / 5) * 13 + 3);    // 5×5 forest clusters
    if (fc % 100 < 26 && (h >>> 3) % 100 < 42) return { kind: 'tree', variant: (h >>> 9) };  // sparser woods
    return null;
  },
};
