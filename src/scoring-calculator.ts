/**
 * Scoring Calculator
 * 
 * Calculates overall design system scores and generates summaries.
 */

import type { ComponentAudit, AuditSummary } from './types';

export class ScoringCalculator {

  /**
   * Calculate overall score from component audits
   */
  calculateOverallScore(audits: ComponentAudit[]): number {
    if (audits.length === 0) return 0;

    const totalScore = audits.reduce((sum, audit) => sum + audit.score, 0);
    return Math.round(totalScore / audits.length);
  }

  /**
   * Generate summary from component audits
   */
  generateSummary(audits: ComponentAudit[]): AuditSummary {
    const totalNodes = audits.length;
    const averageScore = this.calculateOverallScore(audits);
    const issuesFound = audits.reduce((sum, a) => sum + a.issues.length, 0);

    // These are based on the nodeType strings produced by `code.ts`
    const componentsScanned = audits.filter(
      (a) => a.nodeType === 'COMPONENT' || a.nodeType === 'COMPONENT_SET'
    ).length;
    const componentSets = audits.filter((a) => a.nodeType === 'COMPONENT_SET').length;
    const stylesFound = audits.filter((a) => /Style$/.test(a.nodeType)).length;
    const variablesFound = audits.filter(
      (a) => a.nodeType === 'Variable' || a.nodeType === 'VariableCollection'
    ).length;

    return {
      totalNodes,
      componentsScanned,
      componentSets,
      stylesFound,
      variablesFound,
      averageScore,
      issuesFound,
    };
  }

  /**
   * Get score color (for UI)
   */
  getScoreColor(score: number): string {
    if (score >= 80) return '#10b981'; // green
    if (score >= 60) return '#f59e0b'; // yellow
    if (score >= 40) return '#f97316'; // orange
    return '#ef4444'; // red
  }

  /**
   * Get score label
   */
  getScoreLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Very Good';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    if (score >= 40) return 'Needs Improvement';
    return 'Poor';
  }

  /**
   * Get AI-readiness level
   */
  getAIReadinessLevel(score: number): { level: string; description: string } {
    if (score >= 85) {
      return {
        level: 'AI-Ready',
        description: 'Design system is highly structured and ready for AI integration'
      };
    }
    if (score >= 70) {
      return {
        level: 'AI-Friendly',
        description: 'Good structure, some improvements needed for optimal AI usage'
      };
    }
    if (score >= 50) {
      return {
        level: 'Partially AI-Compatible',
        description: 'Basic structure in place, significant improvements needed'
      };
    }
    return {
      level: 'Not AI-Ready',
      description: 'Design system needs substantial work for AI integration'
    };
  }
}