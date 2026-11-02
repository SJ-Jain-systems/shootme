// Background service worker: talks to the Claude API and opens Gmail.
// The content script never sees the API key.

import { loadSettings, GOALS, TONES } from '../shared/defaults.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';

// Input / output USD per million tokens, used only for the cost hint in the UI.
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5]
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: toUserError(error) }));
  return true; // keep the message channel open for the async reply
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

async function handle(message) {
  switch (message?.type) {
    case 'generate-draft':
      return generateDraft(message.payload);
    case 'open-gmail':
      return openGmail(message.payload);
    case 'test-key':
      return testKey(message.payload);
    case 'open-options':
      chrome.runtime.openOptionsPage();
      return {};
    case 'get-sender':
      return getSenderSummary();
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

async function getSenderSummary() {
  const s = await loadSettings();
  return {
    hasKey: Boolean(s.apiKey),
    senderName: s.senderName,
    model: s.model,
    defaultGoal: s.defaultGoal,
    defaultTone: s.defaultTone,
    autoOpenGmail: s.autoOpenGmail,
    autoGenerate: s.autoGenerate
  };
}

async function generateDraft({ profile, goal, tone, extraNote }) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    const error = new Error('No Claude API key saved yet.');
    error.code = 'no-key';
    throw error;
  }

  const goalLabel = labelFor(GOALS, goal || settings.defaultGoal);
  const toneLabel = labelFor(TONES, tone || settings.defaultTone);

  const system = buildSystemPrompt(settings, goalLabel, toneLabel);
  const userContent = buildUserContent(profile, extraNote);

  const requestBody = {
    model: settings.model,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: userContent }],
    output_config: { effort: settings.effort || 'low' }
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(requestBody)
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Claude returned something unreadable (HTTP ${response.status}). ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Claude API error (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }

  if (data.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined to write this one' +
        (data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.') +
        ' Try editing your base prompt in settings.'
    );
  }

  const text = (data.content || [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) throw new Error('Claude returned an empty draft. Try again.');

  const { subject, body } = splitSubjectAndBody(text, profile);
  const signed = settings.signature ? `${body.trimEnd()}\n\n${settings.signature}` : body;

  return {
    subject,
    body: signed,
    model: data.model || settings.model,
    cost: estimateCost(data.model || settings.model, data.usage)
  };
}

function labelFor(list, id) {
  return (list.find((item) => item.id === id) || list[0]).label;
}

function buildSystemPrompt(settings, goalLabel, toneLabel) {
  const about = [
    settings.senderName && `My name: ${settings.senderName}`,
    settings.senderRole && `What I do: ${settings.senderRole}`,
    settings.senderPitch && `What I am working on / my pitch: ${settings.senderPitch}`,
    settings.senderLink && `A link I can share: ${settings.senderLink}`
  ]
    .filter(Boolean)
    .join('\n');

  return [
    {
      type: 'text',
      text: `You write cold outreach emails on my behalf. You will be given the visible text of someone's LinkedIn profile. Write one email to that person.

${about ? `About me, the sender:\n${about}\n` : ''}
My standing instructions for every email:
${settings.basePrompt}

For this email:
- Goal: ${goalLabel}
- Tone: ${toneLabel}
- Hard limit: ${settings.wordLimit} words in the body, not counting the greeting and sign off.
- Subject line style: ${settings.subjectStyle}

Answer in exactly this shape and nothing else:

Subject: <the subject line>

<the email body>

Do not add a sign off with my name, do not add a signature block, and do not add any commentary before or after the email. The greeting should use their first name only.`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildUserContent(profile, extraNote) {
  const lines = [];
  lines.push('LinkedIn profile of the person I want to email.');
  lines.push('');
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.headline) lines.push(`Headline: ${profile.headline}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.company) lines.push(`Current company: ${profile.company}`);
  if (profile.url) lines.push(`Profile URL: ${profile.url}`);
  if (profile.email) lines.push(`Email found for them: ${profile.email}`);
  lines.push('');
  lines.push('Visible page text (may include navigation noise, ignore anything that is not about them):');
  lines.push('"""');
  lines.push((profile.pageText || '').slice(0, 9000));
  lines.push('"""');
  if (extraNote && extraNote.trim()) {
    lines.push('');
    lines.push(`Extra context I am adding by hand, treat this as true and important: ${extraNote.trim()}`);
  }
  return lines.join('\n');
}

function splitSubjectAndBody(text, profile) {
  const match = text.match(/^\s*subject\s*:\s*(.+?)\s*(?:\n|$)/i);
  if (match) {
    const subject = match[1].trim();
    const body = text.slice(match.index + match[0].length).trim();
    if (body) return { subject, body };
  }
  const first = (profile.name || '').split(' ')[0];
  return { subject: first ? `quick question, ${first}` : 'quick question', body: text };
}

function estimateCost(model, usage) {
  const price = PRICES[model] || PRICES['claude-opus-5-5'];
  if (!usage) return null;
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const output = usage.output_tokens || 0;
  const usd = (input / 1e6) * price[0] + (output / 1e6) * price[1];
  return { usd, input, output };
}

async function openGmail({ to, subject, body }) {
  const settings = await loadSettings();
  const index = Number(settings.gmailAccountIndex) || 0;
  const url =
    `https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1` +
    `&to=${encodeURIComponent(to || '')}` +
    `&su=${encodeURIComponent(subject || '')}` +
    `&body=${encodeURIComponent(body || '')}`;
  await chrome.tabs.create({ url });
  return {};
}

async function testKey({ apiKey, model }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-5-5',
      max_tokens: 16,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { model: data.model };
}

function toUserError(error) {
  const base = { message: error?.message || String(error), code: error?.code || null };
  if (error?.status === 401) {
    base.message = 'That API key was rejected. Check for a typo or stray space, or make a new key.';
    base.code = 'bad-key';
  } else if (error?.status === 429) {
    base.message = 'Claude is rate limiting you, or your account is out of credit. Wait a moment and try again.';
  } else if (error?.status === 400 && /credit|billing/i.test(base.message)) {
    base.message = 'Your Anthropic account needs credit before it can send requests.';
  } else if (/Failed to fetch|NetworkError/i.test(base.message)) {
    base.message = 'Could not reach the Claude API. Check your internet connection and try again.';
  }
  return base;
}
