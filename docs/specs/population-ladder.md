# Spec: the population ladder

Widen the domestic economy so that housing tiers form a ladder, then let that
ladder unlock the catalogue. Three stacked slices. Read `AGENTS.md`, `README.md`,
`docs/gameplay.md`, `docs/art-direction.md`, `docs/art-tooling.md` and
`docs/addiction-notes.md` first.

## Why

`docs/addiction-notes.md` names cascading needs and population-gated unlocks as
the two engines of "one more". Today's catalogue is ten buildings, seven of which
the starter loop needs, and tiers need only food and water. Gating that catalogue
would be arbitrary. So: add a second starting livelihood, one two-step chain
feeding a fourth tier, then gate.

## Non-goals

- Residential classes (workers vs artisans). One common house type, four tiers.
- Need categories with thresholds. One need per step.
- Appeal, expeditions, sanctuaries, trade between cities.
- Changing the starter loop's timing. Four courtyard houses in two to three
  simulated minutes stays the goal.
- Toolbar redesign. New tools are click-only; keys `1`–`0` keep their bindings.

## The ladder

| Tier | Name | Capacity | Needs | Unlocks (residents at this tier or better) |
| --- | --- | --- | --- | --- |
| 1 | Dwelling | 8 | — | — |
| 2 | Cottage | 12 | food | 24 → woodcutter's cabin, stockpile |
| 3 | Courtyard house | 20 | food, water | 20 → olive orchard, olive press |
| 4 | Townhouse | 28 | food, water, olive oil | — |

Always available: road, house, farm, granary, agora, fountain, maintenance post,
hunter's lodge, fishing wharf. Hunting and fishing are the primitive livelihoods;
they come before wheat, not after.

Needs are cumulative. A tier never drops an earlier need.

Food stays one pool. Wheat, fish and meat are interchangeable in a house; the
choice is which the island supports, not which the house wants.

## Slice 1: fishing

A city with no fertile ground can still feed cottages.

- A fishing wharf stands on the shore: its front on buildable level shore, its
  back over open water, facing any of the four ways like the harbour. It does not
  claim an island.
- It sends a boat over the water to the nearest shoal within reach. The boat
  works the shoal, which holds still meanwhile, then carries the catch home. A
  worked shoal disappears and returns later, like hunted game.
- The catch waits at the wharf until a cart carries it to a granary, exactly as
  a hunter's meat does. Fish feeds houses like any other food.
- The wharf's reach is drawn over the water while placing and while selected,
  in the same style as a lodge's.
- The wharf and its boat can be inspected and report what they are doing, in
  the same voice as the lodge: out on the water, full and waiting for a cart, no
  shoals within reach, tied up.
- Demolishing the wharf removes its boat; a shoal it was working is released.
- Saves with a boat at sea load and continue.
- Every island on seeds 1–8 offers a legal wharf site near its harbour.
- Art: wharf, boat, a heap of fish when loaded, a net-cast animation while
  working. Painted-toy style; judged at city zoom from all four sides.

## Slice 2: olives, oil, and the townhouse

Olives grow on ground farms cannot use, a press turns them into oil, an oil
stall on the agora carries it to houses, and houses with oil become townhouses.

- Olive orchard, 4×4, on level grass, scrub or fertile ground. Grows and
  harvests like a farm, slower. Its cart carries olives to the nearest connected
  press with room. Olives never reach a house.
- Olive press, 2×3, ordinary ground. Stores olives and oil. With staff and enough
  olives it presses in batches; staffing ratio scales the pace. Reports waiting
  for olives, pressing with a percentage, or full and waiting for a buyer.
- The agora hosts stalls, not one vendor. The existing food stall keeps its
  behaviour and price. The harbour's trade order keeps its own switch and is
  not a stall. A new oil stall costs the same, once; pausing and
  resuming is free. Its buyer fetches oil from a press; its seller walks the
  same circuit as the food vendor and drops oil at each house passed. The
  inspector shows both stalls with their own toggle and matching wording.
- Houses hold a small store of oil that residents consume slowly.
- Tier 4, Townhouse, capacity 28, needs food, water and oil. Upgrade and
  devolution follow the existing grace rules. Status lines follow the existing
  pattern: needs oil to become a townhouse, out of oil with the reason, a
  prosperous townhouse.
- The summary counts townhouses. The starter goal is unchanged.
- A celebration marks the first townhouse.
- Older saves load: the single vendor becomes the food stall.
- Art: orchard with growth stages, press, townhouse as a taller courtyard house
  with an upper storey and painted balcony, oil jars as cargo, an oil stall
  told apart from the food stall by its jars.

## Slice 3: unlocks

Tools appear as the city earns them, and the player always sees the next one.

- A tool with a requirement is usable only while the city has at least that
  many residents living in houses of the required tier or better, per the
  ladder table.
- Placing a locked tool is refused before anything else is checked, at no
  cost, with a reason like `Needs 24 cottagers; 9 live here.` Tier nouns:
  dwellers, cottagers, courtyard residents, townspeople.
- Unlocks are derived from the city, never stored. A city that devolves below a
  line loses the tool until it recovers; standing buildings keep working.
- The starter neighbourhood still builds at population 0.
- Locked toolbar buttons stay visible but disabled, with a lock and the
  requirement in the cost slot, and the reason as tooltip. Pressing a locked
  tool's key shows the reason.
- The guide panel shows one line for the next unlock and how far away it is,
  hidden when nothing is locked.
- Each unlock is celebrated once per session.
- Agents playing through the MCP server see which tools are locked and why.

## Balance targets

Measure by advancing the simulation on seeds 1–8.

- Starter goal (four courtyard houses): unchanged, two to three minutes.
- First fish in a granary from a wharf beside the harbour: under 90 seconds.
- First townhouse from a courtyard neighbourhood plus orchard and press: under
  six minutes.
- A city that builds the full ladder at the starter's pace never drops below
  zero on income alone. Tune costs and upkeep, not timers.
