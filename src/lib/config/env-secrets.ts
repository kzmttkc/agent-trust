export const WEAK_SECRET_PATTERNS = [
  /^change_me/i,
  /^changeme/i,
  /^dev_/i,
  /^test_/i,
  /^prod_default/i,
  /^password/i,
  /^secret/i,
  /^admin/i,
];

/** Reject trivially low-entropy secrets (repeated chars, tiny alphabet). */
export function hasLowEntropy(value: string): boolean {
  if (value.length < 16) return true;
  const unique = new Set(value).size;
  if (unique < Math.min(10, Math.ceil(value.length / 4))) return true;
  if (/^(.)\1+$/u.test(value)) return true;
  if (/^(..)\1+$/u.test(value)) return true;
  if (/^(...)\1+$/u.test(value)) return true;
  return false;
}
