function officeNowParts(date = new Date()) {
  const tz = process.env.OFFICE_TIMEZONE || "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isOfficeOpen(date = new Date()) {
  const { weekday, hour, minute } = officeNowParts(date);
  if (weekday === "Sat" || weekday === "Sun") return false;

  const open = Number(process.env.OFFICE_OPEN_HOUR || 9);
  const close = Number(process.env.OFFICE_CLOSE_HOUR || 16);
  const mins = hour * 60 + minute;
  return mins >= open * 60 && mins < close * 60;
}

module.exports = { isOfficeOpen, officeNowParts };
