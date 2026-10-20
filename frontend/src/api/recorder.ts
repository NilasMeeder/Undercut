import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, type RecorderStatus } from './client';

const RECORDER_KEY = ['live', 'recorder'];

/** The live recorder: running or not, and the session it would record. */
export function useRecorder() {
  return useQuery({
    queryKey: RECORDER_KEY,
    queryFn: () => apiGet<RecorderStatus>('/live/recorder'),
    refetchInterval: 10_000,
  });
}

/** Start the recorder (`now`, `wait` for the next session, or `always`: every session) or stop it. */
export function useRecorderAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'now' | 'wait' | 'always' | 'stop') =>
      action === 'stop'
        ? apiSend<RecorderStatus>('DELETE', '/live/recorder')
        : apiSend<RecorderStatus>('POST', `/live/recorder?mode=${action}`),
    onSuccess: (status) => {
      client.setQueryData(RECORDER_KEY, status);
      void client.invalidateQueries({ queryKey: ['live'] });
    },
  });
}
