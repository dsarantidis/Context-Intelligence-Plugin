"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // bridge.ts
  function getDesktopBridge() {
    if (!bridgeInstance) {
      bridgeInstance = new DesktopBridge();
    }
    return bridgeInstance;
  }
  function startDesktopBridge() {
    const bridge = getDesktopBridge();
    bridge.start();
  }
  function stopDesktopBridge() {
    if (bridgeInstance) {
      bridgeInstance.stop();
      bridgeInstance = null;
    }
  }
  var DesktopBridge, bridgeInstance;
  var init_bridge = __esm({
    "bridge.ts"() {
      "use strict";
      DesktopBridge = class {
        constructor() {
          this.isRunning = false;
          this.messageHandlers = /* @__PURE__ */ new Map();
          this.executionContexts = /* @__PURE__ */ new Map();
          this.log("\u{1F309} Desktop Bridge initialized");
          this.registerMessageHandlers();
        }
        /**
         * Start the Desktop Bridge
         * Called automatically when plugin opens
         */
        start() {
          if (this.isRunning) {
            this.log("\u26A0\uFE0F Bridge already running");
            return;
          }
          this.isRunning = true;
          this.setupMessageListener();
          this.log("\u2705 Desktop Bridge started (always-on mode)");
          this.notifyUI({
            type: "BRIDGE_STATUS",
            status: "connected",
            mode: "embedded"
          });
        }
        /**
         * Stop the Desktop Bridge
         * Called when plugin closes
         */
        stop() {
          if (!this.isRunning) return;
          this.isRunning = false;
          this.executionContexts.clear();
          this.log("\u{1F6D1} Desktop Bridge stopped");
        }
        /**
         * Register message handlers for different command types
         */
        registerMessageHandlers() {
          this.messageHandlers.set("EXECUTE_CODE", this.handleExecuteCode.bind(this));
          this.messageHandlers.set("GET_NODE", this.handleGetNode.bind(this));
          this.messageHandlers.set("GET_SELECTION", this.handleGetSelection.bind(this));
          this.messageHandlers.set("GET_VARIABLES", this.handleGetVariables.bind(this));
          this.messageHandlers.set("GET_STYLES", this.handleGetStyles.bind(this));
          this.messageHandlers.set("CAPTURE_SCREENSHOT", this.handleCaptureScreenshot.bind(this));
          this.messageHandlers.set("HEALTH_CHECK", this.handleHealthCheck.bind(this));
        }
        /**
         * Setup UI message listener
         */
        setupMessageListener() {
          figma.ui.onmessage = (msg2) => __async(this, null, function* () {
            if (!msg2.type || !msg2.type.startsWith("BRIDGE_")) {
              return;
            }
            const bridgeType = msg2.type.replace("BRIDGE_", "");
            const handler = this.messageHandlers.get(bridgeType);
            if (!handler) {
              this.log(`\u274C Unknown command: ${bridgeType}`);
              this.notifyUI({
                type: "BRIDGE_RESPONSE",
                requestId: msg2.requestId,
                success: false,
                error: `Unknown command: ${bridgeType}`
              });
              return;
            }
            try {
              const response = yield handler(msg2);
              this.notifyUI(__spreadValues({
                type: "BRIDGE_RESPONSE"
              }, response));
            } catch (error) {
              this.log(`\u274C Handler error: ${error}`);
              this.notifyUI({
                type: "BRIDGE_RESPONSE",
                requestId: msg2.requestId,
                success: false,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          });
        }
        // ============================================================================
        // MESSAGE HANDLERS
        // ============================================================================
        /**
         * Execute arbitrary code in Figma plugin context
         */
        handleExecuteCode(msg) {
          return __async(this, null, function* () {
            const { requestId, code, timeout = 5e3 } = msg;
            if (!code) {
              return {
                success: false,
                requestId,
                error: "No code provided"
              };
            }
            this.log(`\u{1F309} Executing code, length: ${code.length}`);
            try {
              const context = {
                requestId: requestId || "unknown",
                startTime: Date.now(),
                timeout,
                resolved: false
              };
              if (requestId) {
                this.executionContexts.set(requestId, context);
              }
              const wrappedCode = `
        (async () => {
          ${code}
        })();
      `;
              this.log("\u{1F309} Wrapped code for eval");
              const result = yield eval(wrappedCode);
              context.resolved = true;
              this.log(`\u{1F309} Code executed successfully, result type: ${typeof result}`);
              return {
                success: true,
                requestId,
                result,
                resultType: typeof result
              };
            } catch (error) {
              this.log(`\u{1F309} Code execution error: ${error}`);
              this.log(`\u{1F309} Stack: ${error instanceof Error ? error.stack : "No stack"}`);
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
          });
        }
        /**
         * Get node data by ID
         */
        handleGetNode(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2, nodeId } = msg2;
            if (!nodeId) {
              return {
                success: false,
                requestId: requestId2,
                error: "No nodeId provided"
              };
            }
            try {
              const node = figma.getNodeById(nodeId);
              if (!node) {
                return {
                  success: false,
                  requestId: requestId2,
                  error: `Node not found: ${nodeId}`
                };
              }
              const nodeData = {
                id: node.id,
                name: node.name,
                type: node.type,
                visible: "visible" in node ? node.visible : void 0,
                locked: "locked" in node ? node.locked : void 0
              };
              return {
                success: true,
                requestId: requestId2,
                result: nodeData
              };
            } catch (error) {
              return {
                success: false,
                requestId: requestId2,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });
        }
        /**
         * Get current selection
         */
        handleGetSelection(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2 } = msg2;
            try {
              const selection = figma.currentPage.selection;
              const selectionData = selection.map((node) => ({
                id: node.id,
                name: node.name,
                type: node.type
              }));
              return {
                success: true,
                requestId: requestId2,
                result: {
                  count: selection.length,
                  nodes: selectionData
                }
              };
            } catch (error) {
              return {
                success: false,
                requestId: requestId2,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });
        }
        /**
         * Get local variables
         */
        handleGetVariables(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2 } = msg2;
            try {
              const variables = figma.variables.getLocalVariables();
              const variableData = variables.map((variable) => ({
                id: variable.id,
                name: variable.name,
                resolvedType: variable.resolvedType,
                variableCollectionId: variable.variableCollectionId
              }));
              return {
                success: true,
                requestId: requestId2,
                result: {
                  count: variables.length,
                  variables: variableData
                }
              };
            } catch (error) {
              return {
                success: false,
                requestId: requestId2,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });
        }
        /**
         * Get local styles
         */
        handleGetStyles(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2 } = msg2;
            try {
              const paintStyles = figma.getLocalPaintStyles();
              const textStyles = figma.getLocalTextStyles();
              const effectStyles = figma.getLocalEffectStyles();
              return {
                success: true,
                requestId: requestId2,
                result: {
                  paintStyles: paintStyles.map((s) => ({ id: s.id, name: s.name, type: s.type })),
                  textStyles: textStyles.map((s) => ({ id: s.id, name: s.name, type: s.type })),
                  effectStyles: effectStyles.map((s) => ({ id: s.id, name: s.name, type: s.type })),
                  totalCount: paintStyles.length + textStyles.length + effectStyles.length
                }
              };
            } catch (error) {
              return {
                success: false,
                requestId: requestId2,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });
        }
        /**
         * Capture screenshot of node
         */
        handleCaptureScreenshot(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2, nodeId } = msg2;
            try {
              let node;
              if (nodeId) {
                const foundNode = figma.getNodeById(nodeId);
                if (!foundNode || !("exportAsync" in foundNode)) {
                  return {
                    success: false,
                    requestId: requestId2,
                    error: `Invalid node for export: ${nodeId}`
                  };
                }
                node = foundNode;
              } else {
                const selection = figma.currentPage.selection;
                if (selection.length === 0) {
                  return {
                    success: false,
                    requestId: requestId2,
                    error: "No node specified and no selection"
                  };
                }
                node = selection[0];
              }
              const bytes = yield node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
              const base64 = figma.base64Encode(bytes);
              return {
                success: true,
                requestId: requestId2,
                result: {
                  nodeId: node.id,
                  nodeName: node.name,
                  image: base64,
                  format: "PNG"
                }
              };
            } catch (error) {
              return {
                success: false,
                requestId: requestId2,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });
        }
        /**
         * Health check
         */
        handleHealthCheck(msg2) {
          return __async(this, null, function* () {
            const { requestId: requestId2 } = msg2;
            return {
              success: true,
              requestId: requestId2,
              result: {
                status: "healthy",
                mode: "embedded",
                timestamp: Date.now(),
                fileName: figma.root.name,
                pageCount: figma.root.children.length
              }
            };
          });
        }
        // ============================================================================
        // UTILITIES
        // ============================================================================
        /**
         * Send message to UI
         */
        notifyUI(message) {
          try {
            figma.ui.postMessage(message);
          } catch (error) {
            this.log(`\u274C Failed to notify UI: ${error}`);
          }
        }
        /**
         * Log with prefix
         */
        log(message) {
          console.log(`\u{1F309} [Desktop Bridge] ${message}`);
        }
        /**
         * Get bridge status
         */
        getStatus() {
          return {
            isRunning: this.isRunning,
            mode: "embedded",
            activeExecutions: this.executionContexts.size
          };
        }
      };
      bridgeInstance = null;
    }
  });

  // mcp-bridge.ts
  var MCPBridge;
  var init_mcp_bridge = __esm({
    "mcp-bridge.ts"() {
      "use strict";
      MCPBridge = class {
        constructor(options = {}) {
          this.isConnected = false;
          this.connectionMode = options.mode || "auto";
          this.endpoint = options.endpoint || "http://localhost:3000";
          this.fileUrl = options.fileUrl || this.getCurrentFileUrl();
        }
        // ============================================================================
        // Connection Management
        // ============================================================================
        /**
         * Connect to MCP Server
         * Tries Desktop Bridge first, falls back to REST API
         */
        connect() {
          return __async(this, null, function* () {
            console.log("[MCPBridge] Attempting connection...");
            try {
              if (this.connectionMode === "desktop_bridge" || this.connectionMode === "auto") {
                const desktopBridgeStatus = yield this.testDesktopBridge();
                if (desktopBridgeStatus.connected) {
                  this.isConnected = true;
                  this.connectionMode = "desktop_bridge";
                  console.log("[MCPBridge] \u2713 Connected via Desktop Bridge");
                  return desktopBridgeStatus;
                }
              }
              if (this.connectionMode === "rest" || this.connectionMode === "auto") {
                const restApiStatus = yield this.testRestApi();
                if (restApiStatus.connected) {
                  this.isConnected = true;
                  this.connectionMode = "rest";
                  console.log("[MCPBridge] \u2713 Connected via REST API");
                  return restApiStatus;
                }
              }
              this.isConnected = false;
              return {
                connected: false,
                mode: "none",
                error: "Unable to connect to MCP server. Please ensure Figma Console MCP is running."
              };
            } catch (error) {
              console.error("[MCPBridge] Connection error:", error);
              this.isConnected = false;
              return {
                connected: false,
                mode: "none",
                error: error instanceof Error ? error.message : "Unknown connection error"
              };
            }
          });
        }
        /**
         * Test Desktop Bridge connection
         */
        testDesktopBridge() {
          return __async(this, null, function* () {
            try {
              const response = yield fetch(`${this.endpoint}/status`, {
                method: "GET",
                headers: { "Content-Type": "application/json" }
              });
              if (response.ok) {
                const data = yield response.json();
                return {
                  connected: true,
                  mode: "desktop_bridge",
                  version: data.version,
                  capabilities: data.capabilities
                };
              }
              return {
                connected: false,
                mode: "desktop_bridge",
                error: "Desktop Bridge not responding"
              };
            } catch (error) {
              return {
                connected: false,
                mode: "desktop_bridge",
                error: error instanceof Error ? error.message : "Desktop Bridge test failed"
              };
            }
          });
        }
        /**
         * Test REST API connection
         */
        testRestApi() {
          return __async(this, null, function* () {
            try {
              if (!this.fileUrl) {
                return {
                  connected: false,
                  mode: "rest",
                  error: "File URL not available"
                };
              }
              const response = yield fetch(`${this.endpoint}/health`, {
                method: "GET"
              });
              if (response.ok) {
                return {
                  connected: true,
                  mode: "rest",
                  version: "1.0",
                  capabilities: ["variables", "styles", "components", "screenshots"]
                };
              }
              return {
                connected: false,
                mode: "rest",
                error: "REST API not responding"
              };
            } catch (error) {
              return {
                connected: false,
                mode: "rest",
                error: error instanceof Error ? error.message : "REST API test failed"
              };
            }
          });
        }
        /**
         * Disconnect from MCP Server
         */
        disconnect() {
          this.isConnected = false;
          console.log("[MCPBridge] Disconnected");
        }
        /**
         * Check connection status
         */
        getConnectionStatus() {
          return this.isConnected;
        }
        // ============================================================================
        // Variable/Token Operations
        // ============================================================================
        /**
         * Get enriched variable data με token coverage, exports, κλπ
         */
        getEnrichedVariables() {
          return __async(this, arguments, function* (options = {}) {
            var _a, _b, _c, _d;
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_get_variables",
                params: {
                  fileUrl: this.fileUrl,
                  enrich: (_a = options.enrich) != null ? _a : true,
                  resolveAliases: (_b = options.resolveAliases) != null ? _b : true,
                  export_formats: options.export_formats || ["css", "tailwind", "typescript"],
                  verbosity: options.verbosity || "standard",
                  include_dependencies: (_c = options.include_dependencies) != null ? _c : false,
                  include_usage: (_d = options.include_usage) != null ? _d : false
                }
              };
              const response = yield this.makeRequest("/variables", payload);
              return this.parseVariableResponse(response);
            } catch (error) {
              throw this.handleError("getEnrichedVariables", error);
            }
          });
        }
        /**
         * Get specific variable by ID
         */
        getVariableById(variableId) {
          return __async(this, null, function* () {
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_get_variable_by_id",
                params: {
                  fileUrl: this.fileUrl,
                  variableId
                }
              };
              const response = yield this.makeRequest("/variable", payload);
              return response;
            } catch (error) {
              throw this.handleError("getVariableById", error);
            }
          });
        }
        // ============================================================================
        // Style Operations
        // ============================================================================
        /**
         * Get enriched style data με code exports
         */
        getEnrichedStyles() {
          return __async(this, arguments, function* (options = {}) {
            var _a, _b;
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_get_styles",
                params: {
                  fileUrl: this.fileUrl,
                  enrich: (_a = options.enrich) != null ? _a : true,
                  export_formats: options.export_formats || ["css", "sass", "tailwind"],
                  verbosity: options.verbosity || "standard",
                  include_usage: (_b = options.include_usage) != null ? _b : false
                }
              };
              const response = yield this.makeRequest("/styles", payload);
              return this.parseStyleResponse(response);
            } catch (error) {
              throw this.handleError("getEnrichedStyles", error);
            }
          });
        }
        // ============================================================================
        // Component Operations
        // ============================================================================
        /**
         * Get component metadata με token coverage analysis
         */
        getComponentMetadata(_0) {
          return __async(this, arguments, function* (nodeId, options = {}) {
            var _a;
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_get_component",
                params: {
                  fileUrl: this.fileUrl,
                  nodeId,
                  enrich: (_a = options.enrich) != null ? _a : true,
                  format: options.format || "metadata"
                }
              };
              const response = yield this.makeRequest("/component", payload);
              return this.parseComponentResponse(response);
            } catch (error) {
              throw this.handleError("getComponentMetadata", error);
            }
          });
        }
        /**
         * Get file structure for analysis
         */
        getFileData() {
          return __async(this, arguments, function* (options = {}) {
            var _a, _b;
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_get_file_data",
                params: {
                  fileUrl: this.fileUrl,
                  depth: (_a = options.depth) != null ? _a : 1,
                  verbosity: options.verbosity || "summary",
                  enrich: (_b = options.enrich) != null ? _b : false
                }
              };
              const response = yield this.makeRequest("/file", payload);
              return response;
            } catch (error) {
              throw this.handleError("getFileData", error);
            }
          });
        }
        // ============================================================================
        // Execution Operations (Auto-Fix)
        // ============================================================================
        /**
         * Execute code στο Figma (για auto-fixes)
         */
        executeCode(code2, timeout2 = 5e3) {
          return __async(this, null, function* () {
            var _a;
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_execute",
                params: {
                  code: code2,
                  timeout: timeout2
                }
              };
              const response = yield this.makeRequest("/execute", payload);
              return {
                success: (_a = response.success) != null ? _a : false,
                result: response.result,
                error: response.error,
                resultAnalysis: response.resultAnalysis
              };
            } catch (error) {
              throw this.handleError("executeCode", error);
            }
          });
        }
        /**
         * Update component instance properties
         */
        updateInstanceProperties(nodeId, properties) {
          return __async(this, null, function* () {
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_set_instance_properties",
                params: {
                  nodeId,
                  properties
                }
              };
              const response = yield this.makeRequest("/instance-properties", payload);
              return {
                success: true,
                result: response
              };
            } catch (error) {
              throw this.handleError("updateInstanceProperties", error);
            }
          });
        }
        // ============================================================================
        // Visual Validation Operations
        // ============================================================================
        /**
         * Capture screenshot για visual validation
         */
        captureScreenshot() {
          return __async(this, arguments, function* (options = {}) {
            this.ensureConnected();
            try {
              const payload = {
                tool: "figma_capture_screenshot",
                params: {
                  nodeId: options.nodeId,
                  format: options.format || "PNG",
                  scale: options.scale || 2
                }
              };
              const response = yield this.makeRequest("/screenshot", payload);
              return {
                imageData: response.imageData,
                format: response.format,
                width: response.width,
                height: response.height,
                nodeId: response.nodeId
              };
            } catch (error) {
              throw this.handleError("captureScreenshot", error);
            }
          });
        }
        // ============================================================================
        // Helper Methods
        // ============================================================================
        /**
         * Make HTTP request to MCP server
         */
        makeRequest(path, payload) {
          return __async(this, null, function* () {
            const url = `${this.endpoint}${path}`;
            console.log(`[MCPBridge] Request: ${path}`, payload);
            const response = yield fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            });
            if (!response.ok) {
              throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
            }
            const data = yield response.json();
            console.log(`[MCPBridge] Response: ${path}`, data);
            return data;
          });
        }
        /**
         * Parse variable response from MCP
         */
        parseVariableResponse(response) {
          var _a, _b, _c;
          return {
            variables: response.variables || [],
            collections: response.collections || [],
            exports: {
              css: (_a = response.exports) == null ? void 0 : _a.css,
              tailwind: (_b = response.exports) == null ? void 0 : _b.tailwind,
              typescript: (_c = response.exports) == null ? void 0 : _c.typescript
            },
            tokenCoverage: response.tokenCoverage,
            dependencies: response.dependencies,
            metadata: response.metadata
          };
        }
        /**
         * Parse style response from MCP
         */
        parseStyleResponse(response) {
          var _a, _b, _c;
          return {
            styles: response.styles || [],
            exports: {
              css: (_a = response.exports) == null ? void 0 : _a.css,
              sass: (_b = response.exports) == null ? void 0 : _b.sass,
              tailwind: (_c = response.exports) == null ? void 0 : _c.tailwind
            },
            usage: response.usage,
            metadata: response.metadata
          };
        }
        /**
         * Parse component response from MCP
         */
        parseComponentResponse(response) {
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
        getCurrentFileUrl() {
          const fileKey = figma.root.id;
          return `https://www.figma.com/file/${fileKey}`;
        }
        /**
         * Ensure connection is established
         */
        ensureConnected() {
          if (!this.isConnected) {
            throw new Error(
              "MCP Bridge not connected. Call connect() first."
            );
          }
        }
        /**
         * Handle errors uniformly
         */
        handleError(operation, error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`[MCPBridge] Error in ${operation}:`, error);
          return {
            operation,
            message,
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            originalError: error
          };
        }
      };
    }
  });

  // component-analyzer.ts
  var ComponentAnalyzer;
  var init_component_analyzer = __esm({
    "component-analyzer.ts"() {
      "use strict";
      ComponentAnalyzer = class {
        /**
         * Analyze a single component or node
         */
        analyzeComponent(node) {
          return __async(this, null, function* () {
            const audit = {
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              score: 0,
              checks: {
                hasDescription: false,
                hasVariants: false,
                hasProperties: false,
                usesAutoLayout: false,
                usesComponents: false,
                usesStyles: false,
                hasDocumentation: false,
                properNaming: false
              },
              issues: [],
              properties: [],
              variants: []
            };
            if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
              yield this.analyzeComponentNode(node, audit);
            } else if (node.type === "INSTANCE") {
              yield this.analyzeInstanceNode(node, audit);
            } else if (node.type === "FRAME" || node.type === "GROUP") {
              yield this.analyzeContainerNode(node, audit);
            } else {
              yield this.analyzeGenericNode(node, audit);
            }
            audit.score = this.calculateScore(audit);
            return audit;
          });
        }
        /**
         * Analyze component node
         */
        analyzeComponentNode(node, audit) {
          return __async(this, null, function* () {
            if (node.description && node.description.trim().length > 0) {
              audit.checks.hasDescription = true;
            } else {
              audit.issues.push({
                type: "warning",
                message: "Component has no description",
                suggestion: "Add a description to document component usage"
              });
            }
            if (node.type === "COMPONENT_SET") {
              audit.checks.hasVariants = true;
              const variantProps = this.extractVariantProperties(node);
              audit.variants = variantProps;
              if (variantProps.length === 0) {
                audit.issues.push({
                  type: "info",
                  message: "Component set has no variants",
                  suggestion: "Consider adding variants for different states"
                });
              }
            }
            if ("componentPropertyDefinitions" in node) {
              const props = this.extractComponentProperties(node);
              audit.properties = props;
              if (props.length > 0) {
                audit.checks.hasProperties = true;
              }
            }
            if ("layoutMode" in node && node.layoutMode !== "NONE") {
              audit.checks.usesAutoLayout = true;
            } else {
              audit.issues.push({
                type: "warning",
                message: "Component does not use Auto Layout",
                suggestion: "Consider using Auto Layout for responsive components"
              });
            }
            if (this.checkNamingConvention(node.name)) {
              audit.checks.properNaming = true;
            } else {
              audit.issues.push({
                type: "info",
                message: "Component name does not follow naming conventions",
                suggestion: "Use PascalCase or kebab-case naming"
              });
            }
            if ("children" in node) {
              const usesComponents = this.checkForComponents(node.children);
              audit.checks.usesComponents = usesComponents;
            }
            const usesStyles = this.checkForStyles(node);
            audit.checks.usesStyles = usesStyles;
          });
        }
        /**
         * Analyze instance node
         */
        analyzeInstanceNode(node, audit) {
          return __async(this, null, function* () {
            try {
              const mainComponent = yield node.getMainComponentAsync();
              if (mainComponent) {
                audit.componentName = mainComponent.name;
                audit.componentKey = mainComponent.key;
                const hasOverrides = this.checkInstanceOverrides(node);
                if (hasOverrides) {
                  audit.checks.hasProperties = true;
                }
              } else {
                audit.issues.push({
                  type: "error",
                  message: "Instance main component is missing or detached",
                  suggestion: "Reconnect instance to its main component"
                });
              }
            } catch (error) {
              audit.issues.push({
                type: "error",
                message: "Could not access main component (async error)",
                suggestion: "Component may be in another page or file"
              });
            }
            if ("layoutMode" in node && node.layoutMode !== "NONE") {
              audit.checks.usesAutoLayout = true;
            }
          });
        }
        /**
         * Analyze container node (Frame/Group)
         */
        analyzeContainerNode(node, audit) {
          return __async(this, null, function* () {
            if ("layoutMode" in node && node.layoutMode !== "NONE") {
              audit.checks.usesAutoLayout = true;
            }
            if ("children" in node) {
              const usesComponents = this.checkForComponents(node.children);
              audit.checks.usesComponents = usesComponents;
              if (!usesComponents) {
                audit.issues.push({
                  type: "info",
                  message: "Container does not use any components",
                  suggestion: "Consider componentizing repeated elements"
                });
              }
            }
            const usesStyles = this.checkForStyles(node);
            audit.checks.usesStyles = usesStyles;
            if (this.checkNamingConvention(node.name)) {
              audit.checks.properNaming = true;
            }
          });
        }
        /**
         * Analyze generic node
         */
        analyzeGenericNode(node, audit) {
          return __async(this, null, function* () {
            const usesStyles = this.checkForStyles(node);
            audit.checks.usesStyles = usesStyles;
            if (this.checkNamingConvention(node.name)) {
              audit.checks.properNaming = true;
            }
            audit.issues.push({
              type: "info",
              message: `Node type ${node.type} has limited analysis`,
              suggestion: "Convert to component or frame for better analysis"
            });
          });
        }
        // ============================================================================
        // HELPER METHODS
        // ============================================================================
        /**
         * Extract variant properties from component set
         */
        extractVariantProperties(componentSet) {
          const variants = [];
          if (componentSet.children.length > 0) {
            const firstChild = componentSet.children[0];
            if (firstChild.type === "COMPONENT") {
              const variantString = firstChild.name;
              const pairs = variantString.split(",").map((s) => s.trim());
              pairs.forEach((pair) => {
                const [property, value] = pair.split("=").map((s) => s.trim());
                if (property && value) {
                  const existing = variants.find((v) => v.property === property);
                  if (existing) {
                    if (!existing.values.includes(value)) {
                      existing.values.push(value);
                    }
                  } else {
                    variants.push({
                      property,
                      values: [value]
                    });
                  }
                }
              });
            }
          }
          return variants;
        }
        /**
         * Extract component properties
         */
        extractComponentProperties(node) {
          const properties = [];
          if ("componentPropertyDefinitions" in node) {
            const defs = node.componentPropertyDefinitions;
            Object.entries(defs).forEach(([key, def]) => {
              properties.push({
                name: key,
                type: def.type,
                defaultValue: def.defaultValue
              });
            });
          }
          return properties;
        }
        /**
         * Check for nested components
         */
        checkForComponents(children) {
          for (const child of children) {
            if (child.type === "INSTANCE" || child.type === "COMPONENT") {
              return true;
            }
            if ("children" in child) {
              if (this.checkForComponents(child.children)) {
                return true;
              }
            }
          }
          return false;
        }
        /**
         * Check for styles usage
         */
        checkForStyles(node) {
          if ("fillStyleId" in node && node.fillStyleId && node.fillStyleId !== "") {
            return true;
          }
          if ("strokeStyleId" in node && node.strokeStyleId && node.strokeStyleId !== "") {
            return true;
          }
          if ("textStyleId" in node && node.textStyleId && node.textStyleId !== "") {
            return true;
          }
          if ("effectStyleId" in node && node.effectStyleId && node.effectStyleId !== "") {
            return true;
          }
          return false;
        }
        /**
         * Check instance overrides
         */
        checkInstanceOverrides(instance) {
          if ("componentProperties" in instance) {
            const props = instance.componentProperties;
            return Object.keys(props).length > 0;
          }
          return false;
        }
        /**
         * Check naming convention
         */
        checkNamingConvention(name) {
          const pascalCase = /^[A-Z][a-zA-Z0-9]*$/;
          const kebabCase = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
          const snakeCase = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
          return pascalCase.test(name) || kebabCase.test(name) || snakeCase.test(name);
        }
        /**
         * Calculate component score
         */
        calculateScore(audit) {
          let score = 0;
          const checks = audit.checks;
          const weights = {
            hasDescription: 15,
            hasVariants: 15,
            hasProperties: 15,
            usesAutoLayout: 20,
            usesComponents: 15,
            usesStyles: 15,
            hasDocumentation: 5,
            properNaming: 5
          };
          Object.entries(checks).forEach(([key, value]) => {
            if (value) {
              score += weights[key] || 0;
            }
          });
          const criticalIssues = audit.issues.filter((i) => i.type === "error").length;
          score = Math.max(0, score - criticalIssues * 10);
          return Math.min(100, score);
        }
      };
    }
  });

  // token-analyzer.ts
  var TokenAnalyzer;
  var init_token_analyzer = __esm({
    "token-analyzer.ts"() {
      "use strict";
      TokenAnalyzer = class {
        /**
         * Analyze token usage in a node
         */
        analyzeTokenUsage(node) {
          const usage = {
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
        analyzeNodeTokens(node, usage) {
          if ("fills" in node && Array.isArray(node.fills)) {
            node.fills.forEach((fill, index) => {
              if (fill.type === "SOLID" && "boundVariables" in fill) {
                usage.usedTokens++;
                usage.totalTokens++;
                usage.tokenReferences.push({
                  property: `fill[${index}]`,
                  tokenName: "variable-bound",
                  tokenId: "unknown"
                });
              } else if (fill.type === "SOLID" && "color" in fill) {
                usage.hardcodedValues++;
                usage.totalTokens++;
                usage.hardcodedProperties.push({
                  property: `fill[${index}].color`,
                  value: this.rgbToHex(fill.color),
                  type: "color"
                });
              }
            });
          }
          if ("strokes" in node && Array.isArray(node.strokes)) {
            node.strokes.forEach((stroke, index) => {
              if (stroke.type === "SOLID" && "boundVariables" in stroke) {
                usage.usedTokens++;
                usage.totalTokens++;
                usage.tokenReferences.push({
                  property: `stroke[${index}]`,
                  tokenName: "variable-bound",
                  tokenId: "unknown"
                });
              } else if (stroke.type === "SOLID" && "color" in stroke) {
                usage.hardcodedValues++;
                usage.totalTokens++;
                usage.hardcodedProperties.push({
                  property: `stroke[${index}].color`,
                  value: this.rgbToHex(stroke.color),
                  type: "color"
                });
              }
            });
          }
          if (node.type === "TEXT") {
            const textNode = node;
            if (typeof textNode.fontSize === "number") {
              usage.hardcodedValues++;
              usage.totalTokens++;
              usage.hardcodedProperties.push({
                property: "fontSize",
                value: textNode.fontSize,
                type: "number"
              });
            }
            if ("lineHeight" in textNode && typeof textNode.lineHeight !== "symbol") {
              usage.hardcodedValues++;
              usage.totalTokens++;
            }
          }
          if ("paddingLeft" in node || "itemSpacing" in node) {
            const frameNode = node;
            if (typeof frameNode.paddingLeft === "number" && frameNode.paddingLeft > 0) {
              usage.hardcodedValues++;
              usage.totalTokens++;
              usage.hardcodedProperties.push({
                property: "paddingLeft",
                value: frameNode.paddingLeft,
                type: "number"
              });
            }
            if (typeof frameNode.itemSpacing === "number" && frameNode.itemSpacing > 0) {
              usage.hardcodedValues++;
              usage.totalTokens++;
              usage.hardcodedProperties.push({
                property: "itemSpacing",
                value: frameNode.itemSpacing,
                type: "number"
              });
            }
          }
          if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
            usage.hardcodedValues++;
            usage.totalTokens++;
            usage.hardcodedProperties.push({
              property: "cornerRadius",
              value: node.cornerRadius,
              type: "number"
            });
          }
          if (usage.hardcodedValues > usage.usedTokens) {
            usage.issues.push({
              type: "warning",
              property: "general",
              message: "More hardcoded values than tokens",
              suggestion: "Consider using design tokens for consistency"
            });
          }
          if (usage.hardcodedProperties.length > 5) {
            usage.issues.push({
              type: "warning",
              property: "general",
              message: `${usage.hardcodedProperties.length} hardcoded properties detected`,
              suggestion: "Replace hardcoded values with design tokens"
            });
          }
        }
        /**
         * Analyze token coverage across multiple nodes
         */
        analyzeTokenCoverage(nodes) {
          let nodesUsingTokens = 0;
          let nodesWithHardcoded = 0;
          nodes.forEach((node) => {
            const usage = this.analyzeTokenUsage(node);
            if (usage.usedTokens > 0) {
              nodesUsingTokens++;
            }
            if (usage.hardcodedValues > 0) {
              nodesWithHardcoded++;
            }
          });
          const coveragePercentage = nodes.length > 0 ? Math.round(nodesUsingTokens / nodes.length * 100) : 0;
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
        getLocalVariables() {
          try {
            const variables = figma.variables.getLocalVariables();
            const collections = figma.variables.getLocalVariableCollections();
            return {
              count: variables.length,
              collections: collections.map((c) => c.name)
            };
          } catch (error) {
            console.error("Error getting variables:", error);
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
        rgbToHex(rgb) {
          const r = Math.round(rgb.r * 255);
          const g = Math.round(rgb.g * 255);
          const b = Math.round(rgb.b * 255);
          return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        }
        /**
         * Check if value is likely a token value
         */
        isLikelyTokenValue(value) {
          if (typeof value === "number") {
            return value % 4 === 0;
          }
          if (typeof value === "string") {
            return /^(#[0-9A-Fa-f]{6}|rgba?\([^)]+\))$/.test(value);
          }
          return false;
        }
      };
    }
  });

  // scoring-calculator.ts
  var ScoringCalculator;
  var init_scoring_calculator = __esm({
    "scoring-calculator.ts"() {
      "use strict";
      ScoringCalculator = class {
        /**
         * Calculate overall score from component audits
         */
        calculateOverallScore(audits) {
          if (audits.length === 0) return 0;
          const totalScore = audits.reduce((sum, audit) => sum + audit.score, 0);
          return Math.round(totalScore / audits.length);
        }
        /**
         * Generate summary from component audits
         */
        generateSummary(audits) {
          const summary = {
            totalComponents: audits.length,
            averageScore: this.calculateOverallScore(audits),
            componentTypes: this.countComponentTypes(audits),
            commonIssues: this.aggregateIssues(audits),
            strengths: this.identifyStrengths(audits),
            recommendations: this.generateRecommendations(audits),
            categoryScores: this.calculateCategoryScores(audits)
          };
          return summary;
        }
        /**
         * Count component types
         */
        countComponentTypes(audits) {
          const types = {};
          audits.forEach((audit) => {
            const type = audit.nodeType;
            types[type] = (types[type] || 0) + 1;
          });
          return types;
        }
        /**
         * Aggregate common issues
         */
        aggregateIssues(audits) {
          const issueMap = /* @__PURE__ */ new Map();
          audits.forEach((audit) => {
            audit.issues.forEach((issue) => {
              const key = issue.message;
              const existing = issueMap.get(key);
              if (existing) {
                existing.count++;
                if (issue.type === "error") {
                  existing.severity = "error";
                } else if (issue.type === "warning" && existing.severity !== "error") {
                  existing.severity = "warning";
                }
              } else {
                issueMap.set(key, {
                  count: 1,
                  severity: issue.type
                });
              }
            });
          });
          const issues = Array.from(issueMap.entries()).map(([issue, data]) => ({
            issue,
            count: data.count,
            severity: data.severity
          }));
          issues.sort((a, b) => b.count - a.count);
          return issues.slice(0, 10);
        }
        /**
         * Identify strengths
         */
        identifyStrengths(audits) {
          const strengths = [];
          const features = {
            descriptions: audits.filter((a) => a.checks.hasDescription).length,
            variants: audits.filter((a) => a.checks.hasVariants).length,
            properties: audits.filter((a) => a.checks.hasProperties).length,
            autoLayout: audits.filter((a) => a.checks.usesAutoLayout).length,
            components: audits.filter((a) => a.checks.usesComponents).length,
            styles: audits.filter((a) => a.checks.usesStyles).length,
            naming: audits.filter((a) => a.checks.properNaming).length
          };
          const total = audits.length;
          const threshold = 0.7;
          if (features.descriptions / total >= threshold) {
            strengths.push(`Strong documentation: ${Math.round(features.descriptions / total * 100)}% of components have descriptions`);
          }
          if (features.variants / total >= 0.3) {
            strengths.push(`Good variant usage: ${Math.round(features.variants / total * 100)}% of components use variants`);
          }
          if (features.autoLayout / total >= threshold) {
            strengths.push(`Excellent Auto Layout adoption: ${Math.round(features.autoLayout / total * 100)}% usage`);
          }
          if (features.components / total >= threshold) {
            strengths.push(`Strong componentization: ${Math.round(features.components / total * 100)}% use nested components`);
          }
          if (features.styles / total >= threshold) {
            strengths.push(`Good style system: ${Math.round(features.styles / total * 100)}% use styles`);
          }
          if (features.naming / total >= threshold) {
            strengths.push(`Consistent naming: ${Math.round(features.naming / total * 100)}% follow conventions`);
          }
          return strengths;
        }
        /**
         * Generate recommendations
         */
        generateRecommendations(audits) {
          const recommendations = [];
          const total = audits.length;
          const rates = {
            descriptions: audits.filter((a) => a.checks.hasDescription).length / total,
            variants: audits.filter((a) => a.checks.hasVariants).length / total,
            properties: audits.filter((a) => a.checks.hasProperties).length / total,
            autoLayout: audits.filter((a) => a.checks.usesAutoLayout).length / total,
            components: audits.filter((a) => a.checks.usesComponents).length / total,
            styles: audits.filter((a) => a.checks.usesStyles).length / total,
            naming: audits.filter((a) => a.checks.properNaming).length / total
          };
          if (rates.descriptions < 0.5) {
            recommendations.push(`Add descriptions to ${Math.round((1 - rates.descriptions) * 100)}% of components for better documentation`);
          }
          if (rates.autoLayout < 0.6) {
            recommendations.push(`Implement Auto Layout in ${Math.round((1 - rates.autoLayout) * 100)}% of components for responsive design`);
          }
          if (rates.styles < 0.7) {
            recommendations.push(`Increase style usage to ${Math.round((1 - rates.styles) * 100)}% for better consistency`);
          }
          if (rates.components < 0.5) {
            recommendations.push(`Componentize repeated elements in ${Math.round((1 - rates.components) * 100)}% of frames`);
          }
          if (rates.naming < 0.7) {
            recommendations.push(`Standardize naming conventions across ${Math.round((1 - rates.naming) * 100)}% of components`);
          }
          if (rates.variants < 0.2 && audits.some((a) => a.nodeType === "COMPONENT")) {
            recommendations.push("Consider adding variants to components for different states");
          }
          if (rates.properties < 0.3 && audits.some((a) => a.nodeType === "COMPONENT")) {
            recommendations.push("Add component properties for more flexible components");
          }
          const avgScore = this.calculateOverallScore(audits);
          if (avgScore < 60) {
            recommendations.push("\u{1F916} AI-readiness: Focus on documentation and consistent naming to improve AI understanding");
          } else if (avgScore < 80) {
            recommendations.push("\u{1F916} AI-readiness: Add more structured properties and variants for better AI integration");
          } else {
            recommendations.push("\u{1F916} AI-readiness: Excellent! Design system is well-prepared for AI tools");
          }
          return recommendations;
        }
        /**
         * Calculate category scores
         */
        calculateCategoryScores(audits) {
          const total = audits.length;
          if (total === 0) return {};
          return {
            documentation: Math.round(
              audits.filter((a) => a.checks.hasDescription).length / total * 100
            ),
            structure: Math.round(
              audits.filter((a) => a.checks.usesAutoLayout).length / total * 100
            ),
            consistency: Math.round(
              audits.filter((a) => a.checks.usesStyles).length / total * 100
            ),
            reusability: Math.round(
              audits.filter((a) => a.checks.usesComponents).length / total * 100
            ),
            flexibility: Math.round(
              (audits.filter((a) => a.checks.hasVariants).length + audits.filter((a) => a.checks.hasProperties).length) / (total * 2) * 100
            ),
            naming: Math.round(
              audits.filter((a) => a.checks.properNaming).length / total * 100
            )
          };
        }
        /**
         * Get score color (for UI)
         */
        getScoreColor(score) {
          if (score >= 80) return "#10b981";
          if (score >= 60) return "#f59e0b";
          if (score >= 40) return "#f97316";
          return "#ef4444";
        }
        /**
         * Get score label
         */
        getScoreLabel(score) {
          if (score >= 90) return "Excellent";
          if (score >= 80) return "Very Good";
          if (score >= 70) return "Good";
          if (score >= 60) return "Fair";
          if (score >= 40) return "Needs Improvement";
          return "Poor";
        }
        /**
         * Get AI-readiness level
         */
        getAIReadinessLevel(score) {
          if (score >= 85) {
            return {
              level: "AI-Ready",
              description: "Design system is highly structured and ready for AI integration"
            };
          }
          if (score >= 70) {
            return {
              level: "AI-Friendly",
              description: "Good structure, some improvements needed for optimal AI usage"
            };
          }
          if (score >= 50) {
            return {
              level: "Partially AI-Compatible",
              description: "Basic structure in place, significant improvements needed"
            };
          }
          return {
            level: "Not AI-Ready",
            description: "Design system needs substantial work for AI integration"
          };
        }
      };
    }
  });

  // enriched-analyzer.ts
  var EnrichedAnalyzer;
  var init_enriched_analyzer = __esm({
    "enriched-analyzer.ts"() {
      "use strict";
      init_component_analyzer();
      init_token_analyzer();
      init_scoring_calculator();
      EnrichedAnalyzer = class {
        constructor(mcpBridge, componentAnalyzer, tokenAnalyzer, scoringCalculator) {
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
        analyzeComponentWithEnrichment(node) {
          return __async(this, null, function* () {
            console.log(`[EnrichedAnalyzer] Analyzing ${node.name} with enrichment...`);
            const basicAudit = yield this.componentAnalyzer.analyzeComponent(node);
            let tokenCoverage;
            let semanticTokens;
            let exports;
            try {
              if (this.mcpBridge.getConnectionStatus()) {
                const metadata = yield this.mcpBridge.getComponentMetadata(node.id, {
                  enrich: true
                });
                tokenCoverage = metadata.tokenCoverage;
                if (tokenCoverage) {
                  semanticTokens = yield this.validateSemanticTokens(node, tokenCoverage);
                }
                if (metadata.tokenCoverage && metadata.tokenCoverage.percentage > 80) {
                  exports = yield this.generateExports(node);
                }
              }
            } catch (error) {
              console.warn("[EnrichedAnalyzer] MCP enrichment failed, using basic audit only:", error);
            }
            const enrichedFindings = this.generateEnrichedFindings(
              basicAudit,
              tokenCoverage,
              semanticTokens
            );
            const enrichedScore = this.calculateEnrichedScore(
              basicAudit.score,
              tokenCoverage,
              semanticTokens
            );
            return __spreadProps(__spreadValues({}, basicAudit), {
              score: enrichedScore,
              findings: enrichedFindings,
              tokenCoverage,
              semanticTokens,
              exports
            });
          });
        }
        /**
         * Batch analyze με progress tracking
         */
        analyzeBatch(nodes, onProgress) {
          return __async(this, null, function* () {
            const results = [];
            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if (onProgress) {
                onProgress(i + 1, nodes.length);
              }
              const audit = yield this.analyzeComponentWithEnrichment(node);
              results.push(audit);
              if (i % 5 === 0) {
                yield new Promise((resolve) => setTimeout(resolve, 0));
              }
            }
            return results;
          });
        }
        // ============================================================================
        // Token Coverage Analysis
        // ============================================================================
        /**
         * Check for hardcoded values που πρέπει να γίνουν tokens
         */
        checkHardcodedValues(node) {
          return __async(this, null, function* () {
            const findings = [];
            try {
              const metadata = yield this.mcpBridge.getComponentMetadata(node.id, {
                enrich: true
              });
              if (!metadata.hardcodedValues || metadata.hardcodedValues.length === 0) {
                findings.push({
                  severity: "success",
                  category: "context",
                  message: "No hardcoded values detected. All properties use design tokens.",
                  impact: 0
                });
                return findings;
              }
              const highConfidence = metadata.hardcodedValues.filter((v) => (v.confidence || 0) > 0.8);
              const mediumConfidence = metadata.hardcodedValues.filter(
                (v) => (v.confidence || 0) > 0.5 && (v.confidence || 0) <= 0.8
              );
              if (highConfidence.length > 0) {
                findings.push({
                  severity: "error",
                  category: "context",
                  message: `Found ${highConfidence.length} hardcoded value(s) that should use tokens`,
                  impact: 0.3,
                  suggestion: this.formatHardcodedSuggestions(highConfidence)
                });
              }
              if (mediumConfidence.length > 0) {
                findings.push({
                  severity: "warning",
                  category: "context",
                  message: `Found ${mediumConfidence.length} potential hardcoded value(s)`,
                  impact: 0.1,
                  suggestion: this.formatHardcodedSuggestions(mediumConfidence)
                });
              }
            } catch (error) {
              console.warn("[EnrichedAnalyzer] Hardcoded value check failed:", error);
            }
            return findings;
          });
        }
        /**
         * Calculate token coverage percentage
         */
        checkTokenCoverage(node) {
          return __async(this, null, function* () {
            const findings = [];
            try {
              const metadata = yield this.mcpBridge.getComponentMetadata(node.id, {
                enrich: true
              });
              const coverage = metadata.tokenCoverage;
              if (!coverage) {
                return findings;
              }
              if (coverage.percentage >= 90) {
                findings.push({
                  severity: "success",
                  category: "context",
                  message: `Excellent token coverage: ${coverage.percentage.toFixed(1)}%`,
                  impact: 0,
                  suggestion: `${coverage.usingTokens}/${coverage.total} properties use design tokens`
                });
              } else if (coverage.percentage >= 70) {
                findings.push({
                  severity: "info",
                  category: "context",
                  message: `Good token coverage: ${coverage.percentage.toFixed(1)}%`,
                  impact: 0.05,
                  suggestion: `Consider tokenizing ${coverage.hardcoded} remaining properties`
                });
              } else if (coverage.percentage >= 50) {
                findings.push({
                  severity: "warning",
                  category: "context",
                  message: `Moderate token coverage: ${coverage.percentage.toFixed(1)}%`,
                  impact: 0.15,
                  suggestion: `${coverage.hardcoded} properties still use hardcoded values`
                });
              } else {
                findings.push({
                  severity: "error",
                  category: "context",
                  message: `Low token coverage: ${coverage.percentage.toFixed(1)}%`,
                  impact: 0.25,
                  suggestion: `Only ${coverage.usingTokens}/${coverage.total} properties use tokens. Consider refactoring.`
                });
              }
            } catch (error) {
              console.warn("[EnrichedAnalyzer] Token coverage check failed:", error);
            }
            return findings;
          });
        }
        // ============================================================================
        // Semantic Token Validation
        // ============================================================================
        /**
         * Validate semantic token usage
         * e.g., checking if "background" properties use semantic background tokens
         */
        validateSemanticTokens(node, coverage) {
          return __async(this, null, function* () {
            const correct = [];
            const incorrect = [];
            const suggestions = [];
            try {
              const variablesData = yield this.mcpBridge.getEnrichedVariables({
                resolveAliases: true
              });
              for (const tokenName of coverage.usedTokens) {
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
              for (const missing of coverage.missingTokens) {
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
              console.warn("[EnrichedAnalyzer] Semantic validation failed:", error);
            }
            return {
              correct,
              incorrect,
              suggestions
            };
          });
        }
        /**
         * Check if a token follows semantic naming conventions
         */
        checkSemanticConsistency(tokenName, allVariables) {
          const parts = tokenName.split("/");
          const lastPart = parts[parts.length - 1];
          const semanticPatterns = {
            background: ["bg", "background", "surface"],
            text: ["text", "fg", "foreground", "content"],
            border: ["border", "stroke", "outline"],
            interactive: ["primary", "secondary", "accent", "action"]
          };
          return {
            isCorrect: true
            // Default to correct for now
          };
        }
        /**
         * Suggest semantic token για hardcoded value
         */
        suggestSemanticToken(property, value, allVariables) {
          if (property === "fills" && typeof value === "string") {
            const colorTokens = allVariables.filter(
              (v) => v.resolvedType === "COLOR" && v.name.includes("background")
            );
            if (colorTokens.length > 0) {
              return {
                property,
                suggestedToken: colorTokens[0].name,
                reason: "Background color should use semantic background token",
                confidence: 0.8
              };
            }
          }
          return void 0;
        }
        // ============================================================================
        // Export Generation
        // ============================================================================
        /**
         * Generate CSS/Tailwind/TS exports για well-tokenized components
         */
        generateExports(node) {
          return __async(this, null, function* () {
            try {
              const metadata = yield this.mcpBridge.getComponentMetadata(node.id, {
                enrich: true
              });
              return {
                css: "/* CSS export would be generated here */",
                tailwind: "/* Tailwind config would be generated here */",
                typescript: "/* TypeScript types would be generated here */"
              };
            } catch (error) {
              console.warn("[EnrichedAnalyzer] Export generation failed:", error);
              return {};
            }
          });
        }
        // ============================================================================
        // Helper Methods
        // ============================================================================
        /**
         * Generate enhanced findings combining basic + MCP data
         */
        generateEnrichedFindings(basicAudit, tokenCoverage, semanticTokens) {
          const findings = [...basicAudit.findings];
          if (tokenCoverage) {
            if (tokenCoverage.percentage < 70) {
              findings.push({
                severity: "warning",
                category: "context",
                message: `Token coverage is ${tokenCoverage.percentage.toFixed(1)}% (target: 70%+)`,
                impact: 0.15,
                suggestion: `${tokenCoverage.hardcoded} properties could be tokenized`
              });
            }
          }
          if (semanticTokens && semanticTokens.incorrect.length > 0) {
            findings.push({
              severity: "warning",
              category: "context",
              message: `${semanticTokens.incorrect.length} semantic token violation(s)`,
              impact: 0.1,
              suggestion: "Review token naming conventions"
            });
          }
          return findings;
        }
        /**
         * Calculate enhanced score με token coverage penalty/bonus
         */
        calculateEnrichedScore(basicScore, tokenCoverage, semanticTokens) {
          let score = basicScore;
          if (tokenCoverage) {
            const coverageBonus = (tokenCoverage.percentage - 70) * 0.2;
            score += Math.max(-10, Math.min(10, coverageBonus));
          }
          if (semanticTokens && semanticTokens.incorrect.length > 0) {
            score -= Math.min(5, semanticTokens.incorrect.length * 2);
          }
          return Math.max(0, Math.min(100, score));
        }
        /**
         * Format hardcoded value suggestions
         */
        formatHardcodedSuggestions(values) {
          if (values.length === 0) return "";
          const suggestions = values.slice(0, 3).map((v) => {
            if (v.suggestedToken) {
              return `${v.property}: "${v.value}" \u2192 ${v.suggestedToken}`;
            }
            return `${v.property}: "${v.value}"`;
          }).join(", ");
          if (values.length > 3) {
            return `${suggestions} (+${values.length - 3} more)`;
          }
          return suggestions;
        }
      };
    }
  });

  // code.ts
  var require_code = __commonJS({
    "code.ts"(exports) {
      init_bridge();
      init_mcp_bridge();
      init_enriched_analyzer();
      init_component_analyzer();
      init_token_analyzer();
      init_scoring_calculator();
      var mcpBridge = null;
      var enrichedAnalyzer = null;
      var componentAnalyzer;
      var tokenAnalyzer;
      var scoringCalculator;
      var isScanning = false;
      function init() {
        return __async(this, null, function* () {
          console.log("\u{1F680} DS Context Intelligence initializing...");
          console.log("\u{1F309} Starting embedded Desktop Bridge...");
          startDesktopBridge();
          figma.showUI(__html__, {
            width: 400,
            height: 600,
            title: "DS Context Intelligence"
          });
          componentAnalyzer = new ComponentAnalyzer();
          tokenAnalyzer = new TokenAnalyzer();
          scoringCalculator = new ScoringCalculator();
          yield initializeMCP();
          console.log("\u2705 DS Context Intelligence ready!");
        });
      }
      function initializeMCP() {
        return __async(this, null, function* () {
          try {
            console.log("\u{1F50C} Attempting MCP connection...");
            mcpBridge = new MCPBridge({
              mode: "auto",
              // Auto-detect: desktop_bridge > rest_api > offline
              timeout: 3e3
            });
            const status = yield mcpBridge.connect();
            if (status.connected) {
              console.log(`\u2705 MCP connected (${status.mode})`);
              enrichedAnalyzer = new EnrichedAnalyzer(
                mcpBridge,
                componentAnalyzer,
                tokenAnalyzer,
                scoringCalculator
              );
              figma.ui.postMessage({
                type: "MCP_STATUS",
                connected: true,
                mode: status.mode
              });
            } else {
              console.log("\u26A0\uFE0F MCP not available, using basic mode");
              figma.ui.postMessage({
                type: "MCP_STATUS",
                connected: false,
                mode: "offline"
              });
            }
          } catch (error) {
            console.error("\u274C MCP initialization failed:", error);
            figma.ui.postMessage({
              type: "MCP_STATUS",
              connected: false,
              mode: "offline",
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
      }
      figma.ui.onmessage = (msg2) => __async(null, null, function* () {
        console.log("\u{1F4E8} Message received:", msg2.type);
        try {
          switch (msg2.type) {
            case "SCAN_CURRENT_PAGE":
              yield handleScanCurrentPage();
              break;
            case "SCAN_SELECTION":
              yield handleScanSelection();
              break;
            case "SCAN_FILE":
              yield handleScanFile();
              break;
            case "RETRY_MCP":
              yield initializeMCP();
              break;
            case "GET_STATUS":
              yield handleGetStatus();
              break;
            case "CLOSE":
              handleClose();
              break;
            default:
              if (msg2.type.startsWith("BRIDGE_")) {
                return;
              }
              console.warn("\u26A0\uFE0F Unknown message type:", msg2.type);
          }
        } catch (error) {
          console.error("\u274C Message handler error:", error);
          figma.ui.postMessage({
            type: "ERROR",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
      function handleScanCurrentPage() {
        return __async(this, null, function* () {
          if (isScanning) {
            figma.ui.postMessage({
              type: "ERROR",
              error: "Scan already in progress"
            });
            return;
          }
          isScanning = true;
          console.log("\u{1F50D} Scanning current page...");
          try {
            figma.ui.postMessage({
              type: "SCAN_STARTED",
              scope: "page"
            });
            const page = figma.currentPage;
            const results = yield scanNodes(page.children);
            const audit = calculatePageAudit(results, page.name);
            figma.ui.postMessage({
              type: "SCAN_COMPLETE",
              audit
            });
            console.log("\u2705 Scan complete");
          } catch (error) {
            console.error("\u274C Scan error:", error);
            figma.ui.postMessage({
              type: "ERROR",
              error: error instanceof Error ? error.message : String(error)
            });
          } finally {
            isScanning = false;
          }
        });
      }
      function handleScanSelection() {
        return __async(this, null, function* () {
          if (isScanning) {
            figma.ui.postMessage({
              type: "ERROR",
              error: "Scan already in progress"
            });
            return;
          }
          const selection = figma.currentPage.selection;
          if (selection.length === 0) {
            figma.ui.postMessage({
              type: "ERROR",
              error: "Please select at least one layer"
            });
            return;
          }
          isScanning = true;
          console.log(`\u{1F50D} Scanning ${selection.length} selected node(s)...`);
          try {
            figma.ui.postMessage({
              type: "SCAN_STARTED",
              scope: "selection",
              count: selection.length
            });
            const results = yield scanNodes(selection);
            const audit = calculateSelectionAudit(results);
            figma.ui.postMessage({
              type: "SCAN_COMPLETE",
              audit
            });
            console.log("\u2705 Scan complete");
          } catch (error) {
            console.error("\u274C Scan error:", error);
            figma.ui.postMessage({
              type: "ERROR",
              error: error instanceof Error ? error.message : String(error)
            });
          } finally {
            isScanning = false;
          }
        });
      }
      function handleScanFile() {
        return __async(this, null, function* () {
          if (isScanning) {
            figma.ui.postMessage({
              type: "ERROR",
              error: "Scan already in progress"
            });
            return;
          }
          isScanning = true;
          console.log("\u{1F50D} Scanning entire file...");
          try {
            figma.ui.postMessage({
              type: "SCAN_STARTED",
              scope: "file",
              pageCount: figma.root.children.length
            });
            const allResults = [];
            for (const page of figma.root.children) {
              console.log(`\u{1F4C4} Scanning page: ${page.name}`);
              const pageResults = yield scanNodes(page.children);
              allResults.push(...pageResults);
            }
            const audit = calculateFileAudit(allResults);
            figma.ui.postMessage({
              type: "SCAN_COMPLETE",
              audit
            });
            console.log("\u2705 Scan complete");
          } catch (error) {
            console.error("\u274C Scan error:", error);
            figma.ui.postMessage({
              type: "ERROR",
              error: error instanceof Error ? error.message : String(error)
            });
          } finally {
            isScanning = false;
          }
        });
      }
      function handleGetStatus() {
        return __async(this, null, function* () {
          const bridgeStatus = getDesktopBridge().getStatus();
          const mcpStatus = mcpBridge ? mcpBridge.getConnectionStatus() : { connected: false, mode: "offline" };
          figma.ui.postMessage({
            type: "STATUS_UPDATE",
            bridge: bridgeStatus,
            mcp: mcpStatus,
            fileName: figma.root.name,
            currentPage: figma.currentPage.name,
            selectionCount: figma.currentPage.selection.length
          });
        });
      }
      function handleClose() {
        console.log("\u{1F44B} Closing plugin...");
        stopDesktopBridge();
        figma.closePlugin();
      }
      function scanNodes(nodes) {
        return __async(this, null, function* () {
          const results = [];
          for (const node of nodes) {
            const audit = yield analyzeNode(node);
            if (audit) {
              results.push(audit);
            }
            if ("children" in node) {
              const childResults = yield scanNodes(node.children);
              results.push(...childResults);
            }
          }
          return results;
        });
      }
      function analyzeNode(node) {
        return __async(this, null, function* () {
          try {
            if (enrichedAnalyzer && (mcpBridge == null ? void 0 : mcpBridge.getConnectionStatus().connected)) {
              return yield enrichedAnalyzer.analyzeComponentWithEnrichment(node);
            } else {
              return yield componentAnalyzer.analyzeComponent(node);
            }
          } catch (error) {
            console.error(`\u274C Error analyzing node ${node.name}:`, error);
            return null;
          }
        });
      }
      function calculatePageAudit(results, pageName) {
        const validResults = results.filter((r) => r !== null);
        return {
          scope: "page",
          scopeName: pageName,
          totalComponents: validResults.length,
          componentAudits: validResults,
          overallScore: scoringCalculator.calculateOverallScore(validResults),
          summary: scoringCalculator.generateSummary(validResults),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      function calculateSelectionAudit(results) {
        const validResults = results.filter((r) => r !== null);
        return {
          scope: "selection",
          scopeName: "Selected layers",
          totalComponents: validResults.length,
          componentAudits: validResults,
          overallScore: scoringCalculator.calculateOverallScore(validResults),
          summary: scoringCalculator.generateSummary(validResults),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      function calculateFileAudit(results) {
        const validResults = results.filter((r) => r !== null);
        return {
          scope: "file",
          scopeName: figma.root.name,
          totalComponents: validResults.length,
          componentAudits: validResults,
          overallScore: scoringCalculator.calculateOverallScore(validResults),
          summary: scoringCalculator.generateSummary(validResults),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      init();
    }
  });
  require_code();
})();
