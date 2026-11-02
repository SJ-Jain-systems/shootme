// Settings schema, defaults and storage helpers.
// Everything lives in chrome.storage.local (NOT sync) so the API key never
// leaves this machine through the user's Google account.

export const MODELS = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5 - best writing (default)',
    note: 'About 1 to 2 cents per email. Use this unless you are sending hundreds a day.'
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5 - balanced',
    note: 'Roughly half the cost of Opus, still very good.'
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5 - cheapest',
    note: 'Fractions of a cent per email. Shorter, more generic writing.'
  }
];

export const DEFAULT_BASE_PROMPT = `Write a short cold outreach email to this person.

Rules:
- Open with one specific, true observation about them taken from their profile. Name the company, role, school, post or project you are reacting to. Never open with flattery that could apply to anyone.
- Say who I am and why I am reaching out in one sentence.
- Make exactly one ask, and make it small and easy to say yes to.
- Sound like a person typing quickly, not like marketing copy. Short sentences. No buzzwords.
- Never use the phrases "I hope this email finds you well", "I came across your profile", "reaching out", "synergy", "circle back", "touch base", "leverage".
- No em dashes, no bullet points, no markdown, no emoji.
- Do not invent facts about them or about me. If the profile is thin, keep the opening line simple and honest instead of guessing.`;

export const DEFAULT_SETTINGS = {
  // Credentials
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'low',

  // Who the email is from
  senderName: '',
  senderRole: '',
  senderPitch: '',
  senderLink: '',
  signature: '',

  // How the email should read
  basePrompt: DEFAULT_BASE_PROMPT,
  subjectStyle: 'Lowercase, 3 to 6 words, specific to them, no clickbait, no colon-heavy headlines.',
  wordLimit: 90,
  defaultGoal: 'intro-call',
  defaultTone: 'warm-direct',

  // Behaviour
  gmailAccountIndex: 0,
  autoOpenGmail: false,
  autoGenerate: false
};

export const GOALS = [
  { id: 'intro-call', label: 'Ask for a short intro call' },
  { id: 'advice', label: 'Ask for advice or their read on something' },
  { id: 'job', label: 'Ask about a role or hiring' },
  { id: 'hire', label: 'Recruit them' },
  { id: 'sell', label: 'Pitch what I am building' },
  { id: 'collab', label: 'Propose working together' },
  { id: 'referral', label: 'Ask for an intro to someone else' },
  { id: 'just-connect', label: 'Just start a conversation, no ask' }
];

export const TONES = [
  { id: 'warm-direct', label: 'Warm and direct' },
  { id: 'casual', label: 'Casual and brief' },
  { id: 'formal', label: 'Professional and formal' },
  { id: 'peer', label: 'Peer to peer, technical' }
];

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = stored[key];
    if (value !== undefined && value !== null && value !== '') settings[key] = value;
  }
  // Checkboxes and 0 are legitimate falsy values, so copy them explicitly.
  for (const key of ['autoOpenGmail', 'autoGenerate', 'gmailAccountIndex']) {
    if (stored[key] !== undefined) settings[key] = stored[key];
  }
  return settings;
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
