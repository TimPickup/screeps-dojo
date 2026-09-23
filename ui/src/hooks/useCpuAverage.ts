import { useEffect, useRef, useState } from 'react';
import type { Frame } from '../api/types';

export const CPU_AVERAGE_TICKS = 10;

// Main bot's CPU (ms) for the live run toolbar: the mean over the last
// CPU_AVERAGE_TICKS frames, since a single tick's figure jumps around too much
// to read. Frames with no CPU figure (the bot was skipped) are left out.
export function useCpuAverage(frame: Frame | null, running: boolean): { average: number | null; last: number | null } {
  const recent = useRef<number[]>([]);
  const [value, setValue] = useState<{ average: number | null; last: number | null }>({ average: null, last: null });

  useEffect(() => {
    if (!running) { recent.current = []; setValue({ average: null, last: null }); return; }
    const cpu = frame && typeof frame.cpu === 'number' ? frame.cpu : null;
    if (cpu === null) return;
    recent.current.push(cpu);
    if (recent.current.length > CPU_AVERAGE_TICKS) recent.current.shift();
    const sum = recent.current.reduce((total, each) => total + each, 0);
    setValue({ average: sum / recent.current.length, last: cpu });
  }, [frame, running]);

  return value;
}
