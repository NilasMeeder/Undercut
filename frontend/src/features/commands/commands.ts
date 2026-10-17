import type { DockviewApi } from 'dockview-react';
import type { Lap } from '@/api/client';
import { addWidget, applyPreset, PRESETS } from '@/dashboard/layout';
import { earlierLap, stepDriver, stepLap } from '@/lib/laps';
import { bestLaps } from '@/lib/timing';
import { clock } from '@/store/clock';
import { cursorBus } from '@/store/cursor';
import { useGroups, type GroupId, type LapRef } from '@/store/groups';
import { WIDGETS } from '@/widgets/registry';

export type Command = {
  id: string;
  section: string;
  title: string;
  /** Single-key shortcut, as KeyboardEvent.key. */
  key?: string;
  /** How the palette shows the key, when not the key itself (Space, arrows). */
  keyLabel?: string;
  run: () => void;
};

export type CommandContext = {
  api: DockviewApi | null;
  group: GroupId;
  laps: Lap[];
};

/** Every command, for the palette and the shortcuts. Lap commands act on the last selected lap. */
export function buildCommands({ api, group, laps }: CommandContext): Command[] {
  const groups = useGroups.getState;
  const selected = () => groups().laps[group];
  const last = () => selected().at(-1);
  const swap = (to: LapRef | null) => {
    const from = last();
    if (from && to) groups().replaceLap(group, from, to);
  };

  const commands: Command[] = [
    {
      id: 'lap-prev',
      section: 'Laps',
      title: 'Previous attempt of this driver',
      key: '[',
      run: () => {
        const from = last();
        if (from) swap(stepLap(laps, from, -1));
      },
    },
    {
      id: 'lap-next',
      section: 'Laps',
      title: 'Next attempt of this driver',
      key: ']',
      run: () => {
        const from = last();
        if (from) swap(stepLap(laps, from, 1));
      },
    },
    {
      id: 'driver-prev',
      section: 'Laps',
      title: 'Driver above in the classification (best lap)',
      key: ',',
      run: () => {
        const from = last();
        if (from) swap(stepDriver(laps, from, -1));
      },
    },
    {
      id: 'driver-next',
      section: 'Laps',
      title: 'Driver below in the classification (best lap)',
      key: '.',
      run: () => {
        const from = last();
        if (from) swap(stepDriver(laps, from, 1));
      },
    },
    {
      id: 'overlay-earlier',
      section: 'Laps',
      title: 'Overlay an earlier attempt of this driver',
      key: 'o',
      run: () => {
        const from = last();
        const lap = from && earlierLap(laps, selected(), from.driver);
        if (lap) groups().toggleLap(group, lap);
      },
    },
    {
      id: 'clear',
      section: 'Laps',
      title: 'Clear the laps of this group',
      run: () => groups().setLaps(group, []),
    },
    {
      id: 'freeze',
      section: 'View',
      title: 'Freeze or release the cursor',
      key: 'f',
      run: () => cursorBus.toggleFrozen(group),
    },
    {
      id: 'reset-zoom',
      section: 'View',
      title: 'Reset zoom',
      key: 'z',
      run: () => cursorBus.setZoom(group, null),
    },
    {
      id: 'clock-toggle',
      section: 'Clock',
      title: 'Play or pause the session',
      key: ' ',
      keyLabel: 'Space',
      run: () => clock.toggle(),
    },
    {
      id: 'clock-back',
      section: 'Clock',
      title: 'Back 10 seconds',
      key: 'ArrowLeft',
      keyLabel: '←',
      run: () => clock.seek(clock.time() - 10),
    },
    {
      id: 'clock-forward',
      section: 'Clock',
      title: 'Forward 10 seconds',
      key: 'ArrowRight',
      keyLabel: '→',
      run: () => clock.seek(clock.time() + 10),
    },
    {
      id: 'clock-slower',
      section: 'Clock',
      title: 'Play slower',
      key: '-',
      run: () => clock.stepSpeed(-1),
    },
    {
      id: 'clock-faster',
      section: 'Clock',
      title: 'Play faster',
      key: '=',
      run: () => clock.stepSpeed(1),
    },
    {
      id: 'clock-start',
      section: 'Clock',
      title: 'Go to the start of the session',
      key: 'Home',
      run: () => clock.seek(-Infinity),
    },
    {
      id: 'clock-end',
      section: 'Clock',
      title: 'Go to the end of the session (everything visible)',
      key: 'End',
      run: () => clock.seek(Infinity),
    },
    ...bestLaps(laps).map((lap) => ({
      id: `compare-${lap.driver}`,
      section: 'Compare',
      title: `Compare ${lap.driver} best lap (L${lap.lap})`,
      run: () => groups().toggleLap(group, { driver: lap.driver, lap: lap.lap }),
    })),
  ];

  if (api) {
    commands.push(
      ...WIDGETS.map((w) => ({
        id: `add-${w.id}`,
        section: 'Panels',
        title: `Add ${w.title}`,
        run: () => {
          const active = api.activePanel?.group;
          addWidget(api, w.id, group, active ? { referenceGroup: active } : undefined);
        },
      })),
      ...PRESETS.map((p) => ({
        id: `preset-${p.id}`,
        section: 'Layout',
        title: `${p.title} layout (replaces this dashboard)`,
        run: () => applyPreset(api, p.id),
      }))
    );
  }
  return commands;
}
