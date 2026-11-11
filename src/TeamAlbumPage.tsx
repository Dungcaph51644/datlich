import React, { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  Cloud,
  ImagePlus,
  Images,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { Modal } from './Modal';
import { rpc } from './lib';
import {
  albumKinds,
  type AlbumKind,
  type AlbumPhoto,
  type TeamAlbum,
} from './albumTypes';
import { albumPhotoUrl } from './albumMedia';
import { useTeamAlbum } from './useTeamAlbum';
import { AlbumUploadDialog } from './AlbumUploadDialog';
import { AlbumLightbox } from './AlbumLightbox';
import { AlbumSpace as FloatingPhotos } from './AlbumSpace';
import { normalizeSearch } from './search';
import { navigateRoute, routeUrl, useAppRoute } from './navigation';
import { copyText } from './userActions';

type AlbumState = ReturnType<typeof useTeamAlbum>;
type Editor =
  | { type: 'album'; album?: TeamAlbum }
  | { type: 'photo'; photo: AlbumPhoto }
  | { type: 'delete-album'; album: TeamAlbum }
  | { type: 'delete-photo'; photo: AlbumPhoto }
  | null;
const dateLabel = (date: string | null) =>
  date
    ? new Date(`${date}T12:00:00+07:00`).toLocaleDateString('vi-VN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Khoảnh khắc của chúng mình';

export default function TeamAlbumPage({
  motionEnabled = true,
}: {
  motionEnabled?: boolean;
}) {
  const store = useTeamAlbum();
  return <TeamAlbumContent store={store} motionEnabled={motionEnabled} />;
}

export function TeamAlbumContent({ store, motionEnabled = true, photoUrl = albumPhotoUrl }: {
  store: AlbumState;
  motionEnabled?: boolean;
  photoUrl?: (path: string) => string;
}) {
  const [route] = useAppRoute();
  const [view, setView] = useState<'floating' | 'grid'>('floating');
  const selected = route.page === 'album' ? route.album ?? null : null;
  const [kind, setKind] = useState<AlbumKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const lightbox = route.page === 'album' ? route.photo ?? null : null;
  const [shareNotice, setShareNotice] = useState('');
  const [limit, setLimit] = useState(24);
  const albums = store.data?.albums ?? [];
  const photos = store.data?.photos ?? [];
  const activeAlbums = albums.filter((a) => !a.deleted_at);
  const activeIds = new Set(activeAlbums.map((a) => a.id));
  const activePhotos = photos.filter(
    (p) => !p.deleted_at && activeIds.has(p.album_id),
  );
  const album = activeAlbums.find((a) => a.id === selected);
  const shownAlbums = activeAlbums.filter(
    (a) =>
      (kind === 'all' || a.kind === kind) &&
      normalizeSearch(`${a.title} ${a.description}`).includes(normalizeSearch(query)),
  );
  const shownIds = new Set(shownAlbums.map((a) => a.id));
  const shownPhotos = activePhotos.filter((p) =>
    album ? p.album_id === album.id : shownIds.has(p.album_id),
  );
  const busy = store.saveState === 'saving';
  const disabled = !store.available || !store.online || busy;
  const trashCount =
    albums.filter((a) => a.deleted_at).length +
    photos.filter((p) => p.deleted_at && activeIds.has(p.album_id)).length;
  const linkedPhoto = lightbox ? activePhotos.find((photo) => photo.id === lightbox) : undefined;
  const linkError = !store.data || store.loading || store.error ? '' :
    selected && !album ? 'Album trong liên kết không tồn tại hoặc đã được chuyển vào Thùng rác.' :
    lightbox && !linkedPhoto ? 'Ảnh trong liên kết không tồn tại hoặc đã được chuyển vào Thùng rác.' :
    lightbox && album && linkedPhoto?.album_id !== album.id ? 'Ảnh trong liên kết không thuộc album này.' : '';

  function setSelected(id: string | null) {
    navigateRoute({ page: 'album', album: id ?? undefined, photo: undefined });
  }
  function setLightbox(id: string | null, replace = false) {
    const photo = id ? activePhotos.find((item) => item.id === id) : undefined;
    navigateRoute({ page: 'album', album: photo?.album_id ?? selected ?? undefined, photo: id ?? undefined }, { replace });
  }
  function photoLink(photo: AlbumPhoto) {
    return routeUrl({ page: 'album', album: photo.album_id, photo: photo.id });
  }
  async function shareAlbum(id: string) {
    try {
      await copyText(routeUrl({ page: 'album', album: id }));
      setShareNotice('Đã sao chép liên kết album. Bạn có thể gửi vào nhóm Zalo.');
    } catch {
      setShareNotice('Chưa sao chép được. Hãy mở album rồi sao chép địa chỉ trên trình duyệt.');
    }
  }

  useEffect(() => {
    setLimit(24);
  }, [selected, kind, query, trash]);
  useEffect(() => {
    if (selected || lightbox) {
      setTrash(false);
      setKind('all');
      setQuery('');
    }
  }, [selected, lightbox]);
  useEffect(() => {
    if (
      upload &&
      store.data &&
      !store.data.albums.some((a) => a.id === upload && !a.deleted_at)
    )
      setUpload(null);
  }, [upload, store.data]);

  function editPhoto(photo: AlbumPhoto) {
    setLightbox(null);
    setEditor({ type: 'photo', photo });
  }
  function trashPhoto(photo: AlbumPhoto) {
    setLightbox(null);
    setEditor({ type: 'delete-photo', photo });
  }
  async function restore(item: TeamAlbum | AlbumPhoto, photo = false) {
    await store.write(
      () =>
        rpc(photo ? 'set_team_album_photo_deleted' : 'set_team_album_deleted', {
          p_id: item.id,
          p_deleted: false,
          p_expected_version: item.version,
        }),
      photo ? 'Đã khôi phục ảnh' : 'Đã khôi phục album',
    );
  }

  return (
    <section className="team-album-page">
      <div className="album-topline">
        <span>
          <span className="album-live-dot" /> OUR SHARED MEMORIES
        </span>
        <div className="album-sync" role="status">
          {!store.online ? (
            <>
              <WifiOff size={14} /> Đang ngoại tuyến
            </>
          ) : busy ? (
            <>
              <LoaderCircle size={14} className="spin" /> Đang lưu…
            </>
          ) : store.saveState === 'error' ? (
            'Lưu thất bại'
          ) : store.error ? (
            'Album chưa kết nối'
          ) : store.saveState === 'saved' ? (
            <>
              <Check size={14} /> Đã lưu
            </>
          ) : store.connected ? (
            <>
              <Cloud size={14} /> Đang đồng bộ trực tiếp
            </>
          ) : store.available ? (
            store.data?.realtime_enabled ? (
              'Đang kết nối đồng bộ…'
            ) : (
              'Chưa bật đồng bộ trực tiếp'
            )
          ) : (
            'Đang kiểm tra kết nối…'
          )}
        </div>
      </div>
      <header className="album-heading">
        <div>
          <span className="album-eyebrow">CẦU LÔNG VÀ NHỮNG NGƯỜI BẠN</span>
          <h1>
            Chơi hết mình.
            <br />
            <span>Giữ từng khoảnh khắc.</span>
            <span className="album-title-spark" aria-hidden="true">
              ✳
            </span>
          </h1>
          <p>
            Trên sân, ngoài sân, và mọi chuyến đi cùng nhau.
            <br />
            Một góc nhỏ dành cho những kỷ niệm lớn.
          </p>
        </div>
        <div className="album-heading-aside">
          <span className="album-heading-mark" aria-hidden="true">
            <Camera strokeWidth={1} />
          </span>
          <div>
            <strong>{activePhotos.length.toString().padStart(2, '0')}</strong>
            <span>khoảnh khắc · {activeAlbums.length} album</span>
          </div>
          <button
            className="btn btn-dark"
            disabled={disabled}
            onClick={() => setEditor({ type: 'album' })}
          >
            <Plus size={18} /> Tạo album
          </button>
        </div>
      </header>
      {!store.online && (
        <div className="album-alert" role="alert">
          Bạn đang mất mạng. Có thể xem ảnh đã tải; thêm và sửa ảnh tạm dừng cho
          đến khi kết nối lại.
        </div>
      )}
      {store.data && !store.data.realtime_enabled && (
        <div className="album-alert" role="alert">
          Supabase chưa bật Realtime cho Album đội. Thay đổi đang được kiểm tra
          định kỳ; cần thêm bảng <code>team_album_sync</code> vào publication{' '}
          <code>supabase_realtime</code> để các thiết bị cập nhật ngay.
        </div>
      )}
      {!!store.notice && (
        <div
          className={`album-notice ${store.saveState === 'error' ? 'failed' : ''}`}
          role={store.saveState === 'error' ? 'alert' : 'status'}
        >
          {store.notice}
        </div>
      )}
      {shareNotice && <div className="album-notice" role="status">{shareNotice}</div>}
      {linkError && (
        <div className="album-alert" role="alert">
          <span>{linkError}</span>
          <button className="text-btn" onClick={() => setSelected(null)}>Về tất cả album</button>
        </div>
      )}
      {!!store.error && (
        <div className="album-setup" role="alert">
          <Cloud size={28} />
          <div>
            <strong>Album cần kết nối máy chủ</strong>
            <p>{store.error}</p>
            <p>
              Cấu hình: chạy migration <code>202611110001_team_album.sql</code>{' '}
              trong Supabase SQL Editor. Album dùng bucket{' '}
              <code>team-album</code> và Realtime riêng.
            </p>
            <button
              className="text-btn"
              disabled={!store.online}
              onClick={() => void store.reload()}
            >
              <RefreshCw size={15} /> Thử kết nối lại
            </button>
          </div>
        </div>
      )}
      <div className="album-toolbar">
        <div className="album-tabs" aria-label="Chế độ xem album">
          <button
            className={!trash && view === 'floating' ? 'active' : ''}
            onClick={() => {
              setTrash(false);
              setView('floating');
            }}
          >
            <Sparkles size={16} /> Ảnh bay
          </button>
          <button
            className={!trash && view === 'grid' ? 'active' : ''}
            onClick={() => {
              setTrash(false);
              setView('grid');
            }}
          >
            <LayoutGrid size={16} /> Dạng lưới
          </button>
        </div>
        <button
          className={`album-trash-link ${trash ? 'active' : ''}`}
          onClick={() => {
            setTrash(!trash);
            setSelected(null);
          }}
        >
          <Trash2 size={16} /> Thùng rác{' '}
          {trashCount > 0 && <span>{trashCount}</span>}
        </button>
      </div>
      {store.loading && !store.data && (
        <div className="album-empty" role="status">
          <LoaderCircle className="spin" />
          <h2>Đang mở những kỷ niệm…</h2>
        </div>
      )}
      {!store.loading && !trash && (
        <>
          {album && (
            <div className="album-detail-heading">
              <button className="album-back" onClick={() => setSelected(null)}>
                <ArrowLeft size={16} /> Tất cả album
              </button>
              <div className="album-detail-title">
                <div>
                  <span className="album-eyebrow">
                    {albumKinds[album.kind]} · {dateLabel(album.event_date)}
                  </span>
                  <h2>{album.title}</h2>
                  <p>
                    {album.description ||
                      'Cùng lưu lại những khoảnh khắc đáng nhớ.'}
                  </p>
                </div>
                <div className="album-inline-actions">
                  <button
                    className="icon-btn"
                    aria-label="Sao chép liên kết album"
                    title="Sao chép liên kết album"
                    onClick={() => void shareAlbum(album.id)}
                  >
                    <Link2 size={18} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Sửa album"
                    disabled={disabled}
                    onClick={() => setEditor({ type: 'album', album })}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Xóa album"
                    disabled={disabled}
                    onClick={() => setEditor({ type: 'delete-album', album })}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    className="btn btn-dark"
                    disabled={disabled}
                    onClick={() => setUpload(album.id)}
                  >
                    <ImagePlus size={17} /> Thêm ảnh
                  </button>
                </div>
              </div>
            </div>
          )}
          {!album && (
            <div className="album-filters">
              <div className="album-categories">
                {(
                  ['all', ...Object.keys(albumKinds)] as (AlbumKind | 'all')[]
                ).map((k) => (
                  <button
                    key={k}
                    className={kind === k ? 'active' : ''}
                    onClick={() => setKind(k)}
                  >
                    {k === 'all' ? 'Tất cả' : albumKinds[k]}
                  </button>
                ))}
              </div>
              <label className="album-search">
                <Search size={16} />
                <input
                  aria-label="Tìm album"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm một kỷ niệm…"
                />
              </label>
            </div>
          )}
          {view === 'floating' && shownPhotos.length > 0 && (
            <FloatingPhotos
              photos={shownPhotos}
              enabled={motionEnabled && !lightbox && !editor && !upload}
              onOpen={setLightbox}
              photoUrl={photoUrl}
            />
          )}
          {view === 'floating' && shownPhotos.length > 0 && (
            <div className="album-stage-caption">
              <span>Mỗi tấm ảnh, một câu chuyện.</span>
              <button
                onClick={() =>
                  document.getElementById('album-collection')?.scrollIntoView({
                    behavior: motionEnabled ? 'smooth' : 'instant',
                  })
                }
              >
                Khám phá bộ sưu tập <ArrowDown size={14} />
              </button>
            </div>
          )}
          <div id="album-collection" className="album-collection-heading">
            <div>
              <span className="album-eyebrow">THE GOOD TIMES, TOGETHER</span>
              <h2>
                {album ? 'Những khoảnh khắc' : 'Bộ sưu tập của đội'}
                <sup>{album ? shownPhotos.length : shownAlbums.length}</sup>
              </h2>
            </div>
            <span className="album-public-note">
              Album chung · Mọi người cùng góp ảnh
            </span>
          </div>
          {!album ? (
            <div className="album-card-grid">
              {shownAlbums.slice(0, limit).map((a) => {
                const items = activePhotos.filter((p) => p.album_id === a.id);
                const cover =
                  items.find((p) => p.id === a.cover_photo_id) ?? items[0];
                return (
                  <article className="album-card" key={a.id}>
                    <button
                      className="album-card-open"
                      onClick={() => {
                        setSelected(a.id);
                        setLimit(24);
                      }}
                    >
                      <div className="album-card-cover">
                        {cover ? (
                          <img
                            src={photoUrl(cover.thumbnail_path)}
                            alt={a.title}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="album-cover-placeholder">
                            <Images size={40} strokeWidth={1} />
                            <span>Chờ những bức ảnh đầu tiên</span>
                          </div>
                        )}
                        <span className="album-card-count">
                          <Images size={13} /> {items.length} ảnh
                        </span>
                        <span className="album-card-arrow">
                          <ArrowUpRight size={23} />
                        </span>
                      </div>
                      <div className="album-card-info">
                        <span>
                          {albumKinds[a.kind]} <i>·</i>{' '}
                          {a.event_date
                            ? new Date(
                                `${a.event_date}T12:00:00`,
                              ).toLocaleDateString('vi-VN')
                            : 'Kỷ niệm của đội'}
                        </span>
                        <h3>{a.title}</h3>
                        <p>
                          {a.description || 'Một phần thanh xuân, lưu ở đây.'}
                        </p>
                      </div>
                    </button>
                    <div className="album-card-actions">
                      <button
                        disabled={disabled}
                        onClick={() => setUpload(a.id)}
                      >
                        <Upload size={14} /> Góp ảnh
                      </button>
                      <div>
                        <button
                          aria-label={`Sửa album ${a.title}`}
                          disabled={disabled}
                          onClick={() => setEditor({ type: 'album', album: a })}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={`Xóa album ${a.title}`}
                          disabled={disabled}
                          onClick={() =>
                            setEditor({ type: 'delete-album', album: a })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {store.available && !query && kind === 'all' && (
                <button
                  className="album-create-card"
                  disabled={disabled}
                  onClick={() => setEditor({ type: 'album' })}
                >
                  <span>
                    <Plus size={28} />
                  </span>
                  <strong>Thêm một câu chuyện mới</strong>
                  <p>Tạo album rồi góp ảnh từ điện thoại.</p>
                </button>
              )}
            </div>
          ) : (
            <div className="album-photo-grid">
              {shownPhotos.slice(0, limit).map((p) => (
                <article className="album-photo-card" key={p.id}>
                  <button
                    className="album-photo-open"
                    onClick={() => setLightbox(p.id)}
                  >
                    <img
                      src={photoUrl(p.thumbnail_path)}
                      alt={p.caption || p.filename}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="album-photo-expand">
                      <ArrowUpRight size={18} />
                    </span>
                  </button>
                  <div className="album-photo-info">
                    <p>{p.caption || 'Một khoảnh khắc đáng nhớ'}</p>
                    <div>
                      <button
                        className="icon-btn"
                        aria-label={`Sửa chú thích ${p.filename}`}
                        disabled={disabled}
                        onClick={() => editPhoto(p)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Xóa ảnh ${p.filename}`}
                        disabled={disabled}
                        onClick={() => trashPhoto(p)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {store.available &&
            (album ? shownPhotos.length : shownAlbums.length) > limit && (
              <button
                className="btn album-load-more"
                onClick={() => setLimit((n) => n + 24)}
              >
                Xem thêm {album ? 'ảnh' : 'album'} <Plus size={15} />
              </button>
            )}
          {store.available &&
            (album ? !shownPhotos.length : !shownAlbums.length) && (
              <div className="album-empty">
                <Camera size={36} strokeWidth={1} />
                <h2>
                  {query || kind !== 'all'
                    ? 'Chưa có album phù hợp'
                    : album
                      ? 'Album đang chờ những tấm ảnh đầu tiên'
                      : 'Kỷ niệm bắt đầu từ một tấm ảnh'}
                </h2>
                <p>
                  {album
                    ? 'Chọn nhiều ảnh từ thư viện hoặc kéo thả để cả nhóm cùng xem.'
                    : 'Tạo album, thêm ảnh và cùng giữ lại những lần lên sân, đi chơi.'}
                </p>
                <button
                  className="btn btn-dark"
                  disabled={disabled}
                  onClick={() =>
                    album ? setUpload(album.id) : setEditor({ type: 'album' })
                  }
                >
                  <Plus size={16} /> {album ? 'Thêm ảnh' : 'Tạo album đầu tiên'}
                </button>
              </div>
            )}
        </>
      )}
      {trash && (
        <section className="album-trash">
          <div className="album-collection-heading">
            <div>
              <span className="album-eyebrow">CÓ THỂ KHÔI PHỤC</span>
              <h2>
                Thùng rác<sup>{trashCount}</sup>
              </h2>
            </div>
          </div>
          <p className="album-trash-explainer">
            Khôi phục album sẽ đưa các ảnh của album trở lại. Ảnh đã xóa riêng
            vẫn nằm trong thùng rác. Các tệp đã tải lên được giữ để có thể khôi
            phục.
          </p>
          <div className="album-trash-list">
            {albums
              .filter((a) => a.deleted_at)
              .map((a) => (
                <div className="album-trash-row" key={a.id}>
                  <Images size={26} />
                  <div>
                    <strong>{a.title}</strong>
                    <p>
                      Album ·{' '}
                      {
                        photos.filter(
                          (p) => p.album_id === a.id && !p.deleted_at,
                        ).length
                      }{' '}
                      ảnh · Xóa{' '}
                      {new Date(a.deleted_at!).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <button
                    className="btn btn-light"
                    disabled={disabled}
                    onClick={() => void restore(a)}
                  >
                    <Undo2 size={16} /> Khôi phục
                  </button>
                </div>
              ))}
            {photos
              .filter((p) => p.deleted_at && activeIds.has(p.album_id))
              .slice(0, limit)
              .map((p) => (
                <div className="album-trash-row" key={p.id}>
                  <img
                    src={photoUrl(p.thumbnail_path)}
                    alt=""
                    loading="lazy"
                  />
                  <div>
                    <strong>{p.caption || p.filename}</strong>
                    <p>
                      Ảnh trong{' '}
                      {activeAlbums.find((a) => a.id === p.album_id)?.title}
                    </p>
                  </div>
                  <button
                    className="btn btn-light"
                    disabled={disabled}
                    onClick={() => void restore(p, true)}
                  >
                    <Undo2 size={16} /> Khôi phục
                  </button>
                </div>
              ))}
          </div>
          {photos.filter((p) => p.deleted_at && activeIds.has(p.album_id))
            .length > limit && (
            <button
              className="btn album-load-more"
              onClick={() => setLimit((n) => n + 24)}
            >
              Xem thêm ảnh đã xóa
            </button>
          )}
          {!trashCount && (
            <div className="album-empty">
              <Trash2 size={32} />
              <h2>Thùng rác đang trống</h2>
              <p>Ảnh và album đã xóa sẽ xuất hiện ở đây.</p>
            </div>
          )}
        </section>
      )}
      <footer className="album-footer">
        <img src="/shuttle.svg" alt="" />
        <span>Những người bạn. Những khoảnh khắc.</span>
        <span>PLAY TOGETHER. STAY TOGETHER.</span>
      </footer>

      {editor?.type === 'album' && (
        <AlbumEditor
          key={
            editor.album ? `${editor.album.id}-${editor.album.version}` : 'new'
          }
          album={editor.album}
          photos={activePhotos}
          store={store}
          onClose={() => setEditor(null)}
          onCreated={(id) => {
            setEditor(null);
            setSelected(id);
            setTrash(false);
            setUpload(id);
          }}
          onRefresh={() => {
            const fresh = albums.find((a) => a.id === editor.album?.id);
            if (
              fresh &&
              window.confirm(
                'Tải lại bản mới nhất? Nội dung đang nhập trong cửa sổ này sẽ được thay bằng dữ liệu máy chủ.',
              )
            )
              setEditor({ type: 'album', album: fresh });
          }}
        />
      )}
      {editor?.type === 'photo' && (
        <PhotoEditor
          key={`${editor.photo.id}-${editor.photo.version}`}
          photo={editor.photo}
          store={store}
          onClose={() => setEditor(null)}
          onRefresh={() => {
            const fresh = photos.find((p) => p.id === editor.photo.id);
            if (
              fresh &&
              window.confirm(
                'Tải lại chú thích mới nhất? Bản nháp đang nhập sẽ được thay bằng dữ liệu máy chủ.',
              )
            )
              setEditor({ type: 'photo', photo: fresh });
          }}
        />
      )}
      {(editor?.type === 'delete-album' || editor?.type === 'delete-photo') && (
        <Modal
          title={
            editor.type === 'delete-album'
              ? 'Chuyển album vào Thùng rác?'
              : 'Chuyển ảnh vào Thùng rác?'
          }
          locked={busy}
          onClose={() => setEditor(null)}
        >
          <div className="album-form">
            <p>
              {editor.type === 'delete-album'
                ? `Album “${editor.album.title}” và ảnh bên trong sẽ được ẩn khỏi bộ sưu tập.`
                : 'Ảnh sẽ được ẩn khỏi album.'}{' '}
              Bạn có thể khôi phục từ Thùng rác.
            </p>
            <div className="album-form-actions">
              <button
                className="btn btn-light"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Giữ lại
              </button>
              <button
                className="btn btn-dark"
                disabled={disabled}
                onClick={async () => {
                  const isAlbum = editor.type === 'delete-album';
                  const item = isAlbum ? editor.album : editor.photo;
                  if (
                    await store.write(
                      () =>
                        rpc(
                          isAlbum
                            ? 'set_team_album_deleted'
                            : 'set_team_album_photo_deleted',
                          {
                            p_id: item.id,
                            p_deleted: true,
                            p_expected_version: item.version,
                          },
                        ),
                      'Đã chuyển vào Thùng rác',
                    )
                  )
                    setEditor(null);
                }}
              >
                <Trash2 size={16} />{' '}
                {busy ? 'Đang chuyển…' : 'Chuyển vào Thùng rác'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {upload && (
        <AlbumUploadDialog
          albumId={upload}
          albums={activeAlbums}
          online={store.online}
          write={store.write}
          onClose={() => setUpload(null)}
          onUploaded={() => void store.reload()}
        />
      )}
      {lightbox && linkedPhoto && !linkError && shownPhotos.some((photo) => photo.id === lightbox) && (
        <AlbumLightbox
          photos={shownPhotos}
          initialId={lightbox}
          photoUrl={photoUrl}
          onClose={() => setLightbox(null)}
          onPhotoChange={(id) => setLightbox(id, true)}
          onShare={(photo) => copyText(photoLink(photo))}
          onEdit={editPhoto}
          onTrash={trashPhoto}
          online={store.online && !busy}
        />
      )}
    </section>
  );
}

function AlbumEditor({
  album,
  photos,
  store,
  onClose,
  onRefresh,
  onCreated,
}: {
  album?: TeamAlbum;
  photos: AlbumPhoto[];
  store: AlbumState;
  onClose: () => void;
  onRefresh: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState(album?.title ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const [date, setDate] = useState(album?.event_date ?? '');
  const [kind, setKind] = useState<AlbumKind>(album?.kind ?? 'badminton');
  const [cover, setCover] = useState(album?.cover_photo_id ?? '');
  const busy = store.saveState === 'saving';
  const remote = store.data?.albums.find((a) => a.id === album?.id);
  const stale = !!album && !!remote && remote.version !== album.version;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = album
      ? {}
      : { title: title.trim(), description, event_date: date || null, kind };
    if (album) {
      if (title.trim() !== album.title) patch.title = title.trim();
      if (description !== album.description) patch.description = description;
      if ((date || null) !== album.event_date) patch.event_date = date || null;
      if (kind !== album.kind) patch.kind = kind;
      if ((cover || null) !== album.cover_photo_id)
        patch.cover_photo_id = cover || null;
    }
    if (album && !Object.keys(patch).length) {
      onClose();
      return;
    }
    let confirmed: TeamAlbum | undefined;
    if (
      await store.write(
        async () => {
          confirmed = await rpc<TeamAlbum>('save_team_album', {
            p_id: album?.id ?? null,
            p_patch: patch,
            p_expected_version: album?.version ?? null,
          });
        },
        album ? 'Đã cập nhật album' : 'Đã tạo album. Bạn có thể thêm ảnh ngay.',
      )
    ) {
      if (!album && confirmed) onCreated(confirmed.id);
      else onClose();
    }
  }
  return (
    <Modal
      title={album ? 'Chỉnh sửa album' : 'Một câu chuyện mới'}
      locked={busy}
      onClose={onClose}
    >
      <form className="album-form" onSubmit={submit}>
        <label>
          Tên album
          <input
            name="album-title"
            required
            autoFocus
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Một chiều lên sân cùng đội"
          />
        </label>
        <div className="album-form-pair">
          <label>
            Loại album
            <select
              name="album-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AlbumKind)}
            >
              {Object.entries(albumKinds).map(([k, text]) => (
                <option key={k} value={k}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ngày kỷ niệm
            <input
              name="album-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label>
          Mô tả
          <textarea
            name="album-description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Chuyện gì đã khiến ngày hôm đó đặc biệt?"
          />
        </label>
        {album && (
          <label>
            Ảnh bìa
            <select name="album-cover" value={cover} onChange={(e) => setCover(e.target.value)}>
              <option value="">Tự chọn từ ảnh trong album</option>
              {photos
                .filter((p) => p.album_id === album.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.caption || p.filename}
                  </option>
                ))}
            </select>
          </label>
        )}
        {stale && (
          <div className="album-alert" role="alert">
            Album vừa được người khác thay đổi. Bản nháp của bạn vẫn ở đây.{' '}
            <button type="button" className="text-btn" onClick={onRefresh}>
              Xem bản mới nhất
            </button>
          </div>
        )}
        <p className="album-form-help">
          Mọi người đều có thể quản lý album chung. Ảnh được thêm bằng file sau
          khi tạo album.
        </p>
        <div className="album-form-actions">
          <button
            type="button"
            className="btn btn-light"
            disabled={busy}
            data-modal-close
            onClick={onClose}
          >
            Để sau
          </button>
          <button
            className="btn btn-dark"
            disabled={busy || !store.online || stale || !title.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{' '}
            {busy ? 'Đang lưu…' : album ? 'Lưu thay đổi' : 'Tạo và thêm ảnh'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoEditor({
  photo,
  store,
  onClose,
  onRefresh,
}: {
  photo: AlbumPhoto;
  store: AlbumState;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption);
  const busy = store.saveState === 'saving';
  const remote = store.data?.photos.find((p) => p.id === photo.id);
  const stale = !!remote && remote.version !== photo.version;
  return (
    <Modal title="Chú thích khoảnh khắc" locked={busy} onClose={onClose}>
      <form
        className="album-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (caption === photo.caption) {
            onClose();
            return;
          }
          if (
            await store.write(
              () =>
                rpc('save_team_album_photo', {
                  p_id: photo.id,
                  p_patch: { caption },
                  p_expected_version: photo.version,
                }),
              'Đã lưu chú thích',
            )
          )
            onClose();
        }}
      >
        <img
          className="album-caption-preview"
          src={albumPhotoUrl(photo.thumbnail_path)}
          alt="Ảnh đang sửa chú thích"
        />
        <label>
          Chú thích
          <textarea
            name="photo-caption"
            autoFocus
            rows={3}
            maxLength={2000}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Thêm một câu chuyện cho tấm ảnh…"
          />
        </label>
        {stale && (
          <div className="album-alert" role="alert">
            Chú thích đã được sửa trên thiết bị khác. Nội dung đang nhập của bạn
            chưa bị thay đổi.
            <blockquote>{remote?.caption || '(Không có chú thích)'}</blockquote>
            <button type="button" className="text-btn" onClick={onRefresh}>
              Tải bản mới nhất để chỉnh sửa
            </button>
          </div>
        )}
        <div className="album-form-actions">
          <button
            type="button"
            className="btn btn-light"
            disabled={busy}
            data-modal-close
            onClick={onClose}
          >
            Đóng
          </button>
          <button
            className="btn btn-dark"
            disabled={busy || !store.online || stale}
          >
            {busy ? 'Đang lưu…' : 'Lưu chú thích'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
