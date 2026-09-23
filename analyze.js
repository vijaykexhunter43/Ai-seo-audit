/**
 * api/analyze.js
 * ----------------
 * Vercel Serverless Function: POST /api/analyze
 * Body: { "url": "https://example.com" }
 *
 * This is the ONLY place that talks to the target website and runs the
 * audit. The frontend never does the fetching or scoring itself, and
 * no API keys are used or exposed here in Phase 1 (there are none yet).
 *
 * When you add a real AI provider later (Phase 2), its API key goes in
 * a Vercel Environment Variable (e.g. process.env.ANTHROPIC_API_KEY) and
 * is only ever read here, server-side. It must NEVER be sent to the
 * browser or committed to the repo.
 */

const { normalizeUrl, fetchHTML, runAudit } = require('../lib/analyzer');

// Very light in-memory rate limiting per serverless instance.
// This is NOT a robust production rate limiter (instances are stateless
// and short-lived), but it's a free, zero-dependency first line of
// defense against accidental abuse. Replace with a proper store
// (Upstash Redis free tier, etc.) before you have real traffic.
const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = recentRequests.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  recentRequests.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
  // CORS: allow same-origin usage by default. If you host the frontend
  // elsewhere later, set an explicit allowed origin here instead of "*".
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const rawUrl = body.url;

    const url = normalizeUrl(rawUrl);
    const { html, finalUrl, headers } = await fetchHTML(url);
    const result = runAudit(html, finalUrl, headers);

    res.status(200).json(result);
  } catch (err) {
    const message = err && err.message ? err.message : 'Something went wrong analyzing that URL.';
    res.status(400).json({ error: message });
  }
};
