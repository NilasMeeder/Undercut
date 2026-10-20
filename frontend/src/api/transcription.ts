import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionPath, useSessionKey } from '@/store/selection';
import { apiGet, apiSend, type Transcription } from './client';

/** Transcribing the session's team radio on this computer (Whisper): set up, how far. While it
 * runs, the clips are asked again as texts come in. */
export function useTranscription(enabled: boolean) {
  const key = useSessionKey();
  const client = useQueryClient();
  const queryKey = ['transcription', key];
  const status = useQuery({
    queryKey,
    queryFn: () => apiGet<Transcription>(`${sessionPath(key!)}/team-radio/transcription`),
    enabled: key != null && enabled,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 2000 : false),
  });
  const done = status.data?.done;
  useEffect(() => {
    if (done != null && done > 0) {
      void client.invalidateQueries({ queryKey: ['session', key, '/team-radio'] });
    }
  }, [done, key, client]);
  const start = useMutation({
    mutationFn: () =>
      apiSend<Transcription>('POST', `${sessionPath(key!)}/team-radio/transcription`),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  return { status, start };
}
