/*
 * ShootMe content script.
 * Runs on LinkedIn, reads the profile you are looking at, picks up the email
 * Apollo put on the page, and shows a panel that drafts the message.
 *
 * No imports: content scripts declared in the manifest are classic scripts.
 */
(() => {
  if (window.__shootMeLoaded) return;
  window.__shootMeLoaded = true;

  const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  // Addresses that are never the prospect.
  const BLOCKED = [
    /@linkedin\./i,
    /@licdn\./i,
    /@apollo\.io$/i,
    /@sentry\./i,
    /@example\./i,
    /^(no-?reply|noreply|support|help|info|privacy|legal|abuse|postmaster|press|careers|security)@/i,
    /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i
  ];

  const GOALS = [
    ['intro-call', 'Ask for a short intro call'],
    ['advice', 'Ask for advice or their read on something'],
    ['job', 'Ask about a role or hiring'],
    ['hire', 'Recruit them'],
    ['sell', 'Pitch what I am building'],
    ['collab', 'Propose working together'],
    ['referral', 'Ask for an intro to someone else'],
    ['just-connect', 'Just start a conversation, no ask']
  ];

  const TONES = [
    ['warm-direct', 'Warm and direct'],
    ['casual', 'Casual and brief'],
    ['formal', 'Professional and formal'],
    ['peer', 'Peer to peer, technical']
  ];

  const state = {
    url: location.href,
    host: null,
    root: null,
    open: false,
    busy: false,
    emails: [],
    profile: null,
    sender: null,
    generated: false
  };

  /* ------------------------------------------------------------------ *
   * Page type
   * ------------------------------------------------------------------ */

  const isProfilePage = () => /^\/in\/[^/]+\/?$/.test(location.pathname) || /^\/in\//.test(location.pathname);

  /* ------------------------------------------------------------------ *
   * Email discovery (Apollo panel, mailto links, anything on the page)
   * ------------------------------------------------------------------ */

  function allRoots(root = document, out = []) {
    out.push(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.shadowRoot) allRoots(node.shadowRoot, out);
      node = walker.nextNode();
    }
    return out;
  }

  function apolloScore(node) {
    let score = 0;
    let el = node instanceof Element ? node : node.parentElement;
    let hops = 0;
    while (el && hops < 12) {
      const id = (el.id || '').toLowerCase();
      const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (id.includes('apollo') || cls.includes('apollo')) score += 4;
      if (/\bzp[_-]/.test(cls)) score += 2;
      if (el.getAttribute && /apollo/i.test(el.getAttribute('data-testid') || '')) score += 3;
      el = el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
      hops += 1;
    }
    return score;
  }

  function isPlausible(email) {
    if (email.length > 120) return false;
    return !BLOCKED.some((pattern) => pattern.test(email));
  }

  function findEmails() {
    const found = new Map(); // email -> score

    const add = (email, score) => {
      const clean = email.trim().replace(/^[.,;:<(]+|[.,;:>)]+$/g, '');
      if (!isPlausible(clean)) return;
      const key = clean.toLowerCase();
      found.set(key, Math.max(found.get(key) || 0, score));
    };

    for (const root of allRoots()) {
      // mailto: links are the strongest signal
      const links = root.querySelectorAll ? root.querySelectorAll('a[href^="mailto:"]') : [];
      for (const link of links) {
        const value = decodeURIComponent((link.getAttribute('href') || '').slice(7)).split('?')[0];
        if (value) add(value, 5 + apolloScore(link));
      }

      // then any visible text that looks like an address
      const container = root.body || root;
      if (!container || !container.nodeType) continue;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(textNode) {
          const parent = textNode.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          if (parent.closest && parent.closest('#shootme-host')) return NodeFilter.FILTER_REJECT;
          return textNode.nodeValue && textNode.nodeValue.includes('@')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      });
      let textNode = walker.nextNode();
      while (textNode) {
        const matches = textNode.nodeValue.match(EMAIL_RE);
        if (matches) for (const match of matches) add(match, 1 + apolloScore(textNode));
        textNode = walker.nextNode();
      }

      // input fields Apollo sometimes renders the address into
      const inputs = root.querySelectorAll ? root.querySelectorAll('input[value*="@"]') : [];
      for (const input of inputs) if (input.value) add(input.value, 3 + apolloScore(input));
    }

    return [...found.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([email]) => email);
  }

  /* ------------------------------------------------------------------ *
   * Profile scraping
   * ------------------------------------------------------------------ */

  function text(selector, scope = document) {
    const node = scope.querySelector(selector);
    const value = node && (node.innerText || node.textContent);
    return value ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function tidy(raw) {
    const lines = raw.split('\n').map((line) => line.trim());
    const kept = [];
    let previous = null;
    for (const line of lines) {
      if (!line) continue;
      if (line === previous) continue; // LinkedIn repeats text for screen readers
      if (/^(see more|see less|…see more|show all|follow|message|connect|more)$/i.test(line)) continue;
      if (/^Status is (reachable|offline)/i.test(line)) continue;
      kept.push(line);
      previous = line;
    }
    return kept.join('\n');
  }

  function scrapeProfile() {
    const main = document.querySelector('main') || document.body;

    const name =
      text('main h1') ||
      (document.title.split(/[|(]/)[0] || '').replace(/\s*-\s*LinkedIn.*$/i, '').trim();

    const headline =
      text('main .text-body-medium.break-words') ||
      text('main div.text-body-medium') ||
      '';

    const place =
      text('main span.text-body-small.inline.t-black--light.break-words') ||
      text('main .pv-text-details__left-panel .text-body-small') ||
      '';

    let company = '';
    const companyButton = main.querySelector('button[aria-label*="Current company"]');
    if (companyButton) company = (companyButton.innerText || '').trim().split('\n')[0];
    if (!company) {
      const link = main.querySelector('a[href*="/company/"]');
      if (link) company = (link.innerText || '').trim().split('\n')[0];
    }

    const pageText = tidy((main.innerText || '').slice(0, 20000));

    return {
      name,
      firstName: (name || '').split(' ')[0] || '',
      headline,
      location: place,
      company,
      url: window.location.href.split('?')[0],
      pageText
    };
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    :host {
      --bg: #ffffff;
      --fg: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --field: #f9fafb;
      --brand: #4338ca;
      --brand-fg: #ffffff;
      --good: #047857;
      --warn: #b45309;
      --bad: #b91c1c;
      --shadow: 0 10px 30px rgba(15, 23, 42, .18), 0 2px 6px rgba(15, 23, 42, .08);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #111827; --fg: #f3f4f6; --muted: #9ca3af; --line: #374151;
        --field: #1f2937; --brand: #6366f1; --good: #34d399; --warn: #fbbf24; --bad: #f87171;
        --shadow: 0 10px 30px rgba(0,0,0,.5);
      }
    }
    .launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 11px 16px; border: 0; border-radius: 999px;
      background: var(--brand); color: var(--brand-fg);
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: var(--shadow);
    }
    .launcher:hover { filter: brightness(1.08); }
    .launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; }
    .launcher .dot.off { background: #fbbf24; }
    .panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      width: 390px; max-width: calc(100vw - 32px); max-height: calc(100vh - 40px);
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
    }
    .head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 14px 10px; border-bottom: 1px solid var(--line); }
    .head h2 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.25; }
    .head p { margin: 2px 0 0; font-size: 12px; color: var(--muted); line-height: 1.35;
              display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .head .spacer { flex: 1; }
    .iconbtn { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px; border-radius: 6px; }
    .iconbtn:hover { background: var(--field); color: var(--fg); }
    .body { padding: 12px 14px 14px; overflow-y: auto; }
    label { display: block; font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--muted); margin: 12px 0 5px; }
    label:first-child { margin-top: 0; }
    input, select, textarea {
      width: 100%; padding: 8px 10px; font-size: 13px; color: var(--fg);
      background: var(--field); border: 1px solid var(--line); border-radius: 8px;
    }
    input:focus, select:focus, textarea:focus { outline: 2px solid var(--brand); outline-offset: -1px; }
    textarea { resize: vertical; min-height: 150px; line-height: 1.5; font-size: 13px; }
    .hint { font-size: 11.5px; color: var(--muted); margin: 5px 0 0; line-height: 1.4; }
    .hint.good { color: var(--good); }
    .hint.warn { color: var(--warn); }
    .hint.bad { color: var(--bad); }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; min-width: 0; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid transparent;
      font-size: 13.5px; font-weight: 600; cursor: pointer;
    }
    .btn.primary { background: var(--brand); color: var(--brand-fg); }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn.ghost { background: transparent; color: var(--fg); border-color: var(--line); }
    .btn.ghost:hover { background: var(--field); }
    .btn[disabled] { opacity: .55; cursor: progress; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    .actions .btn { width: auto; flex: 1; }
    .spin { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .divider { height: 1px; background: var(--line); margin: 14px 0 0; }
    .foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); }
    .foot .spacer { flex: 1; }
    .link { background: none; border: 0; padding: 0; color: var(--brand); font-size: 11.5px; font-weight: 600; cursor: pointer; text-decoration: underline; }
    .hidden { display: none !important; }
  `;

  function mount() {
    if (state.host && document.documentElement.contains(state.host)) return;
    const host = document.createElement('div');
    host.id = 'shootme-host';
    host.style.cssText = 'all: initial;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);
    const slot = document.createElement('div');
    slot.id = 'slot';
    root.append(slot);
    document.documentElement.append(host);
    state.host = host;
    state.root = root;
    render();
  }

  function unmount() {
    if (state.host) state.host.remove();
    state.host = null;
    state.root = null;
    state.open = false;
  }

  const $ = (selector) => state.root && state.root.querySelector(selector);

  function render() {
    const slot = $('#slot');
    if (!slot) return;
    slot.innerHTML = state.open ? panelHtml() : launcherHtml();
    wire();
  }

  function launcherHtml() {
    const hasEmail = state.emails.length > 0;
    return `
      <button class="launcher" id="open" title="Draft an outreach email to this person">
        <span class="dot ${hasEmail ? '' : 'off'}"></span>
        Draft email
      </button>`;
  }

  function panelHtml() {
    const p = state.profile || {};
    const email = state.emails[0] || '';
    const sender = state.sender || {};
    const goalId = sender.defaultGoal || 'intro-call';
    const toneId = sender.defaultTone || 'warm-direct';

    const options = (list, selected) =>
      list.map(([id, label]) => `<option value="${id}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

    const emailHint = email
      ? `<p class="hint good" id="emailHint">Picked up from the page. Change it if it looks wrong.</p>`
      : `<p class="hint warn" id="emailHint">No email on the page yet. Open Apollo to reveal it, or paste one here. You can still draft the message.</p>`;

    const keyWarning = sender.hasKey
      ? ''
      : `<p class="hint bad">No Claude API key saved. <button class="link" id="settings2">Add it in settings</button> before generating.</p>`;

    return `
      <div class="panel">
        <div class="head">
          <div>
            <h2>${escapeHtml(p.name || 'This profile')}</h2>
            <p>${escapeHtml(p.headline || p.company || '')}</p>
          </div>
          <span class="spacer"></span>
          <button class="iconbtn" id="close" title="Close">&times;</button>
        </div>
        <div class="body">
          ${keyWarning}
          <label for="to">Their email</label>
          <input id="to" type="email" value="${escapeHtml(email)}" placeholder="name@company.com" list="found" />
          ${state.emails.length > 1 ? `<datalist id="found">${state.emails.map((e) => `<option value="${escapeHtml(e)}"></option>`).join('')}</datalist>` : ''}
          ${emailHint}

          <div class="row">
            <div>
              <label for="goal">Goal</label>
              <select id="goal">${options(GOALS, goalId)}</select>
            </div>
            <div>
              <label for="tone">Tone</label>
              <select id="tone">${options(TONES, toneId)}</select>
            </div>
          </div>

          <label for="note">Anything to work in (optional)</label>
          <input id="note" type="text" placeholder="e.g. we both know Priya, or saw their talk at SaaStr" />

          <div class="divider"></div>

          <label for="subject">Subject</label>
          <input id="subject" type="text" placeholder="Generated subject appears here" />

          <label for="bodyText">Message</label>
          <textarea id="bodyText" placeholder="Click Generate and the draft lands here. Edit anything before you send."></textarea>
          <p class="hint" id="status"></p>

          <div class="actions">
            <button class="btn primary" id="generate">Generate</button>
            <button class="btn ghost" id="gmail">Open in Gmail</button>
          </div>
        </div>
        <div class="foot">
          <span id="meta">${escapeHtml(sender.model || '')}</span>
          <span class="spacer"></span>
          <button class="link" id="copy">Copy</button>
          <button class="link" id="settings">Settings</button>
        </div>
      </div>`;
  }

  function wire() {
    const open = $('#open');
    if (open) {
      open.addEventListener('click', async () => {
        state.profile = scrapeProfile();
        state.emails = findEmails();
        state.sender = await send({ type: 'get-sender' }).catch(() => ({}));
        state.open = true;
        render();
        if (state.sender && state.sender.autoGenerate && state.sender.hasKey) generate();
      });
      return;
    }

    const close = $('#close');
    if (close) close.addEventListener('click', () => { state.open = false; state.generated = false; render(); });

    const generateBtn = $('#generate');
    if (generateBtn) generateBtn.addEventListener('click', generate);

    const gmail = $('#gmail');
    if (gmail) gmail.addEventListener('click', openInGmail);

    const copy = $('#copy');
    if (copy) copy.addEventListener('click', copyDraft);

    for (const id of ['#settings', '#settings2']) {
      const node = $(id);
      if (node) node.addEventListener('click', () => send({ type: 'open-options' }));
    }
  }

  function setStatus(message, kind = '') {
    const node = $('#status');
    if (node) {
      node.textContent = message || '';
      node.className = `hint ${kind}`;
    }
  }

  async function generate() {
    if (state.busy) return;
    const button = $('#generate');
    state.busy = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spin"></span> Writing';
    }
    setStatus('Reading their profile and writing the draft.');

    try {
      const profile = { ...(state.profile || scrapeProfile()) };
      profile.email = ($('#to') && $('#to').value.trim()) || '';

      const result = await send({
        type: 'generate-draft',
        payload: {
          profile,
          goal: $('#goal') ? $('#goal').value : undefined,
          tone: $('#tone') ? $('#tone').value : undefined,
          extraNote: $('#note') ? $('#note').value : ''
        }
      });

      if ($('#subject')) $('#subject').value = result.subject || '';
      if ($('#bodyText')) $('#bodyText').value = result.body || '';
      state.generated = true;

      const words = (result.body || '').trim().split(/\s+/).filter(Boolean).length;
      const cents = result.cost ? (result.cost.usd * 100).toFixed(2) : null;
      setStatus(`Draft ready. ${words} words${cents ? `, about ${cents} cents` : ''}. Edit it, then open Gmail.`, 'good');
      const meta = $('#meta');
      if (meta && result.model) meta.textContent = result.model;

      if (state.sender && state.sender.autoOpenGmail) openInGmail();
    } catch (error) {
      if (error && error.code === 'no-key') {
        setStatus('Add your Claude API key in settings first.', 'bad');
        send({ type: 'open-options' });
      } else {
        setStatus(error && error.message ? error.message : 'Something went wrong.', 'bad');
      }
    } finally {
      state.busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = state.generated ? 'Regenerate' : 'Generate';
      }
    }
  }

  async function openInGmail() {
    const to = $('#to') ? $('#to').value.trim() : '';
    const subject = $('#subject') ? $('#subject').value : '';
    const body = $('#bodyText') ? $('#bodyText').value : '';
    if (!subject && !body) {
      setStatus('Generate a draft first, or type one in.', 'warn');
      return;
    }
    await send({ type: 'open-gmail', payload: { to, subject, body } });
    setStatus(to ? 'Gmail is open in a new tab.' : 'Gmail is open. The To field is blank, add an address there.', 'good');
  }

  async function copyDraft() {
    const subject = $('#subject') ? $('#subject').value : '';
    const body = $('#bodyText') ? $('#bodyText').value : '';
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`.trim());
      setStatus('Subject and message copied.', 'good');
    } catch {
      setStatus('Could not reach the clipboard. Select the text and copy it by hand.', 'warn');
    }
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error('The extension was reloaded. Refresh this LinkedIn tab and try again.'));
          return;
        }
        if (!response) {
          reject(new Error('No response from the extension. Refresh the page and try again.'));
          return;
        }
        if (!response.ok) {
          const error = new Error(response.error?.message || 'Unknown error.');
          error.code = response.error?.code;
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
    );
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle: LinkedIn is a single page app, so watch for navigation
   * and for Apollo filling in the email after the page settles.
   * ------------------------------------------------------------------ */

  function sync() {
    if (!isProfilePage()) {
      unmount();
      return;
    }
    mount();
    if (!state.open) {
      const emails = findEmails();
      if (emails.join('|') !== state.emails.join('|')) {
        state.emails = emails;
        render();
      }
    }
  }

  let debounce;
  const queueSync = () => {
    clearTimeout(debounce);
    debounce = setTimeout(sync, 600);
  };

  setInterval(() => {
    if (location.href !== state.url) {
      state.url = location.href;
      state.open = false;
      state.generated = false;
      state.emails = [];
      state.profile = null;
      queueSync();
    }
  }, 700);

  new MutationObserver(queueSync).observe(document.documentElement, { childList: true, subtree: true });

  sync();
})();
