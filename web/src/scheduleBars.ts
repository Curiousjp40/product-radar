import type { HeatGridCell } from "./types";

/** Design review 3.4/3.7: replace the day x hour heat grid with an
 * AnswerCard + two simple bar charts. Pure aggregation so the "best" bar
 * is provably the actual highest value (the review's item 4: "today the
 * darkest cell is Tue 8 AM but the outline is on 8 PM" -- fix by deriving
 * the highlight from the same aggregated numbers the bars show, not a
 * separately-computed best_weekdays/hour_start). */

export interface Bar {
  value: number;
  sampleSize: number;
}

export interface DayBar extends Bar {
  weekday: number;
}

export interface HourBar extends Bar {
  hourStart: number;
}

/** One bar per weekday (0=Mon..6=Sun): the peak median_units across that
 * day's hour slots, so "best day" means "this day has the best slot
 * available", matching what the answer card's single best window means. */
export function aggregateByWeekday(cells: HeatGridCell[]): DayBar[] {
  const bars: DayBar[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, value: 0, sampleSize: 0 }));
  for (const cell of cells) {
    const bar = bars[cell.weekday];
    if (!bar) continue;
    if (cell.median_units > bar.value) bar.value = cell.median_units;
    bar.sampleSize += cell.sample_size;
  }
  return bars;
}

/** One bar per 2-hour block (the peak median_units across all weekdays in
 * that block). `hourSlots` is the set of block start hours present in the
 * data (e.g. [0, 2, 4, ..., 22]). */
export function aggregateByHour(cells: HeatGridCell[], hourSlots: number[]): HourBar[] {
  return hourSlots.map((hourStart) => {
    const inBlock = cells.filter((c) => c.hour_start === hourStart);
    const value = inBlock.reduce((max, c) => Math.max(max, c.median_units), 0);
    const sampleSize = inBlock.reduce((sum, c) => sum + c.sample_size, 0);
    return { hourStart, value, sampleSize };
  });
}

/** Index of the highest-value bar, minimum sample size `minSamples` to
 * count (design review 3.4 item 4's "min 3 samples per slot" rule). Null
 * when every bar is empty/below threshold -- caller shows "sin datos". */
export function bestBarIndex(bars: Bar[], minSamples = 3): number | null {
  let bestIdx: number | null = null;
  let bestValue = -1;
  bars.forEach((bar, i) => {
    if (bar.sampleSize < minSamples) return;
    if (bar.value > bestValue) {
      bestValue = bar.value;
      bestIdx = i;
    }
  });
  return bestIdx;
}
