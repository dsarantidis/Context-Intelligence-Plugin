/**
 * clientStorage helpers for the Usage Description Generator.
 * Uses separate keys from the existing rubric cache to avoid conflicts.
 */

const USAGE_SCAN_CACHE_KEY = 'ds_cc_usage_scan_v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function fileFingerprint(): string {
  return `${figma.root.name}::${figma.root.children.length}`;
}

export async function getCachedUsageScan(): Promise<unknown | null> {
  try {
    const cached = await figma.clientStorage.getAsync(USAGE_SCAN_CACHE_KEY) as {
      timestamp: number;
      fingerprint: string;
      data: unknown;
    } | undefined;
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    if (cached.fingerprint !== fileFingerprint()) return null;
    return cached.data;
  } catch {
    return null;
  }
}

export async function saveUsageScanCache(data: unknown): Promise<void> {
  await figma.clientStorage.setAsync(USAGE_SCAN_CACHE_KEY, {
    timestamp: Date.now(),
    fingerprint: fileFingerprint(),
    data,
  });
}

export async function clearUsageScanCache(): Promise<void> {
  await figma.clientStorage.deleteAsync(USAGE_SCAN_CACHE_KEY);
}
