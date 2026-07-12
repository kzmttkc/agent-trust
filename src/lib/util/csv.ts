export function parseListCsv(
  csv: string,
): Array<{ wallet: string; listType: "whitelist" | "blacklist" }> {
  const lines = csv.trim().split(/\r?\n/);
  const entries: Array<{ wallet: string; listType: "whitelist" | "blacklist" }> = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;

    const parts = splitCsvLine(line);
    if (index === 0 && parts[0]?.toLowerCase() === "wallet") continue;

    const wallet = parts[0]?.trim();
    const listType = parts[1]?.trim().toLowerCase();
    if (!wallet) continue;
    if (listType !== "whitelist" && listType !== "blacklist") continue;

    entries.push({ wallet, listType });
  }

  return entries;
}

function splitCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts.map((part) => part.trim().replace(/^"|"$/g, ""));
}
