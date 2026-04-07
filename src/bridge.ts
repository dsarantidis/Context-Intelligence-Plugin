/**
 * 🌉 Embedded Desktop Bridge
 * 
 * This is the Desktop Bridge embedded directly in the DS Context Intelligence plugin.
 * It auto-starts when the plugin opens and provides MCP connectivity.
 * 
 * Features:
 * - Auto-starts (always-on)
 * - No user interaction needed
 * - Listens for MCP commands
 * - Executes Figma API calls
 * - Full compatibility with Figma Console MCP
 */

// ============================================================================
// TYPES
// ============================================================================

interface BridgeMessage {
  type: string;
  requestId?: string;
  code?: string;
  args?: any;
  timeout?: number;
  nodeId?: string;
  [key: string]: any;
}

interface BridgeResponse {
  success: boolean;
  requestId?: string;
  result?: any;
  error?: string;
  resultType?: string;
}

interface ExecutionContext {
  requestId: string;
  startTime: number;
  timeout: number;
  resolved: boolean;
}

// ============================================================================
// DESKTOP BRIDGE CLASS
// ============================================================================

export class DesktopBridge {
  private isRunning: boolean = false;
  private messageHandlers: Map<string, (msg: BridgeMessage) => Promise<BridgeResponse>> = new Map();
  private executionContexts: Map<string, ExecutionContext> = new Map();
  
  constructor() {
    this.log('🌉 Desktop Bridge initialized');
    this.registerMessageHandlers();
  }

  /**
   * Start the Desktop Bridge
   * Called automatically when plugin opens.
   * Does not replace figma.ui.onmessage; the main plugin must call handleMessage() for each message.
   */
  public start(): void {
    if (this.isRunning) {
      this.log('⚠️ Bridge already running');
      return;
    }

    this.isRunning = true;
    this.log('✅ Desktop Bridge started (always-on mode)');

    // Notify UI that bridge is ready
    this.notifyUI({
      type: 'BRIDGE_STATUS',
      status: 'connected',
      mode: 'embedded'
    });
  }

  /**
   * Stop the Desktop Bridge
   * Called when plugin closes
   */
  public stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.executionContexts.clear();
    this.log('🛑 Desktop Bridge stopped');
  }

  /**
   * Register message handlers for different command types
   */
  private registerMessageHandlers(): void {
    // Execute arbitrary code
    this.messageHandlers.set('EXECUTE_CODE', this.handleExecuteCode.bind(this));
    
    // Get node data
    this.messageHandlers.set('GET_NODE', this.handleGetNode.bind(this));
    
    // Get selection
    this.messageHandlers.set('GET_SELECTION', this.handleGetSelection.bind(this));
    
    // Get variables
    this.messageHandlers.set('GET_VARIABLES', this.handleGetVariables.bind(this));
    
    // Get styles
    this.messageHandlers.set('GET_STYLES', this.handleGetStyles.bind(this));
    
    // Capture screenshot
    this.messageHandlers.set('CAPTURE_SCREENSHOT', this.handleCaptureScreenshot.bind(this));
    
    // Health check
    this.messageHandlers.set('HEALTH_CHECK', this.handleHealthCheck.bind(this));
  }

  /**
   * Handle an incoming UI message. Call this from the main plugin's figma.ui.onmessage.
   * @returns true if the message was a BRIDGE_* message and was handled; false otherwise.
   */
  public async handleMessage(msg: BridgeMessage): Promise<boolean> {
    if (!this.isRunning || !msg.type || !msg.type.startsWith('BRIDGE_')) {
      return false;
    }

    const bridgeType = msg.type.replace('BRIDGE_', '');
    const handler = this.messageHandlers.get(bridgeType);

    if (!handler) {
      this.log(`❌ Unknown command: ${bridgeType}`);
      this.notifyUI({
        type: 'BRIDGE_RESPONSE',
        requestId: msg.requestId,
        success: false,
        error: `Unknown command: ${bridgeType}`
      });
      return true;
    }

    try {
      const response = await handler(msg);
      this.notifyUI({
        type: 'BRIDGE_RESPONSE',
        ...response
      });
    } catch (error) {
      this.log(`❌ Handler error: ${error}`);
      this.notifyUI({
        type: 'BRIDGE_RESPONSE',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  // ============================================================================
  // MESSAGE HANDLERS
  // ============================================================================

  /**
   * Execute arbitrary code in Figma plugin context
   */
  private async handleExecuteCode(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId, code, timeout = 5000 } = msg;

    if (!code) {
      return {
        success: false,
        requestId,
        error: 'No code provided'
      };
    }

    this.log(`🌉 Executing code, length: ${code.length}`);

    try {
      // Create execution context
      const context: ExecutionContext = {
        requestId: requestId || 'unknown',
        startTime: Date.now(),
        timeout,
        resolved: false
      };
      
      if (requestId) {
        this.executionContexts.set(requestId, context);
      }

      // Wrap code in async function for proper error handling
      const wrappedCode = `
        (async () => {
          ${code}
        })();
      `;

      this.log('🌉 Wrapped code for eval');

      // Execute code
      const result = await eval(wrappedCode);

      // Mark as resolved
      context.resolved = true;

      this.log(`🌉 Code executed successfully, result type: ${typeof result}`);

      return {
        success: true,
        requestId,
        result,
        resultType: typeof result
      };

    } catch (error) {
      this.log(`🌉 Code execution error: ${error}`);
      this.log(`🌉 Stack: ${error instanceof Error ? error.stack : 'No stack'}`);
      
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (requestId) {
        this.executionContexts.delete(requestId);
      }
    }
  }

  /**
   * Get node data by ID
   */
  private async handleGetNode(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId, nodeId } = msg;

    if (!nodeId) {
      return {
        success: false,
        requestId,
        error: 'No nodeId provided'
      };
    }

    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      
      if (!node) {
        return {
          success: false,
          requestId,
          error: `Node not found: ${nodeId}`
        };
      }

      // Return basic node info
      const nodeData = {
        id: node.id,
        name: node.name,
        type: node.type,
        visible: 'visible' in node ? node.visible : undefined,
        locked: 'locked' in node ? node.locked : undefined
      };

      return {
        success: true,
        requestId,
        result: nodeData
      };

    } catch (error) {
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current selection
   */
  private async handleGetSelection(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId } = msg;

    try {
      const selection = figma.currentPage.selection;
      
      const selectionData = selection.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type
      }));

      return {
        success: true,
        requestId,
        result: {
          count: selection.length,
          nodes: selectionData
        }
      };

    } catch (error) {
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get local variables
   */
  private async handleGetVariables(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId } = msg;

    try {
      const variables = await figma.variables.getLocalVariablesAsync();
      
      const variableData = variables.map(variable => ({
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        variableCollectionId: variable.variableCollectionId
      }));

      return {
        success: true,
        requestId,
        result: {
          count: variables.length,
          variables: variableData
        }
      };

    } catch (error) {
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get local styles
   */
  private async handleGetStyles(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId } = msg;

    try {
      const paintStyles = await figma.getLocalPaintStylesAsync();
      const textStyles = await figma.getLocalTextStylesAsync();
      const effectStyles = await figma.getLocalEffectStylesAsync();

      return {
        success: true,
        requestId,
        result: {
          paintStyles: paintStyles.map(s => ({ id: s.id, name: s.name, type: s.type })),
          textStyles: textStyles.map(s => ({ id: s.id, name: s.name, type: s.type })),
          effectStyles: effectStyles.map(s => ({ id: s.id, name: s.name, type: s.type })),
          totalCount: paintStyles.length + textStyles.length + effectStyles.length
        }
      };

    } catch (error) {
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Capture screenshot of node
   */
  private async handleCaptureScreenshot(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId, nodeId } = msg;

    try {
      let node: SceneNode;
      
      if (nodeId) {
        const foundNode = await figma.getNodeByIdAsync(nodeId);
        if (!foundNode || !('exportAsync' in foundNode)) {
          return {
            success: false,
            requestId,
            error: `Invalid node for export: ${nodeId}`
          };
        }
        node = foundNode as SceneNode;
      } else {
        // Use current page or selection
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
          return {
            success: false,
            requestId,
            error: 'No node specified and no selection'
          };
        }
        node = selection[0];
      }

      // Export as PNG
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
      const base64 = figma.base64Encode(bytes);

      return {
        success: true,
        requestId,
        result: {
          nodeId: node.id,
          nodeName: node.name,
          image: base64,
          format: 'PNG'
        }
      };

    } catch (error) {
      return {
        success: false,
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Health check
   */
  private async handleHealthCheck(msg: BridgeMessage): Promise<BridgeResponse> {
    const { requestId } = msg;

    return {
      success: true,
      requestId,
      result: {
        status: 'healthy',
        mode: 'embedded',
        timestamp: Date.now(),
        fileName: figma.root.name,
        pageCount: figma.root.children.length
      }
    };
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Send message to UI
   */
  private notifyUI(message: any): void {
    try {
      figma.ui.postMessage(message);
    } catch (error) {
      this.log(`❌ Failed to notify UI: ${error}`);
    }
  }

  /**
   * Log with prefix
   */
  private log(message: string): void {
    console.log(`🌉 [Desktop Bridge] ${message}`);
  }

  /**
   * Get bridge status
   */
  public getStatus() {
    return {
      isRunning: this.isRunning,
      mode: 'embedded',
      activeExecutions: this.executionContexts.size
    };
  }
}

// ============================================================================
// EXPORT
// ============================================================================

// Singleton instance
let bridgeInstance: DesktopBridge | null = null;

/**
 * Get or create Desktop Bridge instance
 */
export function getDesktopBridge(): DesktopBridge {
  if (!bridgeInstance) {
    bridgeInstance = new DesktopBridge();
  }
  return bridgeInstance;
}

/**
 * Start Desktop Bridge (called from main plugin code)
 */
export function startDesktopBridge(): void {
  const bridge = getDesktopBridge();
  bridge.start();
}

/**
 * Stop Desktop Bridge (called on plugin close)
 */
export function stopDesktopBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.stop();
    bridgeInstance = null;
  }
}
