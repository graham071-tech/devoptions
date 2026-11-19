// Public administrator contact configuration (kept separate from private operator login credentials).
export const PUBLIC_ADMIN_CONTACT_EMAIL: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ADMIN_CONTACT_EMAIL) ||
  'admin@devoptions.io';
