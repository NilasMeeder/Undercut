import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, apiGet, apiSend, type ArchiveDownload } from '@/api/client';
import { useLaps } from '@/api/queries';
import { HeaderMenu } from '@/dashboard/HeaderMenu';
import { cn } from '@/lib/utils';
import { sessionPath, useSessionKey } from '@/store/selection';

const action =
  'w-full border border-line-strong px-2 py-1 text-left hover:bg-raised disabled:opacity-40';

/** A session without data (not in the TracingInsights archive, not recorded): download it from
 * F1's own archive with the F1 TV sign-in. The backend turns it into a recording, after which the
 * session works like a recorded one. */
export function ArchiveMenu() {
  const key = useSessionKey();
  const laps = useLaps();
  const client = useQueryClient();
  const missing = laps.error instanceof ApiError && laps.error.status === 404;
  const queryKey = ['f1-archive', key];
  const status = useQuery({
    queryKey,
    queryFn: () => apiGet<ArchiveDownload>(`${sessionPath(key!)}/f1-archive`),
    enabled: key != null && missing,
    refetchInterval: (query) =>
      ['downloading', 'converting'].includes(query.state.data?.state ?? '') ? 1000 : false,
  });
  const start = useMutation({
    mutationFn: () => apiSend<ArchiveDownload>('POST', `${sessionPath(key!)}/f1-archive`),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const s = status.data;
  const ready = s?.state === 'ready';

  useEffect(() => {
    // Converted: every query of the session asks again (they had no data).
    if (ready) void client.invalidateQueries();
  }, [ready, client]);

  if (!missing || !s) return null;
  const busy = s.state === 'downloading' || s.state === 'converting';

  return (
    <HeaderMenu
      title="No data for this session: download it from F1"
      width="w-80"
      buttonClassName={cn(
        'flex h-5 shrink-0 items-center gap-1 whitespace-nowrap border px-1.5 text-[11px] font-semibold',
        s.state === 'error' ? 'border-pit text-pit' : 'border-line-strong text-dim hover:text-text'
      )}
      icon={busy ? `F1 ${Math.round(s.progress * 100)}%` : 'NO DATA'}
    >
      {() => (
        <div className="space-y-2 p-2">
          <div className="text-[10px] font-semibold tracking-wider text-dim">NO DATA</div>
          <p className="leading-snug text-text">
            This session is not in the archive f1dash uses (TracingInsights) and was not recorded.
          </p>
          {!s.offered ? (
            <p className="leading-snug text-dim">F1 has nothing for it before it has run.</p>
          ) : busy ? (
            <div className="space-y-1">
              <div className="h-1 bg-raised">
                <div className="h-1 bg-text" style={{ width: `${s.progress * 100}%` }} />
              </div>
              <p className="text-dim">{s.phase}…</p>
            </div>
          ) : s.signed_in ? (
            <>
              <button
                type="button"
                className={action}
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                Download from F1 with your F1 TV sign-in
              </button>
              <p className="text-[10px] leading-snug text-faint">
                From livetiming.formula1.com (the only place the sign-in goes). A race is a few
                hundred MB and takes a minute or two; it is kept like a recording.
              </p>
            </>
          ) : (
            <p className="leading-snug text-dim">
              F1&apos;s archive needs your F1 TV sign-in. Once, in{' '}
              <span className="font-mono">backend/</span>:{' '}
              <span className="select-all font-mono text-text">
                uv run python -m fastf1 auth f1tv --authenticate
              </span>
            </p>
          )}
          {s.error ? <p className="text-pit">{s.error}</p> : null}
          {start.error ? <p className="text-pit">{start.error.message}</p> : null}
        </div>
      )}
    </HeaderMenu>
  );
}
