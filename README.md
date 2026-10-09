# ShopVerse AI

ShopVerse AI is a database-backed hyperlocal marketplace that connects customers with local shopkeepers through live products, persistent carts, real orders, inventory updates, and notifications.

## Run

```powershell
npm start
```

Open `http://localhost:4173`.

The app creates and uses `shopverse.db` locally with SQLite. Register a customer or shopkeeper account from the first screen; newly registered users can log in immediately.

## Implemented

- Clean login and registration for Customer and Shopkeeper roles
- Role-based redirects into separate dashboards with no dashboard role-switching tabs
- SQLite database tables with foreign keys for users, sessions, stores, categories, products, inventory, cart, wishlist, orders, order items, reviews, and notifications
- Product flow: shopkeeper add/update/delete syncs to customer marketplace through API and live events
- Customer marketplace from database products across electronics, groceries, fashion, books, stationery, home appliances, sports, beauty, and mobile accessories
- Advanced persistent cart with add, remove, quantity changes, subtotal, delivery, tax, grand total, and empty cart
- Real order flow: place, cancel before acceptance, accept, reject, processing, packed, ready for pickup, out for delivery, delivered
- Inventory decreases on order placement; out-of-stock products disable purchase; low-stock notifications are created
- Server-sent live events for products, cart, orders, and notifications
- Shopkeeper analytics, low-stock alerts, sales reports, customer order insights
- Floating AI chat assistant backed by live database context for product discovery, cart suggestions, order guidance, revenue, and low-stock insights

## Judge Flow

1. Register or log in as a shopkeeper.
2. Add a product in Product Management.
3. Register or log in as a customer in another browser/session.
4. Search for the product, add it to cart, and place an order.
5. Return to the shopkeeper dashboard; the order appears live.
6. Accept the order, then mark it delivered.
7. The customer order status updates live.
