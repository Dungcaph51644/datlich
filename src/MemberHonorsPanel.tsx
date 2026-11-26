import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  Crown,
  Camera,
  ImagePlus,
  LockKeyhole,
  Medal,
  Upload,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AVATARS,
  BADGES,
  avatarPath,
  badgeInfo,
  type HonorCategory,
  type MemberHub,
  type MemberStyle,
} from './memberHonors';
import { MemberAvatar } from './MemberAvatar';
import {
  memberAvatarUrl,
  type AvatarUploadAttempt,
} from './memberAvatarUpload';
import { Modal } from './Modal';
import { message } from './lib';
import type { Member } from './types';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;
const monthLabel = (month: string) =>
  `${month.slice(5, 7)}/${month.slice(0, 4)}`;
function ownIdentity(club: Club) {
  const id = club.memberHub?.viewer_member_id;
  return id &&
    id === club.booking?.verified_member_id &&
    club.members.some((m) => m.id === id && m.active)
    ? id
    : null;
}

export function MemberHonorSummary({
  member,
  club,
  onVerify,
}: {
  member: Member;
  club: Club;
  onVerify: () => void;
}) {
  const [open, setOpen] = useState(false);
  const profile = club.memberHub?.profiles.find(
    (p) => p.member_id === member.id,
  );
  if (!profile) return null;
  const earned = profile.badges.filter((b) => b.earned);
  const pinned = badgeInfo(profile.featured_badge);
  return (
    <div className="honors-member-line">
      <button
        className="honors-collection-link"
        onClick={() => setOpen(true)}
        aria-label={`Xem huy hiệu và avatar của ${member.display_name}`}
      >
        <span>{pinned?.emoji ?? '✦'}</span>
        <span>{pinned?.name ?? `${earned.length} huy hiệu`}</span>
        <ArrowUpRight size={14} />
      </button>
      {open && (
        <ProfileDialog
          key={member.id}
          member={member}
          profile={profile}
          club={club}
          initialTab="badges"
          close={() => setOpen(false)}
          onVerify={() => {
            setOpen(false);
            onVerify();
          }}
        />
      )}
    </div>
  );
}

export function MemberHubPanel({
  club,
  onVerify,
}: {
  club: Club;
  onVerify: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hub = club.memberHub;
  const mine = ownIdentity(club);
  const member = club.members.find((m) => m.id === mine);
  const profile = hub?.profiles.find((p) => p.member_id === mine);
  const unavailable = !hub || !!club.error || !!club.memberHubError;
  return (
    <section className="honors-hub" aria-label="Huy hiệu vui của nhóm">
      <div className="honors-intro">
        <div>
          <span className="honors-eyebrow">
            <Sparkles size={14} /> HỘI ĐỒNG GÁY KHÉT
          </span>
          <h2>
            Hội mình
            <br />
            <em>chất riêng.</em>
          </h2>
          <p>
            Lên sân có đồng đội. Vào hội có hào quang.
            <br className="honors-desktop-break" /> Sưu tầm huy hiệu, chọn gương
            mặt mang đúng chất bạn.
          </p>
          <button
            className="btn btn-dark"
            disabled={unavailable}
            onClick={() => (member && profile ? setOpen(true) : onVerify())}
          >
            {member ? <Crown size={17} /> : <ShieldCheck size={17} />}
            {member ? 'Diện mạo & huy hiệu của tôi' : 'Xác minh để chọn avatar'}
            <ArrowUpRight size={15} />
          </button>
          {member && (
            <small className="honors-identity">
              Đang xác minh: {member.display_name} · Chỉ chỉnh diện mạo của bạn
            </small>
          )}
        </div>
        <div className="honors-showcase">
          <span className="honors-showcase-label">
            THẺ ĐỒNG ĐỘI / CLUB PASS
          </span>
          <div className="honors-pass-person">
            <span className="honors-pass-photo">
              {member ? (
                <MemberAvatar id={member.id} name={member.display_name} />
              ) : (
                <span aria-hidden="true">🏸</span>
              )}
            </span>
            <div>
              <small>
                {member
                  ? 'Rất vui vì có bạn trong hội'
                  : 'Một hội, nhiều cá tính'}
              </small>
              <strong>{member?.display_name ?? 'Đồng đội tiếp theo?'}</strong>
              <span>
                {profile
                  ? `${profile.badges.filter((b) => b.earned).length}/${BADGES.length} huy hiệu đã mở`
                  : 'Chọn diện mạo · Gom huy hiệu'}
              </span>
            </div>
            <Sparkles className="honors-pass-spark" size={28} />
          </div>
          <div className="honors-pass-divider" />
          <div className="honors-avatar-parade" aria-label="Bộ avatar lầy lội">
            {AVATARS.map((a, i) => (
              <div className={`honors-parade-face face-${i}`} key={a.key}>
                <img
                  src={avatarPath(a.key)}
                  alt={a.name}
                  width="120"
                  height="120"
                />
              </div>
            ))}
            <div>
              <strong>Đẹp theo cách của bạn.</strong>
              <span>Avatar lầy hoặc ảnh từ thiết bị</span>
            </div>
          </div>
        </div>
      </div>
      {unavailable ? (
        <div className="honors-unavailable" role="status">
          <p>
            {club.error
              ? 'Chưa cập nhật được dữ liệu nhóm. Thử tải lại trước khi đổi diện mạo hoặc bình chọn.'
              : club.memberHubError || 'Đang tải huy hiệu và avatar…'}
          </p>
          <button
            className="btn btn-outline"
            disabled={!club.online || club.loading}
            onClick={() => void club.reload()}
          >
            <RefreshCw size={15} />
            Tải lại
          </button>
        </div>
      ) : (
        <>
          <div className="honors-vote-heading">
            <div>
              <span className="honors-eyebrow">
                <span className="honors-live-dot" /> SPOTLIGHT THÁNG{' '}
                {monthLabel(hub.month)}
              </span>
              <h3>Trao hào quang cho đồng đội</h3>
            </div>
            <p>
              Mỗi mục 1 phiếu/người · Được đổi hoặc rút phiếu.
              <br />
              Cuối tháng mới trao huy hiệu: từ 3 phiếu, cao nhất; hòa thì cùng
              nhận.
            </p>
          </div>
          <div className="honors-vote-grid">
            {(['comic', 'teammate'] as const).map((category) => (
              <VoteCard
                key={category}
                category={category}
                hub={hub}
                club={club}
                mine={mine}
                onVerify={onVerify}
              />
            ))}
          </div>
          <p className="honors-footnote">
            Huy hiệu đăng ký tính theo ngày đã kết thúc và đã đặt sân; chưa phải
            điểm danh thực tế. Không dùng huy hiệu để đánh giá trình độ hay
            quyền thành viên.
          </p>
        </>
      )}
      {open && member && profile && (
        <ProfileDialog
          member={member}
          profile={profile}
          club={club}
          close={() => setOpen(false)}
          onVerify={() => {
            setOpen(false);
            onVerify();
          }}
        />
      )}
    </section>
  );
}

export function ProfileDialog({
  member,
  profile,
  club,
  close,
  onVerify,
  initialTab,
}: {
  member: Member;
  profile: MemberStyle;
  club: Club;
  close: () => void;
  onVerify: () => void;
  initialTab?: 'avatar' | 'badges';
}) {
  const [draft, setDraft] = useState(() => ({
    avatar: profile.avatar_key,
    path: profile.avatar_path ?? null,
    badge: profile.featured_badge,
    version: profile.version,
    owner: member.id,
  }));
  const [tab, setTab] = useState<'avatar' | 'badges'>(() =>
    initialTab ?? (ownIdentity(club) === member.id ? 'avatar' : 'badges'),
  );
  const [photo, setPhoto] = useState<{
    attempt: AvatarUploadAttempt;
    preview: string;
  } | null>(null);
  const [processing, setProcessing] = useState(false);
  const imageSequence = useRef(0);
  useEffect(
    () => () => {
      imageSequence.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editable = ownIdentity(club) === member.id;
  const pinRevoked =
    !!draft.badge &&
    !profile.badges.some((b) => b.key === draft.badge && b.earned);
  const stale =
    draft.owner !== member.id ||
    draft.version !== profile.version ||
    pinRevoked;
  const blocked =
    !club.online ||
    !!club.error ||
    !!club.memberHubError ||
    processing ||
    saving ||
    club.saveState === 'saving';
  const previewAvatar = editable ? draft.avatar : profile.avatar_key;
  const previewSrc = editable
    ? photo?.preview ||
      (club.memberAvatarUrl ?? memberAvatarUrl)(draft.path) ||
      avatarPath(previewAvatar)
    : (club.memberAvatarUrl ?? memberAvatarUrl)(profile.avatar_path) ||
      avatarPath(previewAvatar);
  const previewBadge = editable ? draft.badge : profile.featured_badge;
  const badge = badgeInfo(previewBadge);
  const earned = profile.badges.filter((b) => b.earned);
  function reset() {
    setDraft({
      avatar: profile.avatar_key,
      path: profile.avatar_path ?? null,
      badge: profile.featured_badge,
      version: profile.version,
      owner: member.id,
    });
    imageSequence.current++;
    setProcessing(false);
    setPhoto(null);
    setError('');
  }
  function choosePreset(key: string) {
    imageSequence.current++;
    setPhoto(null);
    setProcessing(false);
    setDraft((old) => ({ ...old, avatar: key, path: null }));
    setError('');
  }
  async function choosePhoto(file?: File) {
    if (!file || blocked || !editable || !club.memberHub?.custom_avatars)
      return;
    const seq = ++imageSequence.current;
    setError('');
    setProcessing(true);
    try {
      const prepared = await club.prepareMemberAvatar(file);
      if (seq !== imageSequence.current) return;
      setPhoto({
        attempt: { file: prepared },
        preview: URL.createObjectURL(prepared),
      });
      setDraft((old) => ({ ...old, avatar: '', path: null }));
    } catch (e) {
      if (seq === imageSequence.current) setError(message(e));
    } finally {
      if (seq === imageSequence.current) setProcessing(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editable || stale || blocked) return;
    setError('');
    setSaving(true);
    const ok = await club.run(async () => {
      try {
        const path = photo
          ? await club.uploadMemberAvatar(photo.attempt)
          : draft.path;
        const args = {
          p_avatar_key: draft.avatar,
          p_featured_badge: draft.badge,
          p_expected_version: draft.version,
        };
        if (club.memberHub?.custom_avatars)
          await club.bookingRpc('save_member_appearance', {
            ...args,
            p_avatar_path: path,
          });
        else await club.bookingRpc('save_member_style', args);
      } catch (e) {
        setError(message(e));
        throw e;
      }
    }, 'Đã lưu avatar và huy hiệu của bạn');
    setSaving(false);
    if (ok) close();
    else
      setError(
        (old) =>
          old ||
          'Chưa lưu được. Lựa chọn vẫn còn, hãy kiểm tra kết nối rồi thử lại.',
      );
  }
  return (
    <Modal
      title={
        editable
          ? 'Diện mạo & huy hiệu của tôi'
          : `Bộ sưu tập · ${member.display_name}`
      }
      onClose={close}
      wide
      locked={saving}
    >
      <form className="honors-profile" onSubmit={(e) => void save(e)}>
        <div className="honors-profile-cover">
          <span className="honors-preview-avatar">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="Avatar xem trước"
                width="112"
                height="112"
              />
            ) : (
              member.display_name.trim().split(' ').at(-1)?.[0]
            )}
          </span>
          <div>
            <span className="honors-eyebrow">
              {editable ? 'XEM TRƯỚC DIỆN MẠO' : 'ĐỒNG ĐỘI TRÊN SÂN'}
            </span>
            <h3>{member.display_name}</h3>
            <p>
              {badge ? `${badge.emoji} ${badge.name}` : 'Chưa ghim huy hiệu'}
            </p>
            <small>
              {earned.length}/{BADGES.length} huy hiệu đã mở
            </small>
          </div>
          <span className="honors-profile-stamp" aria-hidden="true">
            <Medal size={26} />
            <small>
              CLUB
              <br />
              MEMBER
            </small>
          </span>
        </div>
        <div
          className="honors-profile-tabs"
          role="tablist"
          aria-label="Diện mạo và bộ sưu tập"
          onKeyDown={(e) => {
            if (
              !editable ||
              !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
            )
              return;
            e.preventDefault();
            const next =
              e.key === 'Home'
                ? 'avatar'
                : e.key === 'End'
                  ? 'badges'
                  : tab === 'avatar'
                    ? 'badges'
                    : 'avatar';
            setTab(next);
            e.currentTarget
              .querySelector<HTMLButtonElement>(
                `[aria-controls="honors-${next}-panel"]`,
              )
              ?.focus();
          }}
        >
          {editable && (
            <button
              type="button"
              role="tab"
              id="honors-avatar-tab"
              tabIndex={tab === 'avatar' ? 0 : -1}
              aria-controls="honors-avatar-panel"
              aria-selected={tab === 'avatar'}
              onClick={() => setTab('avatar')}
            >
              <Camera size={16} />
              Diện mạo
            </button>
          )}
          <button
            type="button"
            role="tab"
            id="honors-badges-tab"
            tabIndex={tab === 'badges' || !editable ? 0 : -1}
            aria-controls="honors-badges-panel"
            aria-selected={tab === 'badges' || !editable}
            onClick={() => setTab('badges')}
          >
            <Medal size={16} />
            Huy hiệu{' '}
            <span>
              {earned.length}/{BADGES.length}
            </span>
          </button>
        </div>
        {editable ? (
          <div
            role="tabpanel"
            id="honors-avatar-panel"
            aria-labelledby="honors-avatar-tab"
            hidden={tab !== 'avatar'}
            className="honors-appearance-grid"
          >
            <fieldset disabled={blocked} className="honors-upload-field">
              <legend>Ảnh của riêng bạn</legend>
              <div
                className={`honors-upload-card ${photo || draft.path ? 'has-photo' : ''}`}
              >
                <span className="honors-upload-visual">
                  {previewSrc && (photo || draft.path) ? (
                    <img src={previewSrc} alt="Ảnh cá nhân đã chọn" />
                  ) : (
                    <ImagePlus size={34} />
                  )}
                </span>
                <h4>
                  {photo
                    ? 'Ảnh mới, thần thái mới.'
                    : draft.path
                      ? 'Chất riêng lên sóng.'
                      : 'Cho cả hội biết mặt'}
                </h4>
                <p>
                  Chọn ảnh trong điện thoại hoặc máy tính. Ảnh sẽ cắt vuông ở
                  giữa, thu nhỏ và hiển thị với mọi người trên website.
                </p>
                {club.memberHub?.custom_avatars ? (
                  <label className="honors-upload-button">
                    <Upload size={16} />
                    <span>
                      {processing
                        ? 'Đang xử lý ảnh…'
                        : photo || draft.path
                          ? 'Chọn ảnh khác'
                          : 'Chọn ảnh từ thiết bị'}
                    </span>
                    <input
                      type="file"
                      name="avatar-file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Chọn ảnh từ thiết bị"
                      disabled={blocked}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        void choosePhoto(file);
                      }}
                    />
                  </label>
                ) : (
                  <p className="honors-upload-unavailable">
                    Tải ảnh cá nhân đang chờ cập nhật. Bạn vẫn có thể chọn
                    avatar có sẵn.
                  </p>
                )}
                <small>JPG, PNG, WebP · Tối đa 8 MB</small>
                {(photo || draft.path) && (
                  <button
                    type="button"
                    className="text-btn"
                    disabled={blocked}
                    onClick={() => choosePreset('')}
                  >
                    Bỏ ảnh cá nhân
                  </button>
                )}
                {photo && (
                  <span className="honors-unsaved-photo">
                    Bản xem trước · Chưa lưu
                  </span>
                )}
                <input
                  type="hidden"
                  name="custom-avatar"
                  value={photo?.preview ?? draft.path ?? ''}
                />
              </div>
            </fieldset>
            <fieldset disabled={blocked} className="honors-avatar-field">
              <legend>Hoặc chọn hệ điều hành lầy</legend>
              <p>Trình chưa tới? Thần thái phải tới trước.</p>
              <div className="honors-avatar-options">
                <label
                  className={
                    !draft.avatar && !draft.path && !photo ? 'selected' : ''
                  }
                >
                  <input
                    type="radio"
                    name="avatar"
                    value=""
                    checked={!draft.avatar && !draft.path && !photo}
                    onChange={() => choosePreset('')}
                  />
                  <span className="honors-initial">
                    {member.display_name.trim().split(' ').at(-1)?.[0]}
                  </span>
                  <strong>Chữ cái quen thuộc</strong>
                  <small>Hiền nhất trong hội.</small>
                </label>
                {AVATARS.map((a) => (
                  <label
                    key={a.key}
                    className={draft.avatar === a.key ? 'selected' : ''}
                  >
                    <input
                      type="radio"
                      name="avatar"
                      value={a.key}
                      checked={draft.avatar === a.key}
                      onChange={() => choosePreset(a.key)}
                    />
                    <img
                      src={avatarPath(a.key)}
                      alt=""
                      width="80"
                      height="80"
                    />
                    <strong>{a.name}</strong>
                    <small>{a.line}</small>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ) : (
          <p className="honors-readonly">
            Đây là bộ sưu tập của {member.display_name}. Xác minh đúng danh tính
            của bạn để đổi avatar của mình.{' '}
            <button type="button" className="text-btn" onClick={onVerify}>
              Xác minh thành viên
            </button>
          </p>
        )}
        <div
          role="tabpanel"
          id="honors-badges-panel"
          aria-labelledby="honors-badges-tab"
          hidden={editable && tab !== 'badges'}
        >
          <div className="honors-badges-heading">
            <h3>Bộ sưu tập huy hiệu</h3>
            {editable && (
              <label>
                <span className="sr-only">Huy hiệu ghim cạnh tên</span>
                <select
                  name="badge"
                  value={draft.badge}
                  disabled={blocked}
                  onChange={(e) =>
                    setDraft({ ...draft, badge: e.target.value })
                  }
                >
                  <option value="">Không ghim huy hiệu</option>
                  {earned.map((b) => (
                    <option value={b.key} key={b.key}>
                      {badgeInfo(b.key)?.emoji} {badgeInfo(b.key)?.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="honors-badge-grid">
            {BADGES.map((b) => {
              const progress = profile.badges.find((p) => p.key === b.key);
              const unlocked = !!progress?.earned;
              return (
                <article
                  className={`honors-badge-card tone-${b.color} ${unlocked ? 'earned' : 'locked'}`}
                  key={b.key}
                >
                  <span className="honors-badge-medal" aria-hidden="true">
                    {b.emoji}
                  </span>
                  <div>
                    <span className="honors-badge-state">
                      {unlocked ? (
                        <Check size={10} />
                      ) : (
                        <LockKeyhole size={10} />
                      )}
                      {unlocked ? 'ĐÃ MỞ KHÓA' : 'ĐANG CHINH PHỤC'}
                      {previewBadge === b.key && ' · ĐANG GHIM'}
                    </span>
                    <h4>{b.name}</h4>
                    <p className="honors-joke">{b.joke}</p>
                    <p>{b.criterion}</p>
                    <progress
                      max={progress?.target ?? 1}
                      value={Math.min(
                        progress?.progress ?? 0,
                        progress?.target ?? 1,
                      )}
                      aria-label={`Tiến độ ${b.name}`}
                    />
                    <small>
                      {progress?.progress ?? 0}/{progress?.target ?? 1} {b.unit}
                      {progress?.awarded_month
                        ? ` · Gần nhất ${monthLabel(progress.awarded_month)}`
                        : ''}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="honors-footnote">
            Ngày đăng ký được tính một lần dù có nhiều ca/sân. Đây là lịch sử
            đăng ký, chưa phải điểm danh tại sân. Hủy sân hoặc đổi đăng ký có
            thể làm thay đổi huy hiệu. Bình chọn tháng đang diễn ra chỉ là tạm
            thời.
          </p>
        </div>
        {editable && (
          <div className="honors-save-area">
            <p className="honors-save-hint">
              {photo
                ? 'Ảnh mới sẽ thay avatar sau khi lưu thành công.'
                : 'Chọn diện mạo, mang chất riêng vào hội.'}
            </p>
            {stale && (
              <p role="alert">
                {pinRevoked
                  ? 'Huy hiệu đang chọn không còn đủ điều kiện.'
                  : 'Diện mạo đã thay đổi trên thiết bị khác.'}{' '}
                <button className="text-btn" type="button" onClick={reset}>
                  Dùng bản mới
                </button>
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {club.memberHubError && (
              <p role="alert">
                Chưa cập nhật được diện mạo từ máy chủ. Lựa chọn của bạn vẫn
                còn.{' '}
                <button
                  type="button"
                  className="text-btn"
                  disabled={saving || club.loading || !club.online}
                  onClick={() => void club.reload()}
                >
                  Tải lại dữ liệu
                </button>
              </p>
            )}
            {!club.online && (
              <p role="status">
                Bạn đang ngoại tuyến. Các lựa chọn chưa được lưu.
              </p>
            )}
            <button
              className="btn btn-dark"
              type="submit"
              disabled={blocked || stale}
            >
              {saving ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Check size={17} />
              )}
              {saving ? 'Đang lưu…' : error ? 'Thử lưu lại' : 'Lưu diện mạo'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function VoteCard({
  category,
  hub,
  club,
  mine,
  onVerify,
}: {
  category: HonorCategory;
  hub: MemberHub;
  club: Club;
  mine: string | null;
  onVerify: () => void;
}) {
  const current = hub.mine.find((v) => v.category === category);
  const [draft, setDraft] = useState(() => ({
    nominee: current?.nominee_id ?? '',
    version: current?.version ?? 0,
    month: hub.month,
    actor: mine,
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const stale =
    draft.version !== (current?.version ?? 0) ||
    draft.month !== hub.month ||
    draft.actor !== mine;
  const blocked =
    saving || !club.online || club.saveState === 'saving' || !!club.error;
  const b = badgeInfo(category)!;
  const leaders = hub.votes
    .filter((v) => v.category === category)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 3);
  function reset() {
    setDraft({
      nominee: current?.nominee_id ?? '',
      version: current?.version ?? 0,
      month: hub.month,
      actor: mine,
    });
    setError('');
  }
  async function vote(e: FormEvent) {
    e.preventDefault();
    if (stale || blocked || !mine) return;
    setError('');
    setSaving(true);
    const ok = await club.run(
      async () => {
        try {
          await club.bookingRpc('vote_member_honor', {
            p_category: category,
            p_nominee: draft.nominee || null,
            p_month: draft.month,
            p_expected_version: draft.version,
          });
        } catch (e) {
          setError(message(e));
          throw e;
        }
      },
      draft.nominee
        ? 'Đã gửi hào quang cho đồng đội'
        : 'Đã rút phiếu bình chọn',
    );
    setSaving(false);
    if (!ok) setError((old) => old || 'Chưa gửi được phiếu. Hãy thử lại.');
    // Successful writes reload the hub. Keep a fresh baseline without discarding a failed draft.
    else setDraft((old) => ({ ...old, version: old.version + 1 }));
  }
  return (
    <article className={`honors-vote-card tone-${b.color}`}>
      <div className="honors-vote-title">
        <span className="honors-badge-medal" aria-hidden="true">
          {b.emoji}
        </span>
        <div>
          <h4>
            {category === 'comic' ? 'Cây hài của tháng' : 'Đồng đội dễ thương'}
          </h4>
          <p>
            {category === 'comic'
              ? 'Cầu rơi được, miếng hài không được rơi.'
              : 'Không cần gánh team, chỉ cần thương team.'}
          </p>
        </div>
      </div>
      <div className="honors-leaders" aria-label={`Kết quả tạm thời ${b.name}`}>
        <span className="honors-eyebrow">TẠM DẪN ĐẦU · CHƯA TRAO HUY HIỆU</span>
        {leaders.length ? (
          leaders.map((v) => {
            const m = club.members.find((m) => m.id === v.member_id);
            return (
              <div key={v.member_id}>
                <MemberAvatar id={v.member_id} name={m?.display_name ?? '?'} />
                <strong>{m?.display_name ?? 'Thành viên'}</strong>
                <span>{v.votes} phiếu</span>
              </div>
            );
          })
        ) : (
          <p>Ghế spotlight còn trống. Ai mở bát đây?</p>
        )}
      </div>
      {mine ? (
        <form onSubmit={(e) => void vote(e)}>
          <label>
            <span>Phiếu của bạn</span>
            <select
              aria-label={`Bình chọn ${b.name}`}
              value={draft.nominee}
              disabled={blocked || stale}
              onChange={(e) => setDraft({ ...draft, nominee: e.target.value })}
            >
              <option value="">Không bình chọn / rút phiếu</option>
              {club.members
                .filter((m) => m.active && m.id !== mine)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} · {m.code}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-outline"
            disabled={
              blocked || stale || draft.nominee === (current?.nominee_id ?? '')
            }
          >
            {saving ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {saving ? 'Đang gửi…' : draft.nominee ? 'Gửi phiếu' : 'Rút phiếu'}
          </button>
          {stale && (
            <p role="status">
              Phiếu hoặc danh tính đã thay đổi.{' '}
              <button type="button" className="text-btn" onClick={reset}>
                Dùng bản mới
              </button>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </form>
      ) : (
        <button className="btn btn-outline" onClick={onVerify}>
          <ShieldCheck size={15} />
          Xác minh để bình chọn
        </button>
      )}
    </article>
  );
}
