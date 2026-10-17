import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, type View, type ViewIn } from './client';

const VIEWS_KEY = ['views'];

/** Saved views of every session, most recently saved first. */
export function useViews() {
  return useQuery({ queryKey: VIEWS_KEY, queryFn: () => apiGet<View[]>('/views') });
}

export function useSaveView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, view }: { id?: number; view: ViewIn }) =>
      id == null
        ? apiSend<View>('POST', '/views', view)
        : apiSend<View>('PUT', `/views/${id}`, view),
    onSuccess: () => void client.invalidateQueries({ queryKey: VIEWS_KEY }),
  });
}

export function useDeleteView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiSend<void>('DELETE', `/views/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: VIEWS_KEY }),
  });
}
