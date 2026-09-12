import { colors } from '../art/primitives';
import { islandAt, islandFor, terrainOn, type IslandMap } from '../sim/island';
import type { Terrain } from '../sim/types';

const MAP_COLORS: Record<Terrain, number> = {
  water: colors.blueLight,
  sand: colors.cream,
  grass: colors.grass,
  fertile: colors.gold,
  scrub: colors.oliveLight,
  forest: colors.oliveDark,
  rock: colors.stone,
  cliff: colors.earth,
};

export function islandFacts(map: IslandMap, home: number): { land: number; fertile: number; forest: number } {
  const island = map.islands[home];
  const facts = { land: 0, fertile: 0, forest: 0 };
  if (!island) return facts;
  for (let z = island.z; z < island.z + island.depth; z++) {
    for (let x = island.x; x < island.x + island.width; x++) {
      const terrain = terrainOn(map, x, z);
      if (terrain !== 'water') facts.land++;
      if (terrain === 'fertile') facts.fertile++;
      if (terrain === 'forest') facts.forest++;
    }
  }
  return facts;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function createIslandChoice(canvas: HTMLCanvasElement, choice: HTMLSelectElement, details: HTMLElement): (seed: number) => void {
  const context = canvas.getContext('2d');
  let map: IslandMap | null = null;
  let background: ImageData | null = null;
  if (!context) canvas.remove();

  function draw(): void {
    if (!map) return;
    let home = map.home;
    if (choice.value !== '' && map.islands[Number(choice.value)]) home = Number(choice.value);
    const island = map.islands[home];
    const facts = islandFacts(map, home);
    details.textContent = `Island ${home + 1}: ${facts.land.toLocaleString('en-US')} land tiles · ${facts.fertile.toLocaleString('en-US')} fertile · ${facts.forest.toLocaleString('en-US')} forest`;
    canvas.setAttribute('aria-label', `Archipelago preview. Island ${home + 1} selected. Use the selection list to choose by keyboard.`);
    if (!context || !background) return;
    context.putImageData(background, 0, 0);
    context.strokeStyle = cssColor(colors.cream);
    context.lineWidth = 3;
    context.strokeRect(island.x - 2, island.z - 2, island.width + 4, island.depth + 4);
    context.font = 'bold 16px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [index, candidate] of map.islands.entries()) {
      const x = candidate.x + candidate.width / 2;
      const z = candidate.z + candidate.depth / 2;
      context.fillStyle = cssColor(index === home ? colors.roof : colors.dark);
      context.beginPath();
      context.arc(x, z, 12, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = cssColor(colors.cream);
      context.fillText(String(index + 1), x, z);
    }
    context.beginPath();
    context.arc(island.entry.x, island.entry.z, 4, 0, Math.PI * 2);
    context.fillStyle = cssColor(colors.cream);
    context.fill();
  }

  choice.addEventListener('change', draw);
  canvas.addEventListener('click', (event) => {
    if (!map) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) / bounds.width * map.width);
    const z = Math.floor((event.clientY - bounds.top) / bounds.height * map.depth);
    if (terrainOn(map, x, z) === 'water') return;
    const island = islandAt(map, x, z);
    if (!island) return;
    choice.value = String(map.islands.indexOf(island));
    choice.dispatchEvent(new Event('change', { bubbles: true }));
  });

  return (seed) => {
    const changed = map?.seed !== seed;
    map = islandFor(seed);
    if (context && changed) {
      canvas.width = map.width;
      canvas.height = map.depth;
      background = context.createImageData(map.width, map.depth);
      for (let index = 0; index < map.terrain.length; index++) {
        const color = MAP_COLORS[map.terrain[index]];
        background.data[index * 4] = color >> 16 & 255;
        background.data[index * 4 + 1] = color >> 8 & 255;
        background.data[index * 4 + 2] = color & 255;
        background.data[index * 4 + 3] = 255;
      }
    }
    draw();
  };
}
