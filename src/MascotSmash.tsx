import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShuttleCharacter } from './ShuttleCharacter';

export const SMASH_DURATION_MS = 4800;

// Normalized glass geometry fills portrait and landscape viewports. Paths split
// at uneven distances so it looks like an impact rather than a regular spiderweb.
const rays = [
  'M500 460L439 366L414 293L325 184L272 0M439 366L357 355L278 295L157 272L0 166',
  'M500 460L498 356L537 278L520 161L563 0M498 356L456 305L459 220L410 139L414 0',
  'M500 460L569 380L611 292L711 218L783 88L866 0M611 292L608 208L661 125L638 0',
  'M500 460L618 439L699 389L804 384L916 328L1000 332M699 389L750 320L848 278L892 182L1000 126',
  'M500 460L616 503L717 514L801 574L907 582L1000 640M717 514L774 481L889 466L1000 481',
  'M500 460L563 553L598 659L682 731L705 841L800 1000M598 659L677 654L774 712L859 727L1000 816',
  'M500 460L485 566L508 671L466 787L492 888L458 1000M508 671L546 748L535 854L587 1000',
  'M500 460L414 534L369 625L280 702L247 818L139 1000M369 625L364 711L402 799L367 916L386 1000',
  'M500 460L378 479L275 524L175 510L78 559L0 553M275 524L220 602L110 657L0 763',
  'M500 460L399 417L325 422L238 361L125 348L0 289M325 422L289 464L191 459L100 488L0 461',
];
const joins = [
  'M439 366L498 356L569 380L618 439L616 503L563 553L485 566L414 534L378 479L399 417Z',
  'M414 293L456 305L537 278L611 292M699 389L717 514L677 654L598 659M508 671L369 625L275 524M325 422L357 355L414 293',
  'M478 428L503 410L538 430L543 468L511 496L478 485L460 455Z',
];
const fragments = [
  { points: '500,460 439,366 498,356', x: -12, y: -14, r: -7 },
  { points: '500,460 569,380 618,439', x: 18, y: -12, r: 9 },
  { points: '500,460 616,503 563,553', x: 22, y: 21, r: -8 },
  { points: '500,460 485,566 414,534', x: -9, y: 28, r: 10 },
  { points: '500,460 378,479 399,417', x: -24, y: 7, r: -12 },
];

export function SmashGlass() {
  return (
    <svg
      className="mascot-smash-glass"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className="smash-fragments">
        {fragments.map((piece, i) => (
          <polygon
            key={i}
            points={piece.points}
            style={
              {
                '--shard-x': `${piece.x}px`,
                '--shard-y': `${piece.y}px`,
                '--shard-r': `${piece.r}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </g>
      <g
        className="smash-cracks-shadow"
        stroke="#183C32"
        strokeOpacity=".45"
        strokeWidth="2.7"
        strokeLinejoin="round"
      >
        {[...rays, ...joins].map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <g
        className="smash-cracks-light"
        stroke="#FFFFF5"
        strokeOpacity=".9"
        strokeWidth="1.15"
        strokeLinejoin="round"
      >
        {[...rays, ...joins].map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}

/** A decorative portal: no focus capture, scroll lock, page transforms or data writes. */
export function MascotSmash({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, SMASH_DURATION_MS);
    const dismiss = () => onComplete();
    document.addEventListener('pointerdown', dismiss, { passive: true });
    document.addEventListener('keydown', dismiss);
    document.addEventListener('wheel', dismiss, { passive: true });
    document.addEventListener('touchmove', dismiss, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('wheel', dismiss);
      document.removeEventListener('touchmove', dismiss);
    };
  }, [onComplete]);
  return createPortal(
    <div
      className="mascot-smash"
      aria-hidden="true"
      style={
        { '--smash-duration': `${SMASH_DURATION_MS}ms` } as React.CSSProperties
      }
    >
      <div className="mascot-smash-veil" />
      <div className="mascot-smash-speedlines" />
      <div className="mascot-smash-actor">
        <ShuttleCharacter mood="angry" />
      </div>
      <div className="mascot-smash-cry">
        <small>CẦU CẦU NỔI QUẠU</small>
        <strong>Né ra, để tôi gánh!</strong>
      </div>
      <svg
        className="mascot-smash-projectile"
        viewBox="0 0 80 100"
        fill="none"
        focusable="false"
      >
        <path
          d="M25 68L9 12L23 24L31 4L40 22L49 4L57 24L71 12L55 68Z"
          fill="#FFFEEF"
          stroke="#57745B"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path
          d="M25 68L23 24M32 68L31 4M40 68V22M48 68L49 4M55 68L57 24M17 42Q40 55 63 42"
          stroke="#B1BE9B"
          strokeWidth="1.8"
        />
        <path
          d="M25 66H55V77C55 96 25 96 25 77Z"
          fill="#F3DEB4"
          stroke="#35563D"
          strokeWidth="2.3"
        />
        <path d="M25 66H55V73H25Z" fill="#4D7552" />
      </svg>
      <div className="mascot-smash-impact" />
      <SmashGlass />
      <div className="mascot-smash-punchline">
        <strong>Ối, gáy hơi quá tay!</strong>
        <span>Bình tĩnh, phong độ vẫn còn nguyên.</span>
      </div>
    </div>,
    document.body,
  );
}
