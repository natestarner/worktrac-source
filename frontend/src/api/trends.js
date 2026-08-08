import { apiClient } from './client';

// "Today"/"this week" must bucket by the viewer's local calendar, not the server's UTC
// storage zone -- otherwise a session logged late evening can land on the wrong day (or
// collide with the next day's session) once the backend buckets it. See datetime.js.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function getTrendsOverview(personId, weeks) {
  return apiClient.get(`/api/people/${personId}/trends/overview?weeks=${weeks}&zone=${encodeURIComponent(timeZone)}`);
}

export function getExerciseTrend(personId, exerciseId, weeks) {
  return apiClient.get(
    `/api/people/${personId}/trends/exercises/${exerciseId}?weeks=${weeks}&zone=${encodeURIComponent(timeZone)}`,
  );
}

// All-time, so deliberately no `weeks` -- a record isn't relative to the range you're viewing, and
// keeping it out of the URL (and the query key) means flipping the range toggle doesn't refetch it.
// `zone` is still needed to date each record in the viewer's local calendar.
export function getExerciseRecords(personId, exerciseId) {
  return apiClient.get(
    `/api/people/${personId}/exercises/${exerciseId}/records?zone=${encodeURIComponent(timeZone)}`,
  );
}
