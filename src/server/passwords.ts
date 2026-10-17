// Rejects passwords that meet the length rule but are still easy to guess. Kept small and local on purpose:
// no download, no outside service. It covers the usual 12+ character choices, keyboard runs, repeats and
// passwords built from the username or the app's own name.
const COMMON = new Set([
  'password1234', 'password12345', 'password123456', 'password1234!', 'passwordpassword', 'password!234',
  '123456789012', '1234567890123', '12345678901234', '123412341234', '111111111111', '000000000000',
  'qwertyuiopas', 'qwertyuiop12', 'qwertyuiop123', 'qwerty123456', 'qwertyqwerty', '1qaz2wsx3edc', '1q2w3e4r5t6y',
  'asdfghjkl123', 'zxcvbnm12345', 'abcdefghijkl', 'abcdef123456', 'abc123abc123', 'iloveyou1234', 'welcome12345',
  'welcome@1234', 'letmein12345', 'changeme1234', 'administrator', 'admin1234567', 'football1234', 'baseball1234',
  'sunshine1234', 'princess1234', 'monkey123456', 'dragon123456', 'trustno1trustno1', 'starwars1234',
  'paloalto1234', 'paloaltonetworks', 'paloaltonetworks1', 'pursuit12345', 'altopals1234', 'copilot12345',
]);
const RUNS = ['0123456789012345678901', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '1qaz2wsx3edc4rfv5tgb'];

/** Why a password is too easy to guess, or undefined if it is fine. */
export function weakPasswordReason(password: string, username = ''): string | undefined {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return 'That password is on the list of common passwords. Choose another one.';
  if (new Set(p).size < 5) return 'Use more different characters in your password.';
  if (RUNS.some((r) => r.includes(p) || [...r].reverse().join('').includes(p))) return 'Avoid keyboard or number runs in your password.';
  const user = username.trim().toLowerCase();
  if (user.length >= 3 && p.includes(user)) return "Don't use your username in your password.";
  return undefined;
}
