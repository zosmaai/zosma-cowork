/**
 * cron.ts — tiny, zero-dependency helpers for the Tasks UI (#289).
 *
 * `humanizeCron` turns a standard 5-field cron expression
 * ("min hour day-of-month month day-of-week") into a short English phrase for
 * display. It deliberately covers the common shapes a scheduling agent emits
 * (every N minutes/hours, daily/weekly/monthly at a time, weekdays) and falls
 * back to the raw expression for anything it doesn't recognise — so it's always
 * safe, never wrong. If we later want full coverage, swap in `cronstrue`.
 *
 * `formatRelative` renders an ISO timestamp as a compact relative string
 * ("in 5m", "2h ago") for next/last-run columns.
 */

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Format "HH:MM" 24h fields into a 12h "9:00 AM" clock string. */
function clock(minute: number, hour: number): string {
	const mm = String(minute).padStart(2, "0");
	const ampm = hour < 12 ? "AM" : "PM";
	let h = hour % 12;
	if (h === 0) h = 12;
	return `${h}:${mm} ${ampm}`;
}

/**
 * Best-effort human-readable rendering of a 5-field cron expression. Returns a
 * short phrase, or the raw expression (unchanged) when it isn't a shape we
 * recognise.
 */
export function humanizeCron(expr: string): string {
	const raw = expr.trim();
	const parts = raw.split(/\s+/);
	if (parts.length !== 5) return raw;
	const [min, hour, dom, mon, dow] = parts;

	const isEvery = (f: string) => f === "*";
	const isNum = (f: string) => /^\d+$/.test(f);

	// every minute
	if (isEvery(min) && isEvery(hour) && isEvery(dom) && isEvery(mon) && isEvery(dow)) {
		return "Every minute";
	}

	// every N minutes (*/N * * * *)
	const stepMin = /^\*\/(\d+)$/.exec(min);
	if (stepMin && isEvery(hour) && isEvery(dom) && isEvery(mon) && isEvery(dow)) {
		return `Every ${stepMin[1]} minutes`;
	}

	// every hour (0 * * * *) / at minute M past every hour
	if (isNum(min) && isEvery(hour) && isEvery(dom) && isEvery(mon) && isEvery(dow)) {
		return min === "0" ? "Every hour" : `At ${min} minutes past every hour`;
	}

	// every N hours (M */N * * *)
	const stepHour = /^\*\/(\d+)$/.exec(hour);
	if (isNum(min) && stepHour && isEvery(dom) && isEvery(mon) && isEvery(dow)) {
		return `Every ${stepHour[1]} hours`;
	}

	// time-of-day shapes (numeric minute + hour)
	if (isNum(min) && isNum(hour) && isEvery(mon)) {
		const at = clock(Number(min), Number(hour));

		// daily
		if (isEvery(dom) && isEvery(dow)) return `Every day at ${at}`;

		// weekdays (1-5)
		if (isEvery(dom) && (dow === "1-5" || dow === "MON-FRI")) {
			return `Weekdays at ${at}`;
		}

		// weekly on a single day-of-week
		if (isEvery(dom) && isNum(dow)) {
			const d = Number(dow) % 7;
			return `Every ${DOW[d]} at ${at}`;
		}

		// monthly on a day-of-month
		if (isNum(dom) && isEvery(dow)) {
			return `Monthly on day ${dom} at ${at}`;
		}
	}

	return raw;
}

/**
 * Compact relative time for a (possibly absent) ISO timestamp. Returns "—" when
 * the value is missing or unparseable.
 */
export function formatRelative(iso?: string, now: number = Date.now()): string {
	if (!iso) return "—";
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return "—";

	const diff = t - now; // future > 0, past < 0
	const future = diff >= 0;
	const abs = Math.abs(diff);

	const sec = Math.round(abs / 1000);
	const min = Math.round(abs / 60000);
	const hr = Math.round(abs / 3600000);
	const day = Math.round(abs / 86400000);

	let mag: string;
	if (sec < 45) mag = "just now";
	else if (min < 60) mag = `${min}m`;
	else if (hr < 24) mag = `${hr}h`;
	else mag = `${day}d`;

	if (mag === "just now") return mag;
	return future ? `in ${mag}` : `${mag} ago`;
}
