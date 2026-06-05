// data/power.js — power generators, placed on the map like other buildings.
// mw: produced megawatts · fuel/fuelPerSec: consumption from the shared pool (null = free).
export const POWER = {
  steamEngine: {name:'Steam Engine', icon:'♨', img:'assets/buildings/steamEngine.png', color:'#3a3a3a', place:'land', w:5, h:3,
                mw:5, fuel:'coal', fuelPerSec:0.5, baseCost:{ironPlate:8,stone:5}, costMul:1.16, unlock:'steamPower'},
  solarPanel:  {name:'Solar Panel',  icon:'☀', img:'assets/buildings/solarPanel.png', color:'#3a3a3a', place:'land', w:3, h:3,
                mw:3, fuel:null,  fuelPerSec:0,   baseCost:{electronicCircuit:6,copperPlate:10}, costMul:1.2, unlock:'solarEnergy'},
  accumulator: {name:'Accumulator', icon:'🔋', img:'assets/buildings/accumulator.png', color:'#3a3a3a', place:'land', w:2, h:2,
                mw:0.3, fuel:null, fuelPerSec:0,  baseCost:{ironPlate:2,battery:5}, costMul:1.15, unlock:'electricEnergyAccumulators'},
  // nuclear reactor: burns uranium fuel cells (very slowly) for a huge amount of power.
  // The heat-exchanger/steam-turbine chain is folded in (as the boiler is for steam engines).
  // neighborBonus: each reactor touching this one adds +100% power (fuel use unchanged) —
  // build them in a tight cluster (e.g. 2×2) for a huge output boost, just like vanilla.
  nuclearReactor: {name:'Nuclear Reactor', icon:'☢', img:'assets/buildings/nuclearReactor.png', color:'#3a3a3a', place:'land', w:5, h:5,
                mw:40, fuel:'uraniumFuelCell', fuelPerSec:0.005, neighborBonus:1, baseCost:{concrete:500,steelPlate:500,advancedCircuit:500,copperPlate:500}, costMul:1.3, unlock:'nuclearPower'},
};
