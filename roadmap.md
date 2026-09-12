# Οἶκος roadmap

## Vision

Build a city worth caring about, connect its economy to an archipelago, and raise
monuments worthy of the gods.

Οἶκος combines Anno’s economic interdependence with Zeus’s character, mythology,
and visible city life. Players grow small fishing villages into prosperous cities,
trade and collaborate across islands, and eventually compete through more than
comparison alone.

The priorities are:

1. **Building:** creating a city that feels beautiful, personal, and alive.
2. **Engineering:** designing reliable production, distribution, and shipping.
3. **Adventure:** preparing expeditions that expand the possibilities at home.

The tone is grand with a wholesome touch. The painted-toy art direction remains
our visual foundation. Personality should emerge from people, gods, places, and
actual events—not just decorative dialogue.

## Core experience

The central pleasure is watching an economy become a place: workers remove marble
from a quarry, carts deliver it to a stockpile, carriers bring it to a construction
site, and artisans raise a sanctuary where a god eventually takes residence.

A successful session should leave the player with:

- Something satisfying completed or visibly improved.
- An economic improvement underway.
- A larger ambition to pursue over several sessions.

Long-term development should span weeks. That depth comes from new districts,
industries, trade relationships, colonies, and monuments—not inflated timers.
Mandatory multi-day waits are out. Even a major construction project should take
at most a few hours once adequately supplied; preparation and logistics provide
the real challenge.

## Agreed design

### A persistent multiplayer world

- Start with one shared world serving 2–8 players who can drop in anytime.
- The simulation runs while at least one player is online and pauses when nobody
  is online.
- Every settled island remains fully simulated while the world runs, including
  islands whose owners are offline.
- Start with this rule and evaluate it through playtesting rather than adding
  offline protection immediately.
- Personal menus must not pause the shared simulation for everyone.

An active group can advance the world much faster than an occasional group.
Pacing must therefore distinguish simulated time from calendar time.

### Ownership and expansion

- A joining player chooses an unclaimed island and places its founding harbour.
- Players own their starting islands and will be able to claim additional islands.
- No islands are reserved for newcomers. Availability depends on what remains
  unclaimed; a late arrival is not guaranteed a starting island.
- Islands remain individually owned. Cooperation means “my island helps yours,”
  not merged ownership or a jointly governed city.
- Alliances, trade, and contributions to major projects can connect independent
  holdings into a complex shared economy.

### Housing, population, and labour

Use distinct residential building types for different population classes, with
Zeus-like automatic evolution within each type.

- Building a residential type is a deliberate player choice.
- Meeting its needs and appeal requirements automatically improves its houses.
- Automatic evolution must not change its workforce class and remove the workers
  supporting the economy.
- Different residential types are distinct buildings, not a class-conversion
  toggle on the same house.
- Housing tiers have their own needs. Later requirements can replace earlier
  ones; progression is not necessarily an ever-growing shopping list.
- Industries require the appropriate population: extraction and agriculture need
  their workforce, while skilled production needs its own.
- An island importing raw materials does not need to retain the workforce that
  would have produced them locally. That work can happen on another island.
- Working neighbourhoods can become attractive and prosperous without becoming
  a different class.

The exact residential types, tiers, footprints, and workforce requirements still
need design. Workers’ homes, artisan homes, and wealthy residences are useful
examples, not a fixed catalogue.

### Appeal and beautification

Beautification is mostly optional expression, but appeal contributes to housing
evolution alongside reliable supplies and services.

The intended approach is to make neighbourhood design matter: pleasant
surroundings and civic life help, while disruptive industry creates trade-offs.
Gardens, plazas, statues, and waterfronts should provide additional options—not a
mandatory decoration checklist around every house.

### Production and logistics

- Goods physically move through the economy. Visible cargo and storage should
  explain what the system is doing.
- Local deliveries are automatic.
- Players explicitly control economic priorities, warehouse reserves, and
  shipping routes.
- The challenge is designing a dependable system, not repeatedly issuing
  individual delivery orders.
- Shortages and bottlenecks must be understandable, with clear causes and useful
  ways to respond.

### Geography, trade, and colonies

**Self-sufficient survival, trade-dependent grandeur.**

Starting islands should support basic survival. Dependencies emerge around
advanced construction, monuments, and potentially later population tiers.

Resource differences must change what an island can accomplish. Access to marble,
stone, or other construction materials is more meaningful than interchangeable
food crops with different colours.

When a city lacks something, developing a supplying colony should be a real
alternative to trading with another player. Producing, importing, and expanding
should have different costs and advantages rather than one universally best
answer.

External trade as a fallback has been proposed but is not yet decided.

### Extraction changes the island

Natural deposits should be effectively inexhaustible, but their use must leave a
real, lasting physical effect.

A marble quarry loses visible blocks, exposes terraces, and descends as extraction
continues. An old quarry should look substantially different from untouched rock.
The implementation need not simulate or render an infinitely deep underground
world, but it must preserve the feeling of ongoing excavation rather than a
static building generating resources.

### Temples and gods

Temples are a defining experience, not expensive decorations.

- Begin with fixed, authored temple buildings rather than modular temple design.
- Materials pass through the ordinary production, storage, and transport systems.
- Carriers deliver supplies and artisans perform construction.
- The monument rises through readable, visible stages.
- Completing it brings a god into the life of the city.
- Gods provide meaningful bonuses that support economic specialisation.
- A city can host several gods; patronage is not an exclusive single-god choice.
- Divine visits and behaviour should evoke Zeus: gods are present personalities,
  not merely passive modifiers in a panel.

Preparing the site, organising supply, and watching construction should be
rewarding before the final blessing arrives.

### Expeditions and character

Adventure initially takes the form of headless expeditions. Players prepare and
send a ship, receive progress reports, and continue building while it is away.
The ship returns with goods rather than requiring a separately controlled
adventure scene.

Characters and gods should acknowledge actual city conditions and give economic
ambitions personality. A recurring cast and contextual dialogue are promising
ways to achieve this; their exact systems remain to be designed.

### Setbacks and competition

- Economic failures should cause serious but recoverable decline.
- Shortages must matter without routinely erasing a player’s investment.
- Initial competition is comparison: whose city is more prosperous, impressive,
  or beautifully built.
- War is a firm long-term intention, but not part of the initial multiplayer loop.
- Destructive conflict requires a separate design pass on offline exposure,
  territorial loss, and recovery before implementation.

### Mature-world play

There is no required finish line after achieving prosperity. Long-term ambitions
include beautification, increasingly elaborate economies, large projects,
additional islands, and relationships between independent cities.

The world should support both “I want to improve this waterfront” and “we need a
new shipping network to supply these sanctuaries.”

## Implementation progress

- Starting-island selection is playable through Menu → New island. All eight
  islands have prepared landing roads and support the existing village loop. A
  clickable atlas previews their coastlines, farmland, and forests before choosing.
- New islands begin with on-map founding: preview and place the dockyard beside
  the landing road before building the city. Unfinished founding can be saved and
  resumed, and the chosen harbour site stays fixed when roads change.
- The selected home survives saves, imports, checkpoints, and camera restoration.
  Existing version-4 archipelago saves migrate without moving their cities.
- Construction and field overlays respect the settled island. Other islands remain
  available to explore but cannot yet be built on; colony claims will unlock them.
- Player actions use a validated, serializable command API, ready for server-side
  ownership checks and execution. Local play and undo still work as before.
- Settlement metadata now lives in `World.cities`. Version-4–8 saves migrate without
  changing their city or shared world state. Roads, buildings, and walkers have
  followed: a city is now a complete, self-contained settlement. Engine queries,
  construction commands (build, roads, demolition, vendors, founding), and the
  economic simulation tick (staffing, production, delivery, gathering, the
  harbour, housing, finances) all take an explicit City, resolved from
  `world.cities` by id at the command boundary. In-memory tests already run two
  independent city economies under one shared clock and wildlife population;
  saving still accepts only a single city, ready for the ownership and
  multi-city work ahead. Construction now checks occupancy globally: placement,
  road paths, farm and footprint previews, and harbour founding all reject a
  tile already held by another city's road, building, or founded harbour,
  while a city's own roads and legacy off-home infrastructure remain exactly
  as before. Version 10 adds a City-id allocator (`World.nextCityId`) alongside
  the shared entity `nextId`, a trusted `claimIsland` backend API that validates
  and appends a new pending city atomically, an empty canonical archipelago
  factory for a future server, and a separate `deserializeSharedWorld` loader
  (0 to `ISLAND_COUNT` cities, global id and physical-overlap validation) beside
  the unchanged single-city `deserializeWorld`.
- This remains a local, single-player game. Unrestricted coastal harbour siting,
  player identity, shared ownership data, and the persistent server are still ahead.
  Claims are a backend primitive only; no command, UI, or ownership check calls
  them yet.

## Roadmap

These phases express priority and dependency, not fixed delivery dates. Prove each
core experience before broadening its catalogue of buildings and resources.

### 1. Establish the shared archipelago

Move the existing village experience into a persistent multiplayer foundation.

- Player identity and server-held world saves.
- Joining an unclaimed island and placing its founding harbour.
- Island ownership, separate treasuries, and ownership-aware commands.
- A shared simulation clock with empty-world pause.
- Reconnecting, late joining, and visiting other players’ cities.
- Reliable continuation of offline players’ economies while others play.

**Milestone:** two players establish separate villages, leave, and return to the
same functioning shared world.

### 2. Make one island worth developing

Deepen the domestic economy before multiplying content.

- Fishing as a proper starting livelihood.
- Distinct residential types and their workforce requirements.
- Automatic housing evolution with tier-specific needs.
- Appeal and the beginnings of meaningful neighbourhood design.
- Warehouse reserves and workplace priorities.
- Clear supply diagnostics and recoverable household decline.
- Enough progression to create new decisions beyond repeating the starter block.

**Milestone:** an evening of building offers several viable layouts, meaningful
labour choices, and a clear next ambition.

### 3. Make another island matter

Connect cities through resources, ships, and expansion.

- Uneven resource distribution with meaningful construction dependencies.
- Physical ship cargoes and configurable recurring shipping routes.
- Player trade agreements.
- Additional island claims and supplying settlements.
- Imports that genuinely replace local industries and their labour requirements.

**Milestone:** “produce it, buy it, or establish a colony” is a meaningful choice,
and another player’s island becomes relevant to everyday planning.

### 4. Build the first great sanctuary

Deliver one complete, polished expression of the game’s identity.

- A marble quarry with visible, lasting excavation.
- Stockpiling and physical deliveries to a temple site.
- Skilled artisans and staged monument construction.
- One authored temple and one resident god.
- A useful, understandable divine blessing and a memorable arrival.

Build this complete chain before adding many more resources, temples, or gods.

**Milestone:** the journey from untouched rock to divine arrival is enjoyable to
organise and worth watching.

### 5. Expand city identity and ambition

Broaden systems that have proved enjoyable.

- More housing progressions and specialised industries.
- Additional temples and gods, with several able to inhabit one city.
- Civic architecture, gardens, plazas, and waterfronts.
- Recurring characters responding to city conditions.
- Supplied expeditions with reports and returning cargo.
- Alliances and contributions to major projects without shared island ownership.
- Deeper multi-island production and shipping networks.

**Milestone:** prosperous cities differ visibly, economically, and in the stories
players tell about them; mature players still have worthwhile ambitions.

### 6. Introduce warfare

Develop conflict after ownership, trade, expansion, and recovery have been tested
in a lived-in world.

Define the rules for aggression, defence, offline exposure, conquest, and recovery
before implementing combat. Do not let future warfare delay proving the peaceful
city-building and trading game.

**Milestone:** conflict adds strategic possibilities without invalidating the
long-term investment that makes cities worth caring about.

## Guardrails

- No mandatory multi-day timers or slower production used as a substitute for depth.
- No automatic loss of a workforce through housing evolution.
- No interchangeable resource variants presented as meaningful specialisation.
- No compulsory decoration carpet around every neighbourhood.
- No arbitrary disasters substituting for interesting decisions.
- No sprawling content catalogue before one excellent temple supply chain.
- No multiplayer model that quietly assumes offline islands are frozen or protected.
- No automatic reservation of starting islands for newcomers.

## Decisions to resolve during design

- Residential types, their needs, footprints, and precise workforce rules.
- Appeal sources, ranges, thresholds, and how clearly the interface explains them.
- Trade pricing, agreements, enforcement, and behaviour during shortages.
- Whether expensive external imports provide a fallback when local trade fails.
- Island count, claiming costs, and what joining looks like when no island remains.
- The severity and limits of decline during an owner’s absence.
- How excavation remains readable and efficient over a world’s lifetime.
- Expedition preparation, risks, rewards, and report cadence.
- Divine interactions beyond temple completion and economic blessings.
- Alliance benefits and contributions to individually owned projects.
- The complete warfare model, including offline vulnerability.

## Relationship to the current game

The existing game already proves physical road deliveries, visible stock and
cargo, evolving houses, gathering, and a basic harbour export loop. Its simulation
is deterministic and separated from rendering, but saves are local, only the home
island is buildable, and the healthy-neighbourhood goal arrives within minutes.

Preserve those readable physical systems while replacing the single-player
assumptions. Do not stretch the starter loop into weeks by changing its timers.

The next implementation milestone is **two persistent player-owned villages**.
The first major creative milestone is **the marble-to-temple experience**.

Current implementation details remain in [docs/gameplay.md](docs/gameplay.md).
The visual contract remains in [docs/art-direction.md](docs/art-direction.md),
with authoring guidance in [docs/art-tooling.md](docs/art-tooling.md).
