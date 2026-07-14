import { getApiUrl } from '../config';

const TOKEN_STORAGE_KEY = 'workout-tracker-token';

let token = localStorage.getItem(TOKEN_STORAGE_KEY) || null;
let onUnauthorized = null;

export function setAuthToken(nextToken) {
  token = nextToken;
  if (nextToken) {
    localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getAuthToken() {
  return token;
}

// AuthContext registers a callback (via useNavigate) so a 401 anywhere can redirect to
// /login without this module needing to be a hook itself.
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, isFormData = false } = {}) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const hadToken = Boolean(token);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(getApiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  // A 401 only means "your session expired" if this request actually carried a token --
  // public/unauthenticated endpoints (login, register, confirm-email, resend-code) also
  // return 401 for ordinary "that wasn't right" failures (wrong password, wrong
  // verification code), and there's no session to expire in that case. Redirecting to
  // /login there just discards whatever error the caller was about to show and dumps the
  // user out of a flow they were never logged into to begin with.
  if (response.status === 401 && hadToken) {
    setAuthToken(null);
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, 'Session expired -- please log in again.');
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = (payload && payload.message) || 'Something went wrong';
    throw new ApiError(response.status, message);
  }
  return payload;
}

export const apiClient = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path, body) => request(path, { method: 'DELETE', body }),
  getRaw: async (path) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(getApiUrl(path), { headers });
    if (response.status === 401) {
      setAuthToken(null);
      if (onUnauthorized) onUnauthorized();
      throw new ApiError(401, 'Session expired -- please log in again.');
    }
    if (!response.ok) throw new ApiError(response.status, 'Export failed');
    return response;
  },
};

export { ApiError };
