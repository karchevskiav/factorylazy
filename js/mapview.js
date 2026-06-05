// mapview.js — canvas renderer + mouse interaction for the tile map.
// Terrain is drawn as coloured tiles; ores and buildings use the real Factorio
// PNG icons in assets/. Buildings are 2×2 entities placed on the grid.
import { GameState } from './gameState.js';
import { RESOURCES } from './data/resources.js';
import { BUILDINGS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { DECOR }     from './data/decor.js';
import { OBSTACLES } from './data/obstacles.js';
import { MapGen }    from './map.js';
import { I18N }      from './i18n.js';

const TILE = 42;
const GRASS = ['#3a4a2e', '#3f5031', '#445635'];

export const MapView = {
  canvas: null, ctx: null,
  camPx: 0,                 // horizontal camera offset in pixels
  place: null,              // building/generator type being placed, or null
  selected: null,          // selected entity, or null
  hover: { x: -99, y: -99, inside: false },
  drag: null,              // {startX, startCam} while panning
  imgs: {},                // path -> HTMLImageElement
  mining: false,           // hold-to-mine ore by hand
  mineRAF: null, mineLastTs: 0, mineAccum: 0,
  MINE_RATE: 5,            // ore mined per second by hand

  init() {
    this.canvas = document.getElementById('map-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.preload();
    this.bind();
  },

  terr: {},                 // terrain texture cache (grass + ore-on-ground sprites)
  preload() {
    const add = (p) => { if (p && !this.imgs[p]) { const im = new Image(); im.src = p; this.imgs[p] = im; } };
    for (const k in RESOURCES) add(RESOURCES[k].img);
    for (const k in BUILDINGS) add(BUILDINGS[k].img);
    for (const k in POWER)     add(POWER[k].img);
    const addT = (key) => { const im = new Image(); im.src = 'assets/terrain/' + key + '.png'; this.terr[key] = im; };
    for (const t of ['grass', 'water', 'sand', 'highland', 'drygrass', 'desert']) addT(t + '-atlas');
    for (const o of ['ironOre', 'copperOre', 'coal', 'stone', 'uraniumOre', 'crudeOil'])
      for (let i = 0; i < 4; i++) addT('ore-' + o + '-' + i);
    for (const d of DECOR) add(d.src);
    for (const k in OBSTACLES) for (const sp of OBSTACLES[k].sprites) add(sp.src);
  },
  decorHash(x, y) {
    let h = (x * 374761393) ^ (y * 668265263) ^ ((GameState.state.map.seed || 0) | 0);
    h = (h ^ (h >>> 13)) >>> 0;
    return h;
  },
  drawn(im, sx, sy, sz) {
    if (im && im.complete && im.naturalWidth) { this.ctx.drawImage(im, sx, sy, sz, sz); return true; }
    return false;
  },
  // Draw a terrain tile by sampling the type's seamless atlas at world cell (x,y). Adjacent
  // world tiles map to adjacent atlas cells, so the surface is continuous (no per-tile seam)
  // and only repeats every N tiles — and the directional texture is never rotated.
  atlasCell(type, x, y) {
    const a = this.terr[type + '-atlas'];
    if (!a || !a.complete || !a.naturalWidth) return null;
    const N = a.naturalWidth / 64;
    return { a, N, cx: ((x % N) + N) % N, cy: ((y % N) + N) % N };
  },
  tileWorld(type, x, y, sx, sy) {
    const t = this.atlasCell(type, x, y);
    if (!t) return false;
    this.ctx.drawImage(t.a, t.cx * 64, t.cy * 64, 64, 64, sx, sy, TILE, TILE);
    return true;
  },

  // a cached atlas cell faded out from one edge/corner, used to bleed a neighbouring terrain
  // type softly across a boundary. Keyed by the neighbour's atlas cell so the blend matches.
  fades: {},
  fadeTile(type, x, y, dir) {
    const t = this.atlasCell(type, x, y);
    if (!t) return null;
    const key = type + t.cx + '_' + t.cy + dir;
    if (this.fades[key]) return this.fades[key];
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    const g = c.getContext('2d'); g.drawImage(t.a, t.cx * 64, t.cy * 64, 64, 64, 0, 0, TILE, TILE);
    const F = 0.78 * TILE, T = TILE;
    // edges fade linearly from one side; corners fade radially from one corner so the
    // blend wraps the corners too (otherwise un-blended corners read as crosses/stripes).
    const grad =
        dir === 'N'  ? g.createLinearGradient(0, 0, 0, F)
      : dir === 'S'  ? g.createLinearGradient(0, T, 0, T - F)
      : dir === 'W'  ? g.createLinearGradient(0, 0, F, 0)
      : dir === 'E'  ? g.createLinearGradient(T, 0, T - F, 0)
      : dir === 'NW' ? g.createRadialGradient(0, 0, 0, 0, 0, F)
      : dir === 'NE' ? g.createRadialGradient(T, 0, 0, T, 0, F)
      : dir === 'SW' ? g.createRadialGradient(0, T, 0, 0, T, F)
      :                g.createRadialGradient(T, T, 0, T, T, F);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grad; g.fillRect(0, 0, TILE, TILE);
    this.fades[key] = c; return c;
  },
  oreVariant(x, y) {
    const h = (x * 92837) ^ (y * 689287) ^ ((GameState.state.map.seed || 0) | 0);
    return (h >>> 4 & 0xffff) % 4;
  },

  resize() {
    if (!this.canvas) return;
    const wrap = this.canvas.parentElement;
    this.canvas.width  = Math.max(320, wrap.clientWidth);
    this.canvas.height = MapGen.HEIGHT * TILE;
    this.render();
  },

  bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      const t = this.toTile(e); const ent = this.entityAt(t.x, t.y);
      // left-click on bare ore (no entity, not placing) ⇒ hand-mine while held (not oil)
      if (e.button === 0 && this.place === null && !ent && this.handMineable(t.x, t.y)) {
        this.startMining(); return;
      }
      if (e.button === 1 || (e.button === 0 && this.place === null && !ent)) {
        this.drag = { startX: e.clientX, startCam: this.camPx }; this.dragMoved = false;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.drag) {
        if (Math.abs(e.clientX - this.drag.startX) > 3) this.dragMoved = true;
        this.camPx = Math.max(0, this.drag.startCam - (e.clientX - this.drag.startX)); this.render(); return;
      }
    });
    window.addEventListener('mouseup', () => { this.drag = null; this.stopMining(); });
    c.addEventListener('mousemove', (e) => {
      const t = this.toTile(e); this.hover = { x: t.x, y: t.y, inside: true }; this.render();
    });
    c.addEventListener('mouseleave', () => { this.hover.inside = false; this.render(); });
    c.addEventListener('click', (e) => {
      if (this.dragMoved) { this.dragMoved = false; return; }   // ignore the click that ends a pan
      const t = this.toTile(e);
      if (this.place) this.tryPlace(t.x, t.y);
      else if (GameState.obstacleAt(t.x, t.y)) this.clearObstacle(t.x, t.y);
      else this.selectAt(t.x, t.y);
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = this.toTile(e); const ent = this.entityAt(t.x, t.y);
      if (ent) this.remove(ent);
      else this.place = null;          // right-click also cancels placement
      this.render();
    });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.camPx = Math.max(0, this.camPx + e.deltaY); this.render(); }, { passive: false });
  },

  /* ---------- coordinate helpers ---------- */
  toTile(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left + this.camPx) / TILE),
             y: Math.floor((e.clientY - r.top) / TILE) };
  },
  entityAt(x, y) {
    return GameState.state.entities.find(en => {
      const d = GameState.def(en.type), w = d.w || 2, h = d.h || 2;
      return x >= en.x && x < en.x + w && y >= en.y && y < en.y + h;
    }) || null;
  },

  /* ---------- placement / selection ---------- */
  setPlace(type) { this.place = type; this.selected = null; window.UI.hideInspector(); this.render(); },

  oreUnder(x, y) {           // any drill-mineable ore under the 2×2 footprint (not oil)
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      const o = MapGen.oreAt(GameState.state.map, x + dx, y + dy);
      if (o && o !== 'crudeOil') return o;
    }
    return null;
  },

  oresUnder(x, y) {          // every distinct drill-mineable ore under the footprint
    const out = [];
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      const o = MapGen.oreAt(GameState.state.map, x + dx, y + dy);
      if (o && o !== 'crudeOil' && !out.includes(o)) out.push(o);
    }
    return out;
  },

  oilUnder(x, y) {           // true if any crude-oil tile is under the 2×2 footprint
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      if (MapGen.oreAt(GameState.state.map, x + dx, y + dy) === 'crudeOil') return true;
    }
    return false;
  },

  valid(type, x, y) {
    if (!GameState.free(x, y, 2, 2)) return false;
    const def = GameState.def(type);
    if (def.place === 'ore') return !!this.oreUnder(x, y);
    if (def.place === 'oil') return this.oilUnder(x, y);
    return true;
  },

  costOf(type, owned) {
    return POWER[type] ? window.UI.powerCost(type, owned) : window.UI.buildingCost(type, owned);
  },

  tryPlace(x, y) {
    const type = this.place, def = GameState.def(type);
    if (!def) return;
    if ((BUILDINGS[type] && !GameState.isBuildingUnlocked(type)) || (POWER[type] && !GameState.isPowerUnlocked(type)))
      return window.UI.toast(I18N.t('toast_locked'));
    if (!this.valid(type, x, y))
      return window.UI.toast(I18N.t(def.place === 'ore' ? 'toast_drill_ore'
        : def.place === 'oil' ? 'toast_pump_oil' : 'toast_blocked'));
    const cost = this.costOf(type, GameState.placedOf(type));
    if (!window.UI.canAfford(cost)) return window.UI.toast(I18N.t('toast_no_res'));
    window.UI.pay(cost);

    let recipe = null;
    if (def.place === 'ore')      recipe = this.oreUnder(x, y);          // drill ⇒ ore beneath
    else if (def.recipes && def.recipes.length) recipe = def.recipes[0]; // default recipe
    GameState.state.entities.push({ id: GameState.nextId++, type, x, y, recipe, modules: [], _progress: 0 });
    window.UI.renderDynamic();
    this.render();
  },

  selectAt(x, y) {
    const ent = this.entityAt(x, y);
    this.selected = ent;
    if (ent) window.UI.showInspector(ent); else window.UI.hideInspector();
    this.render();
  },

  remove(ent) {
    const a = GameState.state.entities;
    a.splice(a.indexOf(ent), 1);
    if (this.selected === ent) { this.selected = null; window.UI.hideInspector(); }
    window.UI.renderDynamic();
  },

  /* ---------- hand mining (hold to mine ore) ---------- */
  startMining() {
    if (this.mining) return;
    this.mining = true;
    this.mineLastTs = performance.now();
    this.mineAccum = 0;
    this.mineOre(this.hover.x, this.hover.y, 1);      // instant feedback on the initial click
    const loop = (ts) => {
      if (!this.mining) return;
      const dt = Math.min(0.25, (ts - this.mineLastTs) / 1000);
      this.mineLastTs = ts;
      if (this.hover.inside) {
        this.mineAccum += dt * this.MINE_RATE;
        const whole = Math.floor(this.mineAccum);
        if (whole >= 1) { this.mineAccum -= whole; this.mineOre(this.hover.x, this.hover.y, whole); }
      }
      this.render();
      this.mineRAF = requestAnimationFrame(loop);
    };
    this.mineRAF = requestAnimationFrame(loop);
  },
  handMineable(x, y) {       // ore you can dig by hand — anything but crude oil
    const o = MapGen.oreAt(GameState.state.map, x, y);
    return !!o && o !== 'crudeOil';
  },
  mineOre(x, y, n) {
    const ore = MapGen.oreAt(GameState.state.map, x, y);
    if (!ore || ore === 'crudeOil') return;
    const s = GameState.state;
    s.resources[ore] = (s.resources[ore] || 0) + n;
    s.totals.produced[ore] = (s.totals.produced[ore] || 0) + n;
    window.UI.renderDynamic();
  },
  stopMining() {
    if (!this.mining) return;
    this.mining = false;
    if (this.mineRAF) cancelAnimationFrame(this.mineRAF);
    this.mineRAF = null;
    this.render();
  },

  /* ---------- rendering ---------- */
  sprite(path, sx, sy, size) {
    const im = this.imgs[path];
    if (im && im.complete && im.naturalWidth) this.ctx.drawImage(im, sx, sy, size, size);
    return im && im.complete && im.naturalWidth;
  },

  // draw a tree/boulder anchored at the bottom-centre of its tile (trees overhang up).
  // A single pixels→tile scale per kind is applied to BOTH dimensions, so every sprite
  // keeps its true aspect ratio and species differ in size naturally (no stretching).
  OB_SCALE: { tree: 1 / 155, rock: 1 / 150 },   // tiles per source pixel
  drawObstacle(x, y) {
    const ob = GameState.obstacleAt(x, y); if (!ob) return;
    const def = OBSTACLES[ob.kind]; const sp = def.sprites[ob.variant % def.sprites.length];
    const im = this.imgs[sp.src]; if (!im || !im.complete || !im.naturalWidth) return;
    const k = TILE * (this.OB_SCALE[ob.kind] || 1 / 150);
    const w = sp.w * k, h = sp.h * k;
    const dx = x * TILE - this.camPx + (TILE - w) / 2, dy = y * TILE + TILE - h;
    this.ctx.drawImage(im, dx, dy, w, h);
  },

  // grant a cleared obstacle's yield and mark its tile cleared
  clearObstacle(x, y) {
    const ob = GameState.obstacleAt(x, y); if (!ob) return;
    GameState.state.cleared[x + ',' + y] = 1;
    const def = OBSTACLES[ob.kind], s = GameState.state;
    const parts = [];
    for (const r in def.yield) {
      s.resources[r] = (s.resources[r] || 0) + def.yield[r];
      s.totals.produced[r] = (s.totals.produced[r] || 0) + def.yield[r];
      parts.push(`+${def.yield[r]} ${window.UI.rn(r)}`);
    }
    window.UI.toast(I18N.t('toast_cleared', I18N.t('obstacle_' + ob.kind), parts.join(', ')));
    window.UI.renderDynamic(); this.render();
  },

  render() {
    const ctx = this.ctx; if (!ctx) return;
    const s = GameState.state; if (!s || !s.map) return;
    const W = this.canvas.width, H = this.canvas.height;
    const c0 = Math.floor(this.camPx / TILE), c1 = c0 + Math.ceil(W / TILE) + 1;

    // terrain pass: world-sampled seamless textures, sparse decoratives on plain grass
    for (let x = c0; x < c1; x++) {
      for (let y = 0; y < s.map.height; y++) {
        const sx = x * TILE - this.camPx, sy = y * TILE;
        if (MapGen.waterAt(s.map, x, y)) {                       // lakes
          if (!this.tileWorld('water', x, y, sx, sy)) { ctx.fillStyle = '#1c5a72'; ctx.fillRect(sx, sy, TILE, TILE); }
          continue;                                              // no decor on water
        }
        if (MapGen.beachAt(s.map, x, y)) {                       // sandy beach following the shore contour
          if (!this.tileWorld('sand', x, y, sx, sy)) { ctx.fillStyle = '#c4aa6e'; ctx.fillRect(sx, sy, TILE, TILE); }
          continue;                                              // bare sand — no decor
        }
        if (MapGen.desertAt(s.map, x, y)) {                      // orange desert biome
          if (!this.tileWorld('desert', x, y, sx, sy)) { ctx.fillStyle = '#bd6922'; ctx.fillRect(sx, sy, TILE, TILE); }
          continue;
        }
        if (MapGen.drygrassAt(s.map, x, y)) {                    // intermediate dry-grass biome
          if (!this.tileWorld('drygrass', x, y, sx, sy)) { ctx.fillStyle = '#605227'; ctx.fillRect(sx, sy, TILE, TILE); }
          continue;
        }
        if (MapGen.highlandAt(s.map, x, y)) {                    // brown highland
          if (!this.tileWorld('highland', x, y, sx, sy)) { ctx.fillStyle = '#6b4a2a'; ctx.fillRect(sx, sy, TILE, TILE); }
          continue;                                              // bare upland — no decor
        }
        if (!this.tileWorld('grass', x, y, sx, sy)) { ctx.fillStyle = GRASS[0]; ctx.fillRect(sx, sy, TILE, TILE); }
        if (!MapGen.oreAt(s.map, x, y) && DECOR.length) {
          // sparse decoratives on plain grass (HR sprites: 128px ≈ one tile)
          const hh = this.decorHash(x, y);
          if (hh % 100 < 16) {
            const d = DECOR[(hh >>> 7) % DECOR.length], im = this.imgs[d.src];
            if (im && im.complete && im.naturalWidth) {
              const w = d.w * TILE / 128, h = d.h * TILE / 128;
              const ox = ((hh >>> 11) % 100) / 100 * Math.max(0, TILE - w);
              const oy = ((hh >>> 18) % 100) / 100 * Math.max(0, TILE - h);
              ctx.drawImage(im, sx + ox, sy + oy, w, h);
            }
          }
        }
      }
    }

    // soft terrain transitions: bleed the higher-priority terrain across each boundary
    // with an alpha fade, so water↔sand↔grass↔highland edges are smooth gradients, not
    // hard lines. Water is lowest, so sand dissolves softly into the shoreline.
    const PRIO = { water: -1, sand: 0, desert: 1, grass: 2, drygrass: 3, highland: 4 };
    for (let x = c0; x < c1; x++) for (let y = 0; y < s.map.height; y++) {
      const t = MapGen.terrainType(s.map, x, y);
      if (!(t in PRIO)) continue;
      const sx = x * TILE - this.camPx, sy = y * TILE;
      for (const [dx, dy, dir] of [[0, -1, 'N'], [0, 1, 'S'], [-1, 0, 'W'], [1, 0, 'E'],
                                   [-1, -1, 'NW'], [1, -1, 'NE'], [-1, 1, 'SW'], [1, 1, 'SE']]) {
        const nt = MapGen.terrainType(s.map, x + dx, y + dy);
        if (!(nt in PRIO) || PRIO[nt] <= PRIO[t]) continue;     // only a higher neighbour bleeds in
        const f = this.fadeTile(nt, x + dx, y + dy, dir);
        if (f) ctx.drawImage(f, sx, sy);
      }
    }


    // ore pass (after all grass so the slight overscan can feather onto neighbours)
    const OVER = 5;                       // px the ore sprite bleeds past its tile on each side
    for (let x = c0; x < c1; x++) {
      for (let y = 0; y < s.map.height; y++) {
        const ore = MapGen.oreAt(s.map, x, y);
        if (!ore) continue;
        const sx = x * TILE - this.camPx, sy = y * TILE;
        const oi = this.terr['ore-' + ore + '-' + this.oreVariant(x, y)];
        if (!this.drawn(oi, sx - OVER, sy - OVER, TILE + 2 * OVER)) {
          ctx.fillStyle = RESOURCES[ore].color; ctx.globalAlpha = 0.7; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.globalAlpha = 1; this.sprite(RESOURCES[ore].img, sx + 3, sy + 3, TILE - 6);
        }
      }
    }

    // obstacle pass: trees & boulders (ascending y so nearer ones overlap farther)
    for (let y = 0; y < s.map.height; y++)
      for (let x = c0; x < c1; x++) this.drawObstacle(x, y);

    // entities
    for (const e of s.entities) {
      const d = GameState.def(e.type), w = (d.w || 2) * TILE, h = (d.h || 2) * TILE;
      const sx = e.x * TILE - this.camPx, sy = e.y * TILE;
      if (sx + w < 0 || sx > W) continue;
      ctx.fillStyle = 'rgba(20,20,20,0.55)'; ctx.fillRect(sx, sy, w, h);
      if (!this.sprite(d.img, sx + 2, sy + 2, w - 4)) {
        ctx.fillStyle = d.color || '#555'; ctx.fillRect(sx + 2, sy + 2, w - 4, h - 4);
        ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.icon || '?', sx + w / 2, sy + h / 2);
      }
      // recipe badge
      if (e.recipe && RESOURCES[e.recipe]) {
        this.sprite(RESOURCES[e.recipe].img, sx + w - 24, sy + h - 24, 22);
      }
      // progress bar
      if (e._progress) { ctx.fillStyle = '#ffcf3f'; ctx.fillRect(sx + 2, sy + h - 4, (w - 4) * e._progress, 3); }
      if (this.selected === e) { ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = 2; ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2); ctx.lineWidth = 1; }
    }

    // beacon radius for selected beacon
    if (this.selected && this.selected.type === 'beacon') this.drawRadius(this.selected.x, this.selected.y, BUILDINGS.beacon.radius);

    // placement ghost
    if (this.place && this.hover.inside) {
      const x = this.hover.x, y = Math.min(this.hover.y, s.map.height - 2);
      const sx = x * TILE - this.camPx, sy = y * TILE, sz = 2 * TILE;
      const ok = this.valid(this.place, x, y);
      const d = GameState.def(this.place);
      if (d.radius) this.drawRadius(x, y, d.radius);
      ctx.globalAlpha = 0.55; this.sprite(d.img, sx + 2, sy + 2, sz - 4); ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#5fe06a' : '#e05a5a'; ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, sz - 2, sz - 2); ctx.lineWidth = 1;
    }

    // hand-mining: a swinging pickaxe on the hovered ore tile
    if (this.mining && this.hover.inside) {
      const sx = this.hover.x * TILE - this.camPx, sy = this.hover.y * TILE;
      ctx.strokeStyle = '#ffcf3f'; ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2); ctx.lineWidth = 1;
      const ang = Math.sin(performance.now() / 80) * 0.6 - 0.3;
      ctx.save();
      ctx.translate(sx + TILE / 2, sy + TILE / 2);
      ctx.rotate(ang);
      ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⛏', 0, -2);
      ctx.restore();
    }
  },

  drawRadius(x, y, R) {
    const ctx = this.ctx;
    const sx = (x - R) * TILE - this.camPx, sy = Math.max(0, (y - R)) * TILE;
    const sz = (2 + 2 * R) * TILE;
    ctx.fillStyle = 'rgba(127,214,255,0.10)';
    ctx.fillRect(sx, sy, sz, Math.min(sz, this.canvas.height - sy));
    ctx.strokeStyle = 'rgba(127,214,255,0.45)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, sz, Math.min(sz, this.canvas.height - sy));
  },
};
