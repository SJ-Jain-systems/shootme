# ShootMe: setup, step by step

About 10 minutes, once. After that it is two clicks per email.

You need Google Chrome, a Gmail account, and a card for the Claude billing page
(you can put as little as $5 on it).

---

## 1. Put the folder somewhere permanent

Unzip the file you were sent. You will get a folder called **shootme**.

Move it somewhere you will not delete by accident, for example
`Documents/shootme`. Chrome reads the extension from this folder every time it
starts, so **do not delete, rename or move the folder afterwards.** If you do,
the extension disappears and you redo step 2.

## 2. Add it to Chrome

1. Open Chrome and type `chrome://extensions` in the address bar, then press Enter.
2. Top right of that page, turn on **Developer mode**.
3. Click **Load unpacked** (top left).
4. Select the **shootme** folder from step 1 and click Open.

You should now see a card called "ShootMe - LinkedIn Outreach".

5. Click the puzzle piece icon in the Chrome toolbar, find ShootMe, and click
   the pin so its icon stays visible.

> Chrome will show a bar saying "Disable developer mode extensions" each time
> you restart it. Click the **X** on that bar. It is Chrome being cautious about
> extensions that did not come from its store. Nothing is wrong.

## 3. Get a Claude key

This is the part that writes the emails. It is paid, by usage, and it is cheap:
roughly **1 to 2 cents per email**, less if you pick a smaller model later.

1. Go to <https://console.anthropic.com> and sign up or log in.
2. In the left menu open **Billing** and add credit. $5 covers a few hundred emails.
3. In the left menu open **API keys**, click **Create key**, give it a name like
   "shootme", and click Create.
4. Copy the key. It starts with `sk-ant-`. You can only see it once, so paste it
   into the next step straight away.

## 4. Tell ShootMe about you

The settings page opened by itself when you installed. If you closed it, click
the ShootMe icon in the toolbar and then **Open settings**.

Fill in:

- **Claude API key**: paste the key from step 3, then click **Test my key**. It
  should say "Working".
- **Your name** and **Your role**: how you want to be introduced.
- **What you are working on**: one or two honest lines. This is what the email
  pitches, so it is worth getting right.
- **Sign off**: exactly what goes at the bottom of every email, for example:

  ```
  Best,
  Sam
  sam.example.com
  ```

Leave everything else as it is to start. Click **Save**.

## 5. Install Apollo

ShootMe reads the email address that Apollo puts on the LinkedIn page. If you do
not have it yet, install the **Apollo.io** extension from the Chrome Web Store
and sign in.

---

## Using it

1. Open someone's LinkedIn profile, the page with their name and photo.
2. Open Apollo so their email shows on the page.
3. Bottom right you will see a purple **Draft email** button. The dot on it is
   green when an email has been found, amber when it has not.
4. Click it. The panel opens with their address already filled in.
5. Pick a **Goal** and a **Tone**. If you have something specific to mention,
   such as a mutual friend, type it in the "Anything to work in" box.
6. Click **Generate**. The draft appears in a few seconds.
7. **Read it and edit it.** It is a draft, not a send button. Change anything
   that does not sound like you.
8. Click **Open in Gmail**. A Gmail tab opens with the address, subject and
   message filled in. Check it once more, then hit Send yourself.

Nothing is ever sent automatically. ShootMe stops at the Gmail compose window.

---

## If something goes wrong

**There is no purple button.**
Refresh the page. The button only appears on profile pages, the ones whose web
address contains `/in/`. It does not appear on search results or the feed.

**The dot is amber and the email box is empty.**
Apollo has not revealed the address yet. Open the Apollo panel, wait for the
email to show on the page, then close and reopen the ShootMe panel. If Apollo
has no email for that person, type one in by hand or leave it blank and fill it
in inside Gmail.

**"That API key was rejected."**
Copy the key again from console.anthropic.com, making sure there is no space at
either end. If it still fails, create a new key.

**"Your Anthropic account needs credit."**
Add credit under Billing at console.anthropic.com.

**Gmail opens on the wrong account.**
In ShootMe settings, section 4, choose which signed in Google account to use.
The first one you signed into on this computer is number one in the list.

**The extension vanished after a Chrome restart.**
The folder from step 1 was moved or deleted. Put it back, or unzip it again, and
redo step 2.

**The drafts sound wrong.**
Settings, section 3, is the base prompt. It is plain English, edit it. Telling
it what not to say works as well as telling it what to say.
