import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { GroupId } from '@/store/groups';
import { WIDGETS_BY_ID } from '@/widgets/registry';

export type PanelParams = { group: GroupId };

const STORAGE_KEY = 'f1dash-layout-v1';

let counter = 0;
const newId = (widget: string) => `${widget}-${Date.now().toString(36)}-${counter++}`;

export function addWidget(
  api: DockviewApi,
  widget: string,
  group: GroupId,
  position?: Parameters<DockviewApi['addPanel']>[0]['position']
) {
  return api.addPanel<PanelParams>({
    id: newId(widget),
    component: widget,
    title: WIDGETS_BY_ID.get(widget)?.title ?? widget,
    params: { group },
    position,
  });
}

/** Preset: laps on the left, delta over telemetry in the middle, track map on the right. */
export function applyQualiDuel(api: DockviewApi) {
  api.clear();
  const laps = addWidget(api, 'laps', 'blue');
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: laps,
    direction: 'right',
  });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  laps.group.api.setSize({ width: 430 });
  map.group.api.setSize({ width: 380 });
  delta.group.api.setSize({ height: 170 });
}

export function saveLayout(api: DockviewApi) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
  } catch {
    // Storage full or blocked: the layout just won't survive a reload.
  }
}

/** Restore the saved layout; false if there is none or it no longer matches the widgets. */
export function restoreLayout(api: DockviewApi): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const layout = JSON.parse(raw) as SerializedDockview;
    const known = Object.values(layout.panels ?? {}).every((p) =>
      WIDGETS_BY_ID.has(p.contentComponent ?? '')
    );
    if (!known) return false;
    api.fromJSON(layout);
    return api.panels.length > 0;
  } catch {
    return false;
  }
}
