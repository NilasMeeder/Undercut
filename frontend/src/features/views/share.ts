import type { SessionCode, View } from '@/api/client';
import { useDashboards, type Workspace } from '@/store/dashboards';
import { GROUP_IDS } from '@/store/groups';
import { currentView, openView, type ViewLike } from './views';

/**
 * A dashboard shared as a link: everything a saved view keeps (session, laps per link group,
 * zoom, clock, layout) plus the workspace, as deflated JSON in the hash (#share=…). Nothing is
 * stored: the link is the whole thing, so it also opens on another computer running f1dash.
 */
export type Shared = ViewLike & { workspace: Workspace };

const SESSIONS: SessionCode[] = ['FP1', 'FP2', 'FP3', 'SQ', 'SS', 'S', 'Q', 'R'];

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

export async function encodeShare(shared: Shared): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shared));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The shared dashboard in a hash, or null when it is not one or does not read (a link pasted
 * half, or from another version). */
export async function decodeShare(hash: string): Promise<Shared | null> {
  const match = /^#share=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  try {
    const json = await pipe(fromBase64Url(match[1]), new DecompressionStream('deflate-raw'));
    return valid(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** Only what a share can hold, checked field by field: the link comes from outside. */
function valid(value: unknown): Shared | null {
  if (typeof value !== 'object' || value == null) return null;
  const v = value as Record<string, unknown>;
  const state = v.state as Record<string, unknown> | undefined;
  if (
    typeof v.year !== 'number' ||
    typeof v.round !== 'number' ||
    !SESSIONS.includes(v.session as SessionCode) ||
    typeof state !== 'object' ||
    state == null
  )
    return null;
  const laps: View['state']['laps'] = {};
  const zoom: View['state']['zoom'] = {};
  for (const group of GROUP_IDS) {
    const list = (state.laps as Record<string, unknown> | undefined)?.[group];
    if (Array.isArray(list))
      laps[group] = list.filter(
        (l): l is { driver: string; lap: number } =>
          typeof l?.driver === 'string' && /^[A-Z]{3}$/.test(l.driver) && Number.isInteger(l.lap)
      );
    const range = (state.zoom as Record<string, unknown> | undefined)?.[group];
    if (Array.isArray(range) && range.length === 2 && range.every(Number.isFinite))
      zoom[group] = [range[0] as number, range[1] as number];
  }
  return {
    name: typeof v.name === 'string' ? v.name.slice(0, 80) : 'Shared',
    year: v.year,
    round: v.round,
    session: v.session as SessionCode,
    workspace: v.workspace === 'pitwall' ? 'pitwall' : 'analysis',
    state: {
      laps,
      zoom,
      clock: Number.isFinite(state.clock) ? (state.clock as number) : null,
      layout: typeof state.layout === 'object' ? (state.layout as View['state']['layout']) : null,
      preset: typeof state.preset === 'string' ? state.preset : null,
    },
  };
}

/** A link to this window's dashboard as it is now. */
export async function shareLink(session: Parameters<typeof currentView>[1]): Promise<string> {
  const { tabs, active, workspace } = useDashboards.getState();
  const name = tabs.find((t) => t.id === active)?.name ?? 'Shared';
  const shared: Shared = { ...currentView(name, session), workspace };
  return `${location.origin}${location.pathname}#share=${await encodeShare(shared)}`;
}

/** Copy that link to the clipboard (and return it). */
export async function copyShareLink(session: Parameters<typeof currentView>[1]): Promise<string> {
  const link = await shareLink(session);
  await navigator.clipboard?.writeText(link).catch(() => undefined);
  return link;
}

/** Open a shared dashboard: its workspace first (that moves the clock), then the view. */
export function openShared(shared: Shared) {
  useDashboards.getState().setWorkspace(shared.workspace);
  openView(shared);
}
