// map.js — MapGen: procedural world generator.
// The world is infinite in width (any x ≥ 0) and HEIGHT tiles tall. Only the four
// starting ore patches are pre-seeded; everywhere else is buildable grass.
// A new seed each game ⇒ a new layout; the seed is stored in the save so the same
// map is regenerated deterministically on load.

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
  PATCH: 4,                 // ore patches are 4×4 tiles
  ORES: ['ironOre', 'coal', 'copperOre', 'stone'],

  // build a fresh map object. `ores` maps "x,y" -> resource key.
  generate(seed = Date.now()) {
    const r = rng(seed);
    const map = { seed, height: MAP_HEIGHT, ores: {} };

    // four 4×4 patches near spawn, in roughly evenly spaced columns with jitter,
    // random vertical offset, shuffled ore assignment — no overlap by construction.
    const ores = [...this.ORES];
    for (let i = ores.length - 1; i > 0; i--) {        // Fisher–Yates shuffle
      const j = Math.floor(r() * (i + 1));
      [ores[i], ores[j]] = [ores[j], ores[i]];
    }
    const cols = [3, 11, 19, 27];
    ores.forEach((ore, i) => {
      const x0 = cols[i] + Math.floor(r() * 3);                       // 0..2 jitter
      const y0 = Math.floor(r() * (MAP_HEIGHT - this.PATCH));         // fits vertically
      for (let dx = 0; dx < this.PATCH; dx++)
        for (let dy = 0; dy < this.PATCH; dy++)
          map.ores[`${x0 + dx},${y0 + dy}`] = ore;
    });
    return map;
  },

  oreAt(map, x, y) {
    if (!map) return null;
    return map.ores[`${x},${y}`] || null;
  },

  // deterministic grass shade index (0..2) for subtle terrain variation
  grassShade(map, x, y) {
    const h = (x * 73856093) ^ (y * 19349663) ^ ((map?.seed || 0) | 0);
    return (h >>> 3) % 3;
  },
};
