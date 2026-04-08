/**
 * API Agent
 * ─────────
 * Allows Vedaa to call external HTTP APIs.
 *
 * APIs are registered via config — each becomes an OpenAI tool.
 * The LLM picks which API to call, the agent executes the HTTP request.
 *
 * Config example (in agent-config.json → apis):
 *   {
 *     "name": "get_weather",
 *     "description": "Get current weather for a city",
 *     "endpoint": "https://api.weatherapi.com/v1/current.json",
 *     "method": "GET",
 *     "headers": { "Authorization": "Bearer {{WEATHER_API_KEY}}" },
 *     "params": {
 *       "q": { "type": "string", "description": "City name", "required": true }
 *     }
 *   }
 */

class ApiAgent {
  /**
   * @param {object[]} apiConfigs — array of API tool configs
   */
  constructor(apiConfigs = []) {
    this.apis = apiConfigs;
  }

  /**
   * Build OpenAI tool definitions + handlers for each configured API.
   * @returns {{ definition: object, handler: Function }[]}
   */
  getTools() {
    const tools = [];

    for (const api of this.apis) {
      // Build the JSON Schema for parameters
      const properties = {};
      const required = [];

      for (const [paramName, paramDef] of Object.entries(api.params || {})) {
        properties[paramName] = {
          type: paramDef.type || 'string',
          description: paramDef.description || paramName,
        };
        if (paramDef.enum) properties[paramName].enum = paramDef.enum;
        if (paramDef.required) required.push(paramName);
      }

      // Also support a request body schema for POST/PUT/PATCH
      if (api.body) {
        for (const [paramName, paramDef] of Object.entries(api.body)) {
          properties[paramName] = {
            type: paramDef.type || 'string',
            description: paramDef.description || paramName,
          };
          if (paramDef.enum) properties[paramName].enum = paramDef.enum;
          if (paramDef.required) required.push(paramName);
        }
      }

      const definition = {
        type: 'function',
        function: {
          name: api.name,
          description: api.description || `Call the ${api.name} API`,
          parameters: {
            type: 'object',
            properties,
            required,
          },
        },
      };

      const handler = async (args) => {
        return await this._callApi(api, args);
      };

      tools.push({ definition, handler });
    }

    // Also register a generic HTTP caller for ad-hoc API calls
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'http_request',
          description: 'Make a generic HTTP request to any URL. Use this when no specific API tool matches the user\'s request.',
          parameters: {
            type: 'object',
            properties: {
              url:     { type: 'string', description: 'The full URL to call' },
              method:  { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' },
              headers: { type: 'object', description: 'Request headers as key-value pairs' },
              body:    { type: 'object', description: 'Request body (for POST/PUT/PATCH)' },
            },
            required: ['url', 'method'],
          },
        },
      },
      handler: async (args) => {
        return await this._genericHttpRequest(args);
      },
    });

    return tools;
  }

  /**
   * Execute a configured API call.
   */
  async _callApi(apiConfig, args) {
    const method = (apiConfig.method || 'GET').toUpperCase();
    let url = this._resolveEnvVars(apiConfig.endpoint);

    // Build headers with env var substitution
    const headers = { 'Content-Type': 'application/json' };
    if (apiConfig.headers) {
      for (const [key, value] of Object.entries(apiConfig.headers)) {
        headers[key] = this._resolveEnvVars(value);
      }
    }

    // Replace path parameters like {groww_order_id} in the URL
    const usedPathParams = new Set();
    url = url.replace(/\{(\w+)\}/g, (_match, paramName) => {
      usedPathParams.add(paramName);
      return encodeURIComponent(args[paramName] || '');
    });

    // Separate query params from body params (skip path params already consumed)
    const queryParams = {};
    const bodyParams = {};

    for (const [key, value] of Object.entries(args)) {
      if (usedPathParams.has(key)) continue; // already in URL path
      if (apiConfig.params?.[key] && !apiConfig.params[key]._pathParam) {
        queryParams[key] = value;
      } else if (apiConfig.params?.[key]?._pathParam) {
        // path param already handled above
      } else {
        bodyParams[key] = value;
      }
    }

    // Append query params to URL
    if (Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams(queryParams).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }

    // Build fetch options
    const fetchOpts = { method, headers };
    if (['POST', 'PUT', 'PATCH'].includes(method) && Object.keys(bodyParams).length > 0) {
      // Some APIs (like Groww margin calculator) expect an array body
      if (apiConfig._note && apiConfig._note.includes('JSON array')) {
        fetchOpts.body = JSON.stringify([bodyParams]);
      } else {
        fetchOpts.body = JSON.stringify(bodyParams);
      }
    }

    console.log(`   🌐  API call: ${method} ${url}`);

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return { error: `HTTP ${response.status}`, details: data };
    }

    // Return as object with both raw data (for table extraction) and truncated string (for LLM context)
    // The agent-manager will use _rawData for table extraction and the string for the LLM
    const resultStr = typeof data === 'string' ? data : JSON.stringify(data);
    if (resultStr.length > 3000) {
      const truncated = resultStr.slice(0, 3000) + '\n... [truncated]';
      // Attach raw data so agent-manager can extract tables from the full response
      return { _rawData: data, _truncated: truncated, toString() { return truncated; } };
    }
    return data;
  }

  /**
   * Generic HTTP request handler.
   */
  async _genericHttpRequest({ url, method, headers = {}, body }) {
    const fetchOpts = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOpts.body = JSON.stringify(body);
    }

    console.log(`   🌐  Generic HTTP: ${method} ${url}`);

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    const result = typeof data === 'string' ? data : JSON.stringify(data);
    if (result.length > 3000) {
      return result.slice(0, 3000) + '\n... [truncated]';
    }
    return data;
  }

  /**
   * Replace {{ENV_VAR}} placeholders with actual environment variable values.
   */
  _resolveEnvVars(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
      return process.env[varName] || '';
    });
  }
}

module.exports = ApiAgent;
