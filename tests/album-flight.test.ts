import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlbumFlight,
  flightTransform,
  photoTransform,
  PHOTO_MOTIONS,
  sampleAlbumFlight,
  sampleAlbumWorld,
  type AlbumFlightPose,
} from '../src/albumFlight';

const desktop = { width: 1200, height: 600 };
const mobile = { width: 320, height: 430 };

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} must be close to ${expected}`,
  );
}

test('All twelve reference motion presets remain exact and cycle deterministically', () => {
  const tuples = PHOTO_MOTIONS.map((m) => [
    m.x,
    m.y,
    m.z,
    m.phase,
    m.speed,
    m.orbitX,
    m.orbitY,
    m.dive,
    m.tilt,
    m.size,
  ]);
  assert.deepEqual(tuples, [
    [-0.34, -0.27, -310, 0.2, 0.24, 0.11, 0.09, 130, -13, 0.88],
    [0.08, -0.34, 120, 2.1, 0.19, 0.09, 0.12, 220, 9, 0.82],
    [0.37, -0.2, -120, 1.1, 0.31, 0.12, 0.08, 170, 17, 0.92],
    [-0.12, 0.02, 240, 3.4, 0.16, 0.08, 0.1, 250, -8, 0.78],
    [0.27, 0.06, -390, 4.1, 0.27, 0.14, 0.1, 120, 12, 0.92],
    [-0.39, 0.28, 80, 2.8, 0.22, 0.1, 0.13, 230, -18, 0.82],
    [0.02, 0.34, -210, 5.3, 0.34, 0.12, 0.08, 180, 6, 0.9],
    [0.39, 0.31, 180, 0.8, 0.18, 0.1, 0.12, 260, 14, 0.8],
    [-0.08, -0.46, -80, 4.7, 0.29, 0.13, 0.08, 190, -11, 0.84],
    [0.45, 0.02, -300, 3.1, 0.21, 0.08, 0.12, 140, 19, 0.88],
    [-0.44, -0.06, -40, 5.8, 0.26, 0.12, 0.11, 210, -16, 0.82],
    [0.12, 0.47, 260, 1.8, 0.17, 0.11, 0.1, 250, 10, 0.78],
  ]);
  assert.deepEqual(
    createAlbumFlight('photo-a', 0),
    createAlbumFlight('photo-a', 0),
  );
  assert.notDeepEqual(
    createAlbumFlight('photo-a', 0),
    createAlbumFlight('photo-b', 0),
  );
  assert.deepEqual(createAlbumFlight('photo-a', 12).motion, PHOTO_MOTIONS[0]);
});

test('Desktop XYZ, reference sway and perspective scale match the original formulas', () => {
  for (let index = 0; index < PHOTO_MOTIONS.length; index++) {
    const profile = createAlbumFlight(`photo-${index}`, index);
    const motion = PHOTO_MOTIONS[index];
    for (const seconds of [0, 1.25, 13, 41, 300]) {
      const pose = sampleAlbumFlight(profile, seconds, desktop, false);
      const phase = seconds * motion.speed + motion.phase;
      close(
        pose.x,
        (motion.x +
          Math.sin(phase) * motion.orbitX +
          Math.cos(phase * 0.53) * 0.035) *
          desktop.width,
      );
      close(
        pose.y,
        (motion.y +
          Math.cos(phase * 0.76) * motion.orbitY +
          Math.sin(phase * 0.41) * 0.03) *
          desktop.height,
      );
      close(pose.z, motion.z + Math.sin(phase * 0.72) * motion.dive);
      close(
        pose.scale,
        motion.size * Math.min(1.72, 1050 / Math.max(520, 1050 - pose.z)),
      );
      close(pose.rotateZ, motion.tilt + Math.sin(phase * 0.6) * 9);
      close(
        pose.rotateX,
        Math.sin(phase * 0.38) * 8 +
          (profile.spinAxis === 'x' ? profile.spinSpeed * seconds : 0),
      );
      close(
        pose.rotateY,
        Math.cos(phase * 0.47) * 12 +
          (profile.spinAxis === 'y' ? profile.spinSpeed * seconds : 0),
      );
    }
  }
});

test('Long-running desktop/mobile poses are finite and bounded by reference orbit amplitudes', () => {
  for (const [bounds, light] of [
    [desktop, false],
    [mobile, true],
    [{ width: 640, height: 500 }, true],
  ] as const) {
    for (let index = 0; index < 24; index++) {
      const profile = createAlbumFlight(`photo-${index}`, index);
      const motion = profile.motion;
      for (const seconds of [-10000, 0, 1 / 60, 15, 60, 3600, 86400, 1e9]) {
        const pose = sampleAlbumFlight(profile, seconds, bounds, light);
        assert.ok(Object.values(pose).every(Number.isFinite));
        assert.ok(
          Math.abs(pose.x) <=
            (Math.abs(motion.x) + motion.orbitX + 0.035) *
              bounds.width *
              (light ? 0.64 : 1) +
              1e-8,
        );
        assert.ok(
          Math.abs(pose.y) <=
            (Math.abs(motion.y) + motion.orbitY + 0.03) *
              bounds.height *
              (light ? 0.72 : 1) +
              1e-8,
        );
        assert.ok(
          pose.z >= (motion.z - motion.dive) * (light ? 0.52 : 1) - 1e-8,
        );
        assert.ok(
          pose.z <= (motion.z + motion.dive) * (light ? 0.52 : 1) + 1e-8,
        );
        assert.ok(pose.scale > 0 && pose.scale <= motion.size * 1.72 + 1e-8);
      }
    }
  }
  const safe = sampleAlbumFlight(
    createAlbumFlight('bad-input', 0),
    Infinity,
    { width: NaN, height: -100 },
    true,
  );
  assert.ok(Object.values(safe).every(Number.isFinite));
  assert.equal(Math.abs(safe.x), 0);
  assert.equal(Math.abs(safe.y), 0);
});

test('Independent preset phases produce changing XYZ paths, smooth direction reversals and no teleports', () => {
  const distinct = new Set<string>();
  for (let index = 0; index < 12; index++) {
    const profile = createAlbumFlight(`direction-${index}`, index);
    const samples = Array.from({ length: 2401 }, (_, tick) =>
      sampleAlbumFlight(profile, tick * 0.125, desktop, false),
    );
    distinct.add(JSON.stringify([samples[1].x, samples[1].y, samples[1].z]));
    for (const axis of ['x', 'y', 'z'] as const) {
      const values = samples.map((pose) => pose[axis]);
      assert.ok(Math.max(...values) - Math.min(...values) > 25);
      const differences = values
        .slice(1)
        .map((value, tick) => value - values[tick]);
      assert.ok(differences.some((delta) => delta > 0.01));
      assert.ok(differences.some((delta) => delta < -0.01));
      assert.ok(Math.max(...differences.map(Math.abs)) < 10);
    }
    const before = sampleAlbumFlight(profile, 71.9999, desktop, false);
    const after = sampleAlbumFlight(profile, 72.0001, desktop, false);
    for (const key of [
      'x',
      'y',
      'z',
      'rotateX',
      'rotateY',
      'rotateZ',
      'scale',
    ] as const) {
      assert.ok(
        Math.abs(after[key] - before[key]) < 0.03,
        `${key} must stay continuous`,
      );
    }
  }
  assert.equal(distinct.size, 12);
});

test('Entrance uses the original cubic ease from 1250px away without changing settled orbit position', () => {
  const profile = createAlbumFlight('entrance', 3);
  const settled = sampleAlbumFlight(profile, 1.2, desktop, false, 1);
  const start = sampleAlbumFlight(profile, 1.2, desktop, false, 0);
  const middle = sampleAlbumFlight(profile, 1.2, desktop, false, 0.5);
  close(start.z, settled.z - 1250);
  close(middle.z, settled.z - 1250 * Math.pow(1 - 0.5, 3));
  close(start.x, settled.x);
  close(start.y, settled.y);
  assert.ok(start.scale < middle.scale && middle.scale < settled.scale);
  assert.deepEqual(sampleAlbumFlight(profile, 1.2, desktop, false), settled);
  close(sampleAlbumFlight(profile, 1.2, desktop, false, -1).z, start.z);
  close(sampleAlbumFlight(profile, 1.2, desktop, false, 2).z, settled.z);
});

test('Full X/Y revolutions retain the original small yaw/pitch sway and alternate signed14–23deg/s spins', () => {
  const axes = new Set<string>();
  const signs = new Set<number>();
  for (let index = 0; index < 12; index++) {
    const profile = createAlbumFlight(`spin-${index}`, index);
    axes.add(profile.spinAxis);
    signs.add(Math.sign(profile.spinSpeed));
    assert.ok(
      Math.abs(profile.spinSpeed) >= 14 && Math.abs(profile.spinSpeed) <= 23,
    );
    const seconds = 360 / Math.abs(profile.spinSpeed);
    const initial = sampleAlbumFlight(profile, 0, desktop, false);
    const spun = sampleAlbumFlight(profile, seconds, desktop, false);
    const phase0 = profile.motion.phase;
    const phase1 = seconds * profile.motion.speed + phase0;
    if (profile.spinAxis === 'x')
      close(
        spun.rotateX -
          Math.sin(phase1 * 0.38) * 8 -
          (initial.rotateX - Math.sin(phase0 * 0.38) * 8),
        Math.sign(profile.spinSpeed) * 360,
      );
    else
      close(
        spun.rotateY -
          Math.cos(phase1 * 0.47) * 12 -
          (initial.rotateY - Math.cos(phase0 * 0.47) * 12),
        Math.sign(profile.spinSpeed) * 360,
      );
    assert.ok(Math.abs(spun.rotateZ - initial.rotateZ) <= 18 + 1e-8);
  }
  assert.deepEqual([...axes].sort(), ['x', 'y']);
  assert.deepEqual([...signs].sort(), [-1, 1]);
});

test('Light mode narrows the universe but retains real depth and perspective-dependent image sizes', () => {
  const profile = createAlbumFlight('mobile-depth', 3);
  const positions = Array.from({ length: 400 }, (_, second) =>
    sampleAlbumFlight(profile, second, mobile, true),
  );
  const depths = positions.map((pose) => pose.z);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 200);
  const at = 14;
  const full = sampleAlbumFlight(profile, at, mobile, false);
  const light = sampleAlbumFlight(profile, at, mobile, true);
  close(light.x, full.x * 0.64);
  close(light.y, full.y * 0.72);
  close(light.z, full.z * 0.52);
  assert.notEqual(light.scale, full.scale);
});

test('World auto rotation uses exactly0.000028radians/ms and leaves pitch for the clamped drag controller', () => {
  close(sampleAlbumWorld(0).rotateY, 0);
  close(sampleAlbumWorld(1).rotateY, (0.000028 * 1000 * 180) / Math.PI);
  close(sampleAlbumWorld((Math.PI * 2) / 0.028).rotateY, 360);
  for (const seconds of [0, 1, 36, 72, 1000, 1e9]) {
    const world = sampleAlbumWorld(seconds);
    assert.equal(world.rotateX, 0);
    assert.ok(Number.isFinite(world.rotateY));
  }
});

test('Transforms compose physical XYZ translation, full card rotations and reference perspective scale separately', () => {
  const pose: AlbumFlightPose = {
    x: 12.25,
    y: -30.5,
    z: 140,
    rotateX: 367,
    rotateY: -421,
    rotateZ: 8,
    scale: 1.25,
  };
  assert.equal(
    flightTransform(pose),
    'translate3d(12.250px, -30.500px, 140.000px)',
  );
  assert.equal(
    photoTransform(pose),
    'translate(-50%, -50%) rotateX(367.000deg) rotateY(-421.000deg) rotateZ(8.000deg) scale(1.250)',
  );
  assert.doesNotMatch(
    flightTransform(pose) + photoTransform(pose),
    /NaN|Infinity/,
  );
});
