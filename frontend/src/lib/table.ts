import { GROUP_COLORS, type GroupId } from '@/store/groups';

/** Timing-table cells: compact, right-aligned numbers, uppercase column heads. */
export const th =
  'sticky top-0 bg-panel px-1.5 py-0.5 text-[10px] font-medium uppercase text-faint';
export const td = 'px-1.5 py-[1px] text-right';

/** Selected rows get a bar in their link group's colour. */
export function rowStyle(selected: boolean, group: GroupId): React.CSSProperties {
  return { boxShadow: selected ? `inset 2px 0 0 ${GROUP_COLORS[group]}` : undefined };
}
