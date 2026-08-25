package com.worktrac.backend.csvimport;

import java.util.ArrayList;
import java.util.List;

// The reading half of CsvExportService's csvEscape: quoted fields, doubled inner quotes, and
// newlines inside a quoted value. Hand-rolled rather than pulling in a CSV library, because the
// only format it has to read is the one this app writes, and the export writer is nine lines.
//
// It also has to survive a round trip through a spreadsheet, which is where the three
// accommodations below come from -- a file that has been opened in Excel and saved again is a
// completely ordinary thing for someone to hand back to us:
//   - a UTF-8 BOM on the first cell (Excel writes one, and it would otherwise become part of the
//     first header's name, so "Date" silently stops matching)
//   - CRLF line endings
//   - a trailing blank line
final class CsvParser {

    private CsvParser() {
    }

    private static final char BOM = '﻿';

    // Rows exactly as they appear, including the header. Blank lines are dropped rather than
    // yielding an all-empty row: a trailing newline is not a record.
    static List<List<String>> parse(String content) {
        List<List<String>> rows = new ArrayList<>();
        if (content == null || content.isEmpty()) {
            return rows;
        }
        if (content.charAt(0) == BOM) {
            content = content.substring(1);
        }

        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < content.length(); i++) {
            char c = content.charAt(i);

            if (inQuotes) {
                if (c == '"') {
                    // A doubled quote is a literal one; a lone quote closes the field.
                    if (i + 1 < content.length() && content.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field.append(c);
                }
                continue;
            }

            switch (c) {
                case '"' -> inQuotes = true;
                case ',' -> {
                    row.add(field.toString());
                    field.setLength(0);
                }
                case '\r' -> {
                    // Swallow the CR of a CRLF; a lone CR is treated as a line break too.
                    if (i + 1 < content.length() && content.charAt(i + 1) == '\n') {
                        i++;
                    }
                    row.add(field.toString());
                    field.setLength(0);
                    addIfNotBlank(rows, row);
                    row = new ArrayList<>();
                }
                case '\n' -> {
                    row.add(field.toString());
                    field.setLength(0);
                    addIfNotBlank(rows, row);
                    row = new ArrayList<>();
                }
                default -> field.append(c);
            }
        }

        // Whatever is left when the input runs out is the final record, unless the file simply
        // ended with a newline.
        row.add(field.toString());
        addIfNotBlank(rows, row);
        return rows;
    }

    private static void addIfNotBlank(List<List<String>> rows, List<String> row) {
        boolean allEmpty = row.stream().allMatch(f -> f == null || f.isBlank());
        if (!allEmpty) {
            rows.add(row);
        }
    }
}
