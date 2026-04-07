export interface WriteResult {
  written: number;
  errors: Array<{ varId: string; error: string }>;
}

export async function writeDescriptions(
  approvedDescriptions: Array<{ varId: string; description: string }>
): Promise<WriteResult> {
  let written = 0;
  const errors: Array<{ varId: string; error: string }> = [];

  // Process in chunks of 50 to avoid blocking
  const chunks = chunkArray(approvedDescriptions, 50);

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async ({ varId, description }) => {
        try {
          const variable = await figma.variables.getVariableByIdAsync(varId);
          if (!variable) {
            errors.push({ varId, error: 'Variable not found' });
            return;
          }
          variable.description = description;
          written++;
        } catch (e: unknown) {
          errors.push({ varId, error: e instanceof Error ? e.message : String(e) });
        }
      })
    );
  }

  return { written, errors };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
