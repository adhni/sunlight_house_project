import assert from "node:assert/strict";
import { test } from "node:test";
import { parallelBeamSegments, sunlightAppearance } from "../static/src/sunlight3d.mjs";

const cases = [
  { wall: "north", center: [2, 5, 1.5], sun: [0.2, 1, 1], polygon: [[0.9, 4.5], [2.9, 4.5], [2.5, 2.5], [0.5, 2.5]] },
  { wall: "south", center: [2, 0, 1.5], sun: [0.2, -1, 1], polygon: [[0.9, 0.5], [2.9, 0.5], [2.5, 2.5], [0.5, 2.5]] },
  { wall: "east", center: [4, 2.5, 1.5], sun: [1, 0.2, 1], polygon: [[3.5, 1.4], [3.5, 3.4], [1.5, 3], [1.5, 1]] },
  { wall: "west", center: [0, 2.5, 1.5], sun: [-1, 0.2, 1], polygon: [[0.5, 1.4], [0.5, 3.4], [2.5, 3], [2.5, 1]] },
];

for (const { wall, center, sun, polygon } of cases) {
  test(`beam rays through the ${wall} window are parallel and span the aperture`, () => {
    const window = { wall, center_xyz: center, width: 2, height: 2 };
    const rays = parallelBeamSegments(window, { polygon_xy: polygon }, sun);
    assert.equal(rays.length, 4);
    const axis = ["east", "west"].includes(wall) ? 0 : 1;
    const heights = [];
    for (const { source, target } of rays) {
      assert.ok(Math.abs(source[axis] - center[axis]) < 1e-10);
      assert.equal(target[2], 0);
      const offset = source.map((value, index) => value - target[index]);
      // Every ray has the same direction, regardless of where it enters.
      for (let index = 0; index < 3; index += 1) {
        assert.ok(Math.abs(offset[index] * sun[2] - offset[2] * sun[index]) < 1e-10);
      }
      heights.push(source[2]);
    }
    assert.ok(Math.abs(Math.min(...heights) - 0.5) < 1e-10);
    assert.ok(Math.abs(Math.max(...heights) - 2.5) < 1e-10);
  });
}

test("clipped floor patches back-project to only their surviving aperture region", () => {
  const window = { wall: "north", center_xyz: [2, 5, 1.5], width: 2, height: 2 };
  const rays = parallelBeamSegments(window, { polygon_xy: [[1, 4.5], [3, 4.5], [3, 3], [1, 3]] }, [0, 1, 1]);
  assert.deepEqual(rays.map((ray) => ray.source), [[1, 5, 0.5], [3, 5, 0.5], [3, 5, 2], [1, 5, 2]]);
});

test("night, grazing, invalid, and back-facing sunlight cannot create beams", () => {
  const window = { wall: "north", center_xyz: [2, 5, 1.5], width: 2, height: 2 };
  const patch = { polygon_xy: [[1, 4.5], [3, 4.5], [3, 3], [1, 3]] };
  for (const vector of [[0, 1, -1], [0, 1, 0], [1, 0, 1], [0, -1, 1], [0, 0, 0], [NaN, 1, 1], undefined]) {
    assert.deepEqual(parallelBeamSegments(window, patch, vector), []);
  }
  assert.deepEqual(parallelBeamSegments(window, { polygon_xy: [[0, 0], [4, 0], [4, 1]] }, [0, 1, 1]), []);
});

test("night has no direct sun; twilight and daylight brighten continuously", () => {
  const atElevation = (degrees) => sunlightAppearance([0, Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)]);
  const night = atElevation(-30);
  const twilight = atElevation(-3);
  const horizon = atElevation(0);
  const sunrise = atElevation(1);
  const day = atElevation(45);
  assert.equal(night.sunIntensity, 0);
  assert.equal(twilight.sunIntensity, 0);
  assert.equal(horizon.sunIntensity, 0);
  assert.ok(night.ambientIntensity > 0);
  assert.ok(night.ambientIntensity < twilight.ambientIntensity);
  assert.ok(twilight.ambientIntensity < day.ambientIntensity);
  assert.ok(sunrise.sunIntensity > 0 && sunrise.sunIntensity < day.sunIntensity);
  assert.ok(sunrise.sunWarmth < day.sunWarmth);
  assert.deepEqual(sunlightAppearance([0, 10, 10]), sunlightAppearance([0, 1, 1]));
  assert.equal(sunlightAppearance(undefined).sunIntensity, 0);
});
