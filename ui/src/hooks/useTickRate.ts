import { useEffect, useRef, useState } from 'react';
import { addTickSample, tickRate, type TickSample } from '../state/tickRate';

const REFRESH_MS = 250;

// Live ticks/second for the run toolbar: records when each tick arrived and
// re-reads the rolling rate a few times a second, so a stalled run visibly
// slows down between ticks rather than holding its last number.
export function useTickRate(tick: number, running: boolean): number | null {
  const samples = useRef<TickSample[]>([]);
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    if (running) addTickSample(samples.current, performance.now(), tick);
  }, [tick, running]);

  useEffect(() => {
    if (!running) { samples.current = []; setRate(null); return; }
    const timer = setInterval(() => setRate(tickRate(samples.current, performance.now())), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running]);

  return rate;
}
