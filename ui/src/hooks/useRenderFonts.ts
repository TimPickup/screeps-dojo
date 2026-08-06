import { useEffect, useState } from 'react';
import { ensureRenderFonts } from '../canvas/renderFont';

export function useRenderFonts(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    ensureRenderFonts().then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return ready;
}
