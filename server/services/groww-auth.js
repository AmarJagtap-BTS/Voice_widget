/**
 * Groww Authentication Service
 * ─────────────────────────────
 * Handles Groww Trading API authentication:
 *   1. Access Token approach — use a manually generated token from Groww dashboard
 *   2. API Key + Secret approach — auto-generate token via SHA256 checksum
 *
 * The resolved access token is stored in process.env.GROWW_ACCESS_TOKEN
 * so the API Agent's {{GROWW_ACCESS_TOKEN}} placeholder resolves automatically.
 *
 * Groww tokens expire daily at 6:00 AM IST.
 */

const crypto = require('crypto');

class GrowwAuth {
  constructor() {
    this._token = null;
    this._tokenExpiry = null;
  }

  /**
   * Generate SHA-256 checksum = sha256(secret + timestamp)
   */
  static generateChecksum(secret, timestamp) {
    const input = secret + timestamp;
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Obtain an access token using API Key + Secret.
   * POST https://api.groww.in/v1/token/api/access
   *
   * @param {'approval'|'totp'} keyType — "approval" for key+secret flow
   * @returns {Promise<string>} access token
   */
  async getAccessToken(keyType = 'approval') {
    const apiKey = process.env.GROWW_API_KEY;
    const secret = process.env.GROWW_API_SECRET;

    if (!apiKey || !secret) {
      console.warn('⚠️  GROWW_API_KEY / GROWW_API_SECRET not set — skipping auto-auth');
      return process.env.GROWW_ACCESS_TOKEN || null;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const checksum = GrowwAuth.generateChecksum(secret, timestamp);

    console.log('🔑  Requesting Groww access token...');

    try {
      const response = await fetch('https://api.groww.in/v1/token/api/access', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key_type: keyType,
          checksum,
          timestamp,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.token) {
        console.error('❌  Groww auth failed:', data);
        return process.env.GROWW_ACCESS_TOKEN || null;
      }

      this._token = data.token;
      this._tokenExpiry = data.expiry ? new Date(data.expiry) : null;

      // Inject into env so ApiAgent's {{GROWW_ACCESS_TOKEN}} resolves
      process.env.GROWW_ACCESS_TOKEN = this._token;

      console.log(`✅  Groww token obtained (expires: ${data.expiry || 'unknown'})`);
      return this._token;
    } catch (err) {
      console.error('❌  Groww auth request failed:', err.message);
      return process.env.GROWW_ACCESS_TOKEN || null;
    }
  }

  /**
   * Initialise — use whichever approach is configured.
   * Priority: If GROWW_ACCESS_TOKEN is already set, use it directly.
   *           Otherwise, try API Key + Secret auto-generation.
   */
  async init() {
    if (process.env.GROWW_ACCESS_TOKEN) {
      console.log('🔑  Using pre-configured GROWW_ACCESS_TOKEN');
      this._token = process.env.GROWW_ACCESS_TOKEN;
      return this._token;
    }

    return await this.getAccessToken();
  }

  /**
   * Check if we have a valid token.
   */
  get isAuthenticated() {
    return !!this._token;
  }

  get token() {
    return this._token;
  }
}

module.exports = GrowwAuth;
