# ShootMe

A Chrome extension for LinkedIn outreach. You are scrolling LinkedIn, you find
someone worth talking to, Apollo has surfaced their email. One click drafts a
personalized email with Claude and opens it in Gmail, filled in and ready for
you to review and send.

Nothing sends automatically. The extension stops at the Gmail compose window.

**Setting it up on someone's machine? Give them [INSTALL.md](INSTALL.md).**
It is written for a non technical reader and assumes nothing.

---

## How it works

```
LinkedIn profile page
  └─ content script  src/content/content.js
       ├─ scrapes the profile (name, headline, company, visible page text)
       ├─ finds the email Apollo injected into the page
       └─ renders the panel in a shadow root, so LinkedIn CSS cannot touch it
             │
             ▼  chrome.runtime.sendMessage
       background service worker  src/background/service-worker.js
             ├─ POST https://api.anthropic.com/v1/messages   (your key, your account)
             └─ chrome.tabs.create → Gmail compose, prefilled
```

The API key lives in `chrome.storage.local` and is only ever read by the
service worker. The content script never sees it, and LinkedIn never sees it.
Storage is deliberately `local`, not `sync`, so the key is not pushed through
the user's Google account to their other machines.

### Finding the email

Apollo renders the address into the LinkedIn page. The content script collects
candidates from `mailto:` links, visible text and input values, walking open
shadow roots as it goes, then scores them: an ancestor whose id or class
mentions `apollo`, or carries Apollo's `zp_` class prefix, wins over a stray
address elsewhere on the page. Obvious non candidates (`@linkedin.com`,
`no-reply@`, `support@`, image filenames) are dropped.

If Apollo renders inside a cross origin iframe on some layout, the page text is
unreachable from a content script and nothing is found. The panel then shows an
empty, editable address box and the rest of the flow still works.

### Writing the email

One non streaming call to the Messages API per draft.

- System prompt: who you are (from settings), your base prompt, the goal and
  tone chosen in the panel, the word limit, the subject style.
- User message: the scraped profile fields plus up to 9,000 characters of the
  profile's visible text, and anything you typed into the "work this in" box.
- Output: plain text, `Subject: ...`, a blank line, then the body. Parsed with a
  tolerant regex, so a missing subject line degrades to a default rather than
  failing.
- `output_config.effort` defaults to `low`, which is plenty for a short email.
  The system prompt carries a `cache_control` breakpoint, so the stable part of
  the prompt is cached across drafts.

Thinking is left adaptive (the default on Claude 5 models) and the response is
read by filtering for `text` blocks, so a leading thinking block never ends up
in the email.

## Cost

Per draft, roughly 2,000 input tokens and 150 output tokens.

| Model | Setting label | Approx per email |
| --- | --- | --- |
| `claude-opus-5-5` | best writing, default | 1 to 2 cents |
| `claude-sonnet-5-5` | balanced | under a cent |
| `claude-haiku-5-5` | cheapest | a fraction of a cent |

The panel prints the real cost of each draft under the message box, from the
`usage` the API returns.

## Repository layout

| Path | What it is |
| --- | --- |
| `manifest.json` | MV3 manifest. Host permission is `api.anthropic.com` only. |
| `src/content/content.js` | Scraping, email detection, the panel UI. No build step, no imports. |
| `src/background/service-worker.js` | Claude call, Gmail tab, error translation. |
| `src/shared/defaults.js` | Settings schema, defaults, the default base prompt. |
| `src/options/` | Settings page. |
| `src/popup/` | Toolbar popup: status and a link to settings. |
| `tools/build-zip.py` | Packages `dist/shootme-<version>.zip` for handing to someone. |
| `tools/make-icons.py` | Regenerates the PNG icons, no image library needed. |
| `tools/smoke-test.mjs` | Playwright end to end test against a fake LinkedIn page. |

There is no build step and no dependencies. The folder in the repo is the
extension; `chrome://extensions` → Load unpacked points straight at it.

## Development

```bash
python3 tools/build-zip.py
```

```bash
node tools/smoke-test.mjs
```

The smoke test loads the unpacked extension in Chromium, serves a fake profile
page (with a fake Apollo panel) at a real `linkedin.com` URL, stubs the Claude
API and Gmail, and checks the whole path: panel mounts, email detected, profile
scraped, subject and body parsed, signature appended, Gmail opened with the
right recipient. It needs Playwright and runs headless.

```bash
python3 tools/make-icons.py
```

After editing any file, open `chrome://extensions` and click the reload arrow on
the ShootMe card, then refresh the LinkedIn tab.

## Shipping it to the Chrome Web Store

Loading unpacked works and costs nothing, but Chrome nags about developer mode
on every restart and the folder has to stay put. If you want a real one click
install with automatic updates:

1. Pay the one time $5 developer fee at
   <https://chrome.google.com/webstore/devconsole>.
2. Upload `dist/shootme-<version>.zip`.
3. Set visibility to **Unlisted** so only people with the link can install it.
4. Declare the permissions: `storage` for settings, host access to
   `api.anthropic.com` to write the drafts, and the LinkedIn content script to
   read the profile you are viewing. Say plainly that no data is sold or sent
   anywhere except Anthropic.
5. Review usually takes a few days for a first submission.

## Limitations worth knowing

- LinkedIn changes its DOM often. The name, headline and company selectors are
  best effort with fallbacks; the model mostly works from the page's visible
  text, which survives redesigns better than any selector.
- The extension reads whatever Apollo shows. It does not call the Apollo API and
  does not bypass Apollo's credit limits.
- Gmail web only. A `mailto:` or Outlook variant is a small change in
  `openGmail()` in the service worker if you ever need it.
- Each person installing this needs their own Anthropic key. If that is too much
  to ask of them, the alternative is a small proxy you host and pay for, with
  the key server side.
