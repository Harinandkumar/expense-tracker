// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const User = require('./models/User');
const Expense = require('./models/Expense');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Config / Connect DB ----------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/expense-tracker';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Session (use env SESSION_SECRET)
app.use(session({
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI })
}));

// ---------- Auth middleware ----------
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// ---------- Routes: auth, dashboard, expenses ----------
app.get('/', (req, res) => res.redirect('/login'));

// ---------- Auth Routes ----------

// Register (simple form)
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log('Registration attempt:', { username, email });
    
    if (!username || !email || !password) {
      return res.render('register', { error: 'All fields are required' });
    }

    // Check if username or email already exists
    const existingUser = await User.findOne({ 
      $or: [{ username: username.trim() }, { email: email.trim() }] 
    });
    
    if (existingUser) {
      if (existingUser.username === username.trim()) {
        return res.render('register', { error: 'Username already taken' });
      }
      if (existingUser.email === email.trim()) {
        return res.render('register', { error: 'Email already registered' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save new user
    const user = new User({ 
      username: username.trim(), 
      email: email.trim(), 
      password: hashedPassword 
    });
    
    await user.save();
    console.log('User registered successfully:', user.username);

    // Redirect to login
    res.redirect('/login');
  } catch (err) {
    console.error('Registration error:', err);
    res.render('register', { error: 'Server error. Try again later.' });
  }
});

// Login
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('Login attempt:', { username });
    
    if (!username || !password) {
      return res.render('login', { error: 'All fields are required' });
    }

    // Find user by username OR email (trim inputs)
    const user = await User.findOne({ 
      $or: [
        { username: username.trim() }, 
        { email: username.trim() }
      ] 
    });

    if (!user) {
      console.log('User not found:', username);
      return res.render('login', { error: 'Invalid username or password' });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('Password valid:', isPasswordValid);
    
    if (!isPasswordValid) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    // Save session
    req.session.userId = user._id;
    req.session.username = user.username;
    console.log('Login successful:', user.username);

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Server error. Try again later.' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Dashboard - expenses and charts data
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.session.userId }).sort({ date: -1 });

    const categoryTotals = {};
    const monthlyTotals = {};

    expenses.forEach(e => {
      const cat = e.category || 'Uncategorized';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(e.amount) || 0);

      const month = e.date ? (new Date(e.date)).toISOString().slice(0, 7) : 'unknown';
      monthlyTotals[month] = (monthlyTotals[month] || 0) + (Number(e.amount) || 0);
    });

    res.render('dashboard', {
      username: req.session.username,
      expenses,
      categoryTotals,
      monthlyTotals
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error');
  }
});

// Add expense
app.post('/expenses/add', isAuthenticated, async (req, res) => {
  try {
    const { title, amount, category, date } = req.body;
    const exp = new Expense({
      userId: req.session.userId,
      title,
      amount: parseFloat(amount) || 0,
      category,
      date: date ? new Date(date) : new Date()
    });
    await exp.save();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Add expense error:', err);
    res.status(500).send('Server error');
  }
});

// Delete expense
app.get('/expenses/delete/:id', isAuthenticated, async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).send('Server error');
  }
});

// Chat page
app.get('/chat', isAuthenticated, (req, res) => {
  res.render('chat', { username: req.session.username });
});
// ---------- SOCKET.IO: chat with reply and typing indicator support ----------
const onlineUsers = new Set();
const typingUsers = new Set();

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // join chat with username (client emits 'joinChat' on load)
  socket.on('joinChat', (username) => {
    socket.username = username;
    if (username) onlineUsers.add(username);
    io.emit('updateUsers', Array.from(onlineUsers));
  });

  // send history to the newly connected socket
  Message.find().sort({ createdAt: 1 }).lean().then(msgs => {
    socket.emit('loadMessages', msgs);
  }).catch(err => console.error('load messages error:', err));

  // new message event (supports reply)
  socket.on('chatMessage', async (data) => {
    try {
      const replyObj = (data.replyTo && data.replyTo.id) ? {
        id: String(data.replyTo.id),
        username: data.replyTo.username || null,
        text: data.replyTo.text || null
      } : { id: null, username: null, text: null };

      const msg = new Message({
        username: data.username,
        text: data.text,
        replyTo: replyObj
      });

      const saved = await msg.save();

      const out = {
        _id: String(saved._id),
        username: saved.username,
        text: saved.text,
        replyTo: saved.replyTo || null,
        createdAt: saved.createdAt
      };

      io.emit('newMessage', out);
    } catch (err) {
      console.error('chatMessage save error:', err);
    }
  });

  // delete single message
  socket.on('deleteMessage', async (msgId) => {
    try {
      await Message.findByIdAndDelete(msgId);
      io.emit('messageDeleted', msgId);
    } catch (err) {
      console.error('deleteMessage error:', err);
    }
  });

  // delete all
  socket.on('deleteAllMessages', async () => {
    try {
      await Message.deleteMany({});
      io.emit('allMessagesDeleted');
    } catch (err) {
      console.error('deleteAllMessages error:', err);
    }
  });

  // Typing indicator events (fixed)
  socket.on('typingStart', (username) => {
    if (username) {
      typingUsers.add(username);
      io.emit('userTyping', Array.from(typingUsers));
    }
  });

  socket.on('typingStop', (username) => {
    if (username && typingUsers.has(username)) {
      typingUsers.delete(username);
      io.emit('userTyping', Array.from(typingUsers));
    }
  });

  // disconnect
  socket.on('disconnect', () => {
    if (socket.username && typingUsers.has(socket.username)) {
      typingUsers.delete(socket.username);
      io.emit('userTyping', Array.from(typingUsers));
    }

    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('updateUsers', Array.from(onlineUsers));
    }
    console.log('Socket disconnected:', socket.id);
  });


  // Add inside io.on('connection', (socket) => { ... })

// Edit message (only author allowed)
socket.on('editMessage', async (data) => {
  // data: { id: 'messageId', newText: 'edited text', username: 'Aman' }
  try {
    if (!data || !data.id || typeof data.newText !== 'string') return;

    const msg = await Message.findById(data.id);
    if (!msg) return;

    // permission check: only original author can edit
    if (String(msg.username) !== String(data.username)) {
      console.warn(`Edit denied: ${data.username} trying to edit ${msg.username}'s message`);
      return;
    }

    // update
    msg.text = data.newText;
    msg.edited = true;
    await msg.save();

    const out = {
      _id: String(msg._id),
      username: msg.username,
      text: msg.text,
      replyTo: msg.replyTo || null,
      createdAt: msg.createdAt,
      edited: msg.edited
    };

    // broadcast edited message to everyone
    io.emit('messageEdited', out);
  } catch (err) {
    console.error('editMessage error:', err);
  }
});


// ---------- Emoji reactions ----------
socket.on('addReaction', async (data) => {
  // data: { messageId, emoji, username }
  try {
    const msg = await Message.findById(data.messageId);
    if(!msg) return;

    // check if user already reacted with same emoji
    const existing = msg.reactions.find(r => r.username === data.username && r.emoji === data.emoji);
    if(existing) return; // avoid duplicate

    msg.reactions.push({ emoji: data.emoji, username: data.username });
    await msg.save();

    // broadcast updated reactions
    io.emit('updateReactions', { messageId: msg._id, reactions: msg.reactions });
  } catch(err) {
    console.error('addReaction error:', err);
  }
});

socket.on('removeReaction', async (data) => {
  // data: { messageId, emoji, username }
  try {
    const msg = await Message.findById(data.messageId);
    if(!msg) return;

    msg.reactions = msg.reactions.filter(r => !(r.username === data.username && r.emoji === data.emoji));
    await msg.save();

    io.emit('updateReactions', { messageId: msg._id, reactions: msg.reactions });
  } catch(err) {
    console.error('removeReaction error:', err);
  }
});



});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));