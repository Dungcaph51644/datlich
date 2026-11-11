export type AlbumKind = 'badminton' | 'travel' | 'meetup' | 'other';
export const albumKinds: Record<AlbumKind, string> = {
  badminton: 'Cầu lông',
  travel: 'Du lịch',
  meetup: 'Gặp mặt',
  other: 'Khác',
};
export interface TeamAlbum {
  id: string;
  title: string;
  description: string;
  event_date: string | null;
  kind: AlbumKind;
  cover_photo_id: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface AlbumPhoto {
  id: string;
  album_id: string;
  original_path: string;
  thumbnail_path: string;
  original_mime: string;
  original_size: number;
  width: number;
  height: number;
  filename: string;
  caption: string;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TeamAlbumSnapshot {
  version: 1;
  revision: number;
  realtime_enabled: boolean;
  albums: TeamAlbum[];
  photos: AlbumPhoto[];
}
