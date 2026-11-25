/**
 * 740 DISTRO // Real-Time Interactive Engine
 * Live Inventory Broadcast, Username & Password Auth, and Admin 1-on-1 Chat Dispatch
 */

document.addEventListener('DOMContentLoaded', () => {

  /* =========================================================
     1. Entrance Video Transition Engine
     ========================================================= */
  const entranceScreen = document.getElementById('entranceScreen');
  const enterBtn = document.getElementById('enterBtn');
  const contentWrapper = document.querySelector('.content-wrapper');
  const allVideos = document.querySelectorAll('video');

  if (enterBtn && entranceScreen) {
    enterBtn.addEventListener('click', () => {
      entranceScreen.classList.add('dissolve');

      if (contentWrapper) {
        contentWrapper.classList.add('revealed');
      }

      allVideos.forEach(vid => {
        vid.play().catch(() => {});
      });

      setTimeout(() => {
        entranceScreen.style.display = 'none';
      }, 850);
    });
  }

  /* =========================================================
     2. Toast Notification System
     ========================================================= */
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMessage');
  let toastTimer = null;

  function showToast(message) {
    if (!toast || !toastMsg) return;
    toastMsg.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  /* =========================================================
     3. State Management: Inventory & Authentication
     ========================================================= */
  // BACKEND API & WEBSOCKET CONFIGURATION
  function getApiBaseUrl() {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:3000';
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '::1') {
      return '';
    }
    if (window.location.hostname.includes('onrender.com')) {
      return '';
    }
    return 'https://seven40-distro.onrender.com';
  }
  let API_BASE_URL = getApiBaseUrl();

  // Pre-warm backend (prevents cold start delays on Render)
  try {
    fetch(`${API_BASE_URL}/api/inventory?t=${Date.now()}`).catch(() => {});
  } catch (e) {}

  const INVENTORY_STORAGE_KEY = '740_distro_inventory_data';
  const LOCKED_PRICES_KEY = '740_distro_locked_prices';
  const ACCOUNTS_VAULT_KEY = '740_distro_accounts_vault';
  const USER_SESSION_KEY = '740_distro_user_session';
  const ADMIN_SESSION_KEY = '740_distro_admin_session';
  const ADMIN_PASSCODE = 'yartys740distro';

  const defaultInventory = {
    stockCount: 26,
    stockLabel: 'IN STOCK',
    prices: {
      1: 40,
      2: 75,
      5: 180,
      10: 320,
      20: 620
    },
    updatedAt: 0
  };

  let currentInventory = { ...defaultInventory };

  // Load cached inventory and locked custom prices from localStorage
  try {
    const cached = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (cached) {
      currentInventory = { ...defaultInventory, ...JSON.parse(cached) };
    }
    const lockedPrices = localStorage.getItem(LOCKED_PRICES_KEY);
    if (lockedPrices) {
      currentInventory.prices = { ...currentInventory.prices, ...JSON.parse(lockedPrices) };
    }
  } catch (e) {
    console.warn("Storage read error:", e);
  }

  // Helper: Persistent Accounts Vault for Auto-Healing
  function getAccountsVault() {
    try {
      const raw = localStorage.getItem(ACCOUNTS_VAULT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveToAccountsVault(accounts) {
    if (!Array.isArray(accounts)) return;
    try {
      const existing = getAccountsVault();
      accounts.forEach(acc => {
        if (acc && acc.username) {
          const idx = existing.findIndex(e => e.username.toLowerCase() === acc.username.toLowerCase());
          if (idx >= 0) {
            existing[idx] = { ...existing[idx], ...acc };
          } else {
            existing.push(acc);
          }
        }
      });
      localStorage.setItem(ACCOUNTS_VAULT_KEY, JSON.stringify(existing));
    } catch (e) {}
  }

  // Active User & Admin Session States
  let currentUser = null; // { id, username, role, token }
  let currentAdminToken = null;
  let isAdminLoggedIn = false;

  // Restore User Session
  try {
    const savedUser = localStorage.getItem(USER_SESSION_KEY);
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
    }
  } catch (e) {
    console.warn("User session restore error:", e);
  }

  // Restore Admin Session
  try {
    const savedAdmin = localStorage.getItem(ADMIN_SESSION_KEY);
    if (savedAdmin) {
      currentAdminToken = savedAdmin;
      isAdminLoggedIn = true;
    }
  } catch (e) {
    console.warn("Admin session restore error:", e);
  }

  // DOM Elements for Display
  const stockBadgeDisplay = document.getElementById('stockBadgeDisplay');
  const stockCountText = document.getElementById('stockCountText');
  const stockLabelText = document.getElementById('stockLabelText');
  const liveSyncPill = document.getElementById('liveSyncPill');
  const priceDisplay1 = document.getElementById('priceDisplay1');
  const priceDisplay2 = document.getElementById('priceDisplay2');
  const priceDisplay5 = document.getElementById('priceDisplay5');
  const priceDisplay10 = document.getElementById('priceDisplay10');
  const priceDisplay20 = document.getElementById('priceDisplay20');
  const priceRow1 = document.getElementById('priceRow1');
  const priceRow2 = document.getElementById('priceRow2');
  const priceRow5 = document.getElementById('priceRow5');
  const priceRow10 = document.getElementById('priceRow10');
  const priceRow20 = document.getElementById('priceRow20');

  function renderInventoryUI(inv, shouldPulse = false) {
    if (!inv) return;
    const incomingPrices = inv.prices || currentInventory.prices;
    currentInventory = { 
      ...currentInventory, 
      ...inv,
      prices: { ...currentInventory.prices, ...incomingPrices },
      updatedAt: Math.max(currentInventory.updatedAt || 0, inv.updatedAt || 0)
    };

    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(currentInventory));
    } catch (e) {}

    const isSoldOut = currentInventory.stockLabel.trim().toUpperCase().includes('SOLD') || currentInventory.stockCount === 0;

    if (stockBadgeDisplay) {
      if (isSoldOut) {
        stockBadgeDisplay.classList.add('sold-out');
      } else {
        stockBadgeDisplay.classList.remove('sold-out');
      }
      if (shouldPulse) {
        stockBadgeDisplay.classList.remove('flash-update');
        void stockBadgeDisplay.offsetWidth; // retrigger reflow
        stockBadgeDisplay.classList.add('flash-update');
      }
    }

    if (stockCountText) {
      if (isSoldOut && currentInventory.stockCount === 0) {
        stockCountText.style.display = 'none';
      } else {
        stockCountText.style.display = 'inline';
        stockCountText.textContent = currentInventory.stockCount;
      }
    }

    if (stockLabelText) {
      stockLabelText.textContent = currentInventory.stockLabel;
    }

    if (priceDisplay1) priceDisplay1.textContent = `$${currentInventory.prices[1]}`;
    if (priceDisplay2) priceDisplay2.textContent = `$${currentInventory.prices[2]}`;
    if (priceDisplay5) priceDisplay5.textContent = `$${currentInventory.prices[5]}`;
    if (priceDisplay10) priceDisplay10.textContent = `$${currentInventory.prices[10]}`;
    if (priceDisplay20) priceDisplay20.textContent = `$${currentInventory.prices[20]}`;

    if (shouldPulse) {
      [priceRow1, priceRow2, priceRow5, priceRow10, priceRow20].forEach(row => {
        if (row) {
          row.classList.remove('flash-update');
          void row.offsetWidth;
          row.classList.add('flash-update');
        }
      });
    }
  }

  // Handle inventory incoming from WebSocket or HTTP with anti-revert protection
  function handleInventoryUpdate(serverInv, isBroadcast = false) {
    if (!serverInv || !serverInv.prices) return;

    const serverTime = parseInt(serverInv.updatedAt, 10) || 0;
    const localTime = parseInt(currentInventory.updatedAt, 10) || 0;

    // PROTECTION AGAINST STALE SERVER RESETS:
    // If client has custom saved prices (localTime > 0) and the server restarted with older/default inventory (serverTime < localTime),
    // do not let the server reset our prices! Re-sync local prices back to server immediately!
    if (localTime > serverTime && localTime > 0) {
      console.log(`⚡ Retaining custom prices (local ${localTime} > server ${serverTime}). Auto-healing server prices...`);
      syncInventoryToServer(currentInventory);
      return;
    }

    renderInventoryUI(serverInv, isBroadcast);
    if (isBroadcast) {
      showToast(`⚡ Stock & Menu updated live: ${serverInv.stockCount} ${serverInv.stockLabel}`);
    }
  }

  function syncInventoryToServer(inv) {
    if (!inv || !inv.prices) return;
    try {
      fetch(`${API_BASE_URL}/api/inventory/sync-if-newer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory: inv })
      }).catch(() => {});
    } catch (e) {}
  }

  // Initial render
  renderInventoryUI(currentInventory);

  /* =========================================================
     4. Real-Time WebSockets Engine
     ========================================================= */
  let socket = null;
  let socketReconnectDelay = 1000;
  let isWsConnected = false;

  const chatLiveBadge = document.getElementById('chatLiveBadge');
  const chatStatusDot = document.getElementById('chatStatusDot');
  const chatStatusText = document.getElementById('chatStatusText');

  function getWebSocketUrl() {
    if (API_BASE_URL) {
      try {
        const url = new URL(API_BASE_URL);
        const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProto}//${url.host}`;
      } catch (e) {}
    }
    if (window.location.protocol === 'file:') {
      return 'ws://localhost:3000';
    }
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}`;
  }

  function initWebSocket() {
    try {
      const wsUrl = getWebSocketUrl();
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        isWsConnected = true;
        socketReconnectDelay = 1000;
        if (chatLiveBadge) {
          chatLiveBadge.textContent = '● LIVE SYNC';
          chatLiveBadge.classList.remove('offline');
        }
        if (chatStatusDot) {
          chatStatusDot.style.background = 'var(--neon-acid)';
          chatStatusDot.style.boxShadow = '0 0 10px var(--neon-acid)';
        }

        // Authenticate socket connection if logged in
        authenticateSocket();

        // Fetch latest inventory from server
        sendWsMessage({ type: 'GET_INVENTORY' });
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleIncomingSocketMessage(data);
        } catch (err) {
          console.error("Socket parse error:", err);
        }
      };

      socket.onclose = () => {
        isWsConnected = false;
        if (chatLiveBadge) {
          chatLiveBadge.textContent = '○ CONNECTING...';
          chatLiveBadge.classList.add('offline');
        }
        setTimeout(initWebSocket, Math.min(socketReconnectDelay *= 1.5, 10000));
      };

      socket.onerror = (err) => {
        console.warn("WebSocket status note:", err);
        socket.close();
      };
    } catch (e) {
      console.warn("WebSocket init error:", e);
    }
  }

  function sendWsMessage(msgObj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msgObj));
      return true;
    }
    return false;
  }

  function authenticateSocket() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (isAdminLoggedIn && currentAdminToken) {
      sendWsMessage({
        type: 'AUTH',
        token: currentAdminToken,
        adminPass: ADMIN_PASSCODE
      });
    } else if (currentUser && currentUser.token) {
      sendWsMessage({
        type: 'AUTH',
        token: currentUser.token
      });
    }
  }

  function handleIncomingSocketMessage(data) {
    switch (data.type) {
      case 'INVENTORY_INIT':
      case 'INVENTORY_UPDATED':
        handleInventoryUpdate(data.inventory, data.type === 'INVENTORY_UPDATED');
        break;

      case 'CHAT_MESSAGE':
        // Regular user received a direct message (from Admin or Dispatch)
        if (currentUser && data.userId === currentUser.user.id) {
          appendUserChatMessage(
            data.message.sender === 'admin' ? '👑 740 ADMIN' : 'YOU',
            data.message.text,
            data.message.sender === 'admin',
            data.message.timestamp
          );
          if (data.message.sender === 'admin') {
            showToast('💬 New message from 740 Admin!');
          }
        }
        break;

      case 'ADMIN_CHAT_MESSAGE':
        // Admin received a message from a customer or an outgoing reply
        handleAdminIncomingMessage(data.userId, data.message);
        break;

      case 'CONVERSATIONS_LIST':
      case 'CONVERSATIONS_UPDATED':
        if (isAdminLoggedIn) {
          renderAdminConversationsList(data.conversations);
        }
        break;

      case 'CHAT_HISTORY':
        if (isAdminLoggedIn && data.userId === selectedConversationUserId) {
          const conv = adminConversations.find(c => c.userId === data.userId);
          renderAdminChatMessages(data.history || [], conv?.username || 'Customer');
        }
        break;

      case 'USER_TYPING':
        handleTypingNotice(data);
        break;

      default:
        break;
    }
  }

  // Periodic and Visibility Inventory Sync
  function fetchLatestInventory() {
    fetch(`${API_BASE_URL}/api/inventory?t=${Date.now()}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.stockCount !== undefined) {
          handleInventoryUpdate(data, false);
        }
      })
      .catch(() => {});
  }

  // Initial HTTP fetch of inventory
  fetchLatestInventory();

  // Poll inventory every 5 seconds for rock-solid live sync on all devices
  setInterval(fetchLatestInventory, 5000);

  // Auto re-sync when screen unlocks or tab becomes active
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        initWebSocket();
      }
      fetchLatestInventory();
      if (isAdminLoggedIn) {
        loadAdminConversations();
        if (selectedConversationUserId) {
          const conv = adminConversations.find(c => c.userId === selectedConversationUserId);
          loadAdminChatHistory(selectedConversationUserId, conv?.username || 'Customer');
        }
      }
    }
  });

  // Start WebSocket connection
  initWebSocket();

  /* =========================================================
     5. User Account Authentication UI (Login & Register)
     ========================================================= */
  const userAuthBtn = document.getElementById('userAuthBtn');
  const userProfilePill = document.getElementById('userProfilePill');
  const navUsername = document.getElementById('navUsername');
  const navLogoutBtn = document.getElementById('navLogoutBtn');

  const userAuthModal = document.getElementById('userAuthModal');
  const closeUserAuthModal = document.getElementById('closeUserAuthModal');
  const userAuthTitle = document.getElementById('userAuthTitle');
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const formUserLogin = document.getElementById('formUserLogin');
  const formUserRegister = document.getElementById('formUserRegister');
  const loginUsernameInput = document.getElementById('loginUsername');
  const loginPasswordInput = document.getElementById('loginPassword');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const registerUsernameInput = document.getElementById('registerUsername');
  const registerPasswordInput = document.getElementById('registerPassword');
  const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
  const registerErrorMsg = document.getElementById('registerErrorMsg');
  const registerSuccessMsg = document.getElementById('registerSuccessMsg');
  const linkToRegister = document.getElementById('linkToRegister');
  const linkToLogin = document.getElementById('linkToLogin');

  // Chat auth bar elements
  const chatAuthPrompt = document.getElementById('chatAuthPrompt');
  const chatOpenAuthBtn = document.getElementById('chatOpenAuthBtn');
  const chatUserBanner = document.getElementById('chatUserBanner');
  const chatLoggedUsername = document.getElementById('chatLoggedUsername');
  const chatLogoutBtn = document.getElementById('chatLogoutBtn');
  const chatInput = document.getElementById('chatInput');

  function openUserAuth(tab = 'login') {
    userAuthModal.classList.remove('hidden');
    switchAuthTab(tab);
    if (loginErrorMsg) loginErrorMsg.textContent = '';
    if (registerErrorMsg) registerErrorMsg.textContent = '';
    if (registerSuccessMsg) registerSuccessMsg.textContent = '';
  }

  function closeUserAuth() {
    userAuthModal.classList.add('hidden');
  }

  function switchAuthTab(tab) {
    if (tab === 'register') {
      tabBtnLogin.classList.remove('active');
      tabBtnRegister.classList.add('active');
      formUserLogin.classList.add('hidden');
      formUserRegister.classList.remove('hidden');
      userAuthTitle.textContent = '740 MEMBER REGISTER';
      if (registerUsernameInput) registerUsernameInput.focus();
    } else {
      tabBtnRegister.classList.remove('active');
      tabBtnLogin.classList.add('active');
      formUserRegister.classList.add('hidden');
      formUserLogin.classList.remove('hidden');
      userAuthTitle.textContent = '740 MEMBER LOGIN';
      if (loginUsernameInput) loginUsernameInput.focus();
    }
  }

  if (userAuthBtn) userAuthBtn.addEventListener('click', () => openUserAuth('login'));
  if (chatOpenAuthBtn) chatOpenAuthBtn.addEventListener('click', () => openUserAuth('register'));
  if (closeUserAuthModal) closeUserAuthModal.addEventListener('click', closeUserAuth);

  if (tabBtnLogin) tabBtnLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabBtnRegister) tabBtnRegister.addEventListener('click', () => switchAuthTab('register'));
  if (linkToRegister) linkToRegister.addEventListener('click', () => switchAuthTab('register'));
  if (linkToLogin) linkToLogin.addEventListener('click', () => switchAuthTab('login'));

  // Close modals clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === userAuthModal) closeUserAuth();
  });

  function updateAuthUI() {
    if (currentUser && currentUser.user) {
      const uname = currentUser.user.username;
      if (userAuthBtn) userAuthBtn.classList.add('hidden');
      if (userProfilePill) {
        userProfilePill.classList.remove('hidden');
        if (navUsername) navUsername.textContent = `@${uname}`;
      }
      if (chatAuthPrompt) chatAuthPrompt.classList.add('hidden');
      if (chatUserBanner) {
        chatUserBanner.classList.remove('hidden');
        if (chatLoggedUsername) chatLoggedUsername.textContent = `@${uname}`;
      }
      if (chatInput) {
        chatInput.placeholder = `Message 740 Admin directly as @${uname}...`;
      }
      if (chatStatusText) {
        chatStatusText.textContent = `Direct 1-on-1 line with 740 Admin (@${uname})`;
      }

      // Re-authenticate WebSocket
      authenticateSocket();

      // Load user message history
      loadUserChatHistory();
    } else {
      if (userAuthBtn) userAuthBtn.classList.remove('hidden');
      if (userProfilePill) userProfilePill.classList.add('hidden');
      if (chatAuthPrompt) chatAuthPrompt.classList.remove('hidden');
      if (chatUserBanner) chatUserBanner.classList.add('hidden');
      if (chatInput) {
        chatInput.placeholder = 'Type a message or order inquiry...';
      }
      if (chatStatusText) {
        chatStatusText.textContent = 'Lancaster, OH • Direct 1-on-1 Line with Admin';
      }
    }
  }

  function performLogout() {
    fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentUser?.token || ''}`
      }
    }).catch(() => {});

    currentUser = null;
    localStorage.removeItem(USER_SESSION_KEY);
    updateAuthUI();
    showToast('Logged out successfully');
  }

  if (navLogoutBtn) navLogoutBtn.addEventListener('click', performLogout);
  if (chatLogoutBtn) chatLogoutBtn.addEventListener('click', performLogout);

  // Submit User Registration (Username & Password Only)
  if (formUserRegister) {
    formUserRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      registerErrorMsg.textContent = '';
      registerSuccessMsg.textContent = '';

      const username = registerUsernameInput.value.trim();
      const password = registerPasswordInput.value;
      const confirm = registerPasswordConfirm.value;

      if (!username || !password) {
        registerErrorMsg.textContent = 'Please enter a username and password.';
        return;
      }

      if (username.length < 3 || username.length > 20) {
        registerErrorMsg.textContent = 'Username must be between 3 and 20 characters.';
        return;
      }

      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        registerErrorMsg.textContent = 'Username can only contain letters, numbers, and dashes.';
        return;
      }

      if (password.length < 4) {
        registerErrorMsg.textContent = 'Password must be at least 4 characters.';
        return;
      }

      if (password !== confirm) {
        registerErrorMsg.textContent = 'Passwords do not match.';
        return;
      }

      const btnSubmit = document.getElementById('btnSubmitRegisterUser');
      const origText = btnSubmit ? btnSubmit.textContent : 'CREATE ACCOUNT';
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = '⚡ CREATING ACCOUNT...';
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          registerErrorMsg.textContent = data.error || 'Failed to register account.';
          return;
        }

        // Store session and back up to persistent vault
        currentUser = data;
        localStorage.setItem(USER_SESSION_KEY, JSON.stringify(data));
        if (data.user) {
          saveToAccountsVault([{
            id: data.user.id,
            username: data.user.username,
            role: data.user.role,
            createdAt: Date.now()
          }]);
        }
        updateAuthUI();
        closeUserAuth();
        showToast(`⚡ Welcome to 740 Distro, @${username}!`);

      } catch (err) {
        registerErrorMsg.textContent = 'Network error. Please make sure the server is awake and running.';
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = origText;
        }
      }
    });
  }

  // Submit User Login (Username & Password Only)
  if (formUserLogin) {
    formUserLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginErrorMsg.textContent = '';

      const username = loginUsernameInput.value.trim();
      const password = loginPasswordInput.value;

      if (!username || !password) {
        loginErrorMsg.textContent = 'Please enter your username and password.';
        return;
      }

      const btnSubmit = document.getElementById('btnSubmitLoginUser');
      const origText = btnSubmit ? btnSubmit.textContent : 'SIGN IN';
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = '⚡ SIGNING IN...';
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          loginErrorMsg.textContent = data.error || 'Invalid credentials.';
          return;
        }

        // If admin logged in via user login form
        if (data.user && data.user.role === 'admin') {
          isAdminLoggedIn = true;
          currentAdminToken = data.token;
          localStorage.setItem(ADMIN_SESSION_KEY, data.token);
          updateAdminUI();
        }

        currentUser = data;
        localStorage.setItem(USER_SESSION_KEY, JSON.stringify(data));
        updateAuthUI();
        closeUserAuth();
        showToast(`⚡ Welcome back, @${data.user.username}!`);

      } catch (err) {
        loginErrorMsg.textContent = 'Network error. Please make sure the server is awake and running.';
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = origText;
        }
      }
    });
  }

  // Initial Auth UI check
  updateAuthUI();

  /* =========================================================
     6. Customer Live Chat Functionality
     ========================================================= */
  const chatForm = document.getElementById('chatForm');
  const chatMessages = document.getElementById('chatMessages');
  const quickPills = document.querySelectorAll('.quick-pill');

  function getCurrentTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    let hours = d.getHours();
    let mins = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    mins = mins < 10 ? '0' + mins : mins;
    return `${hours}:${mins} ${ampm}`;
  }

  function appendUserChatMessage(sender, text, isAdmin = false, timestamp = null) {
    if (!chatMessages) return;

    const msgEl = document.createElement('div');
    if (isAdmin) {
      msgEl.className = 'message msg-admin';
      msgEl.innerHTML = `
        <div class="msg-sender">${sender}</div>
        <div class="msg-bubble">${text}</div>
        <div class="msg-time">${getCurrentTime(timestamp)}</div>
      `;
    } else if (sender === '740 DISPATCH') {
      msgEl.className = 'message msg-bot';
      msgEl.innerHTML = `
        <div class="msg-sender">${sender}</div>
        <div class="msg-bubble">${text}</div>
        <div class="msg-time">${getCurrentTime(timestamp)}</div>
      `;
    } else {
      msgEl.className = 'message msg-user';
      msgEl.innerHTML = `
        <div class="msg-sender">${sender}</div>
        <div class="msg-bubble">${text}</div>
        <div class="msg-time">${getCurrentTime(timestamp)}</div>
      `;
    }

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function loadUserChatHistory() {
    if (!currentUser || !currentUser.token) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat/history`, {
        headers: { 'Authorization': `Bearer ${currentUser.token}` }
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.history)) {
        // Clear previous messages except initial greeting if history is empty
        if (data.history.length > 0) {
          chatMessages.innerHTML = `
            <div class="message msg-bot">
              <div class="msg-sender">740 DISPATCH</div>
              <div class="msg-bubble">
                Connected with 740 Admin. Your direct conversation history is synced.
              </div>
              <div class="msg-time">Connected</div>
            </div>
          `;
          data.history.forEach(m => {
            appendUserChatMessage(
              m.sender === 'admin' ? '👑 740 ADMIN' : 'YOU',
              m.text,
              m.sender === 'admin',
              m.timestamp
            );
          });
        }
      }
    } catch (e) {
      console.warn("Could not load chat history:", e);
    }
  }

  function handleCustomerSendMessage(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    if (currentUser && currentUser.token) {
      // 1. Logged in customer sending to Admin
      appendUserChatMessage('YOU', cleanText, false);
      if (chatInput) chatInput.value = '';

      // Send via WebSocket or fallback API
      const sentViaWs = sendWsMessage({
        type: 'SEND_MESSAGE',
        text: cleanText
      });

      if (!sentViaWs) {
        fetch(`${API_BASE_URL}/api/chat/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentUser.token}`
          },
          body: JSON.stringify({ text: cleanText })
        }).catch(() => {});
      }

    } else {
      // 2. Guest user: show bot response & prompt login
      appendUserChatMessage('YOU', cleanText, false);
      if (chatInput) chatInput.value = '';

      setTimeout(() => {
        const lower = cleanText.toLowerCase();
        let reply = '';
        if (lower.includes('stock') || lower.includes('have') || lower.includes('available')) {
          reply = `📦 Current Live Stock: <strong>${currentInventory.stockCount} ${currentInventory.stockLabel}</strong>. To place a hold or speak directly with the owner, please <a href="#" id="inlineLoginLink" style="color:var(--neon-green); text-decoration:underline;">login or register</a>!`;
        } else if (lower.includes('price') || lower.includes('cost') || lower.includes('menu')) {
          reply = `💰 1 for $${currentInventory.prices[1]}, 2 for $${currentInventory.prices[2]}, 5 for $${currentInventory.prices[5]}, 10 for $${currentInventory.prices[10]}, 20 for $${currentInventory.prices[20]}. Want to lock in an order? <a href="#" id="inlineLoginLink" style="color:var(--neon-green); text-decoration:underline;">Sign up in 5 seconds</a> to chat directly with Admin!`;
        } else {
          reply = `Got your message! Want to talk 1-on-1 with the 740 Admin? <a href="#" id="inlineLoginLink" style="color:var(--neon-green); font-weight:bold; text-decoration:underline;">Click here to sign in or create an account</a> with just a username & password.`;
        }
        appendUserChatMessage('740 DISPATCH', reply, false);

        // Bind inline login link click
        const inlineLink = document.getElementById('inlineLoginLink');
        if (inlineLink) {
          inlineLink.addEventListener('click', (e) => {
            e.preventDefault();
            openUserAuth('register');
          });
        }
      }, 550);
    }
  }

  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleCustomerSendMessage(chatInput.value);
    });
  }

  quickPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const q = pill.dataset.msg;
      if (q) handleCustomerSendMessage(q);
    });
  });

  /* =========================================================
     7. Admin Command Center & Live User Chat Panel
     ========================================================= */
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  const adminUnreadBadge = document.getElementById('adminUnreadBadge');
  const adminLoginModal = document.getElementById('adminLoginModal');
  const closeLoginModal = document.getElementById('closeLoginModal');
  const adminPassInput = document.getElementById('adminPassInput');
  const btnSubmitLogin = document.getElementById('btnSubmitLogin');
  const adminLoginError = document.getElementById('adminLoginError');

  const adminDashboardModal = document.getElementById('adminDashboardModal');
  const closeDashboardModal = document.getElementById('closeDashboardModal');
  const tabBtnAdminInventory = document.getElementById('tabBtnAdminInventory');
  const tabBtnAdminChat = document.getElementById('tabBtnAdminChat');
  const adminChatTabBadge = document.getElementById('adminChatTabBadge');
  const adminTabInventoryContent = document.getElementById('adminTabInventoryContent');
  const adminTabChatContent = document.getElementById('adminTabChatContent');
  const tabBtnAdminBackup = document.getElementById('tabBtnAdminBackup');
  const adminTabBackupContent = document.getElementById('adminTabBackupContent');
  const dbStatusDot = document.getElementById('dbStatusDot');
  const dbStatusTitle = document.getElementById('dbStatusTitle');
  const dbStatusDesc = document.getElementById('dbStatusDesc');
  const btnRefreshDbStatus = document.getElementById('btnRefreshDbStatus');
  const adminTotalAccountsCount = document.getElementById('adminTotalAccountsCount');
  const btnExportAccounts = document.getElementById('btnExportAccounts');
  const adminRestoreJsonInput = document.getElementById('adminRestoreJsonInput');
  const adminBackupFileInput = document.getElementById('adminBackupFileInput');
  const btnSelectBackupFile = document.getElementById('btnSelectBackupFile');
  const btnExecuteRestore = document.getElementById('btnExecuteRestore');
  const adminRestoreResultMsg = document.getElementById('adminRestoreResultMsg');

  // Inventory inputs in Admin Dashboard
  const inputStockCount = document.getElementById('inputStockCount');
  const inputStockLabel = document.getElementById('inputStockLabel');
  const inputPrice1 = document.getElementById('inputPrice1');
  const inputPrice2 = document.getElementById('inputPrice2');
  const inputPrice5 = document.getElementById('inputPrice5');
  const inputPrice10 = document.getElementById('inputPrice10');
  const inputPrice20 = document.getElementById('inputPrice20');
  const btnSaveInventory = document.getElementById('btnSaveInventory');
  const btnLogoutAdmin = document.getElementById('btnLogoutAdmin');
  const btnPresetInStock = document.getElementById('btnPresetInStock');
  const btnPresetSoldOut = document.getElementById('btnPresetSoldOut');

  // Admin Live Chat UI Elements
  const adminUserList = document.getElementById('adminUserList');
  const adminUserSearchInput = document.getElementById('adminUserSearchInput');
  const targetUsernameDisplay = document.getElementById('targetUsernameDisplay');
  const targetDetailsDisplay = document.getElementById('targetDetailsDisplay');
  const targetStatusDot = document.getElementById('targetStatusDot');
  const btnRefreshConversations = document.getElementById('btnRefreshConversations');
  const adminConversationMessages = document.getElementById('adminConversationMessages');
  const adminQuickReplies = document.getElementById('adminQuickReplies');
  const adminChatForm = document.getElementById('adminChatForm');
  const adminChatInput = document.getElementById('adminChatInput');
  const adminChatSendBtn = document.getElementById('adminChatSendBtn');

  let adminConversations = [];
  let selectedConversationUserId = null;
  let totalAdminUnread = 0;

  function updateAdminUI() {
    if (isAdminLoggedIn) {
      if (adminLoginBtn) {
        adminLoginBtn.title = "Command Center (Stock & Live Chat)";
      }
      authenticateSocket();
    }
  }

  function openAdmin() {
    if (isAdminLoggedIn) {
      populateAdminFields();
      adminDashboardModal.classList.remove('hidden');
      switchAdminTab('inventory');
      loadAdminConversations();
    } else {
      adminLoginModal.classList.remove('hidden');
      if (adminPassInput) {
        adminPassInput.value = '';
        adminPassInput.focus();
      }
      if (adminLoginError) adminLoginError.textContent = '';
    }
  }

  if (adminLoginBtn) adminLoginBtn.addEventListener('click', openAdmin);
  if (closeLoginModal) closeLoginModal.addEventListener('click', () => adminLoginModal.classList.add('hidden'));
  if (closeDashboardModal) closeDashboardModal.addEventListener('click', () => adminDashboardModal.classList.add('hidden'));

  // Admin Tab Switcher
  function switchAdminTab(tab) {
    if (tabBtnAdminInventory) tabBtnAdminInventory.classList.toggle('active', tab === 'inventory');
    if (tabBtnAdminChat) tabBtnAdminChat.classList.toggle('active', tab === 'chat');
    if (tabBtnAdminBackup) tabBtnAdminBackup.classList.toggle('active', tab === 'backup');

    if (adminTabInventoryContent) adminTabInventoryContent.classList.toggle('hidden', tab !== 'inventory');
    if (adminTabChatContent) adminTabChatContent.classList.toggle('hidden', tab !== 'chat');
    if (adminTabBackupContent) adminTabBackupContent.classList.toggle('hidden', tab !== 'backup');

    if (tab === 'chat') {
      const layout = document.querySelector('.admin-chat-layout');
      if (layout && !selectedConversationUserId) {
        layout.classList.remove('mobile-chat-active');
      }
      loadAdminConversations();
    } else if (tab === 'backup') {
      loadSystemStatus();
    }
  }

  if (tabBtnAdminInventory) tabBtnAdminInventory.addEventListener('click', () => switchAdminTab('inventory'));
  if (tabBtnAdminChat) tabBtnAdminChat.addEventListener('click', () => switchAdminTab('chat'));
  if (tabBtnAdminBackup) tabBtnAdminBackup.addEventListener('click', () => switchAdminTab('backup'));

  async function loadSystemStatus() {
    if (!isAdminLoggedIn) return;
    const dbStatusTitle = document.getElementById('dbStatusTitle');
    const dbStatusDesc = document.getElementById('dbStatusDesc');
    const dbStatusDot = document.getElementById('dbStatusDot');
    const adminTotalAccountsCount = document.getElementById('adminTotalAccountsCount');

    if (dbStatusTitle) dbStatusTitle.textContent = 'Checking server connection...';

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/system-status`, {
        headers: {
          'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
          'x-admin-pass': ADMIN_PASSCODE
        }
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data && data.success) {
        if (adminTotalAccountsCount) {
          adminTotalAccountsCount.textContent = data.usersCount || 0;
        }

        // AUTO-HEAL ACCOUNTS: If server container was reset (0 accounts on server),
        // automatically push our persistent accounts vault so accounts never disappear!
        if (data.usersCount === 0) {
          const vault = getAccountsVault();
          if (vault && vault.length > 0) {
            console.log(`⚡ Server has 0 accounts! Auto-healing ${vault.length} accounts from vault...`);
            fetch(`${API_BASE_URL}/api/auth/auto-heal`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
                'x-admin-pass': ADMIN_PASSCODE
              },
              body: JSON.stringify({
                adminPass: ADMIN_PASSCODE,
                accounts: vault,
                inventory: currentInventory
              })
            })
            .then(r => r.json())
            .then(healRes => {
              if (healRes && healRes.success) {
                if (adminTotalAccountsCount) {
                  adminTotalAccountsCount.textContent = healRes.totalUsers || vault.length;
                }
                showToast(`⚡ Auto-healed ${healRes.totalUsers || vault.length} accounts to server!`);
                loadAdminConversations();
              }
            })
            .catch(() => {});
          }
        }

        if (data.database === 'mongodb' || data.isDbConnected) {
          if (dbStatusDot) dbStatusDot.style.background = '#00ff66';
          if (dbStatusTitle) {
            dbStatusTitle.textContent = '🟢 Cloud Database Connected (MongoDB Atlas)';
            dbStatusTitle.style.color = '#00ff66';
          }
          if (dbStatusDesc) {
            dbStatusDesc.textContent = 'All accounts, menu prices, and chats are permanently saved in MongoDB Atlas. They will never reset when updating code!';
          }
        } else {
          if (dbStatusDot) dbStatusDot.style.background = '#00ff66';
          if (dbStatusTitle) {
            dbStatusTitle.textContent = '🟢 Local Storage & Auto-Heal Active';
            dbStatusTitle.style.color = '#00ff66';
          }
          if (dbStatusDesc) {
            dbStatusDesc.innerHTML = 'Client-Side Self-Healing Vault is active. Accounts and menu prices are locked and auto-restored! (Add MONGODB_URI in Render dashboard for permanent multi-device cloud sync).';
          }
        }
      }
    } catch (e) {
      console.warn("System status check:", e);
      if (dbStatusDot) dbStatusDot.style.background = '#ef4444';
      if (dbStatusTitle) {
        dbStatusTitle.textContent = '⚠️ Backend Endpoint Offline';
        dbStatusTitle.style.color = '#ef4444';
      }
      if (dbStatusDesc) {
        dbStatusDesc.innerHTML = `Could not reach backend (${e.message}). If hosted on Render, free instances can take ~30s to wake up from sleep. If testing locally, make sure <code>start-server.bat</code> is running!`;
      }
    }
  }

  // Export / Backup Accounts
  if (btnExportAccounts) {
    btnExportAccounts.addEventListener('click', async () => {
      try {
        btnExportAccounts.textContent = '⏳ Exporting...';
        const res = await fetch(`${API_BASE_URL}/api/admin/backup?adminPass=${ADMIN_PASSCODE}`, {
          headers: {
            'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
            'x-admin-pass': ADMIN_PASSCODE
          }
        });
        const data = await res.json();
        if (data && data.success) {
          if (Array.isArray(data.users)) {
            saveToAccountsVault(data.users);
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `740_distro_backup_${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast(`✓ Backup downloaded! (${data.users?.length || 0} accounts)`);
        } else {
          showToast('Failed to export backup.');
        }
      } catch (err) {
        showToast('Error exporting backup.');
      } finally {
        btnExportAccounts.textContent = '📥 DOWNLOAD BACKUP';
      }
    });
  }

  // Select File to Restore
  if (btnSelectBackupFile && adminBackupFileInput) {
    btnSelectBackupFile.addEventListener('click', () => adminBackupFileInput.click());
    adminBackupFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (adminRestoreJsonInput) {
          adminRestoreJsonInput.value = evt.target.result;
        }
        if (adminRestoreResultMsg) {
          adminRestoreResultMsg.style.color = '#00ff66';
          adminRestoreResultMsg.textContent = `Loaded file: ${file.name}. Ready to restore!`;
        }
      };
      reader.readAsText(file);
    });
  }

  // Execute Restore
  if (btnExecuteRestore) {
    btnExecuteRestore.addEventListener('click', async () => {
      const raw = adminRestoreJsonInput?.value.trim();
      if (!raw) {
        if (adminRestoreResultMsg) {
          adminRestoreResultMsg.style.color = '#ef4444';
          adminRestoreResultMsg.textContent = 'Please paste backup JSON or select a backup file first.';
        }
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        if (adminRestoreResultMsg) {
          adminRestoreResultMsg.style.color = '#ef4444';
          adminRestoreResultMsg.textContent = 'Invalid JSON format. Please check the backup file.';
        }
        return;
      }

      btnExecuteRestore.disabled = true;
      btnExecuteRestore.textContent = '⚡ RESTORING...';

      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/restore?adminPass=${ADMIN_PASSCODE}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
            'x-admin-pass': ADMIN_PASSCODE
          },
          body: JSON.stringify(parsed)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (adminRestoreResultMsg) {
            adminRestoreResultMsg.style.color = '#00ff66';
            adminRestoreResultMsg.textContent = `✓ ${data.message}`;
          }
          if (parsed.users || Array.isArray(parsed)) {
            saveToAccountsVault(parsed.users || parsed);
          }
          showToast(`✓ Restored! Total active accounts: ${data.totalUsers}`);
          loadSystemStatus();
          loadAdminConversations();
        } else {
          if (adminRestoreResultMsg) {
            adminRestoreResultMsg.style.color = '#ef4444';
            adminRestoreResultMsg.textContent = data.error || 'Failed to restore.';
          }
        }
      } catch (e) {
        if (adminRestoreResultMsg) {
          adminRestoreResultMsg.style.color = '#ef4444';
          adminRestoreResultMsg.textContent = 'Network error while restoring.';
        }
      } finally {
        btnExecuteRestore.disabled = false;
        btnExecuteRestore.textContent = '⚡ RESTORE ACCOUNTS NOW';
      }
    });
  }

  if (btnRefreshDbStatus) {
    btnRefreshDbStatus.addEventListener('click', loadSystemStatus);
  }

  // Verify Admin Passcode
  async function verifyAdminPassword() {
    const entered = adminPassInput.value.trim();
    if (!entered) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: entered })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        isAdminLoggedIn = true;
        currentAdminToken = data.token;
        localStorage.setItem(ADMIN_SESSION_KEY, data.token);
        adminLoginModal.classList.add('hidden');
        populateAdminFields();
        adminDashboardModal.classList.remove('hidden');
        switchAdminTab('inventory');
        showToast('⚡ Admin Command Center Unlocked!');
        authenticateSocket();
        loadAdminConversations();
      } else {
        adminLoginError.textContent = data.error || 'Invalid passcode.';
        adminPassInput.focus();
      }
    } catch (e) {
      // Local fallback check
      if (entered === ADMIN_PASSCODE) {
        isAdminLoggedIn = true;
        currentAdminToken = 'local_admin_master';
        adminLoginModal.classList.add('hidden');
        populateAdminFields();
        adminDashboardModal.classList.remove('hidden');
        switchAdminTab('inventory');
        showToast('⚡ Welcome Owner!');
      } else {
        adminLoginError.textContent = 'Invalid passcode.';
      }
    }
  }

  if (btnSubmitLogin) btnSubmitLogin.addEventListener('click', verifyAdminPassword);
  if (adminPassInput) {
    adminPassInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyAdminPassword();
    });
  }

  function populateAdminFields() {
    if (inputStockCount) inputStockCount.value = currentInventory.stockCount;
    if (inputStockLabel) inputStockLabel.value = currentInventory.stockLabel;
    if (inputPrice1) inputPrice1.value = currentInventory.prices[1];
    if (inputPrice2) inputPrice2.value = currentInventory.prices[2];
    if (inputPrice5) inputPrice5.value = currentInventory.prices[5];
    if (inputPrice10) inputPrice10.value = currentInventory.prices[10];
    if (inputPrice20) inputPrice20.value = currentInventory.prices[20];
  }

  if (btnPresetInStock) {
    btnPresetInStock.addEventListener('click', () => {
      if (inputStockLabel) inputStockLabel.value = 'IN STOCK';
      if (inputStockCount && parseInt(inputStockCount.value, 10) === 0) {
        inputStockCount.value = 26;
      }
    });
  }

  if (btnPresetSoldOut) {
    btnPresetSoldOut.addEventListener('click', () => {
      if (inputStockLabel) inputStockLabel.value = 'SOLD OUT';
      if (inputStockCount) inputStockCount.value = 0;
    });
  }

  // Save changes from Admin Dashboard & Broadcast Live to Everyone!
  if (btnSaveInventory) {
    btnSaveInventory.addEventListener('click', async () => {
      const origHtml = btnSaveInventory.innerHTML;
      btnSaveInventory.innerHTML = '⚡ APPLYING...';
      btnSaveInventory.disabled = true;

      const p1 = parseInt(inputPrice1.value, 10);
      const p2 = parseInt(inputPrice2.value, 10);
      const p5 = parseInt(inputPrice5.value, 10);
      const p10 = parseInt(inputPrice10.value, 10);
      const p20 = parseInt(inputPrice20.value, 10);

      const updatedPrices = {
        1: isNaN(p1) ? (currentInventory.prices[1] || 40) : p1,
        2: isNaN(p2) ? (currentInventory.prices[2] || 75) : p2,
        5: isNaN(p5) ? (currentInventory.prices[5] || 180) : p5,
        10: isNaN(p10) ? (currentInventory.prices[10] || 320) : p10,
        20: isNaN(p20) ? (currentInventory.prices[20] || 620) : p20
      };

      const updateTimestamp = Date.now();
      const updated = {
        stockCount: parseInt(inputStockCount.value, 10) || 0,
        stockLabel: inputStockLabel.value.trim() || 'IN STOCK',
        prices: updatedPrices,
        updatedAt: updateTimestamp
      };

      // 1. Lock into local browser storage immediately
      try {
        localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(updated));
        localStorage.setItem(LOCKED_PRICES_KEY, JSON.stringify(updatedPrices));
      } catch (e) {}

      // 2. Update local UI immediately
      renderInventoryUI(updated, true);

      // 3. Broadcast via WebSocket immediately
      sendWsMessage({
        type: 'UPDATE_INVENTORY',
        data: updated,
        adminPass: ADMIN_PASSCODE
      });

      // 4. Save via REST API
      try {
        const res = await fetch(`${API_BASE_URL}/api/inventory`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
            'x-admin-pass': ADMIN_PASSCODE
          },
          body: JSON.stringify({
            adminPass: ADMIN_PASSCODE,
            ...updated
          })
        });
        const invRes = await res.json();
        if (invRes && invRes.success && invRes.inventory) {
          renderInventoryUI(invRes.inventory, true);
        }
      } catch (e) {
        console.warn("HTTP inventory save:", e);
      }

      showToast(`✓ Broadcast Live! ${updated.stockCount} ${updated.stockLabel}`);

      btnSaveInventory.innerHTML = '✓ APPLIED LIVE!';
      setTimeout(() => {
        btnSaveInventory.innerHTML = origHtml;
        btnSaveInventory.disabled = false;
      }, 1500);
    });
  }

  if (btnLogoutAdmin) {
    btnLogoutAdmin.addEventListener('click', () => {
      isAdminLoggedIn = false;
      currentAdminToken = null;
      localStorage.removeItem(ADMIN_SESSION_KEY);
      adminDashboardModal.classList.add('hidden');
      showToast('Logged out of Admin');
    });
  }

  /* =========================================================
     8. Admin Live User Chat Conversations Engine
     ========================================================= */
  async function loadAdminConversations() {
    if (!isAdminLoggedIn) return;

    // Request via WebSocket
    sendWsMessage({ type: 'GET_CONVERSATIONS' });

    // Fallback HTTP
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/conversations?adminPass=${ADMIN_PASSCODE}`, {
        headers: {
          'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
          'x-admin-pass': ADMIN_PASSCODE
        }
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.conversations)) {
        renderAdminConversationsList(data.conversations);
      }
    } catch (e) {}
  }

  if (btnRefreshConversations) {
    btnRefreshConversations.addEventListener('click', loadAdminConversations);
  }

  function renderAdminConversationsList(conversations) {
    adminConversations = conversations || [];
    if (adminConversations.length > 0) {
      const toVault = adminConversations.map(c => ({
        id: c.userId,
        username: c.username,
        createdAt: c.createdAt
      }));
      saveToAccountsVault(toVault);
    }
    if (!adminUserList) return;

    // Filter by search query if any
    const query = (adminUserSearchInput?.value || '').trim().toLowerCase();
    const filtered = adminConversations.filter(c => c.username.toLowerCase().includes(query));

    // Calculate total unread
    totalAdminUnread = adminConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    updateAdminBadges(totalAdminUnread);

    if (filtered.length === 0) {
      adminUserList.innerHTML = `
        <div class="admin-empty-notice">
          ${query ? 'No matching users found.' : 'No registered users have messaged yet.'}
        </div>
      `;
      return;
    }

    adminUserList.innerHTML = '';
    filtered.forEach(conv => {
      const card = document.createElement('div');
      card.className = `admin-user-card ${selectedConversationUserId === conv.userId ? 'active' : ''}`;
      card.dataset.userId = conv.userId;

      const initial = (conv.username || 'U')[0].toUpperCase();
      const lastText = conv.lastMessage ? conv.lastMessage.text : 'Account created';
      const timeStr = conv.lastMessage ? getCurrentTime(conv.lastMessage.timestamp) : 'New';

      card.innerHTML = `
        <div class="user-card-avatar">
          <span>${initial}</span>
          <span class="avatar-status-dot ${conv.online ? 'online' : ''}"></span>
        </div>
        <div class="user-card-details">
          <div class="user-card-top">
            <span class="user-card-name">@${conv.username}</span>
            <span class="user-card-time">${timeStr}</span>
          </div>
          <div class="user-card-snippet">${lastText}</div>
        </div>
        ${conv.unreadCount > 0 ? `<span class="user-unread-badge">${conv.unreadCount}</span>` : ''}
      `;

      card.addEventListener('click', () => {
        selectAdminUserConversation(conv);
      });

      adminUserList.appendChild(card);
    });
  }

  if (adminUserSearchInput) {
    adminUserSearchInput.addEventListener('input', () => {
      renderAdminConversationsList(adminConversations);
    });
  }

  function updateAdminBadges(count) {
    if (adminUnreadBadge) {
      if (count > 0) {
        adminUnreadBadge.textContent = count;
        adminUnreadBadge.classList.remove('hidden');
      } else {
        adminUnreadBadge.classList.add('hidden');
      }
    }
    if (adminChatTabBadge) {
      if (count > 0) {
        adminChatTabBadge.textContent = count;
        adminChatTabBadge.classList.remove('hidden');
      } else {
        adminChatTabBadge.classList.add('hidden');
      }
    }
  }

  const btnAdminBackToUsers = document.getElementById('btnAdminBackToUsers');
  if (btnAdminBackToUsers) {
    btnAdminBackToUsers.addEventListener('click', () => {
      const layout = document.querySelector('.admin-chat-layout');
      if (layout) layout.classList.remove('mobile-chat-active');
    });
  }

  async function selectAdminUserConversation(userConv) {
    selectedConversationUserId = userConv.userId;

    // Show chat pane on mobile devices
    const layout = document.querySelector('.admin-chat-layout');
    if (layout) layout.classList.add('mobile-chat-active');

    // Highlight in list
    document.querySelectorAll('.admin-user-card').forEach(el => {
      el.classList.toggle('active', el.dataset.userId === userConv.userId);
    });

    // Update Header
    if (targetUsernameDisplay) targetUsernameDisplay.textContent = `@${userConv.username}`;
    if (targetDetailsDisplay) targetDetailsDisplay.textContent = userConv.online ? 'Online right now' : 'Registered Member';
    if (targetStatusDot) {
      if (userConv.online) {
        targetStatusDot.classList.add('online');
      } else {
        targetStatusDot.classList.remove('online');
      }
    }

    // Enable Reply Bar
    if (adminChatInput) {
      adminChatInput.disabled = false;
      adminChatInput.placeholder = `Type reply to @${userConv.username}...`;
      adminChatInput.focus();
    }
    if (adminChatSendBtn) adminChatSendBtn.disabled = false;

    // Mark as read on server
    sendWsMessage({
      type: 'MARK_READ',
      targetUserId: userConv.userId
    });

    // Decrement unread visually
    userConv.unreadCount = 0;
    renderAdminConversationsList(adminConversations);

    // Fetch message history with this user
    loadAdminChatHistory(userConv.userId, userConv.username);
  }

  async function loadAdminChatHistory(userId, username) {
    if (!adminConversationMessages) return;

    adminConversationMessages.innerHTML = `
      <div class="admin-chat-placeholder">Loading messages with @${username}...</div>
    `;

    // 1. Request via WebSocket
    sendWsMessage({
      type: 'GET_CHAT_HISTORY',
      targetUserId: userId
    });

    // 2. Request via HTTP fallback with direct admin credentials
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat/history?userId=${userId}&adminPass=${ADMIN_PASSCODE}`, {
        headers: {
          'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
          'x-admin-pass': ADMIN_PASSCODE
        }
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.history)) {
        renderAdminChatMessages(data.history, username);
      } else {
        renderAdminChatMessages([], username);
      }
    } catch (e) {
      console.warn("Failed to load chat history:", e);
      renderAdminChatMessages([], username);
    }
  }

  function renderAdminChatMessages(messages, username) {
    if (!adminConversationMessages) return;

    if (!messages || messages.length === 0) {
      adminConversationMessages.innerHTML = `
        <div class="admin-chat-placeholder">
          <span class="placeholder-icon">💬</span>
          <p>No messages yet with @${username}. Send a message below to start the conversation!</p>
        </div>
      `;
      return;
    }

    adminConversationMessages.innerHTML = '';
    messages.forEach(m => {
      appendAdminConversationBubble(m, username);
    });
    adminConversationMessages.scrollTop = adminConversationMessages.scrollHeight;
  }

  function appendAdminConversationBubble(msg, username) {
    if (!adminConversationMessages) return;

    const placeholder = adminConversationMessages.querySelector('.admin-chat-placeholder');
    if (placeholder) placeholder.remove();

    const bubble = document.createElement('div');
    const isAdmin = msg.sender === 'admin';
    bubble.className = `message ${isAdmin ? 'msg-user' : 'msg-bot'}`; // Admin's own messages align to right
    bubble.innerHTML = `
      <div class="msg-sender">${isAdmin ? 'YOU (ADMIN)' : `@${username}`}</div>
      <div class="msg-bubble">${msg.text}</div>
      <div class="msg-time">${getCurrentTime(msg.timestamp)}</div>
    `;

    adminConversationMessages.appendChild(bubble);
    adminConversationMessages.scrollTop = adminConversationMessages.scrollHeight;
  }

  // Handle incoming message in real time on Admin screen
  function handleAdminIncomingMessage(userId, msg) {
    // If the active open conversation is this user, append live!
    if (selectedConversationUserId === userId) {
      const conv = adminConversations.find(c => c.userId === userId);
      appendAdminConversationBubble(msg, conv?.username || 'Customer');

      // Automatically mark read since admin is viewing it
      sendWsMessage({ type: 'MARK_READ', targetUserId: userId });
    } else {
      // Show sound/notification
      showToast(`💬 New message from customer!`);
    }

    // Refresh conversation list snippets & unread counts
    loadAdminConversations();
  }

  // Send Admin Reply to Customer
  function handleAdminSendReply(text) {
    if (!text || !text.trim() || !selectedConversationUserId) return;
    const cleanText = text.trim();

    const conv = adminConversations.find(c => c.userId === selectedConversationUserId);
    const username = conv?.username || 'Customer';

    // 1. Send via WebSocket
    const sent = sendWsMessage({
      type: 'SEND_MESSAGE',
      targetUserId: selectedConversationUserId,
      text: cleanText,
      adminPass: ADMIN_PASSCODE
    });

    // 2. Also send via HTTP fallback with admin credentials
    fetch(`${API_BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentAdminToken || ADMIN_PASSCODE}`,
        'x-admin-pass': ADMIN_PASSCODE
      },
      body: JSON.stringify({
        targetUserId: selectedConversationUserId,
        text: cleanText,
        adminPass: ADMIN_PASSCODE
      })
    }).then(r => r.json()).then(data => {
      if (data && data.success && data.message) {
        appendAdminConversationBubble(data.message, username);
      }
    }).catch(() => {});

    if (adminChatInput) adminChatInput.value = '';
  }

  if (adminChatForm) {
    adminChatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAdminSendReply(adminChatInput.value);
    });
  }

  // Admin Quick Canned Response Chips
  if (adminQuickReplies) {
    adminQuickReplies.querySelectorAll('.admin-canned-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const reply = chip.dataset.reply;
        if (reply && selectedConversationUserId) {
          handleAdminSendReply(reply);
        } else if (!selectedConversationUserId) {
          showToast('Please select a customer first from the left.');
        }
      });
    });
  }

  function handleTypingNotice(data) {
    const typingIndicator = document.getElementById('chatTypingIndicator');
    const typingText = document.getElementById('chatTypingText');
    if (!typingIndicator || !typingText) return;

    if (data.isTyping) {
      typingText.textContent = `${data.sender || data.username} is typing...`;
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.classList.add('hidden');
    }
  }


  /* =========================================================
     9. Live Blunt Smoke & Ember Particle Physics Engine
     ========================================================= */
  const smokeCanvas = document.getElementById('smokeCanvas');
  if (smokeCanvas) {
    const ctx = smokeCanvas.getContext('2d');
    let width = (smokeCanvas.width = window.innerWidth);
    let height = (smokeCanvas.height = window.innerHeight);

    function updateCanvasDimensions() {
      width = smokeCanvas.width = window.innerWidth;
      height = smokeCanvas.height = window.innerHeight;
    }

    window.addEventListener('resize', updateCanvasDimensions);
    window.addEventListener('orientationchange', () => {
      setTimeout(updateCanvasDimensions, 180);
    });

    // Calculates coordinates of Morty's blunt ember & Rick's bong based on background cover layout
    function getOriginCoords() {
      const imgAspect = 1.0;
      const screenAspect = width / height;
      let renderW, renderH, offsetX, offsetY;

      if (screenAspect > imgAspect) {
        renderW = width;
        renderH = width / imgAspect;
        offsetX = 0;
        offsetY = (height - renderH) / 2;
      } else {
        renderH = height;
        renderW = height * imgAspect;
        offsetX = (width - renderW) / 2;
        offsetY = 0;
      }

      return {
        blunt: {
          x: offsetX + renderW * 0.7969,
          y: offsetY + renderH * 0.3984
        },
        bong: {
          x: offsetX + renderW * 0.22,
          y: offsetY + renderH * 0.17
        }
      };
    }

    const smokeParticles = [];
    const emberSparks = [];
    const floatingLeaves = [];

    function createWeedLeafCanvas(size, color1, color2, glowColor) {
      const c = document.createElement('canvas');
      const d = Math.round(size * 2.6);
      c.width = d;
      c.height = d;
      const lctx = c.getContext('2d');
      const cx = d / 2;
      const cy = d * 0.62;

      lctx.shadowColor = glowColor;
      lctx.shadowBlur = 18;

      const leaflets = [
        { angle: 0, len: size * 1.0, w: size * 0.24 },
        { angle: -0.42, len: size * 0.82, w: size * 0.2 },
        { angle: 0.42, len: size * 0.82, w: size * 0.2 },
        { angle: -0.84, len: size * 0.62, w: size * 0.16 },
        { angle: 0.84, len: size * 0.62, w: size * 0.16 },
        { angle: -1.25, len: size * 0.42, w: size * 0.13 },
        { angle: 1.25, len: size * 0.42, w: size * 0.13 },
      ];

      lctx.beginPath();
      lctx.moveTo(cx, cy);
      lctx.lineTo(cx, cy + size * 0.35);
      lctx.strokeStyle = '#39ff14';
      lctx.lineWidth = Math.max(2, size * 0.06);
      lctx.lineCap = 'round';
      lctx.stroke();

      leaflets.forEach(l => {
        lctx.save();
        lctx.translate(cx, cy);
        lctx.rotate(l.angle);

        lctx.beginPath();
        lctx.moveTo(0, 0);
        lctx.bezierCurveTo(-l.w, -l.len * 0.35, -l.w * 0.85, -l.len * 0.7, 0, -l.len);
        lctx.bezierCurveTo(l.w * 0.85, -l.len * 0.7, l.w, -l.len * 0.35, 0, 0);

        const grad = lctx.createLinearGradient(0, -l.len, 0, 0);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        lctx.fillStyle = grad;
        lctx.fill();

        lctx.strokeStyle = '#ffffff';
        lctx.lineWidth = 1.2;
        lctx.stroke();

        lctx.beginPath();
        lctx.moveTo(0, 0);
        lctx.lineTo(0, -l.len * 0.85);
        lctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        lctx.lineWidth = 1.1;
        lctx.stroke();

        lctx.restore();
      });

      return { canvas: c, dim: d };
    }

    const leafSprites = [
      createWeedLeafCanvas(30, '#55ff22', '#10b981', 'rgba(57, 255, 20, 0.95)'),
      createWeedLeafCanvas(26, '#00ff88', '#059669', 'rgba(0, 255, 136, 0.95)'),
      createWeedLeafCanvas(34, '#a3e635', '#16a34a', 'rgba(163, 230, 53, 0.95)')
    ];

    class FloatingLeaf {
      constructor(isInitial = false) {
        this.reset(isInitial);
      }

      reset(isInitial = false) {
        this.x = Math.random() * width;
        this.y = isInitial ? Math.random() * height : -80 - Math.random() * 50;
        this.z = Math.random() * 0.55 + 0.45;
        this.speedY = (Math.random() * 0.55 + 0.35) * this.z;
        this.speedX = (Math.random() - 0.45) * 0.45;
        this.swayFreq = Math.random() * 0.02 + 0.01;
        this.swayAmp = Math.random() * 1.6 + 0.8;
        this.swayPhase = Math.random() * Math.PI * 2;
        this.rot = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.014;
        this.flutterFreq = Math.random() * 0.03 + 0.015;
        this.flutterPhase = Math.random() * Math.PI * 2;
        this.opacity = Math.random() * 0.25 + 0.75;
        this.spriteIdx = Math.floor(Math.random() * leafSprites.length);
        this.time = Math.random() * 1000;
      }

      update() {
        this.time += 1;
        this.y += this.speedY;
        this.x += this.speedX + Math.sin(this.time * this.swayFreq + this.swayPhase) * this.swayAmp;
        this.rot += this.rotSpeed;

        if (this.y > height + 90) {
          this.reset(false);
        }
        if (this.x < -90) this.x = width + 80;
        if (this.x > width + 90) this.x = -80;
      }

      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);

        const flutterScale = Math.sin(this.time * this.flutterFreq + this.flutterPhase);
        ctx.scale(this.z * flutterScale, this.z);

        ctx.globalAlpha = this.opacity;
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 14;
        const sp = leafSprites[this.spriteIdx];
        const half = sp.dim / 2;
        ctx.drawImage(sp.canvas, -half, -half);
        ctx.restore();
      }
    }

    for (let i = 0; i < 24; i++) {
      floatingLeaves.push(new FloatingLeaf(true));
    }

    class SmokeParticle {
      constructor(originX, originY, isBong = false) {
        this.reset(originX, originY, isBong);
      }

      reset(originX, originY, isBong = false) {
        this.x = originX + (Math.random() - 0.5) * 8;
        this.y = originY + (Math.random() - 0.5) * 6;
        this.isBong = isBong;
        this.size = Math.random() * 6 + 4;
        this.maxSize = isBong ? Math.random() * 65 + 40 : Math.random() * 55 + 35;
        this.growthRate = Math.random() * 0.35 + 0.2;
        this.vy = -(Math.random() * 1.3 + 0.8);
        this.vx = (Math.random() - 0.48) * 0.6;
        this.curlFreq = Math.random() * 0.04 + 0.02;
        this.curlAmp = Math.random() * 1.2 + 0.5;
        this.life = 0;
        this.maxLife = Math.random() * 140 + 90;
        this.opacity = Math.random() * 0.35 + 0.2;
        this.tint = isBong ? 'lime' : (Math.random() > 0.4 ? 'green' : 'white');
      }

      update(originX, originY) {
        this.life++;
        this.size = Math.min(this.maxSize, this.size + this.growthRate);
        this.y += this.vy;
        this.x += this.vx + Math.sin(this.life * this.curlFreq) * this.curlAmp;
        this.vy *= 0.995;

        const progress = this.life / this.maxLife;
        if (progress > 0.3) {
          this.currentOpacity = this.opacity * (1 - (progress - 0.3) / 0.7);
        } else {
          this.currentOpacity = this.opacity * (progress / 0.3);
        }

        if (this.life >= this.maxLife) {
          this.reset(originX, originY, this.isBong);
        }
      }

      draw() {
        if (this.currentOpacity <= 0) return;
        ctx.save();
        ctx.beginPath();
        const grad = ctx.createRadialGradient(
          this.x, this.y, 0,
          this.x, this.y, this.size
        );

        if (this.tint === 'green') {
          grad.addColorStop(0, `rgba(180, 255, 205, ${this.currentOpacity})`);
          grad.addColorStop(0.4, `rgba(57, 255, 20, ${this.currentOpacity * 0.45})`);
          grad.addColorStop(1, 'rgba(0, 255, 102, 0)');
        } else if (this.tint === 'lime') {
          grad.addColorStop(0, `rgba(200, 255, 220, ${this.currentOpacity * 0.8})`);
          grad.addColorStop(0.5, `rgba(0, 255, 102, ${this.currentOpacity * 0.3})`);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          grad.addColorStop(0, `rgba(240, 255, 245, ${this.currentOpacity * 0.75})`);
          grad.addColorStop(0.45, `rgba(160, 230, 180, ${this.currentOpacity * 0.35})`);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        ctx.fillStyle = grad;
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    class Spark {
      constructor(originX, originY) {
        this.reset(originX, originY);
      }
      reset(originX, originY) {
        this.x = originX + (Math.random() - 0.5) * 4;
        this.y = originY + (Math.random() - 0.5) * 4;
        this.vx = (Math.random() - 0.3) * 1.5;
        this.vy = -(Math.random() * 2.2 + 0.8);
        this.size = Math.random() * 2 + 1;
        this.life = 0;
        this.maxLife = Math.random() * 35 + 20;
        this.opacity = Math.random() * 0.8 + 0.2;
      }
      update(originX, originY) {
        this.life++;
        this.x += this.vx;
        this.y += this.vy;
        this.opacity = 1 - (this.life / this.maxLife);
        if (this.life >= this.maxLife) {
          if (Math.random() < 0.3) {
            this.reset(originX, originY);
          }
        }
      }
      draw() {
        if (this.opacity <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 140, 20, ${this.opacity})`;
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur = 6;
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const origins = getOriginCoords();
    for (let i = 0; i < 35; i++) {
      const p = new SmokeParticle(origins.blunt.x, origins.blunt.y, false);
      p.life = Math.floor(Math.random() * p.maxLife);
      smokeParticles.push(p);
    }
    for (let i = 0; i < 18; i++) {
      const p = new SmokeParticle(origins.bong.x, origins.bong.y, true);
      p.life = Math.floor(Math.random() * p.maxLife);
      smokeParticles.push(p);
    }
    for (let i = 0; i < 8; i++) {
      const s = new Spark(origins.blunt.x, origins.blunt.y);
      s.life = Math.floor(Math.random() * s.maxLife);
      emberSparks.push(s);
    }

    function renderBluntFX() {
      ctx.clearRect(0, 0, width, height);
      const coords = getOriginCoords();

      for (let i = 0; i < floatingLeaves.length; i++) {
        floatingLeaves[i].update();
        floatingLeaves[i].draw();
      }

      for (let i = 0; i < smokeParticles.length; i++) {
        const p = smokeParticles[i];
        const origin = p.isBong ? coords.bong : coords.blunt;
        p.update(origin.x, origin.y);
        p.draw();
      }

      for (let i = 0; i < emberSparks.length; i++) {
        emberSparks[i].update(coords.blunt.x, coords.blunt.y);
        emberSparks[i].draw();
      }

      const t = Date.now() * 0.003;
      const pulse = Math.sin(t) * 0.35 + 0.65;
      const emberRadius = 14 + pulse * 6;

      ctx.save();
      const emberGrad = ctx.createRadialGradient(
        coords.blunt.x, coords.blunt.y, 0,
        coords.blunt.x, coords.blunt.y, emberRadius
      );
      emberGrad.addColorStop(0, `rgba(255, 235, 140, ${0.95 * pulse})`);
      emberGrad.addColorStop(0.3, `rgba(255, 110, 20, ${0.85 * pulse})`);
      emberGrad.addColorStop(0.65, `rgba(255, 30, 0, ${0.45 * pulse})`);
      emberGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');

      ctx.fillStyle = emberGrad;
      ctx.beginPath();
      ctx.arc(coords.blunt.x, coords.blunt.y, emberRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 200, ${0.9 * pulse})`;
      ctx.arc(coords.blunt.x, coords.blunt.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      requestAnimationFrame(renderBluntFX);
    }

    renderBluntFX();
  }

});
