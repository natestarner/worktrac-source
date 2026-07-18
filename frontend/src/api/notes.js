import { apiClient } from './client';

// Standing per-person note on an exercise -- shown every session, isolated the same way
// favorites/tags already are (see api/exercises.js). A blank note clears it.
export function setPersistentNote(personId, exerciseId, note) {
  return apiClient.put(`/api/people/${personId}/exercises/${exerciseId}/note`, { note });
}

// Session note -- scoped to one workout. null when the exercise has no note in that session.
export function getSessionExerciseNote(sessionId, exerciseId) {
  return apiClient.get(`/api/sessions/${sessionId}/exercises/${exerciseId}/note`);
}

// Materializes the live session if none exists yet, exactly like logging a live set does,
// so a note can be saved before the first set of a workout.
export function saveLiveExerciseNote(personId, { exerciseId, note }) {
  return apiClient.put(`/api/people/${personId}/live-exercise-notes`, { exerciseId, note });
}

// Editing an explicit (typically past) session -- mirrors logSetIntoSession's endpoint shape.
export function saveSessionExerciseNote(sessionId, exerciseId, note) {
  return apiClient.put(`/api/sessions/${sessionId}/exercises/${exerciseId}/note`, { note });
}
