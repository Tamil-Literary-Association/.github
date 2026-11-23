# Tamil Literary Association: organisation profile

This repository holds the page shown on
[github.com/Tamil-Literary-Association](https://github.com/Tamil-Literary-Association).

- `profile/README.md` is the profile page itself. Edit the text here.
- `profile/assets/` holds the pictures. They are made by `scripts/capture.mjs`,
  so don't edit them by hand.
- `scripts/banner.html` is the header banner and `scripts/showcase.html` is the laptop and phone frame
  around the live preview. Change these to change the design.

## How the pictures stay up to date

The **Refresh profile pictures** workflow opens [tlauom.com](https://tlauom.com) in a headless browser,
records the home page on a laptop and a phone, takes screenshots of the main pages, and commits them.
It runs every Monday, after any change to `scripts/`, and on demand from the
**Actions** tab (**Refresh profile pictures → Run workflow**).

The event pictures under "What we do" are copied from `tlauom.com/og/` on each run (GitHub's image
proxy sometimes fails to load pictures from other sites).

## Running it on your own computer

```sh
npm install
npx playwright install chromium   # or skip this on Windows and set BROWSER_CHANNEL=msedge
npm run capture
```
