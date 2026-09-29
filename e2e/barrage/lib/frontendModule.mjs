// Load one of the app's own modules (frontend/src) into Node, so a barrage check runs the EXACT code
// the phone runs rather than a copy of it. The app's imports are extensionless ('./formulas'), which
// Vite resolves and plain Node does not; a resolve hook adds the '.js' for relative specifiers only.
// Only for pure modules -- nothing that touches React, the DOM or import.meta.env.
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './config.mjs';

const HOOKS = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?js$/.test(specifier)) {
      return next(specifier + '.js', context);
    }
    throw error;
  }
}`;

let registered = false;

export async function importFrontend(relative) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  return import(pathToFileURL(path.join(REPO_ROOT, 'frontend', 'src', relative)).href);
}
