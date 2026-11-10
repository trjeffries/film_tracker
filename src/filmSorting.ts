export type SortOrder = "release" | "booking";

interface SortableFilm {
  id: string;
  title: string;
  year: number | null;
  releaseDates: Array<{ date: string }>;
}

interface SortableBooking {
  booked: boolean;
  date?: string;
}

export function compareFilms(
  left: SortableFilm,
  right: SortableFilm,
  sortOrder: SortOrder,
  bookings: Record<string, SortableBooking>,
): number {
  const alphabetical = () => left.title.localeCompare(right.title, "en-GB");
  if (sortOrder === "booking") {
    const leftBooking = bookings[left.id];
    const rightBooking = bookings[right.id];
    const leftBooked = leftBooking?.booked ?? false;
    const rightBooked = rightBooking?.booked ?? false;
    if (leftBooked !== rightBooked) return leftBooked ? -1 : 1;
    if (leftBooked && rightBooked) {
      const leftDate = leftBooking?.date;
      const rightDate = rightBooking?.date;
      if (!leftDate) return rightDate ? 1 : alphabetical();
      if (!rightDate) return -1;
      return leftDate.localeCompare(rightDate) || alphabetical();
    }
  }

  const leftDate = left.releaseDates[0]?.date;
  const rightDate = right.releaseDates[0]?.date;
  const leftYear = leftDate?.slice(0, 4) ?? left.year?.toString();
  const rightYear = rightDate?.slice(0, 4) ?? right.year?.toString();
  if (leftYear && rightYear && leftYear !== rightYear) {
    return leftYear.localeCompare(rightYear);
  }
  if (!leftYear) return rightYear ? 1 : alphabetical();
  if (!rightYear) return -1;
  if (!leftDate) return rightDate ? 1 : alphabetical();
  if (!rightDate) return -1;
  return leftDate.localeCompare(rightDate) || alphabetical();
}
