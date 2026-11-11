import { supabase } from './lib';

/** Persistent public Storage URL; callers use thumbnail_path until opening a photo. */
export function albumPhotoUrl(path: string) {
  if (!supabase || !path || path.startsWith('/') || path.includes('..'))
    return '';
  return supabase.storage.from('team-album').getPublicUrl(path).data.publicUrl;
}
