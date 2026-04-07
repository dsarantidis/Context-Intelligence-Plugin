/**
 * Minimal UUID v4 implementation — no crypto dependency required.
 * Safe for Figma plugin sandbox (Math.random is sufficient for IDs).
 */
export function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
