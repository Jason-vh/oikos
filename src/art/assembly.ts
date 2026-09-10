import * as T from 'three';

export interface AssemblyStep {
  name: string;
  at: number;
  lift?: number;
  duration?: number;
  dust?: boolean;
}

export interface AssemblyPart {
  model: T.Group;
  delay: number;
  duration: number;
  lift: number;
  dust: boolean;
}

export interface ModelAssembly {
  model: T.Group;
  parts: AssemblyPart[];
  scaffolded: boolean;
}

export interface ShellWall {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

const SHELL_OVERLAP = .04;

export function modelAssembly(scaffolded = true): ModelAssembly {
  return { model: new T.Group(), parts: [], scaffolded };
}

export function assemblyPart(assembly: ModelAssembly, step: AssemblyStep): T.Group {
  const model = new T.Group();
  model.name = step.name;
  assembly.model.add(model);
  assembly.parts.push({ model, delay: step.at, duration: step.duration ?? .28, lift: step.lift ?? .3, dust: step.dust ?? false });
  return model;
}

export function shellWalls(width: number, depth: number, thickness: number): ShellWall[] {
  const sideX = (width - thickness) / 2;
  const endZ = (depth - thickness) / 2;
  return [
    { name: 'back-wall', x: 0, z: -endZ, width: width - SHELL_OVERLAP, depth: thickness },
    { name: 'left-wall', x: -sideX, z: 0, width: thickness, depth: depth - SHELL_OVERLAP },
    { name: 'right-wall', x: sideX, z: 0, width: thickness, depth: depth - SHELL_OVERLAP },
    { name: 'front-wall', x: 0, z: endZ, width: width - SHELL_OVERLAP, depth: thickness },
  ];
}
