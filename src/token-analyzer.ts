/**
 * Token Analyzer
 * 
 * Analyzes design tokens (variables) and their usage.
 * Works without MCP for basic analysis.
 */

/// <reference types="@figma/plugin-typings" />

import type { TokenUsage, TokenIssue } from './types';

export class TokenAnalyzer {

  /**
   * Analyze token usage in a node
   */
  analyzeTokenUsage(node: SceneNode): TokenUsage {
    const usage: TokenUsage = {
      totalTokens: 0,
      usedTokens: 0,
      hardcodedValues: 0,
      tokenReferences: [],
      hardcodedProperties: [],
      issues: []
    };

    this.analyzeNodeTokens(node, usage);

    return usage;
  }

  /**
   * Analyze tokens in a single node
   */
  private analyzeNodeTokens(node: SceneNode, usage: TokenUsage): void {
    // Check fills for variables
    if ('fills' in node && Array.isArray(node.fills)) {
      node.fills.forEach((fill, index) => {
        if (fill.type === 'SOLID' && 'boundVariables' in fill) {
          // Has variable binding
          usage.usedTokens++;
          usage.totalTokens++;
          
          // Note: We can't get the actual variable without async API
          // Just track that it exists
          usage.tokenReferences.push({
            property: `fill[${index}]`,
            tokenName: 'variable-bound',
            tokenId: 'unknown'
          });
        } else if (fill.type === 'SOLID' && 'color' in fill) {
          // Hardcoded color
          usage.hardcodedValues++;
          usage.totalTokens++;
          usage.hardcodedProperties.push({
            property: `fill[${index}].color`,
            value: this.rgbToHex(fill.color),
            type: 'color'
          });
        }
      });
    }

    // Check strokes
    if ('strokes' in node && Array.isArray(node.strokes)) {
      node.strokes.forEach((stroke, index) => {
        if (stroke.type === 'SOLID' && 'boundVariables' in stroke) {
          usage.usedTokens++;
          usage.totalTokens++;
          usage.tokenReferences.push({
            property: `stroke[${index}]`,
            tokenName: 'variable-bound',
            tokenId: 'unknown'
          });
        } else if (stroke.type === 'SOLID' && 'color' in stroke) {
          usage.hardcodedValues++;
          usage.totalTokens++;
          usage.hardcodedProperties.push({
            property: `stroke[${index}].color`,
            value: this.rgbToHex(stroke.color),
            type: 'color'
          });
        }
      });
    }

    // Check text properties
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;
      
      // Check font size
      if (typeof textNode.fontSize === 'number') {
        usage.hardcodedValues++;
        usage.totalTokens++;
        usage.hardcodedProperties.push({
          property: 'fontSize',
          value: textNode.fontSize,
          type: 'number'
        });
      }

      // Check line height
      if ('lineHeight' in textNode && typeof textNode.lineHeight !== 'symbol') {
        usage.hardcodedValues++;
        usage.totalTokens++;
      }
    }

    // Check layout properties
    if ('paddingLeft' in node || 'itemSpacing' in node) {
      const frameNode = node as FrameNode;
      
      if (typeof frameNode.paddingLeft === 'number' && frameNode.paddingLeft > 0) {
        usage.hardcodedValues++;
        usage.totalTokens++;
        usage.hardcodedProperties.push({
          property: 'paddingLeft',
          value: frameNode.paddingLeft,
          type: 'number'
        });
      }

      if (typeof frameNode.itemSpacing === 'number' && frameNode.itemSpacing > 0) {
        usage.hardcodedValues++;
        usage.totalTokens++;
        usage.hardcodedProperties.push({
          property: 'itemSpacing',
          value: frameNode.itemSpacing,
          type: 'number'
        });
      }
    }

    // Check corner radius
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
      usage.hardcodedValues++;
      usage.totalTokens++;
      usage.hardcodedProperties.push({
        property: 'cornerRadius',
        value: node.cornerRadius,
        type: 'number'
      });
    }

    // Generate issues
    if (usage.hardcodedValues > usage.usedTokens) {
      usage.issues.push({
        type: 'warning',
        property: 'general',
        message: 'More hardcoded values than tokens',
        suggestion: 'Consider using design tokens for consistency'
      });
    }

    if (usage.hardcodedProperties.length > 5) {
      usage.issues.push({
        type: 'warning',
        property: 'general',
        message: `${usage.hardcodedProperties.length} hardcoded properties detected`,
        suggestion: 'Replace hardcoded values with design tokens'
      });
    }
  }

  /**
   * Analyze token coverage across multiple nodes
   */
  analyzeTokenCoverage(nodes: SceneNode[]): {
    totalNodes: number;
    nodesUsingTokens: number;
    nodesWithHardcoded: number;
    coveragePercentage: number;
  } {
    let nodesUsingTokens = 0;
    let nodesWithHardcoded = 0;

    nodes.forEach(node => {
      const usage = this.analyzeTokenUsage(node);
      
      if (usage.usedTokens > 0) {
        nodesUsingTokens++;
      }
      
      if (usage.hardcodedValues > 0) {
        nodesWithHardcoded++;
      }
    });

    const coveragePercentage = nodes.length > 0 
      ? Math.round((nodesUsingTokens / nodes.length) * 100)
      : 0;

    return {
      totalNodes: nodes.length,
      nodesUsingTokens,
      nodesWithHardcoded,
      coveragePercentage
    };
  }

  /**
   * Get local variables (for reference)
   */
  async getLocalVariables(): Promise<{ count: number; collections: string[] }> {
    try {
      const variables = await figma.variables.getLocalVariablesAsync();
      const collections = await figma.variables.getLocalVariableCollectionsAsync();

      return {
        count: variables.length,
        collections: collections.map(c => c.name)
      };
    } catch (error) {
      console.error('Error getting variables:', error);
      return {
        count: 0,
        collections: []
      };
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Convert RGB to hex
   */
  private rgbToHex(rgb: RGB): string {
    const r = Math.round(rgb.r * 255);
    const g = Math.round(rgb.g * 255);
    const b = Math.round(rgb.b * 255);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Check if value is likely a token value
   */
  private isLikelyTokenValue(value: any): boolean {
    // Check for common token patterns
    if (typeof value === 'number') {
      // Spacing tokens are usually multiples of 4 or 8
      return value % 4 === 0;
    }
    
    if (typeof value === 'string') {
      // Color tokens usually have specific patterns
      return /^(#[0-9A-Fa-f]{6}|rgba?\([^)]+\))$/.test(value);
    }

    return false;
  }
}