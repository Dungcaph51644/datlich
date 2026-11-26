import { createContext, useContext, useState, type ReactNode } from 'react';
import { avatarPath, type MemberHub } from './memberHonors';
import { memberAvatarUrl } from './memberAvatarUpload';

const MemberStyles = createContext<MemberHub | null>(null);
export function MemberStyleProvider({
  hub,
  children,
}: {
  hub: MemberHub | null;
  children: ReactNode;
}) {
  return <MemberStyles.Provider value={hub}>{children}</MemberStyles.Provider>;
}
export function MemberAvatar({
  id,
  name,
  className = '',
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const hub = useContext(MemberStyles);
  const profile = hub?.profiles.find((p) => p.member_id === id);
  const src =
    memberAvatarUrl(profile?.avatar_path) ||
    avatarPath(profile?.avatar_key ?? '');
  const [failedSrc, setFailedSrc] = useState('');
  return (
    <span className={`avatar honor-avatar ${className}`} aria-hidden="true">
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt=""
          width="48"
          height="48"
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        name.trim().split(' ').at(-1)?.[0]
      )}
    </span>
  );
}
