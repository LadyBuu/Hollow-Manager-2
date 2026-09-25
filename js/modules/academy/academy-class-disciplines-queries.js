// ============================================================
// DISCIPLINE WINDOW HELPERS
// ============================================================
//
// The marker has no window. The discipline does. This helper
// reads the discipline's startWeek / endWeek and returns a
// { startWeek, endWeek } pair, or null when the discipline
// cannot supply one.
//
// LIVE REFERENCE, NOT A CLONE:
//   AcademyDisciplines exposes two accessors: getDiscipline
//   (public, returns a deep clone with normalized gradeScheme
//   and assessmentWeights) and getDisciplineRecord (internal,
//   returns the live record). This helper reads exactly two
//   scalar fields — startWeek, endWeek — and returns a fresh
//   two-field object. It never returns the discipline, never
//   mutates it, and never holds the reference past the function.
//
//   Using getDiscipline here would clone the entire record
//   (gradeScheme bands, assessmentWeights, timestamps) on every
//   call. isActiveInWeek is called once per (student, offering)
//   in several Academy render paths, and each call would pay that
//   clone cost for two numbers. The clone is not just wasteful;
//   it is the single largest per-call allocation on the
//   discipline-view render path.
//
//   getDisciplineRecord is the correct accessor for a read of
//   this shape. It is exposed by AcademyDisciplines for exactly
//   this purpose.
//
// The containment check itself is not performed here; callers
// pass the returned window to RangeUtils.containsWeek.

function getDisciplineWindow(disciplineId) {
    if (!isNonEmptyString(disciplineId)) {
        return null;
    }
    var discipline = AcademyDisciplines.getDisciplineRecord(disciplineId);
    if (!discipline) {
        return null;
    }

    var startWeek = parseWeekStrict(discipline.startWeek);
    var endWeek = null;
    if (discipline.endWeek !== undefined &&
        discipline.endWeek !== null &&
        discipline.endWeek !== '') {
        endWeek = parseWeekStrict(discipline.endWeek);
    }

    if (startWeek === null) {
        return null;
    }

    return { startWeek: startWeek, endWeek: endWeek };
}
