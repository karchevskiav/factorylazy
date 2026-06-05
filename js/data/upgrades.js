// data/upgrades.js — manual-craft global-bonus upgrades (BALANCE.md §3, §5, §15, §16).
//
// Each item belongs to a display `group` (a subsection in the craft window) and has an
// `effect` that names WHICH bonus channel it feeds. Within a channel the per-rank
// contributions ADD (1 + Σ contrib×rank); channels combine multiplicatively in the engine:
//
//   effect 'speed'        → M.speed   (crafts/sec)            — manipulators, speed modules
//   effect 'yield'        → M.yield   (output per craft)      — conveyors, productivity modules
//   effect 'powerSupply'  → ×produced MW (better grid)        — electric poles
//   effect 'powerSave'    → ÷consumed MW (less draw)          — efficiency module
//   effect 'research'     → ×research speed (labs)            — radar, combinators
//   effect 'storage'      → +SOLID resource cap (flat, see `cap`) — chests
//   effect 'fluidStorage' → +FLUID  cap (flat, see `cap`)         — storage tank
//
// Each item is also a craftable RESOURCE, so its rank is gated by whether that item's
// recipe has been researched (GameState.upgradeUnlocked → recipeUnlocked).
// Price of the NEXT rank = baseCost × costMul^rank (rising cost = the diminishing curve).
import { BALANCE } from '../config.js';
export const STORAGE_BASE = BALANCE.storageBase;   // SOLID-resource cap base (science packs uncapped)
export const FLUID_BASE   = BALANCE.fluidBase;     // FLUID cap base — raised only by the storage tank

// fluids share their own cap track (chests don't help them; only the storage tank does)
export const FLUIDS = new Set(['crudeOil', 'water', 'heavyOil', 'lightOil', 'petroleumGas', 'lubricant', 'sulfuricAcid']);

export const UPGRADES = {
  // ---- manipulators → SPEED ------------------------------------------------
  burnerInserter:     { group: 'manip', effect: 'speed', contrib: 0.02, costMul: 1.12, baseCost: { ironPlate: 10, ironGearWheel: 2 } },
  inserter:           { group: 'manip', effect: 'speed', contrib: 0.04, costMul: 1.13, baseCost: { ironPlate: 5, ironGearWheel: 5, electronicCircuit: 2 } },
  longHandedInserter: { group: 'manip', effect: 'speed', contrib: 0.05, costMul: 1.14, baseCost: { ironGearWheel: 10, electronicCircuit: 5 } },
  fastInserter:       { group: 'manip', effect: 'speed', contrib: 0.07, costMul: 1.15, baseCost: { ironGearWheel: 8, electronicCircuit: 10 } },
  bulkInserter:       { group: 'manip', effect: 'speed', contrib: 0.18, costMul: 1.18, baseCost: { steelPlate: 15, advancedCircuit: 20 } },

  // ---- conveyors → OUTPUT --------------------------------------------------
  transportBelt:        { group: 'belt', effect: 'yield', contrib: 0.03, costMul: 1.12, baseCost: { ironPlate: 5, ironGearWheel: 5 } },
  fastTransportBelt:    { group: 'belt', effect: 'yield', contrib: 0.06, costMul: 1.14, baseCost: { ironPlate: 5, ironGearWheel: 8 } },
  expressTransportBelt: { group: 'belt', effect: 'yield', contrib: 0.10, costMul: 1.16, baseCost: { steelPlate: 5, ironGearWheel: 12 } },

  // ---- modules → SPEED / OUTPUT / POWER (the three colours) -----------------
  speedModule:        { group: 'module', effect: 'speed',     contrib: 0.10, costMul: 1.20, baseCost: { advancedCircuit: 5, electronicCircuit: 5 } },
  productivityModule: { group: 'module', effect: 'yield',     contrib: 0.06, costMul: 1.22, baseCost: { advancedCircuit: 5, electronicCircuit: 5 } },
  efficiencyModule:   { group: 'module', effect: 'powerSave', contrib: 0.08, costMul: 1.18, baseCost: { advancedCircuit: 5, electronicCircuit: 5 } },

  // ---- electric poles → POWER SUPPLY ---------------------------------------
  smallElectricPole:  { group: 'power', effect: 'powerSupply', contrib: 0.03, costMul: 1.10, baseCost: { wood: 1, copperCable: 2 } },
  mediumElectricPole: { group: 'power', effect: 'powerSupply', contrib: 0.06, costMul: 1.12, baseCost: { ironStick: 4, steelPlate: 2, copperCable: 2 } },
  bigElectricPole:    { group: 'power', effect: 'powerSupply', contrib: 0.10, costMul: 1.14, baseCost: { ironStick: 8, steelPlate: 5, copperCable: 4 } },
  substation:         { group: 'power', effect: 'powerSupply', contrib: 0.16, costMul: 1.16, baseCost: { steelPlate: 10, advancedCircuit: 5, copperCable: 6 } },

  // ---- research → LAB SPEED (unused structures: radar + combinators) --------
  radar:                { group: 'research', effect: 'research', contrib: 0.05, costMul: 1.13, baseCost: { electronicCircuit: 5, ironGearWheel: 5, ironPlate: 10 } },
  arithmeticCombinator: { group: 'research', effect: 'research', contrib: 0.07, costMul: 1.15, baseCost: { copperCable: 5, electronicCircuit: 5 } },
  deciderCombinator:    { group: 'research', effect: 'research', contrib: 0.09, costMul: 1.16, baseCost: { copperCable: 5, electronicCircuit: 5 } },

  // ---- chests → STORAGE CAP (flat `cap` added per rank, BALANCE §5) ---------
  woodenChest:  { group: 'storage', effect: 'storage', cap: 200,   costMul: 1.15, baseCost: { wood: 2 } },
  ironChest:    { group: 'storage', effect: 'storage', cap: 800,   costMul: 1.16, baseCost: { ironPlate: 8 } },
  steelChest:   { group: 'storage', effect: 'storage', cap: 3200,  costMul: 1.18, baseCost: { steelPlate: 8 } },
  storageChest: { group: 'storage', effect: 'storage', cap: 12800, costMul: 1.20, baseCost: { steelChest: 1, electronicCircuit: 3, advancedCircuit: 1 } },

  // ---- storage tank → FLUID CAP (the only thing that raises the fluid cap) ----
  storageTank:  { group: 'storage', effect: 'fluidStorage', cap: 5000, costMul: 1.18, baseCost: { ironPlate: 20, steelPlate: 5 } },
};

// display order of subsections in the manual-craft window
export const UPGRADE_GROUPS = ['manip', 'belt', 'module', 'power', 'research', 'storage'];
