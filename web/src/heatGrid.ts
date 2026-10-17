// Part B Horarios rebuild (2026-10-16): pure helpers for rendering a
// day x 2-hour heat grid from engine.posting_time.heat_grid_cells' output.
import type { HeatGridCell, LiveBestTime } from "./types";

export function maxMedianUnits(cells: HeatGridCell[]): number {
  return cells.reduce((max, c) => Math.max(max, c.median_units), 0);
}

/** 0-1 shading intensity for a cell, relative to the group's own busiest
 * slot (so a sleepy category doesn't look uniformly "cold" against a
 * fixed global scale). 0 when the group has no data at all. */
export function cellIntensity(cell: HeatGridCell, maxMedian: number): number {
  if (maxMedian <= 0) return 0;
  return Math.max(0, Math.min(1, cell.median_units / maxMedian));
}

/** Whether `cell` is the highlighted "best slot" -- same hour window and
 * one of the (up to 2) best weekdays best_live_time_for_l1 picked. */
export function isBestCell(cell: HeatGridCell, best: LiveBestTime | null): boolean {
  if (!best) return false;
  return cell.hour_start === best.hour_start && best.best_weekdays.includes(cell.weekday);
}

export function findCell(cells: HeatGridCell[], weekday: number, hourStart: number): HeatGridCell | null {
  return cells.find((c) => c.weekday === weekday && c.hour_start === hourStart) ?? null;
}
