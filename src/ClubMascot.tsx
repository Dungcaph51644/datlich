import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowUpRight,
  EyeOff,
  Settings2,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import { ShuttleCharacter } from './ShuttleCharacter';
import { MascotSmash } from './MascotSmash';
import {
  DEFAULT_MASCOT_PREFERENCES,
  MASCOT_PREFERENCES_KEY,
  mascotBanter,
  mascotReminder,
  momentMessage,
  parseMascotPreferences,
  type MascotMessage,
  type MascotPreferences,
  type RegistrationMoment,
} from './mascot';
import type { Snapshot } from './types';

export function useMascotPreferences() {
  const [preferences, setPreferences] = useState<MascotPreferences>(() => {
    try {
      return parseMascotPreferences(
        localStorage.getItem(MASCOT_PREFERENCES_KEY),
      );
    } catch {
      return { ...DEFAULT_MASCOT_PREFERENCES };
    }
  });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === MASCOT_PREFERENCES_KEY || event.key === null)
        setPreferences(parseMascotPreferences(event.newValue));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function update(patch: Partial<MascotPreferences>) {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(MASCOT_PREFERENCES_KEY, JSON.stringify(next));
      } catch {
        /* In-memory preference when storage is unavailable. */
      }
      return next;
    });
  }
  return [preferences, update] as const;
}

const greeting = mascotBanter(0);
const welcome: MascotMessage = {
  key: 'welcome',
  mood: 'wave',
  title: 'Xin chào, đồng đội!',
  text: 'Cầu Cầu có mặt! Mang vợt, mang nước, mang tinh thần lên sân. Còn phần gáy cứ để tôi lo!',
  detail: 'CHÚC BẠN MỘT NGÀY NHIỀU NIỀM VUI',
};
const isChatter = (message: MascotMessage | null) =>
  message?.key === 'welcome' || message?.key.startsWith('banter:');
const seenKey = 'club.mascot.reminders';
function hasSeen(key: string) {
  try {
    const seen = JSON.parse(sessionStorage.getItem(seenKey) ?? '[]');
    return Array.isArray(seen) && seen.includes(key);
  } catch {
    return false;
  }
}
function remember(key: string) {
  try {
    const seen: unknown = JSON.parse(sessionStorage.getItem(seenKey) ?? '[]');
    sessionStorage.setItem(
      seenKey,
      JSON.stringify(
        [
          ...(Array.isArray(seen)
            ? seen.filter((x) => typeof x === 'string')
            : []),
          key,
        ].slice(-40),
      ),
    );
  } catch {
    /* Still limit reminders within this mount. */
  }
}

export interface ClubMascotProps {
  data: Snapshot;
  memberId: string | null;
  moment?: RegistrationMoment | null;
  ready: boolean;
  motionEnabled: boolean;
  preferences: MascotPreferences;
  welcomePending?: boolean;
  onWelcome?: () => void;
  onPreferences: (patch: Partial<MascotPreferences>) => void;
  onOpenSession: (id: string) => void;
}

export function ClubMascot({
  data,
  memberId,
  moment,
  ready,
  motionEnabled,
  preferences,
  welcomePending = true,
  onWelcome,
  onPreferences,
  onOpenSession,
}: ClubMascotProps) {
  const panelId = useId();
  const headingId = useId();
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState<MascotMessage | null>(null);
  const [manual, setManual] = useState(false);
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState(false);
  const [idleTurn, setIdleTurn] = useState(-1);
  const [smashRun, setSmashRun] = useState<'auto' | 'preview' | null>(null);
  const finishSmash = useCallback(() => setSmashRun(null), []);
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const [blocked, setBlocked] = useState(false);
  const [paused, setPaused] = useState(document.hidden);
  const [lift, setLift] = useState(0);
  const obstruction = useRef({ blocked: false, lift: 0 });
  const lastMoment = useRef(moment?.id ?? 0);
  const seen = useRef(new Set<string>());
  const silencedUntil = useRef(0);
  const banterTurn = useRef(0);
  const autoStarted = useRef(false);
  const autoTurns = useRef(0);
  const welcomed = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reminder = ready ? mascotReminder(data, memberId, now) : null;
  const latest = moment && ready ? momentMessage(moment, data, memberId) : null;
  const active = message?.key.startsWith('saved:')
    ? latest?.key === message.key
      ? latest
      : null
    : isChatter(message)
      ? message
      : reminder?.key === message?.key
        ? reminder
        : null;
  const displayed = manual ? (active ?? reminder ?? greeting) : active;
  const canAnimate =
    motionEnabled && preferences.motion && !reduced && !paused && !editing;
  const smashPlaying = !!(
    smashRun &&
    canAnimate &&
    preferences.smash &&
    !preferences.hidden &&
    !blocked &&
    !manual &&
    !lift &&
    (smashRun === 'preview' || preferences.autoTalk) &&
    (!displayed || isChatter(displayed))
  );
  useEffect(() => {
    if (smashRun && !smashPlaying) finishSmash();
  }, [smashRun, smashPlaying, finishSmash]);

  function consumeWelcome() {
    welcomed.current = true;
    if (welcomePending) onWelcome?.();
  }

  useEffect(() => {
    const isEditor = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      !target.closest('.club-mascot') &&
      !!target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      );
    const focusIn = (event: FocusEvent) => setEditing(isEditor(event.target));
    const focusOut = (event: FocusEvent) =>
      setEditing(isEditor(event.relatedTarget));
    setEditing(isEditor(document.activeElement));
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    return () => {
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setReduced(media.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, []);
  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      setPaused(document.hidden);
    };
    const timer = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    const check = () => {
      const nextBlocked = !!document.querySelector(
        'dialog[open], [role="dialog"][aria-modal="true"]',
      );
      const height =
        document.querySelector('.toast')?.getBoundingClientRect().height ?? 0;
      const nextLift = height > 0 ? height + 14 : 0;
      if (obstruction.current.blocked !== nextBlocked) setBlocked(nextBlocked);
      if (obstruction.current.lift !== nextLift) setLift(nextLift);
      obstruction.current = { blocked: nextBlocked, lift: nextLift };
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'role', 'aria-modal'],
    });
    window.addEventListener('resize', check);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('resize', check);
    };
  }, []);
  useEffect(() => {
    if (preferences.hidden && moment) {
      lastMoment.current = moment.id;
      return;
    }
    if (
      !moment ||
      moment.id === lastMoment.current ||
      !latest ||
      blocked ||
      paused ||
      preferences.hidden ||
      Date.now() - moment.createdAt > 30000
    )
      return;
    lastMoment.current = moment.id;
    finishSmash();
    consumeWelcome();
    setMessage(latest);
    setSettings(false);
    silencedUntil.current = Date.now() + 60000;
  }, [moment?.id, latest?.key, blocked, paused, preferences.hidden, onWelcome]);
  useEffect(() => {
    if (!welcomePending || welcomed.current) return;
    if (preferences.hidden || !preferences.autoTalk) {
      consumeWelcome();
      return;
    }
    if (blocked || paused || editing || manual || message) return;
    const timer = setTimeout(() => {
      consumeWelcome();
      setMessage(welcome);
    }, 700);
    return () => clearTimeout(timer);
  }, [
    welcomePending,
    onWelcome,
    preferences.hidden,
    preferences.autoTalk,
    blocked,
    paused,
    editing,
    manual,
    message,
  ]);
  useEffect(() => {
    if (
      !reminder ||
      blocked ||
      paused ||
      preferences.hidden ||
      manual ||
      (message && !message.key.startsWith('banter:')) ||
      Date.now() < silencedUntil.current ||
      seen.current.has(reminder.key) ||
      hasSeen(reminder.key)
    )
      return;
    const current = reminder;
    const timer = setTimeout(() => {
      seen.current.add(current.key);
      remember(current.key);
      setMessage(current);
    }, 1800);
    return () => clearTimeout(timer);
  }, [
    reminder?.key,
    blocked,
    paused,
    preferences.hidden,
    manual,
    message,
    now,
  ]);
  // Ambient expressions and local jokes never take priority over real events.
  useEffect(() => {
    if (
      !preferences.autoTalk ||
      preferences.hidden ||
      blocked ||
      paused ||
      editing ||
      manual ||
      displayed ||
      smashPlaying ||
      !canAnimate
    )
      return;
    const timer = setTimeout(() => setIdleTurn((turn) => turn + 1), 9000);
    return () => clearTimeout(timer);
  }, [
    preferences.autoTalk,
    preferences.hidden,
    blocked,
    paused,
    editing,
    manual,
    displayed?.key,
    canAnimate,
    idleTurn,
    smashPlaying,
  ]);
  useEffect(() => {
    const pendingReminder =
      reminder && !seen.current.has(reminder.key) && !hasSeen(reminder.key);
    if (
      !preferences.autoTalk ||
      preferences.hidden ||
      blocked ||
      paused ||
      editing ||
      manual ||
      message ||
      smashPlaying ||
      pendingReminder
    )
      return;
    const delay = Math.max(
      autoStarted.current ? 28000 : 8000,
      silencedUntil.current - Date.now(),
    );
    const timer = setTimeout(() => {
      autoStarted.current = true;
      autoTurns.current += 1;
      banterTurn.current += 1;
      const smash =
        autoTurns.current % 4 === 2 &&
        canAnimate &&
        preferences.smash &&
        !lift &&
        !launcher.current?.contains(document.activeElement);
      const next: MascotMessage = smash
        ? {
            key: `banter:smash:${autoTurns.current}`,
            mood: 'angry',
            title: 'Cầu Cầu nổi quạu!',
            text: 'Đổ tại gió nữa hả? Để tôi đập một quả cho gió tỉnh luôn!',
            detail: 'GÁY CÓ ĐAM MÊ · ĐẬP CÓ TRÁCH NHIỆM',
          }
        : mascotBanter(banterTurn.current);
      setMessage((current) =>
        current && !current.key.startsWith('banter:') ? current : next,
      );
      if (smash) setSmashRun('auto');
    }, delay);
    return () => clearTimeout(timer);
  }, [
    preferences.autoTalk,
    preferences.hidden,
    blocked,
    paused,
    editing,
    manual,
    message,
    reminder?.key,
    now,
    canAnimate,
    preferences.smash,
    lift,
    smashPlaying,
  ]);
  useEffect(() => {
    if (
      !manual &&
      (blocked ||
        paused ||
        editing ||
        preferences.hidden ||
        !preferences.autoTalk)
    )
      setMessage((current) => (isChatter(current) ? null : current));
  }, [
    blocked,
    paused,
    editing,
    preferences.hidden,
    preferences.autoTalk,
    manual,
  ]);
  useEffect(() => {
    if (!message || manual || paused || blocked || smashPlaying) return;
    const duration = isChatter(message) ? 6500 : 4800;
    const timer = setTimeout(() => setMessage(null), duration);
    return () => clearTimeout(timer);
  }, [message, manual, paused, blocked, smashPlaying]);
  // Reminders disappear immediately if the session changes/cancels, or fresh reads fail.
  useEffect(() => {
    if (message && !active) {
      const staleKey = message.key;
      setMessage((current) => (current?.key === staleKey ? null : current));
    }
  }, [message, active?.key]);
  useEffect(() => {
    if (!manual || blocked || preferences.hidden) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !launcher.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [manual, blocked, preferences.hidden]);
  function close() {
    consumeWelcome();
    setMessage(null);
    setManual(false);
    setSettings(false);
    silencedUntil.current = Date.now() + 60000;
  }
  function escape(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      launcher.current?.focus();
    }
  }
  if (preferences.hidden) return null;
  const mood =
    displayed?.mood ??
    (preferences.autoTalk && canAnimate && idleTurn >= 0
      ? mascotBanter(idleTurn).mood
      : 'idle');
  return (
    <>
      <aside
        className="club-mascot"
        style={{ '--mascot-lift': `${lift}px` } as React.CSSProperties}
        data-animated={canAnimate}
        data-paused={paused}
        hidden={blocked || smashPlaying}
        aria-label="Linh vật Cầu Cầu"
        onKeyDown={escape}
      >
        {displayed && (
          <div
            id={panelId}
            ref={panel}
            className={`mascot-bubble ${manual ? 'is-pinned' : ''}`}
            role="region"
            aria-labelledby={headingId}
            onFocusCapture={() => setManual(true)}
          >
            <div className="mascot-bubble-top">
              <span>
                <i />
                CẦU CẦU · BẠN CÙNG SÂN
              </span>
              <button
                type="button"
                className="mascot-icon-button"
                aria-label="Đóng lời nhắn của Cầu Cầu"
                onClick={close}
              >
                <X size={16} />
              </button>
            </div>
            <div
              className="mascot-message"
              role="status"
              aria-live={!manual && isChatter(displayed) ? 'off' : 'polite'}
              aria-atomic="true"
            >
              <h3 id={headingId}>{displayed.title}</h3>
              <p>{displayed.text}</p>
            </div>
            <small className="mascot-detail">{displayed.detail}</small>
            <div className="mascot-bubble-actions">
              {displayed.sessionId && (
                <button
                  type="button"
                  className="mascot-session-link"
                  onClick={() => {
                    onOpenSession(displayed.sessionId!);
                    close();
                  }}
                >
                  Mở buổi đánh <ArrowUpRight size={15} />
                </button>
              )}
              <button
                type="button"
                className="mascot-session-link mascot-banter-button"
                onClick={() => {
                  banterTurn.current += 1;
                  setMessage(mascotBanter(banterTurn.current));
                  setManual(true);
                  setSettings(false);
                  silencedUntil.current = Date.now() + 60000;
                }}
              >
                <Shuffle size={14} /> Chọc Cầu Cầu
              </button>
              <button
                type="button"
                className="mascot-icon-button mascot-settings-button"
                aria-label="Tùy chỉnh linh vật"
                aria-expanded={settings}
                onClick={() => {
                  setManual(true);
                  setSettings(!settings);
                }}
              >
                <Settings2 size={16} />
              </button>
            </div>
            {settings && (
              <div className="mascot-settings">
                <label>
                  <span>
                    Tự động tấu hài
                    <small>Tự đổi nét mặt và bật câu vui khi bạn rảnh</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Tự động tấu hài của Cầu Cầu"
                    checked={preferences.autoTalk}
                    onChange={(e) =>
                      onPreferences({ autoTalk: e.target.checked })
                    }
                  />
                </label>
                <label>
                  <span>
                    Chuyển động
                    <small>
                      {reduced || !motionEnabled
                        ? 'Đang giảm hiệu ứng theo thiết bị / website'
                        : 'Nhảy nhẹ, vẫy tay và chớp mắt'}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Chuyển động của Cầu Cầu"
                    checked={canAnimate}
                    disabled={reduced || !motionEnabled}
                    onChange={(e) =>
                      onPreferences({ motion: e.target.checked })
                    }
                  />
                </label>
                <label>
                  <span>
                    Hiệu ứng đập cầu
                    <small>Ra giữa màn hình, vung vợt và làm kính nứt</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Hiệu ứng đập cầu của Cầu Cầu"
                    checked={preferences.smash}
                    onChange={(e) => onPreferences({ smash: e.target.checked })}
                  />
                </label>
                <button
                  type="button"
                  disabled={!canAnimate || !preferences.smash}
                  onClick={() => {
                    close();
                    setSmashRun('preview');
                  }}
                >
                  <Sparkles size={15} /> Xem cú đập
                  {(!canAnimate || !preferences.smash) && (
                    <small>Bật hiệu ứng và chuyển động</small>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onPreferences({ hidden: true });
                  }}
                >
                  <EyeOff size={15} />
                  Ẩn linh vật<small>Bật lại ở cuối trang</small>
                </button>
              </div>
            )}
          </div>
        )}
        <div className="mascot-stage" data-mood={mood}>
          <div className="mascot-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {mood === 'happy' && (
            <div
              className="mascot-confetti"
              key={displayed?.key}
              aria-hidden="true"
            >
              {Array.from({ length: 9 }, (_, i) => (
                <i
                  key={i}
                  style={
                    {
                      '--particle': i,
                      '--rise': `${65 + (i % 3) * 14}px`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          )}
          <button
            ref={launcher}
            type="button"
            className="mascot-launcher"
            aria-label={
              manual
                ? 'Thu gọn linh vật Cầu Cầu'
                : 'Mở lời nhắn và tùy chỉnh linh vật Cầu Cầu'
            }
            aria-expanded={!!displayed}
            aria-controls={displayed ? panelId : undefined}
            onClick={() => {
              if (manual) close();
              else {
                consumeWelcome();
                setMessage(
                  latest?.key === message?.key
                    ? latest
                    : (reminder ?? greeting),
                );
                setManual(true);
              }
            }}
          >
            <ShuttleCharacter
              key={`${mood}:${displayed?.key ?? 'idle'}`}
              mood={mood}
            />
            <span className="mascot-name">
              <Sparkles size={10} />
              Cầu Cầu
            </span>
          </button>
        </div>
      </aside>
      {smashPlaying && <MascotSmash onComplete={finishSmash} />}
    </>
  );
}
