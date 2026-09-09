// Solar vectors use the app's room coordinates: X=width, Y=depth, Z=up.
export function normalizedSunVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) return null;
  const length = Math.hypot(...vector);
  return length > 1e-8 ? vector.map((value) => value / length) : null;
}

export function sunlightAppearance(vector) {
  const direction = normalizedSunVector(vector);
  const elevation = direction ? Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180 / Math.PI : -90;
  const smoothstep = (low, high, value) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  const daylight = smoothstep(-6, 12, elevation);
  return {
    direction,
    daylight,
    // Keep a little cool ambient light so the room can still be edited at night.
    ambientIntensity: 0.1 + daylight * 1.15,
    sunIntensity: 3.2 * smoothstep(0, 18, elevation),
    sunWarmth: smoothstep(0, 35, elevation),
  };
}

export function parallelBeamSegments(windowData, patch, vector) {
  const direction = normalizedSunVector(vector);
  const axis = ["east", "west"].includes(windowData.wall) ? 0 : 1;
  const outwardSign = ["north", "east"].includes(windowData.wall) ? 1 : -1;
  if (!direction || direction[2] <= 1e-8 || direction[axis] * outwardSign <= 1e-8) return [];
  if (!Array.isArray(patch.polygon_xy) || patch.polygon_xy.length < 3) return [];
  const spanAxis = 1 - axis;
  const center = windowData.center_xyz;
  const tolerance = 1e-5;
  const rays = patch.polygon_xy.map(([x, y]) => {
    const target = [x, y, 0];
    const distance = (center[axis] - target[axis]) / direction[axis];
    const source = target.map((value, index) => value + distance * direction[index]);
    if (!source.every(Number.isFinite) || distance < -tolerance
      || Math.abs(source[spanAxis] - center[spanAxis]) > windowData.width / 2 + tolerance
      || Math.abs(source[2] - center[2]) > windowData.height / 2 + tolerance) return null;
    return { source, target };
  });
  // Clipped floor polygons back-project to a corresponding part of the aperture.
  // Never connect an invalid endpoint to a guessed window centre.
  return rays.every(Boolean) ? rays : [];
}
