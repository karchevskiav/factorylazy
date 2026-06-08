// map.js — MapGen: procedural world generator.
// The world is WIDTH tiles wide (x ∈ [0, WIDTH)) and INFINITE downward (any y ≥ 0):
// you start at the top and expand south. The four starting ore patches (one of every
// type) are pre-seeded near spawn as organic blobs; deeper down, ore is computed on
// demand from smooth value-noise, with rare resources (oil from screen 3, uranium from
// screen 5) joining the mix. A new seed each game ⇒ a new layout; only the seed is
// stored in the save, so the whole world is regenerated deterministically on load.

export const MAP_WIDTH = 40;

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
  WIDTH: MAP_WIDTH,
  ORES: ['ironOre', 'coal', 'copperOre', 'stone'],
  START_H: 40,              // rows [0, START_H) are the hand-authored starting region (the top)
  SCREEN: 40,               // one "screen" of rows downward; screen 1 = the starting region
  // ── war front (screens ABOVE the factory, y < 0) ───────────────────────────
  // Screen 0 ("war screen") = rows [-WAR_ROWS, 0): military buildings only.
  // Screen -1 = rows [-WAR_ROWS-BITER_ROWS, -WAR_ROWS): biter spawn zone, no building.
  WAR_ROWS: 26,
  BITER_ROWS: 16,
  wallRow() { return -this.WAR_ROWS; },                   // the defensive wall sits on this row
  topRow()  { return -this.WAR_ROWS - this.BITER_ROWS; }, // topmost biter spawn row
  zoneOf(y) { return y >= 0 ? 'factory' : y >= -this.WAR_ROWS ? 'war'
              : y >= -this.WAR_ROWS - this.BITER_ROWS ? 'biter' : 'void'; },
  OIL_SCREEN: 3,            // crude oil starts appearing from this screen down
  URANIUM_SCREEN: 5,        // uranium ore starts appearing from this screen down
  OIL_FRAC: 0.16,           // share of the type-noise band reserved for oil deposits
  URA_FRAC: 0.14,           // share reserved for uranium deposits
  OIL_DOTS: 0.18,           // within an oil region, fraction of tiles that are actual wells

  // build a fresh map object. `ores` holds ONLY the starting-region blobs as
  // "x,y" -> resource key; tiles below START_H are generated procedurally.
  generate(seed = Date.now()) {
    const r = rng(seed);
    const map = { seed, width: MAP_WIDTH, ores: {} };

    // one organic blob of every ore type, spread down the starting region (rows).
    const ores = [...this.ORES];
    for (let i = ores.length - 1; i > 0; i--) {        // Fisher–Yates shuffle
      const j = Math.floor(r() * (i + 1));
      [ores[i], ores[j]] = [ores[j], ores[i]];
    }
    const rows = [4, 13, 22, 31];
    ores.forEach((ore, i) => {
      const cy = rows[i] + Math.floor(r() * 3);                   // 0..2 jitter (depth)
      const cx = 2 + Math.floor(r() * (MAP_WIDTH - 4));           // keep off the side edges
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
      if (nx < 0 || nx >= MAP_WIDTH || ny < 0) continue;
      const key = nx + ',' + ny;
      if (seen.has(key) || out[key]) continue;          // don't grow over another ore
      place(nx, ny); tiles.push([nx, ny]);
    }
  },

  oreAt(map, x, y) {
    if (!map || x < 0 || x >= MAP_WIDTH || y < 0) return null;
    const ore = y < this.START_H ? (map.ores[`${x},${y}`] || null)  // hand-authored start
                                  : this.procOre(map, x, y);
    if (ore) { const t = this.terrainType(map, x, y); if (t === 'sand' || t === 'water') return null; } // no resources on beaches or water
    return ore;
  },

  // procedural ore for the open world: smooth value-noise thresholded into deposits.
  procOre(map, x, y) {
    const cell = 5;                                      // constant blob size — same everywhere
    const present = this.vnoise(map.seed ^ 0x9e3779b9, x, y, cell);
    if (present <= 0.85) return null;                    // constant density
    // a slower-varying field picks the type, so a deposit is mostly one ore
    const tv = this.vnoise(map.seed ^ 0x85ebca6b, x, y, cell * 2.5);
    const ore = this.pickOre(y, tv);
    // crude oil isn't a solid patch: only scattered wells dot its region, the rest is grass
    if (ore === 'crudeOil' && this.hash2(x, y, map.seed ^ 0x27d4eb2f) >= this.OIL_DOTS) return null;
    return ore;
  },

  // map the type-noise value to an ore. The top of the noise band is reserved for rare
  // resources once their screen (depth) is reached (uranium first, then oil); the rest
  // of the band is split among the basic ores.
  pickOre(y, tv) {
    const screen = Math.floor(y / this.SCREEN) + 1;     // 1-based screen index (depth)
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

  // ---- elevation & terrain types ----
  // A continuous height field (fBm) drives terrain by band: water → sand beach → grass →
  // drygrass (intermediate) → highland. Bands follow the smooth contour. The spawn rows
  // are nudged up so the top of the world stays dry/buildable.
  WATER_LVL: 0.34, SAND_LVL: 0.46, DRYGRASS_LVL: 0.62, HIGHLAND_LVL: 0.72,
  elevation(map, x, y) {
    const s = map.seed;
    let e = 0.55 * this.vnoise(s ^ 0x1a1f, x, y, 16)
          + 0.30 * this.vnoise(s ^ 0x2b2e, x, y, 7)
          + 0.15 * this.vnoise(s ^ 0x3c3d, x, y, 3.3);
    if (y < this.START_H) e += (this.START_H - y) / this.START_H * 0.12;   // bias spawn to land
    return e;
  },
  // a coarse biome field: some mid-elevation regions are orange desert instead of grass
  isDesert(map, x, y) { return this.vnoise(map.seed ^ 0x5eed0d, x, y, 26) > 0.62; },
  terrainType(map, x, y) {
    if (!map || x < 0 || x >= map.width) return 'grass';
    // war front (y<0): barren battlefield — defended ground is highland, the biter
    // zone beyond the wall is alien desert. No water/ore/trees up here.
    if (y < 0) return y < -this.WAR_ROWS ? 'desert' : 'highland';
    const e = this.elevation(map, x, y);
    let t = e < this.WATER_LVL ? 'water' : e < this.SAND_LVL ? 'sand'
          : e > this.HIGHLAND_LVL ? 'highland' : e > this.DRYGRASS_LVL ? 'drygrass' : 'grass';
    if (t === 'grass' && this.isDesert(map, x, y)) t = 'desert';  // occasional orange desert
    if (y < 6 && t === 'water') t = 'grass';                      // guarantee a dry start
    if (y < this.START_H && (t === 'highland' || t === 'drygrass' || t === 'desert')) t = 'grass';
    return t;
  },
  // terrain is purely elevation-driven — independent of the resource layer, so ore can
  // sit on any terrain (the ground under it shows through). Ore is suppressed on sand.
  waterAt(map, x, y)    { return !!map && y >= 0 && this.terrainType(map, x, y) === 'water'; },
  beachAt(map, x, y)    { return !!map && this.terrainType(map, x, y) === 'sand'; },
  drygrassAt(map, x, y) { return !!map && this.terrainType(map, x, y) === 'drygrass'; },
  desertAt(map, x, y)   { return !!map && this.terrainType(map, x, y) === 'desert'; },
  highlandAt(map, x, y) { return !!map && this.terrainType(map, x, y) === 'highland'; },

  // deterministic grass shade index (0..2) for subtle terrain variation
  grassShade(map, x, y) {
    const h = (x * 73856093) ^ (y * 19349663) ^ ((map?.seed || 0) | 0);
    return (h >>> 3) % 3;
  },

  // biome-appropriate vegetation. Returns {kind:'tree'|'rock', type, variant} where
  // `type` keys OBSTACLES (tree-grass / tree-drygrass / tree-desert / tree-highland / rock).
  // Trees match the biome; boulders appear in any land biome. None on water/sand.
  TREE_FOR: { grass: 'tree-grass', drygrass: 'tree-drygrass', desert: 'tree-desert', highland: 'tree-highland' },
  obstacleAt(map, x, y) {
    if (!map || x < 0 || x >= map.width || y < 0) return null;
    if (this.oreAt(map, x, y)) return null;
    const t = this.terrainType(map, x, y);
    if (t === 'water' || t === 'sand') return null;             // bare shore & water
    const seed = (map.seed || 0) | 0;
    const H = (a, b) => {
      let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    };
    const h = H(x, y);
    if (h % 100 < 2) return { kind: 'rock', type: 'rock', variant: (h >>> 7) };   // ~2% boulders, any biome
    const tree = this.TREE_FOR[t];
    if (!tree) return null;
    // grass has lush forests; drier biomes get sparser, scrubbier cover
    const [clThr, denThr] = t === 'grass' ? [26, 42] : t === 'highland' ? [16, 28] : [22, 34];
    const fc = H(Math.floor(x / 5) * 7 + 1, Math.floor(y / 5) * 13 + 3);    // 5×5 clusters
    if (fc % 100 < clThr && (h >>> 3) % 100 < denThr) return { kind: 'tree', type: tree, variant: (h >>> 9) };
    return null;
  },
};
