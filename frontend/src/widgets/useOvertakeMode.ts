import { useMemo } from 'react';
import type { OvertakeCheck } from '@/api/client';
import { useOvertake, useStraightMode } from '@/api/queries';
import { hasOvertake, overtakeIndex } from '@/lib/overtake';

/**
 * Overtake mode (2026 races): a lookup of who has it at a moment, from the passages of the
 * detection line. Null while there is nothing to look up: not enabled, no lines on the FIA map,
 * positions not ready, or no passages.
 */
export function useOvertakeMode(
  enabled: boolean
): ((driver: string, t: number) => OvertakeCheck | null) | null {
  const lines = useStraightMode(enabled).data;
  const checks = useOvertake(enabled && lines?.overtake != null).data;
  return useMemo(() => {
    if (!checks || checks.checks.length === 0) return null;
    const index = overtakeIndex(checks);
    const on = lines?.overtake_enabled ?? [];
    return (driver, t) => hasOvertake(index, on, driver, t);
  }, [checks, lines]);
}
