// EnrichedAnalyzer - Enhanced analysis με MCP-enriched data
// Επεκτείνει το ComponentAnalyzer με token coverage, semantic validation, κλπ

import type {
  EnrichedComponentAudit,
  ComponentAudit,
  TokenCoverage,
  HardcodedValue,
  SemanticViolation,
  TokenSuggestion,
  Finding
} from './types';
import { ComponentAnalyzer } from './component-analyzer';
import { TokenAnalyzer } from './token-analyzer';
import { MCPBridge } from './mcp-bridge';
import { ScoringCalculator } from './scoring-calculator';

/**
 * EnrichedAnalyzer Class
 * 
 * Combines:
 * - Basic component analysis (existing)
 * - MCP-enriched data (token coverage, exports)
 * - Semantic token validation
 * - Hardcoded value detection
 * - Visual consistency checks
 * 
 * Architecture:
 * ComponentAnalyzer → EnrichedAnalyzer → MCPBridge → Figma Console MCP
 */
export class EnrichedAnalyzer {
  private componentAnalyzer: ComponentAnalyzer;
  private tokenAnalyzer: TokenAnalyzer;
  private mcpBridge: MCPBridge;
  private scoringCalculator: ScoringCalculator;

  constructor(
    mcpBridge: MCPBridge,
    componentAnalyzer?: ComponentAnalyzer,
    tokenAnalyzer?: TokenAnalyzer,
    scoringCalculator?: ScoringCalculator
  ) {
    this.mcpBridge = mcpBridge;
    this.componentAnalyzer = componentAnalyzer || new ComponentAnalyzer();
    this.tokenAnalyzer = tokenAnalyzer || new TokenAnalyzer();
    this.scoringCalculator = scoringCalculator || new ScoringCalculator();
  }

  // ============================================================================
  // Main Analysis Methods
  // ============================================================================

  /**
   * Analyze component με full MCP enrichment
   */
  async analyzeComponentWithEnrichment(
    node: ComponentNode | ComponentSetNode
  ): Promise<EnrichedComponentAudit> {
    console.log(`[EnrichedAnalyzer] Analyzing ${node.name} with enrichment...`);

    // Step 1: Get basic audit (existing functionality)
    const basicAudit = await this.componentAnalyzer.analyzeComponent(node);

    // Step 2: Try to get MCP-enriched data
    let tokenCoverage: TokenCoverage | undefined;
    let semanticTokens: EnrichedComponentAudit['semanticTokens'] | undefined;
    let exports: EnrichedComponentAudit['exports'] | undefined;

    try {
      // Check if MCP is connected
      if (this.mcpBridge.getConnectionStatus()) {
        // Get component metadata με token coverage
        const metadata = await this.mcpBridge.getComponentMetadata(node.id, {
          enrich: true
        });

        tokenCoverage = metadata.tokenCoverage;

        // Perform semantic token validation
        if (tokenCoverage) {
          semanticTokens = await this.validateSemanticTokens(node, tokenCoverage);
        }

        // Get export code (optional)
        if (metadata.tokenCoverage && metadata.tokenCoverage.percentage > 80) {
          // Only export if well-tokenized
          exports = await this.generateExports(node);
        }
      }
    } catch (error) {
      console.warn('[EnrichedAnalyzer] MCP enrichment failed, using basic audit only:', error);
      // Continue with basic audit if MCP fails
    }

    // Step 3: Combine findings
    const enrichedFindings = this.generateEnrichedFindings(
      basicAudit,
      tokenCoverage,
      semanticTokens
    );

    // Step 4: Recalculate score with enriched data
    const enrichedScore = this.calculateEnrichedScore(
      basicAudit.score,
      tokenCoverage,
      semanticTokens
    );

    // Return enriched audit
    return {
      ...basicAudit,
      score: enrichedScore,
      findings: enrichedFindings,
      tokenCoverage,
      semanticTokens,
      exports
    };
  }

  /**
   * Batch analyze με progress tracking
   */
  async analyzeBatch(
    nodes: readonly (ComponentNode | ComponentSetNode)[],
    onProgress?: (current: number, total: number) => void
  ): Promise<EnrichedComponentAudit[]> {
    const results: EnrichedComponentAudit[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      if (onProgress) {
        onProgress(i + 1, nodes.length);
      }

      const audit = await this.analyzeComponentWithEnrichment(node);
      results.push(audit);

      // Small delay to prevent blocking
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return results;
  }

  // ============================================================================
  // Token Coverage Analysis
  // ============================================================================

  /**
   * Check for hardcoded values που πρέπει να γίνουν tokens
   */
  async checkHardcodedValues(node: SceneNode): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      // Get metadata from MCP
      const metadata = await this.mcpBridge.getComponentMetadata(node.id, {
        enrich: true
      });

      if (!metadata.hardcodedValues || metadata.hardcodedValues.length === 0) {
        findings.push({
          severity: 'info',
          category: 'context',
          message: 'No hardcoded values detected. All properties use design tokens.',
          impact: 0
        });
        return findings;
      }

      // Group by confidence level
      const highConfidence = metadata.hardcodedValues.filter(v => (v.confidence || 0) > 0.8);
      const mediumConfidence = metadata.hardcodedValues.filter(v => 
        (v.confidence || 0) > 0.5 && (v.confidence || 0) <= 0.8
      );

      // High confidence hardcoded values = critical
      if (highConfidence.length > 0) {
        findings.push({
          severity: 'critical',
          category: 'context',
          message: `Found ${highConfidence.length} hardcoded value(s) that should use tokens`,
          impact: 0.3,
          suggestion: this.formatHardcodedSuggestions(highConfidence)
        });
      }

      // Medium confidence = warnings
      if (mediumConfidence.length > 0) {
        findings.push({
          severity: 'warning',
          category: 'context',
          message: `Found ${mediumConfidence.length} potential hardcoded value(s)`,
          impact: 0.1,
          suggestion: this.formatHardcodedSuggestions(mediumConfidence)
        });
      }

    } catch (error) {
      console.warn('[EnrichedAnalyzer] Hardcoded value check failed:', error);
      // Return empty findings if MCP fails
    }

    return findings;
  }

  /**
   * Calculate token coverage percentage
   */
  async checkTokenCoverage(node: SceneNode): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      const metadata = await this.mcpBridge.getComponentMetadata(node.id, {
        enrich: true
      });

      const coverage = metadata.tokenCoverage;
      if (!coverage) {
        return findings;
      }

      // Coverage thresholds
      if (coverage.percentage >= 90) {
        findings.push({
          severity: 'info',
          category: 'context',
          message: `Excellent token coverage: ${coverage.percentage.toFixed(1)}%`,
          impact: 0,
          suggestion: `${coverage.usingTokens}/${coverage.total} properties use design tokens`
        });
      } else if (coverage.percentage >= 70) {
        findings.push({
          severity: 'info',
          category: 'context',
          message: `Good token coverage: ${coverage.percentage.toFixed(1)}%`,
          impact: 0.05,
          suggestion: `Consider tokenizing ${coverage.hardcoded} remaining properties`
        });
      } else if (coverage.percentage >= 50) {
        findings.push({
          severity: 'warning',
          category: 'context',
          message: `Moderate token coverage: ${coverage.percentage.toFixed(1)}%`,
          impact: 0.15,
          suggestion: `${coverage.hardcoded} properties still use hardcoded values`
        });
      } else {
        findings.push({
          severity: 'critical',
          category: 'context',
          message: `Low token coverage: ${coverage.percentage.toFixed(1)}%`,
          impact: 0.25,
          suggestion: `Only ${coverage.usingTokens}/${coverage.total} properties use tokens. Consider refactoring.`
        });
      }

    } catch (error) {
      console.warn('[EnrichedAnalyzer] Token coverage check failed:', error);
    }

    return findings;
  }

  // ============================================================================
  // Semantic Token Validation
  // ============================================================================

  /**
   * Validate semantic token usage
   * e.g., checking if "background" properties use semantic background tokens
   */
  async validateSemanticTokens(
    node: SceneNode,
    coverage: TokenCoverage
  ): Promise<EnrichedComponentAudit['semanticTokens']> {
    const correct: string[] = [];
    const incorrect: SemanticViolation[] = [];
    const suggestions: TokenSuggestion[] = [];

    try {
      // Get all variables for semantic analysis
      const variablesData = await this.mcpBridge.getEnrichedVariables({
        resolveAliases: true
      });

      // Analyze each used token
      for (const tokenName of coverage.usedTokens ?? []) {
        const semanticCheck = this.checkSemanticConsistency(
          tokenName,
          variablesData.variables
        );

        if (semanticCheck.isCorrect) {
          correct.push(tokenName);
        } else if (semanticCheck.violation) {
          incorrect.push(semanticCheck.violation);
        }

        if (semanticCheck.suggestion) {
          suggestions.push(semanticCheck.suggestion);
        }
      }

      // Check missing tokens for semantic opportunities
      for (const missing of coverage.missingTokens ?? []) {
        const suggestion = this.suggestSemanticToken(
          missing.property,
          missing.currentValue,
          variablesData.variables
        );

        if (suggestion) {
          suggestions.push(suggestion);
        }
      }

    } catch (error) {
      console.warn('[EnrichedAnalyzer] Semantic validation failed:', error);
    }

    return {
      correct,
      incorrect,
      suggestions
    };
  }

  /**
   * Check if a token follows semantic naming conventions
   */
  private checkSemanticConsistency(
    tokenName: string,
    allVariables: any[]
  ): {
    isCorrect: boolean;
    violation?: SemanticViolation;
    suggestion?: TokenSuggestion;
  } {
    // Example: Check if background tokens follow "bg-" or "background-" pattern
    // This is simplified - real implementation would be more sophisticated

    // Split token name into parts
    const parts = tokenName.split('/');
    const lastPart = parts[parts.length - 1];

    // Define semantic patterns
    const semanticPatterns = {
      background: ['bg', 'background', 'surface'],
      text: ['text', 'fg', 'foreground', 'content'],
      border: ['border', 'stroke', 'outline'],
      interactive: ['primary', 'secondary', 'accent', 'action']
    };

    // Check consistency
    // (Simplified - real implementation would be more detailed)
    
    return {
      isCorrect: true // Default to correct for now
    };
  }

  /**
   * Suggest semantic token για hardcoded value
   */
  private suggestSemanticToken(
    property: string,
    value: any,
    allVariables: any[]
  ): TokenSuggestion | undefined {
    // Example logic - would be more sophisticated in production
    
    // If property is "fills" and value is a color
    if (property === 'fills' && typeof value === 'string') {
      // Find matching color tokens
      const colorTokens = allVariables.filter(v => 
        v.resolvedType === 'COLOR' && 
        v.name.includes('background')
      );

      if (colorTokens.length > 0) {
        return {
          property,
          suggestedToken: colorTokens[0].name,
          reason: 'Background color should use semantic background token',
          confidence: 0.8
        };
      }
    }

    return undefined;
  }

  // ============================================================================
  // Export Generation
  // ============================================================================

  /**
   * Generate CSS/Tailwind/TS exports για well-tokenized components
   */
  private async generateExports(node: SceneNode): Promise<{
    css?: string;
    tailwind?: string;
    typescript?: string;
  }> {
    try {
      // Get enriched data με exports
      const metadata = await this.mcpBridge.getComponentMetadata(node.id, {
        enrich: true
      });

      // Extract exports if available
      // (Simplified - real implementation would construct exports from metadata)
      
      return {
        css: '/* CSS export would be generated here */',
        tailwind: '/* Tailwind config would be generated here */',
        typescript: '/* TypeScript types would be generated here */'
      };

    } catch (error) {
      console.warn('[EnrichedAnalyzer] Export generation failed:', error);
      return {};
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Generate enhanced findings combining basic + MCP data
   */
  private generateEnrichedFindings(
    basicAudit: ComponentAudit,
    tokenCoverage?: TokenCoverage,
    semanticTokens?: EnrichedComponentAudit['semanticTokens']
  ): Finding[] {
    // Map component audit issues to Finding shape
    const findings: Finding[] = basicAudit.issues.map(issue => ({
      severity: issue.severity,
      category: issue.category,
      message: issue.message,
      suggestion: issue.suggestion
    }));

    // Add token coverage findings
    if (tokenCoverage) {
      if (tokenCoverage.percentage < 70) {
        findings.push({
          severity: 'warning',
          category: 'context',
          message: `Token coverage is ${tokenCoverage.percentage.toFixed(1)}% (target: 70%+)`,
          impact: 0.15,
          suggestion: `${tokenCoverage.hardcoded} properties could be tokenized`
        });
      }
    }

    // Add semantic token findings
    if (semanticTokens && semanticTokens.incorrect.length > 0) {
      findings.push({
        severity: 'warning',
        category: 'context',
        message: `${semanticTokens.incorrect.length} semantic token violation(s)`,
        impact: 0.1,
        suggestion: 'Review token naming conventions'
      });
    }

    return findings;
  }

  /**
   * Calculate enhanced score με token coverage penalty/bonus
   */
  private calculateEnrichedScore(
    basicScore: number,
    tokenCoverage?: TokenCoverage,
    semanticTokens?: EnrichedComponentAudit['semanticTokens']
  ): number {
    let score = basicScore;

    // Token coverage bonus/penalty (up to ±10 points)
    if (tokenCoverage) {
      const coverageBonus = (tokenCoverage.percentage - 70) * 0.2;
      score += Math.max(-10, Math.min(10, coverageBonus));
    }

    // Semantic token penalty (up to -5 points)
    if (semanticTokens && semanticTokens.incorrect.length > 0) {
      score -= Math.min(5, semanticTokens.incorrect.length * 2);
    }

    // Ensure score stays in 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Format hardcoded value suggestions
   */
  private formatHardcodedSuggestions(values: HardcodedValue[]): string {
    if (values.length === 0) return '';

    const suggestions = values
      .slice(0, 3) // Show max 3 examples
      .map(v => {
        if (v.suggestedToken) {
          return `${v.property}: "${v.value}" → ${v.suggestedToken}`;
        }
        return `${v.property}: "${v.value}"`;
      })
      .join(', ');

    if (values.length > 3) {
      return `${suggestions} (+${values.length - 3} more)`;
    }

    return suggestions;
  }
}
