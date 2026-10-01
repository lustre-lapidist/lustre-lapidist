require('dotenv').config();
const express = require('express'), { DatabaseSync } = require('node:sqlite'), bcrypt = require('bcryptjs'); // node:sqlite is built into Node 22.13+, nothing to compile
const jwt = require('jsonwebtoken'), crypto = require('crypto'), fs = require('fs');
const { JWT_SECRET, RZP_KEY_ID, RZP_KEY_SECRET, ADMIN_KEY, PORT = 3000 } = process.env;
if (!JWT_SECRET) throw new Error('Set JWT_SECRET in .env (copy .env.example)');
const rzp = RZP_KEY_ID && RZP_KEY_SECRET ? new (require('razorpay'))({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET }) : null;

// ---------- database ----------
const db = new DatabaseSync('store.db');
db.exec(`
create table if not exists users(id integer primary key, name text, email text unique, hash text);
create table if not exists products(id integer primary key, name text, category text, color text, price_per_carat integer, description text);
create table if not exists orders(id text primary key, user_id integer, total integer, addr text, items text,
  status text default 'Pending', pay_id text, rzp_order_id text, created integer);`);
{
  const ins = db.prepare('insert or replace into products values(?,?,?,?,?,?)');
  fs.readFileSync('products.csv', 'utf8').trim().split('\n').slice(1).forEach(l => {
    const [id, name, cat, color, ppc, ...d] = l.split(','); ins.run(+id, name, cat, color, +ppc, d.join(','));
  });
}
const STAGES = ['Confirmed', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'], CARATS = [1, 2, 3, 5];
const price = (ppc, c) => Math.round(ppc * c * (1 + 0.04 * (c - 1))); // same rule as the shop page

// ---------- helpers ----------
const app = express(); app.use(express.json({ limit: '50kb' })); app.use(express.static('public'));
const who = req => { const m = (req.headers.cookie || '').match(/(?:^|; )tok=([^;]+)/); try { return jwt.verify(m[1], JWT_SECRET) } catch { return null } };
const auth = (req, res, next) => { req.user = who(req); req.user ? next() : res.status(401).json({ error: 'Please log in first' }) };
const admin = (req, res, next) => ADMIN_KEY && req.headers['x-admin-key'] === ADMIN_KEY ? next() : res.status(403).json({ error: 'Admin only' });
const session = (res, u) => { res.cookie('tok', jwt.sign({ id: u.id, name: u.name, email: u.email }, JWT_SECRET, { expiresIn: '7d' }),
  { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 }); return { name: u.name, email: u.email } };
const tries = {}; // tiny login rate limit: 10 attempts / 15 min / IP
const limit = (req, res, next) => { const k = req.ip, n = tries[k] = (tries[k] || []).filter(t => Date.now() - t < 9e5); if (n.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try later.' }); n.push(Date.now()); next() };

// ---------- auth ----------
app.post('/api/signup', limit, (req, res) => {
  const { name, email, pw } = req.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || (pw || '').length < 6) return res.status(400).json({ error: 'Enter a name, a valid email and a password of 6+ characters.' });
  if (db.prepare('select 1 from users where email=?').get(email.toLowerCase())) return res.status(400).json({ error: 'This email is already registered. Log in instead.' });
  const id = db.prepare('insert into users(name,email,hash) values(?,?,?)').run(name.trim(), email.toLowerCase(), bcrypt.hashSync(pw, 10)).lastInsertRowid;
  res.json({ user: session(res, { id, name: name.trim(), email: email.toLowerCase() }) });
});
app.post('/api/login', limit, (req, res) => {
  const { email, pw } = req.body || {}, u = db.prepare('select * from users where email=?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(pw || '', u.hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ user: session(res, u) });
});
app.post('/api/logout', (req, res) => { res.clearCookie('tok'); res.json({ ok: true }) });
app.get('/api/me', (req, res) => { const u = who(req); res.json({ user: u ? { name: u.name, email: u.email } : null }) });

// ---------- shop ----------
app.get('/api/products', (req, res) => res.json(db.prepare('select * from products').all()));

// Price is always calculated on the server from the database, never trusted from the browser.
app.post('/api/checkout', auth, async (req, res) => {
  try {
    const { items, addr } = req.body || {};
    if (!Array.isArray(items) || !items.length || !addr) return res.status(400).json({ error: 'Your cart is empty.' });
    for (const k of ['name', 'phone', 'line', 'city', 'state', 'pin']) if (!addr[k]) return res.status(400).json({ error: 'Please fill the full address.' });
    let total = 0; const lines = [];
    for (const i of items) {
      const p = db.prepare('select * from products where id=?').get(i.id), c = +i.c, q = Math.floor(+i.q);
      if (!p || !CARATS.includes(c) || !(q >= 1 && q <= 20)) return res.status(400).json({ error: 'Invalid item in cart.' });
      total += price(p.price_per_carat, c) * q; lines.push({ name: p.name, c, q });
    }
    const id = 'LL' + Date.now().toString().slice(-8); let rid = null;
    if (rzp) rid = (await rzp.orders.create({ amount: total * 100, currency: 'INR', receipt: id })).id;
    db.prepare('insert into orders(id,user_id,total,addr,items,rzp_order_id,created) values(?,?,?,?,?,?,?)')
      .run(id, req.user.id, total, JSON.stringify(addr), JSON.stringify(lines), rid, Date.now());
    res.json({ orderId: id, total, demo: !rzp, rzp: rzp ? { key: RZP_KEY_ID, orderId: rid, amount: total * 100 } : null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not start payment.' }) }
});

// Confirms payment: checks Razorpay's signature (HMAC SHA256) before marking the order paid.
app.post('/api/verify', auth, (req, res) => {
  const { orderId, paymentId, signature } = req.body || {}, o = db.prepare('select * from orders where id=? and user_id=?').get(orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  let pid = 'demo_' + Date.now();
  if (rzp) {
    const exp = crypto.createHmac('sha256', RZP_KEY_SECRET).update(o.rzp_order_id + '|' + paymentId).digest('hex');
    if (exp !== signature) return res.status(400).json({ error: 'Payment verification failed.' });
    pid = paymentId;
  }
  db.prepare("update orders set status='Confirmed', pay_id=? where id=? and status='Pending'").run(pid, orderId);
  res.json({ ok: true });
});

app.get('/api/orders', auth, (req, res) => res.json(db.prepare("select * from orders where user_id=? and status!='Pending' order by created desc").all(req.user.id)
  .map(o => ({ id: o.id, t: o.created, total: o.total, status: o.status, pay: o.pay_id, addr: JSON.parse(o.addr), items: JSON.parse(o.items) }))));

// ---------- admin (use header x-admin-key) ----------
app.get('/api/admin/orders', admin, (req, res) => res.json(db.prepare("select * from orders where status!='Pending' order by created desc").all()));
app.patch('/api/admin/orders/:id', admin, (req, res) => {
  if (!STAGES.includes(req.body.status)) return res.status(400).json({ error: 'Status must be one of: ' + STAGES.join(', ') });
  db.prepare('update orders set status=? where id=?').run(req.body.status, req.params.id); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Lustre Lapidist store running at http://localhost:${PORT}  (payments: ${rzp ? 'Razorpay' : 'DEMO mode'})`));
