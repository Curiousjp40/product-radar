// Shared password gate for the Worker's /search and /state routes --
// extracted 2026-10-16 (previously private to buscarCuenta.ts) so
// syncedStorage.ts's Mis Productos/No me interesa/Mi lista writes can
// reuse the same stored password instead of prompting twice.
const PASSWORD_KEY = "product-radar:search-password";

export function getStoredPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function setStoredPassword(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PASSWORD_KEY);
    else localStorage.setItem(PASSWORD_KEY, value);
  } catch {
    // storage unavailable (private mode, blocked site data) -- she'll just
    // be asked again next visit, the page still works either way.
  }
}
