import { z } from 'zod';
import { BUILDINGS, ROAD_COST, VENDOR_COST } from '../sim/catalog';
import { BUILD_TOOLS } from '../sim/commands';
import { ISLAND_COUNT } from '../sim/island';
import type { ActionResult, City, Rotation, Tile } from '../sim/types';
import type { AgentGame } from './game';
import { atlas, cityReport, cityWindow, describeHarbourSite, describePlacement, describeRoadPath, inspectBuilding, inspectTile, islandBounds, surveyIsland, viewpointOf, viewpointOn } from './view';

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
const rotation = z.int().min(0).max(3).default(0).describe('Quarter turns clockwise');
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

function outcome(result: ActionResult, city: City | null): string {
  const treasury = city ? ` Treasury ${Math.round(city.money)} dr.` : '';
  return `${result.ok ? 'Done.' : 'Refused.'} ${result.reason}${treasury}`;
}

const buildingCosts = Object.entries(BUILDINGS)
  .filter(([kind]) => kind !== 'harbour')
  .map(([kind, definition]) => `${kind} ${definition.cost} dr`)
  .join(', ');

function tool<Shape extends z.ZodRawShape>(definition: AgentTool<Shape>): AgentTool {
  return definition as unknown as AgentTool;
}

export const TOOLS: AgentTool[] = [
  tool({
    name: 'survey',
    description: 'Read the ground as a character map with tile coordinates. Without arguments it shows your city, or the archipelago if you have none; pass island to read a shore you might settle, full for a whole island, or x and z for a window elsewhere. Start here.',
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
      if (args.island === undefined && !city) return atlas(world);
      const view = args.island === undefined ? viewpointOf(world, city!) : viewpointOn(world, args.island);
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
    description: 'Terrain, height, ownership and occupant of one tile.',
    schema: coordinates,
    async run(game, args) {
      const { world, city } = game.view();
      if (!city) return UNCLAIMED;
      return inspectTile(world, city, args.x, args.z);
    },
  }),
  tool({
    name: 'inspect_building',
    description: 'One building by id, with the walkers it has sent out.',
    schema: { id: tile },
    async run(game, args) {
      const { city } = game.view();
      if (!city) return UNCLAIMED;
      return inspectBuilding(city, args.id);
    },
  }),
  tool({
    name: 'check_build',
    description: `Ask whether a building may go up at a tile, and what it would cost, without spending. Costs: ${buildingCosts}, road ${ROAD_COST} dr a tile.`,
    schema: { tool: buildTool, ...coordinates, rotation },
    async run(game, args) {
      const { world, city } = game.view();
      if (!city) return UNCLAIMED;
      return describePlacement(world, city, args.tool as never, args.x, args.z, args.rotation as Rotation);
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
    description: 'Put up a building. It needs level, clear ground and a door onto a road that reaches the harbour; farms need fertile soil.',
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
    description: `Install or stand down a vendor. An agora needs one to distribute food along the roads; the first costs ${VENDOR_COST} dr. The rebuilt harbour needs one to trade lumber.`,
    schema: { id: tile, enabled: z.boolean() },
    async run(game, args) {
      const result = await game.submit({ type: 'vendor', id: args.id, enabled: args.enabled });
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
