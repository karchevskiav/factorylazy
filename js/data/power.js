// data/power.js — power generators, placed on the map like other buildings (2x2).
// mw: produced megawatts · fuel/fuelPerSec: consumption from the shared pool (null = free).
export const POWER = {
  steamEngine: {name:'Steam Engine', icon:'♨', img:'assets/icons/steam-engine.png', color:'#3a3a3a', place:'land', w:2, h:2,
                mw:5, fuel:'coal', fuelPerSec:0.5, baseCost:{ironPlate:8,stone:5}, costMul:1.16, unlock:'electricEnergy'},
  solarPanel:  {name:'Solar Panel',  icon:'☀', img:'assets/icons/solar-panel.png', color:'#3a3a3a', place:'land', w:2, h:2,
                mw:3, fuel:null,  fuelPerSec:0,   baseCost:{electronicCircuit:6,copperPlate:10}, costMul:1.2, unlock:'electronics'},
};
