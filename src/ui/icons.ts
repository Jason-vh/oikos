import type { Tool } from '../sim/types';

const ICONS: Partial<Record<Tool, string>> = {
  road: '<path d="M9 21 14 3M23 3l5 18" /><path d="M16 5v3M16 12v3M16 19v2" class="dash" />',
  house: '<path d="M6 15 16 6l10 9" /><path d="M9 14v10h14V14" /><path d="M14 24v-6h4v6" class="fill" />',
  farm: '<path d="M5 25h22" /><path d="M9 25V13M16 25V10M23 25V13" /><path d="M9 13c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" /><path d="M16 10c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" /><path d="M23 13c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" />',
  granary: '<path d="M8 25V11l8-6 8 6v14" /><path d="M8 25h16" /><path d="M11 16h10M11 20h10" /><path d="M13 25v-4h6v4" class="fill" />',
  agora: '<path d="M5 12c2-3 4-3 6 0 2-3 4-3 6 0 2-3 4-3 6 0 2-3 3-3 4 0" /><path d="M7 12v13M25 12v13" /><path d="M7 18h18" /><path d="M11 25v-4h10v4" class="fill" />',
  fountain: '<path d="M6 20h20l-2 5H8Z" /><path d="M13 16h6" /><path d="M16 16v-6" /><path d="M11 10c3-3 7-3 10 0" /><circle cx="16" cy="7" r="1.6" class="fill" />',
  maintenance: '<path d="M8 25 20 13" /><path d="M20 13a4 4 0 1 1 4-4l-2 2-2-2-2 2 2 2Z" /><path d="M8 8l4 4M7 12l5-5" />',
  lodge: '<path d="M6 15 16 7l10 8" /><path d="M9 14v10h14V14" /><path d="M13 24v-5h4v5" class="fill" /><path d="M22 4 26 9M23 3l-3 3" />',
  woodcutter: '<path d="M8 26 20 12" /><path d="M20 12l3-3 4 3-3 4z" class="fill" /><path d="M5 20c2-2 5-2 7 0M5 24c2-2 5-2 7 0" />',
  stockpile: '<path d="M6 24h20" /><path d="M8 24v-6h16v6M11 18v-5h10v5M14 13v-4h4v4" /><path d="M8 18h16M11 13h10" class="dash" />',
  demolish: '<path d="M8 12h16l-2 13H10Z" /><path d="M6 12h20M13 12V9h6v3" /><path d="M13 16v6M19 16v6" />',
};

export function toolIcon(tool: Tool): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'hud-tool-icon');
  svg.innerHTML = ICONS[tool] ?? '';
  return svg;
}
