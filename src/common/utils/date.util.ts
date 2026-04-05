/**
 * Calculates a date in the past by subtracting the specified number of years from the current date.
 * This is useful for calculating age minimums (e.g., must be 13 years old).
 * * @param offsetInYears The number of years to go back (e.g., 13). Must be a positive number.
 * @returns A new Date object offset into the past.
 */
export function getDateInPastByYears(offsetInYears: number): Date {
  const years = Math.abs(offsetInYears),
    date = new Date();
  date.setFullYear(date.getFullYear() - years);

  return date;
}
