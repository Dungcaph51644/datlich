import { useEffect, useState } from 'react';
import { ArrowUpRight, MoveDown, Sparkles, Zap } from 'lucide-react';

export function scrollToClubSection(
  id: string,
  block: ScrollLogicalPosition = 'start',
) {
  const reduced =
    document.documentElement.dataset.motion === 'reduced' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block });
}

/** Only the visual preference lives on this device; club data stays on Supabase. */
export function useMotionPreference() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('club-motion') !== 'reduced';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? 'full' : 'reduced';
    try {
      localStorage.setItem('club-motion', enabled ? 'full' : 'reduced');
    } catch {
      // Private browsing may disable preference storage.
    }
  }, [enabled]);
  return [enabled, setEnabled] as const;
}

export function MotionToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="icon-btn motion-toggle"
      aria-label={
        enabled ? 'Giảm hiệu ứng chuyển động' : 'Bật hiệu ứng chuyển động'
      }
      aria-pressed={enabled}
      title={enabled ? 'Giảm hiệu ứng' : 'Bật hiệu ứng'}
      onClick={onToggle}
    >
      <Sparkles size={18} />
    </button>
  );
}

export function SportsHero({ onRegister }: { onRegister: () => void }) {
  return (
    <div className="hero" data-sport-ambient>
      <div className="hero-noise" aria-hidden="true" />
      <div className="hero-orbit" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="hero-visual" aria-hidden="true">
        <img
          className="court-art"
          src="/images/badminton-hero.jpg"
          alt=""
          width={1536}
          height={1024}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="hero-top-label" aria-hidden="true">
        <span>
          <Zap size={13} fill="currentColor" /> PLAY TOGETHER
        </span>
        <span>BADMINTON CLUB / VIETNAM</span>
      </div>
      <div className="hero-content">
        <span className="hero-eyebrow">
          <span /> CẦU LÔNG VÀ NHỮNG NGƯỜI BẠN
        </span>
        <h1>
          <span className="hero-line">
            <span>LÊN SÂN.</span>
          </span>
          <span className="hero-line">
            <em>HẾT MÌNH.</em>
          </span>
        </h1>
        <p>
          Mỗi đường cầu, thêm kết nối.
          <br />
          Mỗi buổi hẹn, thêm một niềm vui.
        </p>
        <button className="btn btn-lime hero-cta" onClick={onRegister}>
          Đăng ký buổi đánh{' '}
          <span>
            <ArrowUpRight size={21} />
          </span>
        </button>
      </div>
      <div className="hero-bottom">
        <span className="hero-friend-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          CHUNG ĐAM MÊ.
          <br />
          <strong>BỀN TÌNH BẠN.</strong>
        </span>
        <a
          className="hero-scroll"
          href="#weekly"
          aria-label="Xem lịch trong tuần"
        >
          <MoveDown size={19} />
        </a>
      </div>
      <span className="hero-side-label" aria-hidden="true">
        GOOD GAMES. GREAT FRIENDS.
      </span>
    </div>
  );
}

export function MomentumStrip() {
  const words = [
    'XÁCH VỢT LÊN',
    'HẸN NHAU TRÊN SÂN',
    'CHƠI HẾT MÌNH',
    'VUI CÙNG ĐỒNG ĐỘI',
  ];
  return (
    <div className="momentum-strip" aria-hidden="true" data-sport-ambient>
      <div className="momentum-track">
        {[0, 1].map((copy) => (
          <div className="momentum-group" key={copy}>
            {words.map((word) => (
              <span key={word}>
                {word}
                <Sparkles size={19} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Animate presentation layers without remounting registrations or note drafts. */
export function useSportMotion(page: string, week: number, enabled: boolean) {
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    let frame = 0;
    const progress = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const range = root.scrollHeight - innerHeight;
        root.style.setProperty(
          '--scroll-progress',
          String(range > 0 ? scrollY / range : 0),
        );
        frame = 0;
      });
    };
    const visibility = () => {
      root.dataset.paused = document.hidden ? 'true' : 'false';
    };
    window.addEventListener('scroll', progress, { passive: true });
    window.addEventListener('resize', progress);
    document.addEventListener('visibilitychange', visibility);
    progress();
    visibility();
    if (!enabled || media.matches || !('IntersectionObserver' in window)) {
      document
        .querySelectorAll('.motion-reveal')
        .forEach((el) => el.classList.add('is-visible'));
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', progress);
        window.removeEventListener('resize', progress);
        document.removeEventListener('visibilitychange', visibility);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (target.hasAttribute('data-sport-ambient')) {
            target.classList.toggle('ambient-visible', isIntersecting);
          } else if (isIntersecting) {
            target.classList.add('is-visible');
            observer.unobserve(target);
          }
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px 32px 0px' },
    );
    const discover = () => {
      document
        .querySelectorAll<HTMLElement>(
          '.week-section, .bottom-note, .session-card, .member-card, .audit-row, .booking-home, .booking-assignment, .rotation-card, .booking-history-item',
        )
        .forEach((el, i) => {
          if (!el.classList.contains('motion-reveal')) {
            el.style.setProperty(
              '--reveal-delay',
              `${Math.min(i % 4, 3) * 65}ms`,
            );
            el.classList.add('motion-reveal');
          }
          if (!el.classList.contains('is-visible')) observer.observe(el);
        });
      document
        .querySelectorAll('[data-sport-ambient]')
        .forEach((el) => observer.observe(el));
      progress();
    };
    discover();
    const mutations = new MutationObserver(discover);
    mutations.observe(document.getElementById('root')!, {
      subtree: true,
      childList: true,
    });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', progress);
      window.removeEventListener('resize', progress);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [page, week, enabled]);
}
