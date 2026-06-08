#!/usr/bin/env python3
"""Extract sciences + resource chain from the Factorio Lua data into the
idle game's JS data tables (resources.js / recipes.js / tech.js).

⚠️  WARNING — re-running this CLOBBERS hand-maintained additions in the
    generated data files. After any run, RESTORE these from git or the game
    will fail to boot (missing exports break the whole ES-module graph):
      • js/data/buildings.js  → must keep `export const BUILDING_ITEMS` + the boiler
      • js/data/recipes.js    → must keep `export const HANDCRAFT_ONLY` + steam/boiler recipes
      • js/data/resources.js  → must keep the `steam` resource
    i.e.:  git checkout HEAD -- js/data/buildings.js js/data/recipes.js js/data/resources.js
    (tech.js is safe to regenerate; it carries the weapon-damage/firing-speed effects.)

Single-output engine: multi-output Factorio recipes keep only the matching
result; fluid/oil recipes are simplified to single crude-oil derivatives.
Run from the factorioidle root:  python3 tools/extract.py
"""
import re, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(ROOT, "Factorio/data/base/prototypes")

def read(p):
    with open(os.path.join(PROTO, p), encoding="utf-8") as f: return f.read()

# ---- brace-matched block extraction -------------------------------------
def blocks_with_type(text, typ):
    """Yield the source text of every {...} table that directly declares type=typ."""
    out = []
    needle = f'type = "{typ}"'
    for m in re.finditer(re.escape(needle), text):
        # walk back to the opening brace of this table
        i = m.start(); depth = 0
        while i > 0:
            i -= 1
            if text[i] == '}': depth += 1
            elif text[i] == '{':
                if depth == 0: break
                depth -= 1
        start = i
        # walk forward to matching close
        j = m.end(); depth = 0
        while j < len(text):
            if text[j] == '{': depth += 1
            elif text[j] == '}':
                if depth == 0: break
                depth -= 1
            j += 1
        out.append(text[start:j+1])
    return out

def field(block, name):
    m = re.search(rf'\b{name}\s*=\s*"([^"]*)"', block)
    if m: return m.group(1)
    m = re.search(rf'\b{name}\s*=\s*([0-9.]+)', block)
    return m.group(1) if m else None

def parse_stacks(block, key):
    """Parse an ingredients/results list -> [(type,name,amount), ...]."""
    m = re.search(rf'\b{key}\s*=\s*', block)
    if not m: return []
    i = block.index('{', m.end()); depth = 0; j = i
    while j < len(block):
        if block[j] == '{': depth += 1
        elif block[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    listing = block[i:j+1]
    res = []
    for entry in re.finditer(r'\{([^{}]*)\}', listing):
        e = entry.group(1)
        nm = re.search(r'name\s*=\s*"([^"]+)"', e)
        am = re.search(r'amount\s*=\s*([0-9.]+)', e)
        ty = re.search(r'type\s*=\s*"([^"]+)"', e)
        if nm:
            res.append((ty.group(1) if ty else "item", nm.group(1),
                        float(am.group(1)) if am else 1.0))
    return res

def tint(block):
    m = re.search(r'crafting_machine_tint\s*=.*?primary\s*=\s*\{([^}]*)\}', block, re.S)
    if not m: return None
    g = m.group(1)
    def c(k):
        mm = re.search(rf'{k}\s*=\s*([0-9.]+)', g)
        return mm.group(1)
    try:
        r,gr,b = float(c('r')), float(c('g')), float(c('b'))
        return '#%02x%02x%02x' % (int(r*255), int(gr*255), int(b*255))
    except Exception:
        return None

# ---- parse recipes -------------------------------------------------------
recipe_txt = read("recipe.lua")
RECIPES = {}
for blk in blocks_with_type(recipe_txt, "recipe"):
    name = field(blk, "name")
    if not name or name.startswith("parameter"): continue
    RECIPES[name] = {
        "category": field(blk, "category") or "crafting",
        "energy": float(field(blk, "energy_required") or 0.5),
        "ingredients": parse_stacks(blk, "ingredients"),
        "results": parse_stacks(blk, "results"),
        "tint": tint(blk),
    }

# ---- parse items (display order / subgroup / icon path) ------------------
ICON = {}   # item/fluid name -> source path relative to data/base (e.g. graphics/icons/x.png)
def grab_icon(blk):
    m = re.search(r'\bicon\s*=\s*"__base__/([^"]+)"', blk)
    return m.group(1) if m else None
item_txt = read("item.lua")
ITEMS = {}
for typ in ("item","tool","module","ammo","capsule","gun","armor","item-with-entity-data","repair-tool","rail-planner","selection-tool","space-platform-starter-pack"):
    for blk in blocks_with_type(item_txt, typ):
        name = field(blk, "name")
        if name and name not in ITEMS:
            ITEMS[name] = {"subgroup": field(blk,"subgroup") or "", "order": field(blk,"order") or ""}
            ic = grab_icon(blk)
            if ic: ICON[name] = ic
# fluids carry their own icons
for blk in blocks_with_type(read("fluid.lua"), "fluid"):
    name = field(blk, "name"); ic = grab_icon(blk)
    if name and ic: ICON[name] = ic

print("recipes:", len(RECIPES), "items:", len(ITEMS), "icons:", len(ICON))

# ---- configuration -------------------------------------------------------
# The six ground-craftable science packs become the game's research currencies.
SCIENCE = ["automation-science-pack","logistic-science-pack","military-science-pack",
           "chemical-science-pack","production-science-pack","utility-science-pack"]

# raw resources (mined / pumped) — no recipe, produced by an extractor building
RAW = {
    "iron-ore":     ("mine", "#9a9a9a", "⬤"),
    "copper-ore":   ("mine", "#c8743a", "⬤"),
    "coal":         ("mine", "#2b2b2b", "◆"),
    "stone":        ("mine", "#8a8275", "⬢"),
    "uranium-ore":  ("mine", "#3aa03a", "⬤"),
    "crude-oil":    ("oil",  "#1b1b2a", "⬣"),
    "water":        ("pump", "#2f6fb0", "⬣"),
    # gathered/by-product items with no craft recipe — extracted by hand (mine cat)
    "wood":         ("mine", "#6b4a2a", "▬"),
    "raw-fish":     ("mine", "#5a8aa0", "❥"),
    "depleted-uranium-fuel-cell": ("mine", "#4a7a4a", "▪"),
}
# fluids/oil derivatives: the engine is single-output, so multi-output oil
# processing is simplified to one crude-oil derivative per fluid.
FLUID_OVERRIDE = {
    "petroleum-gas": {"cat":"chem","time":5,"out":2,"inputs":{"crudeOil":1},     "color":"#9b59b6","glyph":"⬣"},
    "heavy-oil":     {"cat":"chem","time":5,"out":1,"inputs":{"crudeOil":1},     "color":"#a8531a","glyph":"⬣"},
    "light-oil":     {"cat":"chem","time":5,"out":1,"inputs":{"crudeOil":1},     "color":"#d8a838","glyph":"⬣"},
    "lubricant":     {"cat":"chem","time":1,"out":1,"inputs":{"heavyOil":1},     "color":"#5fa83a","glyph":"⬣"},
    "sulfuric-acid": {"cat":"chem","time":1,"out":50,"inputs":{"ironPlate":1,"sulfur":5,"water":100},"color":"#d8d038","glyph":"⬣"},
    "solid-fuel":    {"cat":"chem","time":2,"out":1,"inputs":{"lightOil":10},    "color":"#3a3a3a","glyph":"▪"},
}
# the rocket-part chain is the prestige goal (gated behind the rocketScience tech)
GOALS = SCIENCE + ["rocket-part"]
CAT_MAP = {"crafting":"craft","advanced-crafting":"craft","crafting-with-fluid":"craft",
           "smelting":"smelt","chemistry":"chem","oil-processing":"refine",
           "centrifuging":"centrifuge","rocket-building":"craft"}

# recipes we never treat as a producer (barreling/recycling/parameters are noise)
def usable_recipe(name, r):
    if name.endswith("-barrel"): return False
    if r["category"] in ("parameters","recycling"): return False
    return True

def camel(name):
    parts = name.split("-")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])

SCI_KEY = {
    "automation-science-pack":"automationScience","logistic-science-pack":"logisticScience",
    "military-science-pack":"militaryScience","chemical-science-pack":"chemicalScience",
    "production-science-pack":"productionScience","utility-science-pack":"utilityScience",
}
def key(name): return SCI_KEY.get(name, camel(name))

# choose the primary producing recipe for an item (one whose results include it)
PRODUCER = {}
for rname, r in RECIPES.items():
    if not usable_recipe(rname, r): continue
    for (ty, nm, am) in r["results"]:
        if ty != "item": continue
        PRODUCER.setdefault(nm, [])
        PRODUCER[nm].append((rname, am))
def primary(name):
    cands = PRODUCER.get(name, [])
    # prefer a recipe sharing the item name, else the first
    for (rn, am) in cands:
        if rn == name: return (rn, am)
    return cands[0] if cands else None

# ---- full set: every producible item + its ingredients + raw -------------
needed = set()
for rname, r in RECIPES.items():
    if not usable_recipe(rname, r): continue
    for (ty, nm, am) in r["results"]:
        if ty == "item": needed.add(nm)
    for (ty, nm, am) in r["ingredients"]:
        if ty == "item": needed.add(nm)
# fluids referenced by item recipes / overrides
needed |= set(FLUID_OVERRIDE) | {"crude-oil","water","petroleum-gas","heavy-oil","light-oil","lubricant","sulfuric-acid"}
needed |= set(RAW)
needed -= {"barrel"} if "barrel" not in PRODUCER else set()  # keep barrel only if craftable

# raw = anything we can't (or won't) craft
raw_used = set()
for n in list(needed):
    if n in FLUID_OVERRIDE:        continue
    if n in RAW and n not in PRODUCER: raw_used.add(n); continue
    if not primary(n):             raw_used.add(n)
# force the hand-listed RAW gathered items to stay raw even if a stray recipe exists
for n in RAW:
    if n in ("wood","raw-fish","depleted-uranium-fuel-cell","iron-ore","copper-ore",
             "coal","stone","uranium-ore","crude-oil","water"):
        raw_used.add(n)

print("full set:", len(needed), "items |", len(raw_used), "raw |", "raw:", sorted(raw_used))


# ---- build resource + recipe tables --------------------------------------
def title(name): return " ".join(w.capitalize() for w in name.split("-"))

CAT_COLOR = {"smelt":"#b8b8b8","craft":"#6f8fae","chem":"#3a7a4a"}
# name-keyed palette so the chain reads at a glance (checked as substrings, first match wins)
NAME_COLOR = [
    ("copper","#d98c4a"),("iron-gear","#9aa0a8"),("iron-stick","#9aa0a8"),
    ("iron-plate","#cfcfcf"),("steel","#5f6470"),("plastic","#e8e8e8"),
    ("electronic-circuit","#3f8f3f"),("advanced-circuit","#c0392b"),("processing-unit","#5b9bd5"),
    ("battery","#2e8b57"),("sulfur","#e6d72a"),("pipe","#8a8f98"),
    ("engine","#7a8089"),("robot","#4aa3df"),("rail","#7a6a4a"),("belt","#caa23a"),
    ("inserter","#2e9e9e"),("module","#3aa0c0"),("low-density","#dcd6c8"),
    ("magazine","#b04a3a"),("grenade","#3a5a3a"),("wall","#7a7a7a"),
    ("brick","#a05a3a"),("electric-furnace","#3a5a5a"),
    ("rocket","#e88b2e"),("solid-fuel","#3a3a3a"),
]
def color_for(name, rc):
    if rc.get("tint"): return rc["tint"]
    if name in FLUID_OVERRIDE: return FLUID_OVERRIDE[name]["color"]
    for frag,c in NAME_COLOR:
        if frag in name: return c
    return CAT_COLOR.get(rc["cat"],"#9a9a9a")
def glyph(name, cat):
    if name in ("rocket-part","rocket-fuel"): return "🚀"
    if name in FLUID_OVERRIDE or name in ("crude-oil","water"): return "⬣"
    if name.endswith("science-pack"): return "⚗"
    if "module" in name: return "»"
    if name in ("grenade","stone-wall","piercing-rounds-magazine","firearm-magazine"): return "◈"
    if "circuit" in name or "processing-unit" in name: return "▣"
    if "plate" in name or "steel" in name: return "▰"
    if "gear" in name or "engine" in name or "robot" in name: return "⚙"
    if cat == "smelt": return "▰"
    return "▪"

# resolve recipe + inputs for a crafted item, as camel keys
def recipe_for(name):
    if name in FLUID_OVERRIDE:
        o = FLUID_OVERRIDE[name]
        return {"out":o["out"],"time":o["time"],"inputs":dict(o["inputs"]),"cat":o["cat"]}
    prod = primary(name)
    if not prod: return None
    rname, am = prod
    r = RECIPES[rname]
    inputs = {}
    for (ty, nm, qty) in r["ingredients"]:
        inputs[key(nm)] = (qty if qty==int(qty) else round(qty,2))
        if int(qty)==qty: inputs[key(nm)] = int(qty)
    return {"out":int(am) if am==int(am) else round(am,2),
            "time":round(r["energy"],2),"inputs":inputs,
            "cat":CAT_MAP.get(r["category"],"craft"),"tint":r["tint"]}

crafted = [n for n in needed if n not in raw_used]
REC = {}
for n in crafted:
    rc = recipe_for(n)
    if rc: REC[key(n)] = rc

# tiers via longest dependency depth
RAWKEYS = {key(n) for n in raw_used}
tier_memo = {}
def tier(k):
    if k in RAWKEYS: return 0
    if k in tier_memo: return tier_memo[k]
    tier_memo[k] = 1  # guard against cycles
    rc = REC.get(k)
    if not rc: return 0
    t = 1 + max([tier(i) for i in rc["inputs"]] or [0])
    tier_memo[k] = t
    return t

# copy real Factorio PNG icons into assets/icons/, return web path (or None).
# Factorio icon PNGs are mipmap strips (e.g. 120×64 = 64+32+16+8 laid out left→right);
# we crop to the leftmost full-resolution square so the icon renders undistorted.
import shutil
try:
    from PIL import Image
except Exception:
    Image = None
BASE = os.path.join(ROOT, "Factorio/data/base")
ICONDIR = os.path.join(ROOT, "assets/icons")
os.makedirs(ICONDIR, exist_ok=True)
_copied = set()
def _crop_mipmap(path):
    if not Image: return
    try:
        im = Image.open(path)
        if im.width > im.height:                       # strip of mip levels → keep left square
            im.crop((0, 0, im.height, im.height)).save(path)
    except Exception:
        pass
def get_img(name):
    rel = ICON.get(name)
    if not rel: return None
    src = os.path.join(BASE, rel)
    if not os.path.isfile(src): return None
    dst_name = os.path.basename(rel)
    dst = os.path.join(ICONDIR, dst_name)
    if dst_name not in _copied:
        shutil.copyfile(src, dst)
        _crop_mipmap(dst)
        _copied.add(dst_name)
    return "assets/icons/" + dst_name

# resources table: raw first, then crafted
RES = {}
for n in sorted(raw_used):
    cat,color,gl = RAW[n]
    RES[key(n)] = {"name":title(n),"icon":gl,"color":color,"tier":0,"img":get_img(n)}
for n in crafted:
    k = key(n); rc = REC[k]
    RES[k] = {"name":title(n),"icon":glyph(n,rc["cat"]),"color":color_for(n,rc),"tier":tier(k),"img":get_img(n)}

# ---- emit JS -------------------------------------------------------------
DATA = os.path.join(ROOT, "js", "data")
def jsval(v):
    if isinstance(v,str): return f"'{v}'"
    if isinstance(v,bool): return 'true' if v else 'false'
    return repr(v)

def emit_resources():
    rows = sorted(RES.items(), key=lambda kv:(kv[1]["tier"], kv[0]))
    lines = ["// data/resources.js — AUTO-GENERATED from Factorio base data by tools/extract.py.",
             "// `tier` orders the production pass so inputs resolve before consumers in the same tick.",
             "export const RESOURCES = {"]
    for k,v in rows:
        img = f", img:'{v['img']}'" if v.get("img") else ""
        lines.append(f"  {k+':':22} {{name:'{v['name']}', icon:'{v['icon']}', color:'{v['color']}', tier:{v['tier']}{img}}},")
    lines.append("};\n")
    open(os.path.join(DATA,"resources.js"),"w").write("\n".join(lines))

def emit_recipes():
    rows = sorted(REC.items(), key=lambda kv:(RES[kv[0]]["tier"], kv[0]))
    lines = ["// data/recipes.js — AUTO-GENERATED from Factorio base data by tools/extract.py.",
             "// inputs: consumed per craft · out: produced · time: seconds · cat: building category.",
             "export const RECIPES = {"]
    for k,v in rows:
        ins = "{" + ", ".join(f"{i}:{a}" for i,a in v["inputs"].items()) + "}"
        tech = f", tech:'{v['tech']}'" if v.get("tech") else ""
        lines.append(f"  {k+':':24} {{out:{v['out']}, time:{v['time']}, inputs:{ins}, cat:'{v['cat']}'{tech}}},")
    lines.append("};\n")
    open(os.path.join(DATA,"recipes.js"),"w").write("\n".join(lines))

emit_resources(); emit_recipes()
print("wrote resources.js + recipes.js  (", len(RES), "resources,", len(REC), "recipes )")
# expose for buildings generation / inspection
by_cat = {}
for k,v in REC.items(): by_cat.setdefault(v["cat"],[]).append(k)
print("by category:", {c:len(v) for c,v in by_cat.items()})
RAW_BY_CAT = {}
for n in raw_used: RAW_BY_CAT.setdefault(RAW[n][0],[]).append(key(n))
print("raw by cat:", RAW_BY_CAT)

# ---- emit buildings.js ---------------------------------------------------
# recipe keys grouped by the building category that can craft them
def cat_keys(c): return sorted([k for k,v in REC.items() if v["cat"]==c], key=lambda k:RES[k]["tier"])
craft_keys = cat_keys("craft")
smelt_keys = cat_keys("smelt")
chem_keys  = cat_keys("chem")
refine_keys     = cat_keys("refine")
centrifuge_keys = cat_keys("centrifuge")
mine_keys  = RAW_BY_CAT.get("mine",[])
oil_keys   = RAW_BY_CAT.get("oil",[])
pump_keys  = RAW_BY_CAT.get("pump",[])

def jsdict(d): return "{" + ",".join(f"{k}:{v}" for k,v in d.items()) + "}"
def jsrecipes(keys): return "[" + ",".join(f"'{k}'" for k in keys) + "]"

# placeable building specs (footprint 2x2 each). `place`: 'ore' = drill must cover
# matching ore; 'land' = anywhere. `glyph` is a fallback if the PNG is missing.
# Generators (steam/solar) live in power.js but their icons are copied here too.
BLD = [
  ("burnerDrill",       "Burner Mining Drill","burner-mining-drill",'⛏','mine','ore',  1,  0,0,{"ironPlate":5},1.18,None,           mine_keys),
  ("electricMiningDrill","Electric Mining Drill","electric-mining-drill",'⛏','mine','ore',2,0.09,3,{"ironGearWheel":10,"ironPlate":20,"electronicCircuit":5},1.2,None, mine_keys),
  ("offshorePump",   "Offshore Pump",      "offshore-pump",      '🚰','pump','water',1,  0,0,{"ironPlate":3},1.10,None,           pump_keys),
  ("pumpjack",       "Pumpjack",           "pumpjack",           '🛢','oil','land',  1,  1,0,{"ironGearWheel":10,"steelPlate":5,"electronicCircuit":5,"pipe":10},1.2,"oilGathering", oil_keys),
  ("stoneFurnace",   "Stone Furnace",      "stone-furnace",      '🔥','smelt','land',1,  0,0,{"stone":5},1.15,None,                smelt_keys),
  ("steelFurnace",   "Steel Furnace",      "steel-furnace",      '🔥','smelt','land',2,  0,0,{"steelPlate":6,"stoneBrick":10},1.16,"advancedMaterialProcessing", smelt_keys),
  ("electricFurnace","Electric Furnace",   "electric-furnace",   '🔥','smelt','land',2,  2,2,{"steelPlate":10,"stoneBrick":10,"advancedCircuit":5},1.2,"advancedMaterialProcessing2", smelt_keys),
  ("assembler1",     "Assembling Machine 1","assembling-machine-1",'🔧','craft','land',0.5,0.75,0,{"ironPlate":9,"copperPlate":5},1.18,None, craft_keys),
  ("assembler2",     "Assembling Machine 2","assembling-machine-2",'🔧','craft','land',0.75,1.5,2,{"steelPlate":5,"ironGearWheel":10,"electronicCircuit":5},1.2,"automation2", craft_keys),
  ("assembler3",     "Assembling Machine 3","assembling-machine-3",'🔧','craft','land',1.25,3.5,4,{"steelPlate":20,"advancedCircuit":10,"processingUnit":5},1.22,"automation3", craft_keys),
  ("oilRefinery",    "Oil Refinery",       "oil-refinery",       '🏭','chem','land',  1,  0.42,3,{"steelPlate":15,"ironGearWheel":10,"stoneBrick":10,"electronicCircuit":10,"pipe":10},1.2,"oilProcessing", ['petroleumGas','heavyOil','lightOil']),
  ("chemPlant",      "Chemical Plant",     "chemical-plant",     '⚗','chem','land',  1,  2.1,2,{"steelPlate":5,"ironGearWheel":5,"electronicCircuit":5,"pipe":5},1.2,"oilProcessing", chem_keys),
  ("centrifuge",     "Centrifuge",         "centrifuge",         '☢','centrifuge','land',1,3.5,2,{"steelPlate":50,"advancedCircuit":20,"ironGearWheel":50,"concrete":100},1.25,"uraniumProcessing", centrifuge_keys),
  ("rocketSilo",     "Rocket Silo",        "rocket-silo",        '🚀','craft','land', 1,  4,4,{"steelPlate":1000,"concrete":1000,"pipe":100,"processingUnit":200,"electricEngineUnit":200},1.3,"rocketSilo", ['rocketPart']),
  ("lab",            "Lab",                "lab",                '🔬','lab','land',   1,  0.06,2,{"electronicCircuit":10,"ironGearWheel":10,"copperPlate":10},1.18,None, []),
  # military buildings — placeable only on the war screen (place:'war')
  ("stoneWall",      "Wall",               "stone-wall",         '🧱','military','war',0, 0,0,{"stone":5},1.0,None, []),
  ("gunTurret",      "Gun Turret",         "gun-turret",         '🔫','military','war',0, 0,0,{"ironPlate":20,"ironGearWheel":10,"copperPlate":10},1.15,None, []),
]
# ---- real building sprites (one clean frame of the entity graphic) -------
# Crops frame 0 of each building's animation sheet (frame size parsed from the entity
# block), autocrops, and saves to assets/buildings/. Footprints are the real in-game
# tile sizes (not all 2×2). The renderer scales the sprite to fill the footprint.
GFX = os.path.join(BASE, "graphics")
BLDDIR = os.path.join(ROOT, "assets/buildings"); os.makedirs(BLDDIR, exist_ok=True)
_ENT = read("entity/entities.lua") + read("entity/mining-drill.lua")
def _ent_frame(name):
    m = re.search(r'name\s*=\s*"' + re.escape(name) + r'"', _ENT)
    if not m: return (None, None)
    i = m.start(); d = 0
    while i > 0:
        i -= 1
        if _ENT[i] == '}': d += 1
        elif _ENT[i] == '{':
            if d == 0: break
            d -= 1
    j = m.end(); d = 0
    while j < len(_ENT):
        if _ENT[j] == '{': d += 1
        elif _ENT[j] == '}':
            if d == 0: break
            d -= 1
        j += 1
    b = _ENT[i:j + 1]
    w = re.search(r'\bwidth\s*=\s*(\d+)', b); h = re.search(r'\bheight\s*=\s*(\d+)', b)
    return (int(w.group(1)) if w else None, int(h.group(1)) if h else None)
BSHEET = {
    "burnerDrill": ("entity/burner-mining-drill/burner-mining-drill-N.png", "burner-mining-drill", None),
    "offshorePump": ("entity/offshore-pump/offshore-pump_North.png", "offshore-pump", None),
    "pumpjack": ("entity/pumpjack/pumpjack-base.png", "pumpjack", (261, 273)),
    "stoneFurnace": ("entity/stone-furnace/stone-furnace.png", "stone-furnace", None),
    "steelFurnace": ("entity/steel-furnace/steel-furnace.png", "steel-furnace", None),
    "electricFurnace": ("entity/electric-furnace/electric-furnace.png", "electric-furnace", None),
    "assembler1": ("entity/assembling-machine-1/assembling-machine-1.png", "assembling-machine-1", None),
    "assembler2": ("entity/assembling-machine-2/assembling-machine-2.png", "assembling-machine-2", None),
    "assembler3": ("entity/assembling-machine-3/assembling-machine-3.png", "assembling-machine-3", None),
    "chemPlant": ("entity/chemical-plant/chemical-plant.png", "chemical-plant", None),
    "oilRefinery": ("entity/oil-refinery/oil-refinery.png", "oil-refinery", None),
    "centrifuge": ("entity/centrifuge/centrifuge-C.png", "centrifuge", None),
    "rocketSilo": ("entity/rocket-silo/14-rocket-silo-front.png", "rocket-silo", None),
    "lab": ("entity/lab/lab.png", "lab", None),
    "stoneWall": ("entity/wall/wall-single.png", "stone-wall", None),
    "gunTurret": ("entity/gun-turret/gun-turret-base.png", "gun-turret", None),
    "steamEngine": ("entity/steam-engine/steam-engine-H.png", "steam-engine", None),
    "solarPanel": ("entity/solar-panel/solar-panel.png", "solar-panel", None),
    "accumulator": ("entity/accumulator/accumulator.png", "accumulator", None),
    "nuclearReactor": ("entity/nuclear-reactor/reactor.png", "nuclear-reactor", None),
}
FOOT = {"burnerDrill": (2, 2), "electricMiningDrill": (3, 3), "offshorePump": (1, 2), "pumpjack": (3, 3),
        "stoneFurnace": (2, 2), "steelFurnace": (2, 2), "electricFurnace": (3, 3),
        "assembler1": (3, 3), "assembler2": (3, 3), "assembler3": (3, 3),
        "oilRefinery": (5, 5), "chemPlant": (3, 3), "centrifuge": (3, 3), "rocketSilo": (9, 9),
        "lab": (3, 3), "stoneWall": (1, 1), "gunTurret": (2, 2),
        "beacon": (3, 3), "steamEngine": (5, 3), "solarPanel": (3, 3), "accumulator": (2, 2),
        "nuclearReactor": (5, 5)}
def build_sprite(bkey):
    if not Image: return None
    if bkey == "beacon":
        try:
            bot = Image.open(os.path.join(GFX, "entity/beacon/beacon-bottom.png")).convert("RGBA")
            top = Image.open(os.path.join(GFX, "entity/beacon/beacon-top.png")).convert("RGBA")
            W = max(bot.width, top.width); H = max(bot.height, top.height)
            c = Image.new("RGBA", (W, H)); c.alpha_composite(bot, ((W - bot.width) // 2, H - bot.height))
            c.alpha_composite(top, ((W - top.width) // 2, H - top.height))
            bb = c.getbbox(); c = c.crop(bb) if bb else c
            c.save(os.path.join(BLDDIR, "beacon.png")); return "assets/buildings/beacon.png"
        except Exception as e: print("beacon sprite failed:", e); return None
    if bkey == "gunTurret":
        try:
            base = os.path.join(GFX, "entity/gun-turret")
            b = Image.open(os.path.join(base, "gun-turret-base.png")).convert("RGBA")
            rais = Image.open(os.path.join(base, "gun-turret-raising.png")).convert("RGBA")
            fw, fh = 130, 126                                   # raising frame; last frame = gun fully up
            cols = rais.width // fw
            idx = (rais.width // fw) * (rais.height // fh) - 1
            col, row = idx % cols, idx // cols
            gun = rais.crop((col * fw, row * fh, col * fw + fw, row * fh + fh))
            W = max(b.width, gun.width); H = max(b.height, gun.height)
            c = Image.new("RGBA", (W, H))
            c.alpha_composite(b, ((W - b.width) // 2, (H - b.height) // 2))
            c.alpha_composite(gun, ((W - gun.width) // 2, (H - gun.height) // 2))
            bb = c.getbbox(); c = c.crop(bb) if bb else c
            c.save(os.path.join(BLDDIR, "gunTurret.png")); return "assets/buildings/gunTurret.png"
        except Exception as e: print("gunTurret sprite failed:", e); return None
    if bkey == "rocketSilo":
        try:
            base = os.path.join(GFX, "entity/rocket-silo")
            body = Image.open(os.path.join(base, "06-rocket-silo.png")).convert("RGBA")
            dback = Image.open(os.path.join(base, "04-door-back.png")).convert("RGBA")
            dfront = Image.open(os.path.join(base, "05-door-front.png")).convert("RGBA")
            c = body.copy()
            for d in (dback, dfront):
                c.alpha_composite(d, ((body.width - d.width) // 2, (body.height - d.height) // 2))
            bb = c.getbbox(); c = c.crop(bb) if bb else c
            c.save(os.path.join(BLDDIR, "rocketSilo.png")); return "assets/buildings/rocketSilo.png"
        except Exception as e: print("rocketSilo sprite failed:", e); return None
    spec = BSHEET.get(bkey)
    if not spec: return None
    rel, ename, override = spec
    try:
        im = Image.open(os.path.join(GFX, rel)).convert("RGBA")
        fw, fh = override if override else _ent_frame(ename)
        if fw and fh and (fw < im.width or fh < im.height):
            im = im.crop((0, 0, min(fw, im.width), min(fh, im.height)))
        bb = im.getbbox(); im = im.crop(bb) if bb else im
        im.save(os.path.join(BLDDIR, bkey + ".png")); return "assets/buildings/" + bkey + ".png"
    except Exception as e:
        print(f"sprite {bkey} failed:", e); return None
for g in ("steamEngine", "solarPanel", "accumulator", "nuclearReactor"): build_sprite(g)  # generator sprites for power.js

# gun-turret as two layers for a rotating barrel: a static base ring + a 64-direction
# gun atlas (the game pre-renders the gun head for every facing in gun-turret-shooting-*).
def build_turret_parts():
    if not Image: return
    gd = os.path.join(GFX, "entity/gun-turret")
    try:
        base = Image.open(os.path.join(gd, "gun-turret-base.png")).convert("RGBA")
        bb = base.getbbox(); (base.crop(bb) if bb else base).save(os.path.join(BLDDIR, "gunTurretBase.png"))
        FW, FH = 132, 130                       # one gun frame · 16 directions per file · 2 recoil frames/row
        files = [Image.open(os.path.join(gd, f"gun-turret-shooting-{i}.png")).convert("RGBA") for i in (1, 2, 3, 4)]
        CW = CH = 66; COLS = 8                   # 64 dirs → 8×8 atlas
        atlas = Image.new("RGBA", (CW * COLS, CH * 8))
        for d in range(64):                      # direction 0 = North, clockwise
            fi, row = d // 16, d % 16            # frame 0 (no recoil) = column 0
            cell = files[fi].crop((0, row * FH, FW, row * FH + FH)).resize((CW, CH), Image.LANCZOS)
            atlas.paste(cell, ((d % COLS) * CW, (d // COLS) * CH), cell)
        atlas.save(os.path.join(BLDDIR, "gunTurretGun.png"))
        print("wrote gunTurretBase.png + gunTurretGun.png (64-dir atlas)")
    except Exception as e:
        print("turret parts failed:", e)
build_turret_parts()

lines = ["// data/buildings.js — AUTO-GENERATED by tools/extract.py.",
         "// Placeable on the map. cat selects recipes · speed scales rate · energy = MW.",
         "// w/h = real in-game footprint · img = real entity sprite · radius = beacon range.",
         "export const BUILDINGS = {"]
for (k,name,icon,glyph_,cat,place,speed,energy,slots,cost,mul,unlock,recs) in BLD:
    img = build_sprite(k) or get_img(icon) or ""
    w, h = FOOT.get(k, (2, 2))
    unl = f"'{unlock}'" if unlock else "null"
    mil = " military:true," if cat == "military" else ""
    lines.append(f"  {k}: {{")
    lines.append(f"    name:'{name}', icon:'{glyph_}', img:'{img}', color:'#3a3a3a', cat:'{cat}', place:'{place}', w:{w}, h:{h},{mil}")
    lines.append(f"    speed:{speed}, energy:{energy}, slots:{slots}, baseCost:{jsdict(cost)}, costMul:{mul}, unlock:{unl},")
    lines.append(f"    recipes:{jsrecipes(recs)},")
    lines.append("  },")
# radius effect amplifier (no recipe) — boosts speed of buildings within `radius`
lines.append("  beacon: {")
lines.append(f"    name:'Beacon', icon:'❖', img:'{build_sprite('beacon') or ''}', color:'#2a6a8a', cat:'beacon', place:'land', w:3, h:3,")
lines.append("    speed:0, energy:3.5, slots:2, radius:3, baseCost:{steelPlate:10,advancedCircuit:20,copperCable:10,electronicCircuit:20}, costMul:1.2, unlock:'effectTransmission',")
lines.append("    recipes:[],")
lines.append("  },")
lines.append("};\n")
open(os.path.join(DATA,"buildings.js"),"w").write("\n".join(lines))
print("wrote buildings.js   craft:",len(craft_keys),"smelt:",len(smelt_keys),"chem:",len(chem_keys),"centrifuge:",len(centrifuge_keys))

# ---- integrity check -----------------------------------------------------
errs = []
for k,r in REC.items():
    for ing in r["inputs"]:
        if ing not in RES: errs.append(f"recipe {k}: input {ing} missing from RESOURCES")
allcat = {"mine":mine_keys,"oil":oil_keys,"pump":pump_keys,"smelt":smelt_keys,
          "craft":craft_keys,"chem":chem_keys,"refine":refine_keys,"centrifuge":centrifuge_keys}
for c,keys in allcat.items():
    for k in keys:
        if k not in RES: errs.append(f"building cat {c}: recipe {k} missing from RESOURCES")
print("INTEGRITY:", "OK" if not errs else ("\n  "+"\n  ".join(errs)))

# ---- enemy (biter) animations --------------------------------------------
# Factorio biters are rotated, multi-frame animations split across 4 huge sheets
# (body + tint masks + shadow). We use the body layer only (it already reads as a
# brown biter), and repack the frames we need into one compact, downscaled atlas
# per animation: rows = direction, cols = frame. The renderer picks a cell by the
# biter's facing direction and current frame. Layout per source: frame WxH, 8 cols,
# 8 rows per file, direction-major order  (idx = dir*frame_count + frame).
ENEMYDIR = os.path.join(ROOT, "assets/enemies"); os.makedirs(ENEMYDIR, exist_ok=True)
BITER = os.path.join(GFX, "entity/biter")
def biter_atlas(anim, frame_count, dirs, src_fw, src_fh, cols, rows_per_file, cw, ch, tint=None, out=None):
    if not Image: return None
    files = [Image.open(os.path.join(BITER, f"biter-{anim}-{i}.png")).convert("RGBA") for i in (1, 2, 3, 4)]
    per_file = cols * rows_per_file                             # frames per source sheet
    atlas = Image.new("RGBA", (cw * frame_count, ch * dirs))
    for d in range(dirs):
        for f in range(frame_count):
            idx = d * frame_count + f                           # direction-major sequential order
            fi, loc = idx // per_file, idx % per_file
            if fi >= len(files): continue
            col, row = loc % cols, loc // cols
            cell = files[fi].crop((col * src_fw, row * src_fh, col * src_fw + src_fw, row * src_fh + src_fh))
            if tint:                                            # blend the body toward a size colour
                (cr, cg, cb), fac = tint
                ov = Image.new("RGBA", cell.size, (cr, cg, cb, 0))
                ov.putalpha(cell.split()[3].point(lambda a: int(a * fac)))
                cell = cell.copy(); cell.alpha_composite(ov)
            cell = cell.resize((cw, ch), Image.LANCZOS)
            atlas.paste(cell, (f * cw, d * ch), cell)
    fn = out or f"biter-{anim}.png"
    atlas.save(os.path.join(ENEMYDIR, fn))
    return "assets/enemies/" + fn

CW, CH = 56, 44                                                 # atlas cell (matches biter frame aspect)
# size variants are the SAME biter sprite blended toward a colour (small = pale tan,
# medium = brown, big = dark red) — distinct on the map alongside their scale.
SIZE_TINT = {"small": ((232, 216, 150), 0.34), "medium": ((150, 112, 96), 0.12), "big": ((150, 56, 50), 0.46)}
imgs = {}
for size, tint in SIZE_TINT.items():
    suff = "" if size == "medium" else "-" + size
    imgs[size] = {
        "run": biter_atlas("run", 16, 16, 398, 310, 8, 8, CW, CH, tint=tint, out=f"biter-run{suff}.png"),
        "attack": biter_atlas("attack", 11, 16, 356, 348, 11, 4, CW, CH, tint=tint, out=f"biter-attack{suff}.png"),
    }
e_run, e_atk = imgs["medium"]["run"], imgs["medium"]["attack"]
# per-type gameplay + visual stats. `minIntensity` = pollution-intensity at which the type
# starts appearing; the renderer scales the sprite by `scale`. hp/speed/dps tune combat.
TYPE_STATS = {
    "small":  {"scale": 0.72, "hp": 14, "speed": 1.30, "dps": 4,  "minIntensity": 0.0},
    "medium": {"scale": 1.00, "hp": 32, "speed": 1.00, "dps": 6,  "minIntensity": 0.8},
    "big":    {"scale": 1.45, "hp": 90, "speed": 0.85, "dps": 11, "minIntensity": 2.5},
}
tlines = [f"    {k}: {{ run:'{imgs[k]['run']}', attack:'{imgs[k]['attack']}', "
          f"scale:{v['scale']}, hp:{v['hp']}, speed:{v['speed']}, dps:{v['dps']}, minIntensity:{v['minIntensity']} }},"
          for k, v in TYPE_STATS.items()]
elines = ["// data/enemies.js — AUTO-GENERATED by tools/extract.py.",
          "// Biter animation atlases (body layer, downscaled, tinted per size). rows = direction",
          "// (16, N=0 clockwise), cols = frame. `types` = small/medium/big variants that appear",
          "// past pollution-intensity thresholds, each with its own sprite/scale/combat stats.",
          "export const ENEMIES = {",
          "  biter: {",
          f"    run:    {{ img:'{e_run}', dirs:16, frames:16, cw:{CW}, ch:{CH}, fps:14 }},",
          f"    attack: {{ img:'{e_atk}', dirs:16, frames:11, cw:{CW}, ch:{CH}, fps:11 }},",
          "    types: {",
          *tlines,
          "    },",
          "  },",
          "};"]
open(os.path.join(DATA, "enemies.js"), "w").write("\n".join(elines) + "\n")
print("wrote enemies.js + biter atlases (small/medium/big × run/attack)")

# ---- terrain tiles + ore-on-ground sprites (for the map renderer) --------
# Grass comes from a 4096×576 sheet of 64px tile variants; ore from per-ore
# 1024×1024 sheets of 128px rock clusters. We crop a few good cells of each.
GFX = os.path.join(BASE, "graphics")
TERRAINDIR = os.path.join(ROOT, "assets/terrain")
# Factorio terrain tiles are edge-agnostic (any tile abuts any other seamlessly — that's
# why the game shows no grid). We assemble many solid variant tiles from a sheet into one
# big NxN texture; the renderer samples it by world coordinates, so the surface repeats
# only every N tiles, has no per-tile seams, and needs no rotation (tiles keep direction).
import random as _random
def _solid_cells(sheet, rrange, crange, keep=None):
    out = []
    for r in rrange:
        for c in crange:
            t = sheet.crop((c*64, r*64, c*64+64, r*64+64)).convert("RGBA")
            if min(p[3] for p in t.getdata()) < 250:        # skip transparent/edge cells
                continue
            if keep:
                px = list(t.convert("RGB").getdata()); n = len(px)
                R = sum(p[0] for p in px)/n; G = sum(p[1] for p in px)/n; B = sum(p[2] for p in px)/n
                if not keep(R, G, B):
                    continue
            out.append((c, r))
    return out
# overlay a translucent solid colour to pull a biome toward a common, harmonious tone
def _wash(img, color, alpha):
    ov = Image.new("RGBA", img.size, (color[0], color[1], color[2], int(alpha * 255)))
    return Image.alpha_composite(img.convert("RGBA"), ov)

def _build_atlas(sheet, cells, out_path, seed, N=8, tint=None, wash=None):
    if not cells:
        print("atlas skipped (no cells):", out_path); return
    rnd = _random.Random(seed)
    atlas = Image.new("RGBA", (N*64, N*64))
    for gy in range(N):
        for gx in range(N):
            c, r = rnd.choice(cells)
            cell = sheet.crop((c*64, r*64, c*64+64, r*64+64))
            atlas.paste(_tint(cell, tint) if tint else cell, (gx*64, gy*64))
    if wash:
        atlas = _wash(atlas, wash[0], wash[1])
    atlas.save(out_path)

# multiply-tint an RGBA tile by (tr,tg,tb), clamped to 0..255 (used for foliage + desert)
def _tint(img, t):
    r, g, b, a = img.split()
    r = r.point(lambda v: min(255, int(v * t[0])))
    g = g.point(lambda v: min(255, int(v * t[1])))
    b = b.point(lambda v: min(255, int(v * t[2])))
    return Image.merge("RGBA", (r, g, b, a))

def extract_terrain():
    if not Image: return
    os.makedirs(TERRAINDIR, exist_ok=True)
    # Biomes use sources that are NATURALLY close in gamut (the dark end of the grass &
    # dirt families) + a gentle darkening, so the whole world is a dim, cohesive earthy
    # palette that blends together rather than contrasting.
    def land(sheet, out, seed, keep=None):
        try:
            s = Image.open(os.path.join(GFX, "terrain/" + sheet)).convert("RGBA")
            _build_atlas(s, _solid_cells(s, range(1, 9), range(2, 40), keep), os.path.join(TERRAINDIR, out), seed)
        except Exception as e:
            print(out, "failed:", e)
    land("grass-2.png",      "grass-atlas.png",    0xA11, lambda R, G, B: G - (R + B) / 2 > 18)  # lush green cells
    land("dirt-7.png",       "drygrass-atlas.png", 0xB22)   # dark khaki-brown
    land("dirt-6.png",       "highland-atlas.png", 0xC33)   # dark brown
    land("red-desert-0.png", "desert-atlas.png",   0xD44)   # dark reddish-brown
    land("dry-dirt.png",     "sand-atlas.png",     0xE55)   # slightly lighter beach
    # water: deep water darkened further for a moodier look
    try:
        w = Image.open(os.path.join(GFX, "terrain/deepwater/deepwater1.png")).convert("RGBA")
        wcells = _solid_cells(w, range(0, w.height // 64), range(0, w.width // 64))
        _build_atlas(w, wcells, os.path.join(TERRAINDIR, "water-atlas.png"), 0xF66, tint=(0.62, 0.66, 0.7))
    except Exception as e:
        print("water atlas failed:", e)
    # ore clusters: 4 full cells per ore, keyed by the in-game resource key
    ore_src = {"ironOre":"iron-ore","copperOre":"copper-ore","coal":"coal","stone":"stone","uraniumOre":"uranium-ore"}
    cells = [(0,0),(1,1),(2,2),(3,0)]
    for reskey, name in ore_src.items():
        try:
            o = Image.open(os.path.join(GFX, f"entity/{name}/{name}.png"))
            for i,(c,r) in enumerate(cells):
                o.crop((c*128, r*128, c*128+128, r*128+128)).save(os.path.join(TERRAINDIR, f"ore-{reskey}-{i}.png"))
        except Exception as e:
            print(f"ore extract failed ({name}):", e)
    # crude oil: a strip of 5 oily-seep frames — take 4 as the on-ground "ore" sprites
    try:
        oil = Image.open(os.path.join(GFX, "entity/crude-oil/crude-oil.png")).convert("RGBA")
        fw = oil.width // 5
        for i in range(4):
            oil.crop((i*fw, 0, i*fw+fw, oil.height)).save(os.path.join(TERRAINDIR, "ore-crudeOil-%d.png" % i))
    except Exception as e:
        print("crude-oil extract failed:", e)
    print("wrote terrain tiles to assets/terrain/")
extract_terrain()

# ---- biome decoratives (grass tufts, dry bushes, desert shrubs) ----------
# Single transparent sprites copied as-is, grouped by biome so each terrain gets
# decoratives that match its palette. Sizes recorded for correct aspect at draw.
import glob
DECOR_BIOME = {
    "grass":    ["green-small-grass", "green-hairy-grass", "green-bush-mini"],
    "drygrass": ["brown-hairy-grass", "brown-fluff-dry", "garballo"],
    "desert":   ["red-desert-bush", "red-croton", "garballo-mini-dry"],
}
def extract_decor():
    if not Image: return
    ddir = os.path.join(ROOT, "assets/decor"); os.makedirs(ddir, exist_ok=True)
    groups = {}
    for biome, sets in DECOR_BIOME.items():
        out = []
        for d in sets:
            for i, f in enumerate(sorted(glob.glob(os.path.join(GFX, "decorative", d, "*.png")))[:3]):
                try:
                    im = Image.open(f); dst = f"decor-{biome}-{d}-{i}.png"
                    im.save(os.path.join(ddir, dst))
                    out.append((f"assets/decor/{dst}", im.width, im.height))
                except Exception as e:
                    print(f"decor failed ({d}):", e)
        groups[biome] = out
    body = ["// data/decor.js — AUTO-GENERATED by tools/extract.py. Per-biome decoratives.",
            "// DECOR[biome] = [{src,w,h}] — w/h are native px (≈64/tile) for aspect.",
            "export const DECOR = {"]
    for biome, out in groups.items():
        body.append(f"  {biome}: [" + ", ".join(f"{{src:'{s}',w:{w},h:{h}}}" for (s, w, h) in out) + "],")
    body.append("};\n")
    open(os.path.join(ROOT, "js/data/decor.js"), "w").write("\n".join(body))
    print("wrote decoratives for", list(groups), "+ js/data/decor.js")
extract_decor()

# ---- obstacles: trees (composited) + boulders (rocks) --------------------
# Trees are layered sprites: a trunk sheet + a leaves sheet (the leaves sheet
# packs several wind frames side by side). We take the first leaf frame, stack
# it on the trunk, autocrop, and save one flat tree PNG. Rocks are single
# decorative sprites copied as-is. Sizes go to js/data/obstacles.js for aspect.
TREE_PICKS = [("02","a"),("09","d"),("03","a"),("01","a"),("09","a"),("09","b")]
ROCK_PICKS = ["big-rock/big-rock-01","big-rock/big-rock-06","big-rock/big-rock-12",
              "huge-rock/huge-rock-03","huge-rock/huge-rock-08","medium-rock/medium-rock-03"]
# Factorio tree leaves are authored near-neutral and tinted green at runtime; we
# bake a foliage tint so they don't read as washed-out pink/grey on the map.
LEAF_TINT = (0.58, 0.82, 0.40)
def _compose_tree(tnum, var):
    base = os.path.join(GFX, "entity/tree", tnum)
    trunk = Image.open(os.path.join(base, f"tree-{tnum}-{var}-trunk.png")).convert("RGBA")
    leaves = Image.open(os.path.join(base, f"tree-{tnum}-{var}-leaves.png")).convert("RGBA")
    frames = max(1, round(leaves.width / trunk.width))
    leaf = _tint(leaves.crop((0, 0, leaves.width // frames, leaves.height)), LEAF_TINT)
    W = max(trunk.width, leaf.width); CH = int(trunk.height * 1.4)
    c = Image.new("RGBA", (W, CH), (0, 0, 0, 0))
    c.alpha_composite(trunk, ((W - trunk.width) // 2, CH - trunk.height))
    c.alpha_composite(leaf, ((W - leaf.width) // 2, CH - trunk.height - int(leaf.height * 0.55)))
    bb = c.getbbox()
    return c.crop(bb) if bb else c
# dead/dry trees for the other biomes are SINGLE sprites (no leaf layer); copied as-is.
# Each tree TYPE is biome-specific; rocks are shared across every biome.
DRY_TREES = {
    "tree-drygrass": ["dry-hairy-tree/dry-hairy-tree-00", "dry-hairy-tree/dry-hairy-tree-02", "dry-hairy-tree/dry-hairy-tree-04"],
    "tree-desert":   ["dead-tree-desert/dead-tree-desert-00", "dead-tree-desert/dead-tree-desert-02", "dry-tree/dry-tree-00", "dry-tree/dry-tree-02"],
    "tree-highland": ["dead-grey-trunk/dead-grey-trunk-00", "dead-grey-trunk/dead-grey-trunk-02", "dead-grey-trunk/dead-grey-trunk-04"],
}
def extract_obstacles():
    if not Image: return
    odir = os.path.join(ROOT, "assets/obstacles"); os.makedirs(odir, exist_ok=True)
    def save(im, dst): im.save(os.path.join(odir, dst)); return (f"assets/obstacles/{dst}", im.width, im.height)
    types = {}                       # obstacle type key -> list of (src,w,h)
    # grass: composited green trees
    g = []
    for i, (tn, v) in enumerate(TREE_PICKS):
        try: g.append(save(_compose_tree(tn, v), f"tree-grass-{i}.png"))
        except Exception as e: print(f"tree {tn}-{v} failed:", e)
    types["tree-grass"] = g
    # dry/dead biome trees (single sprites)
    for key, rels in DRY_TREES.items():
        lst = []
        for i, rel in enumerate(rels):
            try: lst.append(save(Image.open(os.path.join(GFX, "entity/tree", rel + ".png")).convert("RGBA"), f"{key}-{i}.png"))
            except Exception as e: print(f"{key} {rel} failed:", e)
        types[key] = lst
    # rocks (any biome)
    rocks = []
    for i, rel in enumerate(ROCK_PICKS):
        try: rocks.append(save(Image.open(os.path.join(GFX, "decorative", rel + ".png")).convert("RGBA"), f"rock-{i}.png"))
        except Exception as e: print(f"rock {rel} failed:", e)
    types["rock"] = rocks
    def arr(items): return "[" + ", ".join(f"{{src:'{s}',w:{w},h:{h}}}" for (s, w, h) in items) + "]"
    YIELD = {"tree-grass": "{wood:2}", "tree-drygrass": "{wood:1}", "tree-desert": "{wood:1}",
             "tree-highland": "{wood:1}", "rock": "{stone:6,coal:3}"}
    LABEL = {"rock": "Boulder"}
    js = ["// data/obstacles.js — AUTO-GENERATED by tools/extract.py.",
          "// Per-biome obstacles: clear them for resources; you cannot build on them.",
          "// kind drives the i18n label; `yield` is granted once on clearing.",
          "export const OBSTACLES = {"]
    for key, items in types.items():
        kind = "rock" if key == "rock" else "tree"
        js.append(f"  '{key}': {{ kind:'{kind}', label:'{LABEL.get(key,'Tree')}', yield:{YIELD[key]}, sprites:{arr(items)} }},")
    js.append("};\n")
    open(os.path.join(ROOT, "js/data/obstacles.js"), "w").write("\n".join(js))
    print("wrote obstacles:", {k: len(v) for k, v in types.items()})
extract_obstacles()

# ---- crop any remaining mipmap strips in assets/icons (idempotent) -------
if Image:
    fixed = 0
    for fn in os.listdir(ICONDIR):
        if fn.endswith(".png"):
            p = os.path.join(ICONDIR, fn)
            try:
                im = Image.open(p)
                if im.width > im.height:
                    im.crop((0, 0, im.height, im.height)).save(p); fixed += 1
            except Exception: pass
    print("cropped mipmap strips:", fixed)

# ============================================================================
# Full technology tree (real dependency graph) + recipe→tech gating
# ============================================================================
tech_txt = read("technology.lua")
def _list_strs(s):
    return re.findall(r'"([^"]+)"', s) if s else []
def _between(blk, key):
    m = re.search(rf'\b{key}\s*=\s*\{{', blk)
    if not m: return None
    i = m.end() - 1; depth = 0; j = i
    while j < len(blk):
        if blk[j] == '{': depth += 1
        elif blk[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    return blk[i:j+1]

TECHS = {}            # name -> {prereqs, cost{sciKey:n}, recipes[], mods[], infinite}
RECIPE_TECH = {}      # factorio recipe name -> first tech name that unlocks it
TECH_ORDER = []
for blk in blocks_with_type(tech_txt, "technology"):
    name = field(blk, "name")
    if not name: continue
    pm = re.search(r'prerequisites\s*=\s*\{([^}]*)\}', blk)
    prereqs = _list_strs(pm.group(1)) if pm else []
    unit = _between(blk, "unit") or ""
    infinite = "count_formula" in unit
    cm = re.search(r'count\s*=\s*(\d+)', unit)
    count = int(cm.group(1)) if cm else 0
    ing = _between(unit, "ingredients") or ""
    cost = {}
    for pk, n in re.findall(r'\{\s*"([^"]+)"\s*,\s*(\d+)\s*\}', ing):
        cost[key(pk)] = cost.get(key(pk), 0) + count * int(n)
    eff = _between(blk, "effects") or ""
    recipes = re.findall(r'recipe\s*=\s*"([^"]+)"', eff)
    mods = re.findall(r'type\s*=\s*"([a-z-]+)"', eff)
    # bullet-ammo weapon upgrades that our gun turrets actually use
    wdmg = wspd = 0.0
    for em in re.finditer(r'\{([^{}]*)\}', eff):
        e = em.group(1)
        tm = re.search(r'type\s*=\s*"([^"]+)"', e); mm = re.search(r'modifier\s*=\s*([\d.]+)', e)
        cm2 = re.search(r'ammo_category\s*=\s*"([^"]+)"', e)
        if not (tm and mm) or (cm2 and cm2.group(1) != "bullet"): continue
        if tm.group(1) == "ammo-damage": wdmg += float(mm.group(1))
        elif tm.group(1) == "gun-speed":  wspd += float(mm.group(1))
    TECHS[name] = {"prereqs": prereqs, "cost": cost, "recipes": recipes, "mods": mods,
                   "infinite": infinite, "wdmg": round(wdmg, 3), "wspd": round(wspd, 3)}
    TECH_ORDER.append(name)
    for rc in recipes:
        RECIPE_TECH.setdefault(rc, name)

# finite, reachable techs only (skip infinite upgrade techs)
TKEEP = {n for n in TECH_ORDER if not TECHS[n]["infinite"]}

# attach `tech` to our recipes (camel-keyed). Oil/fluid overrides get a sensible tech.
FLUID_TECH = {"petroleumGas":"oil-processing","heavyOil":"oil-processing","lightOil":"oil-processing",
              "solidFuel":"oil-processing","sulfuricAcid":"sulfur-processing","lubricant":"lubricant"}
for rname, tname in RECIPE_TECH.items():
    ck = key(rname)
    if ck in REC and tname in TKEEP:
        REC[ck]["tech"] = key(tname)
for ck, tname in FLUID_TECH.items():
    if ck in REC and tname in TKEEP:
        REC[ck]["tech"] = key(tname)
emit_recipes()      # re-emit with tech gating

# tier = longest path from a root through prerequisites (only kept techs)
_tier_memo = {}
def _tier(n):
    if n in _tier_memo: return _tier_memo[n]
    _tier_memo[n] = 1
    reqs = [p for p in TECHS[n]["prereqs"] if p in TKEEP]
    t = 1 + (max((_tier(p) for p in reqs), default=0))
    _tier_memo[n] = t
    return t

def _effect(name, info):
    e = {}
    if name == "modules": e["unlockModules"] = True
    if name == "rocket-silo": e["unlockRocket"] = True
    if any("mining" in m and "productivity" in m for m in info["mods"]): e["globalYield"] = 0.05
    if any(m == "laboratory-speed" for m in info["mods"]): e["globalSpeed"] = 0.05
    if info.get("wdmg"): e["weaponDamage"] = info["wdmg"]   # +% gun-turret bullet damage
    if info.get("wspd"): e["weaponSpeed"]  = info["wspd"]   # +% gun-turret firing speed
    return e

def _name(n): return " ".join(w.capitalize() for w in n.split("-"))
def _desc(name, info):
    recs = [r for r in dict.fromkeys(info["recipes"]) if not r.endswith("-barrel")]
    if recs:
        names = [_name(r) for r in recs[:6]]
        extra = len(recs) - 6
        d = "Unlocks: " + ", ".join(names) + (f" +{extra} more" if extra > 0 else "")
    elif any("mining" in m and "productivity" in m for m in info["mods"]):
        d = "Bonus: +mining productivity"
    elif any(m == "laboratory-speed" for m in info["mods"]):
        d = "Bonus: +research speed"
    elif name == "modules":
        d = "Unlocks module slots in machines"
    elif name == "rocket-silo":
        d = "Unlocks the rocket silo — launch to prestige"
    elif info.get("wdmg") and info.get("wspd"):
        d = f"Bonus: +{int(info['wdmg']*100)}% turret damage, +{int(info['wspd']*100)}% firing speed"
    elif info.get("wdmg"):
        d = f"Bonus: +{int(info['wdmg']*100)}% gun-turret damage"
    elif info.get("wspd"):
        d = f"Bonus: +{int(info['wspd']*100)}% gun-turret firing speed"
    elif info["mods"]:
        d = "Bonus: combat / equipment upgrade"
    else:
        d = ""
    return d.replace("\\", "").replace("'", "\\'")
rows = sorted(TKEEP, key=lambda n: (_tier(n), n))
tlines = ["// data/tech.js — AUTO-GENERATED from Factorio technology.lua by tools/extract.py.",
          "// Full dependency graph; cost = science packs (count×qty); recipes are gated via",
          "// the `tech` field in recipes.js. effect: unlockModules/unlockRocket/global bonuses.",
          "export const TECH = {"]
for n in rows:
    info = TECHS[n]
    req = [key(p) for p in info["prereqs"] if p in TKEEP]
    cost = info["cost"]
    eff = _effect(n, info)
    costjs = "{" + ",".join(f"{k}:{v}" for k, v in cost.items()) + "}"
    reqjs = "[" + ",".join(f"'{r}'" for r in req) + "]"
    effjs = "{" + ",".join(f"{k}:{('true' if v is True else v)}" for k, v in eff.items()) + "}"
    tlines.append(f"  {key(n)}: {{name:'{_name(n)}', tier:{_tier(n)}, icon:'🔬', "
                  f"cost:{costjs}, req:{reqjs}, desc:'{_desc(n, info)}', effect:{effjs}}},")
tlines.append("};\n")
open(os.path.join(DATA, "tech.js"), "w").write("\n".join(tlines))
print("wrote tech.js:", len(rows), "technologies; recipe→tech gated:",
      sum(1 for k in REC if REC[k].get("tech")))
