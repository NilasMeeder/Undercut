import type { FunctionComponent } from 'react';
import type { GroupId } from '@/store/groups';

export type WidgetProps<C> = { group: GroupId; config: C };

type Option<V> = { value: V; label: string };

/**
 * One control in a panel's settings menu, derived from the config field's type: booleans are a
 * toggle, arrays a set of toggles (at least one stays on), anything else a single choice.
 */
export type Setting<C> = {
  [K in keyof C & string]: C[K] extends boolean
    ? { key: K; label: string; kind: 'toggle' }
    : C[K] extends readonly (infer V)[]
      ? { key: K; label: string; kind: 'multi'; options: Option<V>[] }
      : { key: K; label: string; kind: 'choice'; options: Option<C[K]>[] };
}[keyof C & string];

/** What the (i) button shows: what the panel is, what to look for, how to drive it. */
export type WidgetHelp = { summary: string; watch: string[]; controls?: string };

export type WidgetDef<C extends object> = {
  id: string;
  title: string;
  /** One line for the add-panel menu. */
  description: string;
  help: WidgetHelp;
  defaults: C;
  settings: Setting<C>[];
  component: FunctionComponent<WidgetProps<C>>;
};

export type WidgetConfig = Record<string, unknown>;

/** A setting with its config type erased, as the settings menu and resolveConfig see it. */
export type AnySetting =
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'multi' | 'choice'; options: Option<unknown>[] };

export type AnyWidgetDef = Omit<WidgetDef<WidgetConfig>, 'settings'> & { settings: AnySetting[] };

/** Erase a widget's config type so the registry can hold every widget in one list. */
export function defineWidget<C extends object>(def: WidgetDef<C>): AnyWidgetDef {
  return def as unknown as AnyWidgetDef;
}

/**
 * A panel's stored config merged over the widget defaults. Values that no longer fit the settings
 * (a removed option, a changed type) fall back to the default, so old layouts keep loading.
 */
export function resolveConfig(def: AnyWidgetDef, stored: unknown): WidgetConfig {
  const saved = stored && typeof stored === 'object' ? (stored as WidgetConfig) : {};
  const config: WidgetConfig = { ...def.defaults };
  for (const setting of def.settings) {
    const value = saved[setting.key];
    if (value === undefined) continue;
    if (setting.kind === 'toggle') {
      if (typeof value === 'boolean') config[setting.key] = value;
    } else if (setting.kind === 'multi') {
      const known = Array.isArray(value)
        ? value.filter((v) => setting.options.some((o) => o.value === v))
        : [];
      if (known.length > 0) config[setting.key] = known;
    } else if (setting.options.some((o) => o.value === value)) {
      config[setting.key] = value;
    }
  }
  return config;
}
