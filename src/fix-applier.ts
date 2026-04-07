/**
 * Fix Applier - Applies suggested fixes to Figma nodes
 * 
 * Handles:
 * - Variables (not SceneNodes)
 * - Component descriptions
 * - Documentation links
 * - Variant property descriptions
 */

import { Issue } from './types';

export class FixApplier {
  
  /**
   * Apply a fix to a node or variable
   * Returns true if successful
   */
  async applyFix(issue: Issue): Promise<{ success: boolean; error?: string }> {
    try {
      // Special handling for variables (not SceneNodes)
      if (issue.nodeType === 'Variable' || issue.nodeType === 'VariableCollection') {
        return await this.applyVariableFix(issue);
      }

      const node = await figma.getNodeByIdAsync(issue.nodeId);
      
      if (!node) {
        return {
          success: false,
          error: `Node not found: ${issue.nodeId}`
        };
      }

      // Check if node is a SceneNode
      if (node.type === 'PAGE' || node.type === 'DOCUMENT') {
        return {
          success: false,
          error: 'Cannot apply fixes to PAGE or DOCUMENT nodes'
        };
      }

      // Apply based on property path and suggestion type
      if (!issue.propertyPath || !issue.suggestedValue) {
        return {
          success: false,
          error: 'No property path or suggested value'
        };
      }

      const result = await this.applyProperty(node as SceneNode, issue);
      
      return result;

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply fix to a variable
   */
  private async applyVariableFix(issue: Issue): Promise<{ success: boolean; error?: string }> {
    try {
      // Get variable by ID
      const variable = await figma.variables.getVariableByIdAsync(issue.nodeId);
      
      if (!variable) {
        return {
          success: false,
          error: `Variable not found: ${issue.nodeId}`
        };
      }

      // Apply description
      if (issue.propertyPath === 'description') {
        variable.description = issue.suggestedValue;
        return { success: true };
      }

      // Apply scopes
      if (issue.propertyPath === 'scopes') {
        if (Array.isArray(issue.suggestedValue)) {
          variable.scopes = issue.suggestedValue;
          return { success: true };
        }
      }

      return {
        success: false,
        error: `Unknown property path for variable: ${issue.propertyPath}`
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply a property fix to a scene node
   */
  private async applyProperty(node: SceneNode, issue: Issue): Promise<{ success: boolean; error?: string }> {
    try {
      const { propertyPath, suggestedValue } = issue;

      switch (propertyPath) {
        case 'description':
          return this.applyDescription(node, issue);
        
        case 'documentationLinks':
          return this.applyDocumentationLinks(node, issue);
        
        case 'variantProperties':
          return this.applyVariantDescription(node, issue);
        
        default:
          return {
            success: false,
            error: `Unknown property path: ${propertyPath}`
          };
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply description to a node (only node types that support description)
   */
  private applyDescription(node: SceneNode, issue: Issue): { success: boolean; error?: string } {
    try {
      if (!('description' in node)) {
        return { success: false, error: 'Node does not support description' };
      }
      (node as { description: string }).description = issue.suggestedValue;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply documentation links to a node
   */
  private applyDocumentationLinks(node: SceneNode, issue: Issue): { success: boolean; error?: string } {
    try {
      if (!('documentationLinks' in node)) {
        return {
          success: false,
          error: 'Node does not support documentation links'
        };
      }

      // suggestedValue should be an array of links
      if (!Array.isArray(issue.suggestedValue)) {
        return {
          success: false,
          error: 'Documentation links must be an array'
        };
      }

      node.documentationLinks = issue.suggestedValue;
      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply variant description
   * This is tricky - Figma doesn't have direct API for variant property descriptions
   * We need to update the variantGroupProperties on COMPONENT_SET
   */
  private applyVariantDescription(node: SceneNode, issue: Issue): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      try {
        if (!issue.variantProperty) {
          resolve({
            success: false,
            error: 'No variant property specified'
          });
          return;
        }

        // Find the component set parent if this is a component
        let componentSet: ComponentSetNode | null = null;
        
        if (node.type === 'COMPONENT_SET') {
          componentSet = node as ComponentSetNode;
        } else if (node.type === 'COMPONENT') {
          const parent = node.parent;
          if (parent && parent.type === 'COMPONENT_SET') {
            componentSet = parent as ComponentSetNode;
          }
        }

        if (!componentSet) {
          resolve({
            success: false,
            error: 'Could not find component set'
          });
          return;
        }

        // Store in plugin data (use sync version)
        const variantProp = issue.variantProperty;
        const description = issue.suggestedValue;

        // Store in plugin data as a workaround
        componentSet.setPluginData(`variant_desc_${variantProp}`, description);

        // Also try to update variantGroupProperties if available
        if ('variantGroupProperties' in componentSet) {
          try {
            const variantGroupProps = (componentSet as any).variantGroupProperties;
            if (variantGroupProps && variantGroupProps[variantProp]) {
              variantGroupProps[variantProp].description = description;
            }
          } catch (e) {
            // API might not support this, fall back to plugin data only
            console.warn('Could not update variantGroupProperties:', e);
          }
        }

        resolve({ success: true });
      } catch (error) {
        resolve({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  /**
   * Batch apply fixes
   * Applies multiple fixes in sequence
   */
  async applyBatch(issues: Issue[]): Promise<{ 
    total: number; 
    successful: number; 
    failed: number;
    errors: string[];
  }> {
    const results = {
      total: issues.length,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const issue of issues) {
      const result = await this.applyFix(issue);
      
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        if (result.error) {
          results.errors.push(`${issue.message}: ${result.error}`);
        }
      }
    }

    return results;
  }
}