import { apiClient } from './client';

// Server-generated CSV (see backend export/CsvExportService.java) -- fetched as a blob
// and triggered as a browser download, since the endpoint requires an Authorization
// header a plain <a href> couldn't attach.
export async function downloadPersonCsv(personId) {
  await downloadBlob(`/api/people/${personId}/export.csv`, 'workout-data.csv');
}

// Every person on the account, each as their own CSV, zipped server-side -- lets
// someone export the whole household in one action instead of switching people and
// exporting each one individually.
export async function downloadAllPeopleZip() {
  await downloadBlob('/api/export/all.zip', 'workout-data-all-people.zip');
}

async function downloadBlob(path, fallbackFilename) {
  const response = await apiClient.getRaw(path);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
