import type { DescriptionFeedbackEntry } from './types';
import { KnowledgeBase } from './KnowledgeBase';
import { uuidV4 } from './utils';

export class FeedbackProcessor {
  constructor(private kb: KnowledgeBase) {}

  async recordDescriptionFeedback(
    componentId: string,
    componentName: string,
    description: string,
    quality: DescriptionFeedbackEntry['quality'],
    generatedBy: 'ai' | 'manual'
  ): Promise<void> {
    await this.kb.addDescriptionFeedback({
      id: uuidV4(),
      componentId,
      componentName,
      description,
      generatedBy,
      quality,
      usedInGeneration: quality === 'excellent' || quality === 'good',
      recordedAt: new Date().toISOString(),
    });
  }
}
