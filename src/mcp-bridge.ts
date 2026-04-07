// MCPBridge - Integration layer για Figma Console MCP Server
// Handles communication με το MCP server για enriched data και automation

import type {
  MCPConnectionStatus,
  MCPVariableOptions,
  MCPStyleOptions,
  MCPComponentOptions,
  EnrichedVariableData,
  EnrichedStyleData,
  ComponentMetadata,
  ExecutionResult,
  ScreenshotResult,
  MCPError
} from './types';

/**
 * MCPBridge Class
 * 
 * Επικοινωνεί με το Figma Console MCP server για:
 * - Enriched variable data (με token coverage, exports)
 * - Enriched style data (με code examples)
 * - Component metadata (με token analysis)
 * - Auto-fix execution (via figma_execute)
 * - Visual validation (screenshots)
 * 
 * Architecture:
 * Plugin (code.ts) → MCPBridge → Figma Console MCP → Figma REST API / Desktop Bridge
 */
export class MCPBridge {
  private isConnected: boolean = false;
  private endpoint: string;
  private fileUrl: string;
  private connectionMode: 'rest' | 'desktop_bridge' | 'auto';

  constructor(options: {
    endpoint?: string;
    fileUrl?: string;
    mode?: 'rest' | 'desktop_bridge' | 'auto';
  } = {}) {
    // Default to auto-detect mode
    this.connectionMode = options.mode || 'auto';
    
    // Endpoint για MCP server (μπορεί να είναι local ή remote)
    this.endpoint = options.endpoint || 'http://localhost:3000';
    
    // Current Figma file URL (για REST API calls)
    this.fileUrl = options.fileUrl || this.getCurrentFileUrl();
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to MCP Server
   * Tries Desktop Bridge first, falls back to REST API
   */
  async connect(): Promise<MCPConnectionStatus> {
    console.log('[MCPBridge] Attempting connection...');
    
    try {
      // Try Desktop Bridge first (preferred for real-time updates)
      if (this.connectionMode === 'desktop_bridge' || this.connectionMode === 'auto') {
        const desktopBridgeStatus = await this.testDesktopBridge();
        if (desktopBridgeStatus.connected) {
          this.isConnected = true;
          this.connectionMode = 'desktop_bridge';
          console.log('[MCPBridge] ✓ Connected via Desktop Bridge');
          return desktopBridgeStatus;
        }
      }

      // Fallback to REST API
      if (this.connectionMode === 'rest' || this.connectionMode === 'auto') {
        const restApiStatus = await this.testRestApi();
        if (restApiStatus.connected) {
          this.isConnected = true;
          this.connectionMode = 'rest';
          console.log('[MCPBridge] ✓ Connected via REST API');
          return restApiStatus;
        }
      }

      // Connection failed
      this.isConnected = false;
      return {
        connected: false,
        mode: 'none',
        error: 'Unable to connect to MCP server. Please ensure Figma Console MCP is running.'
      };

    } catch (error) {
      console.error('[MCPBridge] Connection error:', error);
      this.isConnected = false;
      return {
        connected: false,
        mode: 'none',
        error: error instanceof Error ? error.message : 'Unknown connection error'
      };
    }
  }

  /**
   * Test Desktop Bridge connection
   */
  private async testDesktopBridge(): Promise<MCPConnectionStatus> {
    try {
      // Desktop Bridge uses Chrome DevTools Protocol
      // This requires the Figma Desktop Bridge plugin to be running
      const response = await fetch(`${this.endpoint}/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        return {
          connected: true,
          mode: 'desktop_bridge',
          version: data.version,
          capabilities: data.capabilities
        };
      }

      return {
        connected: false,
        mode: 'desktop_bridge',
        error: 'Desktop Bridge not responding'
      };

    } catch (error) {
      return {
        connected: false,
        mode: 'desktop_bridge',
        error: error instanceof Error ? error.message : 'Desktop Bridge test failed'
      };
    }
  }

  /**
   * Test REST API connection
   */
  private async testRestApi(): Promise<MCPConnectionStatus> {
    try {
      // REST API uses Figma's official API
      // Requires file URL and API token
      if (!this.fileUrl) {
        return {
          connected: false,
          mode: 'rest',
          error: 'File URL not available'
        };
      }

      // Test με simple GET request
      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET'
      });

      if (response.ok) {
        return {
          connected: true,
          mode: 'rest',
          version: '1.0',
          capabilities: ['variables', 'styles', 'components', 'screenshots']
        };
      }

      return {
        connected: false,
        mode: 'rest',
        error: 'REST API not responding'
      };

    } catch (error) {
      return {
        connected: false,
        mode: 'rest',
        error: error instanceof Error ? error.message : 'REST API test failed'
      };
    }
  }

  /**
   * Disconnect from MCP Server
   */
  disconnect(): void {
    this.isConnected = false;
    console.log('[MCPBridge] Disconnected');
  }

  /**
   * Check connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // ============================================================================
  // Variable/Token Operations
  // ============================================================================

  /**
   * Get enriched variable data με token coverage, exports, κλπ
   */
  async getEnrichedVariables(options: MCPVariableOptions = {}): Promise<EnrichedVariableData> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_get_variables',
        params: {
          fileUrl: this.fileUrl,
          enrich: options.enrich ?? true,
          resolveAliases: options.resolveAliases ?? true,
          export_formats: options.export_formats || ['css', 'tailwind', 'typescript'],
          verbosity: options.verbosity || 'standard',
          include_dependencies: options.include_dependencies ?? false,
          include_usage: options.include_usage ?? false
        }
      };

      const response = await this.makeRequest('/variables', payload);
      
      return this.parseVariableResponse(response);

    } catch (error) {
      throw this.handleError('getEnrichedVariables', error);
    }
  }

  /**
   * Get specific variable by ID
   */
  async getVariableById(variableId: string): Promise<any> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_get_variable_by_id',
        params: {
          fileUrl: this.fileUrl,
          variableId
        }
      };

      const response = await this.makeRequest('/variable', payload);
      return response;

    } catch (error) {
      throw this.handleError('getVariableById', error);
    }
  }

  // ============================================================================
  // Style Operations
  // ============================================================================

  /**
   * Get enriched style data με code exports
   */
  async getEnrichedStyles(options: MCPStyleOptions = {}): Promise<EnrichedStyleData> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_get_styles',
        params: {
          fileUrl: this.fileUrl,
          enrich: options.enrich ?? true,
          export_formats: options.export_formats || ['css', 'sass', 'tailwind'],
          verbosity: options.verbosity || 'standard',
          include_usage: options.include_usage ?? false
        }
      };

      const response = await this.makeRequest('/styles', payload);
      
      return this.parseStyleResponse(response);

    } catch (error) {
      throw this.handleError('getEnrichedStyles', error);
    }
  }

  // ============================================================================
  // Component Operations
  // ============================================================================

  /**
   * Get component metadata με token coverage analysis
   */
  async getComponentMetadata(
    nodeId: string,
    options: MCPComponentOptions = {}
  ): Promise<ComponentMetadata> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_get_component',
        params: {
          fileUrl: this.fileUrl,
          nodeId,
          enrich: options.enrich ?? true,
          format: options.format || 'metadata'
        }
      };

      const response = await this.makeRequest('/component', payload);
      
      return this.parseComponentResponse(response);

    } catch (error) {
      throw this.handleError('getComponentMetadata', error);
    }
  }

  /**
   * Get file structure for analysis
   */
  async getFileData(options: {
    depth?: number;
    verbosity?: 'summary' | 'standard' | 'full';
    enrich?: boolean;
  } = {}): Promise<any> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_get_file_data',
        params: {
          fileUrl: this.fileUrl,
          depth: options.depth ?? 1,
          verbosity: options.verbosity || 'summary',
          enrich: options.enrich ?? false
        }
      };

      const response = await this.makeRequest('/file', payload);
      return response;

    } catch (error) {
      throw this.handleError('getFileData', error);
    }
  }

  // ============================================================================
  // Execution Operations (Auto-Fix)
  // ============================================================================

  /**
   * Execute code στο Figma (για auto-fixes)
   */
  async executeCode(code: string, timeout: number = 5000): Promise<ExecutionResult> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_execute',
        params: {
          code,
          timeout
        }
      };

      const response = await this.makeRequest('/execute', payload);
      
      return {
        success: response.success ?? false,
        result: response.result,
        error: response.error,
        resultAnalysis: response.resultAnalysis
      };

    } catch (error) {
      throw this.handleError('executeCode', error);
    }
  }

  /**
   * Update component instance properties
   */
  async updateInstanceProperties(
    nodeId: string,
    properties: Record<string, string | boolean>
  ): Promise<ExecutionResult> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_set_instance_properties',
        params: {
          nodeId,
          properties
        }
      };

      const response = await this.makeRequest('/instance-properties', payload);
      
      return {
        success: true,
        result: response
      };

    } catch (error) {
      throw this.handleError('updateInstanceProperties', error);
    }
  }

  // ============================================================================
  // Visual Validation Operations
  // ============================================================================

  /**
   * Capture screenshot για visual validation
   */
  async captureScreenshot(options: {
    nodeId?: string;
    format?: 'PNG' | 'JPG' | 'SVG';
    scale?: number;
  } = {}): Promise<ScreenshotResult> {
    this.ensureConnected();

    try {
      const payload = {
        tool: 'figma_capture_screenshot',
        params: {
          nodeId: options.nodeId,
          format: options.format || 'PNG',
          scale: options.scale || 2
        }
      };

      const response = await this.makeRequest('/screenshot', payload);
      
      return {
        imageData: response.imageData,
        format: response.format,
        width: response.width,
        height: response.height,
        nodeId: response.nodeId
      };

    } catch (error) {
      throw this.handleError('captureScreenshot', error);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Make HTTP request to MCP server
   */
  private async makeRequest(path: string, payload: any): Promise<any> {
    const url = `${this.endpoint}${path}`;
    
    console.log(`[MCPBridge] Request: ${path}`, payload);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[MCPBridge] Response: ${path}`, data);

    return data;
  }

  /**
   * Parse variable response from MCP
   */
  private parseVariableResponse(response: any): EnrichedVariableData {
    // Transform MCP response to our internal format
    return {
      variables: response.variables || [],
      collections: response.collections || [],
      exports: {
        css: response.exports?.css,
        tailwind: response.exports?.tailwind,
        typescript: response.exports?.typescript
      },
      tokenCoverage: response.tokenCoverage,
      dependencies: response.dependencies,
      metadata: response.metadata
    };
  }

  /**
   * Parse style response from MCP
   */
  private parseStyleResponse(response: any): EnrichedStyleData {
    return {
      styles: response.styles || [],
      exports: {
        css: response.exports?.css,
        sass: response.exports?.sass,
        tailwind: response.exports?.tailwind
      },
      usage: response.usage,
      metadata: response.metadata
    };
  }

  /**
   * Parse component response from MCP
   */
  private parseComponentResponse(response: any): ComponentMetadata {
    return {
      nodeId: response.nodeId,
      name: response.name,
      type: response.type,
      description: response.description,
      properties: response.properties,
      variants: response.variants,
      tokenCoverage: response.tokenCoverage,
      hardcodedValues: response.hardcodedValues,
      metadata: response.metadata
    };
  }

  /**
   * Get current Figma file URL
   */
  private getCurrentFileUrl(): string {
    // Try to construct from figma.root
    const fileKey = figma.root.id;
    return `https://www.figma.com/file/${fileKey}`;
  }

  /**
   * Ensure connection is established
   */
  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error(
        'MCP Bridge not connected. Call connect() first.'
      );
    }
  }

  /**
   * Handle errors uniformly
   */
  private handleError(operation: string, error: unknown): MCPError {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    console.error(`[MCPBridge] Error in ${operation}:`, error);
    
    return {
      operation,
      message,
      timestamp: new Date().toISOString(),
      originalError: error
    };
  }
}
