import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  floor: 0xf8f1e5,
  wall: 0xe7ddd0,
  wallEdge: 0x7d898d,
  window: 0x2b627a,
  sunlight: 0xf0a24d,
  sunlightEdge: 0xc86530,
  north: 0x2b627a,
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
    if (object.geometry) {
      object.geometry.dispose();
    }
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

function makeWall(width, height, depth, position) {
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.wall,
    transparent: true,
    opacity: 0.38,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.copy(position);
  mesh.renderOrder = 1;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true, opacity: 0.42 }),
  );
  edges.position.copy(position);
  edges.renderOrder = 2;
  const group = new THREE.Group();
  group.add(mesh, edges);
  return group;
}

function makeWindow(windowData, room, index) {
  const center = appPointToThree(windowData.center_xyz, room);
  const thickness = Math.max(Math.min(room.width, room.depth) * 0.018, 0.035);
  const isFrontBack = windowData.wall === "north" || windowData.wall === "south";
  const geometry = isFrontBack
    ? new THREE.BoxGeometry(windowData.width, windowData.height, thickness)
    : new THREE.BoxGeometry(thickness, windowData.height, windowData.width);
  const material = new THREE.MeshStandardMaterial({
    color: index === 0 ? COLORS.sunlightEdge : COLORS.window,
    emissive: index === 0 ? 0x5b210c : 0x123442,
    emissiveIntensity: 0.16,
    transparent: true,
    opacity: 0.82,
    roughness: 0.3,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.userData = { kind: "window", name: windowData.name, wall: windowData.wall };
  mesh.renderOrder = 4;

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  frame.position.copy(center);
  frame.renderOrder = 5;

  const group = new THREE.Group();
  group.add(mesh, frame);
  return group;
}

function makePatch(patch, room) {
  const shape = new THREE.Shape();
  patch.polygon_xy.forEach((point, index) => {
    const x = Number(point[0]) - room.width / 2;
    const z = Number(point[1]) - room.depth / 2;
    if (index === 0) {
      shape.moveTo(x, z);
    } else {
      shape.lineTo(x, z);
    }
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: COLORS.sunlight,
    transparent: true,
    opacity: Math.max(0.3, Math.min(0.72, Number(patch.intensity) || 0.35)),
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.018;
  mesh.renderOrder = 3;
  mesh.userData = { kind: "sunlight-patch", windowName: patch.window_name };
  return mesh;
}

function makeBeam(windowData, patch, room) {
  const source = appPointToThree(windowData.center_xyz, room);
  const centroid = patch.polygon_xy.reduce(
    (total, point) => [total[0] + Number(point[0]), total[1] + Number(point[1])],
    [0, 0],
  ).map((value) => value / patch.polygon_xy.length);
  const destination = new THREE.Vector3(
    centroid[0] - room.width / 2,
    0.035,
    centroid[1] - room.depth / 2,
  );
  const curve = new THREE.LineCurve3(source, destination);
  const radius = Math.max(Math.min(room.width, room.depth) * 0.007, 0.012);
  const geometry = new THREE.TubeGeometry(curve, 1, radius, 6, false);
  const material = new THREE.MeshBasicMaterial({
    color: COLORS.sunlightEdge,
    transparent: true,
    opacity: Math.max(0.25, Math.min(0.72, Number(patch.intensity) || 0.35)),
    depthWrite: false,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.renderOrder = 3;
  beam.userData = { kind: "sunlight-beam", windowName: patch.window_name };
  return beam;
}

class Room3DViewer {
  constructor({ container, statusElement, resetButton, wallsButton }) {
    if (window.__SUNLIGHT_FORCE_WEBGL_FAILURE__) {
      throw new Error("WebGL was disabled for this session.");
    }
    this.container = container;
    this.statusElement = statusElement;
    this.resetButton = resetButton;
    this.wallsButton = wallsButton;
    this.payload = null;
    this.active = false;
    this.destroyed = false;
    this.hasFramedScene = false;
    this.wallsVisible = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3eadc);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Orbitable 3D room model");
    this.renderer.domElement.setAttribute("aria-describedby", "room3d-keyboard-help");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.showFallback("The 3D renderer stopped. The 2D views are still available.");
    };
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("keydown", this.onKeyDown);
    container.replaceChildren(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2.02;
    this.controls.addEventListener("change", () => this.updateDebugState());

    this.contentGroup = new THREE.Group();
    this.floorGroup = new THREE.Group();
    this.wallGroup = new THREE.Group();
    this.windowGroup = new THREE.Group();
    this.sunlightGroup = new THREE.Group();
    this.contentGroup.add(this.floorGroup, this.wallGroup, this.windowGroup, this.sunlightGroup);
    this.scene.add(this.contentGroup);
    this.scene.add(new THREE.HemisphereLight(0xfffbf2, 0x64727a, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
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
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }
  }

  showFallback(message) {
    this.destroy();
    this.container.dataset.viewerState = "fallback";
    this.container.replaceChildren();
    const fallbackMessage = document.createElement("div");
    fallbackMessage.className = "room3d-fallback";
    fallbackMessage.textContent = message;
    this.container.append(fallbackMessage);
    this.setStatus(message);
  }

  resize() {
    if (this.destroyed) {
      return;
    }
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  update(payload) {
    if (this.destroyed || !payload?.room || !Array.isArray(payload.windows)) {
      return;
    }
    this.payload = payload;
    const room = payload.room;
    replaceGroupContents(this.floorGroup);
    replaceGroupContents(this.wallGroup);
    replaceGroupContents(this.windowGroup);
    replaceGroupContents(this.sunlightGroup);

    const floorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.94 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(room.width, 0.04, room.depth), floorMaterial);
    floor.position.y = -0.025;
    this.floorGroup.add(floor);

    const thickness = Math.max(Math.min(room.width, room.depth) * 0.018, 0.035);
    this.wallGroup.add(
      makeWall(room.width, room.height, thickness, new THREE.Vector3(0, room.height / 2, room.depth / 2)),
      makeWall(room.width, room.height, thickness, new THREE.Vector3(0, room.height / 2, -room.depth / 2)),
      makeWall(thickness, room.height, room.depth, new THREE.Vector3(room.width / 2, room.height / 2, 0)),
      makeWall(thickness, room.height, room.depth, new THREE.Vector3(-room.width / 2, room.height / 2, 0)),
    );
    this.wallGroup.visible = this.wallsVisible;

    payload.windows.forEach((windowData, index) => {
      this.windowGroup.add(makeWindow(windowData, room, index));
    });

    const windowsByName = new Map(payload.windows.map((windowData) => [windowData.name, windowData]));
    payload.snapshot.patches.forEach((patch) => {
      this.sunlightGroup.add(makePatch(patch, room));
      const windowData = windowsByName.get(patch.window_name);
      if (windowData && patch.polygon_xy.length) {
        this.sunlightGroup.add(makeBeam(windowData, patch, room));
      }
    });

    const north = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-room.width / 2 + 0.3, 0.04, -room.depth / 2 + 0.3),
      Math.min(room.depth * 0.18, 0.8),
      COLORS.north,
      0.18,
      0.1,
    );
    north.userData = { kind: "room-front-direction", facing: payload.window_facing_label };
    this.sunlightGroup.add(north);

    const scale = Math.max(room.width, room.depth, room.height, 1);
    this.camera.near = Math.max(scale / 500, 0.01);
    this.camera.far = scale * 25;
    this.camera.updateProjectionMatrix();
    if (!this.hasFramedScene) {
      this.frameScene();
      this.hasFramedScene = true;
    }
    this.container.dataset.windowCount = String(payload.windows.length);
    this.container.dataset.patchCount = String(payload.snapshot.patches.length);
    this.container.dataset.selectedMoment = payload.selected_moment;
    this.container.dataset.roomSize = `${room.width},${room.depth},${room.height}`;
    this.container.dataset.windowGeometry = JSON.stringify(payload.windows.map((windowData) => ({
      name: windowData.name,
      wall: windowData.wall,
      width: windowData.width,
      height: windowData.height,
      center: windowData.center_xyz,
    })));
    this.setStatus(
      `${payload.windows.length} window${payload.windows.length === 1 ? "" : "s"} · ${payload.snapshot.patches.length} floor patch${payload.snapshot.patches.length === 1 ? "" : "es"} · front wall ${payload.window_facing_label}.`,
    );
    this.updateDebugState();
  }

  frameScene() {
    if (this.destroyed || !this.payload) {
      return;
    }
    const room = this.payload.room;
    const scale = Math.max(room.width, room.depth, room.height, 1);
    const dampingWasEnabled = this.controls.enableDamping;
    // Flush any momentum left by an orbit gesture before applying the exact reset pose.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, room.height * 0.42, 0);
    this.camera.position.set(scale * 1.18, scale * 0.92, scale * 1.28);
    this.controls.update();
    this.controls.saveState();
    this.controls.enableDamping = dampingWasEnabled;
    this.updateDebugState();
  }

  toggleWalls() {
    if (this.destroyed) {
      return;
    }
    this.wallsVisible = !this.wallsVisible;
    this.wallGroup.visible = this.wallsVisible;
    if (this.wallsButton) {
      this.wallsButton.setAttribute("aria-pressed", String(this.wallsVisible));
      this.wallsButton.textContent = this.wallsVisible ? "Walls on" : "Walls off";
    }
    this.container.dataset.wallsVisible = String(this.wallsVisible);
  }

  updateDebugState() {
    this.container.dataset.cameraPosition = this.camera.position.toArray().map((value) => value.toFixed(3)).join(",");
    this.container.dataset.cameraTarget = this.controls.target.toArray().map((value) => value.toFixed(3)).join(",");
  }

  handleKeyDown(event) {
    if (this.destroyed || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const isArrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
    const isZoom = ["+", "=", "-", "_"].includes(event.key);
    if (!isArrow && !isZoom) {
      return;
    }
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
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi,
        this.controls.minPolarAngle,
        this.controls.maxPolarAngle,
      );
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    } else {
      const zoomFactor = event.key === "+" || event.key === "=" ? 0.9 : 1.1;
      this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(zoomFactor));
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateDebugState();
  }

  setActive(active) {
    if (this.destroyed) {
      return;
    }
    this.active = Boolean(active);
    this.applyAnimationState();
    if (this.active) {
      this.resize();
    }
  }

  applyAnimationState() {
    if (this.destroyed) {
      return;
    }
    const shouldRender = this.active && document.visibilityState !== "hidden";
    this.renderer.setAnimationLoop(shouldRender ? () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateDebugState();
    } : null);
    this.container.dataset.rendering = String(shouldRender);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.active = false;
    this.renderer.setAnimationLoop(null);
    this.container.dataset.rendering = "false";
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.resetButton?.removeEventListener("click", this.onReset);
    this.wallsButton?.removeEventListener("click", this.onToggleWalls);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("keydown", this.onKeyDown);
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
