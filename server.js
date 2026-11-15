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

// Initial Data
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
  updatedAt: Date.now()
};

let inventoryData = loadJSON(INVENTORY_FILE, defaultInventory);
let usersData = loadJSON(USERS_FILE, []);
let messagesData = loadJSON(MESSAGES_FILE, {});
let sessionsData = loadJSON(SESSIONS_FILE, {});

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
  return token;
}

function getSession(token) {
  if (!token) return null;
  if (token === ADMIN_PASSCODE || token === 'admin_master') {
    return { id: 'admin_master', username: '740 ADMIN', role: 'admin' };
  }
  if (sessionsData[token]) return sessionsData[token];
  try {
    const parts = token.split('.');
    if (parts.length === 2) {
      const [data, sig] = parts;
      const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
      if (sig === expectedSig) {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        sessionsData[token] = payload;
        return payload;
      }
    }
  } catch (e) {}
  return null;
}

function deleteSession(token) {
  if (token && sessionsData[token]) {
    delete sessionsData[token];
    saveJSON(SESSIONS_FILE, sessionsData);
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
  const pass = req.body.adminPass;

  const isAuthorized = (session && session.role === 'admin') || (pass === ADMIN_PASSCODE);
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Unauthorized to update inventory.' });
  }

  const { stockCount, stockLabel, prices } = req.body;
  inventoryData = {
    stockCount: typeof stockCount === 'number' ? stockCount : parseInt(stockCount, 10) || 0,
    stockLabel: (stockLabel || 'IN STOCK').trim(),
    prices: {
      1: parseInt(prices?.['1'], 10) || inventoryData.prices[1] || 40,
      2: parseInt(prices?.['2'], 10) || inventoryData.prices[2] || 75,
      5: parseInt(prices?.['5'], 10) || inventoryData.prices[5] || 180,
      10: parseInt(prices?.['10'], 10) || inventoryData.prices[10] || 320,
      20: parseInt(prices?.['20'], 10) || inventoryData.prices[20] || 620
    },
    updatedAt: Date.now()
  };

  saveJSON(INVENTORY_FILE, inventoryData);

  // Broadcast to all connected clients immediately!
  broadcastWebSocket({
    type: 'INVENTORY_UPDATED',
    inventory: inventoryData
  });

  res.json({ success: true, inventory: inventoryData });
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

  const token = createSession({
    id: newUser.id,
    username: newUser.username,
    role: newUser.role
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

  const user = usersData.find(u => u.username.toLowerCase() === username.toLowerCase());
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
    role: user.role
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
  }
  res.json({ success: true });
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
  const list = [];
  // Include all registered users
  usersData.forEach(u => {
    const userMsgs = messagesData[u.id] || [];
    const lastMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
    const unreadCount = userMsgs.filter(m => m.sender === 'user' && !m.read).length;
    list.push({
      userId: u.id,
      username: u.username,
      createdAt: u.createdAt,
      online: isUserOnline(u.id),
      unreadCount,
      lastMessage: lastMsg ? {
        text: lastMsg.text,
        timestamp: lastMsg.timestamp,
        sender: lastMsg.sender
      } : null
    });
  });

  // Sort: users with unread messages first, then newest message, then newest registered
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

        const { stockCount, stockLabel, prices } = msg.data || {};
        inventoryData = {
          stockCount: typeof stockCount === 'number' ? stockCount : parseInt(stockCount, 10) || 0,
          stockLabel: (stockLabel || 'IN STOCK').trim(),
          prices: {
            1: parseInt(prices?.['1'], 10) || inventoryData.prices[1] || 40,
            2: parseInt(prices?.['2'], 10) || inventoryData.prices[2] || 75,
            5: parseInt(prices?.['5'], 10) || inventoryData.prices[5] || 180,
            10: parseInt(prices?.['10'], 10) || inventoryData.prices[10] || 320,
            20: parseInt(prices?.['20'], 10) || inventoryData.prices[20] || 620
          },
          updatedAt: Date.now()
        };

        saveJSON(INVENTORY_FILE, inventoryData);

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
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` 🚀 740 DISTRO Server Running on Port ${PORT}`);
  console.log(` 🌐 Live Web & Admin: http://localhost:${PORT}`);
  console.log(` ⚡ Real-Time WebSockets Active`);
  console.log(`===============================================`);
});
