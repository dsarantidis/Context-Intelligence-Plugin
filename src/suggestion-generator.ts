/**
 * Suggestion Generator
 * 
 * Generates concrete suggestions from rules configuration
 */

import type { Suggestion, Issue } from './types';
import type { RulesConfig } from './rule-engine';

export class SuggestionGenerator {
  private rulesConfig: RulesConfig;

  constructor(rulesConfig: RulesConfig) {
    this.rulesConfig = rulesConfig;
  }

  /**
   * Generate concrete suggestion value for an issue
   */
  generateSuggestion(issue: Issue, node: SceneNode): { value: any; formatted: string } | null {
    if (!issue.suggestionConfig) {
      return null;
    }

    const config = issue.suggestionConfig;

    switch (config.type) {
      case 'text':
        return this.generateTextSuggestion(config, issue, node);
      
      case 'variable':
        return this.generateVariableSuggestion(config, issue, node);
      
      case 'component':
        return this.generateComponentSuggestion(config, issue, node);
      
      case 'action':
        return this.generateActionSuggestion(config, issue, node);
      
      default:
        return null;
    }
  }

  /**
   * Generate text suggestion (for descriptions, etc.)
   */
  private generateTextSuggestion(
    config: Suggestion, 
    issue: Issue, 
    node: SceneNode
  ): { value: string; formatted: string } | null {
    
    // If source is provided, look up template from textSuggestions
    if (config.source && this.rulesConfig.textSuggestions) {
      const template = this.rulesConfig.textSuggestions[config.source];
      
      if (!template) {
        console.warn(`Template not found: ${config.source}`);
        return null;
      }

      // Generate text from template
      const text = this.fillTemplate(template, node);
      
      return {
        value: text,
        formatted: text
      };
    }

    // If direct value provided
    if (config.value) {
      return {
        value: config.value,
        formatted: config.value
      };
    }

    return null;
  }

  /**
   * Fill template with placeholders
   */
  private fillTemplate(template: any, node: SceneNode): string {
    if (typeof template === 'string') {
      return template;
    }

    if (template.text) {
      return template.text;
    }

    if (template.template && template.placeholders) {
      let result = template.template;
      const context = this.detectContext(node);

      for (const [key, options] of Object.entries(template.placeholders)) {
        if (typeof options !== 'object') continue;
        const opts = options as Record<string, any>;
        let value: string;
        if (opts.property === 'name') {
          value = node.name || '';
        } else {
          value = this.findMatchingOption(opts, context);
        }
        result = result.replace(`{${key}}`, value || '');
      }
      return result;
    }

    return '';
  }

  /**
   * Detect context from node
   */
  private detectContext(node: SceneNode): Record<string, string> {
    const context: Record<string, string> = {};
    
    // Extract from node name (e.g., "Button/Primary" -> type=primary)
    const nameParts = node.name.split('/');
    if (nameParts.length > 1) {
      context.variant = nameParts[nameParts.length - 1].toLowerCase();
      context.component = nameParts[0].toLowerCase();
    }

    // Extract from variant properties
    if (node.type === 'COMPONENT' && 'variantProperties' in node && node.variantProperties) {
      for (const [key, value] of Object.entries(node.variantProperties)) {
        context[key.toLowerCase()] = String(value).toLowerCase();
      }
    }

    return context;
  }

  /**
   * Find matching option from placeholders
   */
  private findMatchingOption(options: Record<string, any>, context: Record<string, string>): string {
    for (const [, value] of Object.entries(context)) {
      if (options[value]) return options[value];
      const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
      if (options[capitalized]) return options[capitalized];
    }
    const firstKey = Object.keys(options)[0];
    return firstKey === 'property' ? '' : (options[firstKey] || '');
  }

  /**
   * Generate variable suggestion
   */
  private generateVariableSuggestion(
    config: Suggestion,
    issue: Issue,
    node: SceneNode
  ): { value: any; formatted: string } | null {
    
    if (!config.value) {
      return null;
    }

    // Look up variable in config
    const variables = this.rulesConfig.variables || {};
    const varDef = variables[config.value];

    if (!varDef) {
      return {
        value: config.value,
        formatted: `Variable: ${config.value}`
      };
    }

    return {
      value: {
        variableId: config.value,
        variableName: config.value,
        ...varDef
      },
      formatted: `${config.value} (${varDef.usage || 'Design token'})`
    };
  }

  /**
   * Generate component suggestion
   */
  private generateComponentSuggestion(
    config: Suggestion,
    issue: Issue,
    node: SceneNode
  ): { value: any; formatted: string } | null {
    
    if (!config.value) {
      return null;
    }

    return {
      value: config.value,
      formatted: `Component: ${config.value}`
    };
  }

  /**
   * Generate action suggestion
   */
  private generateActionSuggestion(
    config: Suggestion,
    issue: Issue,
    node: SceneNode
  ): { value: any; formatted: string } | null {
    
    return {
      value: {
        action: config.action,
        message: config.message
      },
      formatted: config.message || `Action: ${config.action}`
    };
  }

  /**
   * Generate variant description suggestion
   */
  generateVariantDescription(
    variantProperty: string,
    variantValue: string | undefined,
    node: SceneNode
  ): string | null {
    
    // Look up in variantDescriptions
    if (this.rulesConfig.variantDescriptions) {
      const key = `${node.name.toLowerCase()}.${variantProperty.toLowerCase()}.${variantValue?.toLowerCase() || ''}`;
      
      if (this.rulesConfig.variantDescriptions[key]) {
        return this.rulesConfig.variantDescriptions[key].description;
      }

      // Try without value
      const keyWithoutValue = `${node.name.toLowerCase()}.${variantProperty.toLowerCase()}`;
      if (this.rulesConfig.variantDescriptions[keyWithoutValue]) {
        return this.rulesConfig.variantDescriptions[keyWithoutValue].description;
      }
    }

    // Generate generic description
    return `${variantProperty} variant${variantValue ? ` - ${variantValue}` : ''}`;
  }

  /**
   * Generate component description suggestion
   */
  generateComponentDescription(node: SceneNode): string | null {
    // Look up in componentDescriptions
    if (this.rulesConfig.componentDescriptions) {
      const key = node.name.toLowerCase().replace('/', '.');
      
      if (this.rulesConfig.componentDescriptions[key]) {
        const desc = this.rulesConfig.componentDescriptions[key];
        let result = desc.description;
        
        if (desc.usage) {
          result += `\n\nUsage: ${desc.usage}`;
        }
        
        return result;
      }
    }

    return null;
  }
}
