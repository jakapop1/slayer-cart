# Slayer Cart 滅

A Demon Slayer–inspired shopping list and total tracker. It's a static web app (plain HTML, CSS and JavaScript with no build step) made to be hosted for free on **GitHub Pages**. Your list never leaves your device.

## What it does

| Area | Features |
|---|---|
| **List** (品) | Add items with price, quantity and store. Edit any price inline, use +/− for quantity, and tap an item's name to edit everything. Tap the circle to slash an item into your basket. Filter by store. Undo a delete. |
| **Price memory** | Remembers the last price you paid for each item at each store. While you type, it shows "Seen before at: Costco $16.99 · Walmart $15.49 (cheapest)". Leave the price blank to reuse the last one. A ▲/▼ badge shows when a price went up or down. |
| **Totals** | A sticky bar shows *In basket* and *Whole list* totals, with optional sales tax (presets for Oʻahu GET 4.712% and neighbor islands 4.5%) and an optional trip budget meter. |
| **Receipt** (計) | Switch between itemized and by-store views, and between in-basket and whole-list. Copy it as text, share it (on phones) or print it. |
| **Stores** (店) | Starts with Costco, Walmart, Times, Safeway and Don Quijote. Add, rename, recolor or remove stores. Each store gets a "breathing style" color (Water, Flame, Thunder, Beast…) and shows its all-time spend. |
| **History** (記) | **Finish trip** logs what's in your basket as a dated receipt. See monthly and all-time spending. **Shop again** puts a past trip's items back on your list. |
| **Settings** (設) | Tax, budget, currency, petal effect, backup export/import, erase all. |
| **Phone app** | Installs to your Home Screen and works offline in the store. |

## Why it's free, secure and safe

- **Free:** GitHub Pages hosting costs nothing. There's no server or database to pay for.
- **Private:** data is stored in your browser's `localStorage` on your device only. No accounts, no passwords, no analytics, no ads. Even the person hosting the site can't see your list.
- **Hardened:** a Content-Security-Policy allows only the site's own scripts to run. All text you type is inserted as plain text, never as HTML, so it can't run as code. Imported backups are validated and size-limited before use.
- **Nothing secret in the code:** there are no API keys or credentials, so a public GitHub repo is safe.

**The trade-off:** your list lives on one device. Use **Settings → Export backup** to keep a copy or to move it to another phone (then **Import backup** there). On iPhone, add the app to your Home Screen. Safari can clear data for websites you haven't opened in about 7 days, but Home Screen apps are exempt.

## Run it on your computer

Any static file server works. From this folder:

```bash
python -m http.server 5510
```

Then open http://localhost:5510.

## Put it on GitHub Pages

**Option A: no command line**

1. Sign in at github.com and click **New repository**. Name it `slayer-cart`, make it **Public** (free Pages hosting requires a public repo), then click **Create repository**.
2. Click **uploading an existing file**. Drag in *everything inside* this folder: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, `README.md` and the `icons` folder. Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main**, folder to **/ (root)**, then click **Save**.
4. After a minute or two, your app is live at `https://<your-username>.github.io/slayer-cart/`.

**Option B: git + GitHub CLI**

```bash
git init
git add .
git commit -m "Slayer Cart"
git branch -M main
gh repo create slayer-cart --public --source=. --push
gh api -X POST repos/{owner}/slayer-cart/pages -f "source[branch]=main" -f "source[path]=/"
```

**Updating later:** change the files and push or upload again. If you change the list of files in `sw.js`, bump `VERSION` there so phones pick up the new offline copy.

## Install on your phone

Open your GitHub Pages link, then:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**

## Files

```
index.html             page structure + security policy
styles.css             theme (patterns, colors, animations)
app.js                 all app logic and storage
sw.js                  offline support
manifest.webmanifest   Home Screen app settings
icons/                 app icons
.nojekyll              tells GitHub Pages to serve files as-is
```

## Ideas for later

Things to add next, roughly easiest first:

1. **More stores or default items:** edit `DEFAULT_STORES` at the top of `app.js`.
2. **Categories / aisles** (Produce, Frozen, Household) to sort the list the way you walk the store.
3. **Unit prices** (price per oz or lb) to compare Costco bulk sizes with Times or Safeway.
4. **Weekly or monthly spending charts** on the History tab.
5. **Shared list with family (cloud sync).** This needs a database, which means accounts. Free options are **Supabase** (Postgres with email magic-link login and Row Level Security) and **Firebase** (Firestore + Auth, free Spark plan). Either works with GitHub Pages. Their public "anon/web" keys are designed to sit in front-end code, *but only* if you enable database security rules so each person can read only their own list. Ask Claude to help set this up when you're ready. It's a bigger step that adds sign-in.
6. **Barcode scanning** to add items using the phone camera.

## Note

Fan-made and inspired by *Demon Slayer*. It isn't affiliated with or endorsed by the creators or publishers. The look uses traditional Japanese patterns (ichimatsu, asanoha, uroko) and no official artwork. Store names are only labels for your own list.

Also note that GitHub Pages serves all of your project sites from the same `<your-username>.github.io` address, so they share browser storage. Slayer Cart keeps its data under its own key (`slayer-cart:v1`), and only pages you publish yourself can run there.
