/**
 * password-policy.ts — shared registration password policy.
 * Previously duplicated inline in auth.router.ts and admin-users.router.ts.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Validates a password against the shared policy.
 * Returns an error message when invalid, or null when the password is acceptable.
 */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain uppercase, lowercase, and a digit";
  }
  return null;
}
