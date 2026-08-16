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

### 1. Create the Firebase project

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method**: enable **Email/Password**.
3. **Build → Authentication → Users**: add the owner's account.
4. **Authentication → Settings → User actions**: turn **off** "Enable create
   (sign-up)". There is one account and there should stay one account.
5. **Build → Firestore Database**: create a database in production mode.
6. **Project settings → General → Your apps**: add a Web app and copy the
   config object.

### 2. Point the app at it

Paste the config into `public/js/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: '…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '…',
  appId: '…',
};
```

These values are not secrets — they identify the project, they do not grant
access to it. Access is controlled by Auth plus `firestore.rules`.

Set your project id in `.firebaserc` as well.

### 3. Deploy

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

That publishes hosting, the security rules and the Firestore indexes together.

### 4. Lock the database to your account

Sign in, open **Settings**, and copy the UID shown at the bottom. Paste it into
`ownerUid()` in `firestore.rules`, then:

```bash
firebase deploy --only firestore:rules
```

Until you do this, any authenticated account can read and write. Since sign-up
is disabled there is only one such account, but pinning the UID takes ten
seconds and closes the gap properly.

### Running locally

```bash
firebase emulators:start          # then set USE_EMULATORS = true
# or, against the real project, any static server:
python3 -m http.server 5000 --directory public
```

---

## Migrating from Express Invoice

**Import** is a four-step wizard: choose what you are importing, upload the CSV,
confirm the column mapping, review and run.

Import in this order, so each stage can find what the last one created:

1. **Customers**
2. **Items**
3. **Invoices** (then Quotes and Orders if you keep them)
4. **Payments**

### Getting the CSVs out of Express Invoice

Open each list, then **File → Export** and choose CSV. For invoices, include
the detail lines. Commas, semicolons and tabs all work — the separator is
detected. So is Windows-1252 encoding, which older exports often use.

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
    fb.js          the only file that imports the Firebase SDK
    firebase-config.js
    i18n.js        every visible label, in one dictionary
    app.js         auth, chrome, money, dates, shortcuts, Firestore helpers
    model.js       document totals, statuses, payments, statements
    components.js  autocomplete, tables, cards, status pills
    store.js       cached customer and item lists
    doc-editor.js  the invoice/quote/order editor (all three screens)
    doc-list.js    the invoice/quote/order list (all three screens)
    pages/*.js     one entry point per screen
firestore.rules  firestore.indexes.json  firebase.json
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
