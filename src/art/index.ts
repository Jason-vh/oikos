export {
  colors, material, mesh, box, post, lump, group, bake, roof, pot,
  disposeModel,
} from './primitives';
export { litterFor, stump, tree, type Litter } from './vegetation';
export { houseSupplies } from './houses';
export { axe, chopStrikes, CHOP_HEAD, CHOP_SET, citizen, figure, net, spear, animateFigure, animateIdle, animateWork, workPeriod, type Idle, type Load, type WorkKind } from './people';
export { boat, skiff } from './ships';
export { stall } from './stall';
export { getBuildingModel, getBuildingAssembly, type ModelStage, type ModelState } from './buildings';
export type { AssemblyPart, ModelAssembly } from './assembly';
export { scaffolding } from './scaffolding';
export { bundle, bundleKey, bundlesOf, FOOD_ORDER } from './food';
export { animalModel, animateAnimal } from './animals';
