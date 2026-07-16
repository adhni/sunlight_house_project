import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  floor: 0xf8f1e5,
  wall: 0xe7ddd0,
  wallEdge: 0x657378,
  window: 0x2b627a,
  selectedWindow: 0xd36c32,
  sunlight: 0xffbd55,
  sunlightEdge: 0xd85824,
  north: 0x2b627a,
  front: 0xd36c32,
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
  // Three.js coordinates: X=width, Y=height, Z=depth.
  return new THREE.Vector3(
    Number(point[0]) - room.width / 2,
    Number(point[2]),
    Number(point[1]) - room.depth / 2,
  );
}

function wallDefinition(name, room, thickness) {
  const definitions = {
    north: {
      name,
      length: room.width,
      normal: new THREE.Vector3(0, 0, 1),
      position: new THREE.Vector3(0, 0, room.depth / 2),
      spanAxis: "x",
    },
    south: {
      name,
      length: room.width,
      normal: new THREE.Vector3(0, 0, -1),
      position: new THREE.Vector3(0, 0, -room.depth / 2),
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
  panel.position[definition.spanAxis] = centeredSpan;
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
    opacity: 0.5,
    roughness: 0.18,
    metalness: 0.12,
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
    0.025,
    Number(point[1]) - room.depth / 2,
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
  });
  const fill = new THREE.Mesh(geometry, material);
  fill.position.y = 0.025;
  fill.renderOrder = 3;
  fill.userData = { kind: "sunlight-patch", windowName: patch.window_name };

  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: COLORS.sunlightEdge, transparent: true, opacity: 0.96 }),
  );
  edge.renderOrder = 4;
  edge.userData = { kind: "sunlight-patch-edge", windowName: patch.window_name };
  const group = new THREE.Group();
  group.add(fill, edge);
  return group;
}

function makeBeam(windowData, patch, room) {
  const source = appPointToThree(windowData.center_xyz, room);
  const floorPoints = patch.polygon_xy.map((point) => new THREE.Vector3(
    Number(point[0]) - room.width / 2,
    0.04,
    Number(point[1]) - room.depth / 2,
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
  fan.userData = { kind: "sunlight-volume", windowName: patch.window_name };

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
  ray.userData = { kind: "sunlight-ray", windowName: patch.window_name };
  const group = new THREE.Group();
  group.add(fan, ray);
  return group;
}

function compassVector(worldAzimuth, frontFacing) {
  const relative = THREE.MathUtils.degToRad((worldAzimuth - frontFacing + 360) % 360);
  return new THREE.Vector3(Math.sin(relative), 0, Math.cos(relative)).normalize();
}

function makeOrientation(room, facingLabel) {
  const group = new THREE.Group();
  const frontFacing = FACING_DEGREES[facingLabel] ?? 0;
  const origin = new THREE.Vector3(-room.width / 2 + 0.45, 0.065, -room.depth / 2 + 0.45);
  const length = Math.min(Math.max(Math.min(room.width, room.depth) * 0.2, 0.55), 1.1);
  const northDirection = compassVector(0, frontFacing);
  const frontDirection = new THREE.Vector3(0, 0, 1);
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

class Room3DViewer {
  constructor({ container, statusElement, resetButton, wallsButton, onWindowSelect, onUnavailable }) {
    if (window.__SUNLIGHT_FORCE_WEBGL_FAILURE__) {
      throw new Error("WebGL was disabled for this session.");
    }
    this.container = container;
    this.statusElement = statusElement;
    this.resetButton = resetButton;
    this.wallsButton = wallsButton;
    this.onWindowSelect = onWindowSelect;
    this.onUnavailable = onUnavailable;
    this.payload = null;
    this.active = false;
    this.destroyed = false;
    this.hasFramedScene = false;
    this.wallsVisible = true;
    this.selectedWindowName = null;
    this.windowVisuals = new Map();
    this.labelElements = new Map();
    this.sceneBuildCount = 0;
    this.sunlightUpdateCount = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointerStart = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3eadc);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Orbitable 3D room model. Click a window to select it.");
    this.renderer.domElement.setAttribute("aria-describedby", "room3d-keyboard-help");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.showFallback("The 3D renderer stopped. The 2D views are still available.");
    };
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onPointerDown = (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    };
    this.onCanvasClick = (event) => this.handleCanvasClick(event);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("click", this.onCanvasClick);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "room3d-label-layer";
    this.labelLayer.setAttribute("aria-label", "3D room labels");
    container.replaceChildren(this.renderer.domElement, this.labelLayer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2.02;
    this.onControlsChange = () => {
      this.updateDebugState();
      this.updateCameraAwareWalls();
      this.updateLabels();
    };
    this.controls.addEventListener("change", this.onControlsChange);

    this.contentGroup = new THREE.Group();
    this.floorGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.windowGroup = new THREE.Group();
    this.sunlightGroup = new THREE.Group();
    this.orientationGroup = new THREE.Group();
    this.contentGroup.add(
      this.floorGroup,
      this.wallGroup,
      this.windowGroup,
      this.sunlightGroup,
      this.orientationGroup,
    );
    this.scene.add(this.contentGroup);
    this.scene.add(new THREE.HemisphereLight(0xfffbf2, 0x64727a, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 9, 7);
    this.scene.add(keyLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.onVisibilityChange = () => this.applyAnimationState();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.onReset = () => this.frameScene();
    this.onToggleWalls = () => this.toggleWalls();
    resetButton?.addEventListener("click", this.onReset);
    wallsButton?.addEventListener("click", this.onToggleWalls);

    this.container.dataset.viewerState = "ready";
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
    this.updateLabels();
  }

  update(payload) {
    if (this.destroyed || !payload?.room || !Array.isArray(payload.windows)) return;
    this.payload = payload;
    this.sceneBuildCount += 1;
    const room = payload.room;
    replaceGroupContents(this.floorGroup);
    replaceGroupContents(this.wallGroup);
    replaceGroupContents(this.windowGroup);
    replaceGroupContents(this.sunlightGroup);
    replaceGroupContents(this.orientationGroup);
    this.clearLabels();
    this.windowVisuals.clear();

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(room.width, 0.04, room.depth),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.94 }),
    );
    floor.position.y = -0.025;
    this.floorGroup.add(floor);

    const thickness = Math.max(Math.min(room.width, room.depth) * 0.022, 0.045);
    ["north", "south", "east", "west"].forEach((wallName) => {
      const wallWindows = payload.windows.filter((windowData) => windowData.wall === wallName);
      this.wallGroup.add(makeWallWithOpenings(wallName, wallWindows, room, thickness));
    });

    payload.windows.forEach((windowData) => {
      const visual = makeWindow(windowData, room);
      this.windowGroup.add(visual.group);
      this.windowVisuals.set(windowData.name, { ...visual, windowData });
      this.addWindowLabel(windowData, visual.center);
    });

    this.updateSunlightFrame(payload.snapshot, payload.selected_moment, { updateStatus: false });

    const orientation = makeOrientation(room, payload.window_facing_label);
    this.orientationGroup.add(orientation);
    this.addCompassLegend(payload.window_facing_label);

    const scale = Math.max(room.width, room.depth, room.height, 1);
    this.camera.near = Math.max(scale / 500, 0.01);
    this.camera.far = scale * 25;
    this.camera.updateProjectionMatrix();
    if (!this.hasFramedScene) {
      this.frameScene();
      this.hasFramedScene = true;
    }
    const selectedExists = payload.windows.some((windowData) => windowData.name === this.selectedWindowName);
    this.setSelectedWindow(selectedExists ? this.selectedWindowName : payload.windows[0]?.name);
    this.updateCameraAwareWalls();
    this.updateLabels();

    const wallPanelCount = this.wallGroup.children.reduce(
      (count, wall) => count + wall.children.filter((child) => child.userData.kind === "wall-panel").length,
      0,
    );
    this.container.dataset.windowCount = String(payload.windows.length);
    this.container.dataset.openingCount = String(payload.windows.length);
    this.container.dataset.wallPanelCount = String(wallPanelCount);
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
    this.setStatus(
      `${payload.windows.length} window opening${payload.windows.length === 1 ? "" : "s"} · ${payload.snapshot.patches.length} floor patch${payload.snapshot.patches.length === 1 ? "" : "es"} · front ${payload.window_facing_label}.`,
    );
    this.updateDebugState();
  }

  updateSunlightFrame(snapshot, selectedMoment, { updateStatus = true } = {}) {
    if (this.destroyed || !this.payload || !snapshot?.patches) return;
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
    this.sunlightUpdateCount += 1;
    this.container.dataset.sunlightUpdateCount = String(this.sunlightUpdateCount);
    this.container.dataset.patchCount = String(snapshot.patches.length);
    if (selectedMoment) this.container.dataset.selectedMoment = selectedMoment;
    if (updateStatus) {
      this.setStatus(
        `${snapshot.patches.length} sunlight patch${snapshot.patches.length === 1 ? "" : "es"} at ${String(selectedMoment || "").slice(11, 16)}.`,
      );
    }
  }

  addWindowLabel(windowData, center) {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "room3d-window-label";
    label.textContent = displayWindowName(windowData.name);
    label.dataset.windowName = windowData.name;
    label.setAttribute("aria-label", `Select ${displayWindowName(windowData.name)} in the room editor`);
    label.addEventListener("click", () => this.selectWindow(windowData.name, true));
    this.labelLayer.append(label);
    this.labelElements.set(`window:${windowData.name}`, {
      element: label,
      anchor: center.clone().add(new THREE.Vector3(0, windowData.height / 2 + 0.22, 0)),
    });
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
    this.labelElements.forEach(({ element, anchor }) => {
      const projected = anchor.clone().project(this.camera);
      const visible = projected.z > -1 && projected.z < 1;
      element.hidden = !visible;
      if (!visible) return;
      element.style.transform = `translate(-50%, -50%) translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px)`;
    });
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
      visual.glassMaterial.color.setHex(selected ? COLORS.selectedWindow : COLORS.window);
      visual.glassMaterial.emissive.setHex(selected ? 0x61210e : 0x123442);
      visual.glassMaterial.emissiveIntensity = selected ? 0.36 : 0.12;
      visual.glassMaterial.opacity = selected ? 0.72 : 0.5;
      visual.frameMaterial.color.setHex(selected ? 0xffd29d : 0xffffff);
      visual.frameMaterial.opacity = selected ? 1 : 0.78;
      const label = this.labelElements.get(`window:${windowName}`)?.element;
      label?.classList.toggle("is-selected", selected);
      label?.setAttribute("aria-pressed", String(selected));
    });
    this.container.dataset.selectedWindow = name;
  }

  handleCanvasClick(event) {
    if (!this.pointerStart) return;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.windowGroup.children, true)
      .find((entry) => entry.object.userData.windowName);
    if (hit) this.selectWindow(hit.object.userData.windowName, true);
  }

  frameScene() {
    if (this.destroyed || !this.payload) return;
    const room = this.payload.room;
    const scale = Math.max(room.width, room.depth, room.height, 1);
    const dampingWasEnabled = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, room.height * 0.42, 0);
    // Start opposite the default north/east windows so their real wall openings are visible.
    this.camera.position.set(-scale * 1.18, scale * 0.92, -scale * 1.28);
    this.controls.update();
    this.controls.saveState();
    this.controls.enableDamping = dampingWasEnabled;
    this.updateCameraAwareWalls();
    this.updateLabels();
    this.updateDebugState();
  }

  toggleWalls() {
    if (this.destroyed) return;
    this.wallsVisible = !this.wallsVisible;
    if (this.wallsButton) {
      this.wallsButton.setAttribute("aria-pressed", String(this.wallsVisible));
      this.wallsButton.textContent = this.wallsVisible ? "Walls auto" : "Walls off";
    }
    this.container.dataset.wallsVisible = String(this.wallsVisible);
    this.updateCameraAwareWalls();
  }

  updateCameraAwareWalls() {
    if (this.destroyed || !this.payload) return;
    const viewDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    const hidden = [];
    this.wallGroup.children.forEach((wall) => {
      const cameraFacesWall = viewDirection.dot(wall.userData.normal) > 0.2;
      wall.visible = this.wallsVisible && !cameraFacesWall;
      if (this.wallsVisible && cameraFacesWall) hidden.push(wall.userData.wall);
    });
    hidden.sort();
    this.container.dataset.autoHiddenWalls = hidden.join(",");
  }

  updateDebugState() {
    this.container.dataset.cameraPosition = this.camera.position.toArray().map((value) => value.toFixed(3)).join(",");
    this.container.dataset.cameraTarget = this.controls.target.toArray().map((value) => value.toFixed(3)).join(",");
  }

  handleKeyDown(event) {
    if (this.destroyed || event.ctrlKey || event.metaKey || event.altKey) return;
    const isArrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
    const isZoom = ["+", "=", "-", "_"].includes(event.key);
    if (!isArrow && !isZoom) return;
    event.preventDefault();

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
      this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(zoomFactor));
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
    this.applyAnimationState();
    if (this.active) {
      this.resize();
      this.updateLabels();
    }
  }

  applyAnimationState() {
    if (this.destroyed) return;
    const shouldRender = this.active && document.visibilityState !== "hidden";
    this.renderer.setAnimationLoop(shouldRender ? () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.updateDebugState();
    } : null);
    this.container.dataset.rendering = String(shouldRender);
  }

  destroy() {
    if (this.destroyed) return;
    this.active = false;
    this.renderer.setAnimationLoop(null);
    this.container.dataset.rendering = "false";
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.resetButton?.removeEventListener("click", this.onReset);
    this.wallsButton?.removeEventListener("click", this.onToggleWalls);
    this.controls.removeEventListener("change", this.onControlsChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
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
