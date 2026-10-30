const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthAliases = [
  ["January", "Jan"], ["February", "Feb"], ["March", "Mar"], ["April", "Apr"],
  ["May"], ["June", "Jun"], ["July", "Jul"], ["August", "Aug"],
  ["September", "Sept", "Sep"], ["October", "Oct"], ["November", "Nov"], ["December", "Dec"],
];
const monthPattern = "January|February|March|April|May|June|July|August|September|March|April|June|July|August|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

function monthNumber(value: string): number | null {
  const lower = value.toLowerCase();
  const index = monthAliases.findIndex((aliases) => aliases.some((alias) => alias.toLowerCase() === lower));
  return index < 0 ? null : index + 1;
}

function canonicalMonthYear(month: string, yearText: string): string | null {
  const monthIndex = monthNumber(month);
  if (!monthIndex) return null;
  let year = Number(yearText.replace(/^['’]/, ""));
  if (yearText.replace(/^['’]/, "").length === 2) year += year >= 70 ? 1900 : 2000;
  if (year < 1900 || year > 2200) return null;
  return `${monthNames[monthIndex - 1]} ${year}`;
}

export function normalizeReportingPeriod(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  const range = text.match(new RegExp(`(?:\\d{1,2}\\s+)?(${monthPattern})\\s+['’]?(\\d{2,4})\\s*[-–—]\\s*(?:\\d{1,2}\\s+)?(${monthPattern})\\s+['’]?(\\d{2,4})`, "i"));
  if (range) {
    const first = canonicalMonthYear(range[1], range[2]);
    const last = canonicalMonthYear(range[3], range[4]);
    return first && first === last ? first : null;
  }

  const monthFirst = text.match(new RegExp(`\\b(${monthPattern})\\s*[,/'’ -]?\\s*['’]?(\\d{2,4})\\b`, "i"));
  if (monthFirst) return canonicalMonthYear(monthFirst[1], monthFirst[2]);
  const yearFirst = text.match(new RegExp(`\\b(\\d{4})[- /](${monthPattern})\\b`, "i"));
  return yearFirst ? canonicalMonthYear(yearFirst[2], yearFirst[1]) : null;
}

export function normalizeReportingPeriodFromFilename(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, "");
  for (let i = 0; i < monthAliases.length; i++) {
    for (const alias of monthAliases[i]) {
      const yearFirstMonth = stem.match(new RegExp(`(?:^|[^0-9])(20\\d{2})[\\s._-]*${alias}(?:$|[^A-Za-z])`, "i"));
      if (yearFirstMonth) return canonicalMonthYear(alias, yearFirstMonth[1]);
    }
  }
  const monthYear = stem.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[-_. ](20\d{2}|\d{2})(?:$|[^0-9])/);
  if (monthYear) return canonicalMonthYear(monthNames[Number(monthYear[1]) - 1], monthYear[2]);
  const yearMonth = stem.match(/(?:^|[^0-9])(20\d{2})[-_. ](0?[1-9]|1[0-2])(?:$|[^0-9])/);
  if (yearMonth) return canonicalMonthYear(monthNames[Number(yearMonth[2]) - 1], yearMonth[1]);

  const searchableStem = stem.replace(/[^A-Za-z0-9'’]+/g, " ");
  for (let i = 0; i < monthAliases.length; i++) {
    for (const alias of monthAliases[i]) {
      const pattern = new RegExp(`${alias}\\s*['’]?\\s*(20\\d{2}|\\d{2})(?!\\d)`, "i");
      const match = searchableStem.match(pattern);
      if (match) return canonicalMonthYear(alias, match[1]);
    }
  }
  return null;
}

export function resolveDocumentPeriod(candidates: Array<{ value: string; evidence: string }>) {
  const evidence = candidates.map((candidate) => ({ value: candidate.value, excerpt: candidate.evidence }));
  const normalized = [...new Set(candidates.map((candidate) => normalizeReportingPeriod(candidate.value)).filter((value): value is string => value !== null))];
  return {
    value: normalized.length === 1 ? normalized[0] : null,
    evidence,
    warning: normalized.length > 1
      ? "Conflicting explicit reporting periods were found in this document."
      : normalized.length === 0
        ? "No exact month-and-year reporting period could be confirmed for this document."
        : null,
  };
}

export function selectBatchPeriod(periods: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const period of periods) if (period) counts.set(period, (counts.get(period) ?? 0) + 1);
  if (counts.size === 0) return { value: null, tied: false };
  const maxCount = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => count === maxCount).map(([period]) => period);
  return { value: leaders.length === 1 ? leaders[0] : null, tied: leaders.length > 1 };
}
