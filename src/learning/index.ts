export { LearningEngine } from './LearningEngine';
export type { ScanResult, ScannedComponent, ScannedToken, ComponentScore } from './LearningEngine';
export { KnowledgeBase } from './KnowledgeBase';
export { PatternExtractor } from './PatternExtractor';
export { RuleDeriver } from './RuleDeriver';
export { ScoreAggregator } from './ScoreAggregator';
export { ContextBuilder } from './ContextBuilder';
export { AIAnalysisModule } from './AIAnalysisModule';
export type { AIAnalysisRequest, AIAnalysisResponse } from './AIAnalysisModule';
export { FeedbackProcessor } from './FeedbackProcessor';
export { StorageAdapter } from './StorageAdapter';
export { SyncAdapter, DEFAULT_GITHUB_PATHS } from './SyncAdapter';
export type { SyncConfig, GitHubPaths, GitHubPushResult } from './SyncAdapter';
export { DSKnowledgeSeeder } from './DSKnowledgeSeeder';
export type {
  KnowledgeBase as KnowledgeBaseSchema,
  PatternEntry,
  PatternType,
  PatternScope,
  DerivedRule,
  ScoreHistoryEntry,
  ScoreCategory,
  DescriptionFeedbackEntry,
  DescriptionQuality,
  AIInsightEntry,
  InsightType,
  ExternalKnowledgeEntry,
  ExternalKnowledgeSource,
  ExternalKnowledgeConfidence,
  MCPKnowledgeResult,
} from './types';
export { CURRENT_KB_VERSION } from './types';
