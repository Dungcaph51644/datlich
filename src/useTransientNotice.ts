import { useCallback, useEffect, useState } from 'react';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** A new occurrence gets its own lifetime, even when the text is unchanged. */
export function useTransientNotice(saveState: SaveState) {
  const [current, setCurrent] = useState({ text: '', revision: 0 });
  const setNotice = useCallback((text: string) => {
    setCurrent((previous) => ({ text, revision: previous.revision + 1 }));
  }, []);
  const failed = saveState === 'failed';

  useEffect(() => {
    if (!current.text) return;
    const revision = current.revision;
    const timer = setTimeout(
      () => {
        setCurrent((latest) =>
          latest.revision === revision ? { ...latest, text: '' } : latest,
        );
      },
      failed ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [current.revision, current.text, failed]);

  return { notice: current.text, setNotice };
}
