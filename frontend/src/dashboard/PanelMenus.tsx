import { cn } from '@/lib/utils';
import {
  diffFromDefaults,
  type AnySetting,
  type AnyWidgetDef,
  type WidgetConfig,
} from '@/widgets/types';

const heading = 'px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-faint';

/** The (i) dropdown: what the panel shows, what to look for, how to drive it. */
export function HelpContent({ widget }: { widget: AnyWidgetDef }) {
  const { summary, watch, controls } = widget.help;
  return (
    <div className="pb-2">
      <div className={heading}>{widget.title}</div>
      <p className="px-2 leading-snug text-dim">{summary}</p>
      <div className={heading}>Watch for</div>
      <ul className="space-y-1 px-2 leading-snug text-dim">
        {watch.map((line) => (
          <li key={line} className="flex gap-1.5">
            <span className="text-faint">–</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {controls ? (
        <>
          <div className={heading}>Controls</div>
          <p className="px-2 leading-snug text-dim">{controls}</p>
        </>
      ) : null}
    </div>
  );
}

export function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-5 border border-l-0 border-line-strong px-1.5 first:border-l',
        active ? 'bg-text font-semibold text-bg' : 'bg-panel text-dim hover:text-text'
      )}
    >
      {children}
    </button>
  );
}

function SettingControl({
  setting,
  value,
  onChange,
}: {
  setting: AnySetting;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (setting.kind === 'toggle') {
    return (
      <div className="flex">
        <Segment active={value === true} onClick={() => onChange(true)}>
          On
        </Segment>
        <Segment active={value === false} onClick={() => onChange(false)}>
          Off
        </Segment>
      </div>
    );
  }
  if (setting.kind === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-y-1">
        {setting.options.map((o) => {
          const on = selected.includes(o.value);
          const toggle = () => {
            const next = on ? selected.filter((v) => v !== o.value) : [...selected, o.value];
            // Keep at least one option on (an empty panel is never what you want), in option order.
            if (next.length === 0) return;
            onChange(setting.options.map((x) => x.value).filter((v) => next.includes(v)));
          };
          return (
            <Segment key={String(o.value)} active={on} onClick={toggle}>
              {o.label}
            </Segment>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex">
      {setting.options.map((o) => (
        <Segment key={String(o.value)} active={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </Segment>
      ))}
    </div>
  );
}

/** The gear dropdown: one control per widget setting, applied to the panel immediately. */
export function SettingsContent({
  widget,
  config,
  onChange,
}: {
  widget: AnyWidgetDef;
  config: WidgetConfig;
  onChange: (stored: WidgetConfig) => void;
}) {
  const set = (key: string, value: unknown) =>
    onChange(diffFromDefaults({ ...config, [key]: value }, widget.defaults));
  const isDefault = Object.keys(diffFromDefaults(config, widget.defaults)).length === 0;
  return (
    <div className="pb-2">
      <div className={cn(heading, 'flex items-center')}>
        <span>{widget.title} settings</span>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onChange({})}
          className="ml-auto normal-case tracking-normal text-faint hover:text-text disabled:opacity-40 disabled:hover:text-faint"
        >
          Reset
        </button>
      </div>
      <div className="space-y-1.5 px-2">
        {widget.settings.map((setting) => (
          <div key={setting.key}>
            <div className="pb-0.5 text-dim">{setting.label}</div>
            <SettingControl
              setting={setting}
              value={config[setting.key]}
              onChange={(value) => set(setting.key, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
