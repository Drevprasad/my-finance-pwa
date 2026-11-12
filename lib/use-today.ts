'use client';

import { useEffect, useState } from 'react';
import { toISODate } from './dates';

/**
 * Local "today" as YYYY-MM-DD, or null until mounted.
 * null on the first render is what keeps prerendering safe; the value is only
 * ever produced inside an effect. Also rolls over at local midnight and on
 * tab re-focus, so a PWA left open overnight stays correct.
 */
export function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const next = toISODate(new Date());
      // identical value => React bails out, so no needless re-renders
      setToday(prev => (prev === next ? prev : next));
    };

    tick();
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return today;
}