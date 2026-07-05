let config = null;

export async function loadConfig() {
  if (config) return config;
  try {
    const response = await fetch('/config.json');
    config = await response.json();
  } catch {
    config = { apiUrl: '' };
  }
  return config;
}

export function getApiUrl(path) {
  if (!config || !config.apiUrl) return path;
  return `${config.apiUrl}${path}`;
}
