# Lustre Lapidist: gemstone store (complete guide)

## 1. What you have
```
lustre-store/
  server.js            Backend: login, products, checkout, Razorpay check, orders, admin API
  package.json         Dependencies
  .env.example         Settings template (copy to .env)
  products.csv         Stone list and per-carat base prices (re-read on every server start)
  public/
    index.html         The storefront shell (header, footer, page area)
    css/style.css      All styling
    js/app.js          All pages and shop logic
    js/stones.js       Written details for each stone (origin, hardness, tradition, care)
    admin.html         Order admin page
  store.db             Created automatically on first run (users and orders)
```

## 2. Page map (inside the storefront)
| Address | Page |
|---|---|
| #home | Magazine home page |
| #shop, #shop/precious, #shop/semi, #shop/navratna | Shop with search, sort and detail window |
| #stone/ID | One stone: carat prices, details, wishlist heart |
| #birth/october | Birthstone page with banner, filters, sort |
| #search/ruby | Search results |
| #wishlist | Saved stones |
| #cart, #checkout, #success/ORDERID | Cart, address and payment, confirmation |
| #track | My orders and delivery stages |
| #login, #signup | Account pages (log out is in the header) |
| #contact, #policy/shipping | Contact (opens WhatsApp) and policy pages |
| /admin.html | Admin: update delivery status |

## 3. Run it on your computer
1. Install Node.js 18 or newer (nodejs.org).
2. Open a terminal in this folder and run: `npm install`
3. Copy `.env.example` to `.env`. Set JWT_SECRET (long random text) and ADMIN_KEY (your admin password).
4. Run: `npm start`, then open http://localhost:3000

## 4. Take real payments
1. Create a Razorpay account (razorpay.com) and complete KYC.
2. In Test mode, copy Key ID and Key Secret into `.env` (RZP_KEY_ID, RZP_KEY_SECRET). Restart.
3. Place a test order with Razorpay's test payment details from their docs.
4. For live money, switch to Live keys. Razorpay will review your site, so finish your policy pages first.
Until keys are set, checkout runs in demo mode with a fake success prompt.

## 5. Run the shop day to day
- New order: open /admin.html, enter ADMIN_KEY, then set Packed, Shipped, Out for delivery, Delivered. Customers see it on My orders.
- Change prices: edit `price_per_carat` in products.csv and restart. Larger sizes add 4 percent per extra carat (see `price()` in server.js and js/app.js; keep both the same).
- Add a stone: add a line to products.csv with a new id, add its text to js/stones.js, restart.
- Change words, phone number or colours: js/app.js (pages), css/style.css (colours at the top).

## 6. Put it online
Use a host that runs Node and keeps files between restarts (a VPS, or Render or Railway with a persistent disk for store.db). Set the same .env values as environment variables, set NODE_ENV=production, and use HTTPS (hosts provide it). Then point your domain at it.

## 7. Troubleshooting
- "Cannot reach the server": run `npm start` and open localhost:3000, not the file directly.
- Needs Node 22.13 or newer (the database is built into Node, nothing to compile).
- Port in use: set PORT=3001 in .env.
- Login lost after restart: JWT_SECRET must stay the same.

## 8. Still to do before a serious launch
Real product photos and certificates; edit the sample policy pages; order emails and GST invoices; Razorpay webhooks; a hosted database (Postgres); backups of store.db; server-side wishlist (currently saved per browser).
