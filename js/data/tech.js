// data/tech.js — technology tree.
// Tech names & science-pack costs mirror Factorio base; costs are pack amounts
// consumed continuously while researching. Sciences: automation(red), logistic(green),
// military(black), chemical(blue), production(purple), utility(yellow).
// effect keys: unlockBuilding (string|array), globalSpeed (+%), globalYield (+%), unlockModules, unlockRocket.
export const TECH = {
  automation: {
    name:'Automation', tier:1, icon:'🔧', cost:{automationScience:10}, req:[],
    desc:'Streamlined assembly — +25% crafting speed for everything.',
    effect:{globalSpeed:0.25}},

  logistics: {
    name:'Logistics', tier:1, icon:'»', cost:{automationScience:20}, req:['automation'],
    desc:'Belts & inserters feed machines better — +10% yield.',
    effect:{globalYield:0.10}},

  steelProcessing: {
    name:'Steel Processing', tier:1, icon:'▰', cost:{automationScience:50}, req:['automation'],
    desc:'Hotter furnaces — +15% crafting speed.',
    effect:{globalSpeed:0.15}},

  electricEnergy: {
    name:'Electric Energy', tier:1, icon:'⚡', cost:{automationScience:30}, req:['automation'],
    desc:'Unlock the Steam Engine and the power grid — electric machines need it.',
    effect:{}},

  advancedMaterials: {
    name:'Advanced Material Processing', tier:2, icon:'🔥', cost:{automationScience:75,logisticScience:30}, req:['steelProcessing','electricEnergy'],
    desc:'Unlock the Electric Furnace (faster, modular smelting).',
    effect:{unlockBuilding:'electricFurnace'}},

  oilProcessing: {
    name:'Oil Processing', tier:2, icon:'🛢', cost:{automationScience:40,logisticScience:40}, req:['logistics','electricEnergy'],
    desc:'Unlock the Pumpjack and Chemical Plant — oil, plastic, sulfur.',
    effect:{unlockBuilding:['pumpjack','chemPlant']}},

  automation2: {
    name:'Automation 2', tier:2, icon:'🔧', cost:{automationScience:40,logisticScience:40}, req:['advancedMaterials'],
    desc:'Unlock Assembling Machine 2 (faster, module slots).',
    effect:{unlockBuilding:'assembler2'}},

  electronics: {
    name:'Advanced Electronics', tier:3, icon:'▣', cost:{automationScience:60,logisticScience:40,chemicalScience:30}, req:['oilProcessing','automation2'],
    desc:'Better circuits — +20% crafting speed.',
    effect:{globalSpeed:0.20}},

  modules: {
    name:'Modules', tier:3, icon:'»', cost:{automationScience:100,logisticScience:100,chemicalScience:50}, req:['electronics'],
    desc:'Unlock module slots and all modules.',
    effect:{unlockModules:true}},

  miningProductivity: {
    name:'Production Science', tier:4, icon:'⛏', cost:{logisticScience:60,chemicalScience:60,productionScience:40}, req:['modules'],
    desc:'Refined extraction & recipes — +25% yield.',
    effect:{globalYield:0.25}},

  automation3: {
    name:'Automation 3', tier:4, icon:'🔧', cost:{chemicalScience:60,productionScience:60}, req:['modules'],
    desc:'Unlock Assembling Machine 3 (fastest, 4 slots).',
    effect:{unlockBuilding:'assembler3'}},

  productionScaling: {
    name:'Utility Science', tier:5, icon:'⚙', cost:{productionScience:80,utilityScience:60}, req:['miningProductivity','automation3'],
    desc:'Robotics & advanced logistics — +30% crafting speed.',
    effect:{globalSpeed:0.30}},

  rocketSilo: {
    name:'Rocket Silo', tier:5, icon:'🚀',
    cost:{automationScience:100,logisticScience:100,chemicalScience:100,productionScience:100,utilityScience:100},
    req:['productionScaling'],
    desc:'Unlock Rocket Parts — build 100 and launch to prestige!',
    effect:{unlockRocket:true}},
};
