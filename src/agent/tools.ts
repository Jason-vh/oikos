import { z } from 'zod';
import { BUILDINGS, ROAD_COST, VENDOR_COST } from '../sim/catalog';
import { BUILD_TOOLS } from '../sim/commands';
import { UNLOCKS, tierNoun } from '../sim/unlocks';
import { ISLAND_COUNT } from '../sim/island';
import type { ActionResult, City, Rotation, Tile, World } from '../sim/types';
import type { AgentGame } from './game';
import { atlas, cityReport, cityWindow, describeHarbourSite, describePlacement, describeRoadPath, inspectBuilding, inspectTile, islandBounds, surveyIsland, viewpointAt, viewpointOf, viewpointOn, type Viewpoint } from './view';

export interface AgentTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: Shape;
  run(game: AgentGame, args: z.infer<z.ZodObject<Shape>>): Promise<string>;
}

const tile = z.int32();
const coordinates = { x: tile.describe('Tile column'), z: tile.describe('Tile row') };
const tileObject = z.object(coordinates);
const harbourSite = { ...coordinates, rotation: z.int().min(0).max(3).describe('Which way the pier points: 0 south, 1 west, 2 north, 3 east') };
const buildTool = z.enum([...BUILD_TOOLS].sort() as [string, ...string[]]);
const rotation = z.int().min(0).max(3).default(0).describe('Quarter turns clockwise, which swaps width and depth on a quarter and three-quarter turn');
const ANCHOR = '(x,z) is the north-west corner of the footprint, which then runs east and south.';
const bend = z.enum(['x-first', 'z-first']).default('x-first');
const DEFAULT_WINDOW = { width: 40, depth: 28 };

function elbowPath(from: Tile, to: Tile, corner: 'x-first' | 'z-first'): Tile[] {
  const stepX = Math.sign(to.x - from.x);
  const stepZ = Math.sign(to.z - from.z);
  const tiles: Tile[] = [];
  if (corner === 'z-first') {
    for (let z = from.z; z !== to.z; z += stepZ) tiles.push({ x: from.x, z });
    for (let x = from.x; x !== to.x; x += stepX) tiles.push({ x, z: to.z });
  } else {
    for (let x = from.x; x !== to.x; x += stepX) tiles.push({ x, z: from.z });
    for (let z = from.z; z !== to.z; z += stepZ) tiles.push({ x: to.x, z });
  }
  tiles.push(to);
  return tiles;
}

const UNCLAIMED = 'You hold no city yet. survey shows the archipelago, and found_city places your harbour on a shore.';

interface SurveyRequest { island?: number; x?: number; z?: number }

function surveyViewpoint(world: World, city: City | null, args: SurveyRequest): Viewpoint | null {
  if (args.island !== undefined) return viewpointOn(world, args.island, city);
  if (args.x !== undefined && args.z !== undefined) return viewpointAt(world, city, args.x, args.z);
  if (city) return viewpointOf(world, city);
  return null;
}

function outcome(result: ActionResult, city: City | null): string {
  const treasury = city ? ` Treasury ${Math.round(city.money)} dr.` : '';
  return `${result.ok ? 'Done.' : 'Refused.'} ${result.reason}${treasury}`;
}

const buildingCosts = Object.entries(BUILDINGS)
  .filter(([kind]) => kind !== 'harbour')
  .map(([kind, definition]) => `${kind} ${definition.width}x${definition.depth} ${definition.cost} dr`)
  .join(', ');

function unlockLines(): string {
  return (Object.entries(UNLOCKS) as [string, { tier: 1 | 2 | 3 | 4; residents: number }][])
    .map(([kind, requirement]) => `${kind} needs ${requirement.residents} ${tierNoun(requirement.tier)}`)
    .join(', ') + '.';
}

function tool<Shape extends z.ZodRawShape>(definition: AgentTool<Shape>): AgentTool {
  return definition as unknown as AgentTool;
}

export const TOOLS: AgentTool[] = [
  tool({
    name: 'survey',
    description: 'Read the ground as a character map with tile coordinates. Without arguments it shows your city, or the archipelago if you have none; pass island to read a shore you might settle, full for a whole island, or x and z for a window anywhere, founded or not. Start here.',
    schema: {
      island: z.int().min(0).max(ISLAND_COUNT - 1).optional().describe('Island number, 0 to 7'),
      x: tile.optional(),
      z: tile.optional(),
      width: z.int().min(1).max(200).default(DEFAULT_WINDOW.width),
      depth: z.int().min(1).max(200).default(DEFAULT_WINDOW.depth),
      full: z.boolean().default(false),
    },
    async run(game, args) {
      const { world, city } = game.view();
      if (args.island === undefined && args.x === undefined && !city) return atlas(world);
      const view = surveyViewpoint(world, city, args);
      if (!view) return `Open sea: no island holds (${args.x},${args.z}).\n${atlas(world)}`;
      if (args.full) return surveyIsland(world, view, islandBounds(view));
      if (args.x === undefined || args.z === undefined) {
        return surveyIsland(world, view, view.city ? cityWindow(world, view.city) : islandBounds(view));
      }
      return surveyIsland(world, view, { x: args.x, z: args.z, width: args.width, depth: args.depth });
    },
  }),
  tool({
    name: 'report',
    description: 'The state of your city: treasury, population, employment, the goal, every building with its diagnosis, and the walkers on the roads.',
    schema: {},
    async run(game) {
      const { world, city } = game.view();
      if (!city) return `${UNCLAIMED}\n${atlas(world)}`;
      return cityReport(world, city);
    },
  }),
  tool({
    name: 'inspect_tile',
    description: 'Terrain, height, ownership and occupant of one tile, anywhere in the archipelago.',
    schema: coordinates,
    async run(game, args) {
      const { world, city } = game.view();
      return inspectTile(world, city, args.x, args.z);
    },
  }),
  tool({
    name: 'inspect_building',
    description: 'One building by id, with the walkers it has sent out.',
    schema: { id: tile },
    async run(game, args) {
      const { world, city } = game.view();
      if (!city) return UNCLAIMED;
      return inspectBuilding(world, city, args.id);
    },
  }),
  tool({
    name: 'check_build',
    description: `Ask whether buildings may go up, and what they would cost, without spending. Answers one line a site, so plan a whole quarter in one call. ${ANCHOR} Sizes and costs: ${buildingCosts}, road ${ROAD_COST} dr a tile.`,
    schema: { sites: z.array(z.object({ tool: buildTool, ...coordinates, rotation })).min(1).max(24).describe('The placements to try, each a tool and a tile') },
    async run(game, args) {
      const { world, city } = game.view();
      if (!city) return UNCLAIMED;
      return args.sites
        .map((site) => describePlacement(world, city, site.tool as never, site.x, site.z, site.rotation as Rotation))
        .join('\n');
    },
  }),
  tool({
    name: 'check_road',
    description: 'Ask what a road from one tile to another would cost, without spending. The path turns a single corner.',
    schema: { from: tileObject, to: tileObject, bend },
    async run(game, args) {
      const { world, city } = game.view();
      if (!city) return UNCLAIMED;
      return describeRoadPath(world, city, elbowPath(args.from, args.to, args.bend));
    },
  }),
  tool({
    name: 'build',
    description: `Put up a building. It needs level, clear ground and a door onto a road that reaches the harbour; farms need fertile soil, olives take grass, scrub or fertile ground, and a fishing wharf stands on the shore with its jetty over open water. Some tools are earned: ${unlockLines()} A refusal names the shortfall and costs nothing. ${ANCHOR}`,
    schema: { tool: buildTool, ...coordinates, rotation },
    async run(game, args) {
      const result = await game.submit({ type: 'build', tool: args.tool as never, x: args.x, z: args.z, rotation: args.rotation as Rotation });
      return outcome(result, game.view().city);
    },
  }),
  tool({
    name: 'lay_road',
    description: 'Lay a road from one tile to another, turning a single corner. Roads carry every delivery; nothing works unconnected.',
    schema: { from: tileObject, to: tileObject, bend },
    async run(game, args) {
      const result = await game.submit({ type: 'roadPath', tiles: elbowPath(args.from, args.to, args.bend) });
      return outcome(result, game.view().city);
    },
  }),
  tool({
    name: 'demolish',
    description: 'Pull down whatever stands on a tile, road included. Nothing is refunded.',
    schema: coordinates,
    async run(game, args) {
      const result = await game.submit({ type: 'demolish', x: args.x, z: args.z });
      return outcome(result, game.view().city);
    },
  }),
  tool({
    name: 'set_vendor',
    description: `Open or close a stall. An agora hosts a food stall and an oil stall, each costing ${VENDOR_COST} dr the first time and free thereafter; pass stall to say which. The rebuilt harbour takes the same call for its lumber trade.`,
    schema: { id: tile, enabled: z.boolean(), stall: z.enum(['food', 'oil']).default('food') },
    async run(game, args) {
      const result = await game.submit({ type: 'vendor', id: args.id, enabled: args.enabled, stall: args.stall });
      return outcome(result, game.view().city);
    },
  }),
  tool({
    name: 'check_harbour_site',
    description: 'Ask whether a harbour may stand at a tile, facing a way, without committing to it. Its quay takes two rows of shore and its pier three of water.',
    schema: harbourSite,
    async run(game, args) {
      return describeHarbourSite(game.view().world, args.x, args.z, args.rotation as Rotation);
    },
  }),
  tool({
    name: 'found_city',
    description: 'Place your harbour on an unclaimed shore. It claims that island, founds your city, and cannot be moved or given back. Look at survey first.',
    schema: harbourSite,
    async run(game, args) {
      const result = await game.claim(args.x, args.z, args.rotation as Rotation);
      return outcome(result, game.view().city);
    },
  }),
];
