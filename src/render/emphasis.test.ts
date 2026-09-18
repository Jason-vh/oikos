import { expect, test } from 'bun:test';
import * as T from 'three';
import { glowMaterial, glowStrength, ModelGlow } from './emphasis';

function figure(): { root: T.Group; meshes: T.Mesh[] } {
  const root = new T.Group();
  const meshes = [0xb85e41, 0x426f83].map((color) => {
    const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color }));
    root.add(mesh);
    return mesh;
  });
  return { root, meshes };
}

test('a glow keeps the part its own colour and lights it from within', () => {
  const blue = new T.MeshStandardMaterial({ color: 0x426f83 });
  const roof = new T.MeshStandardMaterial({ color: 0xb85e41 });
  const litBlue = glowMaterial(blue, 'hover') as T.MeshStandardMaterial;
  const litRoof = glowMaterial(roof, 'hover') as T.MeshStandardMaterial;
  expect(litBlue).not.toBe(blue);
  expect(litBlue.color.getHex()).toBe(blue.color.getHex());
  expect(litBlue.emissive.getHex()).not.toBe(litRoof.emissive.getHex());
  expect(litRoof.emissive.r).toBeGreaterThan(litBlue.emissive.r);
});

test('each channel glows on its own, so hovering never dims a selection', () => {
  const source = new T.MeshStandardMaterial({ color: 0x879557 });
  const hovered = glowMaterial(source, 'hover') as T.MeshStandardMaterial;
  const selected = glowMaterial(source, 'select') as T.MeshStandardMaterial;
  expect(hovered).not.toBe(selected);
  expect(glowMaterial(source, 'hover')).toBe(hovered);
  glowStrength('hover', 0);
  expect(hovered.emissiveIntensity).toBe(0);
  expect(selected.emissiveIntensity).toBeGreaterThan(0);
  glowStrength('hover', 1);
  expect(hovered.emissiveIntensity).toBeGreaterThan(0);
});

test('letting a model go puts its own materials back', () => {
  const { root, meshes } = figure();
  const originals = meshes.map((mesh) => mesh.material);
  const glow = new ModelGlow('hover');
  glow.attach(root);
  meshes.forEach((mesh, index) => expect(mesh.material).not.toBe(originals[index]));
  glow.detach();
  meshes.forEach((mesh, index) => expect(mesh.material).toBe(originals[index]));
});

test('moving a glow between models leaves only the new one lit', () => {
  const first = figure();
  const second = figure();
  const originals = first.meshes.map((mesh) => mesh.material);
  const glow = new ModelGlow('select');
  glow.attach(first.root);
  glow.attach(second.root);
  first.meshes.forEach((mesh, index) => expect(mesh.material).toBe(originals[index]));
  second.meshes.forEach((mesh, index) => expect(mesh.material).not.toBe(originals[index]));
});

test('a glow of a glow is the same glow, so a lit model never keeps one', () => {
  const source = new T.MeshStandardMaterial({ color: 0xb85e41 });
  const once = glowMaterial(source, 'hover');
  expect(glowMaterial(once, 'hover')).toBe(once);
  expect(glowMaterial(once, 'select')).toBe(glowMaterial(source, 'select'));
});

test('a model held by both channels goes back to its own materials', () => {
  const { root, meshes } = figure();
  const originals = meshes.map((mesh) => mesh.material);
  const hover = new ModelGlow('hover');
  const select = new ModelGlow('select');
  hover.attach(root);
  select.attach(root);
  hover.detach();
  select.detach();
  meshes.forEach((mesh, index) => expect(mesh.material).toBe(originals[index]));
});
