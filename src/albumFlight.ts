/** DOM-free motion port of the supplied Huệ photo-universe reference. */
export interface AlbumPhotoMotion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly phase: number;
  readonly speed: number;
  readonly orbitX: number;
  readonly orbitY: number;
  readonly dive: number;
  readonly tilt: number;
  readonly size: number;
}

/** Preserve the reference's twelve placements, depths, phases and orbit rates. */
export const PHOTO_MOTIONS: readonly AlbumPhotoMotion[] = [
  {
    x: -0.34,
    y: -0.27,
    z: -310,
    phase: 0.2,
    speed: 0.24,
    orbitX: 0.11,
    orbitY: 0.09,
    dive: 130,
    tilt: -13,
    size: 0.88,
  },
  {
    x: 0.08,
    y: -0.34,
    z: 120,
    phase: 2.1,
    speed: 0.19,
    orbitX: 0.09,
    orbitY: 0.12,
    dive: 220,
    tilt: 9,
    size: 0.82,
  },
  {
    x: 0.37,
    y: -0.2,
    z: -120,
    phase: 1.1,
    speed: 0.31,
    orbitX: 0.12,
    orbitY: 0.08,
    dive: 170,
    tilt: 17,
    size: 0.92,
  },
  {
    x: -0.12,
    y: 0.02,
    z: 240,
    phase: 3.4,
    speed: 0.16,
    orbitX: 0.08,
    orbitY: 0.1,
    dive: 250,
    tilt: -8,
    size: 0.78,
  },
  {
    x: 0.27,
    y: 0.06,
    z: -390,
    phase: 4.1,
    speed: 0.27,
    orbitX: 0.14,
    orbitY: 0.1,
    dive: 120,
    tilt: 12,
    size: 0.92,
  },
  {
    x: -0.39,
    y: 0.28,
    z: 80,
    phase: 2.8,
    speed: 0.22,
    orbitX: 0.1,
    orbitY: 0.13,
    dive: 230,
    tilt: -18,
    size: 0.82,
  },
  {
    x: 0.02,
    y: 0.34,
    z: -210,
    phase: 5.3,
    speed: 0.34,
    orbitX: 0.12,
    orbitY: 0.08,
    dive: 180,
    tilt: 6,
    size: 0.9,
  },
  {
    x: 0.39,
    y: 0.31,
    z: 180,
    phase: 0.8,
    speed: 0.18,
    orbitX: 0.1,
    orbitY: 0.12,
    dive: 260,
    tilt: 14,
    size: 0.8,
  },
  {
    x: -0.08,
    y: -0.46,
    z: -80,
    phase: 4.7,
    speed: 0.29,
    orbitX: 0.13,
    orbitY: 0.08,
    dive: 190,
    tilt: -11,
    size: 0.84,
  },
  {
    x: 0.45,
    y: 0.02,
    z: -300,
    phase: 3.1,
    speed: 0.21,
    orbitX: 0.08,
    orbitY: 0.12,
    dive: 140,
    tilt: 19,
    size: 0.88,
  },
  {
    x: -0.44,
    y: -0.06,
    z: -40,
    phase: 5.8,
    speed: 0.26,
    orbitX: 0.12,
    orbitY: 0.11,
    dive: 210,
    tilt: -16,
    size: 0.82,
  },
  {
    x: 0.12,
    y: 0.47,
    z: 260,
    phase: 1.8,
    speed: 0.17,
    orbitX: 0.11,
    orbitY: 0.1,
    dive: 250,
    tilt: 10,
    size: 0.78,
  },
];

export interface AlbumFlightProfile {
  readonly motion: AlbumPhotoMotion;
  readonly spinAxis: 'x' | 'y';
  readonly spinSpeed: number;
}

export interface AlbumFlightBounds {
  width: number;
  height: number;
}

export interface AlbumFlightPose {
  x: number;
  y: number;
  z: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/** Only the added full-spin speed is seeded; reference motion stays unmodified. */
export function createAlbumFlight(
  id: string,
  index: number,
): AlbumFlightProfile {
  const laneIndex = Math.max(0, Math.floor(finite(index)));
  const seed = hash(`${id}:${laneIndex}`) / 0x100000000;
  return {
    motion: PHOTO_MOTIONS[laneIndex % PHOTO_MOTIONS.length],
    spinAxis: laneIndex % 2 === 0 ? 'y' : 'x',
    spinSpeed: (14 + seed * 9) * (laneIndex % 4 < 2 ? 1 : -1),
  };
}

/** entranceProgress is raw 0..1; the reference uses elapsed/2.65 seconds. */
export function sampleAlbumFlight(
  profile: AlbumFlightProfile,
  seconds: number,
  bounds: AlbumFlightBounds,
  light: boolean,
  entranceProgress = 1,
): AlbumFlightPose {
  const time = finite(seconds);
  const width = Math.max(0, finite(bounds.width));
  const height = Math.max(0, finite(bounds.height));
  const motion = profile.motion;
  const phase = time * motion.speed + motion.phase;
  const progress = Math.min(1, Math.max(0, finite(entranceProgress)));
  const eased = 1 - Math.pow(1 - progress, 3);
  const settledDepth = motion.z + Math.sin(phase * 0.72) * motion.dive;
  const depth = settledDepth * (light ? 0.52 : 1) - (1 - eased) * 1250;
  const perspectiveScale = Math.min(1.72, 1050 / Math.max(520, 1050 - depth));
  const pitch = Math.sin(phase * 0.38) * 8;
  const yaw = Math.cos(phase * 0.47) * 12;
  return {
    x:
      (motion.x +
        Math.sin(phase) * motion.orbitX +
        Math.cos(phase * 0.53) * 0.035) *
      width *
      (light ? 0.64 : 1),
    y:
      (motion.y +
        Math.cos(phase * 0.76) * motion.orbitY +
        Math.sin(phase * 0.41) * 0.03) *
      height *
      (light ? 0.72 : 1),
    z: depth,
    rotateX: pitch + (profile.spinAxis === 'x' ? profile.spinSpeed * time : 0),
    rotateY: yaw + (profile.spinAxis === 'y' ? profile.spinSpeed * time : 0),
    rotateZ: motion.tilt + Math.sin(phase * 0.6) * 9,
    scale: motion.size * perspectiveScale,
  };
}

export function sampleAlbumWorld(seconds: number): {
  rotateX: number;
  rotateY: number;
} {
  // Reference auto-yaw: 0.000028 rad per millisecond. Drag pitch is controlled
  // separately by the scene and clamped there to +/-0.42 radians.
  return {
    rotateX: 0,
    rotateY: (finite(seconds) * 0.000028 * 1000 * 180) / Math.PI,
  };
}

function cssNumber(value: number): string {
  return finite(value).toFixed(3);
}

/** Keep physical depth outside the independent two-sided photo card. */
export function flightTransform(pose: AlbumFlightPose): string {
  return `translate3d(${cssNumber(pose.x)}px, ${cssNumber(pose.y)}px, ${cssNumber(pose.z)}px)`;
}

export function photoTransform(pose: AlbumFlightPose): string {
  return `translate(-50%, -50%) rotateX(${cssNumber(pose.rotateX)}deg) rotateY(${cssNumber(pose.rotateY)}deg) rotateZ(${cssNumber(pose.rotateZ)}deg) scale(${cssNumber(pose.scale)})`;
}
