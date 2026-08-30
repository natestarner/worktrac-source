// Maximum lengths for every free-text field the app writes, mirroring the backend's @Size caps,
// which in turn mirror the NVARCHAR widths of the columns they land in.
//
// WHY THE CLIENT HALF EXISTS AT ALL. These are not cosmetic, and they are not merely a nicer error
// than the server's. Most of these fields are DURABLE writes -- create exercise, favourite, save
// note -- and shouldRetryWrite (lib/queryClient.js) treats a definitive 4xx as terminal while
// retrying every 5xx forever. That gives an over-long value exactly two possible fates:
//
//   - With no server cap, it reached SQL Server, failed on truncation, and came back 503. The
//     outbox then retried it forever: a poison message that never drains, pinning the unsynced
//     badge and blocking anything queued behind it.
//   - With a server cap and no client cap, it comes back 400 and is DISCARDED -- silently, and
//     possibly after sitting in the outbox through an entire outage.
//
// Neither is acceptable, which is why the fix is both halves. Capping the input means a real
// person can never produce a value that hits either path, so the server's 400 is only ever
// reachable by a hand-crafted request, where terminal rejection is exactly right.
//
// Keep these in step with the backend DTOs. They are not derived from anything at runtime -- there
// is no shared schema between the two -- so a change on one side is a change on both.
export const FIELD_LIMITS = {
  exerciseName: 200, // exercises.name
  personName: 100, // people.name
  accountName: 200, // accounts.name
  tagName: 100, // tags.name
  routineName: 200, // routines.name
  customFieldName: 100, // person_exercise_fields.name
  customFieldValue: 200, // person_exercise_fields.value
  note: 1000, // person_exercise.note and session_exercise_notes.note
  password: 200, // not a column width -- BCrypt only reads the first 72 bytes anyway

  // Not a length: the per-household ceiling on the account's OWN exercises, mirroring
  // app.quota.exercises-per-account. Checked client-side before dispatching because creating an
  // exercise is a durable write, so the server's 403 would arrive at sync time and be discarded
  // silently along with anything queued behind its temp id.
  maxOwnExercises: 1000,
};
