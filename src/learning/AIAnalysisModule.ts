import type { AIInsightEntry } from './types';
import { ContextBuilder } from './ContextBuilder';
import { uuidV4 } from './utils';

export interface AIAnalysisRequest {
  apiKey: string;
  analysisPrompt: string;
  scanSummary: string;
}

export interface AIAnalysisResponse {
  insights: AIInsightEntry[];
  rawText: string;
}

type InsightPayload = Omit<AIInsightEntry, 'id' | 'generatedAt' | 'acknowledged'>;

export class AIAnalysisModule {
  constructor(private contextBuilder: ContextBuilder) {}

  async analyze(req: AIAnalysisRequest): Promise<AIAnalysisResponse> {
    const systemContext = await this.contextBuilder.buildSystemContext();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: [
          `You are a design system analyst. You have access to accumulated knowledge about this design system.`,
          ``,
          systemContext,
          ``,
          `Respond ONLY with a JSON array of insight objects. Each object must have:`,
          `  type (pattern_anomaly|naming_inconsistency|coverage_gap|recommendation|trend)`,
          `  title (string)`,
          `  summary (string)`,
          `  affectedEntities (string[])`,
          `  severity (info|warning|critical)`,
          `No markdown, no preamble.`,
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: `${req.analysisPrompt}\n\nCurrent scan data:\n${req.scanSummary}`,
          },
        ],
      }),
    });

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const rawText = data.content?.[0]?.text ?? '[]';

    let parsed: InsightPayload[] = [];
    try {
      parsed = JSON.parse(rawText) as InsightPayload[];
    } catch {
      parsed = [];
    }

    const now = new Date().toISOString();
    const insights: AIInsightEntry[] = parsed.map(p => ({
      ...p,
      id: uuidV4(),
      generatedAt: now,
      acknowledged: false,
    }));

    return { insights, rawText };
  }
}
