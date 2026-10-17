import { useQuery } from '@tanstack/react-query';
import { apiGet, type SeasonEvents } from './client';

export function useSeasonEvents(year: number) {
  return useQuery({
    queryKey: ['season', year, 'events'],
    queryFn: () => apiGet<SeasonEvents>(`/seasons/${year}/events`),
    staleTime: 60 * 60 * 1000,
  });
}
