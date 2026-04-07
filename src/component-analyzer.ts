import type { ComponentAudit, ComponentChecks, Issue, VariantInfo } from './types';
import { RuleEngine, type RulesConfig } from './rule-engine';

export class ComponentAnalyzer {
  private ruleEngine: RuleEngine | null = null;
  private hasRulesConfig: boolean = false;
  public cancelled: boolean = false;

  /**
   * Initialize with optional rules configuration
   */
  constructor(rulesConfig?: RulesConfig) {
    if (rulesConfig) {
      this.ruleEngine = new RuleEngine(rulesConfig);
      this.hasRulesConfig = true;
    }
  }

  /**
   * Analyze a component node.
   * For COMPONENT_SET nodes, uses a lightweight fast-path to avoid hanging
   * on sets with hundreds of variants.
   * Falls back to legacy checks if no rules config provided.
   */
  async analyzeComponent(node: SceneNode): Promise<ComponentAudit> {
    // Fast path for COMPONENT_SET: avoid expensive recursive tree walks
    if (node.type === 'COMPONENT_SET') {
      return this.analyzeComponentSetFast(node);
    }

    // If rule engine available, use it
    if (this.ruleEngine) {
      return this.analyzeWithRules(node);
    }

    // Otherwise use legacy hardcoded checks
    return this.analyzeLegacy(node);
  }

  /**
   * Fast analysis for COMPONENT_SET that avoids recursive tree walks.
   * Only checks: set description, doc link, naming, property descriptions,
   * and individual variant descriptions (capped).
   */
  private async analyzeComponentSetFast(node: SceneNode): Promise<ComponentAudit> {
    const issues: Issue[] = [];
    let score = 100;

    // 1. Check set-level naming
    const properNaming = this.checkNaming(node);
    if (!properNaming.isValid) {
      issues.push({
        id: `${node.id}-naming`,
        category: 'missing',
        severity: 'critical',
        message: 'Component set has generic or placeholder name',
        suggestion: 'Rename to follow naming conventions (e.g., Button, Card/Product)',
        contextPoint: 'Component Name',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'name',
        currentValue: node.name,
        fixState: 'pending'
      });
      score -= 20;
    }

    // 2. Check set-level description
    const hasDescription = this.checkDescription(node);
    if (!hasDescription.hasDescription) {
      issues.push({
        id: `${node.id}-description`,
        category: 'missing',
        severity: 'critical',
        message: 'Component set missing description',
        suggestion: 'Add a description explaining purpose, usage, and behavior of this component family',
        contextPoint: 'Component Set Description',
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        fixable: true,
        propertyPath: 'description',
        currentValue: hasDescription.description,
        fixState: 'pending'
      });
      score -= 20;
    } else if (hasDescription.description && hasDescription.description.length < 20) {
      issues.push({
        id: `${node.id}-poor-description`,
        category: 'poor',
        severity: 'warning',
        message: 'Component set description is too brief',
        suggestion: 'Expand description with details about usage, states, and best practices',
        contextPoint: 'Component Description',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'description',
        currentValue: hasDescription.description,
        fixState: 'pending'
      });
      score -= 8;
    }

    // 3. Check documentation link
    const hasDocLink = this.checkDocumentationLink(node);
    if (!hasDocLink) {
      issues.push({
        id: `${node.id}-doc-link`,
        category: 'missing',
        severity: 'critical',
        message: 'Component set missing documentation link',
        suggestion: 'Add a link to external documentation (e.g., Storybook, Figma, Confluence)',
        contextPoint: 'Documentation Link',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'documentationLinks',
        currentValue: [],
        fixState: 'pending'
      });
      score -= 15;
    }

    // 4. Property descriptions check removed — Figma has no API to add them
    const hasPropDescs = true;

    // 5. Extract properties and variants (lightweight — no tree walk)
    const properties = this.extractProperties(node);
    const variants = this.extractVariants(node);

    // 6. Check variant property descriptions (the variant axes, not individual components)
    const hasVariantDescs = this.checkVariantDescriptions(variants);
    if (!hasVariantDescs && variants.length > 0) {
      variants.forEach(variant => {
        if (!variant.description) {
          issues.push({
            id: `${node.id}-variant-${variant.property}-desc`,
            category: 'missing',
            severity: 'warning',
            message: `Variant axis "${variant.property}" missing description`,
            suggestion: `Describe the purpose of the "${variant.property}" variant property`,
            contextPoint: 'Variant Descriptions',
            nodeId: node.id,
            nodeName: node.name,
            fixable: true,
            propertyPath: 'variantProperties',
            variantProperty: variant.property,
            fixState: 'pending'
          });
          score -= 5;
        }
      });
    }

    // 7. Check individual variant component descriptions (CAPPED)
    if ('children' in node) {
      const components = node.children.filter(child => child.type === 'COMPONENT');
      const MAX_VARIANT_CHECK = 30;
      const toCheck = components.slice(0, MAX_VARIANT_CHECK);

      for (const component of toCheck) {
        if (this.cancelled) break;
        const compDesc = this.checkDescription(component);
        if (!compDesc.hasDescription) {
          issues.push({
            id: `${component.id}-variant-component-description`,
            category: 'missing',
            severity: 'warning',
            message: `Variant "${component.name}" missing description`,
            suggestion: `Add a description for the "${component.name}" variant`,
            contextPoint: 'Variant Component Description',
            nodeId: component.id,
            nodeName: component.name,
            nodeType: component.type,
            fixable: true,
            propertyPath: 'description',
            currentValue: compDesc.description,
            fixState: 'pending',
            ruleId: 'variant_missing_unique_description',
            suggestionConfig: { type: 'text', source: 'variant_specific_template', action: 'fill_description' }
          });
          score -= 5;
        }
        // Yield every 10 to keep responsive
        if (toCheck.indexOf(component) % 10 === 9) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (components.length > MAX_VARIANT_CHECK) {
        issues.push({
          id: `${node.id}-variants-capped`,
          category: 'poor',
          severity: 'info',
          message: `Only first ${MAX_VARIANT_CHECK} of ${components.length} variants were checked`,
          suggestion: 'Consider scanning individual variants for a complete audit',
          contextPoint: 'Scan Coverage',
          nodeId: node.id,
          nodeName: node.name,
          fixable: false,
          fixState: 'pending'
        });
      }
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      score: Math.max(0, score),
      checks: {
        hasDescription: hasDescription.hasDescription,
        hasVariants: variants.length > 0,
        hasProperties: properties.length > 0,
        hasDocumentation: false,
        hasDocumentationLink: hasDocLink,
        properNaming: properNaming.isValid,
        hasLayerNames: true,
        hasPropertyDescriptions: hasPropDescs,
        hasVariantDescriptions: hasVariantDescs
      },
      issues,
      properties,
      variants,
      description: hasDescription.description,
      documentationLinks: this.getDocumentationLinks(node),
      variantDescriptions: this.collectVariantDescriptions(node),
    };
  }

  /**
   * NEW: Rule-based analysis
   */
  private async analyzeWithRules(node: SceneNode): Promise<ComponentAudit> {
    // Detect issues using rule engine (for the node itself, e.g. set-level or single component)
    const issues = await this.ruleEngine!.detect(node);

    // When scanning a component set, also check each variant so we catch "variant missing description"
    // even if the parent set has a description (capped to avoid hanging on large sets)
    if (node.type === 'COMPONENT_SET' && 'children' in node) {
      const variantChildren = node.children.filter((child): child is ComponentNode => child.type === 'COMPONENT');
      const MAX_VARIANT_RULES_CHECK = 50;
      const limit = Math.min(variantChildren.length, MAX_VARIANT_RULES_CHECK);
      for (let i = 0; i < limit; i++) {
        if (this.cancelled) break;
        // Yield every 10 variants to keep UI responsive
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
        const variantIssues = await this.ruleEngine!.detect(variantChildren[i]);
        issues.push(...variantIssues);
      }
      if (variantChildren.length > MAX_VARIANT_RULES_CHECK) {
        console.log(`  ⚠️ Capped variant check at ${MAX_VARIANT_RULES_CHECK}/${variantChildren.length} variants`);
      }
    }

    // Calculate score from issues
    let score = 100;
    for (const issue of issues) {
      if (issue.category === 'missing') {
        if (issue.severity === 'critical') score -= 20;
        else if (issue.severity === 'warning') score -= 15;
        else score -= 10;
      } else {
        if (issue.severity === 'critical') score -= 10;
        else if (issue.severity === 'warning') score -= 8;
        else score -= 5;
      }
    }

    // Extract checks from issues
    const checks = this.extractChecksFromIssues(issues);

    // Extract properties and variants (if component)
    const properties = this.extractProperties(node);
    const variants = this.extractVariants(node);

    const descCheck = this.checkDescription(node);
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      score: Math.max(0, score),
      checks,
      issues,
      properties,
      variants,
      description: descCheck.description,
      documentationLinks: this.getDocumentationLinks(node),
      variantDescriptions: this.collectVariantDescriptions(node),
    };
  }

  /**
   * LEGACY: Hardcoded checks (backward compatibility)
   */
  private analyzeLegacy(node: SceneNode): ComponentAudit {
    const issues: Issue[] = [];
    let score = 100;

    // Check proper naming
    const properNaming = this.checkNaming(node);
    if (!properNaming.isValid) {
      issues.push({
        id: `${node.id}-naming`,
        category: 'missing',
        severity: 'critical',
        message: 'Component has generic or placeholder name',
        suggestion: 'Rename component to follow naming conventions (e.g., Button/Primary, Card/Product)',
        contextPoint: 'Component Name',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'name',
        currentValue: node.name,
        fixState: 'pending'
      });
      score -= 20;
    }

    // Check description
    const hasDescription = this.checkDescription(node);
    if (!hasDescription.hasDescription) {
      issues.push({
        id: `${node.id}-description`,
        category: 'missing',
        severity: 'critical',
        message: 'Component missing description',
        suggestion: 'Add a description explaining purpose, usage, and behavior',
        contextPoint: 'Component Description',
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        fixable: true,
        propertyPath: 'description',
        currentValue: hasDescription.description,
        fixState: 'pending'
      });
      score -= 15;
    } else if (hasDescription.description && hasDescription.description.length < 20) {
      issues.push({
        id: `${node.id}-poor-description`,
        category: 'poor',
        severity: 'warning',
        message: 'Component description is too brief',
        suggestion: 'Expand description with details about usage, states, and best practices',
        contextPoint: 'Component Description',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'description',
        currentValue: hasDescription.description,
        fixState: 'pending'
      });
      score -= 8;
    }

    // ΝΕΟ: Check documentation link
    const hasDocLink = this.checkDocumentationLink(node);
    if (!hasDocLink) {
      issues.push({
        id: `${node.id}-doc-link`,
        category: 'missing',
        severity: 'critical',
        message: 'Component missing documentation link',
        suggestion: 'Add a link to external documentation (e.g., Storybook, Figma, Confluence)',
        contextPoint: 'Documentation Link',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        propertyPath: 'documentationLinks',
        currentValue: [],
        fixState: 'pending'
      });
      score -= 15;
    }

    // Check layer naming
    const hasLayerNames = this.checkLayerNaming(node);
    if (!hasLayerNames) {
      issues.push({
        id: `${node.id}-layer-names`,
        category: 'missing',
        severity: 'warning',
        message: 'Less than 70% of layers have meaningful names',
        suggestion: 'Rename generic layers (Frame 1, Rectangle 2) to descriptive names',
        contextPoint: 'Layer Names',
        nodeId: node.id,
        nodeName: node.name,
        fixable: true,
        fixState: 'pending'
      });
      score -= 10;
    }

    // Check hierarchy depth
    const maxDepth = this.getMaxDepth(node);
    if (maxDepth > 5) {
      issues.push({
        id: `${node.id}-deep-hierarchy`,
        category: 'poor',
        severity: 'info',
        message: `Layer hierarchy is ${maxDepth} levels deep (recommended: ≤5)`,
        suggestion: 'Flatten component structure by consolidating nested frames',
        contextPoint: 'Layer Hierarchy',
        nodeId: node.id,
        nodeName: node.name,
        fixable: false,
        fixState: 'pending'
      });
      score -= 5;
    }

    // Extract properties and variants
    const properties = this.extractProperties(node);
    const variants = this.extractVariants(node);

    // ΝΕΟ: Check variant descriptions
    const hasVariantDescs = this.checkVariantDescriptions(variants);
    if (!hasVariantDescs && variants.length > 0) {
      // Add issues for each variant without description
      variants.forEach(variant => {
        if (!variant.description) {
          issues.push({
            id: `${node.id}-variant-${variant.property}-desc`,
            category: 'missing',
            severity: 'warning',
            message: `Variant "${variant.property}" missing description`,
            suggestion: `Describe the purpose of the "${variant.property}" variant`,
            contextPoint: 'Variant Descriptions',
            nodeId: node.id,
            nodeName: node.name,
            fixable: true,
            propertyPath: 'variantProperties',
            variantProperty: variant.property,
            fixState: 'pending'
          });
          score -= 5;
        }
      });
    }

    // ΝΕΟ: For COMPONENT_SET, check that it has description
    if (node.type === 'COMPONENT_SET') {
      if (!hasDescription.hasDescription) {
        issues.push({
          id: `${node.id}-component-set-description`,
          category: 'missing',
          severity: 'critical',
          message: 'Component set missing description',
          suggestion: 'Add a description explaining the purpose and usage of this component family',
          contextPoint: 'Component Set Description',
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          fixable: true,
          propertyPath: 'description',
          currentValue: hasDescription.description,
          fixState: 'pending'
        });
        score -= 20;
      }

      // ΝΕΟ: Check individual component variants in the set (capped to avoid hanging)
      if ('children' in node) {
        const components = node.children.filter(child => child.type === 'COMPONENT');
        const MAX_VARIANT_CHECK = 50; // Cap variant checks for very large sets
        const componentsToCheck = components.length > MAX_VARIANT_CHECK ? components.slice(0, MAX_VARIANT_CHECK) : components;
        for (const component of componentsToCheck) {
          if (this.cancelled) break;
          const compDesc = this.checkDescription(component);
          if (!compDesc.hasDescription) {
            issues.push({
              id: `${component.id}-variant-component-description`,
              category: 'missing',
              severity: 'warning',
              message: `Variant "${component.name}" missing description`,
              suggestion: `Add a description for the "${component.name}" variant`,
              contextPoint: 'Variant Component Description',
              nodeId: component.id,
              nodeName: component.name,
              nodeType: component.type,
              fixable: true,
              propertyPath: 'description',
              currentValue: compDesc.description,
              fixState: 'pending',
              ruleId: 'variant_missing_unique_description',
              suggestionConfig: { type: 'text', source: 'variant_specific_template', action: 'fill_description' }
            });
            score -= 8;
          }
        }
      }
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      score: Math.max(0, score),
      checks: {
        hasDescription: hasDescription.hasDescription,
        hasVariants: variants.length > 0,
        hasProperties: properties.length > 0,
        hasDocumentation: false,
        hasDocumentationLink: hasDocLink,
        properNaming: properNaming.isValid,
        hasLayerNames: hasLayerNames,
        hasPropertyDescriptions: this.checkPropertyDescriptions(node),
        hasVariantDescriptions: hasVariantDescs
      },
      issues,
      properties,
      variants,
      description: hasDescription.description,
      documentationLinks: this.getDocumentationLinks(node),
      variantDescriptions: this.collectVariantDescriptions(node),
    };
  }

  /**
   * Extract checks summary from issues (for rule-based analysis)
   */
  private extractChecksFromIssues(issues: Issue[]): ComponentChecks {
    const hasIssue = (contextPoint: string) => {
      return issues.some(i => i.contextPoint === contextPoint);
    };

    return {
      hasDescription: !hasIssue('Component Description'),
      hasVariants: !hasIssue('Variants'),
      hasProperties: !hasIssue('Component Properties'),
      hasDocumentation: !hasIssue('Documentation'),
      hasDocumentationLink: !hasIssue('Documentation Link'),
      properNaming: !hasIssue('Component Name'),
      hasLayerNames: !hasIssue('Layer Names'),
      hasPropertyDescriptions: !hasIssue('Property Descriptions'),
      hasVariantDescriptions: !hasIssue('Variant Descriptions')
    };
  }

  // ============================================================================
  // LEGACY CHECK METHODS (for backward compatibility)
  // ============================================================================

  private checkNaming(node: SceneNode): { isValid: boolean } {
    const name = node.name;
    
    // Generic patterns to detect
    const genericPatterns = [
      /^(Frame|Group|Component|Rectangle|Ellipse|Text|Vector)\s*\d*$/i,
      /^(Copy|Duplicate)\s+of\s+/i,
      /^Untitled/i,
      /^Layer\s*\d+$/i,
      /^Shape\s*\d+$/i
    ];

    const isGeneric = genericPatterns.some(pattern => pattern.test(name));
    
    return { isValid: !isGeneric && name.length >= 3 };
  }

  private checkDescription(node: SceneNode): { hasDescription: boolean; description: string } {
    const description = ('description' in node) ? node.description : '';
    const hasDescription = description.trim().length > 0;
    
    return { hasDescription, description };
  }

  /**
   * Check layer naming with a cap on how many nodes we inspect.
   * For large component sets with hundreds of variants this prevents hanging.
   */
  private checkLayerNaming(node: SceneNode): boolean {
    if (!('children' in node) || node.children.length === 0) {
      return true;
    }

    const genericPatterns = [
      /^(Frame|Group|Rectangle|Ellipse|Text|Vector)\s*\d+$/i,
      /^Layer\s*\d+$/i
    ];

    let totalLayers = 0;
    let namedLayers = 0;
    const MAX_LAYER_CHECK = 500; // Cap to prevent long scans on huge trees

    const checkChildren = (parent: any, depth: number) => {
      if (!parent.children || totalLayers >= MAX_LAYER_CHECK || depth > 8) return;
      
      for (const child of parent.children) {
        if (totalLayers >= MAX_LAYER_CHECK) break;
        totalLayers++;
        
        const isGeneric = genericPatterns.some(p => p.test(child.name));
        if (!isGeneric) {
          namedLayers++;
        }
        
        if ('children' in child) {
          checkChildren(child, depth + 1);
        }
      }
    };

    checkChildren(node, 0);

    // At least 70% should have meaningful names
    return totalLayers === 0 || (namedLayers / totalLayers) >= 0.7;
  }

  /**
   * Get max layer depth with a hard limit to prevent hanging on deep/wide trees.
   */
  private getMaxDepth(node: SceneNode, currentDepth: number = 0): number {
    const MAX_DEPTH_CHECK = 10; // Stop checking beyond this depth
    if (currentDepth >= MAX_DEPTH_CHECK) return currentDepth;
    if (!('children' in node) || node.children.length === 0) {
      return currentDepth;
    }

    let maxChildDepth = currentDepth;
    // Only sample first few children at each level for wide nodes
    const childrenToCheck = node.children.length > 20 ? node.children.slice(0, 20) : node.children;
    for (const child of childrenToCheck) {
      const childDepth = this.getMaxDepth(child, currentDepth + 1);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }

    return maxChildDepth;
  }

  private checkPropertyDescriptions(node: SceneNode): boolean {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      return true;
    }

    if (!('componentPropertyDefinitions' in node)) {
      return true;
    }

    const propDefs = node.componentPropertyDefinitions;
    if (!propDefs || Object.keys(propDefs).length === 0) {
      return true;
    }

    // Check if properties have descriptions
    let withDescriptions = 0;
    let total = 0;

    for (const [_, prop] of Object.entries(propDefs)) {
      total++;
      // @ts-ignore - Property descriptions exist but may not be in types
      if (prop.description && prop.description.trim().length > 0) {
        withDescriptions++;
      }
    }

    return total === 0 || (withDescriptions / total) >= 0.5;
  }

  /**
   * ΝΕΟ: Check if component has documentation link
   */
  private checkDocumentationLink(node: SceneNode): boolean {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      return true; // Not applicable
    }

    // Check if node has documentationLinks property
    if ('documentationLinks' in node) {
      const links = (node as any).documentationLinks;
      return links && links.length > 0;
    }

    return false;
  }

  /** Collect all documentation link URIs from the node */
  private getDocumentationLinks(node: SceneNode): string[] {
    if ('documentationLinks' in node) {
      const links = (node as any).documentationLinks as Array<{ uri: string }> | undefined;
      return links ? links.map(l => l.uri).filter(Boolean) : [];
    }
    return [];
  }

  /** Collect per-variant-component descriptions (individual COMPONENTs inside a COMPONENT_SET) */
  private collectVariantDescriptions(node: SceneNode): Array<{ name: string; description: string }> {
    if (node.type !== 'COMPONENT_SET' || !('children' in node)) return [];
    const result: Array<{ name: string; description: string }> = [];
    for (const child of node.children) {
      if (child.type !== 'COMPONENT') continue;
      const desc = ('description' in child) ? ((child as any).description as string) : '';
      if (desc && desc.trim()) {
        result.push({ name: child.name, description: desc.trim() });
      }
    }
    return result;
  }

  /**
   * ΝΕΟ: Check if variants have descriptions
   */
  private checkVariantDescriptions(variants: VariantInfo[]): boolean {
    if (variants.length === 0) {
      return true; // No variants to check
    }

    // Check if at least 50% have descriptions
    const withDescriptions = variants.filter(v => v.description && v.description.length > 0).length;
    return (withDescriptions / variants.length) >= 0.5;
  }

  // ============================================================================
  // COMMON EXTRACTION METHODS
  // ============================================================================

  private extractProperties(node: SceneNode): Array<{ name: string; type: string }> {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      return [];
    }

    if (!('componentPropertyDefinitions' in node)) {
      return [];
    }

    const propDefs = node.componentPropertyDefinitions;
    if (!propDefs) {
      return [];
    }

    return Object.entries(propDefs).map(([name, def]) => ({
      name,
      type: def.type
    }));
  }

  private extractVariants(node: SceneNode): VariantInfo[] {
    const variantMap = new Map<string, Set<string>>();
    const variantDescriptions = new Map<string, string>();

    if (node.type === 'COMPONENT' && 'variantProperties' in node && node.variantProperties) {
      // Single component with variant properties
      for (const [property, value] of Object.entries(node.variantProperties)) {
        if (!variantMap.has(property)) {
          variantMap.set(property, new Set());
        }
        variantMap.get(property)!.add(String(value));
      }
    } else if (node.type === 'COMPONENT_SET' && 'children' in node) {
      // Component set - collect all variant values from all children
      for (const child of node.children) {
        if (child.type === 'COMPONENT' && 'variantProperties' in child && child.variantProperties) {
          for (const [property, value] of Object.entries(child.variantProperties)) {
            if (!variantMap.has(property)) {
              variantMap.set(property, new Set());
            }
            variantMap.get(property)!.add(String(value));
          }
        }
      }
      
      // ΝΕΟ: Try to get variant property descriptions from component set
      if ('variantGroupProperties' in node) {
        const variantGroupProps = (node as any).variantGroupProperties;
        if (variantGroupProps) {
          for (const [propName, propData] of Object.entries(variantGroupProps)) {
            if (propData && typeof propData === 'object' && 'description' in propData) {
              const desc = (propData as any).description;
              if (desc && typeof desc === 'string' && desc.trim().length > 0) {
                variantDescriptions.set(propName, desc.trim());
              }
            }
          }
        }
      }
    }

    // Convert map to VariantInfo array με descriptions
    return Array.from(variantMap.entries()).map(([property, values]) => ({
      property,
      values: Array.from(values),
      description: variantDescriptions.get(property) || undefined
    }));
  }
}