export interface UserSettings {
  sortOrder?: "release" | "booking";
  bookingDetailsPromptDisabled?: boolean;
  bookingPromptChoiceMade?: boolean;
}

export function isUserSettings(value: unknown): value is UserSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (settings.sortOrder === undefined || settings.sortOrder === "release" || settings.sortOrder === "booking") &&
    (settings.bookingDetailsPromptDisabled === undefined || typeof settings.bookingDetailsPromptDisabled === "boolean") &&
    (settings.bookingPromptChoiceMade === undefined || typeof settings.bookingPromptChoiceMade === "boolean");
}
