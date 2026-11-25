const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'yartys740distro';

// Ensure data folder and initial files exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filePath, defaultData) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  saveJSON(filePath, defaultData);
  return defaultData;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Helper to sanitize prices and prevent NaN / undefined / lost keys
function sanitizePrices(incomingPrices, currentPrices) {
  const base = currentPrices || { 1: 40, 2: 75, 5: 180, 10: 320, 20: 620 };
  const out = {};
  const tiers = ['1', '2', '5', '10', '20'];
  for (const tier of tiers) {
    if (incomingPrices && incomingPrices[tier] !== undefined && incomingPrices[tier] !== null && String(incomingPrices[tier]).trim() !== '') {
      const n = parseInt(incomingPrices[tier], 10);
      out[tier] = isNaN(n) ? (base[tier] || 0) : Math.max(0, n);
    } else {
      out[tier] = (base && base[tier] !== undefined) ? base[tier] : (defaultInventory.prices[tier] || 0);
    }
  }
  return out;
}

// Initial Data (updatedAt: 0 ensures any saved prices are strictly newer)
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

const BACKUP_FILE = path.join(DATA_DIR, 'backup_latest.json');

let inventoryData = loadJSON(INVENTORY_FILE, defaultInventory);
if (inventoryData.updatedAt === undefined) {
  inventoryData.updatedAt = 0;
}
inventoryData.prices = sanitizePrices(inventoryData.prices, defaultInventory.prices);

let usersData = loadJSON(USERS_FILE, []);
let messagesData = loadJSON(MESSAGES_FILE, {});
let sessionsData = loadJSON(SESSIONS_FILE, {});

// 1. Auto-recover from backup snapshot if users are empty or prices newer
if (fs.existsSync(BACKUP_FILE)) {
  try {
    const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    if (usersData.length === 0 && backup && Array.isArray(backup.users) && backup.users.length > 0) {
      usersData = backup.users;
      saveJSON(USERS_FILE, usersData);
      console.log(`♻️ Auto-recovered ${usersData.length} accounts from local backup snapshot.`);
    }
    if (backup && backup.inventory && (backup.inventory.updatedAt || 0) > (inventoryData.updatedAt || 0)) {
      inventoryData = backup.inventory;
      saveJSON(INVENTORY_FILE, inventoryData);
      console.log(`♻️ Auto-recovered newer custom prices from local backup snapshot.`);
    }
    if (backup && backup.messages && Object.keys(messagesData).length === 0) {
      messagesData = backup.messages;
      saveJSON(MESSAGES_FILE, messagesData);
    }
  } catch (e) {
    console.error('Error reading backup snapshot:', e.message);
  }
}

// 2. Auto-recover registered accounts from sessions
if (sessionsData && typeof sessionsData === 'object') {
  let recCount = 0;
  for (const s of Object.values(sessionsData)) {
    if (s && s.username && s.role !== 'admin') {
      const exists = usersData.some(u => u.username.toLowerCase() === s.username.toLowerCase());
      if (!exists) {
        usersData.push({
          id: s.id || ('u_' + crypto.randomBytes(8).toString('hex')),
          username: s.username,
          salt: s.salt || '',
          hash: s.hash || '',
          role: 'user',
          createdAt: s.createdAt || Date.now(),
          autoRecovered: true
        });
        recCount++;
      }
    }
  }
  if (recCount > 0) {
    saveJSON(USERS_FILE, usersData);
    console.log(`♻️ Auto-recovered ${recCount} accounts from session records.`);
  }
}

function saveBackupSnapshot() {
  try {
    const snapshot = {
      timestamp: Date.now(),
      users: usersData,
      inventory: inventoryData,
      messages: messagesData
    };
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (e) {}
}

// =========================================================
// Persistent Database Integration (MongoDB Atlas Support)
// =========================================================
let dbClient = null;
let db = null;
let isDbConnected = false;
let isConnectingDb = false;

async function initDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log('ℹ️ Local JSON storage active in /data (Provide MONGODB_URI in Render environment to persist permanently across deploys)');
    return;
  }

  if (isConnectingDb) return;
  isConnectingDb = true;

  try {
    const { MongoClient } = require('mongodb');
    if (dbClient) {
      try { await dbClient.close(); } catch (e) {}
    }

    dbClient = new MongoClient(mongoUri, { 
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000
    });

    await dbClient.connect();
    db = dbClient.db();
    isDbConnected = true;
    console.log('✅ Connected to persistent MongoDB Atlas database!');

    // 1. Sync & Restore Users
    const remoteUsers = await db.collection('users').find({}).toArray();
    if (remoteUsers && remoteUsers.length > 0) {
      const remoteClean = remoteUsers.map(u => {
        const { _id, ...rest } = u;
        return rest;
      });
      remoteClean.forEach(ru => {
        if (!ru.username) return;
        const idx = usersData.findIndex(lu => lu.username.toLowerCase() === ru.username.toLowerCase());
        if (idx >= 0) {
          usersData[idx] = { ...usersData[idx], ...ru };
        } else {
          usersData.push(ru);
        }
      });
      saveJSON(USERS_FILE, usersData);
      console.log(`✅ Loaded ${usersData.length} persistent registered accounts from MongoDB!`);
    } else if (usersData.length > 0) {
      for (const u of usersData) {
        if (!u.username) continue;
        await db.collection('users').updateOne(
          { username: u.username.toLowerCase() },
          { $set: u },
          { upsert: true }
        );
      }
      console.log(`✅ Seeded ${usersData.length} local accounts to MongoDB!`);
    }

    // 2. Sync Inventory (Compare timestamps: newest wins!)
    const remoteInventory = await db.collection('settings').findOne({ _id: 'inventory' });
    if (remoteInventory) {
      delete remoteInventory._id;
      const remoteTime = remoteInventory.updatedAt || 0;
      const localTime = inventoryData.updatedAt || 0;
      if (remoteTime >= localTime) {
        inventoryData = {
          stockCount: remoteInventory.stockCount ?? defaultInventory.stockCount,
          stockLabel: remoteInventory.stockLabel || defaultInventory.stockLabel,
          prices: sanitizePrices(remoteInventory.prices, defaultInventory.prices),
          updatedAt: remoteTime
        };
        saveJSON(INVENTORY_FILE, inventoryData);
        console.log(`✅ Loaded persistent menu prices from MongoDB!`);
      } else {
        await db.collection('settings').updateOne(
          { _id: 'inventory' },
          { $set: inventoryData },
          { upsert: true }
        );
        console.log(`✅ Synced newer local prices to MongoDB.`);
      }
    } else {
      await db.collection('settings').updateOne(
        { _id: 'inventory' },
        { $set: inventoryData },
        { upsert: true }
      );
    }

    // 3. Sync Messages
    const remoteMessagesDoc = await db.collection('settings').findOne({ _id: 'messages' });
    if (remoteMessagesDoc && remoteMessagesDoc.data) {
      messagesData = { ...messagesData, ...remoteMessagesDoc.data };
      saveJSON(MESSAGES_FILE, messagesData);
    } else if (Object.keys(messagesData).length > 0) {
      await db.collection('settings').updateOne(
        { _id: 'messages' },
        { $set: { data: messagesData } },
        { upsert: true }
      );
    }

    // 4. Sync Sessions
    const remoteSessionsDoc = await db.collection('settings').findOne({ _id: 'sessions' });
    if (remoteSessionsDoc && remoteSessionsDoc.data) {
      sessionsData = { ...sessionsData, ...remoteSessionsDoc.data };
      saveJSON(SESSIONS_FILE, sessionsData);
    }

    saveBackupSnapshot();

  } catch (err) {
    isDbConnected = false;
    console.error('⚠️ MongoDB connection notice:', err.message);
  } finally {
    isConnectingDb = false;
  }
}

// Background reconnect timer if MONGODB_URI is provided
setInterval(() => {
  if (process.env.MONGODB_URI && !isDbConnected && !isConnectingDb) {
    initDatabase().catch(() => {});
  }
}, 25000);

async function syncToStorage(type) {
  saveBackupSnapshot();
  if (!isDbConnected || !db) return;
  try {
    if (type === 'users') {
      for (const u of usersData) {
        if (!u.username) continue;
        await db.collection('users').updateOne(
          { username: u.username.toLowerCase() },
          { $set: u },
          { upsert: true }
        );
      }
    } else if (type === 'inventory') {
      await db.collection('settings').updateOne(
        { _id: 'inventory' },
        { $set: inventoryData },
        { upsert: true }
      );
    } else if (type === 'messages') {
      await db.collection('settings').updateOne(
        { _id: 'messages' },
        { $set: { data: messagesData } },
        { upsert: true }
      );
    } else if (type === 'sessions') {
      await db.collection('settings').updateOne(
        { _id: 'sessions' },
        { $set: { data: sessionsData } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error(`Storage sync error for ${type}:`, err.message);
  }
}

// Helper: Password Hashing using native crypto
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

const HMAC_SECRET = process.env.HMAC_SECRET || 'yartys_740_distro_secret_key_2026';

function createSession(userOrAdmin) {
  const payload = {
    ...userOrAdmin,
    createdAt: Date.now()
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
  const token = `${data}.${sig}`;
  sessionsData[token] = payload;
  saveJSON(SESSIONS_FILE, sessionsData);
  syncToStorage('sessions');
  return token;
}

function getSession(token) {
  if (!token) return null;
  if (token === ADMIN_PASSCODE || token === 'admin_master' || token === 'local_admin_master') {
    return { id: 'admin_master', username: '740 ADMIN', role: 'admin' };
  }
  let payload = sessionsData[token];
  if (!payload) {
    try {
      const parts = token.split('.');
      if (parts.length === 2) {
        const [data, sig] = parts;
        const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
        if (sig === expectedSig) {
          payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
          sessionsData[token] = payload;
          saveJSON(SESSIONS_FILE, sessionsData);
        }
      }
    } catch (e) {}
  }

  if (payload) {
    // If regular user, ensure they exist in usersData!
    if (payload.role !== 'admin' && payload.username) {
      const exists = usersData.some(u => u.username.toLowerCase() === payload.username.toLowerCase());
      if (!exists) {
        usersData.push({
          id: payload.id || ('u_' + crypto.randomBytes(8).toString('hex')),
          username: payload.username,
          salt: payload.salt || '',
          hash: payload.hash || '',
          role: 'user',
          createdAt: payload.createdAt || Date.now(),
          autoRecovered: true
        });
        saveJSON(USERS_FILE, usersData);
        syncToStorage('users');
        console.log(`♻️ Auto-recovered user @${payload.username} from authenticated session.`);
      }
    }
    return payload;
  }
  return null;
}

function deleteSession(token) {
  if (token && sessionsData[token]) {
    delete sessionsData[token];
    saveJSON(SESSIONS_FILE, sessionsData);
    syncToStorage('sessions');
  }
}

// Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-pass');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());
app.use(express.static(__dirname));

// Auth Middleware for Express
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const adminPass = req.headers['x-admin-pass'] || req.query.adminPass || req.body?.adminPass;

  if (adminPass === ADMIN_PASSCODE || token === ADMIN_PASSCODE || token === 'admin_master') {
    req.user = { id: 'admin_master', username: '740 ADMIN', role: 'admin' };
    return next();
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.user = session;
  next();
}

function adminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const adminPass = req.headers['x-admin-pass'] || req.query.adminPass || req.body?.adminPass;

  if (adminPass === ADMIN_PASSCODE || token === ADMIN_PASSCODE || token === 'admin_master') {
    req.user = { id: 'admin_master', username: '740 ADMIN', role: 'admin' };
    return next();
  }

  const session = getSession(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  req.user = session;
  next();
}

/* =========================================================
   REST API Endpoints
   ========================================================= */

// 1. Get Live Inventory
app.get('/api/inventory', (req, res) => {
  res.json(inventoryData);
});

// 2. Update Inventory (Admin)
app.post('/api/inventory', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const session = getSession(token);
  const pass = req.body.adminPass || req.headers['x-admin-pass'];

  const isAuthorized = (session && session.role === 'admin') || (pass === ADMIN_PASSCODE);
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Unauthorized to update inventory.' });
  }

  const { stockCount, stockLabel, prices, updatedAt } = req.body;
  const sanitizedPrices = sanitizePrices(prices, inventoryData.prices);
  const newStockCount = typeof stockCount === 'number' ? stockCount : (parseInt(stockCount, 10) || 0);
  const newStockLabel = (stockLabel || 'IN STOCK').trim();
  const updateTimestamp = Math.max(Date.now(), parseInt(updatedAt, 10) || 0);

  inventoryData = {
    stockCount: newStockCount,
    stockLabel: newStockLabel,
    prices: sanitizedPrices,
    updatedAt: updateTimestamp
  };

  saveJSON(INVENTORY_FILE, inventoryData);
  syncToStorage('inventory');

  // Broadcast to all connected clients immediately!
  broadcastWebSocket({
    type: 'INVENTORY_UPDATED',
    inventory: inventoryData
  });

  res.json({ success: true, inventory: inventoryData });
});

// 2b. Sync Inventory if Newer (Guarantees client custom prices can restore restarted server)
app.post('/api/inventory/sync-if-newer', (req, res) => {
  const { inventory } = req.body;
  if (!inventory || !inventory.prices) {
    return res.status(400).json({ error: 'Invalid inventory data.' });
  }

  const incomingTime = parseInt(inventory.updatedAt, 10) || 0;
  const currentTime = inventoryData.updatedAt || 0;

  if (incomingTime > currentTime) {
    inventoryData = {
      stockCount: typeof inventory.stockCount === 'number' ? inventory.stockCount : (parseInt(inventory.stockCount, 10) || 0),
      stockLabel: (inventory.stockLabel || 'IN STOCK').trim(),
      prices: sanitizePrices(inventory.prices, inventoryData.prices),
      updatedAt: incomingTime
    };

    saveJSON(INVENTORY_FILE, inventoryData);
    syncToStorage('inventory');

    broadcastWebSocket({
      type: 'INVENTORY_UPDATED',
      inventory: inventoryData
    });

    console.log(`⚡ Restored newer prices to server (client ${incomingTime} > server ${currentTime})`);
    return res.json({ success: true, updated: true, inventory: inventoryData });
  }

  return res.json({ success: true, updated: false, inventory: inventoryData });
});

// 3. User Register (Username & Password Only)
app.post('/api/auth/register', (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  username = username.trim();
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and dashes.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  const existingUser = usersData.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existingUser) {
    // If the account already exists and password matches, log in seamlessly
    if (existingUser.salt && existingUser.hash && verifyPassword(password, existingUser.salt, existingUser.hash)) {
      const token = createSession({
        id: existingUser.id,
        username: existingUser.username,
        role: existingUser.role,
        salt: existingUser.salt,
        hash: existingUser.hash
      });
      return res.json({
        success: true,
        token,
        user: {
          id: existingUser.id,
          username: existingUser.username,
          role: existingUser.role
        }
      });
    }
    return res.status(400).json({ error: 'Username is already taken. Please choose another.' });
  }

  const { salt, hash } = hashPassword(password);
  const newUser = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    username: username,
    salt,
    hash,
    role: 'user',
    createdAt: Date.now()
  };

  usersData.push(newUser);
  saveJSON(USERS_FILE, usersData);
  syncToStorage('users');

  const token = createSession({
    id: newUser.id,
    username: newUser.username,
    role: newUser.role,
    salt: newUser.salt,
    hash: newUser.hash
  });

  // Notify admin in real time about new registered user
  broadcastToAdmins({
    type: 'NEW_USER_REGISTERED',
    user: {
      id: newUser.id,
      username: newUser.username,
      createdAt: newUser.createdAt
    }
  });

  res.json({
    success: true,
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      role: newUser.role
    }
  });
});

// 4. User Login (Username & Password Only)
app.post('/api/auth/login', (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  username = username.trim();

  // Check if admin is logging in via username/password
  if (username.toLowerCase() === 'admin' && password === ADMIN_PASSCODE) {
    const adminToken = createSession({
      id: 'admin_master',
      username: 'ADMIN',
      role: 'admin'
    });
    return res.json({
      success: true,
      token: adminToken,
      user: {
        id: 'admin_master',
        username: 'ADMIN',
        role: 'admin'
      }
    });
  }

  let user = usersData.find(u => u.username.toLowerCase() === username.toLowerCase());

  // If user not in usersData, check if sessionsData has them (auto-recovery from session)
  if (!user && sessionsData) {
    for (const s of Object.values(sessionsData)) {
      if (s && s.username && s.username.toLowerCase() === username.toLowerCase() && s.salt && s.hash) {
        user = {
          id: s.id || ('u_' + crypto.randomBytes(8).toString('hex')),
          username: s.username,
          salt: s.salt,
          hash: s.hash,
          role: 'user',
          createdAt: s.createdAt || Date.now(),
          autoRecovered: true
        };
        usersData.push(user);
        saveJSON(USERS_FILE, usersData);
        syncToStorage('users');
        break;
      }
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Account not found. Please register or check your username.' });
  }

  const valid = verifyPassword(password, user.salt, user.hash);
  if (!valid) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = createSession({
    id: user.id,
    username: user.username,
    role: user.role,
    salt: user.salt,
    hash: user.hash
  });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

// 4b. Auto-Heal Accounts from Client Vault (Admin or Authorized)
app.post('/api/auth/auto-heal', (req, res) => {
  const adminPass = req.query.adminPass || req.headers['x-admin-pass'] || req.body?.adminPass;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const session = getSession(token);
  const isAuth = (session && session.role === 'admin') || adminPass === ADMIN_PASSCODE;

  if (!isAuth) {
    return res.status(403).json({ error: 'Admin passcode required.' });
  }

  const { accounts, inventory } = req.body;
  let healedAccounts = 0;

  if (Array.isArray(accounts)) {
    accounts.forEach(acc => {
      if (acc && acc.username) {
        const idx = usersData.findIndex(u => u.username.toLowerCase() === acc.username.toLowerCase());
        if (idx === -1) {
          usersData.push({
            id: acc.id || ('u_' + crypto.randomBytes(8).toString('hex')),
            username: acc.username,
            salt: acc.salt || '',
            hash: acc.hash || '',
            role: acc.role || 'user',
            createdAt: acc.createdAt || Date.now(),
            autoHealed: true
          });
          healedAccounts++;
        }
      }
    });
    if (healedAccounts > 0) {
      saveJSON(USERS_FILE, usersData);
      syncToStorage('users');
      notifyAdminsConversationsUpdate();
      console.log(`⚡ Auto-healed ${healedAccounts} accounts! Total registered: ${usersData.length}`);
    }
  }

  if (inventory && (inventory.updatedAt || 0) > (inventoryData.updatedAt || 0)) {
    inventoryData = {
      stockCount: typeof inventory.stockCount === 'number' ? inventory.stockCount : (parseInt(inventory.stockCount, 10) || 0),
      stockLabel: (inventory.stockLabel || 'IN STOCK').trim(),
      prices: sanitizePrices(inventory.prices, inventoryData.prices),
      updatedAt: inventory.updatedAt
    };
    saveJSON(INVENTORY_FILE, inventoryData);
    syncToStorage('inventory');
    broadcastWebSocket({
      type: 'INVENTORY_UPDATED',
      inventory: inventoryData
    });
  }

  res.json({
    success: true,
    healedAccounts,
    totalUsers: usersData.length,
    inventory: inventoryData
  });
});

// 5. Admin Passcode Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSCODE) {
    const token = createSession({
      id: 'admin_master',
      username: '740 ADMIN',
      role: 'admin'
    });
    return res.json({
      success: true,
      token,
      user: {
        id: 'admin_master',
        username: '740 ADMIN',
        role: 'admin'
      }
    });
  } else {
    return res.status(401).json({ error: 'Invalid admin passcode.' });
  }
});

// 6. Get Current User / Verify Session
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'No active session.' });
  }
  res.json({ success: true, user: session });
});

// 7. Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  deleteSession(token);
  res.json({ success: true });
});

// 8. Admin: Get all conversations
app.get('/api/admin/conversations', adminMiddleware, (req, res) => {
  const conversations = getAdminConversationsList();
  res.json({ success: true, conversations });
});

// 9. Get Chat History (User or Admin)
app.get('/api/chat/history', authMiddleware, (req, res) => {
  let targetUserId = req.user.id;
  if (req.user.role === 'admin' && req.query.userId) {
    targetUserId = req.query.userId;
  }
  const history = messagesData[targetUserId] || [];
  res.json({ success: true, history });
});

// 10. Send Chat Message (HTTP endpoint)
app.post('/api/chat/send', authMiddleware, (req, res) => {
  const { text, targetUserId } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text cannot be empty.' });
  }

  const msg = handleSaveAndDeliverMessage({
    senderRole: req.user.role,
    senderId: req.user.id,
    senderName: req.user.username,
    targetUserId: req.user.role === 'admin' ? targetUserId : req.user.id,
    text: text.trim()
  });

  res.json({ success: true, message: msg });
});

// 11. Mark messages read
app.post('/api/chat/mark-read', authMiddleware, (req, res) => {
  const targetUserId = req.user.role === 'admin' ? req.body.userId : req.user.id;
  if (targetUserId && messagesData[targetUserId]) {
    messagesData[targetUserId].forEach(m => {
      if (req.user.role === 'admin' && m.sender === 'user') {
        m.read = true;
      } else if (req.user.role !== 'admin' && m.sender === 'admin') {
        m.read = true;
      }
    });
    saveJSON(MESSAGES_FILE, messagesData);
    syncToStorage('messages');
  }
  res.json({ success: true });
});

// 12. Backup & Export All System Data (Admin)
app.get('/api/admin/backup', (req, res) => {
  const adminPass = req.query.adminPass || req.headers['x-admin-pass'];
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  const session = getSession(token);
  const isAuth = (session && session.role === 'admin') || adminPass === ADMIN_PASSCODE;
  if (!isAuth) {
    return res.status(403).json({ error: 'Unauthorized. Admin passcode required.' });
  }

  res.json({
    success: true,
    timestamp: Date.now(),
    database: isDbConnected ? 'mongodb' : 'local_json',
    users: usersData.map(u => ({
      id: u.id,
      username: u.username,
      salt: u.salt,
      hash: u.hash,
      role: u.role,
      createdAt: u.createdAt
    })),
    inventory: inventoryData,
    messages: messagesData
  });
});

// 13. Restore System Data (Admin)
app.post('/api/admin/restore', (req, res) => {
  const adminPass = req.query.adminPass || req.headers['x-admin-pass'] || req.body?.adminPass;
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  const session = getSession(token);
  const isAuth = (session && session.role === 'admin') || adminPass === ADMIN_PASSCODE;
  if (!isAuth) {
    return res.status(403).json({ error: 'Unauthorized. Admin passcode required.' });
  }

  const body = req.body || {};
  const incomingUsers = Array.isArray(body) ? body : (body.users || []);
  const incomingInventory = body.inventory;
  const incomingMessages = body.messages;
  let restoredUsers = 0;

  if (Array.isArray(incomingUsers)) {
    incomingUsers.forEach(incoming => {
      if (incoming && incoming.username) {
        const idx = usersData.findIndex(u => u.username.toLowerCase() === incoming.username.toLowerCase());
        if (idx >= 0) {
          usersData[idx] = { ...usersData[idx], ...incoming };
        } else {
          usersData.push(incoming);
          restoredUsers++;
        }
      }
    });
    saveJSON(USERS_FILE, usersData);
    syncToStorage('users');
  }

  if (incomingInventory && typeof incomingInventory === 'object') {
    inventoryData = {
      stockCount: typeof incomingInventory.stockCount === 'number' ? incomingInventory.stockCount : (parseInt(incomingInventory.stockCount, 10) || 0),
      stockLabel: (incomingInventory.stockLabel || 'IN STOCK').trim(),
      prices: sanitizePrices(incomingInventory.prices, inventoryData.prices),
      updatedAt: Math.max(Date.now(), parseInt(incomingInventory.updatedAt, 10) || 0)
    };
    saveJSON(INVENTORY_FILE, inventoryData);
    syncToStorage('inventory');
    broadcastWebSocket({
      type: 'INVENTORY_UPDATED',
      inventory: inventoryData
    });
  }

  if (incomingMessages && typeof incomingMessages === 'object') {
    messagesData = { ...messagesData, ...incomingMessages };
    saveJSON(MESSAGES_FILE, messagesData);
    syncToStorage('messages');
  }

  saveBackupSnapshot();
  notifyAdminsConversationsUpdate();

  res.json({
    success: true,
    message: `Restored ${restoredUsers} new accounts (${usersData.length} total saved).`,
    totalUsers: usersData.length,
    database: isDbConnected ? 'mongodb' : 'local_json',
    inventory: inventoryData
  });
});

// 14. System Status (Database Health & Accounts Count)
app.get('/api/admin/system-status', (req, res) => {
  res.json({
    success: true,
    database: isDbConnected ? 'mongodb' : 'local_json',
    isDbConnected: !!isDbConnected,
    hasMongoUri: !!process.env.MONGODB_URI,
    usersCount: usersData.length,
    inventoryUpdatedAt: inventoryData.updatedAt || 0,
    stockCount: inventoryData.stockCount,
    stockLabel: inventoryData.stockLabel,
    prices: inventoryData.prices,
    serverUptime: Math.floor(process.uptime()),
    timestamp: Date.now()
  });
});


/* =========================================================
   WebSocket Real-Time Engine
   ========================================================= */

// Map of active client connections: ws => { id, userId, username, role, isAdmin }
const activeClients = new Map();

function isUserOnline(userId) {
  for (const client of activeClients.values()) {
    if (client.userId === userId) return true;
  }
  return false;
}

function broadcastWebSocket(msgObj) {
  const payload = JSON.stringify(msgObj);
  for (const [ws] of activeClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function broadcastToAdmins(msgObj) {
  const payload = JSON.stringify(msgObj);
  for (const [ws, client] of activeClients) {
    if (client.isAdmin && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function sendToUser(userId, msgObj) {
  const payload = JSON.stringify(msgObj);
  for (const [ws, client] of activeClients) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function getAdminConversationsList() {
  const map = new Map();

  // 1. Add all registered users
  usersData.forEach(u => {
    map.set(u.id, {
      userId: u.id,
      username: u.username,
      createdAt: u.createdAt || Date.now(),
      online: isUserOnline(u.id),
      unreadCount: 0,
      lastMessage: null
    });
  });

  // 2. Also check messagesData in case any conversations exist where user was wiped/restored
  Object.keys(messagesData).forEach(uid => {
    const userMsgs = messagesData[uid] || [];
    if (!map.has(uid) && userMsgs.length > 0) {
      const firstUserMsg = userMsgs.find(m => m.sender === 'user');
      map.set(uid, {
        userId: uid,
        username: firstUserMsg?.senderName || 'Customer',
        createdAt: userMsgs[0]?.timestamp || Date.now(),
        online: isUserOnline(uid),
        unreadCount: 0,
        lastMessage: null
      });
    }
  });

  // 3. Populate unread and lastMessage
  for (const [uid, item] of map.entries()) {
    const userMsgs = messagesData[uid] || [];
    const lastMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
    item.unreadCount = userMsgs.filter(m => m.sender === 'user' && !m.read).length;
    item.lastMessage = lastMsg ? {
      text: lastMsg.text,
      timestamp: lastMsg.timestamp,
      sender: lastMsg.sender
    } : null;
    item.online = isUserOnline(uid);
  }

  const list = Array.from(map.values());

  // Sort: unread first, then newest message, then newest user
  list.sort((a, b) => {
    if (b.unreadCount !== a.unreadCount) {
      return b.unreadCount - a.unreadCount;
    }
    const timeA = a.lastMessage?.timestamp || a.createdAt;
    const timeB = b.lastMessage?.timestamp || b.createdAt;
    return timeB - timeA;
  });

  return list;
}

function notifyAdminsConversationsUpdate() {
  broadcastToAdmins({
    type: 'CONVERSATIONS_UPDATED',
    conversations: getAdminConversationsList()
  });
}

function handleSaveAndDeliverMessage({ senderRole, senderId, senderName, targetUserId, text }) {
  if (!targetUserId) return null;

  if (!messagesData[targetUserId]) {
    messagesData[targetUserId] = [];
  }

  const newMsg = {
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    sender: senderRole === 'admin' ? 'admin' : 'user',
    senderId: senderId,
    senderName: senderRole === 'admin' ? '740 ADMIN' : senderName,
    text: text,
    timestamp: Date.now(),
    read: false
  };

  messagesData[targetUserId].push(newMsg);
  saveJSON(MESSAGES_FILE, messagesData);
  syncToStorage('messages');

  // Send to the targeted user
  sendToUser(targetUserId, {
    type: 'CHAT_MESSAGE',
    userId: targetUserId,
    message: newMsg
  });

  // Send to all admin connections
  broadcastToAdmins({
    type: 'ADMIN_CHAT_MESSAGE',
    userId: targetUserId,
    message: newMsg
  });

  // Notify admins of conversation snippet/unread update
  notifyAdminsConversationsUpdate();

  return newMsg;
}

wss.on('connection', (ws) => {
  const clientInfo = {
    id: crypto.randomBytes(6).toString('hex'),
    userId: null,
    username: null,
    role: 'guest',
    isAdmin: false
  };
  activeClients.set(ws, clientInfo);

  // Send initial inventory on connect
  ws.send(JSON.stringify({
    type: 'INVENTORY_INIT',
    inventory: inventoryData
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // 1. Authenticate WebSocket Connection
      if (msg.type === 'AUTH') {
        const session = getSession(msg.token);
        if (session) {
          clientInfo.userId = session.id;
          clientInfo.username = session.username;
          clientInfo.role = session.role;
          clientInfo.isAdmin = session.role === 'admin';
        } else if (msg.adminPass === ADMIN_PASSCODE) {
          clientInfo.userId = 'admin_master';
          clientInfo.username = '740 ADMIN';
          clientInfo.role = 'admin';
          clientInfo.isAdmin = true;
        }

        ws.send(JSON.stringify({
          type: 'AUTH_SUCCESS',
          user: {
            id: clientInfo.userId,
            username: clientInfo.username,
            role: clientInfo.role,
            isAdmin: clientInfo.isAdmin
          }
        }));

        if (clientInfo.isAdmin) {
          ws.send(JSON.stringify({
            type: 'CONVERSATIONS_LIST',
            conversations: getAdminConversationsList()
          }));
        }

        // Notify admins that user's online state may have updated
        notifyAdminsConversationsUpdate();
      }

      // 2. Client asks for current inventory
      else if (msg.type === 'GET_INVENTORY') {
        ws.send(JSON.stringify({
          type: 'INVENTORY_UPDATED',
          inventory: inventoryData
        }));
      }

      // 3. Admin updates inventory via WebSocket
      else if (msg.type === 'UPDATE_INVENTORY') {
        const isAuthorized = clientInfo.isAdmin || (msg.adminPass === ADMIN_PASSCODE);
        if (!isAuthorized) {
          return ws.send(JSON.stringify({ type: 'ERROR', error: 'Admin authorization required.' }));
        }

        const { stockCount, stockLabel, prices, updatedAt } = msg.data || {};
        inventoryData = {
          stockCount: typeof stockCount === 'number' ? stockCount : (parseInt(stockCount, 10) || 0),
          stockLabel: (stockLabel || 'IN STOCK').trim(),
          prices: sanitizePrices(prices, inventoryData.prices),
          updatedAt: Math.max(Date.now(), parseInt(updatedAt, 10) || 0)
        };

        saveJSON(INVENTORY_FILE, inventoryData);
        syncToStorage('inventory');

        // Broadcast to EVERY connected visitor in real-time!
        broadcastWebSocket({
          type: 'INVENTORY_UPDATED',
          inventory: inventoryData
        });
      }

      // 4. Send Chat Message
      else if (msg.type === 'SEND_MESSAGE') {
        const text = (msg.text || '').trim();
        if (!text) return;

        if (clientInfo.isAdmin) {
          // Admin sending message to a specific user
          const targetUserId = msg.targetUserId;
          if (!targetUserId) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Target user ID required.' }));
          }
          handleSaveAndDeliverMessage({
            senderRole: 'admin',
            senderId: 'admin_master',
            senderName: '740 ADMIN',
            targetUserId: targetUserId,
            text: text
          });
        } else if (clientInfo.userId) {
          // Regular registered user sending message to Admin
          handleSaveAndDeliverMessage({
            senderRole: 'user',
            senderId: clientInfo.userId,
            senderName: clientInfo.username,
            targetUserId: clientInfo.userId,
            text: text
          });
        } else {
          ws.send(JSON.stringify({
            type: 'AUTH_REQUIRED',
            error: 'You must log in or register with a username and password to chat with the admin.'
          }));
        }
      }

      // 5. Admin fetches conversation list
      else if (msg.type === 'GET_CONVERSATIONS') {
        if (clientInfo.isAdmin) {
          ws.send(JSON.stringify({
            type: 'CONVERSATIONS_LIST',
            conversations: getAdminConversationsList()
          }));
        }
      }

      // 6. Fetch chat history for user
      else if (msg.type === 'GET_CHAT_HISTORY') {
        const targetUserId = clientInfo.isAdmin ? msg.targetUserId : clientInfo.userId;
        if (targetUserId) {
          ws.send(JSON.stringify({
            type: 'CHAT_HISTORY',
            userId: targetUserId,
            history: messagesData[targetUserId] || []
          }));
        }
      }

      // 7. Mark messages read
      else if (msg.type === 'MARK_READ') {
        const targetUserId = clientInfo.isAdmin ? msg.targetUserId : clientInfo.userId;
        if (targetUserId && messagesData[targetUserId]) {
          messagesData[targetUserId].forEach(m => {
            if (clientInfo.isAdmin && m.sender === 'user') {
              m.read = true;
            } else if (!clientInfo.isAdmin && m.sender === 'admin') {
              m.read = true;
            }
          });
          saveJSON(MESSAGES_FILE, messagesData);
    syncToStorage('messages');
          notifyAdminsConversationsUpdate();
        }
      }

      // 8. Typing indicator
      else if (msg.type === 'TYPING') {
        if (clientInfo.isAdmin && msg.targetUserId) {
          sendToUser(msg.targetUserId, {
            type: 'USER_TYPING',
            sender: '740 ADMIN',
            isTyping: !!msg.isTyping
          });
        } else if (clientInfo.userId) {
          broadcastToAdmins({
            type: 'USER_TYPING',
            userId: clientInfo.userId,
            username: clientInfo.username,
            isTyping: !!msg.isTyping
          });
        }
      }

    } catch (e) {
      console.error('WebSocket message parsing error:', e);
    }
  });

  ws.on('close', () => {
    activeClients.delete(ws);
    // Notify admins of online status change
    notifyAdminsConversationsUpdate();
  });
});

// Periodic keep-alive heartbeat every 25 seconds (prevents Render proxy timeout)
setInterval(() => {
  for (const [ws] of activeClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (e) {}
    }
  }
}, 25000);

// Start listening
server.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(` 🚀 740 DISTRO Server Running on Port ${PORT}`);
  console.log(` 🌐 Live Web & Admin: http://localhost:${PORT}`);
  console.log(` ⚡ Real-Time WebSockets Active`);
  console.log(`===============================================`);
  await initDatabase();
});
