const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dbPath = path.join(root, "shopverse.db");
const db = new DatabaseSync(dbPath);
const liveClients = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function initDatabase() {
  db.exec(`
    pragma foreign_keys = on;

    create table if not exists users (
      id integer primary key autoincrement,
      name text not null,
      email text not null unique,
      password_hash text not null,
      salt text not null,
      role text not null check (role in ('customer', 'shopkeeper')),
      created_at text not null
    );

    create table if not exists sessions (
      token_hash text primary key,
      user_id integer not null references users(id) on delete cascade,
      expires_at text not null,
      created_at text not null
    );

    create table if not exists stores (
      id integer primary key autoincrement,
      owner_id integer not null unique references users(id) on delete cascade,
      name text not null,
      address text not null,
      latitude real not null default 12.9716,
      longitude real not null default 77.5946,
      delivery_radius_km real not null default 3.5,
      trust_score integer not null default 82,
      created_at text not null
    );

    create table if not exists categories (
      id integer primary key autoincrement,
      name text not null unique
    );

    create table if not exists products (
      id integer primary key autoincrement,
      store_id integer not null references stores(id) on delete cascade,
      category_id integer not null references categories(id),
      name text not null,
      description text not null default '',
      price real not null check (price >= 0),
      image_tag text not null default 'ITEM',
      active integer not null default 1 check (active in (0, 1)),
      created_at text not null,
      updated_at text not null
    );

    create table if not exists inventory (
      product_id integer primary key references products(id) on delete cascade,
      stock integer not null check (stock >= 0),
      low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
      updated_at text not null
    );

    create table if not exists cart_items (
      id integer primary key autoincrement,
      customer_id integer not null references users(id) on delete cascade,
      product_id integer not null references products(id) on delete cascade,
      quantity integer not null check (quantity > 0),
      created_at text not null,
      updated_at text not null,
      unique(customer_id, product_id)
    );

    create table if not exists wishlist (
      customer_id integer not null references users(id) on delete cascade,
      product_id integer not null references products(id) on delete cascade,
      created_at text not null,
      primary key (customer_id, product_id)
    );

    create table if not exists orders (
      id integer primary key autoincrement,
      customer_id integer not null references users(id),
      store_id integer not null references stores(id),
      status text not null check (status in ('new', 'accepted', 'rejected', 'processing', 'packed', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled')),
      subtotal real not null check (subtotal >= 0),
      delivery_charge real not null check (delivery_charge >= 0),
      tax real not null check (tax >= 0),
      grand_total real not null check (grand_total >= 0),
      created_at text not null,
      updated_at text not null
    );

    create table if not exists order_items (
      id integer primary key autoincrement,
      order_id integer not null references orders(id) on delete cascade,
      product_id integer not null references products(id),
      quantity integer not null check (quantity > 0),
      unit_price real not null check (unit_price >= 0)
    );

    create table if not exists reviews (
      id integer primary key autoincrement,
      customer_id integer not null references users(id) on delete cascade,
      product_id integer not null references products(id) on delete cascade,
      rating integer not null check (rating between 1 and 5),
      comment text not null default '',
      created_at text not null
    );

    create table if not exists notifications (
      id integer primary key autoincrement,
      user_id integer not null references users(id) on delete cascade,
      title text not null,
      body text not null,
      read_at text,
      created_at text not null
    );
  `);

  const categories = [
    "Electronics",
    "Groceries",
    "Fashion",
    "Books",
    "Stationery",
    "Home Appliances",
    "Sports",
    "Beauty Products",
    "Mobile Accessories"
  ];
  const insertCategory = db.prepare("insert or ignore into categories (name) values (?)");
  categories.forEach((category) => insertCategory.run(category));

  const productCount = db.prepare("select count(*) as total from products").get().total;
  if (productCount > 0) return;

  const seedPassword = hashPassword(crypto.randomBytes(24).toString("hex"));
  const owner = db
    .prepare("insert into users (name, email, password_hash, salt, role, created_at) values (?, ?, ?, ?, 'shopkeeper', ?)")
    .run("Marketplace Seed Merchant", `seed-${Date.now()}@shopverse.local`, seedPassword.hash, seedPassword.salt, now());
  const store = db
    .prepare("insert into stores (owner_id, name, address, trust_score, created_at) values (?, ?, ?, ?, ?)")
    .run(owner.lastInsertRowid, "ShopVerse Central Demo Store", "MG Road Local Market, Bengaluru", 91, now());

  const seededProducts = [
    ["Electronics", "Coding Laptop i5 16GB", "Reliable laptop for coding, college, and office work.", 48990, "LAP", 8],
    ["Electronics", "Wireless Keyboard", "Compact Bluetooth keyboard with long battery life.", 1199, "KEY", 18],
    ["Electronics", "Gaming Mouse 3200 DPI", "Responsive wired gaming mouse under Rs. 1000.", 899, "MSE", 24],
    ["Groceries", "Amul Taaza Milk 1L", "Fresh toned milk pouch.", 64, "MILK", 60],
    ["Groceries", "Sona Masoori Rice 1kg", "Daily-use rice with clean grains.", 78, "RICE", 50],
    ["Groceries", "Sunflower Cooking Oil 1L", "Refined sunflower oil for everyday cooking.", 178, "OIL", 22],
    ["Groceries", "Fresh Tomatoes 1kg", "Market-fresh tomatoes with dynamic pricing.", 42, "TOM", 30],
    ["Fashion", "Cotton T-Shirt", "Breathable regular-fit cotton tee.", 399, "TEE", 35],
    ["Fashion", "Canvas Sneakers", "Comfortable casual sneakers for daily wear.", 1299, "SHOE", 12],
    ["Books", "Atomic Habits Paperback", "Popular self-improvement book.", 420, "BOOK", 16],
    ["Books", "Class 10 Science Guide", "Exam-focused science reference guide.", 310, "GUIDE", 20],
    ["Stationery", "A4 Notebook Pack", "Five notebooks for school and office use.", 120, "A4", 45],
    ["Stationery", "Gel Pen Set", "Smooth writing assorted pen set.", 85, "PEN", 55],
    ["Home Appliances", "Electric Kettle 1.5L", "Fast-boil stainless steel kettle.", 899, "KTL", 14],
    ["Home Appliances", "LED Desk Lamp", "Adjustable lamp with three brightness modes.", 699, "LAMP", 19],
    ["Sports", "Yoga Mat 6mm", "Anti-slip exercise and yoga mat.", 549, "YOGA", 18],
    ["Sports", "Cricket Tennis Ball Pack", "Pack of six practice balls.", 180, "BALL", 40],
    ["Beauty Products", "Aloe Vera Face Wash", "Gentle face wash for daily skincare.", 145, "FACE", 25],
    ["Beauty Products", "Herbal Shampoo 180ml", "Mild herbal shampoo.", 165, "SHAM", 28],
    ["Mobile Accessories", "Type-C Fast Charger", "20W fast charger with cable.", 699, "USB", 22],
    ["Mobile Accessories", "Tempered Glass Guard", "Scratch-resistant mobile screen guard.", 149, "GLASS", 70],
    ["Mobile Accessories", "Wireless Earbuds", "Compact earbuds with charging case.", 1499, "BUDS", 11]
  ];

  const categoryId = db.prepare("select id from categories where name = ?");
  const insertProduct = db.prepare(`
    insert into products (store_id, category_id, name, description, price, image_tag, active, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertInventory = db.prepare("insert into inventory (product_id, stock, low_stock_threshold, updated_at) values (?, ?, ?, ?)");

  seededProducts.forEach(([category, name, description, price, imageTag, stock]) => {
    const product = insertProduct.run(store.lastInsertRowid, categoryId.get(category).id, name, description, price, imageTag, now(), now());
    insertInventory.run(product.lastInsertRowid, stock, Math.min(8, Math.max(3, Math.floor(stock / 4))), now());
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function getAuthUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return db
    .prepare(
      `select users.* from sessions
       join users on users.id = sessions.user_id
       where sessions.token_hash = ? and sessions.expires_at > ?`
    )
    .get(tokenHash(token), now());
}

function requireAuth(req, res, role) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(res, 403, { error: "You do not have permission for this action." });
    return null;
  }
  return user;
}

function productRows(where = "", params = []) {
  return db
    .prepare(
      `select products.id, products.name, products.description, products.price, products.image_tag as imageTag,
              products.active, products.store_id as storeId, stores.name as storeName, stores.address,
              categories.name as category, inventory.stock, inventory.low_stock_threshold as lowStockThreshold
       from products
       join inventory on inventory.product_id = products.id
       join stores on stores.id = products.store_id
       join categories on categories.id = products.category_id
       ${where}
       order by products.updated_at desc, products.id desc`
    )
    .all(...params);
}

function cartSummary(customerId) {
  const items = db
    .prepare(
      `select cart_items.id as cartItemId, cart_items.quantity, products.id as productId, products.name,
              products.price, products.image_tag as imageTag, inventory.stock, stores.id as storeId,
              stores.name as storeName, categories.name as category
       from cart_items
       join products on products.id = cart_items.product_id
       join inventory on inventory.product_id = products.id
       join stores on stores.id = products.store_id
       join categories on categories.id = products.category_id
       where cart_items.customer_id = ? and products.active = 1
       order by cart_items.updated_at desc`
    )
    .all(customerId);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCharge = items.length ? 35 : 0;
  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  return {
    items,
    totals: {
      subtotal,
      deliveryCharge,
      tax,
      grandTotal: Math.round((subtotal + deliveryCharge + tax) * 100) / 100
    }
  };
}

function createNotification(userId, title, body) {
  db.prepare("insert into notifications (user_id, title, body, created_at) values (?, ?, ?, ?)").run(userId, title, body, now());
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  liveClients.forEach((client) => {
    if (!event.userId && !event.role) client.res.write(data);
    else if (event.userId === client.user.id || event.role === client.user.role) client.res.write(data);
  });
}

function storeForOwner(ownerId) {
  return db.prepare("select * from stores where owner_id = ?").get(ownerId);
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "shopkeeper" ? "shopkeeper" : "customer";
      if (!name || !email || password.length < 6) {
        sendJson(res, 400, { error: "Name, valid email, and 6+ character password are required." });
        return;
      }
      if (db.prepare("select id from users where email = ?").get(email)) {
        sendJson(res, 409, { error: "An account with this email already exists." });
        return;
      }
      const passwordData = hashPassword(password);
      db.exec("begin");
      const user = db
        .prepare("insert into users (name, email, password_hash, salt, role, created_at) values (?, ?, ?, ?, ?, ?)")
        .run(name, email, passwordData.hash, passwordData.salt, role, now());
      if (role === "shopkeeper") {
        const storeName = String(body.storeName || `${name}'s Store`).trim();
        db.prepare("insert into stores (owner_id, name, address, created_at) values (?, ?, ?, ?)")
          .run(user.lastInsertRowid, storeName, String(body.address || "Local Market").trim(), now());
      }
      db.exec("commit");
      sendJson(res, 201, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.prepare("select * from users where email = ?").get(email);
      if (!user || hashPassword(password, user.salt).hash !== user.password_hash) {
        sendJson(res, 401, { error: "Invalid email or password." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      db.prepare("insert into sessions (token_hash, user_id, expires_at, created_at) values (?, ?, ?, ?)")
        .run(tokenHash(token), user.id, new Date(Date.now() + 7 * 86400000).toISOString(), now());
      sendJson(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const user = requireAuth(req, res);
      if (!user) return;
      sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role }, store: storeForOwner(user.id) || null });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const token = url.searchParams.get("token");
      const fakeReq = { headers: { authorization: token ? `Bearer ${token}` : "" } };
      const user = getAuthUser(fakeReq);
      if (!user) {
        res.writeHead(401);
        res.end("Authentication required");
        return;
      }
      const id = crypto.randomUUID();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      liveClients.set(id, { res, user });
      res.write(`data: ${JSON.stringify({ type: "connected", at: now() })}\n\n`);
      req.on("close", () => liveClients.delete(id));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/categories") {
      sendJson(res, 200, { categories: db.prepare("select * from categories order by name").all() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      const search = `%${(url.searchParams.get("search") || "").trim()}%`;
      const category = url.searchParams.get("category") || "";
      const params = [];
      let where = "where products.active = 1";
      if (url.searchParams.get("search")) {
        where += " and (products.name like ? or products.description like ? or categories.name like ? or stores.name like ?)";
        params.push(search, search, search, search);
      }
      if (category) {
        where += " and categories.name = ?";
        params.push(category);
      }
      sendJson(res, 200, { products: productRows(where, params) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/shopkeeper/products") {
      const user = requireAuth(req, res, "shopkeeper");
      if (!user) return;
      const store = storeForOwner(user.id);
      sendJson(res, 200, { products: productRows("where products.store_id = ?", [store.id]), store });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const user = requireAuth(req, res, "shopkeeper");
      if (!user) return;
      const body = await readJson(req);
      const store = storeForOwner(user.id);
      const category = db.prepare("select id from categories where name = ?").get(body.category);
      if (!store || !category || !body.name || Number(body.price) < 0 || Number(body.stock) < 0) {
        sendJson(res, 400, { error: "Valid product name, category, price, and stock are required." });
        return;
      }
      db.exec("begin");
      const product = db
        .prepare(
          `insert into products (store_id, category_id, name, description, price, image_tag, active, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(store.id, category.id, String(body.name).trim(), String(body.description || ""), Number(body.price), String(body.imageTag || "ITEM").slice(0, 8).toUpperCase(), now(), now());
      db.prepare("insert into inventory (product_id, stock, low_stock_threshold, updated_at) values (?, ?, ?, ?)")
        .run(product.lastInsertRowid, Number(body.stock), Number(body.lowStockThreshold || 5), now());
      db.exec("commit");
      broadcast({ type: "products", role: "customer" });
      broadcast({ type: "products", userId: user.id });
      sendJson(res, 201, { ok: true, id: product.lastInsertRowid });
      return;
    }

    const productMatch = url.pathname.match(/^\/api\/products\/(\d+)$/);
    if (productMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const user = requireAuth(req, res, "shopkeeper");
      if (!user) return;
      const store = storeForOwner(user.id);
      const productId = Number(productMatch[1]);
      const product = db.prepare("select * from products where id = ? and store_id = ?").get(productId, store.id);
      if (!product) {
        sendJson(res, 404, { error: "Product not found." });
        return;
      }
      if (req.method === "DELETE") {
        db.prepare("update products set active = 0, updated_at = ? where id = ?").run(now(), productId);
      } else {
        const body = await readJson(req);
        const category = db.prepare("select id from categories where name = ?").get(body.category);
        if (!category || !body.name || Number(body.price) < 0 || Number(body.stock) < 0) {
          sendJson(res, 400, { error: "Valid product name, category, price, and stock are required." });
          return;
        }
        db.prepare("update products set category_id = ?, name = ?, description = ?, price = ?, image_tag = ?, active = 1, updated_at = ? where id = ?")
          .run(category.id, String(body.name).trim(), String(body.description || ""), Number(body.price), String(body.imageTag || "ITEM").slice(0, 8).toUpperCase(), now(), productId);
        db.prepare("update inventory set stock = ?, low_stock_threshold = ?, updated_at = ? where product_id = ?")
          .run(Number(body.stock), Number(body.lowStockThreshold || 5), now(), productId);
      }
      broadcast({ type: "products" });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/cart") {
      const user = requireAuth(req, res, "customer");
      if (!user) return;
      if (req.method === "GET") {
        sendJson(res, 200, cartSummary(user.id));
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const product = db.prepare("select products.id, inventory.stock from products join inventory on inventory.product_id = products.id where products.id = ? and products.active = 1").get(Number(body.productId));
        if (!product || product.stock <= 0) {
          sendJson(res, 400, { error: "Product is out of stock." });
          return;
        }
        db.prepare(
          `insert into cart_items (customer_id, product_id, quantity, created_at, updated_at)
           values (?, ?, 1, ?, ?)
           on conflict(customer_id, product_id) do update set quantity = quantity + 1, updated_at = excluded.updated_at`
        ).run(user.id, product.id, now(), now());
        sendJson(res, 200, cartSummary(user.id));
        return;
      }
      if (req.method === "DELETE") {
        db.prepare("delete from cart_items where customer_id = ?").run(user.id);
        sendJson(res, 200, cartSummary(user.id));
        return;
      }
    }

    if (url.pathname === "/api/wishlist") {
      const user = requireAuth(req, res, "customer");
      if (!user) return;
      if (req.method === "GET") {
        const items = db
          .prepare(
            `select wishlist.product_id as productId, products.name, products.price, products.image_tag as imageTag,
                    stores.name as storeName, categories.name as category
             from wishlist
             join products on products.id = wishlist.product_id
             join stores on stores.id = products.store_id
             join categories on categories.id = products.category_id
             where wishlist.customer_id = ? and products.active = 1
             order by wishlist.created_at desc`
          )
          .all(user.id);
        sendJson(res, 200, { items });
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const product = db.prepare("select id from products where id = ? and active = 1").get(Number(body.productId));
        if (!product) {
          sendJson(res, 404, { error: "Product not found." });
          return;
        }
        db.prepare("insert or ignore into wishlist (customer_id, product_id, created_at) values (?, ?, ?)")
          .run(user.id, product.id, now());
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    const wishlistMatch = url.pathname.match(/^\/api\/wishlist\/(\d+)$/);
    if (wishlistMatch && req.method === "DELETE") {
      const user = requireAuth(req, res, "customer");
      if (!user) return;
      db.prepare("delete from wishlist where customer_id = ? and product_id = ?").run(user.id, Number(wishlistMatch[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    const cartMatch = url.pathname.match(/^\/api\/cart\/(\d+)$/);
    if (cartMatch && (req.method === "PATCH" || req.method === "DELETE")) {
      const user = requireAuth(req, res, "customer");
      if (!user) return;
      const cartItemId = Number(cartMatch[1]);
      if (req.method === "DELETE") {
        db.prepare("delete from cart_items where id = ? and customer_id = ?").run(cartItemId, user.id);
      } else {
        const body = await readJson(req);
        const quantity = Number(body.quantity);
        if (quantity <= 0) db.prepare("delete from cart_items where id = ? and customer_id = ?").run(cartItemId, user.id);
        else db.prepare("update cart_items set quantity = ?, updated_at = ? where id = ? and customer_id = ?").run(quantity, now(), cartItemId, user.id);
      }
      sendJson(res, 200, cartSummary(user.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const user = requireAuth(req, res, "customer");
      if (!user) return;
      const cart = cartSummary(user.id);
      if (!cart.items.length) {
        sendJson(res, 400, { error: "Cart is empty." });
        return;
      }
      for (const item of cart.items) {
        if (item.quantity > item.stock) {
          sendJson(res, 400, { error: `${item.name} has only ${item.stock} units left.` });
          return;
        }
      }

      db.exec("begin");
      const ordersByStore = new Map();
      for (const item of cart.items) {
        if (!ordersByStore.has(item.storeId)) ordersByStore.set(item.storeId, []);
        ordersByStore.get(item.storeId).push(item);
      }
      const orderIds = [];
      for (const [storeId, items] of ordersByStore.entries()) {
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const deliveryCharge = 35;
        const tax = Math.round(subtotal * 0.05 * 100) / 100;
        const grandTotal = Math.round((subtotal + deliveryCharge + tax) * 100) / 100;
        const order = db.prepare(
          `insert into orders (customer_id, store_id, status, subtotal, delivery_charge, tax, grand_total, created_at, updated_at)
           values (?, ?, 'new', ?, ?, ?, ?, ?, ?)`
        ).run(user.id, storeId, subtotal, deliveryCharge, tax, grandTotal, now(), now());
        orderIds.push(order.lastInsertRowid);
        for (const item of items) {
          db.prepare("insert into order_items (order_id, product_id, quantity, unit_price) values (?, ?, ?, ?)")
            .run(order.lastInsertRowid, item.productId, item.quantity, item.price);
          db.prepare("update inventory set stock = stock - ?, updated_at = ? where product_id = ?")
            .run(item.quantity, now(), item.productId);
          const updatedInventory = db
            .prepare(
              `select inventory.stock, inventory.low_stock_threshold, products.name, stores.owner_id
               from inventory
               join products on products.id = inventory.product_id
               join stores on stores.id = products.store_id
               where inventory.product_id = ?`
            )
            .get(item.productId);
          if (updatedInventory.stock <= updatedInventory.low_stock_threshold) {
            createNotification(updatedInventory.owner_id, "Low stock warning", `${updatedInventory.name} has ${updatedInventory.stock} units left.`);
            broadcast({ type: "notifications", userId: updatedInventory.owner_id });
          }
        }
        const owner = db.prepare("select owner_id from stores where id = ?").get(storeId);
        createNotification(owner.owner_id, "New order received", `Order #${order.lastInsertRowid} is waiting for action.`);
        broadcast({ type: "orders", userId: owner.owner_id });
      }
      db.prepare("delete from cart_items where customer_id = ?").run(user.id);
      createNotification(user.id, "Order placed", `Your order${orderIds.length > 1 ? "s are" : " is"} now live.`);
      db.exec("commit");
      broadcast({ type: "products" });
      broadcast({ type: "cart", userId: user.id });
      broadcast({ type: "orders", userId: user.id });
      broadcast({ type: "notifications", userId: user.id });
      sendJson(res, 201, { ok: true, orderIds });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      const user = requireAuth(req, res);
      if (!user) return;
      const where =
        user.role === "customer"
          ? "where orders.customer_id = ?"
          : "join stores owned_store on owned_store.id = orders.store_id where owned_store.owner_id = ?";
      const orders = db
        .prepare(
          `select orders.*, users.name as customerName, stores.name as storeName
           from orders
           join users on users.id = orders.customer_id
           join stores on stores.id = orders.store_id
           ${where}
           order by orders.updated_at desc`
        )
        .all(user.id);
      const itemStatement = db.prepare(
        `select order_items.*, products.name
         from order_items join products on products.id = order_items.product_id
         where order_items.order_id = ?`
      );
      sendJson(res, 200, { orders: orders.map((order) => ({ ...order, items: itemStatement.all(order.id) })) });
      return;
    }

    const orderStatusMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/status$/);
    if (orderStatusMatch && req.method === "PATCH") {
      const user = requireAuth(req, res);
      if (!user) return;
      const orderId = Number(orderStatusMatch[1]);
      const body = await readJson(req);
      const status = String(body.status || "");
      const order = db.prepare("select * from orders where id = ?").get(orderId);
      if (!order) {
        sendJson(res, 404, { error: "Order not found." });
        return;
      }
      if (user.role === "customer") {
        if (order.customer_id !== user.id || order.status !== "new" || status !== "cancelled") {
          sendJson(res, 403, { error: "Orders can only be cancelled before shopkeeper acceptance." });
          return;
        }
      } else {
        const store = storeForOwner(user.id);
        if (!store || order.store_id !== store.id) {
          sendJson(res, 403, { error: "This order belongs to another store." });
          return;
        }
        if (!["accepted", "rejected", "processing", "packed", "ready_for_pickup", "out_for_delivery", "delivered"].includes(status)) {
          sendJson(res, 400, { error: "Invalid status update." });
          return;
        }
      }
      db.prepare("update orders set status = ?, updated_at = ? where id = ?").run(status, now(), orderId);
      const owner = db.prepare("select owner_id from stores where id = ?").get(order.store_id);
      const label = status.replaceAll("_", " ");
      createNotification(order.customer_id, `Order #${orderId} ${label}`, `Your order status changed to ${label}.`);
      if (status === "cancelled") createNotification(owner.owner_id, "Order cancelled", `Customer cancelled order #${orderId}.`);
      broadcast({ type: "orders", userId: order.customer_id });
      broadcast({ type: "notifications", userId: order.customer_id });
      broadcast({ type: "orders", userId: owner.owner_id });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/notifications") {
      const user = requireAuth(req, res);
      if (!user) return;
      sendJson(res, 200, {
        notifications: db.prepare("select * from notifications where user_id = ? order by created_at desc limit 20").all(user.id)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/shopkeeper/analytics") {
      const user = requireAuth(req, res, "shopkeeper");
      if (!user) return;
      const store = storeForOwner(user.id);
      const summary = db
        .prepare(
          `select count(*) as orderCount, coalesce(sum(grand_total), 0) as revenue
           from orders where store_id = ? and status != 'rejected' and status != 'cancelled'`
        )
        .get(store.id);
      const lowStock = db
        .prepare(
          `select products.name, inventory.stock from inventory
           join products on products.id = inventory.product_id
           where products.store_id = ? and products.active = 1 and inventory.stock <= inventory.low_stock_threshold`
        )
        .all(store.id);
      sendJson(res, 200, { store, summary, lowStock });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/assistant") {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readJson(req);
      const prompt = String(body.message || "").trim();
      if (!prompt) {
        sendJson(res, 400, { error: "Ask the assistant a question." });
        return;
      }

      const lower = prompt.toLowerCase();
      const budgetMatch = lower.match(/(?:under|below|less than|budget|rs\.?|inr)\s*(?:rs\.?|inr)?\s*([0-9,]+)/i);
      const budget = budgetMatch ? Number(budgetMatch[1].replace(/,/g, "")) : null;

      if (user.role === "customer") {
        const allProducts = productRows("where products.active = 1 and inventory.stock > 0");
        const words = lower
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 2 && !["under", "below", "near", "need", "find", "want", "with", "for", "and", "the"].includes(word));
        const scored = allProducts
          .map((product) => {
            const text = `${product.name} ${product.description} ${product.category} ${product.storeName}`.toLowerCase();
            let score = words.reduce((sum, word) => sum + (text.includes(word) ? 3 : 0), 0);
            if (budget && product.price <= budget) score += 2;
            if (lower.includes("cheap") || lower.includes("cheapest")) score += Math.max(0, 4 - product.price / 500);
            if (lower.includes("grocery") || lower.includes("groceries")) score += product.category === "Groceries" ? 4 : 0;
            if (lower.includes("laptop") || lower.includes("coding")) score += product.name.toLowerCase().includes("laptop") ? 8 : 0;
            return { ...product, score };
          })
          .filter((product) => product.score > 0 || !words.length)
          .sort((a, b) => b.score - a.score || a.price - b.price)
          .slice(0, 5);

        const fallback = scored.length ? scored : allProducts.slice(0, 5);
        const total = fallback.reduce((sum, product) => sum + product.price, 0);
        const names = fallback.map((product) => product.name).join(", ");
        const budgetLine = budget
          ? total <= budget
            ? `The suggested set is within your ${budget.toLocaleString("en-IN")} budget.`
            : `The full set is ${Math.round(total - budget).toLocaleString("en-IN")} above your budget, so add selectively.`
          : "You can add these directly to your cart.";
        sendJson(res, 200, {
          role: "customer",
          reply: `I found ${fallback.length} live product option${fallback.length === 1 ? "" : "s"}: ${names}. Estimated total ${Math.round(total).toLocaleString("en-IN")}. ${budgetLine}`,
          products: fallback,
          actions: fallback.length ? [{ type: "add_products_to_cart", label: "Add suggested items", productIds: fallback.map((product) => product.id) }] : []
        });
        return;
      }

      const store = storeForOwner(user.id);
      const summary = db
        .prepare(
          `select count(*) as orderCount, coalesce(sum(grand_total), 0) as revenue
           from orders where store_id = ? and status != 'rejected' and status != 'cancelled'`
        )
        .get(store.id);
      const lowStock = db
        .prepare(
          `select products.id, products.name, inventory.stock, inventory.low_stock_threshold as lowStockThreshold
           from inventory
           join products on products.id = inventory.product_id
           where products.store_id = ? and products.active = 1 and inventory.stock <= inventory.low_stock_threshold
           order by inventory.stock asc`
        )
        .all(store.id);
      const pendingOrders = db
        .prepare("select count(*) as total from orders where store_id = ? and status = 'new'")
        .get(store.id).total;
      const topProducts = db
        .prepare(
          `select products.name, coalesce(sum(order_items.quantity), 0) as units
           from products
           left join order_items on order_items.product_id = products.id
           where products.store_id = ? and products.active = 1
           group by products.id
           order by units desc, products.updated_at desc
           limit 4`
        )
        .all(store.id);
      const lowStockLine = lowStock.length
        ? `Low stock: ${lowStock.map((item) => `${item.name} (${item.stock})`).join(", ")}.`
        : "No low-stock products right now.";
      const topLine = topProducts.length ? `Top products: ${topProducts.map((item) => `${item.name} (${item.units} sold)`).join(", ")}.` : "";
      sendJson(res, 200, {
        role: "shopkeeper",
        reply: `Store pulse for ${store.name}: ${summary.orderCount} active orders worth ${Math.round(summary.revenue).toLocaleString("en-IN")}, ${pendingOrders} new order${pendingOrders === 1 ? "" : "s"} waiting. ${lowStockLine} ${topLine}`,
        products: [],
        actions: pendingOrders ? [{ type: "review_orders", label: "Review new orders" }] : []
      });
      return;
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    try {
      db.exec("rollback");
    } catch (_) {}
    sendJson(res, 500, { error: error.message || "Server error." });
  }
}

function serveStatic(req, res, url) {
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = cleanPath === "" ? "index.html" : cleanPath;
  const filePath = path.normalize(path.join(root, target));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

initDatabase();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`ShopVerse AI running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
