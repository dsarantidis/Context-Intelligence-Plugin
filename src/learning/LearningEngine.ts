import { PatternExtractor } from './PatternExtractor';
import { RuleDeriver } from './RuleDeriver';
import { ScoreAggregator } from './ScoreAggregator';
import { KnowledgeBase } from './KnowledgeBase';

export interface ScanResult {
  fileId: string;
  fileName: string;
  scannedAt: string;
  components: ScannedComponent[];
  tokens: ScannedToken[];
  scores: ComponentScore[];
}

export interface ScannedComponent {
  nodeId: string;
  name: string;
  description: string;
  hasTokenBindings: boolean;
  hasAnnotations: boolean;
  maturityScore: number;
  dimensionBreakdown: Record<string, number>;
}

export interface ScannedToken {
  id: string;
  name: string;
  type: string;
  description: string;
  isAlias: boolean;
  resolvedValue: unknown;
  modes: string[];
}

export interface ComponentScore {
  entityId: string;
  entityName: string;
  entityType: 'component' | 'file' | 'collection';
  score: number;
  dimensionBreakdown: Record<string, number>;
}

export class LearningEngine {
  constructor(
    private patternExtractor: PatternExtractor,
    private ruleDeriver: RuleDeriver,
    private scoreAggregator: ScoreAggregator,
    private kb: KnowledgeBase
  ) {}

  /**
   * Called after every scan. Extracts all learnable signals and writes them to the KB.
   * External knowledge already stored in the KB is used to boost rule confidence.
   */
  async processScanResult(scanResult: ScanResult): Promise<void> {
    const newPatterns = this.patternExtractor.extract(scanResult);
    await this.kb.mergePatterns(newPatterns);

    const [updatedPatterns, externalKnowledge] = await Promise.all([
      this.kb.getPatterns(),
      this.kb.getExternalKnowledge('ds_assistant'),
    ]);

    const derivedRules = this.ruleDeriver.derive(updatedPatterns, externalKnowledge);
    await this.kb.mergeRules(derivedRules);

    const scoreEntries = this.scoreAggregator.aggregate(scanResult);
    await this.kb.appendScoreHistory(scoreEntries);

    await this.kb.touch();
  }
}
