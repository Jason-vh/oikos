# What makes Anno and Zeus addictive

Research notes on the two games Οἶκος draws from, and what to take from them.
Sources: Anno Union dev blogs (residential tiers, needs, attractiveness,
expeditions, UI, design process), reviews (IGN, GameSpot, Metacritic), Zeus
Heaven, the Impressions wiki, TV Tropes, and community threads on r/anno,
r/anno1800, r/impressionsgames and Steam.

## Anno

### The engine: needs that cascade and never settle

The single most-cited reason. A player moves "from stable point to stable point,
but it never perfectly stabilises, so you fix a little more." Beer needs workers;
workers need bread; bread needs farmers; more farmers unlock artisans; artisans
want beer. Every solution creates the next problem. The game never punishes with a
game over; it presents the next logical challenge.

### Population is the progression system

Residential tiers are the level bar. Each tier is a rewarding milestone that opens
new buildings and chains. The catalogue unlocks gradually as the *count* of
residents in a tier rises, not just on reaching it. "Your population is an
indicator of your skill as an Anno player."

### How needs are built (Anno 117 dev blog)

- Consumption is island-wide, drawn from island storage. Service needs are radius.
- A need activates only once a tier's population reaches a count. Small towns are
  not nagged for goods they cannot make yet.
- Needs sit in categories (food, fashion, household, public service). Each good has
  a supply value; each category has a threshold lower than the sum of its goods.
  You must pick some, never all. Few complex chains or many simple ones, whatever
  the island's fertility allows.
- Exceeding a threshold pays attributes (+income, +population, +happiness per
  house). Over-supply is rewarded, not wasted.
- Higher tiers keep every earlier need. Anno 1800 dropped this (investors do not
  eat bread); players name it as why the late game goes flat, and 117 reverted to
  1404's rule.

### The ritual

IGN: "positively hypnotized by the routine of dropping in a farm and running a road
back to the harbor." Small, cheap, fast actions with immediate visible effect.

### Delayed gratification with visible progress

Twenty minutes fixing a chain, then a whole district upgrades at once. Progress is
always readable in the meantime. "I'll just finish this one production chain."

### Space and geography as the puzzle

Fixed 3×3 houses, big factories, finite islands. Uneven fertility and deposits
give each island a role. Layout becomes shared community craft; efficient blocks
are copied, then abandoned for prettier ones when the economy is solved.

### Optional depth

Plopping chains works; optimising is possible. Casual and "engineer brain" players
both stay. Minimal hand-holding; mastery is noticed, not announced.

### Failure is a signal

Idle factories, overflowing warehouses, shortages: problems to solve, with clear
causes, never a wall. Stories come from systems colliding: "the soap shortage that
paralysed my workforce."

### Side loops at other tempos

- Expeditions: unlocked at tier 3, the ship is stocked from your own economy
  (soap counts as medicine, planks as repairs, schnapps as rations), morale is
  the HP bar, off-screen text events, ship returns and unloads items and
  specialists. The designers deliberately kept it non-central: events never touch
  the city, only the loot does.
- NPC quests, zoo and museum collecting, specialists and items.
- Beauty with a payoff: a per-island attractiveness rating on three axes with
  counterparts (culture vs inelegance, nature vs pollution, festivity vs
  instability), accumulated rather than netted, rewarded with visitors who leave
  money and sometimes settle as specialists.

### Physical cargo is the identity

Anno 2205 abstracted ships and routes into sector-wide numbers. Fans call it the
game that removed what made Anno, Anno.

### Ambience

Build, observe, adjust, repeat. Understated soundtrack, living streets, zoom from
diorama to street level. Watching is a reward.

### Where Anno loses people

- Mid-game complexity cliff: too many chains arrive at once; players quit at
  engineers.
- Late game with no sink: "$700M in the bank, nothing to do but tweak trade
  routes." Trade-route micromanagement is the named tedium.
- Too big to reach late game in an evening; co-op players ask for 1404 pacing.
- Partial information (production shown, trade not) is worse than none.

## Zeus

### Walkers make service visible

Uniformed walkers, houses upgrade immediately when served, and a house says what
it wants next. Build, watch the walker, watch the house grow. Walkers have names
and catchphrases and react to monsters while carrying on working. Reviewers name
the humour as a reason they stayed.

### The housing block

Closed road loops tuned to walker range, roadblocks to steer them. The community
still shares blocks twenty years on. Simpler and faster than Pharaoh, so more
people reached the good part.

### Simplifications that worked

- Common and elite housing are separate buildings, so evolution never removes the
  workforce.
- The labour pool ignores distance.
- All food kinds count as one.
- Culture is "did the walker pass", not coverage percentage.
- The first real tutorial in the series.

### Sanctuaries

Marble and money to place; then marble, wood and sculptures carried by artisans
one tile at a time (Zeus's Stronghold: 170 tiles, 145 marble, 28 wood, 22
sculptures). Capped at four per city, so choosing gods is a decision. Priests take
livestock for sacrifice and burn food when there is none: a resident god costs
something.

### Gods act, visibly

Gods wander the city before they are housed, pitching their services; the unchosen
get pushier. Once housed they walk the streets sanctifying buildings; answered
prayers are concrete (Demeter carries food to granaries when stock is low, Hades
quadruples a mint). Curses are authored consequences of relationships, not random
disasters.

### Heroes are legible checklists

Hercules: 1500 people, excellent gymnasium access, a Games win, 32 wine. Odysseus:
8 elite houses, 32 olive oil, excellent health. Each is a multi-session goal
expressed entirely in city state.

### Diplomacy as pacing

Other cities request goods with deadlines; fulfilling raises favour, which decides
whether they trade or help. Gifts of surplus raise favour. Begging drains it. The
parent city demands tribute and a deputy scolds you for missing it. Colonies exist
to send one resource home.

### One city across a campaign

The city you end a mission with is the one you start the next with. Reviewers call
it the single best change: "you really feel you've accomplished something."

### Co-op

Shared control is enjoyed because it forces talk and division of labour: one
beautifies while the other keeps the islands running.

## The five engines of "one more"

1. Cascading, cumulative needs activated by tier headcount, with categories and
   thresholds that leave choice. A solved economy never stays solved.
2. Visible, immediate feedback: walkers, carts, ships, houses upgrading on the
   spot, the next want always shown.
3. A long ambition with a legible bill: sanctuaries and hero-style checklists,
   capped so choosing matters, with a resident god who acts and costs.
4. Side loops at other tempos: requests from neighbours, expeditions supplied from
   the stockpile, beauty with a payoff.
5. A cast that notices: gods pitching, named walkers, an oracle that references
   real shortages.

## Where Οἶκος stands

Has: the road ritual, physical cargo, evolving houses, status lines, distance-free
labour, walker-pass service. Missing: the goal arrives in minutes, tiers need only
food and water, nothing new unlocks, no space pressure, no visible long ambition,
no side loops, no cast.

## Proposals

In rough order of leverage. All fit roadmap phase 2 unless noted.

1. **Population unlocks the catalogue.** Gate tools on resident counts per tier;
   the HUD shows the next unlock and the distance to it.
2. **Cascade one need chain.** Tier 3 wants a processed good (olive oil: orchard
   and press) whose workforce competes with farms, so upgrading houses pulls
   workers and forces more housing.
3. **Keep needs cumulative.** Add categories with thresholds so tier 3 is reachable
   by several combinations depending on the island. Over-fulfilment pays
   attributes. This contradicts the roadmap line that later requirements can
   replace earlier ones; the evidence favours cumulative.
4. **Activate needs by tier headcount**, not on the first house.
5. **Always show the next want**: per house, per district, and one city-wide "what
   is stopping growth" line.
6. **Problem list, not toasts.** Persistent, click-to-jump: "3 houses out of
   water", "granary full, farm idle". Show whole information or none.
7. **Long ambition visible from session one.** Show the sanctuary site and its bill
   greyed out. Sanctuary as the money and marble sink, capped per city, built tile
   by tile by artisans. (Phase 4.)
8. **Gods and heroes as checklists.** "Athena takes residence when: 8 courtyard
   houses, 200 olive oil stored, good appeal at the site." Then she walks and
   sanctifies presses. Gods visit before they are housed. A god has upkeep.
9. **Space pressure.** Appeal so industry beside houses costs something; scarce
   fertile ground.
10. **Beauty pays** via visitors, on a per-island rating with axes and
    counterparts rather than an ornament count.
11. **Requests between cities**, generated from actual shortages in the shared
    world, with deadlines and favour. (Phase 3.)
12. **Expeditions supplied from the stockpile**, morale-based, loot only. Never
    the centre of the game. (Phase 5.)
13. **Never abstract cargo.** Ships carry holds; routes are visible. (Phase 3.)
14. **Personality tied to real state.** Cheap first step: a harbour-master or
    oracle whose lines reference the actual shortage.
15. **A first-session tutorial** as deliberate as Zeus's.
16. **Pace for evenings, not weeks.** Anno 1800's late game is the cautionary
    tale.

## Guardrails confirmed by the research

- Late needs never drop early ones.
- Cargo always physical.
- Side loops feed the city; they never replace it.
- Failure is legible and recoverable.
- Complexity arrives one chain at a time.
