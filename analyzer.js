/**
 * lib/analyzer.js
 * ----------------
 * Core SEO audit engine — V1.
 * Pure Node.js + Cheerio (free, open-source). No paid APIs, no external
 * services, no AI calls. Everything here runs server-side only.
 *
 * Exported:
 *   normalizeUrl(input)                -> validates/cleans a user-entered URL
 *   fetchHTML(url)                     -> fetches page HTML (timeout + UA header)
 *   runAudit(html, finalUrl, headers)  -> full audit result, bucketed for the report
 *
 * Deliberately framework-agnostic: this file doesn't know about HTTP routes,
 * Vercel, or the frontend. That's the seam where later phases (AI-generated
 * recommendations, local SEO checks, competitor comparison, AI-search
 * visibility checks) get added as new functions/modules, without touching
 * the checks already here.
 */

const cheerio = require('cheerio');

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB safety cap

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

function normalizeUrl(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Please enter a website URL.');
  }
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!parsed.hostname.includes('.')) {
    throw new Error("That doesn't look like a valid domain.");
  }
  return parsed.toString();
}

async function fetchHTML(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SitecheckAuditBot/1.0; +https://example.com/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The website took too long to respond (timed out).');
    }
    throw new Error('Could not reach that website. Check the URL and try again.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`The website responded with an error (HTTP ${res.status}).`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error('That URL did not return an HTML page.');
  }

  const html = await res.text();
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('That page is too large to analyze in this MVP.');
  }

  return { html, finalUrl: res.url || url, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Individual checks
// Each check returns: { id, category, label, max, score, status, message, tip }
// status: 'pass' | 'warn' | 'fail'
// category groups checks for the report UI (not used for scoring math).
// ---------------------------------------------------------------------------

function checkTitle($) {
  const title = ($('title').first().text() || '').trim();
  const max = 12;
  const base = { id: 'title', category: 'On-Page SEO', label: 'Page Title', max };

  if (!title) {
    return {
      ...base,
      score: 0,
      status: 'fail',
      message: 'No <title> tag found.',
      tip: 'Add a unique, descriptive <title> (30–60 characters) that includes your main keyword and brand name.',
    };
  }
  const len = title.length;
  if (len < 30 || len > 60) {
    return {
      ...base,
      score: 7,
      status: 'warn',
      message: `Title is ${len} characters — outside the ideal 30–60 range: "${title}"`,
      tip: 'Adjust your title to 30–60 characters so it fully displays in search results without being truncated.',
    };
  }
  return {
    ...base,
    score: max,
    status: 'pass',
    message: `Title looks good (${len} characters): "${title}"`,
    tip: null,
  };
}

function checkMetaDescription($) {
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  const max = 12;
  const base = { id: 'meta_description', category: 'On-Page SEO', label: 'Meta Description', max };

  if (!desc) {
    return {
      ...base,
      score: 0,
      status: 'fail',
      message: 'No meta description found.',
      tip: 'Add a meta description (120–160 characters) that summarizes the page and encourages clicks from search results.',
    };
  }
  const len = desc.length;
  if (len < 70 || len > 160) {
    return {
      ...base,
      score: 7,
      status: 'warn',
      message: `Meta description is ${len} characters — outside the ideal 70–160 range.`,
      tip: 'Rewrite the meta description to 120–160 characters so it uses available space without being cut off.',
    };
  }
  return {
    ...base,
    score: max,
    status: 'pass',
    message: `Meta description length looks good (${len} characters).`,
    tip: null,
  };
}

function checkH1($) {
  const h1s = $('h1');
  const max = 10;
  const base = { id: 'h1', category: 'On-Page SEO', label: 'H1 Heading', max };
  const count = h1s.length;

  if (count === 0) {
    return {
      ...base,
      score: 0,
      status: 'fail',
      message: 'No H1 heading found on the page.',
      tip: "Add exactly one H1 that clearly describes the page's main topic.",
    };
  }
  if (count > 1) {
    return {
      ...base,
      score: 5,
      status: 'warn',
      message: `Found ${count} H1 tags on the page.`,
      tip: 'Use only one H1 per page. Convert additional H1s to H2s to keep a clear content hierarchy.',
    };
  }
  const text = h1s.first().text().trim();
  return {
    ...base,
    score: max,
    status: 'pass',
    message: `Single H1 found: "${text.slice(0, 80)}"`,
    tip: null,
  };
}

function checkHeadingStructure($) {
  const max = 10;
  const base = { id: 'heading_structure', category: 'On-Page SEO', label: 'Heading Structure', max };
  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push(Number(el.tagName.substring(1)));
  });

  if (headings.length === 0) {
    return {
      ...base,
      score: 0,
      status: 'fail',
      message: 'No headings (H1–H6) found at all.',
      tip: 'Break your content into sections using a logical H1 > H2 > H3 hierarchy.',
    };
  }

  let skips = 0;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) skips++;
  }
  const hasH2 = headings.includes(2);

  if (!hasH2 && headings.length > 1) {
    return {
      ...base,
      score: 4,
      status: 'warn',
      message: 'No H2 subheadings found to organize the content.',
      tip: 'Add H2 subheadings to break long content into scannable sections.',
    };
  }

  if (skips > 0) {
    return {
      ...base,
      score: 6,
      status: 'warn',
      message: `Heading levels are skipped ${skips} time(s) (e.g. H1 straight to H3).`,
      tip: 'Keep heading levels sequential (H1 → H2 → H3) without skipping levels.',
    };
  }

  return {
    ...base,
    score: max,
    status: 'pass',
    message: `Logical heading structure found (${headings.length} headings).`,
    tip: null,
  };
}

function checkImageAlt($) {
  const max = 10;
  const base = { id: 'image_alt', category: 'On-Page SEO', label: 'Image Alt Text', max };
  const images = $('img');
  const total = images.length;

  if (total === 0) {
    return { ...base, score: max, status: 'pass', message: 'No images found on the page.', tip: null };
  }

  let missing = 0;
  images.each((_, el) => {
    if ($(el).attr('alt') === undefined) missing++;
  });

  if (missing === 0) {
    return {
      ...base,
      score: max,
      status: 'pass',
      message: `All ${total} image(s) have alt attributes.`,
      tip: null,
    };
  }

  const ratio = (total - missing) / total;
  const score = Math.round(ratio * max);
  return {
    ...base,
    score,
    status: ratio < 0.5 ? 'fail' : 'warn',
    message: `${missing} of ${total} image(s) are missing alt text.`,
    tip: 'Add descriptive alt text to every meaningful image. Use alt="" only for purely decorative images.',
  };
}

function checkOnPageBasics($) {
  const max = 10;
  const base = { id: 'on_page', category: 'On-Page SEO', label: 'Basic On-Page SEO', max };
  const issues = [];
  let score = max;

  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical) {
    issues.push('No canonical tag found.');
    score -= 5;
  }

  const title = ($('title').first().text() || '').trim().toLowerCase();
  const desc = ($('meta[name="description"]').attr('content') || '').trim().toLowerCase();
  if (title && desc && title === desc) {
    issues.push('Title and meta description are identical.');
    score -= 3;
  }

  const viewport = $('meta[name="viewport"]').attr('content');
  if (!viewport) {
    issues.push('No responsive viewport meta tag found.');
    score -= 2;
  }

  score = Math.max(0, score);

  if (issues.length === 0) {
    return {
      ...base,
      score,
      status: 'pass',
      message: 'Canonical tag, unique meta content, and viewport tag are all present.',
      tip: null,
    };
  }

  return {
    ...base,
    score,
    status: score >= max / 2 ? 'warn' : 'fail',
    message: issues.join(' '),
    tip: 'Add a canonical URL, keep titles and descriptions distinct, and include a responsive viewport tag.',
  };
}

function checkInternalLinks($, finalUrl) {
  const max = 12;
  const base = { id: 'internal_links', category: 'Site Structure', label: 'Internal Links', max };

  let hostname;
  try {
    hostname = new URL(finalUrl).hostname.replace(/^www\./, '');
  } catch {
    hostname = null;
  }

  const anchors = $('a[href]');
  let internal = 0;
  let external = 0;
  let empty = 0;
  let generic = 0;
  const genericText = /^(click here|read more|here|link|this|learn more)$/i;

  anchors.each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    const text = $(el).text().trim();

    if (!href || href === '#') {
      empty++;
      return;
    }
    if (genericText.test(text)) generic++;

    if (/^https?:\/\//i.test(href)) {
      try {
        const linkHost = new URL(href).hostname.replace(/^www\./, '');
        if (hostname && linkHost === hostname) internal++;
        else external++;
      } catch {
        /* ignore malformed href */
      }
    } else if (!href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      internal++; // relative path — same site
    }
  });

  if (internal === 0) {
    return {
      ...base,
      score: 0,
      status: 'fail',
      message: 'No internal links found pointing to other pages on this site.',
      tip: 'Add links to other relevant pages on your site (services, about, contact) so visitors and search engines can navigate deeper into it.',
    };
  }

  const issues = [];
  let score = max;

  if (internal < 3) {
    issues.push(`Only ${internal} internal link(s) found.`);
    score -= 5;
  }
  if (empty > 0) {
    issues.push(`${empty} link(s) have empty or "#" hrefs.`);
    score -= 3;
  }
  if (generic > 2) {
    issues.push(`${generic} link(s) use generic anchor text like "click here".`);
    score -= 2;
  }

  score = Math.max(0, score);

  if (issues.length === 0) {
    return {
      ...base,
      score,
      status: 'pass',
      message: `Found ${internal} internal and ${external} external link(s) with descriptive structure.`,
      tip: null,
    };
  }

  return {
    ...base,
    score,
    status: score >= max / 2 ? 'warn' : 'fail',
    message: issues.join(' '),
    tip: 'Link to relevant internal pages using descriptive anchor text (not "click here") so both users and search engines can find your other content.',
  };
}

function checkTechnicalSEO($, finalUrl, headers) {
  const max = 12;
  const base = { id: 'technical', category: 'Technical SEO', label: 'Basic Technical SEO', max };
  const issues = [];
  let score = max;

  const isHttps = finalUrl.startsWith('https://');
  if (!isHttps) {
    issues.push('Site is not served over HTTPS.');
    score -= 5;
  }

  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
  if (robotsMeta.includes('noindex')) {
    issues.push('Page has a "noindex" directive, so search engines will not index it.');
    score -= 5;
  }

  const contentType = (headers && headers.get && headers.get('content-type')) || '';
  const hasCharsetMeta = $('meta[charset]').length > 0 || $('meta[http-equiv="Content-Type"]').length > 0;
  const hasCharsetHeader = contentType.toLowerCase().includes('charset');
  if (!hasCharsetMeta && !hasCharsetHeader) {
    issues.push('No character encoding (charset) declared.');
    score -= 2;
  }

  score = Math.max(0, score);

  if (issues.length === 0) {
    return {
      ...base,
      score,
      status: 'pass',
      message: 'HTTPS is used, the page is indexable, and character encoding is declared.',
      tip: null,
    };
  }

  return {
    ...base,
    score,
    status: score >= max / 2 ? 'warn' : 'fail',
    message: issues.join(' '),
    tip: 'Serve the site over HTTPS, remove accidental noindex tags, and declare UTF-8 charset.',
  };
}

function getVisibleText($) {
  const clone = $('body').clone();
  clone.find('script, style, noscript, iframe, svg, nav, footer').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

function checkContentAnalysis($, html) {
  const max = 12;
  const base = { id: 'content_analysis', category: 'Content', label: 'Basic Content Analysis', max };

  const text = getVisibleText($);
  const wordCount = text.length === 0 ? 0 : text.split(' ').filter(Boolean).length;
  const paragraphCount = $('p').length;

  // Rough text-to-HTML ratio: how much of the page is actual readable text
  // versus markup. Very low ratios often mean thin or heavily templated pages.
  const htmlSize = Buffer.byteLength(html, 'utf8') || 1;
  const textRatio = text.length / htmlSize;

  const issues = [];
  let score = max;

  if (wordCount < 150) {
    issues.push(`Very thin content: ~${wordCount} words.`);
    score -= 8;
  } else if (wordCount < 300) {
    issues.push(`Content is light: ~${wordCount} words.`);
    score -= 4;
  }

  if (paragraphCount === 0 && wordCount > 0) {
    issues.push('No <p> paragraph tags found — content may not be properly structured.');
    score -= 2;
  }

  if (textRatio < 0.05) {
    issues.push('Text-to-HTML ratio is very low (page is mostly markup, little visible text).');
    score -= 2;
  }

  score = Math.max(0, score);

  if (issues.length === 0) {
    return {
      ...base,
      score,
      status: 'pass',
      message: `Good content depth: ~${wordCount} words across ${paragraphCount} paragraph(s).`,
      tip: null,
      wordCount,
    };
  }

  return {
    ...base,
    score,
    status: score >= max / 2 ? 'warn' : 'fail',
    message: issues.join(' '),
    tip: 'Aim for 300+ words of genuinely useful, well-structured content (in real paragraphs) so search engines have enough context to understand the page.',
    wordCount,
  };
}

// ---------------------------------------------------------------------------
// Report assembly — buckets checks for the UI and builds a deduplicated,
// priority-ordered list of actionable recommendations.
// This is rule-based in V1. It's also the seam where real AI-generated
// recommendations get added later (see README).
// ---------------------------------------------------------------------------

function buildReport(checks) {
  const critical = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  const workingWell = checks.filter((c) => c.status === 'pass');

  // Recommendations: one tip per non-passing check, critical issues first,
  // deduplicated in case two checks ever produce the same tip text.
  const seen = new Set();
  const recommendations = [...critical, ...warnings]
    .map((c) => c.tip)
    .filter(Boolean)
    .filter((tip) => {
      if (seen.has(tip)) return false;
      seen.add(tip);
      return true;
    });

  if (recommendations.length === 0) {
    recommendations.push(
      'No major issues found. Keep building useful content and earning links from other relevant sites to grow visibility further.'
    );
  }

  recommendations.push(
    'These recommendations follow established SEO best practices — no tool can guarantee specific Google or AI-search rankings.'
  );

  return { critical, warnings, workingWell, recommendations };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function runAudit(html, finalUrl, headers) {
  const $ = cheerio.load(html);

  const checks = [
    checkTitle($),
    checkMetaDescription($),
    checkH1($),
    checkHeadingStructure($),
    checkImageAlt($),
    checkOnPageBasics($),
    checkInternalLinks($, finalUrl),
    checkTechnicalSEO($, finalUrl, headers),
    checkContentAnalysis($, html),
  ];

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const totalMax = checks.reduce((sum, c) => sum + c.max, 0);
  const score = Math.round((totalScore / totalMax) * 100);

  const { critical, warnings, workingWell, recommendations } = buildReport(checks);

  return {
    url: finalUrl,
    score,
    checks,
    critical,
    warnings,
    workingWell,
    recommendations,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = { normalizeUrl, fetchHTML, runAudit };
