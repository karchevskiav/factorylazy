// mapview.js — canvas renderer + mouse interaction for the tile map.
// Terrain is drawn as coloured tiles; ores and buildings use the real Factorio
// PNG icons in assets/. Buildings are 2×2 entities placed on the grid.
import { GameState } from './gameState.js';
import { RESOURCES } from './data/resources.js';
import { BUILDINGS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { DECOR }     from './data/decor.js';
import { MapGen }    from './map.js';

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
    for (let i = 0; i < 3; i++) addT('grass-' + i);
    for (const o of ['ironOre', 'copperOre', 'coal', 'stone', 'uraniumOre'])
      for (let i = 0; i < 4; i++) addT('ore-' + o + '-' + i);
    for (const d of DECOR) add(d.src);
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
      if (e.button === 1 || (e.button === 0 && this.place === null && !this.entityAt(this.toTile(e).x, this.toTile(e).y))) {
        this.drag = { startX: e.clientX, startCam: this.camPx };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.drag) { this.camPx = Math.max(0, this.drag.startCam - (e.clientX - this.drag.startX)); this.render(); return; }
    });
    window.addEventListener('mouseup', () => { this.drag = null; });
    c.addEventListener('mousemove', (e) => {
      const t = this.toTile(e); this.hover = { x: t.x, y: t.y, inside: true }; this.render();
    });
    c.addEventListener('mouseleave', () => { this.hover.inside = false; this.render(); });
    c.addEventListener('click', (e) => {
      if (this.drag) return;
      const t = this.toTile(e);
      if (this.place) this.tryPlace(t.x, t.y);
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

  oreUnder(x, y) {           // require the whole 2×2 footprint on one ore type
    const o = MapGen.oreAt(GameState.state.map, x, y);
    if (!o) return null;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++)
      if (MapGen.oreAt(GameState.state.map, x + dx, y + dy) !== o) return null;
    return o;
  },

  valid(type, x, y) {
    if (!GameState.free(x, y, 2, 2)) return false;
    const def = GameState.def(type);
    if (def.place === 'ore') return !!this.oreUnder(x, y);
    return true;
  },

  costOf(type, owned) {
    return POWER[type] ? window.UI.powerCost(type, owned) : window.UI.buildingCost(type, owned);
  },

  tryPlace(x, y) {
    const type = this.place, def = GameState.def(type);
    if (!def) return;
    if ((BUILDINGS[type] && !GameState.isBuildingUnlocked(type)) || (POWER[type] && !GameState.isPowerUnlocked(type)))
      return window.UI.toast('Locked — research required');
    if (!this.valid(type, x, y))
      return window.UI.toast(def.place === 'ore' ? 'Drills must be placed on a matching ore patch' : 'Blocked — tiles occupied');
    const cost = this.costOf(type, GameState.placedOf(type));
    if (!window.UI.canAfford(cost)) return window.UI.toast('Not enough resources');
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

  /* ---------- rendering ---------- */
  sprite(path, sx, sy, size) {
    const im = this.imgs[path];
    if (im && im.complete && im.naturalWidth) this.ctx.drawImage(im, sx, sy, size, size);
    return im && im.complete && im.naturalWidth;
  },

  render() {
    const ctx = this.ctx; if (!ctx) return;
    const s = GameState.state; if (!s || !s.map) return;
    const W = this.canvas.width, H = this.canvas.height;
    const c0 = Math.floor(this.camPx / TILE), c1 = c0 + Math.ceil(W / TILE) + 1;

    // terrain: real grass texture, with ore-on-ground rock sprites on ore tiles
    for (let x = c0; x < c1; x++) {
      for (let y = 0; y < s.map.height; y++) {
        const sx = x * TILE - this.camPx, sy = y * TILE;
        if (!this.drawn(this.terr['grass-' + MapGen.grassShade(s.map, x, y)], sx, sy, TILE)) {
          ctx.fillStyle = GRASS[MapGen.grassShade(s.map, x, y)]; ctx.fillRect(sx, sy, TILE, TILE);
        }
        const ore = MapGen.oreAt(s.map, x, y);
        if (ore) {
          const oi = this.terr['ore-' + ore + '-' + this.oreVariant(x, y)];
          if (!this.drawn(oi, sx, sy, TILE)) {
            ctx.fillStyle = RESOURCES[ore].color; ctx.globalAlpha = 0.7; ctx.fillRect(sx, sy, TILE, TILE);
            ctx.globalAlpha = 1; this.sprite(RESOURCES[ore].img, sx + 3, sy + 3, TILE - 6);
          }
        } else if (DECOR.length) {
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
