// Public surface of the native adapters. Import from 'lib/native', not from the files inside it.
export { isNativeApp, nativePlatform } from './platform';
export { saveFile } from './files';
export { openExternal, externalLinkProps } from './links';
export { nativeHaptic } from './haptics';
export { isInstalledApp } from './installed';
