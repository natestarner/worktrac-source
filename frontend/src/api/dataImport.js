import { apiClient, IMPORT_TIMEOUT_MS } from './client';

// Reading a workout CSV back in (see backend csvimport/). The file is posted twice on purpose --
// once to preview, once to commit -- rather than the server holding parse state between the two.
// Re-deriving duplicates against live data at commit time is what makes the commit idempotent, so
// a retry after a timeout adds nothing a second time.

// Writes nothing. Answers what the file would do: how many sets and workouts, which rows are
// already present, which optional columns were defaulted, and any rows that can't be read.
export async function previewImport(personId, csv, filename) {
  return apiClient.post(`/api/people/${personId}/import/preview`, { csv, filename }, {
    timeoutMs: IMPORT_TIMEOUT_MS,
  });
}

export async function commitImport(personId, csv, filename) {
  return apiClient.post(`/api/people/${personId}/import`, { csv, filename }, {
    timeoutMs: IMPORT_TIMEOUT_MS,
  });
}

export async function listImports(personId) {
  return apiClient.get(`/api/people/${personId}/imports`);
}

export async function undoImport(personId, batchId) {
  return apiClient.delete(`/api/people/${personId}/imports/${batchId}`);
}
