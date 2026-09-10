import * as T from 'three';

export interface AssemblyPart {
  model: T.Group;
  delay: number;
  duration: number;
  lift: number;
}

export interface ModelAssembly {
  model: T.Group;
  parts: AssemblyPart[];
}

export function assemblyPart(assembly: ModelAssembly, name: string, delay: number, lift = .3, duration = .28): T.Group {
  const model = new T.Group();
  model.name = name;
  assembly.model.add(model);
  assembly.parts.push({ model, delay, duration, lift });
  return model;
}
