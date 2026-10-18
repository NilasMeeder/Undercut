/**
 * Windows of the app (a Pitwall on a second screen next to Analysis) share what is picked by
 * hand: the session and the laps per link group. Each window keeps its own clock, cursor and
 * zoom, and Follow moves laps per window (on its own clock), so that is not shared either.
 */

type Message = { kind: string; data: unknown };

const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('f1dash-sync');
const handlers = new Map<string, (data: unknown) => void>();
let applying = false;

/** Tell the other windows; not while applying what one of them said (no echo). */
export function share(kind: string, data: unknown) {
  if (!applying) channel?.postMessage({ kind, data } satisfies Message);
}

export function onShared<T>(kind: string, handler: (data: T) => void) {
  handlers.set(kind, handler as (data: unknown) => void);
}

if (channel) {
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    const handler = handlers.get(data.kind);
    if (!handler) return;
    applying = true;
    try {
      handler(data.data);
    } finally {
      applying = false;
    }
  };
}
