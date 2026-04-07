import type { ScoreHistoryEntry, ScoreCategory } from './types';
import type { ScanResult } from './LearningEngine';
import { uuidV4 } from './utils';

function categoryFromEntityType(
  entityType: ScoreHistoryEntry['entityType']
): ScoreCategory {
  if (entityType === 'component') return 'component';
  if (entityType === 'collection') return 'foundation';
  return 'file';
}

export class ScoreAggregator {
  aggregate(scan: ScanResult): ScoreHistoryEntry[] {
    const entries: ScoreHistoryEntry[] = [];
    const now = new Date().toISOString();

    for (const score of scan.scores) {
      entries.push({
        id: uuidV4(),
        entityType: score.entityType,
        entityId: score.entityId,
        entityName: score.entityName,
        score: score.score,
        category: categoryFromEntityType(score.entityType),
        dimensionBreakdown: score.dimensionBreakdown,
        scannedAt: now,
      });
    }

    // File-level aggregate across all scores
    if (scan.scores.length > 0) {
      const avg = scan.scores.reduce((s, e) => s + e.score, 0) / scan.scores.length;
      entries.push({
        id: uuidV4(),
        entityType: 'file',
        entityId: scan.fileId,
        entityName: scan.fileName,
        score: Math.round(avg),
        category: 'file',
        dimensionBreakdown: {},
        scannedAt: now,
      });
    }

    return entries;
  }
}
