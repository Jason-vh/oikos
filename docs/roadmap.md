# Zeus + Poseidon — feature inventory and roadmap

Every system in *Zeus: Master of Olympus* (2000) and *Poseidon: Master of Atlantis*
(2001), with the numbers that define them, ordered as a build plan.

Sources are fan-documented game data and the shipped manuals, not memory:
Zeus Heaven ([buildings](https://zeus.heavengames.com/buildings/building-model-data/),
[housing](https://zeus.heavengames.com/gameinfo/housinglevels/),
[appeal](https://zeus.heavengames.com/gameinfo/appeal/),
[walkers](https://zeus.heavengames.com/units/),
[production](https://zeus.heavengames.com/gameinfo/industry-production/),
[taxation](https://zeus.heavengames.com/gameinfo/taxation/),
[sanctuaries](https://zeus.heavengames.com/gameinfo/sanctuaries/),
[heroes](https://zeus.heavengames.com/gameinfo/heroes/),
[monsters](https://zeus.heavengames.com/gameinfo/monsters/),
[quests](https://zeus.heavengames.com/gameinfo/quests/),
[pyramids](https://zeus.heavengames.com/gameinfo/pyramids/),
[enemies](https://zeus.heavengames.com/gameinfo/enemy-information/)),
the [Zeus manual](https://archive.org/details/Zeus_-_Manual), the
[Poseidon manual](https://archive.org/details/Zeus_-_Poseidon_-_Manual),
the [Adventure Editor manual](https://archive.org/details/Zeus_-_Poseidon_-_Adventure_Editor_-_Manual),
and the Prima strategy guide.

Status against this repo: ✅ shipped · 🟡 partial · ⬜ not started.

---

## Phase 0 — foundations (mostly shipped)

| Feature | Status | Notes |
| --- | --- | --- |
| Isometric tile grid, elevation, terrain classes | ✅ | Zeus terrain classes: grass, meadow (purple tufts — farms/orchards/livestock only), rock, water, forest, and resource outcrops (silver, copper, orichalc, black marble, white marble) |
| Roads as the only social network | ✅ | Road cost 2/2/3/4/5 by difficulty; clear land 1/2/2/2/3 |
| Roaming and destination walkers | ✅ | Ranges, exit points, out-and-back patrols and roadblocks |
| Housing evolution | ✅ | All 7 common tiers on a 2×2 plot; the 4 elite tiers are not started |
| Appeal ("desirability") field | ✅ | Band model in `src/sim/appeal.ts`; housing is a source, gates apply from the third tier up |
| Build cost + treasury | 🟡 | Wages and taxes are in; trade and debt are not |
| Save/load | 🟡 | `src/sim/save.ts` |
| Time: 20 Hz tick, month/year clock | ✅ | Game year = 12 months; production and consumption are per-month/per-year |

### Appeal model

Every building has four appeal parameters: **INI** (value on ring 1), **SZE** (tiles
per band), **STP** (change per band), **RNG** (number of tiles reached).

```
appeal(d) = INI + STP * floor((d - 1) / SZE)   for 1 <= d <= RNG
```

Flower garden `8,1,-1,3` → 8,7,6. Fish pond `18,1,-3,6` → 18,15,12,9,6,3.
Agora `12,2,-2,6` → 12,12,10,10,8,8. Exceptions that break the rule: palace,
horse ranch, pier, boulevard/avenue. College and university *increase* their
penalty with distance (`-5,-8,-11`).

Reference values (ring 1 → ring RNG):

| Positive | Values | Negative | Values |
| --- | --- | --- | --- |
| Sanctuary (any) | 20,18,16,14,12,10 | Fishery / urchin quay | −15,−13,−11,−9 |
| Commemorative monument | 30,30,25,25,20,20 | Granary | −12,−10,−8,−6 |
| Palace | 18×3, 15×3 | Corral (Poseidon) | −12,−12,−11,−11,−10 |
| Fish pond | 18…3 | Trireme wharf | −12,−12,−10,−10 |
| Hero hall | 15,15,13,13,11,11 | Mint / foundry | −10 falling to −5/−6 |
| Hedge maze | 12,11,10,9 | Horse ranch, chariot maker | −10,−9,−8,−7 |
| Agora, museum | 12,12,10,10(,8,8) | Armory | −8,−7,−6,−5 |
| Flower garden | 8,7,6 | Hunting lodge | −6,−6,−8,−8 |
| Observatory | 7,6,5,4 | Masonry shop, black marble | −6,−5,−4,−3 |
| Theater, gazebo | 6,5,4(,3,2,1) | Carding shed, dairy | −5,−3,−1 |
| Fountain, column, winery | 4,4,2,2 / 4,2,0 / 4,3,2,1 | Timber mill | −5,−4,−3,−2 |
| Podium, park, bench, bibliotheke | ~3,2,1 | Tax office | −4,−3 |
| Elite housing (residence→estate) | 2,2,1,1 → 6,6,5,5 | Wheat/carrot/onion farm | −3,−2,−1 / −4,−4,−3 / −2,−1 |

---

## Phase 1 — population and labour

**Housing ladder.** Two parallel tracks. Common housing is 2×2, elite housing is
4×4 and must be *placed* (100–300 dr) on high appeal with 2 food, 1 fleece, 1 oil
in stock.

| Common | Pop | New requirement | Culture pts | Soldiers |
| --- | --- | --- | --- | --- |
| Hut | 8 | — | 0 | 0 |
| Shack | 16 | food | 0 | 0 |
| Hovel | 24 | water + 1 culture/science | 15 | 5 |
| Homestead | 32 | fleece + appeal | 15 | 6 |
| Tenement | 40 | 2nd culture/science | 35 | 10 |
| Apartment | 48 | olive oil + appeal | 35 | 12 |
| Townhouse | 60 | 3rd culture/science + appeal | 45 | 15 |

| Elite | Pop | New requirement | Culture pts | Soldiers |
| --- | --- | --- | --- | --- |
| Residence | 6 | food, fleece, oil, 3 culture types | 40–50 | 0 |
| Mansion | 10 | + armor | 50–60 | 2 hoplites |
| Manor | 16 | + wine | 60–70 | 4 hoplites |
| Estate | 20 | + horses (stores 4), all culture | 70–80 | 4 horsemen |

Appeal gates (Beginner → Olympian): townhouse evolves at 100 appeal and devolves
below 25–35; residence needs 36→50, estate 66→80. Every threshold is a
difficulty-scaled table, not a constant.

**Consumption** (per fully occupied house per month): food 0.25/person; fleece 2;
olive oil 2; wine 2 (manor/estate); estate horses eat 0.25 each. Storage unit
conversion: **1 cartload in a granary = 100 units in an agora**.

**Labour.** Only a fraction of the population works, set by difficulty and wage rate:

| Difficulty | Wages none | very low | low | normal | high | very high |
| --- | --- | --- | --- | --- | --- | --- |
| Beginner | 42% | 46 | 49 | 52 | 55 | 57 |
| Mortal | 37% | 41 | 44 | 47 | 50 | 52 |
| Hero | 32% | 36 | 39 | 42 | 45 | 47 |
| Titan | 29% | 33 | 36 | 39 | 42 | 44 |
| Olympian | 27% | 31 | 34 | 37 | 40 | 42 |

Wage cost per worker per year: 0 / 2 / 2.5 / 3 / 3.4 / 4 drachmas. Buildings run
at reduced output when understaffed; the workforce is allocated by priority tab.

**Immigration** is driven by popularity: high wages, low taxes, stocked food, low
unemployment, low debt, few false calls to arms. Settlers and emigrants walk off-road.

🟡 Both housing ladders are in `src/sim/buildings.ts`: seven common tiers on a 2×2
plot that grow on food, water, culture, oil and appeal, and four elite tiers on a
placed 4×4 plot that costs 200 dr and refuses ground below appeal 20 — Residence 6,
Mansion 10, Manor 16, Estate 20, each paying tax at the Mortal noble multiplier of 18
and evolving at appeal 36, 50 and 66. Fleece, armour, wine and horses, the culture
type counts and the difficulty-scaled thresholds are not started.

🟡 Popularity and migration shipped in `src/sim/popularity.ts`: monthly sentiment from
wages, taxes, food, unemployment and debt, with settlers filling empty rooms and
emigrants leaving an unhappy city. Labour shipped in `src/sim/labour.ts`: the Mortal worker-share table, the six wage
levels and their yearly cost, priority-ordered staffing, and output scaled by how
staffed a building is. Housing ladder, consumption and immigration are not started.

---

## Phase 2 — the walker system, properly

| Walker | Building | Roam range (tiles) |
| --- | --- | --- |
| Water carrier | Fountain | 27 |
| Healer | Infirmary | 27 |
| Clerk | Tax office | 35 |
| Philosopher / athlete / actor / competitor | Podium / gymnasium / theater / stadium | 35 |
| Scholar / astronomer / inventor / curator | Bibliotheke / observatory / laboratory / museum | 35 |
| Peddler | Agora | 44 |
| Superintendent | Maintenance office | 44 |
| Watchman | Watchpost | 44 |

Speeds in tiles/month: standard citizen 54.4; hunter/rabble/archer 72.53; god,
hero, monster, wolf, boar, deer 68; goat/cattle 40.8; plagued citizen 13.6;
trade ship 95.2; horseman/chariot 108.8; deliveryman blessed by Hermes 68.

Rules worth reproducing exactly, because city layout is built on them:

- **Exit point**: search clockwise from north of the footprint; first road tile found
  is the exit *and* entry — except fountains and infirmaries, whose walkers return
  to the tile due north, which lets a loop exceed the nominal range.
- **Roadblocks** stop roaming walkers, not destination walkers. Gatehouses do the same.
- Roaming walkers walk out N tiles then return by the shortest road.
- Some walkers leave the road entirely: herders, miners, lumberjacks, artisans,
  soldiers, immigrants, emigrants, vagrants, deliverymen collecting goods,
  superintendents fighting fires.
- Culture walkers switch mode: destination walker to their venue, roaming after.

🟡 Ranges, the exit-point rule (with the fountain's due-north entry), shortest-road
returns, roadblocks and culture walkers switching mode are in. Gatehouses and
off-road walkers are not.

---

## Phase 3 — production chains

**Husbandry** (all on meadow unless noted):

| Building | Size | Workers | Cost (B→O) | Output |
| --- | --- | --- | --- | --- |
| Wheat farm | 3×3 meadow | 10 | 20/36/45/55/65 | 8 loads/yr, harvest July |
| Carrot farm | 3×3 meadow | 10 | 20→65 | 8 loads/yr, harvest April |
| Onion farm | 3×3 meadow | 10 | 20→65 | 8 loads/yr, harvest April |
| Growers' lodge (+ olive/grapevine 3–10 dr each) | 2×2 | 12 | 25→75 | 20 loads/yr, ≤10 vines + 10 trees |
| Carding shed (+ 8 sheep) | 2×2 | 8 | 16→50 | 7–8 fleece/yr |
| Dairy (+ 8 goats) | 2×2 | 8 | 16→50 | 7–8 cheese/yr |
| Hunting lodge | 2×2 | 8 | 20→60 | 12 meat/yr per prey spawn point |
| Fishery / urchin quay | 2×2 water | 10 | 30→100 | 13/yr adjacent, 8–10/yr at range 20 |
| Orange tenders' lodge (Poseidon) | 2×2 | 12 | 20→65 | 15 loads/yr |
| Corral + cattle (Poseidon) | 4×4 | 25 | 75→230 | 12–14 meat/yr, 8 cattle (7 cows, 1 bull) |

**Industry**:

| Building | Size | Workers | Cost (B→O) | Chain |
| --- | --- | --- | --- | --- |
| Timber mill | 2×2 | 12 | 35→125 | forest → wood, 13/yr close, 7–8 at range 20 |
| Masonry shop (marble quarry) | 2×2 | 15 | 75→225 | rock → marble, 12/yr |
| Foundry | 2×2 | 15 | 60→180 | copper ore → bronze, 13/yr close |
| Mint | 2×2 | 15 | 100→300 | silver ore → 600–700 dr/yr close, 300–400 at range 20 |
| Olive press | 2×2 | 12 | 45→135 | olives → oil, 6/yr |
| Winery | 2×2 | 12 | 45→135 | grapes → wine, 6/yr (appeal +4!) |
| Sculpture studio | 2×2 | 18 | 100→300 | 4 bronze → 1 sculpture, 6/yr |
| Armory | 2×2 | 18 | 40→125 | bronze → armor, 6/yr |
| Horse ranch | 4×4 + 3×3 | 15 | 100→300 | wheat → 6 horses/yr |
| Refinery (Poseidon) | 2×2 | 16 | 65→180 | orichalc ore → orichalc |
| Black marble workshop (Poseidon) | 2×2 | 15 | 75→225 | black marble, 12/yr |
| Chariot maker (Poseidon) | 4×4 | 30 | 110→300 | horse + wood → 6 chariots/yr |

Distance to storage is the real constraint: a timber mill 20 tiles from its trees
may still store at 46 tiles, but a growers' lodge must be within ~5–8 tiles because
its whole year arrives in a few months.

**Goods list** (14 tradeable + drachmas): food ×5 types (wheat, carrots, onions,
fish/urchins, meat, cheese, oranges — max **4 food types in an entire adventure**),
fleece, olive oil, wine, bronze, armor, sculpture, marble, wood, horses, orichalc,
black marble. Chariots cannot be imported or exported.

🟡 Four chains: wheat farm → granary, growers' lodge → olive press → oil, vineyard →
winery → wine (appeal +4, as in the original), and a carding shed's sheep → fleece.
Homesteads and above ask for fleece, manors and estates for wine. A timber mill must
stand among trees and a masonry shop beside rock, and a sanctuary now costs marble as
well as drachmas — 48 cartloads for Zeus down to 8 for Dionysus, taken out of store on
placement, as in the original. A trading post takes oil, wine, fleece, timber and
marble for export. A foundry beside rock smelts bronze, an armoury beats it into
armour, a sculpture studio casts it into sculpture, a horse ranch turns grain into
horses on the meadow, and a mint beside rock strikes silver into coin month after
month. Mansions want armour, estates want horses as well, and a monument wants two
sculptures with its marble. Carrots, onions, meat, cheese and fish are not started.

🟡 Earlier: wheat farm → granary, and growers' lodge → olive press → oil, with goods
carted by producers and pulled by the agora. Husbandry, the rest of industry, harvest
months and distance-to-storage effects are not modelled.

---

## Phase 4 — distribution

| Building | Size | Workers | Cost | Capacity |
| --- | --- | --- | --- | --- |
| Granary | 4×4 | 18 | 50→150 | 8 slots, food only |
| Storehouse | 3×3 | 12 | 25→75 | 8 slots, goods; get/accept/stockpile orders |
| Common agora | 3×6 | 4/vendor | 25→75 | 3 vendor stalls |
| Grand agora | 5×6 | 4/vendor | 50→150 | 6 vendor stalls |
| Vendor stall | 2×2 on agora | 4 | 10→30 | food, fleece, oil, wine, arms, horses (+chariots) |
| Trading post | 4×4 | 24 | 100→300 | 15 slots |
| Pier | 4×4 + 2×2 water | 24 | 100→300 | 15 slots, straight coastline |

Deliverymen are destination walkers; peddlers roam 44 tiles selling from stalls.
Storehouse "get" pulls 4 items at a time from other stores without needing a road.

🟡 Granary, agora, deliverymen and peddlers are in, with the cartload/unit conversion
and three stalls per agora (3 walkers at once). Storehouses, orders, stockpiling,
trading posts and piers are not; the agora is 3×3 rather than 3×6 because the grid
holds square footprints.

---

## Phase 5 — services, hazards, administration

| Building | Size | Workers | Cost | Effect |
| --- | --- | --- | --- | --- |
| Fountain | 2×2 | 4 | 16→50 | water, appeal +4 |
| Infirmary | 4×4 | 11 | 35→105 | reduces disease risk |
| Maintenance office | 2×2 | 5 | 10→30 | prevents **both** fire and collapse |
| Watchpost | 2×2 | 6 | 20→60 | suppresses crime/unrest |
| Tax office | 2×2 | 8 | 25→75 | clerk collects tax, roams 35 |
| Palace | 9×6 | 0 | 125→400 | required for taxes and any military |
| Bridge / water crossing | 2×n | — | 8→20 | Poseidon: stone bridges, ships pass under |

**Risk model.** Each building carries a fire risk and a damage risk that scale with
difficulty (e.g. foundry fire 10/15/20/20/25; housing 8/12/15/18/20). Houses carry a
crime risk increment (CRI 3 for hut/shack, 2 above; elite −20, i.e. nobles suppress
crime) and a disease risk increment (DRI 20 for a hut down to 0 for elite; higher on
Titan/Olympian). Unrest produces disgruntled citizens and outlaws; plague spreads
from infected housing and cripples walker speed (13.6 tiles/month).

**Taxation.** `tax/month = TRM × people × rate`, where rate is
none 0 / very low 0.03 / low 0.07 / normal 0.09 / high 0.11 / very high 0.15 /
outrageous 0.20, and TRM is 1 for hut–hovel, 2 for homestead–townhouse, and
22/18/16/14/12 (Beginner→Olympian) for **all elite housing**. Elite housing is the
economy: 100 people in estates on Mortal yield 1,944 dr/yr against 1,728 dr from
800 townhouse dwellers. Tax rate also shifts sentiment (+7 to −7 depending on
difficulty).

🟡 Tax office, clerk and the `TRM × people × rate` table are in `src/sim/taxation.ts`,
with the seven rates and multiplier 1 below homestead, 2 above. Fire and damage risk
per building, and the maintenance office whose superintendent clears both, are in
`src/sim/hazards.ts`. The palace stands, 4×4 rather than 9×6 because the grid holds
square footprints, and `BuildingDef.requires` gates the tax office behind it. Elite
multipliers are in the elite ladder. The infirmary sends a doctor and the watchpost a
watchman; a house gathers disease each month at its tier's rate (20 for a hut down to
4 for a townhouse, none for elite) and crime (3 below hovel, 2 above, −20 for elite,
so nobles suppress it), a visit wipes the slate, and an untended house loses a third
of its people to plague or the treasury to thieves. Unrest, disgruntled citizens and
outlaws are not started.

---

## Phase 6 — culture (Greek) and science (Atlantean)

Culture is delivered as **points**, not coverage. A walker passing a house grants:

| Greek | Chain | Points | Atlantean | Chain | Points |
| --- | --- | --- | --- | --- | --- |
| Philosopher | college → podium | 15 | Scholar | bibliotheke | 15 |
| Athlete | gymnasium | 20 | Astronomer | university → observatory | 25 |
| Actor | drama school → theater | 25 | Inventor | inventors' workshop → laboratory | 20 |
| Competitor | gymnasium → stadium | 20 | Curator | university → museum | 20 |
| Stadium | citywide bonus | 10 | Museum | citywide bonus | 10 |

Costs/sizes: college 3×3/12 workers/30→100; podium 2×2/4/15→45; gymnasium
3×3/7/30→120; drama school 3×3/10/16→50; theater 5×5/18/60→180; stadium
10×5/45/200→600 (one per city). Atlantean: bibliotheke 2×2/5/18→50; university
3×3/12/30→100; observatory 5×5/18/75→225; inventors' workshop 3×3/12/40→130;
laboratory 4×4/9/65→180; museum 6×6/50/225→575 (one per city).

**Pan-Hellenic Games** (Greek only): four games — Isthmian (philosophers), Pythian
(actors), Nemean (athletes/competitors), Olympian (all culture). One per year on a
4-year cycle. Winning impresses every leader and unlocks a commemorative monument;
hosting requires winning the Olympics plus a working stadium, and brings tourists,
revenue, popularity and a second monument.

🟡 All four run on their four-year cycle in `src/sim/games.ts`: the city pays to enter,
and wins if six houses in ten know the art in question — every art at once for the
Olympics. A win pays its purse and buys goodwill with every city, and a city that has
won the Olympics and keeps a stadium hosts them for 2500 dr more. Tourists and the
second monument are not started.

**Hippodrome** (Atlantean only): built stade by stade as any closed loop, 4×4
segments at 30→100 dr, with 4×1 crosswalks (25→75) to cross it.

| Stades | Horses needed | Income/month |
| --- | --- | --- |
| 4–10 | 4 | 10 |
| 12–22 | 4 | 20 |
| 24–34 | 8 | 40 |
| 36–58 | 8 | 60 |
| 60–98 | 12 | 100 |
| 100–198 | 12 | 200 |
| 200+ | 24 | 500 (but popularity drops) |

🟡 All three Greek culture types are in, counted separately as the original counts
them: philosopher (college → podium), athlete (gymnasium) and actor (drama school →
theatre), with a manned stadium counting every house in the city as athletic. A hovel
asks for one type, a tenement two, a townhouse and every elite house three. The
Pan-Hellenic games, the Atlantean science track and the hippodrome are not started.

🟡 Earlier: the Greek philosopher chain is in: a college walks him to a podium, he roams 35
tiles from there, and housing needs him from the third tier up. Points-per-visit,
the other three Greek walkers, the Atlantean science track, the games and the
hippodrome are not.

---

## Phase 7 — mythology

**14 gods** — 12 in Zeus, plus Hera and Atlas in Poseidon. Per adventure: up to 6
friendly gods, of which the player can host **4 sanctuaries**; up to 4 enemy gods.

Each sanctuary needs marble + drachmas to place, then marble, wood, sculptures
(and orichalc for the Citadel) delivered to artisans from an artisans' guild
(2×2, 25 workers, 35→125).

| Sanctuary | Size | Place: marble / dr | Finish: marble / wood / sculpture | Benefit |
| --- | --- | --- | --- | --- |
| Zeus' Stronghold | 24×16 | 48 / 2920 | 145 / 28 / 22 | oracle, blocks invading gods |
| Promontory of Poseidon (Greek) | 21×14 | 37 / 2480 | 103 / 20 / 12 | sea bounty |
| Citadel of Poseidon (Atlantean) | 20×20 | 32 / 2080 | 231 / 52 / 2 + 16 orichalc | Kraken defends, fisheries boosted |
| Gates of Hades | 21×14 | 37 / 1320 | 140 / 28 / 4 | Cerberus, silver deposits |
| Arbor of Athena | 16×12 | 24 / 2160 | 67 / 22 / 8 | olive grove, stronger soldiers |
| Orchard of Hera (Poseidon) | 20×12 | 30 / 1760 | 88 / 20 / 6 | orange stands, fertility, blocks Zeus |
| Pillar of Atlas (Poseidon) | 14×14 | 25 / 1760 | 76 / 20 / 4 | faster stonecutters, 2 artisans/guild |
| Artemis' Menagerie | 16×10 | 20 / 1520 | 63 / 20 / 6 | Amazon troops, predator protection |
| Garden of Demeter | 18×12 | 27 / 840 | 110 / 20 / 10 | surrounded by meadow |
| Oracle of Apollo | 16×10 | 20 / 920 | 88 / 22 / 6 | oracle, better games odds |
| Ares' Fortress | 13×8 | 13 / 960 | 44 / 14 / 2 | Ares' warriors |
| Forge of Hephaestus | 13×8 | 13 / 760 | 48 / 14 / 6 | copper deposits, no fires |
| Aphrodite's Haven | 14×6 | 11 / 720 | 41 / 14 / 6 | no emigration, +appeal |
| Hermes' Refuge | 12×6 | 9 / 640 | 39 / 14 / 2 | faster walkers, ships, caravans |
| Grove of Dionysus | 10×6 | 8 / 400 | 35 / 14 / 2 | grapevines, no unrest |

Every god has three verbs: **sanctify** (a listed building type produces 4× for a
while), **bless** (prayed for, e.g. Hades donates money, Demeter gives food, Hermes
fulfils an outstanding request), and **curse/invade** (Hephaestus sets fires, Apollo
causes plague, Aphrodite steals walkers and population, Atlas petrifies citizens and
halts quarrying). Gods also fight each other — Hera repels Zeus; Aphrodite sends
Ares, Hephaestus, Hermes and Dionysus away; Dionysus is the weakest.

**8 heroes**, summoned to a hero hall (4×4, appeal 15) by meeting exact conditions:

| Hero | Requirements |
| --- | --- |
| Achilles | 32 armor · 3 hoplite companies · sanctuary to Athena or Hephaestus · no unrest · 16 wine |
| Hercules | hall with excellent culture · win a Pan-Hellenic game (Atlantean: working hippodrome) · excellent gymnasium/observatory access · 1500 people · 32 wine |
| Jason | 3 triremes/frigates · 2 horsemen/charioteer companies · 8 horses · 64 food · 16 wine |
| Odysseus | excellent popularity · excellent health · 8 elite houses · 32 oil · 16 wine |
| Perseus | 2 sanctuaries among Athena/Hermes/Zeus/Hades · 3000 dr · 16 fleece · 6 sculpture |
| Theseus | hall near palace · good appeal · walled · 32 marble · 16 wine |
| Atalanta (Poseidon) | sanctuary to Artemis · working stadium/museum · 32 meat · 32 wood · 8 companies |
| Bellerophon (Poseidon) | 15 horses · excellent tax coverage · 10,000 dr · 24 bronze/orichalc · 24 wine |

**16 monsters**, each owned by a god and killable by exactly one hero: Cyclops
(Zeus/Odysseus), Kraken (Poseidon/Perseus), Cerberus (Hades/Hercules), Sphinx
(Hera/Atalanta), Medusa (Demeter/Perseus), Hydra (Athena/Hercules), Calydonian Boar
(Artemis/Theseus), Scylla (Apollo/Odysseus), Chimera (Atlas/Bellerophon), Dragon
(Ares/Jason), Talos (Hephaestus/Jason), Hector (Aphrodite/Achilles), Minotaur
(Hermes/Theseus), Maenads (Dionysus/Achilles), Echidna and Harpies (independent).
Max 3 monsters per city: two god-owned, one independent. Aggressiveness is a
4-level setting (passive → aggressive) and monsters target a chosen category:
food, sea, industry, military, money, troops, common buildings, aesthetics,
mythological buildings, "best" buildings, or random.

**28 quests** — two per god, e.g. Zeus: "Return the golden fleece" (Jason) and
"Fire the weapon" (Odysseus); Atlas: "Widen the Strait" and "Relieve Atlas' Burden"
(both Hercules). Completing one can award a small or large commemorative monument
and can trigger a scripted event.

**Pyramids and monuments** (Atlantean only, max 6 per city), built in levels by
artisans:

| Monument | Size | Marble total | Wood | Orichalc |
| --- | --- | --- | --- | --- |
| Modest pyramid | 3×3 | 24 (20+4) | — | 8 |
| Pyramid | 5×5 | 75 (51+20+4) | 8 | 18 |
| Great pyramid | 7×7 | 174 (99+51+20+4) | 16 | 31 |
| Majestic pyramid | 9×9 | 336 (162+99+51+20+4) | 32 | 39 |
| Small / — / Grand monument to the sky | 5×5 / 6×6 / 8×8 | 72 / 105 / 232 | 8 / 8 / 16 | 4 / 18 / 33 |
| Minor shrine / shrine | 3×3 / 6×6 | 16 / 110 + 16 statue | — | 4 |

🟡 Four gods keep a mood in `src/sim/gods.ts`: Demeter, Hephaestus, Hermes and Hades.
A god ignores the city until a sanctuary to them stands (3×3, 8 workers, 340–460 dr,
in place of the original's marble-and-sculpture construction). From then the mood
climbs while the sanctuary is staffed and falls when it is neglected, and at the ends
of the scale the god acts: Demeter fills or empties the granaries, Hephaestus damps
every hearth or lights one, Hermes tops up or spills the stores, Hades pays or takes.
All twelve Greek gods are in, each with a 3×3 sanctuary of their own (320–620 dr) and
a pair of acts in `src/sim/divine.ts`: Zeus keeps the city clean of plague and crime
for a year or strikes a building with lightning; Poseidon doubles a month's trade or
wrecks the cargo; Athena doubles the hoplites or breaks the army; Artemis sends game
or looses beasts; Apollo heals or sickens; Ares raises companies or throws down the
walls; Aphrodite makes the city beloved or carries citizens off; Dionysus fills the
wine stores or sets the city quarrelling. An adventure invites four to six of them,
and only their sanctuaries appear in the build panel.

Four heroes are in `src/sim/heroes.ts`: a hero hall (4×4, behind the palace) and the
conditions each asks of the city — Achilles three companies and a sanctuary, Hercules
1500 citizens and two, Perseus two and 3000 dr, Odysseus standing of 70 and eight
elite houses. A summoned hero stays two years and fights as four hoplite companies,
and a monster loose in the city razes a building a month until the one hero who can
kill it arrives. Each god carries one quest in `src/sim/quests.ts`, offered once their
mood passes 70 and paid when the city meets it — citizens, companies, allies, stores
or a monster slain — and any quest fulfilled unlocks the monument, a marble column on
a stepped court worth 20 appeal. Sanctuary sizes, artisans, gods fighting each other,
the other four heroes, the remaining monsters and the second quest per god are not
started.

---

## Phase 8 — military and warfare

Everything requires a **palace**. Soldiers come from housing, not barracks: rabble
from common housing (48 rabble = 1 company; each visible rabble figure = 6 people),
hoplites from mansions/manors (2 and 4), horsemen from estates (4). Max **20
companies**. Atlantean equivalents: archers, spearmen, charioteers.

| Greek unit | HP | Attack | Armour | vs monster | Missile atk/rng | Speed |
| --- | --- | --- | --- | --- | --- | --- |
| Rabble | 100 | 5 | 2 | 3 | 6 / 11 | 54.4 |
| Hoplite | 150 | 15 | 6 | 2 | — | 54.4 |
| Horseman | 250 | 17 | 4 | 4 | — | 95.2 |
| Trireme | 300 | 90 | 4 | 5 | 20 / 9 | 72.53 |
| Transport | 100 | — | 3 | 7 | — | 54.4 |

Enemy nations and their army composition: Greeks 60/20/20 (hoplite/rabble/horseman),
Trojans 50/20/30, Persians 30/40/30, Centaurs 50/50, Amazons 75/25, and in Poseidon
Egyptians 50/30/20, Mayans 25/75, Phoenicians 70/30, Oceanids 50/50 (swim underwater
— frigates cannot touch them; only the Kraken can), Atlanteans 40/30/30.

Buildings: tower 2×2/15 workers/50→150 (needs a double-thick wall, road link to
palace); wall 1×n at 2→8 per tile; gatehouse 5×3/20→120; trireme wharf 3×3
water/100 workers/75→225; frigate wharf and chariot factory in Poseidon. Towers
and frigates loaded with orichalc launch **Atlantean Fire** (Atlantean cities only).

Combat characteristics: three invasion types (enemy, monster, hostile god); all
invaders head for the palace and losing it loses the battle; morale can break a
company; auto-defend can be handed over before but not during a battle; bribing or
surrendering is often cheaper than fighting; losing means paying tribute, and losing
twice to the same rival on home soil loses the episode. Offensive options are raids
(pick what to steal, yields scale inversely with difficulty — 2× the target's stock
at Beginner, 0.5× at Olympian) and conquest (city becomes a vassal). Rabble cannot
be sent abroad. Borrowed allied troops defend only; god-sent troops do both.

🟡 Companies muster from housing in `src/sim/military.ts`, and only with a palace:
5 soldiers a hovel up to 15 a townhouse, 48 to a rabble company; mansions and manors
raise hoplites 16 to a company, estates horsemen 8 to a company, capped at 20
companies. A scenario carries a list of invasions by year and nation, and the battle
is decided on attack × hit points against the invader's companies — a defeat costs
250 dr a company in plunder and razes a building for each. Walls are dragged in a
line like roads at 6 dr a tile and are worth a company every twelve tiles; a manned
tower (2×2, 15 workers, behind the palace) is worth two. Unit movement, gatehouses,
wharves, sieges, morale and sending troops abroad are not started.

---

## Phase 9 — the world, diplomacy and trade

Five relationships plus one: **parent city**, **colony**, **ally**, **rival**,
**vassal**, and **distant city** (trade only, never politics). Up to **22 cities**
in a world; each non-player city may buy/sell up to 4 goods in total, has a military
strength of 1–6 (6 = unconquerable), and a visible economy and army on the map.

- Trade needs: a willing city, a route, a staffed trading post or pier, and enough
  goodwill. Only allies, vassals and colonies trade. A conquered city needs a large
  gift (16 of a wanted good, or ~2500 dr) before trade starts; travel takes 3–4
  months at Beginner and longer above.
- Requests and demands: goods (subtypes general, festival, construction, famine,
  financial woes), military aid, and heroes. Famine requests weigh heaviest, and
  military requests expire with the battle. Gifts raise standing, but too many too
  fast reads as a bribe.
- Tribute flows both ways (typical 400 dr/yr); vassals and colonies pay until they
  revolt. Suspending tribute for a year is allowed once for a gift.
- Reputation couples: treating one ally badly affects all allies; defeating a rival
  raises your standing with other rivals. In Atlantean adventures, attacking an
  Atlantean ally turns **every** Atlantean city into a rival.
- Colonies: the player leaves the parent city to found one, and a deputy runs home
  while away. If the parent falls in your absence, the episode is lost.

**Money** — income: taxes, exports, minting silver, tribute received, gifts, the
hippodrome. Costs: wages, construction, imports, gifts, tribute, bribes, aid.
Sustained debt loses the episode.

🟡 Four distant cities trade in `src/sim/trade.ts`: Corinth and Knossos buy oil, at a
good price for a small quota and a poor one for a large; Mycenae and Troy sell grain.
A route is an order the player opens, and a manned trading post carries it out each
month — oil carted in leaves, bought grain lands there and the agora fetches it like
a granary. Six cities in `src/sim/cities.ts` each keep their own goodwill, which reads
as a relationship: rival below 20, distant, ally at 55, vassal at 85. Only an ally or
a vassal will trade with you, however many routes you open; a vassal sends 400 dr of
tribute a year. A gift of 500 dr buys twelve goodwill, fulfilling a request buys six,
and letting one expire costs ten. A scenario also carries events: requests with
deadlines, gifts and earthquakes. Travel time, demands, military aid, colonies and the
map itself are not started.

**Natural disasters**: earthquake (permanent crevices, bridgeable by road), tidal
wave (temporary) vs flood (permanent), lava (destroys land forever), landslide,
sink land (up to 5 tiles of coast).

🟡 Four disasters are scheduled by year like any other event, in `src/sim/disasters.ts`:
an earthquake razes five buildings, a flood turns the low ground around a shore to
water for good, a landslide carries away ground that has a drop beside it, and lava
burns a path and leaves rock nothing can be built on. Crevices bridgeable by road and
temporary tidal waves are not started.

---

## Phase 10 — campaign, scenario editor, presentation

**Structure.** Zeus ships 7 adventures, Poseidon 6 (4 Atlantean, 2 Greek) plus 4
open-play custom ones. An adventure is up to **10 parent-city episodes + 4 colony
episodes**, each with up to **6 goals**. No goals = open play, which never ends.

Goal types: population · treasury · sanctuary (count or specific god) · support
(soldiers/warships) · quest · slay monster · yearly production · rule a city ·
yearly profit · housing (people at a given level) · trading partners · set-aside
goods · pyramid (Atlantean) · hippodrome stades (Atlantean).

Failure conditions: prolonged debt; defeat by a rival you already pay tribute to;
loss of the parent city while founding a colony.

Event system, worth mirroring because it *is* the campaign layer: goods request,
military request, gift, quest, invasion (max 256 soldiers per wave, 500 in a city at
once; entry markers 1–8 land, 9–16 sea), monster invasion (in-city / unleashed /
invades), god invasion, disaster, wage change, trade change (demand ±, supply ±,
price ±, trade opens/shuts), city status change (rival→ally, →rival, →vassal), god
disaster on a foreign city, military buildup/decline. Timing modes: one-time,
recurring, triggered-only, on episode completion — with year ranges for randomness.

**Difficulty**: 5 levels (Beginner, Mortal, Hero, Titan, Olympian) that scale build
costs (~×1 to ×3), worker percentage, housing evolution thresholds, elite tax
multiplier, fire/damage risk, and raid yields.

🟡 All five are in `src/sim/difficulty.ts` and chosen from the city menu: build costs
×1 to ×3, the full worker-share table, the elite tax multiplier 22 down to 12, fire
and damage risk ×0.7 to ×2, and a shift of −8 to +14 on every housing threshold. Raid
yields scale with nothing yet.

**Presentation and UI**: overview tab (popularity, food, unemployment, hygiene,
unrest, treasury, threats, requests), "go to" event jumps, city rotation in 90°
steps, overlay maps (appeal, water, hygiene, hazards, unrest, taxes, culture,
security, industry), goals panel, world map with routes/armies/heroes/enemies,
messages and archives, undo of the last build, autosave every 6 months, help
balloons, and a full adventure editor (map painting, city properties, events,
per-episode text, MP3 briefings).

🟡 Four advisors read the city out on A — the people, the treasury, the city and the
gods — each with a verdict and readings that turn red when they should worry you.
Overlays are a menu of six: the city itself, appeal, fire and collapse, water,
culture and crime, the last three tinting houses by how well they are served.

🟡 Four episodes run in sequence from `CAMPAIGN` in `src/sim/scenario.ts`: Thebes,
Corinth, Delphi and Mycenae, each with its own goals, blurb and invasions. Goals now
cover population, treasury, housing level, yearly production, sanctuaries, companies
and trading partners; meeting them all offers the next city, and two years in debt
ends the rule. Events cover requests, gifts, earthquakes and invasions, each fixed to
a year. Adventures, colonies, ratings, recurring and triggered events, and the editor
are not started.

---

## Suggested build order

1. **Appeal band model + full housing ladder** — cheapest way to make the existing
   sim behave like Zeus rather than like a generic city builder.
2. **Labour, wages, taxes, popularity** — closes the economic loop and makes
   difficulty meaningful.
3. **Walker fidelity** (ranges, roadblocks, exit points) — this is what makes
   block design the actual game.
4. **Agora + storehouse + a second and third chain** (olives→oil, sheep→fleece).
5. **Culture points** — the first system that gates the upper housing tiers.
6. **World map, trade, requests** — turns a city into a campaign.
7. **Sanctuaries and gods** — the identity of the game; large art and rules cost.
8. **Military and invasions**.
9. **Scenario/event scripting + editor**.
10. **Poseidon layer**: science track, hippodrome, orichalc/black marble, pyramids,
    Hera and Atlas, new nations, chariots, Atlantean Fire.
