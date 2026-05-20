// Simple CSV parser for Japanese accounting CSV files.
//
// Handles:
//   - UTF-8 BOM (common in Japanese CSV exports)
//   - Quoted fields with embedded commas and newlines
//   - Empty lines
//   - CRLF / LF line endings
//
// Note: Shift-JIS support is NOT included. Users must export as UTF-8
// (弥生: エクスポート → 文字コード: UTF-8 を選択).

/**
 * Parse CSV text into array of header-keyed row objects.
 *
 * @param csvText - Raw CSV text (UTF-8).
 * @returns { headers, rows } where each row is Record<headerName, value>.
 */
export function parseCsv(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip BOM
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = splitCsvLines(text);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // skip empty lines

    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? '').trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Split CSV text into lines, respecting quoted fields that span multiple lines.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // Check for escaped quote ("")
      if (inQuote && i + 1 < text.length && text[i + 1] === '"') {
        current += '""';
        i++; // skip next quote
      } else {
        inQuote = !inQuote;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      // Line break outside quotes = end of line
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++; // skip \n in \r\n
      }
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  // Last line (no trailing newline)
  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * Parse a single CSV line into field values.
 * Handles quoted fields and escaped double-quotes.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma → empty field
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let value = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      // Skip comma after quoted field
      if (i < line.length && line[i] === ',') {
        i++;
      }
    } else {
      // Unquoted field
      const nextComma = line.indexOf(',', i);
      if (nextComma === -1) {
        fields.push(line.slice(i));
        i = line.length;
      } else {
        fields.push(line.slice(i, nextComma));
        i = nextComma + 1;
      }
    }
  }

  return fields;
}
