// public/script.js
// Talks to our own serverless API only (/api/analyze). No third-party
// keys or calls happen in the browser — by design, so nothing sensitive
// can ever be exposed here.

const form = document.getElementById('audit-form');
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const heroEl = document.getElementById('hero');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const resultsEl = document.getElementById('results');
const errorBox = document.getElementById('error-box');
const resetBtn = document.getElementById('reset-btn');

const LOADING_MESSAGES = [
  'Fetching page…',
  'Reading titles and headings…',
  'Checking images and content…',
  'Scoring visibility…',
];

let loadingInterval = null;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function setLoading(isLoading) {
  if (isLoading) {
    heroEl.querySelector('.hero__title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadingEl.hidden = false;
    resultsEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Analyzing…';

    let i = 0;
    loadingText.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      loadingText.textContent = LOADING_MESSAGES[i];
    }, 1400);
  } else {
    loadingEl.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Run audit';
    if (loadingInterval) clearInterval(loadingInterval);
  }
}

function scoreColor(score) {
  if (score >= 80) return getComputedStyle(document.documentElement).getPropertyValue('--pass').trim();
  if (score >= 50) return getComputedStyle(document.documentElement).getPropertyValue('--warn').trim();
  return getComputedStyle(document.documentElement).getPropertyValue('--fail').trim();
}

function scoreLabel(score) {
  if (score >= 80) return 'Strong foundation';
  if (score >= 50) return 'Needs improvement';
  return 'Significant issues found';
}

function renderResults(data) {
  document.getElementById('result-url').textContent = data.url;

  const scoreValueEl = document.getElementById('score-value');
  const meterFillEl = document.getElementById('meter-fill');
  const scoreLabelEl = document.getElementById('score-label');
  const color = scoreColor(data.score);

  scoreValueEl.textContent = data.score;
  scoreValueEl.style.color = color;
  meterFillEl.style.width = data.score + '%';
  meterFillEl.style.background = color;
  scoreLabelEl.textContent = scoreLabel(data.score);

  renderChecklist('critical', data.critical);
  renderChecklist('warnings', data.warnings);
  renderChecklist('working', data.workingWell);

  const recList = document.getElementById('recommendations-list');
  recList.innerHTML = '';
  data.recommendations.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    recList.appendChild(li);
  });

  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderChecklist(key, checks) {
  const block = document.getElementById(`${key}-block`);
  const list = document.getElementById(`${key}-list`);
  const countEl = document.getElementById(`${key}-count`);

  list.innerHTML = '';

  if (!checks || checks.length === 0) {
    block.hidden = true;
    return;
  }

  block.hidden = false;
  countEl.textContent = `(${checks.length})`;

  checks.forEach((check) => {
    const li = document.createElement('li');
    li.className = 'check-item';
    li.dataset.status = check.status;

    const tipHtml = check.tip
      ? `<p class="check-item__tip">${escapeHtml(check.tip)}</p>`
      : '';

    li.innerHTML = `
      <div class="check-item__row">
        <span class="check-item__label"><span class="status-dot" data-status="${check.status}"></span>${escapeHtml(check.label)}</span>
        <span class="check-item__score">${check.score}/${check.max}</span>
      </div>
      <p class="check-item__message">${escapeHtml(check.message)}</p>
      ${tipHtml}
    `;
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }

    setLoading(false);
    renderResults(data);
  } catch (err) {
    setLoading(false);
    showError(err.message || 'Something went wrong. Please try again.');
  }
});

resetBtn.addEventListener('click', () => {
  resultsEl.hidden = true;
  urlInput.value = '';
  urlInput.focus();
  heroEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
