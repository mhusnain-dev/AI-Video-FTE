const USER_ID_KEY = 'user_id';

export function getUserId(): string {
  const stored = localStorage.getItem(USER_ID_KEY);
  if (stored && isValidUUID(stored)) {
    return stored;
  }

  // Generate a new UUID and store it
  const newId = generateUUID();
  localStorage.setItem(USER_ID_KEY, newId);
  return newId;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function generateUUID(): string {
  // Prefer crypto.randomUUID() (modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual v4 UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
