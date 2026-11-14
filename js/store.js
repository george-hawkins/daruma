// All project sites under george-hawkins.github.io share one origin (and so one
// localStorage), so every key is prefixed.
const PREFIX = 'daruma:';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Called with the error if a save fails (e.g. storage is full); app.js shows
// it. The data stays in memory, and is still pushed to GitHub.
let onError = (e) => console.error(e);
export const onSaveError = (fn) => (onError = fn);

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    onError(e, key);
  }
}
