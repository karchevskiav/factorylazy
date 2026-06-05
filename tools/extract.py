#!/usr/bin/env python3
"""Extract sciences + resource chain from the Factorio Lua data into the
idle game's JS data tables (resources.js / recipes.js / tech.js).

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
        lines.append(f"  {k+':':24} {{out:{v['out']}, time:{v['time']}, inputs:{ins}, cat:'{v['cat']}'}},")
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
  ("burnerDrill",    "Burner Mining Drill","burner-mining-drill",'⛏','mine','ore',  1,  0,0,{"ironPlate":5},1.18,None,           mine_keys),
  ("offshorePump",   "Offshore Pump",      "offshore-pump",      '🚰','pump','land', 1,  0,0,{"ironPlate":3},1.10,None,           pump_keys),
  ("pumpjack",       "Pumpjack",           "pumpjack",           '🛢','oil','land',  1,  1,0,{"ironGearWheel":10,"steelPlate":5,"electronicCircuit":5,"pipe":10},1.2,"oilProcessing", oil_keys),
  ("stoneFurnace",   "Stone Furnace",      "stone-furnace",      '🔥','smelt','land',1,  0,0,{"stone":5},1.15,None,                smelt_keys),
  ("electricFurnace","Electric Furnace",   "electric-furnace",   '🔥','smelt','land',2,  2,2,{"steelPlate":10,"stoneBrick":10,"advancedCircuit":5},1.2,"advancedMaterials", smelt_keys),
  ("assembler1",     "Assembling Machine 1","assembling-machine-1",'🔧','craft','land',0.5,0.75,0,{"ironPlate":9,"copperPlate":5},1.18,None, craft_keys),
  ("assembler2",     "Assembling Machine 2","assembling-machine-2",'🔧','craft','land',0.75,1.5,2,{"steelPlate":5,"ironGearWheel":10,"electronicCircuit":5},1.2,"automation2", craft_keys),
  ("assembler3",     "Assembling Machine 3","assembling-machine-3",'🔧','craft','land',1.25,3.5,4,{"steelPlate":20,"advancedCircuit":10,"processingUnit":5},1.22,"automation3", craft_keys),
  ("chemPlant",      "Chemical Plant",     "chemical-plant",     '⚗','chem','land',  1,  2.1,2,{"steelPlate":5,"ironGearWheel":5,"electronicCircuit":5,"pipe":5},1.2,"oilProcessing", chem_keys),
  ("centrifuge",     "Centrifuge",         "centrifuge",         '☢','centrifuge','land',1,3.5,2,{"steelPlate":50,"advancedCircuit":20,"ironGearWheel":50,"concrete":100},1.25,"automation3", centrifuge_keys),
]
for g in ("steam-engine","solar-panel"): get_img(g)  # ensure generator icons exist in assets

lines = ["// data/buildings.js — AUTO-GENERATED by tools/extract.py.",
         "// Placeable on the map (2x2 each). cat selects recipes · speed scales rate · energy = MW.",
         "// place:'ore' = drill must cover matching ore · img = map sprite · radius = beacon range.",
         "export const BUILDINGS = {"]
for (k,name,icon,glyph_,cat,place,speed,energy,slots,cost,mul,unlock,recs) in BLD:
    img = get_img(icon) or ""
    unl = f"'{unlock}'" if unlock else "null"
    lines.append(f"  {k}: {{")
    lines.append(f"    name:'{name}', icon:'{glyph_}', img:'{img}', color:'#3a3a3a', cat:'{cat}', place:'{place}', w:2, h:2,")
    lines.append(f"    speed:{speed}, energy:{energy}, slots:{slots}, baseCost:{jsdict(cost)}, costMul:{mul}, unlock:{unl},")
    lines.append(f"    recipes:{jsrecipes(recs)},")
    lines.append("  },")
# radius effect amplifier (no recipe) — boosts speed of buildings within `radius`
lines.append("  beacon: {")
lines.append(f"    name:'Beacon', icon:'❖', img:'{get_img('beacon') or ''}', color:'#2a6a8a', cat:'beacon', place:'land', w:2, h:2,")
lines.append("    speed:0, energy:3.5, slots:2, radius:3, baseCost:{steelPlate:10,advancedCircuit:20,copperCable:10,electronicCircuit:20}, costMul:1.2, unlock:'modules',")
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
def _build_atlas(sheet, cells, out_path, seed, N=8):
    if not cells:
        print("atlas skipped (no cells):", out_path); return
    rnd = _random.Random(seed)
    atlas = Image.new("RGBA", (N*64, N*64))
    for gy in range(N):
        for gx in range(N):
            c, r = rnd.choice(cells)
            atlas.paste(sheet.crop((c*64, r*64, c*64+64, r*64+64)), (gx*64, gy*64))
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
    # grass (lush green) + drygrass (olive, the grass→highland intermediate biome)
    try:
        g = Image.open(os.path.join(GFX, "terrain/grass-1.png")).convert("RGBA")
        green = _solid_cells(g, range(1, 9), range(2, 40), lambda R, G, B: G - (R + B) / 2 > 20)
        olive = _solid_cells(g, range(1, 9), range(2, 40), lambda R, G, B: 8 <= G - (R + B) / 2 <= 19)
        _build_atlas(g, green, os.path.join(TERRAINDIR, "grass-atlas.png"), 0xA11)
        _build_atlas(g, olive, os.path.join(TERRAINDIR, "drygrass-atlas.png"), 0xB22)
    except Exception as e:
        print("grass atlas failed:", e)
    # highland: rocky brown upland from dirt-4
    try:
        dd = Image.open(os.path.join(GFX, "terrain/dirt-4.png")).convert("RGBA")
        _build_atlas(dd, _solid_cells(dd, range(1, 9), range(2, 40)), os.path.join(TERRAINDIR, "highland-atlas.png"), 0xC33)
    except Exception as e:
        print("highland atlas failed:", e)
    # desert: red-desert pushed toward vivid orange
    try:
        rd = Image.open(os.path.join(GFX, "terrain/red-desert-3.png")).convert("RGBA")
        cells = _solid_cells(rd, range(1, 9), range(2, 40))
        if cells:
            rnd = _random.Random(0xD44); a = Image.new("RGBA", (8 * 64, 8 * 64))
            for gy in range(8):
                for gx in range(8):
                    c, r = rnd.choice(cells)
                    a.paste(_tint(rd.crop((c*64, r*64, c*64+64, r*64+64)), (1.18, 0.92, 0.62)), (gx*64, gy*64))
            a.save(os.path.join(TERRAINDIR, "desert-atlas.png"))
    except Exception as e:
        print("desert atlas failed:", e)
    # sand atlas
    try:
        sd = Image.open(os.path.join(GFX, "terrain/sand-1.png")).convert("RGBA")
        sand = _solid_cells(sd, range(2, 16), range(2, 40), lambda R, G, B: (R + G + B) / 3 > 110)
        _build_atlas(sd, sand, os.path.join(TERRAINDIR, "sand-atlas.png"), 0xC33)
    except Exception as e:
        print("sand atlas failed:", e)
    # water atlas (water1 is a single row of solid variants)
    try:
        w = Image.open(os.path.join(GFX, "terrain/water/water1.png")).convert("RGBA")
        wcells = _solid_cells(w, range(0, w.height // 64), range(0, w.width // 64))
        _build_atlas(w, wcells, os.path.join(TERRAINDIR, "water-atlas.png"), 0xD44)
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

# ---- scatter decoratives (grass tufts, small rocks) ----------------------
# Single transparent sprites (NOT mipmap strips) — copied as-is; sizes recorded
# in js/data/decor.js so the renderer keeps each sprite's real aspect ratio.
import glob
DECOR_SETS = ["green-small-grass","green-hairy-grass","green-bush-mini","small-rock","tiny-rock","medium-rock"]
def extract_decor():
    if not Image: return
    ddir = os.path.join(ROOT, "assets/decor"); os.makedirs(ddir, exist_ok=True)
    out = []
    for d in DECOR_SETS:
        files = sorted(glob.glob(os.path.join(GFX, "decorative", d, "*.png")))[:3]
        for i, f in enumerate(files):
            try:
                im = Image.open(f)
                dst = f"decor-{d}-{i}.png"
                im.save(os.path.join(ddir, dst))
                out.append((f"assets/decor/{dst}", im.width, im.height))
            except Exception as e:
                print(f"decor failed ({d}):", e)
    body = ["// data/decor.js — AUTO-GENERATED by tools/extract.py. Map terrain decoratives.",
            "// {src, w, h} — w/h are the sprite's native pixel size (≈64px per tile) for aspect.",
            "export const DECOR = ["]
    for (src, w, h) in out:
        body.append(f"  {{src:'{src}', w:{w}, h:{h}}},")
    body.append("];\n")
    open(os.path.join(ROOT, "js/data/decor.js"), "w").write("\n".join(body))
    print("wrote", len(out), "decoratives + js/data/decor.js")
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
def extract_obstacles():
    if not Image: return
    odir = os.path.join(ROOT, "assets/obstacles"); os.makedirs(odir, exist_ok=True)
    trees, rocks = [], []
    for i, (tn, v) in enumerate(TREE_PICKS):
        try:
            im = _compose_tree(tn, v); dst = f"tree-{i}.png"
            im.save(os.path.join(odir, dst)); trees.append((f"assets/obstacles/{dst}", im.width, im.height))
        except Exception as e: print(f"tree {tn}-{v} failed:", e)
    for i, rel in enumerate(ROCK_PICKS):
        try:
            im = Image.open(os.path.join(GFX, "decorative", rel + ".png")).convert("RGBA")
            dst = f"rock-{i}.png"; im.save(os.path.join(odir, dst))
            rocks.append((f"assets/obstacles/{dst}", im.width, im.height))
        except Exception as e: print(f"rock {rel} failed:", e)
    def arr(items): return "[" + ", ".join(f"{{src:'{s}',w:{w},h:{h}}}" for (s, w, h) in items) + "]"
    js = ["// data/obstacles.js — AUTO-GENERATED by tools/extract.py.",
          "// Map obstacles: clear them for resources; you cannot build on them.",
          "// `yield` is granted once when an obstacle is cleared; sprites carry native size.",
          "export const OBSTACLES = {",
          f"  tree: {{ kind:'tree', label:'Tree', yield:{{wood:2}}, sprites:{arr(trees)} }},",
          f"  rock: {{ kind:'rock', label:'Boulder', yield:{{stone:6,coal:3}}, sprites:{arr(rocks)} }},",
          "};\n"]
    open(os.path.join(ROOT, "js/data/obstacles.js"), "w").write("\n".join(js))
    print("wrote", len(trees), "trees +", len(rocks), "rocks + js/data/obstacles.js")
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
