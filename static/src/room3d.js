import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  floor: 0xf8f1e5,
  wall: 0xe7ddd0,
  wallEdge: 0x657378,
  window: 0x2b627a,
  selectedWindowFrame: 0x6d4bb8,
  sunlight: 0xffbd55,
  sunlightEdge: 0xd85824,
  north: 0x2b627a,
  front: 0xd36c32,
  door: 0x9c6846,
  doorEdge: 0x4d3428,
  internalWall: 0xd8cbbb,
  roof: 0xb9afa3,
  furniture: 0x56747f,
  furnitureAccent: 0x8b6a54,
  furnitureWood: 0x9a744f,
  externalObstruction: 0x8f857c,
};

const FACING_DEGREES = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const FURNITURE_FOOTPRINTS = {
  table: [1.15, 0.68],
  chair: [0.42, 0.42],
  sofa: [1.72, 0.72],
  bed: [1.45, 2.0],
};

function disposeMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  materials.filter(Boolean).forEach((item) => {
    Object.values(item).forEach((value) => {
      if (value && value.isTexture) {
        value.dispose();
      }
    });
    item.dispose();
  });
}

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (object.material) {
      disposeMaterial(object.material);
    }
  });
}

function replaceGroupContents(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function appPointToThree(point, room) {
  // App coordinates: X=width, Y=depth, Z=height.
  // Three.js coordinates: east=+X, up=+Y, north=-Z.
  return new THREE.Vector3(
    Number(point[0]) - room.width / 2,
    Number(point[2]),
    room.depth / 2 - Number(point[1]),
  );
}

function wallDefinition(name, room, thickness) {
  const definitions = {
    north: {
      name,
      length: room.width,
      normal: new THREE.Vector3(0, 0, -1),
      position: new THREE.Vector3(0, 0, -room.depth / 2),
      spanAxis: "x",
    },
    south: {
      name,
      length: room.width,
      normal: new THREE.Vector3(0, 0, 1),
      position: new THREE.Vector3(0, 0, room.depth / 2),
      spanAxis: "x",
    },
    east: {
      name,
      length: room.depth,
      normal: new THREE.Vector3(1, 0, 0),
      position: new THREE.Vector3(room.width / 2, 0, 0),
      spanAxis: "z",
    },
    west: {
      name,
      length: room.depth,
      normal: new THREE.Vector3(-1, 0, 0),
      position: new THREE.Vector3(-room.width / 2, 0, 0),
      spanAxis: "z",
    },
  };
  return { ...definitions[name], thickness };
}

function wallOpening(windowData, definition, roomHeight) {
  const spanCenter = definition.spanAxis === "x"
    ? Number(windowData.center_xyz[0])
    : Number(windowData.center_xyz[1]);
  return {
    start: Math.max(0, spanCenter - Number(windowData.width) / 2),
    end: Math.min(definition.length, spanCenter + Number(windowData.width) / 2),
    bottom: Math.max(0, Number(windowData.sill_height)),
    top: Math.min(roomHeight, Number(windowData.sill_height) + Number(windowData.height)),
  };
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([start, end]) => end - start > 1e-8)
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const previous = merged[merged.length - 1];
    if (!previous || start > previous[1] + 1e-8) {
      merged.push([start, end]);
    } else {
      previous[1] = Math.max(previous[1], end);
    }
  });
  return merged;
}

function wallSolidIntervals(length, openings) {
  const mergedOpenings = mergeIntervals(openings);
  const solids = [];
  let cursor = 0;
  mergedOpenings.forEach(([start, end]) => {
    if (start > cursor + 1e-8) {
      solids.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < length - 1e-8) {
    solids.push([cursor, length]);
  }
  return solids;
}

function makeWallPanel(definition, spanStart, spanEnd, bottom, top) {
  const span = spanEnd - spanStart;
  const height = top - bottom;
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.wall,
    roughness: 0.9,
    metalness: 0,
  });
  const geometry = definition.spanAxis === "x"
    ? new THREE.BoxGeometry(span, height, definition.thickness)
    : new THREE.BoxGeometry(definition.thickness, height, span);
  const panel = new THREE.Mesh(geometry, material);
  const centeredSpan = (spanStart + spanEnd) / 2 - definition.length / 2;
  panel.position.copy(definition.position);
  panel.position.y = (bottom + top) / 2;
  panel.position[definition.spanAxis] = definition.spanAxis === "z" ? -centeredSpan : centeredSpan;
  panel.userData = { kind: "wall-panel", wall: definition.name };
  panel.renderOrder = 1;
  return panel;
}

function makeWallOutline(definition, roomHeight) {
  const halfLength = definition.length / 2;
  const halfThickness = definition.thickness / 2 + 0.002;
  const points = definition.spanAxis === "x"
    ? [
      new THREE.Vector3(-halfLength, 0, definition.normal.z * halfThickness),
      new THREE.Vector3(halfLength, 0, definition.normal.z * halfThickness),
      new THREE.Vector3(halfLength, roomHeight, definition.normal.z * halfThickness),
      new THREE.Vector3(-halfLength, roomHeight, definition.normal.z * halfThickness),
    ]
    : [
      new THREE.Vector3(definition.normal.x * halfThickness, 0, -halfLength),
      new THREE.Vector3(definition.normal.x * halfThickness, 0, halfLength),
      new THREE.Vector3(definition.normal.x * halfThickness, roomHeight, halfLength),
      new THREE.Vector3(definition.normal.x * halfThickness, roomHeight, -halfLength),
    ];
  const geometry = new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
  const outline = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true, opacity: 0.68 }),
  );
  outline.position.copy(definition.position);
  outline.userData = { kind: "wall-outline", wall: definition.name };
  outline.renderOrder = 2;
  return outline;
}

function makeWallWithOpenings(name, windows, room, thickness) {
  const definition = wallDefinition(name, room, thickness);
  const openings = windows.map((windowData) => wallOpening(windowData, definition, room.height));
  const wall = new THREE.Group();
  const verticalStops = [...new Set([
    0,
    room.height,
    ...openings.flatMap((opening) => [opening.bottom, opening.top]),
  ])].sort((left, right) => left - right);

  for (let index = 0; index < verticalStops.length - 1; index += 1) {
    const bottom = verticalStops[index];
    const top = verticalStops[index + 1];
    if (top - bottom <= 1e-8) continue;
    const midpoint = (bottom + top) / 2;
    const activeOpenings = openings
      .filter((opening) => midpoint > opening.bottom + 1e-8 && midpoint < opening.top - 1e-8)
      .map((opening) => [opening.start, opening.end]);
    wallSolidIntervals(definition.length, activeOpenings).forEach(([start, end]) => {
      wall.add(makeWallPanel(definition, start, end, bottom, top));
    });
  }

  wall.add(makeWallOutline(definition, room.height));
  wall.userData = {
    kind: "wall",
    wall: name,
    normal: definition.normal,
    openingCount: openings.length,
  };
  return wall;
}

function makeWindow(windowData, room) {
  const center = appPointToThree(windowData.center_xyz, room);
  const thickness = Math.max(Math.min(room.width, room.depth) * 0.008, 0.018);
  const isFrontBack = windowData.wall === "north" || windowData.wall === "south";
  const geometry = isFrontBack
    ? new THREE.BoxGeometry(windowData.width, windowData.height, thickness)
    : new THREE.BoxGeometry(thickness, windowData.height, windowData.width);
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.window,
    emissive: 0x123442,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.36,
    roughness: 0.18,
    metalness: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(geometry, glassMaterial);
  glass.position.copy(center);
  glass.userData = { kind: "window-glass", windowName: windowData.name, wall: windowData.wall };
  glass.renderOrder = 4;

  const frameMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), frameMaterial);
  frame.position.copy(center);
  frame.userData = { kind: "window-frame", windowName: windowData.name, wall: windowData.wall };
  frame.renderOrder = 5;

  const group = new THREE.Group();
  group.add(glass, frame);
  group.userData = { kind: "window", windowName: windowData.name, wall: windowData.wall };
  return { group, glassMaterial, frameMaterial, center };
}

function makePatch(patch, room) {
  const points = patch.polygon_xy.map((point) => new THREE.Vector3(
    Number(point[0]) - room.width / 2,
    0.002,
    room.depth / 2 - Number(point[1]),
  ));
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const intensity = Math.max(0, Math.min(1, Number(patch.intensity) || 0));
  const material = new THREE.MeshBasicMaterial({
    color: COLORS.sunlight,
    transparent: true,
    opacity: 0.48 + intensity * 0.36,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const fill = new THREE.Mesh(geometry, material);
  fill.position.y = 0.002;
  fill.renderOrder = 3;
  fill.userData = {
    kind: "sunlight-patch",
    windowName: patch.window_name,
    baseOpacity: material.opacity,
  };

  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: COLORS.sunlightEdge, transparent: true, opacity: 0.96 }),
  );
  edge.renderOrder = 4;
  edge.userData = {
    kind: "sunlight-patch-edge",
    windowName: patch.window_name,
    baseOpacity: edge.material.opacity,
  };
  const group = new THREE.Group();
  group.add(fill, edge);
  group.userData = { kind: "sunlight-patch-group", windowName: patch.window_name };
  return group;
}

function makeFloorGrid(room) {
  const points = [];
  for (let offset = 1; offset < room.width - 1e-8; offset += 1) {
    const x = -room.width / 2 + offset;
    points.push(
      new THREE.Vector3(x, 0.001, -room.depth / 2),
      new THREE.Vector3(x, 0.001, room.depth / 2),
    );
  }
  for (let offset = 1; offset < room.depth - 1e-8; offset += 1) {
    const z = room.depth / 2 - offset;
    points.push(
      new THREE.Vector3(-room.width / 2, 0.001, z),
      new THREE.Vector3(room.width / 2, 0.001, z),
    );
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x8e9698, transparent: true, opacity: 0.28 }),
  );
  grid.renderOrder = 2;
  grid.userData = { kind: "floor-grid", spacingMetres: 1 };
  return grid;
}

function makeBeam(windowData, patch, room) {
  const source = appPointToThree(patch.source_center_xyz || windowData.center_xyz, room);
  const floorPoints = patch.polygon_xy.map((point) => new THREE.Vector3(
    Number(point[0]) - room.width / 2,
    0.006,
    room.depth / 2 - Number(point[1]),
  ));
  const vertices = [];
  floorPoints.forEach((point, index) => {
    const next = floorPoints[(index + 1) % floorPoints.length];
    vertices.push(...source.toArray(), ...point.toArray(), ...next.toArray());
  });
  const fanGeometry = new THREE.BufferGeometry();
  fanGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  fanGeometry.computeVertexNormals();
  const intensity = Math.max(0, Math.min(1, Number(patch.intensity) || 0));
  const fan = new THREE.Mesh(
    fanGeometry,
    new THREE.MeshBasicMaterial({
      color: COLORS.sunlight,
      transparent: true,
      opacity: 0.09 + intensity * 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  fan.renderOrder = 3;
  fan.userData = {
    kind: "sunlight-volume",
    windowName: patch.window_name,
    baseOpacity: fan.material.opacity,
  };

  const centroid = floorPoints.reduce((total, point) => total.add(point), new THREE.Vector3())
    .multiplyScalar(1 / floorPoints.length);
  const radius = Math.max(Math.min(room.width, room.depth) * 0.005, 0.009);
  const ray = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.LineCurve3(source, centroid), 1, radius, 6, false),
    new THREE.MeshBasicMaterial({
      color: COLORS.sunlightEdge,
      transparent: true,
      opacity: 0.42 + intensity * 0.32,
      depthWrite: false,
    }),
  );
  ray.renderOrder = 4;
  ray.userData = {
    kind: "sunlight-ray",
    windowName: patch.window_name,
    baseOpacity: ray.material.opacity,
  };
  const group = new THREE.Group();
  group.add(fan, ray);
  group.userData = { kind: "sunlight-beam-group", windowName: patch.window_name };
  return group;
}

function makeDoor(doorData, room, thickness) {
  const center = appPointToThree(doorData.center_xyz, room);
  const isFrontBack = doorData.wall === "north" || doorData.wall === "south";
  const geometry = isFrontBack
    ? new THREE.BoxGeometry(doorData.width, doorData.height, thickness * 0.72)
    : new THREE.BoxGeometry(thickness * 0.72, doorData.height, doorData.width);
  const slab = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.78, metalness: 0.02 }),
  );
  slab.position.copy(center);
  slab.userData = { kind: "door", wall: doorData.wall };
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: COLORS.doorEdge, transparent: true, opacity: 0.9 }),
  );
  frame.position.copy(center);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(doorData.width * 0.025, 0.018), 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8b56b, roughness: 0.35, metalness: 0.62 }),
  );
  knob.position.copy(center);
  const side = doorData.width * 0.31;
  if (isFrontBack) {
    knob.position.x += side;
    knob.position.z += doorData.wall === "north" ? thickness * 0.42 : -thickness * 0.42;
  } else {
    knob.position.z -= side;
    knob.position.x += doorData.wall === "east" ? -thickness * 0.42 : thickness * 0.42;
  }
  const group = new THREE.Group();
  group.add(slab, frame, knob);
  group.userData = { kind: "door", wall: doorData.wall };
  return group;
}

function makeInternalWall(wallData, room) {
  const start = appPointToThree([wallData.start_xy[0], wallData.start_xy[1], 0], room);
  const end = appPointToThree([wallData.end_xy[0], wallData.end_xy[1], 0], room);
  const delta = end.clone().sub(start);
  const length = Math.hypot(delta.x, delta.z);
  const geometry = new THREE.BoxGeometry(length, wallData.height, wallData.thickness);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: COLORS.internalWall, roughness: 0.92 }),
  );
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.position.y = wallData.height / 2;
  mesh.rotation.y = -Math.atan2(delta.z, delta.x);
  mesh.userData = { kind: "internal-wall" };
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true, opacity: 0.62 }),
  );
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  const group = new THREE.Group();
  group.add(mesh, outline);
  group.userData = { kind: "internal-wall" };
  return group;
}

function makeExternalObstruction(obstructionData, room) {
  const [width, depth, height] = obstructionData.size_xyz.map(Number);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: COLORS.externalObstruction,
      transparent: true,
      opacity: 0.3,
      roughness: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.copy(appPointToThree(obstructionData.center_xyz, room));
  mesh.renderOrder = 1;
  mesh.userData = { kind: "external-obstruction", preset: obstructionData.preset };
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true, opacity: 0.8 }),
  );
  outline.position.copy(mesh.position);
  const group = new THREE.Group();
  group.add(mesh, outline);
  group.userData = { kind: "external-obstruction", preset: obstructionData.preset };
  return group;
}

function makeRoofDetails(roofData, room) {
  const roofGroup = new THREE.Group();
  const eaveGroup = new THREE.Group();
  const depth = roofData.eave_depth;
  const thickness = roofData.thickness;
  const roofGeometry = new THREE.BoxGeometry(room.width + depth * 2, thickness, room.depth + depth * 2);
  const roof = new THREE.Mesh(
    roofGeometry,
    new THREE.MeshStandardMaterial({
      color: COLORS.roof,
      transparent: true,
      opacity: 0.42,
      roughness: 0.86,
      depthWrite: false,
    }),
  );
  roof.position.y = room.height + thickness / 2;
  roof.renderOrder = 6;
  roof.userData = { kind: "roof" };
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(roofGeometry),
    new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true, opacity: 0.72 }),
  );
  outline.position.copy(roof.position);
  outline.renderOrder = 7;
  roofGroup.add(roof, outline);

  if (roofData.eaves_enabled) {
    const eaveMaterial = () => new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.88 });
    const eaves = [
      { size: [room.width + depth * 2, thickness, depth], position: [0, room.height, -room.depth / 2 - depth / 2] },
      { size: [room.width + depth * 2, thickness, depth], position: [0, room.height, room.depth / 2 + depth / 2] },
      { size: [depth, thickness, room.depth], position: [room.width / 2 + depth / 2, room.height, 0] },
      { size: [depth, thickness, room.depth], position: [-room.width / 2 - depth / 2, room.height, 0] },
    ];
    eaves.forEach(({ size, position }) => {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(...size), eaveMaterial());
      eave.position.set(...position);
      eave.userData = { kind: "eave" };
      eaveGroup.add(eave);
    });
  }
  return { roofGroup, eaveGroup, eaveCount: eaveGroup.children.length };
}

function furnitureBox(width, height, depth, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 }),
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function makeTable(scale, color = COLORS.furnitureWood) {
  const group = new THREE.Group();
  const width = 1.15 * scale;
  const depth = 0.68 * scale;
  const topHeight = 0.72 * scale;
  const topThickness = 0.09 * scale;
  group.add(furnitureBox(width, topThickness, depth, color, 0, topHeight, 0));
  const legHeight = topHeight - topThickness / 2;
  const legSize = 0.08 * scale;
  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((zSign) => {
      group.add(furnitureBox(
        legSize,
        legHeight,
        legSize,
        color,
        xSign * (width / 2 - legSize),
        legHeight / 2,
        zSign * (depth / 2 - legSize),
      ));
    });
  });
  group.userData = { kind: "furniture", type: "table" };
  return group;
}

function makeChair(scale) {
  const group = new THREE.Group();
  const width = 0.42 * scale;
  const depth = 0.42 * scale;
  const seatHeight = 0.43 * scale;
  group.add(furnitureBox(width, 0.08 * scale, depth, COLORS.furniture, 0, seatHeight, 0));
  group.add(furnitureBox(width, 0.52 * scale, 0.08 * scale, COLORS.furniture, 0, 0.68 * scale, depth / 2));
  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((zSign) => {
      group.add(furnitureBox(
        0.055 * scale,
        seatHeight,
        0.055 * scale,
        COLORS.furnitureWood,
        xSign * width * 0.38,
        seatHeight / 2,
        zSign * depth * 0.38,
      ));
    });
  });
  group.userData = { kind: "furniture", type: "chair" };
  return group;
}

function makeSofa(scale) {
  const group = new THREE.Group();
  const width = 1.72 * scale;
  const depth = 0.72 * scale;
  group.add(furnitureBox(width, 0.28 * scale, depth, COLORS.furniture, 0, 0.25 * scale, 0));
  group.add(furnitureBox(width, 0.66 * scale, 0.16 * scale, COLORS.furniture, 0, 0.55 * scale, depth * 0.39));
  [-1, 1].forEach((sign) => {
    group.add(furnitureBox(0.16 * scale, 0.46 * scale, depth, COLORS.furnitureAccent, sign * width * 0.46, 0.34 * scale, 0));
  });
  group.userData = { kind: "furniture", type: "sofa" };
  return group;
}

function makeBed(scale) {
  const group = new THREE.Group();
  const width = 1.45 * scale;
  const depth = 2.0 * scale;
  group.add(furnitureBox(width, 0.34 * scale, depth, 0xe6ded0, 0, 0.28 * scale, 0));
  group.add(furnitureBox(width, 0.78 * scale, 0.12 * scale, COLORS.furnitureWood, 0, 0.47 * scale, depth * 0.47));
  group.add(furnitureBox(width * 0.42, 0.12 * scale, 0.42 * scale, 0xf7f0e6, -width * 0.24, 0.5 * scale, depth * 0.3));
  group.add(furnitureBox(width * 0.42, 0.12 * scale, 0.42 * scale, 0xf7f0e6, width * 0.24, 0.5 * scale, depth * 0.3));
  group.userData = { kind: "furniture", type: "bed" };
  return group;
}

function clampFurnitureItem(item, room) {
  const [baseWidth, baseDepth] = FURNITURE_FOOTPRINTS[item.type] || [0.5, 0.5];
  const numericRotation = Number(item.rotation);
  const numericScale = Number(item.scale);
  const numericX = Number(item.x);
  const numericY = Number(item.y);
  const rotation = (((Number.isFinite(numericRotation) ? numericRotation : 0) % 360) + 360) % 360;
  const scale = THREE.MathUtils.clamp(Number.isFinite(numericScale) ? numericScale : 1, 0.5, 1.5);
  const angle = THREE.MathUtils.degToRad(rotation);
  const width = (Math.abs(Math.cos(angle)) * baseWidth + Math.abs(Math.sin(angle)) * baseDepth) * scale;
  const depth = (Math.abs(Math.sin(angle)) * baseWidth + Math.abs(Math.cos(angle)) * baseDepth) * scale;
  const halfWidth = Math.min(width / 2, room.width / 2);
  const halfDepth = Math.min(depth / 2, room.depth / 2);
  return {
    ...item,
    x: THREE.MathUtils.clamp(Number.isFinite(numericX) ? numericX : room.width / 2, halfWidth, room.width - halfWidth),
    y: THREE.MathUtils.clamp(Number.isFinite(numericY) ? numericY : room.depth / 2, halfDepth, room.depth - halfDepth),
    rotation,
    scale,
  };
}

function makeFurnitureItem(itemData, room) {
  const item = clampFurnitureItem(itemData, room);
  const makers = { sofa: makeSofa, chair: makeChair, table: makeTable, bed: makeBed };
  const root = (makers[item.type] || makeTable)(item.scale);
  root.position.copy(appPointToThree([item.x, item.y, 0], room));
  root.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
  root.userData = { kind: "furniture", furnitureId: item.id, type: item.type };
  root.traverse((object) => {
    object.userData.furnitureId = item.id;
    object.userData.furnitureType = item.type;
  });
  return { root, item };
}

function makeFurniture(furnitureData, room) {
  const group = new THREE.Group();
  const preset = furnitureData?.preset || "none";
  const items = Array.isArray(furnitureData?.items) ? furnitureData.items : [];
  items.forEach((itemData) => group.add(makeFurnitureItem(itemData, room).root));
  group.userData = { kind: "furniture-preset", preset };
  return { group, items: items.map((item) => clampFurnitureItem(item, room)), itemCount: group.children.length, preset };
}

function compassVector(worldAzimuth, frontFacing) {
  const relative = THREE.MathUtils.degToRad((worldAzimuth - frontFacing + 360) % 360);
  return new THREE.Vector3(Math.sin(relative), 0, -Math.cos(relative)).normalize();
}

function makeOrientation(room, facingLabel) {
  const group = new THREE.Group();
  const frontFacing = FACING_DEGREES[facingLabel] ?? 0;
  const origin = new THREE.Vector3(-room.width / 2 + 0.45, 0.065, -room.depth / 2 + 0.45);
  const length = Math.min(Math.max(Math.min(room.width, room.depth) * 0.2, 0.55), 1.1);
  const northDirection = compassVector(0, frontFacing);
  const frontDirection = new THREE.Vector3(0, 0, -1);
  const north = new THREE.ArrowHelper(northDirection, origin, length, COLORS.north, 0.18, 0.1);
  const front = new THREE.ArrowHelper(frontDirection, origin, length * 0.82, COLORS.front, 0.16, 0.09);
  north.userData = { kind: "orientation-arrow", label: "N" };
  front.userData = { kind: "orientation-arrow", label: `Front · ${facingLabel}` };
  group.add(north, front);
  group.userData = {
    kind: "orientation",
  };
  return group;
}

function displayWindowName(name) {
  return String(name || "Window").replace(/_/g, " ");
}

function friendlyWindowName(index, count) {
  return count === 1 ? "Window" : `Window ${index + 1}`;
}

function objectIsVisible(object, root) {
  let current = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function structuralSceneSignature(payload) {
  return JSON.stringify({
    room: payload.room,
    windows: payload.windows,
    frontFacing: payload.window_facing_label,
    scene: payload.scene,
  });
}

class Room3DViewer {
  constructor({
    container,
    statusElement,
    cameraButtons,
    wallsButton,
    roofButton,
    contextButton,
    onWindowSelect,
    onFurnitureSelect,
    onFurnitureChange,
    onUnavailable,
  }) {
    if (window.__SUNLIGHT_FORCE_WEBGL_FAILURE__) {
      throw new Error("WebGL was disabled for this session.");
    }
    this.container = container;
    this.statusElement = statusElement;
    this.cameraButtons = Array.from(cameraButtons || []);
    this.wallsButton = wallsButton;
    this.roofButton = roofButton;
    this.contextButton = contextButton;
    this.onWindowSelect = onWindowSelect;
    this.onFurnitureSelect = onFurnitureSelect;
    this.onFurnitureChange = onFurnitureChange;
    this.onUnavailable = onUnavailable;
    this.payload = null;
    this.active = false;
    this.destroyed = false;
    this.hasFramedScene = false;
    this.wallsVisible = true;
    this.roofVisible = false;
    this.contextVisible = true;
    this.inViewport = true;
    this.isTouchDevice = Boolean(window.matchMedia?.("(any-pointer: coarse)").matches);
    this.primaryPointerIsCoarse = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    this.selectedWindowName = null;
    this.currentSnapshot = null;
    this.windowVisuals = new Map();
    this.furnitureVisuals = new Map();
    this.furnitureItems = [];
    this.selectedFurnitureId = null;
    this.arrangeFurniture = false;
    this.furnitureDrag = null;
    this.justDraggedFurniture = false;
    this.labelElements = new Map();
    this.sceneBuildCount = 0;
    this.structuralSignature = "";
    this.sunlightUpdateCount = 0;
    this.activeCameraPreset = "perspective";
    this.needsRender = true;
    this.raycaster = new THREE.Raycaster();
    this.labelRaycaster = new THREE.Raycaster();
    this.pointerStart = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3eadc);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Orbitable 3D room model. Select a window or its sunlight to trace the floor result.");
    this.renderer.domElement.setAttribute("aria-describedby", "room3d-interaction-hint room3d-keyboard-help");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.showFallback("The 3D renderer stopped. The 2D views are still available.");
    };
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onWheel = () => this.setActiveCameraPreset("custom");
    this.onCanvasClick = (event) => this.handleCanvasClick(event);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerUp);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: true });
    this.renderer.domElement.addEventListener("click", this.onCanvasClick);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "room3d-label-layer";
    this.labelLayer.setAttribute("aria-label", "3D room labels");
    this.interactionLayer = document.createElement("div");
    this.interactionLayer.className = "room3d-interaction-layer";
    this.touchToggle = document.createElement("button");
    this.touchToggle.type = "button";
    this.touchToggle.className = "room3d-touch-toggle";
    this.touchToggle.textContent = "Explore 3D";
    this.touchToggle.setAttribute("aria-pressed", "false");
    this.touchToggle.hidden = !this.isTouchDevice;
    this.interactionLayer.append(this.touchToggle);
    container.replaceChildren(this.renderer.domElement, this.labelLayer, this.interactionLayer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = !this.primaryPointerIsCoarse;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.0001;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.onControlsChange = () => {
      this.constrainCamera();
      this.updateCameraAwareWalls();
      this.needsRender = true;
    };
    this.controls.addEventListener("change", this.onControlsChange);

    this.contentGroup = new THREE.Group();
    this.floorGroup = new THREE.Group();
    this.floorGridGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.windowGroup = new THREE.Group();
    this.doorGroup = new THREE.Group();
    this.internalWallGroup = new THREE.Group();
    this.externalObstructionGroup = new THREE.Group();
    this.furnitureGroup = new THREE.Group();
    this.furnitureSelectionGroup = new THREE.Group();
    this.eaveGroup = new THREE.Group();
    this.roofGroup = new THREE.Group();
    this.sunlightGroup = new THREE.Group();
    this.orientationGroup = new THREE.Group();
    this.contentGroup.add(
      this.floorGroup,
      this.floorGridGroup,
      this.wallGroup,
      this.windowGroup,
      this.doorGroup,
      this.internalWallGroup,
      this.externalObstructionGroup,
      this.furnitureGroup,
      this.furnitureSelectionGroup,
      this.eaveGroup,
      this.roofGroup,
      this.sunlightGroup,
      this.orientationGroup,
    );
    this.scene.add(this.contentGroup);
    this.scene.add(new THREE.HemisphereLight(0xfffbf2, 0x64727a, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 9, -7);
    this.scene.add(keyLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inViewport = entries.some((entry) => entry.isIntersecting);
      this.applyAnimationState();
    }, { threshold: 0.01 });
    this.intersectionObserver.observe(container);
    this.onVisibilityChange = () => this.applyAnimationState();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.onCameraPreset = (event) => this.setCameraPreset(event.currentTarget.dataset.room3dCameraPreset);
    this.onToggleWalls = () => this.toggleWalls();
    this.onToggleRoof = () => this.toggleRoof();
    this.onToggleContext = () => this.toggleContext();
    this.onToggleTouchInteraction = () => this.setTouchInteraction(!this.container.classList.contains("is-touch-interacting"));
    this.cameraButtons.forEach((button) => button.addEventListener("click", this.onCameraPreset));
    wallsButton?.addEventListener("click", this.onToggleWalls);
    roofButton?.addEventListener("click", this.onToggleRoof);
    contextButton?.addEventListener("click", this.onToggleContext);
    this.touchToggle.addEventListener("click", this.onToggleTouchInteraction);

    this.container.dataset.viewerState = "ready";
    this.container.dataset.touchInteraction = this.isTouchDevice ? "scroll" : "desktop";
    this.setStatus("3D room ready.");
    this.resize();
  }

  setStatus(message) {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  showFallback(message) {
    this.destroy();
    this.onUnavailable?.();
    this.container.dataset.viewerState = "fallback";
    this.container.replaceChildren();
    const fallbackMessage = document.createElement("div");
    fallbackMessage.className = "room3d-fallback";
    fallbackMessage.textContent = message;
    this.container.append(fallbackMessage);
    this.setStatus(message);
  }

  resize() {
    if (this.destroyed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.needsRender = true;
    this.updateLabels();
  }

  update(payload) {
    if (this.destroyed || !payload?.room || !Array.isArray(payload.windows)) return;
    const nextSignature = structuralSceneSignature(payload);
    if (this.payload && nextSignature === this.structuralSignature) {
      this.payload = payload;
      this.updateSunlightFrame(payload.snapshot, payload.selected_moment);
      this.updateDebugState();
      return;
    }
    this.payload = payload;
    this.structuralSignature = nextSignature;
    this.sceneBuildCount += 1;
    const room = payload.room;
    replaceGroupContents(this.floorGroup);
    replaceGroupContents(this.floorGridGroup);
    replaceGroupContents(this.wallGroup);
    replaceGroupContents(this.windowGroup);
    replaceGroupContents(this.doorGroup);
    replaceGroupContents(this.internalWallGroup);
    replaceGroupContents(this.externalObstructionGroup);
    replaceGroupContents(this.furnitureGroup);
    replaceGroupContents(this.furnitureSelectionGroup);
    replaceGroupContents(this.eaveGroup);
    replaceGroupContents(this.roofGroup);
    replaceGroupContents(this.sunlightGroup);
    replaceGroupContents(this.orientationGroup);
    this.clearLabels();
    this.windowVisuals.clear();
    this.furnitureVisuals.clear();

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(room.width, 0.04, room.depth),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.94 }),
    );
    floor.position.y = -0.025;
    this.floorGroup.add(floor);
    this.floorGridGroup.add(makeFloorGrid(room));

    const thickness = Math.max(Math.min(room.width, room.depth) * 0.022, 0.045);
    const sceneDetails = payload.scene || {};
    const doorData = sceneDetails.door?.enabled ? sceneDetails.door : null;
    ["north", "south", "east", "west"].forEach((wallName) => {
      const wallOpenings = payload.windows.filter((windowData) => windowData.wall === wallName);
      if (doorData?.wall === wallName) wallOpenings.push(doorData);
      this.wallGroup.add(makeWallWithOpenings(wallName, wallOpenings, room, thickness));
    });

    if (doorData) this.doorGroup.add(makeDoor(doorData, room, thickness));
    if (sceneDetails.internal_wall?.enabled) {
      this.internalWallGroup.add(makeInternalWall(sceneDetails.internal_wall, room));
    }
    if (sceneDetails.external_obstruction?.enabled) {
      this.externalObstructionGroup.add(makeExternalObstruction(sceneDetails.external_obstruction, room));
    }
    const roofDetails = makeRoofDetails(sceneDetails.roof || {
      enabled: false,
      eaves_enabled: false,
      eave_depth: 0,
      thickness: 0.04,
    }, room);
    if (sceneDetails.roof?.enabled) this.roofGroup.add(roofDetails.roofGroup);
    this.eaveGroup.add(roofDetails.eaveGroup);
    this.roofGroup.visible = this.roofVisible;
    const furniture = this.updateFurniture(sceneDetails.furniture, { preserveSelection: true });

    payload.windows.forEach((windowData, index) => {
      const visual = makeWindow(windowData, room);
      this.windowGroup.add(visual.group);
      this.windowVisuals.set(windowData.name, { ...visual, windowData });
      this.addWindowLabel(windowData, visual.center, index, payload.windows.length);
    });

    this.updateSunlightFrame(payload.snapshot, payload.selected_moment, { updateStatus: false });

    const orientation = makeOrientation(room, payload.window_facing_label);
    this.orientationGroup.add(orientation);
    this.addCompassLegend(payload.window_facing_label);

    const scale = Math.max(room.width, room.depth, room.height, 1);
    this.camera.near = Math.max(scale / 500, 0.01);
    this.camera.far = scale * 25;
    this.controls.minDistance = Math.max(scale * 0.3, 0.6);
    this.controls.maxDistance = scale * 5.5;
    this.container.dataset.cameraDistanceRange = `${this.controls.minDistance.toFixed(3)},${this.controls.maxDistance.toFixed(3)}`;
    this.camera.updateProjectionMatrix();
    if (!this.hasFramedScene) {
      this.frameScene();
      this.hasFramedScene = true;
    } else {
      this.constrainCamera();
    }
    const selectedExists = payload.windows.some((windowData) => windowData.name === this.selectedWindowName);
    this.setSelectedWindow(selectedExists ? this.selectedWindowName : payload.windows[0]?.name);
    this.updateCameraAwareWalls();
    this.applyContextVisibility();
    this.updateLabels();

    const wallPanelCount = this.wallGroup.children.reduce(
      (count, wall) => count + wall.children.filter((child) => child.userData.kind === "wall-panel").length,
      0,
    );
    const sunlightBlockerCount = (sceneDetails.internal_wall?.enabled ? 1 : 0)
      + roofDetails.eaveCount
      + (sceneDetails.external_obstruction?.enabled ? 1 : 0);
    this.container.dataset.windowCount = String(payload.windows.length);
    this.container.dataset.openingCount = String(payload.windows.length + (doorData ? 1 : 0));
    this.container.dataset.wallPanelCount = String(wallPanelCount);
    this.container.dataset.doorCount = doorData ? "1" : "0";
    this.container.dataset.doorWall = doorData?.wall || "";
    this.container.dataset.internalWallCount = sceneDetails.internal_wall?.enabled ? "1" : "0";
    this.container.dataset.externalObstructionCount = sceneDetails.external_obstruction?.enabled ? "1" : "0";
    this.container.dataset.externalObstructionPreset = sceneDetails.external_obstruction?.preset || "none";
    this.container.dataset.sunlightBlockerCount = String(sunlightBlockerCount);
    this.container.dataset.eaveCount = String(roofDetails.eaveCount);
    this.container.dataset.furnitureCount = String(furniture.itemCount);
    this.container.dataset.furniturePreset = furniture.preset;
    this.container.dataset.roofVisible = String(this.roofVisible);
    this.container.dataset.contextVisible = String(this.contextVisible);
    this.container.dataset.floorGridVisible = String(this.floorGridGroup.visible);
    this.container.dataset.floorGridSpacing = "1";
    this.container.dataset.sceneVisualOnly = String(Boolean(sceneDetails.visual_only));
    this.container.dataset.patchCount = String(payload.snapshot.patches.length);
    this.container.dataset.selectedMoment = payload.selected_moment;
    this.container.dataset.roomSize = `${room.width},${room.depth},${room.height}`;
    this.container.dataset.frontFacing = payload.window_facing_label;
    this.container.dataset.sceneBuildCount = String(this.sceneBuildCount);
    this.container.dataset.windowGeometry = JSON.stringify(payload.windows.map((windowData) => ({
      name: windowData.name,
      wall: windowData.wall,
      width: windowData.width,
      height: windowData.height,
      center: windowData.center_xyz,
    })));
    this.container.dataset.axisConvention = "east-positive-x north-negative-z";
    this.container.dataset.windowGeometryThree = JSON.stringify(payload.windows.map((windowData) => {
      const center = this.windowVisuals.get(windowData.name).center;
      return {
        name: windowData.name,
        x: Number(center.x.toFixed(3)),
        z: Number(center.z.toFixed(3)),
      };
    }));
    const blockerLabels = [];
    if (sceneDetails.internal_wall?.enabled) blockerLabels.push("divider");
    if (sceneDetails.roof?.eaves_enabled) blockerLabels.push("roof eaves");
    if (sceneDetails.external_obstruction?.enabled) {
      blockerLabels.push(sceneDetails.external_obstruction.preset === "building" ? "nearby building" : "outside fence");
    }
    const blockerStatus = blockerLabels.length
      ? `${blockerLabels.join(" + ")} included in shading`
      : "no extra shade blockers";
    this.setStatus(
      `${payload.windows.length} window opening${payload.windows.length === 1 ? "" : "s"} · ${blockerStatus} · ${furniture.itemCount} scale object${furniture.itemCount === 1 ? "" : "s"} (visual only).`,
    );
    this.needsRender = true;
    this.updateDebugState();
  }

  updateFurniture(furnitureData, { preserveSelection = true } = {}) {
    const room = this.payload?.room;
    if (!room) return { itemCount: 0, preset: "none", items: [] };
    const previousSelection = preserveSelection ? this.selectedFurnitureId : null;
    replaceGroupContents(this.furnitureGroup);
    replaceGroupContents(this.furnitureSelectionGroup);
    this.furnitureVisuals.clear();
    const furniture = makeFurniture(furnitureData, room);
    this.furnitureGroup.add(furniture.group);
    this.furnitureItems = furniture.items.map((item) => ({ ...item }));
    furniture.group.children.forEach((root) => this.furnitureVisuals.set(root.userData.furnitureId, root));
    this.furnitureGroup.visible = this.contextVisible;
    this.furnitureSelectionGroup.visible = this.contextVisible;
    this.container.dataset.furnitureCount = String(furniture.itemCount);
    this.container.dataset.furniturePreset = furniture.preset;
    this.container.dataset.furnitureItems = JSON.stringify(this.furnitureItems);
    this.setSelectedFurniture(this.furnitureVisuals.has(previousSelection) ? previousSelection : null, false);
    this.needsRender = true;
    return furniture;
  }

  setArrangeMode(active) {
    this.arrangeFurniture = Boolean(active);
    if (this.arrangeFurniture && !this.contextVisible) this.toggleContext();
    if (this.arrangeFurniture && this.isTouchDevice) this.setTouchInteraction(true);
    if (!this.arrangeFurniture) {
      if (this.isTouchDevice) this.setTouchInteraction(false);
      this.setSelectedFurniture(null, true);
    }
    this.container.dataset.arrangeMode = String(this.arrangeFurniture);
    this.renderer.domElement.setAttribute(
      "aria-label",
      this.arrangeFurniture
        ? "3D room furniture editor. Select or drag furniture on the floor."
        : "Orbitable 3D room model. Select a window or its sunlight to trace the floor result.",
    );
  }

  setSelectedFurniture(id, notify = false) {
    const selectedId = id && this.furnitureVisuals.has(id) ? id : null;
    this.selectedFurnitureId = selectedId;
    replaceGroupContents(this.furnitureSelectionGroup);
    if (selectedId) {
      const helper = new THREE.BoxHelper(this.furnitureVisuals.get(selectedId), COLORS.furnitureAccent);
      helper.material.depthTest = false;
      helper.renderOrder = 20;
      this.furnitureSelectionGroup.add(helper);
    }
    this.container.dataset.selectedFurniture = selectedId || "";
    this.needsRender = true;
    if (notify) {
      this.onFurnitureSelect?.(this.furnitureItems.find((item) => item.id === selectedId) || null);
    }
  }

  updateSunlightFrame(snapshot, selectedMoment, { updateStatus = true } = {}) {
    if (this.destroyed || !this.payload || !snapshot?.patches) return;
    this.currentSnapshot = snapshot;
    replaceGroupContents(this.sunlightGroup);
    const room = this.payload.room;
    const windowsByName = new Map(this.payload.windows.map((windowData) => [windowData.name, windowData]));
    snapshot.patches.forEach((patch) => {
      this.sunlightGroup.add(makePatch(patch, room));
      const windowData = windowsByName.get(patch.window_name);
      if (windowData && patch.polygon_xy.length) {
        this.sunlightGroup.add(makeBeam(windowData, patch, room));
      }
    });
    this.updateWindowSunStates();
    this.updateSunlightSelection();
    this.needsRender = true;
    this.sunlightUpdateCount += 1;
    this.container.dataset.sunlightUpdateCount = String(this.sunlightUpdateCount);
    this.container.dataset.patchCount = String(snapshot.patches.length);
    if (selectedMoment) this.container.dataset.selectedMoment = selectedMoment;
    if (updateStatus) {
      const time = String(selectedMoment || "").slice(11, 16) || "this time";
      const result = snapshot.state === "floor_hit"
        ? `direct sun reaches the floor in ${snapshot.patches.length} patch${snapshot.patches.length === 1 ? "" : "es"}`
        : snapshot.state === "through_window_no_floor_hit"
          ? "sun enters the room but misses the floor"
          : "the sun does not enter the room";
      this.setStatus(
        `At ${time}, ${result}.`,
      );
    }
  }

  addWindowLabel(windowData, center, index, count) {
    const label = document.createElement("button");
    const friendlyName = friendlyWindowName(index, count);
    label.type = "button";
    label.className = "room3d-window-label";
    label.textContent = friendlyName;
    label.dataset.windowName = windowData.name;
    label.setAttribute("aria-label", `Select ${friendlyName} in the room editor`);
    label.addEventListener("click", () => this.selectWindow(windowData.name, true));
    this.labelLayer.append(label);
    this.labelElements.set(`window:${windowData.name}`, {
      element: label,
      anchor: center.clone().add(new THREE.Vector3(0, windowData.height / 2 + 0.22, 0)),
      occlusionAnchor: center.clone(),
      wall: windowData.wall,
      windowName: windowData.name,
      friendlyName,
    });
  }

  updateWindowSunStates() {
    const intensities = new Map(
      (this.currentSnapshot?.window_intensities || []).map((entry) => [entry.name, Number(entry.intensity) || 0]),
    );
    const floorWindows = new Set((this.currentSnapshot?.patches || []).map((patch) => patch.window_name));
    this.labelElements.forEach(({ element, windowName, friendlyName }) => {
      if (!windowName) return;
      const state = floorWindows.has(windowName)
        ? "floor"
        : intensities.get(windowName) > 0
          ? "enters"
          : "off";
      element.dataset.sunState = state;
      const stateLabel = state === "floor"
        ? "Direct sun reaches the floor"
        : state === "enters"
          ? "Sun enters but misses the floor"
          : "No direct sun at this time";
      element.setAttribute("aria-label", `Select ${friendlyName} in the room editor. ${stateLabel}.`);
    });
  }

  updateSunlightSelection() {
    const selectedName = this.selectedWindowName;
    let selectedPatchCount = 0;
    let mutedPatchCount = 0;
    this.sunlightGroup.children.forEach((group) => {
      const selected = Boolean(selectedName && group.userData.windowName === selectedName);
      if (group.userData.kind === "sunlight-patch-group") {
        if (selected) selectedPatchCount += 1;
        else mutedPatchCount += 1;
      }
      group.traverse((object) => {
        if (!object.material || object.userData.baseOpacity === undefined) return;
        const kind = object.userData.kind;
        if (kind === "sunlight-patch") {
          object.material.opacity = object.userData.baseOpacity * (selected ? 1.06 : 0.62);
        } else if (kind === "sunlight-volume") {
          object.material.opacity = object.userData.baseOpacity * (selected ? 1.15 : 0.5);
        } else {
          object.material.opacity = selected ? Math.min(1, object.userData.baseOpacity * 1.15) : object.userData.baseOpacity * 0.48;
        }
        if (kind === "sunlight-patch-edge" || kind === "sunlight-ray") {
          object.material.color.setHex(selected ? COLORS.selectedWindowFrame : COLORS.sunlightEdge);
        }
      });
    });
    this.container.dataset.selectedSunlightWindow = selectedName || "";
    this.container.dataset.selectedSunlightPatchCount = String(selectedPatchCount);
    this.container.dataset.mutedSunlightPatchCount = String(mutedPatchCount);
  }

  addCompassLegend(facingLabel) {
    const legend = document.createElement("div");
    legend.className = "room3d-compass-legend";
    legend.setAttribute("aria-label", `Room front faces ${facingLabel}. Blue arrow is true north; orange arrow is the room front.`);

    const north = document.createElement("span");
    north.className = "room3d-compass-key room3d-compass-key-north";
    north.textContent = "N · true north";
    const front = document.createElement("span");
    front.className = "room3d-compass-key room3d-compass-key-front";
    front.textContent = `Front · ${facingLabel}`;
    legend.append(north, front);
    this.labelLayer.append(legend);
  }

  clearLabels() {
    this.labelElements.forEach(({ element }) => element.remove());
    this.labelElements.clear();
    this.labelLayer.replaceChildren();
  }

  updateLabels() {
    if (this.destroyed || !this.payload) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const candidates = [];
    this.labelElements.forEach(({ element, anchor, occlusionAnchor, wall, windowName }) => {
      const visual = this.windowVisuals.get(windowName);
      const viewDirection = occlusionAnchor.clone().sub(this.camera.position).normalize();
      const wallNormal = wallDefinition(wall, this.payload.room, 0).normal;
      const projected = anchor.clone().project(this.camera);
      const facesCamera = this.activeCameraPreset === "top" || Math.abs(viewDirection.dot(wallNormal)) > 0.3;
      const visible = Boolean(
        visual
        && objectIsVisible(visual.group, this.scene)
        && facesCamera
        && projected.x > -1.08
        && projected.x < 1.08
        && projected.y > -1.08
        && projected.y < 1.08
        && projected.z > -1
        && projected.z < 1
        && (this.activeCameraPreset === "top" || !this.isLabelOccluded(occlusionAnchor)),
      );
      element.hidden = !visible;
      if (!visible) return;
      candidates.push({
        element,
        selected: windowName === this.selectedWindowName,
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
      });
    });

    const placed = [];
    const containerRect = this.container.getBoundingClientRect();
    const compass = this.labelLayer.querySelector(".room3d-compass-legend")?.getBoundingClientRect();
    if (compass) {
      placed.push({
        left: compass.left - containerRect.left,
        right: compass.right - containerRect.left,
        top: compass.top - containerRect.top,
        bottom: compass.bottom - containerRect.top,
      });
    }
    candidates.sort((left, right) => Number(right.selected) - Number(left.selected));
    candidates.forEach(({ element, selected, x, y }) => {
      const halfWidth = element.offsetWidth / 2;
      const halfHeight = element.offsetHeight / 2;
      const clampedX = THREE.MathUtils.clamp(x, halfWidth + 8, width - halfWidth - 8);
      const labelStep = Math.max(element.offsetHeight + 10, 40);
      const offsets = [0, -labelStep, labelStep, -labelStep * 2, labelStep * 2];
      let position = null;
      for (const offset of offsets) {
        const clampedY = THREE.MathUtils.clamp(y + offset, halfHeight + 8, height - halfHeight - 8);
        const rect = {
          left: clampedX - halfWidth - 4,
          right: clampedX + halfWidth + 4,
          top: clampedY - halfHeight - 4,
          bottom: clampedY + halfHeight + 4,
        };
        const overlaps = placed.some((item) => (
          rect.left < item.right
          && rect.right > item.left
          && rect.top < item.bottom
          && rect.bottom > item.top
        ));
        if (!overlaps) {
          position = { x: clampedX, y: clampedY, rect };
          break;
        }
      }
      if (!position && !selected) {
        element.hidden = true;
        return;
      }
      position ||= {
        x: clampedX,
        y: THREE.MathUtils.clamp(y, halfHeight + 8, height - halfHeight - 8),
        rect: null,
      };
      element.style.transform = `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`;
      if (position.rect) placed.push(position.rect);
    });
  }

  isLabelOccluded(anchor) {
    const direction = anchor.clone().sub(this.camera.position);
    const distance = direction.length();
    if (distance <= 0.001) return false;
    this.labelRaycaster.set(this.camera.position, direction.normalize());
    const occluders = [
      ...this.wallGroup.children,
      ...this.roofGroup.children,
      ...this.internalWallGroup.children,
      ...this.externalObstructionGroup.children,
    ];
    return this.labelRaycaster.intersectObjects(occluders, true).some((hit) => (
      hit.object.isMesh
      && objectIsVisible(hit.object, this.scene)
      && hit.distance < distance - 0.08
    ));
  }

  selectWindow(name, notify) {
    if (!name || !this.windowVisuals.has(name)) return;
    this.setSelectedWindow(name);
    if (notify) this.onWindowSelect?.(name);
  }

  setSelectedWindow(name) {
    if (!name || !this.windowVisuals.has(name)) return;
    this.selectedWindowName = name;
    this.windowVisuals.forEach((visual, windowName) => {
      const selected = windowName === name;
      visual.glassMaterial.color.setHex(COLORS.window);
      visual.glassMaterial.emissive.setHex(selected ? 0x3d2769 : 0x123442);
      visual.glassMaterial.emissiveIntensity = selected ? 0.24 : 0.12;
      visual.glassMaterial.opacity = selected ? 0.46 : 0.36;
      visual.frameMaterial.color.setHex(selected ? COLORS.selectedWindowFrame : 0xffffff);
      visual.frameMaterial.opacity = selected ? 1 : 0.78;
      const label = this.labelElements.get(`window:${windowName}`)?.element;
      label?.classList.toggle("is-selected", selected);
      label?.setAttribute("aria-pressed", String(selected));
    });
    this.container.dataset.selectedWindow = name;
    this.updateSunlightSelection();
    this.updateCameraAwareWalls();
    this.needsRender = true;
    this.updateLabels();
  }

  eventPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  furnitureHit(event) {
    this.raycaster.setFromCamera(this.eventPointer(event), this.camera);
    return this.raycaster.intersectObjects(this.furnitureGroup.children, true)
      .find((entry) => entry.object.userData.furnitureId && objectIsVisible(entry.object, this.scene));
  }

  floorPoint(event) {
    this.raycaster.setFromCamera(this.eventPointer(event), this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point) ? point : null;
  }

  handlePointerDown(event) {
    this.pointerStart = { x: event.clientX, y: event.clientY };
    if (!this.arrangeFurniture || event.button !== 0) return;
    const hit = this.furnitureHit(event);
    if (!hit) return;
    const id = hit.object.userData.furnitureId;
    const root = this.furnitureVisuals.get(id);
    const floorPoint = this.floorPoint(event);
    if (!root || !floorPoint) return;
    this.setSelectedFurniture(id, true);
    this.furnitureDrag = {
      id,
      pointerId: event.pointerId,
      offset: root.position.clone().sub(floorPoint),
      moved: false,
      controlsWereEnabled: this.controls.enabled,
    };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.container.dataset.draggingFurniture = "true";
    this.onFurnitureChange?.(this.furnitureItems.map((item) => ({ ...item })), { phase: "start", reason: "move", id });
    event.preventDefault();
  }

  handlePointerMove(event) {
    if (this.furnitureDrag) {
      const floorPoint = this.floorPoint(event);
      if (!floorPoint) return;
      const drag = this.furnitureDrag;
      const root = this.furnitureVisuals.get(drag.id);
      const index = this.furnitureItems.findIndex((item) => item.id === drag.id);
      if (!root || index < 0) return;
      const target = floorPoint.add(drag.offset);
      const item = clampFurnitureItem({
        ...this.furnitureItems[index],
        x: target.x + this.payload.room.width / 2,
        y: this.payload.room.depth / 2 - target.z,
      }, this.payload.room);
      this.furnitureItems[index] = item;
      root.position.copy(appPointToThree([item.x, item.y, 0], this.payload.room));
      this.furnitureSelectionGroup.children[0]?.update();
      this.needsRender = true;
      drag.moved = true;
      this.container.dataset.furnitureItems = JSON.stringify(this.furnitureItems);
      event.preventDefault();
      return;
    }
    if (!this.pointerStart || event.buttons === 0) return;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 6) {
      this.setActiveCameraPreset("custom");
    }
  }

  handlePointerUp(event) {
    if (!this.furnitureDrag) return;
    const drag = this.furnitureDrag;
    this.furnitureDrag = null;
    this.controls.enabled = this.primaryPointerIsCoarse
      ? this.container.classList.contains("is-touch-interacting")
      : drag.controlsWereEnabled;
    this.renderer.domElement.releasePointerCapture?.(drag.pointerId);
    this.container.dataset.draggingFurniture = "false";
    this.justDraggedFurniture = drag.moved;
    if (drag.moved) {
      this.onFurnitureChange?.(this.furnitureItems.map((item) => ({ ...item })), { phase: "commit", reason: "move", id: drag.id });
    }
    event.preventDefault();
  }

  mutateSelectedFurniture(changes, reason) {
    const index = this.furnitureItems.findIndex((item) => item.id === this.selectedFurnitureId);
    if (index < 0) return;
    const next = this.furnitureItems.map((item) => ({ ...item }));
    if (changes === null) {
      next.splice(index, 1);
    } else {
      next[index] = clampFurnitureItem({ ...next[index], ...changes }, this.payload.room);
    }
    this.onFurnitureChange?.(next, { phase: "commit", reason, id: this.selectedFurnitureId });
  }

  handleCanvasClick(event) {
    if (this.justDraggedFurniture) {
      this.justDraggedFurniture = false;
      this.pointerStart = null;
      return;
    }
    const pointerStart = this.pointerStart;
    this.pointerStart = null;
    if (!pointerStart) return;
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) return;
    if (this.arrangeFurniture) {
      const furnitureHit = this.furnitureHit(event);
      this.setSelectedFurniture(furnitureHit?.object.userData.furnitureId || null, true);
      return;
    }
    this.raycaster.setFromCamera(this.eventPointer(event), this.camera);
    const hit = this.raycaster.intersectObjects([
      ...this.windowGroup.children,
      ...this.sunlightGroup.children,
    ], true)
      .find((entry) => entry.object.userData.windowName && objectIsVisible(entry.object, this.scene));
    if (hit) this.selectWindow(hit.object.userData.windowName, true);
  }

  setActiveCameraPreset(preset) {
    this.activeCameraPreset = preset;
    this.container.dataset.cameraPreset = preset;
    this.cameraButtons.forEach((button) => {
      const isActive = button.dataset.room3dCameraPreset === preset;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  setCameraPreset(preset) {
    if (this.destroyed || !this.payload) return;
    const room = this.payload.room;
    const scale = Math.max(room.width, room.depth, room.height, 1);
    const dampingWasEnabled = this.controls.enableDamping;
    this.controls.enableDamping = false;
    // Flush and clear any pending orbit/pan momentum before placing an exact preset.
    this.controls.update();
    this.camera.up.set(0, 1, 0);
    if (preset === "top") {
      const distance = scale * 2.2;
      this.controls.target.set(0, room.height * 0.2, 0);
      // A tiny southern offset keeps OrbitControls stable while screen-up remains north (-Z).
      this.camera.position.set(0, this.controls.target.y + distance, distance * 0.0005);
    } else if (preset === "front") {
      const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const verticalDistance = room.height / (2 * halfFovTangent);
      const horizontalDistance = room.width / (2 * halfFovTangent * Math.max(this.camera.aspect, 0.1));
      const distance = Math.max(verticalDistance, horizontalDistance) * 1.18;
      this.controls.target.set(0, room.height / 2, -room.depth / 2);
      this.camera.position.set(0, room.height / 2, -room.depth / 2 - distance);
    } else {
      preset = "perspective";
      this.controls.target.set(0, room.height * 0.42, 0);
      // Start opposite the default north/east windows so their real wall openings are visible.
      this.camera.position.set(-scale * 1.18, scale * 0.92, scale * 1.28);
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.controls.enableDamping = dampingWasEnabled;
    this.setActiveCameraPreset(preset);
    this.updateCameraAwareWalls();
    this.updateLabels();
    this.updateDebugState();
  }

  frameScene() {
    this.setCameraPreset("perspective");
  }

  toggleWalls() {
    if (this.destroyed) return;
    this.wallsVisible = !this.wallsVisible;
    if (this.wallsButton) {
      this.wallsButton.setAttribute("aria-pressed", String(this.wallsVisible));
      this.wallsButton.textContent = this.wallsVisible ? "Auto-hide walls" : "Walls hidden";
    }
    this.container.dataset.wallsVisible = String(this.wallsVisible);
    this.updateCameraAwareWalls();
    this.needsRender = true;
  }

  toggleRoof() {
    if (this.destroyed) return;
    this.roofVisible = !this.roofVisible;
    this.roofGroup.visible = this.roofVisible;
    if (this.roofButton) {
      this.roofButton.setAttribute("aria-pressed", String(this.roofVisible));
      this.roofButton.textContent = this.roofVisible ? "Hide roof" : "Show roof";
    }
    this.container.dataset.roofVisible = String(this.roofVisible);
    this.needsRender = true;
    this.updateLabels();
  }

  toggleContext() {
    if (this.destroyed) return;
    if (this.arrangeFurniture && this.contextVisible) {
      this.setStatus("Finish arranging furniture before hiding context.");
      return;
    }
    this.contextVisible = !this.contextVisible;
    if (this.contextButton) {
      this.contextButton.setAttribute("aria-pressed", String(this.contextVisible));
      this.contextButton.textContent = this.contextVisible ? "Scale objects on" : "Scale objects off";
    }
    this.container.dataset.contextVisible = String(this.contextVisible);
    this.applyContextVisibility();
    this.needsRender = true;
    this.updateLabels();
  }

  applyContextVisibility() {
    this.furnitureGroup.visible = this.contextVisible;
    this.furnitureSelectionGroup.visible = this.contextVisible;
    this.floorGridGroup.visible = this.contextVisible;
    this.container.dataset.furnitureVisible = String(this.furnitureGroup.visible);
    this.container.dataset.floorGridVisible = String(this.floorGridGroup.visible);
    this.updateCameraAwareWalls();
  }

  setTouchInteraction(active) {
    if (!this.isTouchDevice || this.destroyed) return;
    const enabled = Boolean(active);
    this.controls.enabled = enabled || !this.primaryPointerIsCoarse;
    this.container.classList.toggle("is-touch-interacting", enabled);
    this.container.dataset.touchInteraction = enabled ? "active" : "scroll";
    this.touchToggle.setAttribute("aria-pressed", String(enabled));
    this.touchToggle.textContent = enabled ? "Done" : "Explore 3D";
    if (enabled) this.renderer.domElement.focus({ preventScroll: true });
  }

  updateCameraAwareWalls() {
    if (this.destroyed || !this.payload) return;
    const viewDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    const hidden = [];
    const visible = [];
    const wallVisibility = new Map();
    this.wallGroup.children.forEach((wall) => {
      const cameraFacesWall = viewDirection.dot(wall.userData.normal) > 0.2;
      const frontPresetKeepsWall = this.activeCameraPreset === "front" && wall.userData.wall === "north";
      const shouldAutoHide = cameraFacesWall && !frontPresetKeepsWall;
      wall.visible = this.wallsVisible && !shouldAutoHide;
      wallVisibility.set(wall.userData.wall, wall.visible);
      if (this.wallsVisible && shouldAutoHide) hidden.push(wall.userData.wall);
      if (wall.visible) visible.push(wall.userData.wall);
    });
    this.windowVisuals.forEach((visual) => {
      const wallIsVisible = Boolean(wallVisibility.get(visual.windowData.wall));
      visual.group.visible = !this.wallsVisible || wallIsVisible || visual.windowData.name === this.selectedWindowName;
    });
    this.doorGroup.children.forEach((door) => {
      door.visible = this.contextVisible && Boolean(wallVisibility.get(door.userData.wall));
    });
    hidden.sort();
    visible.sort();
    this.container.dataset.autoHiddenWalls = hidden.join(",");
    this.container.dataset.visibleWalls = visible.join(",");
    this.container.dataset.doorVisible = String(this.doorGroup.children.some((door) => door.visible));
  }

  constrainCamera() {
    if (this.destroyed || !this.payload) return;
    const room = this.payload.room;
    const previousTarget = this.controls.target.clone();
    this.controls.target.set(
      THREE.MathUtils.clamp(this.controls.target.x, -room.width * 0.75, room.width * 0.75),
      THREE.MathUtils.clamp(this.controls.target.y, 0, room.height * 1.25),
      THREE.MathUtils.clamp(this.controls.target.z, -room.depth * 0.75, room.depth * 0.75),
    );
    this.camera.position.add(this.controls.target.clone().sub(previousTarget));
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length();
    if (distance > 1e-8) {
      offset.setLength(THREE.MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance));
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.camera.lookAt(this.controls.target);
  }

  updateDebugState() {
    this.container.dataset.cameraPosition = this.camera.position.toArray().map((value) => value.toFixed(3)).join(",");
    this.container.dataset.cameraTarget = this.controls.target.toArray().map((value) => value.toFixed(3)).join(",");
    this.container.dataset.cameraUp = this.camera.up.toArray().map((value) => value.toFixed(3)).join(",");
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.container.dataset.furnitureScreenPositions = JSON.stringify(this.furnitureItems.map((item) => {
      const root = this.furnitureVisuals.get(item.id);
      const point = root
        ? new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).project(this.camera)
        : null;
      return {
        id: item.id,
        x: point ? Number(((point.x * 0.5 + 0.5) * width).toFixed(1)) : 0,
        y: point ? Number(((-point.y * 0.5 + 0.5) * height).toFixed(1)) : 0,
      };
    }));
    this.container.dataset.sunlightScreenPositions = JSON.stringify(
      this.sunlightGroup.children
        .filter((group) => group.userData.kind === "sunlight-patch-group")
        .map((group, index) => {
          const point = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()).project(this.camera);
          return {
            index,
            windowName: group.userData.windowName,
            x: Number(((point.x * 0.5 + 0.5) * width).toFixed(1)),
            y: Number(((-point.y * 0.5 + 0.5) * height).toFixed(1)),
          };
        }),
    );
  }

  handleKeyDown(event) {
    if (this.destroyed || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.arrangeFurniture && this.selectedFurnitureId) {
      const item = this.furnitureItems.find((entry) => entry.id === this.selectedFurnitureId);
      if (!item) return;
      const step = event.shiftKey ? 0.25 : 0.05;
      const changes = {};
      if (event.key === "ArrowLeft") changes.x = item.x - step;
      if (event.key === "ArrowRight") changes.x = item.x + step;
      if (event.key === "ArrowUp") changes.y = item.y + step;
      if (event.key === "ArrowDown") changes.y = item.y - step;
      if (event.key.toLowerCase() === "q") changes.rotation = item.rotation - 15;
      if (event.key.toLowerCase() === "e") changes.rotation = item.rotation + 15;
      const shouldDelete = event.key === "Delete" || event.key === "Backspace";
      if (Object.keys(changes).length || shouldDelete) {
        event.preventDefault();
        this.mutateSelectedFurniture(shouldDelete ? null : changes, shouldDelete ? "delete" : "keyboard");
        return;
      }
    }
    const isArrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
    const isZoom = ["+", "=", "-", "_"].includes(event.key);
    if (!isArrow && !isZoom) return;
    event.preventDefault();
    this.setActiveCameraPreset("custom");

    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = Math.max(offset.length(), 0.1);
    if (event.shiftKey && isArrow) {
      this.camera.updateMatrix();
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1).normalize();
      const direction = new THREE.Vector3();
      const panStep = distance * 0.055;
      if (event.key === "ArrowLeft") direction.addScaledVector(right, -panStep);
      if (event.key === "ArrowRight") direction.addScaledVector(right, panStep);
      if (event.key === "ArrowUp") direction.addScaledVector(up, panStep);
      if (event.key === "ArrowDown") direction.addScaledVector(up, -panStep);
      this.camera.position.add(direction);
      this.controls.target.add(direction);
    } else if (isArrow) {
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const orbitStep = Math.PI / 36;
      if (event.key === "ArrowLeft") spherical.theta -= orbitStep;
      if (event.key === "ArrowRight") spherical.theta += orbitStep;
      if (event.key === "ArrowUp") spherical.phi -= orbitStep;
      if (event.key === "ArrowDown") spherical.phi += orbitStep;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, this.controls.minPolarAngle, this.controls.maxPolarAngle);
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    } else {
      const zoomFactor = event.key === "+" || event.key === "=" ? 0.9 : 1.1;
      const nextDistance = THREE.MathUtils.clamp(
        distance * zoomFactor,
        this.controls.minDistance,
        this.controls.maxDistance,
      );
      this.camera.position.copy(this.controls.target).add(offset.setLength(nextDistance));
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateCameraAwareWalls();
    this.updateLabels();
    this.updateDebugState();
  }

  setActive(active) {
    if (this.destroyed) return;
    this.active = Boolean(active);
    if (!this.active && this.isTouchDevice) this.setTouchInteraction(false);
    this.applyAnimationState();
    if (this.active) {
      this.resize();
      this.updateLabels();
    }
  }

  applyAnimationState() {
    if (this.destroyed) return;
    const shouldRender = this.active && this.inViewport && document.visibilityState !== "hidden";
    this.renderer.setAnimationLoop(shouldRender ? () => {
      const controlsChanged = this.controls.update();
      if (!controlsChanged && !this.needsRender) return;
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.updateDebugState();
      this.needsRender = false;
    } : null);
    this.container.dataset.rendering = String(shouldRender);
  }

  destroy() {
    if (this.destroyed) return;
    this.active = false;
    this.renderer.setAnimationLoop(null);
    this.container.dataset.rendering = "false";
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.cameraButtons.forEach((button) => button.removeEventListener("click", this.onCameraPreset));
    this.wallsButton?.removeEventListener("click", this.onToggleWalls);
    this.roofButton?.removeEventListener("click", this.onToggleRoof);
    this.contextButton?.removeEventListener("click", this.onToggleContext);
    this.touchToggle.removeEventListener("click", this.onToggleTouchInteraction);
    this.controls.removeEventListener("change", this.onControlsChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.onPointerUp);
    this.renderer.domElement.removeEventListener("wheel", this.onWheel);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.clearLabels();
    disposeObject(this.contentGroup);
    this.controls.dispose();
    this.renderer.dispose();
    this.destroyed = true;
    this.container.dataset.viewerDestroyed = "true";
  }
}

export function createRoom3DViewer(options) {
  return new Room3DViewer(options);
}
