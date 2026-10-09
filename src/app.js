const state = {
  authMode: "login",
  token: localStorage.getItem("shopverse_token") || "",
  user: null,
  store: null,
  categories: [],
  products: [],
  cart: { items: [], totals: { subtotal: 0, deliveryCharge: 0, tax: 0, grandTotal: 0 } },
  customerOrders: [],
  shopOrders: [],
  shopProducts: [],
  wishlist: [],
  notifications: [],
  analytics: null,
  events: null,
  assistantActions: []
};

const statusLabels = {
  new: "New",
  accepted: "Accepted",
  rejected: "Rejected",
  processing: "Processing",
  packed: "Packed",
  ready_for_pickup: "Ready for Pickup",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled"
};

const shopkeeperStatuses = ["accepted", "rejected", "processing", "packed", "ready_for_pickup", "out_for_delivery", "delivered"];

function qs(id) {
  return document.getElementById(id);
}

function money(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function toast(message) {
  const toastNode = qs("toast");
  toastNode.textContent = message;
  toastNode.classList.add("show");
  window.setTimeout(() => toastNode.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.body.classList.toggle("auth-register", mode === "register");
  qs("authEyebrow").textContent = mode === "login" ? "Welcome back" : "Create account";
  qs("authTitle").textContent = mode === "login" ? "Login to ShopVerse" : "Register for ShopVerse";
  qs("authSubtitle").textContent =
    mode === "login" ? "Access your customer or shopkeeper dashboard." : "Create a customer account or register a store.";
  qs("authSubmit").textContent = mode === "login" ? "Login" : "Register and Continue";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
}

function selectedRole() {
  return document.querySelector("input[name='role']:checked").value;
}

function syncRoleClass() {
  document.body.classList.toggle("role-shopkeeper", selectedRole() === "shopkeeper");
}

function showAuthError(message) {
  qs("authMessage").textContent = message;
}

async function handleAuth(event) {
  event.preventDefault();
  showAuthError("");
  const role = selectedRole();
  const email = qs("emailInput").value.trim();
  const password = qs("passwordInput").value;

  try {
    if (state.authMode === "register") {
      await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          role,
          email,
          password,
          name: qs("nameInput").value.trim(),
          storeName: qs("storeNameInput").value.trim(),
          address: qs("storeAddressInput").value.trim()
        })
      });
      toast("Registration complete. Logging you in now.");
    }

    const session = await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    state.token = session.token;
    state.user = session.user;
    localStorage.setItem("shopverse_token", state.token);
    await hydrateSession();
  } catch (error) {
    showAuthError(error.message);
  }
}

async function hydrateSession() {
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.store = me.store;
    document.body.classList.remove("customer-authenticated", "shopkeeper-authenticated");
    document.body.classList.add(`${state.user.role}-authenticated`);
    qs(`${state.user.role}Session`).textContent = `${state.user.name} • ${state.user.email}`;
    await loadSharedData();
    if (state.user.role === "customer") await loadCustomerData();
    if (state.user.role === "shopkeeper") await loadShopkeeperData();
    connectLiveEvents();
  } catch (error) {
    logout(false);
  }
}

function logout(showMessage = true) {
  localStorage.removeItem("shopverse_token");
  state.token = "";
  state.user = null;
  state.store = null;
  if (state.events) state.events.close();
  state.events = null;
  qs("aiPanel").classList.remove("open");
  document.body.classList.remove("customer-authenticated", "shopkeeper-authenticated");
  if (showMessage) toast("Logged out.");
}

async function loadSharedData() {
  const categories = await api("/api/categories");
  state.categories = categories.categories;
  renderCategorySelects();
}

function renderCategorySelects() {
  const options = [`<option value="">All categories</option>`].concat(state.categories.map((category) => `<option value="${category.name}">${category.name}</option>`));
  qs("categoryFilter").innerHTML = options.join("");
  qs("productCategoryInput").innerHTML = state.categories.map((category) => `<option value="${category.name}">${category.name}</option>`).join("");
}

function connectLiveEvents() {
  if (state.events) state.events.close();
  state.events = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  state.events.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "connected") return;
    if (state.user.role === "customer") {
      if (["products", "cart", "orders", "notifications"].includes(event.type)) await loadCustomerData({ quiet: true });
    }
    if (state.user.role === "shopkeeper") {
      if (["products", "orders", "notifications"].includes(event.type)) await loadShopkeeperData({ quiet: true });
    }
  };
  state.events.onerror = () => {
    qs("liveBadge").textContent = "Reconnecting";
  };
}

function showSkeleton() {
  qs("productSkeleton").classList.remove("hidden");
  qs("productSkeleton").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
}

async function loadCustomerData({ quiet = false } = {}) {
  if (!quiet) showSkeleton();
  const search = qs("productSearch").value.trim();
  const category = qs("categoryFilter").value;
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (category) query.set("category", category);
  const [products, cart, orders, notifications, wishlist] = await Promise.all([
    api(`/api/products?${query.toString()}`),
    api("/api/cart"),
    api("/api/orders"),
    api("/api/notifications"),
    api("/api/wishlist")
  ]);
  state.products = products.products;
  state.cart = cart;
  state.customerOrders = orders.orders;
  state.notifications = notifications.notifications;
  state.wishlist = wishlist.items;
  renderProducts();
  renderCart();
  renderCustomerOrders();
  renderNotifications("customerNotifications");
  renderProfile();
  updateAssistantContext();
  qs("productSkeleton").classList.add("hidden");
  qs("liveBadge").textContent = "Connected";
}

function renderProducts() {
  qs("productStatus").textContent = `${state.products.length} database product${state.products.length === 1 ? "" : "s"} available`;
  if (!state.products.length) {
    qs("productGrid").innerHTML = `<div class="empty-state">No products found. Try another search or category.</div>`;
    return;
  }
  qs("productGrid").innerHTML = state.products
    .map((product) => {
      const out = product.stock <= 0;
      return `
        <article class="product-card">
          <div class="product-visual"><span>${product.imageTag}</span></div>
          <div class="product-body">
            <div class="product-title">
              <strong>${product.name}</strong>
              <span class="price">${money(product.price)}</span>
            </div>
            <p>${product.description}</p>
            <div class="product-meta">
              <span>${product.category}</span>
              <span>${product.storeName}</span>
              <span>${out ? "Out of Stock" : `${product.stock} in stock`}</span>
              <span>${product.address}</span>
            </div>
            <div class="product-actions">
              <button class="primary-button" type="button" data-cart-add="${product.id}" ${out ? "disabled" : ""}>${out ? "Out of Stock" : "Add to Cart"}</button>
              <button class="secondary-button" type="button" data-wishlist="${product.id}">Wishlist</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCart() {
  qs("cartItems").innerHTML = state.cart.items.length
    ? state.cart.items
        .map(
          (item) => `
          <div class="cart-line">
            <div>
              <strong>${item.name}</strong>
              <div>${money(item.price)} • ${item.storeName}</div>
            </div>
            <div class="cart-controls">
              <button type="button" data-cart-qty="${item.cartItemId}" data-qty="${item.quantity - 1}">-</button>
              <strong>${item.quantity}</strong>
              <button type="button" data-cart-qty="${item.cartItemId}" data-qty="${item.quantity + 1}" ${item.quantity >= item.stock ? "disabled" : ""}>+</button>
              <button type="button" data-cart-remove="${item.cartItemId}">x</button>
            </div>
          </div>
        `
        )
        .join("")
    : `<div class="empty-state">Your cart is empty.</div>`;

  const totals = state.cart.totals;
  qs("cartTotals").innerHTML = `
    <div class="total-row"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
    <div class="total-row"><span>Delivery</span><strong>${money(totals.deliveryCharge)}</strong></div>
    <div class="total-row"><span>Tax</span><strong>${money(totals.tax)}</strong></div>
    <div class="total-row grand"><span>Grand Total</span><strong>${money(totals.grandTotal)}</strong></div>
  `;
}

function renderCustomerOrders() {
  const render = (orders, compact = false) =>
    orders.length
      ? orders
          .map(
            (order) => `
          <article class="order-card">
            <div class="panel-top">
              <strong>Order #${order.id} • ${order.storeName}</strong>
              <span class="status ${["rejected", "cancelled"].includes(order.status) ? "danger" : order.status === "new" ? "warn" : ""}">${statusLabels[order.status]}</span>
            </div>
            <p>${order.items.map((item) => `${item.quantity} x ${item.name}`).join(", ")}</p>
            <strong>${money(order.grand_total)}</strong>
            ${
              !compact && order.status === "new"
                ? `<div class="order-actions"><button class="danger-button" type="button" data-cancel-order="${order.id}">Cancel Order</button></div>`
                : ""
            }
          </article>
        `
          )
          .join("")
      : `<div class="empty-state">No orders yet.</div>`;

  qs("customerOrders").innerHTML = render(state.customerOrders);
  qs("liveOrders").innerHTML = render(state.customerOrders.slice(0, 3), true);
}

function renderNotifications(targetId) {
  qs(targetId).innerHTML = state.notifications.length
    ? state.notifications
        .map(
          (notification) => `
          <article class="notification-card">
            <strong>${notification.title}</strong>
            <p>${notification.body}</p>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No notifications yet.</div>`;
}

function renderProfile() {
  qs("customerProfile").innerHTML = `
    <article class="profile-card"><strong>Name</strong><p>${state.user.name}</p></article>
    <article class="profile-card"><strong>Email</strong><p>${state.user.email}</p></article>
    <article class="profile-card"><strong>Role</strong><p>${state.user.role}</p></article>
    <article class="profile-card"><strong>Wishlist</strong><p>${state.wishlist.length} saved product${state.wishlist.length === 1 ? "" : "s"}</p></article>
  `;
}

function addAssistantMessage(content, type = "assistant", products = []) {
  const messages = qs("assistantMessages");
  const node = document.createElement("div");
  node.className = `assistant-message ${type}`.trim();
  const productHtml = products.length
    ? `<div class="assistant-products">${products
        .map((product) => `<span><strong>${product.name}</strong><em>${money(product.price)}</em></span>`)
        .join("")}</div>`
    : "";
  node.innerHTML = `<div>${content}</div>${productHtml}`;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

function renderAssistantActions(actions = []) {
  state.assistantActions = actions;
  qs("assistantActions").innerHTML = actions
    .map((action, index) => `<button type="button" data-assistant-action="${index}">${action.label}</button>`)
    .join("");
}

function updateAssistantContext() {
  if (!state.user) return;
  qs("assistantContext").textContent =
    state.user.role === "customer"
      ? `${state.products.length} products loaded, ${state.cart.items.length} cart item${state.cart.items.length === 1 ? "" : "s"}`
      : `${state.shopProducts.length} products, ${state.shopOrders.length} order${state.shopOrders.length === 1 ? "" : "s"}`;
}

async function sendAssistantMessage(message) {
  const prompt = message.trim();
  if (!prompt) return;
  addAssistantMessage(prompt, "user");
  qs("assistantInput").value = "";
  renderAssistantActions([]);
  const loading = addAssistantMessage("Thinking with live marketplace data...", "loading");
  try {
    const response = await api("/api/assistant", { method: "POST", body: JSON.stringify({ message: prompt }) });
    loading.remove();
    addAssistantMessage(response.reply, "assistant", response.products || []);
    renderAssistantActions(response.actions || []);
  } catch (error) {
    loading.remove();
    addAssistantMessage(error.message, "assistant");
  }
}

async function runAssistantAction(index) {
  const action = state.assistantActions[index];
  if (!action) return;
  if (action.type === "add_products_to_cart") {
    for (const productId of action.productIds) {
      await api("/api/cart", { method: "POST", body: JSON.stringify({ productId }) });
    }
    await loadCustomerData({ quiet: true });
    renderAssistantActions([]);
    addAssistantMessage("Done. I added the suggested items to your cart.");
    toast("AI suggestions added to cart.");
  }
  if (action.type === "review_orders") {
    qs("shopOrders").scrollIntoView({ behavior: "smooth", block: "start" });
    renderAssistantActions([]);
    addAssistantMessage("I opened your order queue. Start with the newest orders marked New.");
  }
}

async function addToCart(productId) {
  state.cart = await api("/api/cart", { method: "POST", body: JSON.stringify({ productId }) });
  renderCart();
  toast("Added to cart.");
}

async function updateCartQuantity(cartItemId, quantity) {
  state.cart = await api(`/api/cart/${cartItemId}`, { method: "PATCH", body: JSON.stringify({ quantity }) });
  renderCart();
}

async function removeCartItem(cartItemId) {
  state.cart = await api(`/api/cart/${cartItemId}`, { method: "DELETE" });
  renderCart();
}

async function clearCart() {
  state.cart = await api("/api/cart", { method: "DELETE" });
  renderCart();
  toast("Cart cleared.");
}

async function placeOrder() {
  const result = await api("/api/orders", { method: "POST" });
  toast(`Order placed: ${result.orderIds.map((id) => `#${id}`).join(", ")}`);
  await loadCustomerData({ quiet: true });
}

async function cancelOrder(orderId) {
  await api(`/api/orders/${orderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
  toast("Order cancelled.");
  await loadCustomerData({ quiet: true });
}

async function addWishlist(productId) {
  await api("/api/wishlist", { method: "POST", body: JSON.stringify({ productId }) });
  const wishlist = await api("/api/wishlist");
  state.wishlist = wishlist.items;
  renderProfile();
  toast("Saved to wishlist.");
}

async function loadShopkeeperData() {
  const [products, orders, notifications, analytics] = await Promise.all([
    api("/api/shopkeeper/products"),
    api("/api/orders"),
    api("/api/notifications"),
    api("/api/shopkeeper/analytics")
  ]);
  state.shopProducts = products.products;
  state.store = products.store;
  state.shopOrders = orders.orders;
  state.notifications = notifications.notifications;
  state.analytics = analytics;
  renderShopProducts();
  renderShopOrders();
  renderShopkeeperStats();
  renderSalesReports();
  updateAssistantContext();
}

function renderShopkeeperStats() {
  const summary = state.analytics?.summary || { orderCount: 0, revenue: 0 };
  qs("shopkeeperStats").innerHTML = `
    <article><span>Store</span><strong>${state.store?.name || "Store"}</strong><p>${state.store?.address || ""}</p></article>
    <article><span>Total Orders</span><strong>${summary.orderCount}</strong><p>Live database orders</p></article>
    <article><span>Revenue</span><strong>${money(summary.revenue)}</strong><p>Accepted order value</p></article>
    <article><span>Low Stock</span><strong>${state.analytics?.lowStock?.length || 0}</strong><p>Products need attention</p></article>
  `;
}

function renderShopProducts() {
  qs("shopProducts").innerHTML = state.shopProducts.length
    ? state.shopProducts
        .map(
          (product) => `
          <article class="data-row">
            <div>
              <strong>${product.name}</strong>
              <p>${product.category} • ${money(product.price)} • ${product.stock} in stock • ${product.active ? "Visible" : "Deleted"}</p>
            </div>
            <div class="data-row-actions">
              <button class="secondary-button" type="button" data-edit-product="${product.id}">Edit</button>
              <button class="danger-button" type="button" data-delete-product="${product.id}">Delete</button>
            </div>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No shop products yet. Add your first product.</div>`;
}

function renderShopOrders() {
  qs("shopOrders").innerHTML = state.shopOrders.length
    ? state.shopOrders
        .map(
          (order) => `
          <article class="order-card">
            <div class="panel-top">
              <strong>Order #${order.id} • ${order.customerName}</strong>
              <span class="status ${["rejected", "cancelled"].includes(order.status) ? "danger" : order.status === "new" ? "warn" : ""}">${statusLabels[order.status]}</span>
            </div>
            <p>${order.items.map((item) => `${item.quantity} x ${item.name}`).join(", ")}</p>
            <strong>${money(order.grand_total)}</strong>
            <div class="order-actions">
              ${shopkeeperStatuses
                .map((status) => `<button class="secondary-button" type="button" data-order-status="${order.id}" data-status="${status}">${statusLabels[status]}</button>`)
                .join("")}
            </div>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No orders yet. New customer orders will appear live.</div>`;
}

function renderSalesReports() {
  const lowStock = state.analytics?.lowStock || [];
  qs("salesReports").innerHTML = `
    <article class="report-card"><strong>Revenue Analytics</strong><p>${money(state.analytics?.summary?.revenue || 0)} total revenue from active orders.</p></article>
    <article class="report-card"><strong>Sales Reports</strong><p>${state.analytics?.summary?.orderCount || 0} orders received through the marketplace.</p></article>
    <article class="report-card"><strong>Customer Insights</strong><p>Customers see every product, price, and stock update instantly.</p></article>
    <article class="report-card"><strong>Low Stock Alerts</strong><p>${lowStock.length ? lowStock.map((item) => `${item.name}: ${item.stock}`).join(", ") : "No low-stock products."}</p></article>
  `;
}

function resetProductForm() {
  qs("productForm").reset();
  qs("productIdInput").value = "";
  qs("productLowStockInput").value = "5";
  qs("saveProduct").textContent = "Save Product";
}

function editProduct(productId) {
  const product = state.shopProducts.find((item) => item.id === productId);
  if (!product) return;
  qs("productIdInput").value = product.id;
  qs("productNameInput").value = product.name;
  qs("productCategoryInput").value = product.category;
  qs("productPriceInput").value = product.price;
  qs("productStockInput").value = product.stock;
  qs("productLowStockInput").value = product.lowStockThreshold;
  qs("productImageInput").value = product.imageTag;
  qs("productDescriptionInput").value = product.description;
  qs("saveProduct").textContent = "Update Product";
}

async function saveProduct(event) {
  event.preventDefault();
  const productId = qs("productIdInput").value;
  const payload = {
    name: qs("productNameInput").value.trim(),
    category: qs("productCategoryInput").value,
    price: Number(qs("productPriceInput").value),
    stock: Number(qs("productStockInput").value),
    lowStockThreshold: Number(qs("productLowStockInput").value || 5),
    imageTag: qs("productImageInput").value.trim() || "ITEM",
    description: qs("productDescriptionInput").value.trim()
  };
  await api(productId ? `/api/products/${productId}` : "/api/products", {
    method: productId ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  resetProductForm();
  await loadShopkeeperData();
  toast(productId ? "Product updated and synced to customers." : "Product added and synced to customers.");
}

async function deleteProduct(productId) {
  await api(`/api/products/${productId}`, { method: "DELETE" });
  await loadShopkeeperData();
  toast("Product removed from customer marketplace.");
}

async function updateOrderStatus(orderId, status) {
  await api(`/api/orders/${orderId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  await loadShopkeeperData();
  toast(`Order #${orderId} marked ${statusLabels[status]}.`);
}

function bindEvents() {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  document.querySelectorAll("input[name='role']").forEach((input) => input.addEventListener("change", syncRoleClass));
  qs("authForm").addEventListener("submit", handleAuth);
  qs("customerLogout").addEventListener("click", () => logout());
  qs("shopkeeperLogout").addEventListener("click", () => logout());

  qs("productSearch").addEventListener("input", () => loadCustomerData({ quiet: true }).catch((error) => toast(error.message)));
  qs("categoryFilter").addEventListener("change", () => loadCustomerData({ quiet: true }).catch((error) => toast(error.message)));
  qs("clearFilters").addEventListener("click", () => {
    qs("productSearch").value = "";
    qs("categoryFilter").value = "";
    loadCustomerData().catch((error) => toast(error.message));
  });
  qs("emptyCart").addEventListener("click", () => clearCart().catch((error) => toast(error.message)));
  qs("placeOrder").addEventListener("click", () => placeOrder().catch((error) => toast(error.message)));
  qs("resetProductForm").addEventListener("click", resetProductForm);
  qs("productForm").addEventListener("submit", (event) => saveProduct(event).catch((error) => toast(error.message)));
  qs("aiFab").addEventListener("click", () => {
    qs("aiPanel").classList.add("open");
    updateAssistantContext();
    if (!qs("assistantMessages").children.length) {
      addAssistantMessage("Hi, I can help customers find products and build carts, or help shopkeepers review orders, sales, and low stock.");
    }
  });
  qs("closeAssistant").addEventListener("click", () => qs("aiPanel").classList.remove("open"));
  qs("assistantForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendAssistantMessage(qs("assistantInput").value);
  });
  document.querySelectorAll("[data-assistant-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendAssistantMessage(button.dataset.assistantPrompt));
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cartAdd = target.dataset.cartAdd;
    const wishlist = target.dataset.wishlist;
    const cartQty = target.dataset.cartQty;
    const cartRemove = target.dataset.cartRemove;
    const cancelOrderId = target.dataset.cancelOrder;
    const editId = target.dataset.editProduct;
    const deleteId = target.dataset.deleteProduct;
    const orderId = target.dataset.orderStatus;
    const status = target.dataset.status;
    const assistantAction = target.dataset.assistantAction;

    if (cartAdd) addToCart(Number(cartAdd)).catch((error) => toast(error.message));
    if (wishlist) addWishlist(Number(wishlist)).catch((error) => toast(error.message));
    if (cartQty) updateCartQuantity(Number(cartQty), Number(target.dataset.qty)).catch((error) => toast(error.message));
    if (cartRemove) removeCartItem(Number(cartRemove)).catch((error) => toast(error.message));
    if (cancelOrderId) cancelOrder(Number(cancelOrderId)).catch((error) => toast(error.message));
    if (editId) editProduct(Number(editId));
    if (deleteId) deleteProduct(Number(deleteId)).catch((error) => toast(error.message));
    if (orderId && status) updateOrderStatus(Number(orderId), status).catch((error) => toast(error.message));
    if (assistantAction) runAssistantAction(Number(assistantAction)).catch((error) => toast(error.message));
  });

  document.querySelectorAll("[data-customer-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.customerView;
      if (view === "products") qs("productGrid").scrollIntoView({ behavior: "smooth", block: "start" });
      if (view === "orders") qs("customerOrdersSection").scrollIntoView({ behavior: "smooth", block: "start" });
      if (view === "profile") qs("customerProfileSection").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function boot() {
  bindEvents();
  setAuthMode("login");
  syncRoleClass();
  if (state.token) await hydrateSession();
}

boot().catch((error) => {
  logout(false);
  toast(error.message);
});
