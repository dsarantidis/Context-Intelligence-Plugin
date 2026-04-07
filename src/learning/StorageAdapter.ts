/**
 * Figma sandbox-safe clientStorage wrapper.
 * All reads/writes happen in the plugin main thread (code.ts).
 * Do NOT call this from the UI thread — message-pass to the main thread instead.
 */
export class StorageAdapter {
  async get(key: string): Promise<string | null> {
    try {
      const value = await figma.clientStorage.getAsync(key);
      return value != null ? (value as string) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await figma.clientStorage.setAsync(key, value);
  }

  async delete(key: string): Promise<void> {
    await figma.clientStorage.deleteAsync(key);
  }

  async keys(): Promise<string[]> {
    return figma.clientStorage.keysAsync();
  }
}
