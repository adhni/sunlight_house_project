import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Local, deterministic material swatches: no downloads or texture-loading flashes.
const swatches = new Map();
function swatch(kind) {
  if (swatches.has(kind)) return swatches.get(kind);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = kind === "oak" ? 1024 : 256;
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  let seed = 417;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = kind === "oak" ? "#bfa17b" : "#dedbd3";
  ctx.fillRect(0, 0, size, size);
  if (kind === "oak") {
    for (let board = 0; board < 8; board += 1) {
      const x = board * 128;
      ctx.fillStyle = `hsl(33 30% ${62 + random() * 12}%)`;
      ctx.fillRect(x, 0, 128, size);
      for (let grain = 0; grain < 160; grain += 1) {
        const gx = x + random() * 128;
        const bend = random() * 12;
        ctx.strokeStyle = `rgba(65, 39, 20, ${0.025 + random() * 0.075})`;
        ctx.lineWidth = 0.4 + random();
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + bend, size * 0.33, gx - bend, size * 0.66, gx, size);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(52, 32, 18, 0.22)";
      ctx.fillRect(x, 0, 1.8, size);
      const joint = (board % 3) * size / 3;
      ctx.fillRect(x, joint, 128, 1.8);
      ctx.fillStyle = "rgba(255, 240, 209, 0.24)";
      ctx.fillRect(x + 2, 0, 1, size);
    }
  } else {
    const pixels = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const x = (i / 4) % size;
      const y = Math.floor(i / 4 / size);
      const weave = kind === "linen" ? ((x % 4 < 2 ? 9 : -9) + (y % 4 < 2 ? 7 : -7)) : 0;
      const value = 222 + (random() - 0.5) * 25 + weave;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  swatches.set(kind, canvas);
  return canvas;
}

export function surface(kind, color, repeatX = 1, repeatY = 1) {
  const map = new THREE.CanvasTexture(swatch(kind));
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    color, map, bumpMap: map,
    bumpScale: kind === "oak" ? 0.008 : 0.002,
    roughness: kind === "oak" ? 0.58 : 0.95,
    metalness: 0,
  });
}

export function softBox(width, height, depth, material, x = 0, y = 0, z = 0, radius = 0.025) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

export function oakFloor(room) {
  const group = new THREE.Group();
  const slab = softBox(room.width + 0.1, 0.18, room.depth + 0.1,
    new THREE.MeshStandardMaterial({ color: 0xd7cfc3, roughness: 0.9 }), 0, -0.13, 0, 0.018);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.depth),
    surface("oak", 0xc6b89f, room.width / 2, room.depth / 2));
  floor.material.envMapIntensity = 0.65;
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  group.add(slab, floor, floorContactShade(room));
  return group;
}

function floorContactShade(room) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const edgeX = Math.min(64, 256 * 0.22 / room.width);
  const edgeY = Math.min(64, 256 * 0.22 / room.depth);
  // A narrow, soft falloff anchors the floor to the wall junctions.
  for (const [x0, y0, x1, y1] of [[0, 0, edgeX, 0], [256, 0, 256 - edgeX, 0], [0, 0, 0, edgeY], [0, 256, 0, 256 - edgeY]]) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, "rgba(48, 39, 29, 0.22)");
    gradient.addColorStop(1, "rgba(48, 39, 29, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.depth), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
  }));
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -0.003;
  shade.raycast = () => {};
  return shade;
}

function contactShadow(width, depth) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  gradient.addColorStop(0, "rgba(40, 29, 20, 0.3)");
  gradient.addColorStop(0.55, "rgba(40, 29, 20, 0.17)");
  gradient.addColorStop(1, "rgba(40, 29, 20, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;
  mesh.userData.kind = "furniture-contact-shadow";
  mesh.raycast = () => {};
  return mesh;
}

function taperedLeg(group, material, x, z, height, radius = 0.026) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.65, height, 12), material);
  mesh.position.set(x, height / 2, z);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function table(group) {
  const wood = surface("oak", 0xb89c77, 0.35, 0.8);
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xd9d0be, roughness: 0.72 });
  group.add(softBox(1.15, 0.055, 0.68, wood, 0, 0.73, 0, 0.027));
  group.add(softBox(0.94, 0.07, 0.47, wood, 0, 0.67, 0));
  for (const x of [-0.46, 0.46]) for (const z of [-0.22, 0.22]) taperedLeg(group, wood, x, z, 0.69, 0.035);
  // A small still life gives the otherwise empty scale table a human context.
  const book = softBox(0.27, 0.035, 0.2, new THREE.MeshStandardMaterial({ color: 0x777e66, roughness: 0.92 }), -0.22, 0.775, 0.06, 0.005);
  book.rotation.y = -0.16;
  group.add(book);
  group.add(softBox(0.24, 0.018, 0.18, new THREE.MeshStandardMaterial({ color: 0xe7dfcc, roughness: 0.9 }), -0.22, 0.8, 0.06, 0.003));
  const profile = [[0.036, 0], [0.065, 0.02], [0.075, 0.09], [0.059, 0.14], [0.025, 0.19], [0.026, 0.23], [0.021, 0.23], [0.02, 0.19]];
  const vase = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 32), ceramic);
  vase.position.set(0.25, 0.758, -0.08);
  group.add(vase);
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x68785b, roughness: 0.9, side: THREE.DoubleSide });
  for (let branch = 0; branch < 3; branch += 1) {
    const start = new THREE.Vector3(0.25, 0.93, -0.08);
    const end = new THREE.Vector3(0.2 + branch * 0.06, 1.19 + branch * 0.05, -0.16 + branch * 0.075);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, start.distanceTo(end), 6), leafMaterial);
    stem.position.copy(start).add(end).multiplyScalar(0.5);
    stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    group.add(stem);
    for (let i = 1; i < 5; i += 1) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), leafMaterial);
      leaf.scale.set(0.026, 0.006, 0.052);
      leaf.position.copy(start).lerp(end, i / 4);
      leaf.rotation.set(0.35, i * 2.4 + branch, 0.4);
      group.add(leaf);
    }
  }
  group.add(contactShadow(1.15, 0.68));
}

function sofa(group) {
  const linen = surface("linen", 0xc3bea9, 3, 3);
  const cushion = surface("linen", 0xd5cbb7, 3, 3);
  const wood = surface("oak", 0x70523b);
  for (const x of [-0.69, 0.69]) for (const z of [-0.24, 0.24]) taperedLeg(group, wood, x, z, 0.16, 0.028);
  group.add(softBox(1.66, 0.19, 0.69, linen, 0, 0.235, 0, 0.065));
  group.add(softBox(1.62, 0.51, 0.13, linen, 0, 0.57, 0.285, 0.055));
  for (const sign of [-1, 1]) {
    group.add(softBox(0.14, 0.4, 0.71, linen, sign * 0.79, 0.38, 0, 0.065));
    group.add(softBox(0.695, 0.14, 0.53, cushion, sign * 0.356, 0.39, -0.055, 0.063));
    const back = softBox(0.69, 0.36, 0.145, cushion, sign * 0.356, 0.615, 0.18, 0.065);
    back.rotation.x = -0.1;
    group.add(back);
    const pillow = softBox(0.27, 0.28, 0.11,
      surface("linen", sign < 0 ? 0x9c6348 : 0x67725a, 2, 2), sign * 0.56, 0.58, 0.045, 0.052);
    pillow.rotation.set(-0.17, sign * 0.16, sign * -0.16);
    group.add(pillow);
  }
  group.add(contactShadow(1.72, 0.72));
}

function chair(group) {
  const wood = surface("oak", 0xa48a64, 0.5, 1);
  const fabric = surface("linen", 0x78816c, 2, 2);
  for (const x of [-0.16, 0.16]) for (const z of [-0.16, 0.16]) taperedLeg(group, wood, x, z, 0.43, 0.022);
  group.add(softBox(0.42, 0.045, 0.42, wood, 0, 0.43, 0, 0.035));
  group.add(softBox(0.38, 0.065, 0.37, fabric, 0, 0.48, -0.015, 0.03));
  for (const x of [-0.17, 0.17]) group.add(softBox(0.032, 0.4, 0.035, wood, x, 0.62, 0.175, 0.012));
  const back = softBox(0.42, 0.22, 0.065, wood, 0, 0.79, 0.175, 0.03);
  back.rotation.x = -0.08;
  group.add(back, contactShadow(0.42, 0.42));
}

function bed(group) {
  const wood = surface("oak", 0xa58b69);
  const linen = surface("linen", 0xf4eee0, 5, 5);
  const cover = surface("linen", 0x87917c, 4, 4);
  for (const x of [-0.6, 0.6]) for (const z of [-0.8, 0.8]) taperedLeg(group, wood, x, z, 0.2, 0.04);
  group.add(softBox(1.45, 0.2, 2, wood, 0, 0.25, 0, 0.035));
  group.add(softBox(1.45, 0.85, 0.1, wood, 0, 0.54, 0.95, 0.04));
  group.add(softBox(1.4, 0.23, 1.88, linen, 0, 0.43, -0.015, 0.095));
  group.add(softBox(1.42, 0.1, 1.24, cover, 0, 0.555, -0.31, 0.049));
  group.add(softBox(1.42, 0.055, 0.2, cover, 0, 0.61, 0.2, 0.025));
  for (const sign of [-1, 1]) {
    const pillow = softBox(0.58, 0.145, 0.37, linen, sign * 0.35, 0.61, 0.64, 0.07);
    pillow.rotation.y = sign * 0.06;
    group.add(pillow);
  }
  group.add(contactShadow(1.45, 2));
}

export function interiorFurniture(type, scale) {
  const group = new THREE.Group();
  ({ table, sofa, chair, bed }[type] || table)(group);
  group.scale.setScalar(scale);
  return group;
}
