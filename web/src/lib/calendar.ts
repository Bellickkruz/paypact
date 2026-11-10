// "Add to calendar": a downloadable .ics (iPhone, Android, Outlook) and a Google Calendar link.

export interface CalendarEvent {
  title: string;
  details: string;
  start: Date;
  url: string;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export function icsFile(e: CalendarEvent): string {
  const end = new Date(e.start.getTime() + 30 * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PayPact//Reminders//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(e.start)}-${Math.random().toString(36).slice(2)}@paypact`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(e.title)}`,
    `DESCRIPTION:${escape(`${e.details}\n${e.url}`)}`,
    `URL:${e.url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(e.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(e: CalendarEvent) {
  const blob = new Blob([icsFile(e)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "paypact-reminder.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const end = new Date(e.start.getTime() + 30 * 60_000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(end)}`,
    details: `${e.details}\n${e.url}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
