/**
 * Calendar-date helpers for the review schedule.
 *
 * A review date is a calendar day (`YYYY-MM-DD`), not an instant: a card due on
 * a date becomes reviewable at local midnight, and an interval is a whole
 * number of days. The arithmetic here parses dates as UTC midnight and formats
 * back from UTC, so a daylight-saving transition cannot turn an `addCalendarDays`
 * into 23 or 25 hours and shift the resulting date.
 */

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `true` when the value is a `YYYY-MM-DD` string naming a real calendar day. */
export function isCalendarDate(value: string) {
  if (!CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The local calendar day a `Date` falls on, as `YYYY-MM-DD`. */
export function toCalendarDate(date: Date) {
  return formatUtcDate(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
}

/** The calendar day `days` after `calendarDate`, as `YYYY-MM-DD`. */
export function addCalendarDays(calendarDate: string, days: number) {
  const year = Number(calendarDate.slice(0, 4));
  const month = Number(calendarDate.slice(5, 7));
  const day = Number(calendarDate.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  return formatUtcDate(date);
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
