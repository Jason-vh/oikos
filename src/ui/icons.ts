import type { Resource, Tool } from '../sim/types';

export type ToolIconName = Tool | 'harbour';

const ICONS: Partial<Record<ToolIconName, string>> = {
  harbour: '<path d="M4 14h24" /><path d="M9 14v8M16 14v8M23 14v8" /><path d="M10 14V9l4-3 4 3v5" class="fill" /><path d="M4 26c3-2 5 2 8 0s5 2 8 0 5 2 8 0" />',
  road: '<path d="M9 21 14 3M23 3l5 18" /><path d="M16 5v3M16 12v3M16 19v2" class="dash" />',
  house: '<path d="M6 15 16 6l10 9" /><path d="M9 14v10h14V14" /><path d="M14 24v-6h4v6" class="fill" />',
  farm: '<path d="M5 25h22" /><path d="M9 25V13M16 25V10M23 25V13" /><path d="M9 13c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" /><path d="M16 10c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" /><path d="M23 13c-2-1-3-3-3-5 2 0 3 2 3 5Zm0-4c0-2 1-4 3-5 0 2-1 4-3 5Z" />',
  granary: '<path d="M8 25V11l8-6 8 6v14" /><path d="M8 25h16" /><path d="M11 16h10M11 20h10" /><path d="M13 25v-4h6v4" class="fill" />',
  agora: '<path d="M5 12c2-3 4-3 6 0 2-3 4-3 6 0 2-3 4-3 6 0 2-3 3-3 4 0" /><path d="M7 12v13M25 12v13" /><path d="M7 18h18" /><path d="M11 25v-4h10v4" class="fill" />',
  fountain: '<path d="M6 20h20l-2 5H8Z" /><path d="M13 16h6" /><path d="M16 16v-6" /><path d="M11 10c3-3 7-3 10 0" /><circle cx="16" cy="7" r="1.6" class="fill" />',
  maintenance: '<path d="M8 25 20 13" /><path d="M20 13a4 4 0 1 1 4-4l-2 2-2-2-2 2 2 2Z" /><path d="M8 8l4 4M7 12l5-5" />',
  lodge: '<path d="M6 15 16 7l10 8" /><path d="M9 14v10h14V14" /><path d="M13 24v-5h4v5" class="fill" /><path d="M22 4 26 9M23 3l-3 3" />',
  woodcutter: '<path d="M8 26 20 12" /><path d="M20 12l3-3 4 3-3 4z" class="fill" /><path d="M5 20c2-2 5-2 7 0M5 24c2-2 5-2 7 0" />',
  orchard: '<path d="M5 27h22" /><path d="M11 27v-7M21 27v-9" /><path d="M6 15a5 5 0 0 1 5-5 5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5Z" /><path d="M16 13a5 5 0 0 1 5-5 5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5Z" /><circle cx="11" cy="15" r="1.4" class="fill" /><circle cx="21" cy="13" r="1.4" class="fill" />',
  press: '<path d="M5 26h22" /><path d="M8 26v-6h16v6" /><path d="M10 20a6 6 0 0 1 12 0" /><path d="M16 14V5" /><path d="M10 5h12" /><path d="M13 26v-4h6v4" class="fill" />',
  wharf: '<path d="M4 22h24" /><path d="M9 22v5M16 22v5M23 22v5" /><path d="M6 18c2-4 7-6 11-6 3 0 5 2 6 5-1 3-3 5-6 5-4 0-9-2-11-4Z" /><path d="M20 16v.5" /><path d="M6 18c0-2-1-4-3-5 0 3 0 7 0 10 2-1 3-3 3-5Z" class="fill" />',
  stockpile: '<path d="M6 24h20" /><path d="M8 24v-6h16v6M11 18v-5h10v5M14 13v-4h4v4" /><path d="M8 18h16M11 13h10" class="dash" />',
  demolish: '<path d="M8 12h16l-2 13H10Z" /><path d="M6 12h20M13 12V9h6v3" /><path d="M13 16v6M19 16v6" />',
};

const RESOURCE_ICONS: Record<Resource, string> = {
  wheat: '<path d="M2 22 16 8" /><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" /><path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" /><path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" /><path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />',
  carrots: '<path d="M15 16a1 1 0 0 0-7-7q-4 4-5.987 12.385a.5.5 0 0 0 .602.602Q11 20 15 16l-3-3" /><path d="M15 9q4 4 7 0-3-4-7 0 4-4 0-7-4 3 0 7" /><path d="m8 15-2.58-2.58" />',
  olives: '<path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z" /><path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z" /><path d="M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12" /><path d="M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z" />',
  lumber: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z" /><path d="M7 16v6" /><path d="M13 19v3" /><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5" />',
  clay: '<path d="M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8" /><path d="M10 5H8a2 2 0 0 0 0 4h.68" /><path d="M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8" /><path d="M14 5h2a2 2 0 0 1 0 4h-.68" /><path d="M18 22H6" /><path d="M9 2h6" />',
  stone: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 9v6" /><path d="M16 15v6" /><path d="M16 3v6" /><path d="M3 15h18" /><path d="M3 9h18" /><path d="M8 15v6" /><path d="M8 3v6" />',
  meat: '<path d="M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3" /><path d="m18.5 6 1.754 3.5a6.48 6.48 0 0 1-1.854 8.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5" /><circle cx="12.5" cy="8.5" r="2.5" />',
  oil: '<path d="M10 3h4" /><path d="M12 3v3" /><path d="M8.5 9.5C8.5 7.6 10.1 6 12 6s3.5 1.6 3.5 3.5c0 1.2 1.5 2.3 1.5 4.5a5 5 0 0 1-10 0c0-2.2 1.5-3.3 1.5-4.5Z" /><path d="M9 15c1.5 1.5 4.5 1.5 6 0" /><path d="M17 7c2 1 3 2.5 3 4" />',
  fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z" /><path d="M18 12v.5" /><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86" /><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" /><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4" /><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98" />',
};

export function toolIcon(tool: ToolIconName): SVGSVGElement {
  return icon(ICONS[tool] ?? '', 'hud-tool-icon', 32);
}

export function resourceIcon(resource: Resource): SVGSVGElement {
  return icon(RESOURCE_ICONS[resource], 'hud-resource-icon', 24);
}

function icon(shape: string, className: string, size: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = shape;
  return svg;
}
