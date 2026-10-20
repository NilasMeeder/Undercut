import type { SessionCode, View } from '@/api/client';
import { useDashboards, type Workspace } from '@/store/dashboards';
import { GROUP_IDS, MAX_LAPS_PER_GROUP, sameLap } from '@/store/groups';
import { currentView, openView, type ViewLike } from './views';

/**
 * A dashboard shared as a link: everything a saved view keeps (session, laps per link group,
 * zoom, clock, layout) plus the workspace, as deflated JSON in the hash (#share=…). Nothing is
 * stored: the link is the whole thing, so it also opens on another computer running f1dash.
 */
export type Shared = ViewLike & { workspace: Workspace };

const SESSIONS: SessionCode[] = ['FP1', 'FP2', 'FP3', 'SQ', 'SS', 'S', 'Q', 'R'];

/** A real link is ~1.5 KB, its JSON a few times that. Anything far larger is not one of ours, and
 * deflate can blow a short link up a thousandfold. */
const MAX_LINK = 64 * 1024;
const MAX_JSON = 1024 * 1024;

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Infinity
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Too large');
    }
    chunks.push(read.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
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
  if (!match || match[1].length > MAX_LINK) return null;
  try {
    const json = await pipe(
      fromBase64Url(match[1]),
      new DecompressionStream('deflate-raw'),
      MAX_JSON
    );
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
    !Number.isInteger(v.year) ||
    !Number.isInteger(v.round) ||
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
      laps[group] = list
        .filter(
          (l): l is { driver: string; lap: number } =>
            typeof l?.driver === 'string' && /^[A-Z]{3}$/.test(l.driver) && Number.isInteger(l.lap)
        )
        .map(({ driver, lap }) => ({ driver, lap }))
        .filter((l, i, all) => all.findIndex((other) => sameLap(l, other)) === i)
        .slice(0, MAX_LAPS_PER_GROUP);
    const range = (state.zoom as Record<string, unknown> | undefined)?.[group];
    if (
      Array.isArray(range) &&
      range.length === 2 &&
      range.every(Number.isFinite) &&
      range[0] < range[1]
    )
      zoom[group] = [range[0] as number, range[1] as number];
  }
  return {
    name: typeof v.name === 'string' ? v.name.slice(0, 80) : 'Shared',
    year: v.year as number,
    round: v.round as number,
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
