# Express Invoicing

A replacement for NCH Express Invoice, built for a single cellphone retail shop.

The point of this project is continuity. The owner has run Express Invoice for
about ten years and has thousands of invoices, quotes and payments to bring
across. So the vocabulary, the screen structure, the keyboard shortcuts and the
printed paperwork all stay as they were — only the surface is modern, and it
runs in a browser instead of on one Windows machine.

- **Single user.** One Firebase Auth account, the shop owner. No roles, no
  permission matrix, no multi-user console.
- **No build step.** Plain HTML, CSS and ES modules served as-is. One HTML file
  per screen, a shared `app.css` and `app.js`.

---

## Setting it up

The project config for `expressinvoice-b91c4` is already filled in
(`public/js/firebase-config.js` and `.firebaserc`), so what is left is the
console switches and one deploy.

### 1. Firebase console

1. **Build → Authentication → Sign-in method**: enable **Email/Password**.
2. **Build → Authentication → Users → Add user**: create the owner's account.
3. **Authentication → Settings → User actions**: turn **off** "Enable create
   (sign-up)". This is the switch that stops the internet from making accounts
   on your project. Do not skip it.
4. **Build → Firestore Database → Create database**, in production mode. Pick
   the region closest to the shop; it cannot be changed later.

You do **not** need to enable Cloud Storage — see
[Cloud Storage](#cloud-storage-not-needed) below.

### 2. Lock the database to your account

Open `firestore.rules` and fill in **one** of the two functions near the top:

```
function ownerEmail() { return 'you@example.com'; }   // known before first sign-in
function ownerUid()   { return 'a1B2c3...'; }         // shown in Settings after sign-in
```

Either is enough. `ownerUid()` is the stronger of the two — a UID cannot be
changed, an email address can — but `ownerEmail()` is the one you can set
before you have ever signed in. Setting both requires both to match.

Leave them both blank and any signed-in account can read and write. With
sign-up disabled that is still closed, but it is one console misclick away from
not being — so fill one in.

### 3. Deploy the rules

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore
```

The rules and indexes have to come from here whichever host serves the pages.

### 4. Deploy the app

The pages are static files, so any host works. Two are set up:

**Netlify** (`netlify.toml`)

Netlify publishes the repository root by default, but this app lives in
`public/` — that mismatch is what shows "Page not found" at the site root.
`netlify.toml` sets `publish = "public"`, so it is fixed as soon as Netlify
builds a commit that contains that file.

Two settings to check in the Netlify UI:

- **Site configuration → Build & deploy → Branches → Production branch** must
  name a branch that exists. This repository has no `main`; if Netlify is
  pointed at one, it has nothing to deploy and every URL 404s.
- **Publish directory** should read `public`, or be left empty so
  `netlify.toml` supplies it.

There is deliberately no SPA catch-all redirect. This is a multi-page app —
`invoices.html` and the rest are real files — so a `/* → /index.html` rule
would swallow genuine 404s and bounce typos to the dashboard.

**Firebase Hosting** (`firebase.json`)

```bash
firebase deploy
```

Publishes hosting, rules and indexes in one go.

Either is fine, and they do not conflict: Firestore and Auth are reached over
HTTPS from whatever origin the page came from, so the app behaves identically
on both.

### 5. Tell Firebase about the domain you are using

Whatever host you land on, add its domain in **Firebase console →
Authentication → Settings → Authorized domains** — e.g.
`expressinvoice.netlify.app`. Email/password sign-in largely works without it,
but password-reset links and anything OAuth-shaped do not, and the failure is
silent enough to waste an afternoon.

If you restricted the API key to HTTP referrers (see below), **add the same
domain there too** — otherwise the app will load and then fail every request.

### About the API key in `firebase-config.js`

It is committed on purpose. A Firebase web config identifies the project; it
does not grant access to it, and every Firebase web app ships these values in
plain JavaScript that anyone can read. The data is protected by Email/Password
sign-in with sign-up disabled, plus `firestore.rules`.

One thing worth doing once, in **Google Cloud Console → APIs & Services →
Credentials**: restrict the key to your Hosting domains (HTTP referrers). That
does not protect the data — the rules do that — but it stops anyone else
pointing their own page at your key and spending your quota.

### Running locally

```bash
firebase emulators:start          # then set USE_EMULATORS = true
# or, against the real project, any static server:
python3 -m http.server 5000 --directory public
```

---

## Cloud Storage: not needed

**This app does not use Cloud Storage, and you do not need to enable it.**
Nothing here uploads a file:

| What you might expect to need a bucket | Where it actually goes |
| --- | --- |
| Business logo | Scaled down and stored inside the `settings/business` Firestore document |
| Backups | Downloaded to your computer as JSON |
| CSV imports | Read in the browser, never uploaded |
| Invoice PDFs | Produced by the browser's own Print dialog |

The `storageBucket` line in `firebase-config.js` is just part of the standard
config block Firebase hands out. It does not create a bucket, and leaving it
there costs nothing.

The logo is worth a word, since it is the one binary the app holds. It is
resized to fit 600×240, encoded as PNG, and re-encoded as progressively cheaper
JPEG only if the PNG comes out heavy. Typical result is a few tens of
kilobytes, comfortably inside the 1 MB Firestore document limit, and it travels
with the rest of the settings instead of needing a bucket, its own rules and an
upload/download path of its own. An image that still will not fit is rejected
with a message rather than failing the save.

`storage.rules` in the repo is a deny-all ruleset, kept for one situation: if
Storage ever does get switched on — deliberately, or by clicking through a
setup screen — a bucket appears with default rules that may permit access.
Deploying this shuts it. To use it, add to `firebase.json`:

```json
"storage": { "rules": "storage.rules" }
```

then `firebase deploy --only storage`. Do **not** add that block before Storage
is enabled: `firebase deploy` fails when told to deploy rules for a bucket that
does not exist, which is why it is not in `firebase.json` already.

### If you ever do want Storage

The realistic reason would be attaching photos to invoices — a picture of a
cracked screen against a repair job. That would mean enabling Storage,
replacing `storage.rules` with an owner-only ruleset shaped like the Firestore
one, and adding upload plus display to the line grid. It is a real feature, not
a config change, and it is out of scope today.

---

## Migrating from Express Invoice

**Import** is a four-step wizard: choose what you are importing, upload the CSV,
confirm the column mapping, review and run.

Import in this order, so each stage can find what the last one created:

1. **Customers**
2. **Items**
3. **Invoices** (then Quotes and Orders if you keep them)
4. **Payments**

### Getting the data out of Express Invoice

**The `.dat` files in the Express Invoice program folder are its internal
storage, not an export format.** If the old program still runs, export from
inside it: open each list, then **File → Export**, and choose CSV. For invoices,
include the detail lines, or every invoice arrives as a single lump. That path
takes minutes.

If the old program is gone and only the `.dat` files survive, load one into the
import screen anyway. It reads the opening bytes and names what it found:

| What it turns out to be | What happens |
| --- | --- |
| Delimited text under a `.dat` name | Imports normally — nothing else needed |
| UTF-16 text (common from older Windows software) | Decoded and imported normally |
| A SQLite database | Named as such, with the route out: open it in DB Browser for SQLite and export each table to CSV |
| XML or JSON | Named, with an offer to add a reader for that layout |
| A proprietary binary | Named, with a hex fingerprint of the opening bytes to send on for identification |

Commas, semicolons and tabs all work — the separator is detected. So is
Windows-1252 encoding, which older exports often use.

### What the importer guarantees

**Exported totals are never recomputed.** If the file carries a subtotal, tax
or total, it is stored exactly as exported. A 2016 invoice charged at the old
tax rate keeps the figures the customer actually paid; only fields the export
did not supply get derived. This is the single most important rule in the
importer, and it is what makes the migration safe.

Other behaviour worth knowing:

- **Multi-line invoices** must repeat the invoice number on every row. Rows are
  grouped by that number; a blank number on a row with line content is treated
  as a continuation of the invoice above it.
- **Column mapping is guessed** from the header names, and every guess is shown
  for you to correct before anything is written. The synonym lists include some
  Spanish header spellings — not as UI text, but so an older export in that
  language still auto-maps instead of needing 25 columns set by hand.
- **Dates** are read in almost any format. If your export is day/month/year,
  tick the box on the preview step — ambiguous dates like `03/05/2024` need it.
- **Duplicates**: choose skip, update, or always-create. Skip is the default, so
  re-running a partial import is safe.
- **Missing customers** can be created automatically from the invoice rows, or
  left unmatched.
- **Numbering** rolls forward automatically: after importing, the next invoice
  number is set past the highest one in the file.

Take a backup first if the database already has data:
**Settings → Full Backup (JSON)**.

---

## The home screen

Express Invoice opened onto a flow chart of the sales cycle rather than a menu,
so this does too. A quote becomes an order, an order becomes an invoice, an
invoice gets paid, and the payment lands on a statement — with customers, items
and recurring templates feeding in from above.

Two things the paper version could not do: every box is a link to that screen,
with a `+` in the corner that starts a new one, and every box carries its own
live figure — open quotes, money outstanding, payments taken this month — so
the diagram doubles as the morning status check. Anything overdue or ready to
generate shows as a pill on the box concerned.

The boxes are placed with CSS Grid; `js/workflow.js` then measures where they
landed and draws the connectors into an SVG layer beneath, redrawing on resize.
Hand-placed lines would drift the moment a label wrapped or a font differed.
Below 1080px the grid reflows and the connectors switch themselves off, because
a flow chart drawn down a narrow screen is a list with extra lines.

Underneath the diagram sits what a picture cannot carry: this month's totals,
anything overdue, and the last few invoices and payments.

---

## Keyboard shortcuts

The full list lives on the **Keyboard Shortcuts** screen, or press `?`.

| Key | Action |
| --- | --- |
| `F2` / `F3` / `F4` | New invoice / quote / order |
| `F8` | Record payment |
| `Ctrl`+`S` | Save |
| `Ctrl`+`Shift`+`S` | Save & new |
| `Ctrl`+`Enter` | Save & close |
| `Ctrl`+`P` | Print |
| `/` | Focus search |
| `G` then `F`/`Q`/`O`/`P`/`C`/`A`/`R` | Go to invoices / quotes / orders / payments / customers / items / reports |
| `Enter` in the line grid | Next line, adding one on the last row |
| `Alt`+`I` / `Alt`+`D` | Insert / delete line |
| `Alt`+`↑` / `Alt`+`↓` | Move line up / down |

`Ctrl`+`N` is deliberately unused: browsers keep it for "new window" and will
not release it, so the new-document keys are on the function row where they
work from anywhere, including inside a field.

---

## How it is put together

```
public/
  index.html  login.html  dashboard.html
  invoices.html  invoice.html        quotes.html  quote.html
  orders.html    order.html          payments.html  payment.html
  customers.html customer.html       items.html   item.html
  recurring.html statements.html     reports.html
  import.html    settings.html       shortcuts.html  search.html
  print.html
  css/
    app.css        screen styles
    print.css      the paper layout
  js/
    fb.js          the only file that imports the Firebase SDK (v12.17.1,
                   pinned here so the version is a one-line change)
    firebase-config.js
    i18n.js        every visible label, in one dictionary
    app.js         auth, chrome, money, dates, shortcuts, Firestore helpers
    model.js       document totals, statuses, payments, statements
    components.js  autocomplete, tables, cards, status pills
    store.js       cached customer and item lists
    workflow.js    the home-screen flow chart: boxes in a grid, connectors
                   drawn as SVG from their measured positions
    doc-editor.js  the invoice/quote/order editor (all three screens)
    doc-list.js    the invoice/quote/order list (all three screens)
    pages/*.js     one entry point per screen (index.js included, so no
                   page carries an inline <script>)
firestore.rules  firestore.indexes.json  storage.rules
firebase.json    Firebase Hosting + rules + indexes
netlify.toml     Netlify: publish directory, caching, security headers
```

### Conventions that matter

**Money is always integer cents.** Never a float dollar amount, anywhere —
storage, arithmetic and totals. Ten years of history has to add up exactly.

**Dates are `YYYY-MM-DD` strings.** They sort correctly as text, they do not
drift with timezones, and they match what the CSV exports contain.

**Statuses that depend on today are derived, not stored.** An invoice stores
`unpaid` / `partial` / `paid`; "overdue" is computed at display time from the
due date. A stored `overdue` would be wrong the next morning.

**Documents snapshot their customer.** The name, address block and terms are
copied onto the invoice when it is created. Editing a customer later never
rewrites paperwork that has already gone out the door.

**Labels live in `i18n.js`, not in the markup.** `T(key)` returns the plain
string for attributes and text nodes; `L(key)` returns it escaped for the places
screens build markup as strings. Changing a word is one edit, and it lands on
screen, on paper and in CSV exports at the same time.

### Data model

| Collection | Holds |
| --- | --- |
| `settings/business` | Business details, logo, tax rates, defaults |
| `counters/{type}` | Next number, prefix and padding per document type |
| `customers` | Customer records |
| `items` | Product and service catalog |
| `invoices`, `quotes`, `orders` | Documents, each with its own `lines` array |
| `payments` | Payments with `allocations` against invoices |
| `recurring` | Recurring invoice templates |

Invoice numbers are handed out by a Firestore transaction, so a number is never
issued twice. A new document previews the next number without consuming it — an
abandoned draft does not eat a number out of the sequence. Typing your own
number is allowed; the counter is pushed past it.

Payments move `paidCents` on the affected invoices inside a single transaction,
and the invoices are updated **before** the payment record is written. If
anything fails, no payment is saved and the receivables stay consistent.

---

## Deliberately not included

Fax. Credit-card gateways. Inventoria stock sync. EDI export. The web-access
console. Multi-user anything. Packing slips and shipping labels.

**IMEI and serial numbers are not a feature.** They live in the item
description as free text, exactly as they do today, and get no special
handling — no field, no validation, no lookup. They print on the invoice
because the description prints.

There is a plain stock counter on items (opt-in per item, decremented when an
invoice is saved) because Express Invoice had one. It is not synced anywhere.

---

## Notes on a few decisions

**Email.** Without a backend there is no way to send mail, so the Email button
opens your mail client with the customer's address and a message filled in.
Print to PDF and attach it. Adding real sending would mean a Cloud Function and
a mail provider.

**Recurring invoices never bill on their own.** There is no scheduler; the
dashboard shows what is due and you press Generate. For a one-person shop,
invoices appearing unattended is a bug, not a feature.

**Lists load the 400 most recent documents** and filter in the browser, which
keeps searching instant. Narrow by date to reach older records. Reports read up
to 4,000 documents at a time.

**Tax.** Two rates are supported, optionally compounding, and prices can be
tax-inclusive. Inclusive pricing does not model compounding — an all-in shelf
price is a single number, and splitting it two ways would invent precision that
is not there.
