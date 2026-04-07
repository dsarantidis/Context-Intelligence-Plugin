import type { Issue, Suggestion } from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RulesConfig {
  meta: {
    version: string;
    system: string;
    designSystem?: string;
    lastUpdated?: string;
  };
  contextMatchers?: ContextMatcher[];
  contexts?: Context[];
  rules: Rule[];
  textSuggestions?: Record<string, TextSuggestion>;
  variables?: Record<string, Variable>;
  componentDescriptions?: Record<string, ComponentDescription>;
  variantDescriptions?: Record<string, VariantDescription>;
  styleDescriptions?: Record<string, StyleDescription>;
  contextualOverrides?: ContextualOverride[];
}

export interface ContextMatcher {
  pattern: ContextPattern;
  maps_to: string;
}

export interface ContextPattern {
  nodeType?: string;
  namePattern?: string;
  nameContains?: string;
  nameEquals?: string;
  variantProperty?: string;
  variantValue?: string;
  hasChildren?: boolean;
  childCount?: {
    min?: number;
    max?: number;
  };
}

export interface Context {
  id: string;
  type: 'component' | 'state' | 'layout' | 'token' | 'style';
  extends?: string;
  expects: string[];
  optional?: string[];
}

export interface Rule {
  id: string;
  when: RuleWhen;
  then: RuleThen;
}

export interface RuleWhen {
  context: string; // Supports wildcards: "component.*"
  missing?: string;
  conditions?: RuleCondition[];
}

export interface RuleCondition {
  property: string;
  equals?: any;
  notEquals?: any;
  contains?: string;
  missing?: boolean;
  pattern?: string;
  oneOf?: any[];
  lessThan?: number;
  greaterThan?: number;
}

export interface RuleThen {
  severity: 'critical' | 'warning' | 'info';
  suggestion: Suggestion;
}

export interface TextSuggestion {
  text?: string;
  template?: string;
  placeholders?: Record<string, Record<string, string>>;
}

export interface Variable {
  type: 'color' | 'number' | 'string' | 'boolean';
  value: any;
  usage?: string;
  scopes?: string[];
  appliesTo?: string[];
}

export interface ComponentDescription {
  description: string;
  usage?: string;
  dosDonts?: {
    dos?: string[];
    donts?: string[];
  };
}

export interface VariantDescription {
  description: string;
}

export interface StyleDescription {
  description: string;
  usage?: string;
}

export interface ContextualOverride {
  context: string;
  source: string;
  override: any;
}

export interface DetectedContext {
  id: string;
  node: SceneNode;
  properties: Map<string, any>;
}

// ============================================================================
// RULE ENGINE
// ============================================================================

export class RuleEngine {
  private config: RulesConfig;
  private contextCache: Map<string, Context> = new Map();

  constructor(config: RulesConfig) {
    this.config = config;
    this.buildContextCache();
  }

  /**
   * Build cache of contexts with inheritance resolved.
   * If config has no contexts, seed with minimal defaults so component/component_set rules can run.
   */
  private buildContextCache() {
    const contexts = this.config.contexts;
    if (contexts && contexts.length > 0) {
      for (const context of contexts) {
        const resolved = this.resolveContext(context);
        this.contextCache.set(context.id, resolved);
      }
      return;
    }
    // Fallback: allow rules to run when contexts are not in JSON (e.g. sample-rules)
    const defaultContexts: Context[] = [
      { id: 'component.default', type: 'component', expects: ['description'] },
      { id: 'component_set.default', type: 'component', expects: ['description'] }
    ];
    for (const context of defaultContexts) {
      this.contextCache.set(context.id, context);
    }
  }

  /**
   * Resolve context inheritance (extends)
   */
  private resolveContext(context: Context): Context {
    if (!context.extends) {
      return context;
    }

    const parent = this.config.contexts?.find(c => c.id === context.extends);
    if (!parent) {
      console.warn(`Context ${context.id} extends ${context.extends} but parent not found`);
      return context;
    }

    const resolvedParent = this.resolveContext(parent);
    
    return {
      ...context,
      expects: [...resolvedParent.expects, ...context.expects],
      optional: [...(resolvedParent.optional || []), ...(context.optional || [])]
    };
  }

  /**
   * Main detection method: analyze a node and return issues
   */
  async detect(node: SceneNode): Promise<Issue[]> {
    const issues: Issue[] = [];

    // 1. Extract context
    const detectedContext = this.extractContext(node);
    if (!detectedContext) {
      return issues; // No matching context
    }

    // 2. Get context definition
    const contextDef = this.contextCache.get(detectedContext.id);
    if (!contextDef) {
      return issues;
    }

    // 3. Check expected fields
    const missing = this.findMissingFields(detectedContext, contextDef);

    // 4. Run rules
    const matchedRules = this.matchRules(detectedContext, missing);

    // 5. Generate issues from matched rules
    for (const rule of matchedRules) {
      const issue = await this.generateIssue(rule, detectedContext);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  /**
   * Extract context from a Figma node.
   * If contextMatchers are missing, infer from node.type so component/variant rules still run.
   */
  private extractContext(node: SceneNode): DetectedContext | null {
    if (this.config.contextMatchers && this.config.contextMatchers.length > 0) {
      for (const matcher of this.config.contextMatchers) {
        if (this.matchesPattern(node, matcher.pattern)) {
          return {
            id: matcher.maps_to,
            node,
            properties: this.extractProperties(node)
          };
        }
      }
      return null;
    }
    // Fallback: infer context from node type so rules like variant_missing_unique_description run
    const contextId = node.type === 'COMPONENT_SET' ? 'component_set.default' : 'component.default';
    return {
      id: contextId,
      node,
      properties: this.extractProperties(node)
    };
  }

  /**
   * Check if node matches a pattern
   */
  private matchesPattern(node: SceneNode, pattern: ContextPattern): boolean {
    // Check node type
    if (pattern.nodeType && node.type !== pattern.nodeType) {
      return false;
    }

    // Check name pattern (regex)
    if (pattern.namePattern) {
      const regex = new RegExp(pattern.namePattern);
      if (!regex.test(node.name)) {
        return false;
      }
    }

    // Check name contains
    if (pattern.nameContains && !node.name.includes(pattern.nameContains)) {
      return false;
    }

    // Check name equals
    if (pattern.nameEquals && node.name !== pattern.nameEquals) {
      return false;
    }

    // Check variant property
    if (pattern.variantProperty) {
      if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        const hasVariant = 'variantProperties' in node && 
          node.variantProperties && 
          pattern.variantProperty in node.variantProperties;
        
        if (!hasVariant) {
          return false;
        }

        // Check variant value if specified
        if (pattern.variantValue) {
          const actualValue = (node as any).variantProperties[pattern.variantProperty];
          if (actualValue !== pattern.variantValue) {
            return false;
          }
        }
      } else {
        return false;
      }
    }

    // Check has children
    if (pattern.hasChildren !== undefined) {
      const hasChildren = 'children' in node && node.children.length > 0;
      if (hasChildren !== pattern.hasChildren) {
        return false;
      }
    }

    // Check child count
    if (pattern.childCount && 'children' in node) {
      const count = node.children.length;
      if (pattern.childCount.min !== undefined && count < pattern.childCount.min) {
        return false;
      }
      if (pattern.childCount.max !== undefined && count > pattern.childCount.max) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extract properties from node
   */
  private extractProperties(node: SceneNode): Map<string, any> {
    const props = new Map<string, any>();

    props.set('name', node.name);
    props.set('type', node.type);

    // Parent (for variant-in-set detection)
    if (node.parent && 'type' in node.parent) {
      props.set('parent.type', (node.parent as SceneNode).type);
      props.set('parent.name', (node.parent as SceneNode).name);
    }

    // Description (and length for rules like description_too_short)
    if ('description' in node) {
      const desc = node.description ?? '';
      props.set('description', desc);
      props.set('description.length', typeof desc === 'string' ? desc.length : 0);
    }

    // Variants
    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      if ('variantProperties' in node && node.variantProperties) {
        props.set('variants', node.variantProperties);
        
        // Individual variant properties
        for (const [key, value] of Object.entries(node.variantProperties)) {
          props.set(`variant.${key}`, value);
        }
      }
    }

    // Children
    if ('children' in node) {
      props.set('children', node.children);
      props.set('childCount', node.children.length);
    }

    // Component properties
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && 'componentPropertyDefinitions' in node) {
      props.set('componentProperties', node.componentPropertyDefinitions);
    }

    return props;
  }

  /**
   * Find missing expected fields
   */
  private findMissingFields(context: DetectedContext, definition: Context): string[] {
    const missing: string[] = [];

    for (const expected of definition.expects) {
      // Check if property exists and has value
      const value = context.properties.get(expected);
      
      if (value === undefined || value === null || value === '') {
        missing.push(expected);
      }
    }

    return missing;
  }

  /**
   * Match rules against context and missing fields
   */
  private matchRules(context: DetectedContext, missing: string[]): Rule[] {
    const matched: Rule[] = [];

    for (const rule of this.config.rules) {
      // Check context match (supports wildcards)
      if (!this.contextMatches(context.id, rule.when.context)) {
        continue;
      }

      // Check missing field
      if (rule.when.missing && !missing.includes(rule.when.missing)) {
        continue;
      }

      // Check additional conditions
      if (rule.when.conditions) {
        const allConditionsMet = rule.when.conditions.every(cond => 
          this.checkCondition(cond, context)
        );
        
        if (!allConditionsMet) {
          continue;
        }
      }

      matched.push(rule);
    }

    return matched;
  }

  /**
   * Check if context ID matches pattern (supports wildcards)
   */
  private contextMatches(contextId: string, pattern: string): boolean {
    if (pattern === contextId) {
      return true;
    }

    // Support wildcards: "component.*" matches "component.button.primary"
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return contextId.startsWith(prefix);
    }

    return false;
  }

  /**
   * Check a single condition
   */
  private checkCondition(condition: RuleCondition, context: DetectedContext): boolean {
    const value = context.properties.get(condition.property);

    // Check equals
    if (condition.equals !== undefined) {
      return value === condition.equals;
    }

    // Check not equals
    if (condition.notEquals !== undefined) {
      return value !== condition.notEquals;
    }

    // Check contains
    if (condition.contains !== undefined) {
      return typeof value === 'string' && value.includes(condition.contains);
    }

    // Check missing
    if (condition.missing !== undefined) {
      const isMissing = value === undefined || value === null || value === '';
      return condition.missing ? isMissing : !isMissing;
    }

    // Check numeric lessThan / greaterThan (e.g. description.length lessThan 30)
    if (condition.lessThan !== undefined) {
      const num = typeof value === 'number' ? value : (typeof value === 'string' ? value.length : Number(value));
      return !Number.isNaN(num) && num < condition.lessThan;
    }
    if (condition.greaterThan !== undefined) {
      const num = typeof value === 'number' ? value : (typeof value === 'string' ? value.length : Number(value));
      return !Number.isNaN(num) && num > condition.greaterThan;
    }

    // Check pattern
    if (condition.pattern !== undefined) {
      const regex = new RegExp(condition.pattern);
      return typeof value === 'string' && regex.test(value);
    }

    // Check oneOf
    if (condition.oneOf !== undefined) {
      return condition.oneOf.includes(value);
    }

    return false;
  }

  /**
   * Generate Issue from matched rule
   */
  private async generateIssue(rule: Rule, context: DetectedContext): Promise<Issue | null> {
    const suggestion = await this.resolveSuggestion(rule.then.suggestion, context);
    
    if (!suggestion) {
      return null;
    }

    const issue: Issue = {
      id: `${context.node.id}-${rule.id}`,
      category: rule.then.severity === 'critical' ? 'missing' : 'poor',
      severity: rule.then.severity,
      message: suggestion.message || this.generateDefaultMessage(rule),
      suggestion: suggestion.text || '',
      contextPoint: this.getContextPointName(rule.when.missing || ''),
      nodeId: context.node.id,
      nodeName: context.node.name,
      fixable: this.isSuggestionFixable(rule.then.suggestion),
      propertyPath: rule.when.missing,
      currentValue: context.properties.get(rule.when.missing || ''),
      ruleId: rule.id,
      suggestionConfig: rule.then.suggestion,
      fixState: 'pending'
    };

    // Pre-generate suggested value if it's a text suggestion
    if (rule.then.suggestion.type === 'text' && suggestion.text) {
      issue.suggestedValue = suggestion.text;
      issue.suggestedValueFormatted = suggestion.text;
    }

    return issue;
  }

  /**
   * Resolve suggestion from config
   */
  private async resolveSuggestion(suggestion: Suggestion, context: DetectedContext): Promise<{ text?: string; message?: string } | null> {
    // Direct message
    if (suggestion.message) {
      return { message: suggestion.message };
    }

    // Text suggestion from library
    if (suggestion.type === 'text' && suggestion.source) {
      const textSuggestion = this.config.textSuggestions?.[suggestion.source];
      if (textSuggestion) {
        return {
          text: this.fillTemplate(textSuggestion, context),
          message: `Apply suggested ${suggestion.source.replace(/_/g, ' ')}`
        };
      }
    }

    // Variable suggestion
    if (suggestion.type === 'variable' && suggestion.value) {
      const variable = this.config.variables?.[suggestion.value];
      if (variable) {
        return {
          text: `Apply ${suggestion.value}`,
          message: variable.usage || `Use ${suggestion.value} token`
        };
      }
    }

    // Direct value
    if (suggestion.value) {
      return {
        text: String(suggestion.value),
        message: `Apply: ${suggestion.value}`
      };
    }

    return null;
  }

  /**
   * Fill text template with placeholders
   */
  private fillTemplate(textSuggestion: TextSuggestion, context: DetectedContext): string {
    // Simple text
    if (textSuggestion.text) {
      return textSuggestion.text;
    }

    // Template with placeholders
    if (textSuggestion.template && textSuggestion.placeholders) {
      let result = textSuggestion.template;
      
      // Replace placeholders based on context
      for (const [placeholder, values] of Object.entries(textSuggestion.placeholders)) {
        // Try to infer value from context
        const contextValue = this.inferPlaceholderValue(placeholder, context);
        const replacement = values[contextValue] || values['default'] || '';
        
        result = result.replace(`{${placeholder}}`, replacement);
      }
      
      return result;
    }

    return '';
  }

  /**
   * Infer placeholder value from context
   */
  private inferPlaceholderValue(placeholder: string, context: DetectedContext): string {
    // Extract from variant properties
    const variants = context.properties.get('variants');
    if (variants && typeof variants === 'object') {
      // Try exact match
      if (placeholder in variants) {
        return String(variants[placeholder]).toLowerCase();
      }
      
      // Try common variant names
      if ('Type' in variants) {
        return String(variants['Type']).toLowerCase();
      }
      if ('State' in variants) {
        return String(variants['State']).toLowerCase();
      }
    }

    // Extract from node name
    const name = context.node.name.toLowerCase();
    if (name.includes('primary')) return 'primary';
    if (name.includes('secondary')) return 'secondary';
    if (name.includes('destructive')) return 'destructive';
    if (name.includes('error')) return 'error';
    if (name.includes('success')) return 'success';

    return 'default';
  }

  /**
   * Generate default message for rule
   */
  private generateDefaultMessage(rule: Rule): string {
    if (rule.when.missing) {
      return `Missing ${rule.when.missing.replace(/_/g, ' ')}`;
    }
    return `Context rule violation: ${rule.id}`;
  }

  /**
   * Get human-readable context point name
   */
  private getContextPointName(field: string): string {
    const mapping: Record<string, string> = {
      'description': 'Component Description',
      'color_variable': 'Color Variable',
      'variants': 'Variants',
      'call_to_action': 'Call to Action',
      'explanation': 'Explanation Text',
      'validation_rules': 'Validation Rules',
      'scopes': 'Token Scope'
    };

    return mapping[field] || field.replace(/_/g, ' ');
  }

  /**
   * Check if suggestion is auto-fixable
   */
  private isSuggestionFixable(suggestion: Suggestion): boolean {
    if (suggestion.action === undefined) return false;
    // 'add_component' requires manual action; other actions may be fixable
    if (suggestion.action === 'add_component') return false;
    return true;
  }
}