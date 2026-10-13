// Auth session storage backed by plain localStorage.
// The export name `brokeredPreviewStorage` is kept for compatibility with
// existing callers (`./client.ts`); there is no broker anymore — the app is a
// single self-hosted origin, so the browser's localStorage is the only store.
export function brokeredPreviewStorage() {
  if (typeof window === 'undefined') return undefined;

  return {
    getItem: async (key: string) => localStorage.getItem(key),
    setItem: async (key: string, value: string) => {
      localStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      localStorage.removeItem(key);
    },
  };
}
