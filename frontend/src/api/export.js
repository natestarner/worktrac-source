import { apiClient } from './client';

// Server-generated CSV (see backend export/CsvExportService.java) -- fetched as a blob
// and triggered as a browser download, since the endpoint requires an Authorization
// header a plain <a href> couldn't attach.
export async function downloadPersonCsv(personId) {
  const response = await apiClient.getRaw(`/api/people/${personId}/export.csv`);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'workout-data.csv';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
