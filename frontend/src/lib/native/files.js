// Handing a generated file (a CSV or ZIP export) to the person.
//
// Web: the anchor-with-download-attribute that export.js has always used, moved here verbatim.
// App: WKWebView ignores `download` entirely -- the tap does nothing at all -- so the file is
// written to the app's cache directory and offered through the system share sheet, which is the
// phone-native way to save to Files, AirDrop it, or mail it.
import { isNativeApp } from './platform';

export async function saveFile(blob, filename) {
  if (!isNativeApp()) {
    downloadWithAnchor(blob, filename);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: filename, files: [uri] });
  } catch (error) {
    // Closing the share sheet without picking anything rejects with "Share canceled". That is the
    // person changing their mind, not a failed export, so it must not reach the caller's error
    // toast ("Couldn't export...") -- the file was produced and offered, which is all export owes.
    if (isShareCancel(error)) return;
    throw error;
  }
}

export function isShareCancel(error) {
  return /cancel/i.test(String(error?.message ?? error ?? ''));
}

function downloadWithAnchor(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Filesystem.writeFile takes base64 for binary data. FileReader rather than btoa over the bytes:
// an export can be megabytes, and a string built byte by byte would stall the UI thread.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
