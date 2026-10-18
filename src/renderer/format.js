// Small helpers for showing values.

// formatTime shows seconds as m:ss.cc, for example 1:05.30
export function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(total / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const hundredths = total % 100;
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

// parseTime reads "m:ss.cc", "h:mm:ss" or plain seconds. It returns NaN for anything else.
export function parseTime(text) {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) {
    return NaN;
  }
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}

// num formats a number for display, for example 1,234.5. It shows "–" for missing values.
export function num(value, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits, minimumFractionDigits }).format(value);
}

// formatCommand prints an ffmpeg command over several lines, like you would type it in a shell.
export function formatCommand(args) {
  const lines = ["ffmpeg"];
  const last = args.length - 1; // the output file gets its own line
  for (let i = 0; i <= last; i++) {
    const hasValue = args[i].startsWith("-") && i + 1 < last && !args[i + 1].startsWith("-");
    if (hasValue) {
      lines.push(args[i] + " " + shellQuote(args[i + 1]));
      i++;
    } else {
      lines.push(shellQuote(args[i]));
    }
  }
  return lines.join(" \\\n  ");
}

function shellQuote(arg) {
  if (/^[\w@%+=:,./-]+$/.test(arg)) {
    return arg;
  }
  return "'" + arg.replaceAll("'", `'\\''`) + "'";
}
