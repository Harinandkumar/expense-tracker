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

// Connect DB
mongoose.connect(process.env.MONGO_URI, { })
  .then(()=>console.log('✅ MongoDB connected'))
  .catch(err=>console.error('MongoDB connection error:', err));

// View engine + static
app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

// Auth middleware
function isAuthenticated(req,res,next){
  if(req.session.userId) return next();
  res.redirect('/login');
}

// Routes
app.get('/', (req,res)=> res.redirect('/login'));

// Register
app.get('/register', (req,res)=> res.render('register',{error:null}));
app.post('/register', async (req,res)=>{
  try{
    const { username, email, password } = req.body;
    if(!username || !email || !password) return res.render('register',{error:'All fields required'});

    const exists = await User.findOne({ $or:[{username},{email}] });
    if(exists) return res.render('register',{error:'Username or Email already used'});

    const user = new User({ username, email, password });
    await user.save();
    res.redirect('/login');
  } catch(err){
    console.error('Registration error:', err);
    res.render('register',{error:'Server error. Try again later.'});
  }
});

// Login
app.get('/login', (req,res)=> res.render('login',{error:null}));
app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    if(!username || !password) return res.render('login',{error:'All fields required'});

    const user = await User.findOne({ $or:[{username},{email:username}] }); // allow username or email
    if(!user) return res.render('login',{error:'Invalid username or password'});

    const ok = await user.comparePassword(password);
    if(!ok) return res.render('login',{error:'Invalid username or password'});

    req.session.userId = user._id;
    req.session.username = user.username;
    res.redirect('/dashboard');
  } catch(err){
    console.error('Login error:', err);
    res.render('login',{error:'Server error. Try again later.'});
  }
});

// Logout
app.get('/logout',(req,res)=>{
  req.session.destroy(()=> res.redirect('/login'));
});

// Dashboard (expenses)
app.get('/dashboard', isAuthenticated, async (req,res)=>{
  try{
    const expenses = await Expense.find({ userId: req.session.userId }).sort({date:-1});
    const categoryTotals = {};
    const monthlyTotals = {};

    expenses.forEach(e=>{
      categoryTotals[e.category] = (categoryTotals[e.category]||0) + e.amount;
      const month = e.date.toISOString().slice(0,7);
      monthlyTotals[month] = (monthlyTotals[month]||0) + e.amount;
    });

    res.render('dashboard',{
      username: req.session.username,
      expenses,
      categoryTotals,
      monthlyTotals
    });
  } catch(err){
    console.error('Dashboard error:', err);
    res.send('Server error');
  }
});

// Add expense
app.post('/expenses/add', isAuthenticated, async (req,res)=>{
  try{
    const { title, amount, category, date } = req.body;
    const exp = new Expense({
      userId: req.session.userId,
      title,
      amount: parseFloat(amount),
      category,
      date: date ? new Date(date) : undefined
    });
    await exp.save();
    res.redirect('/dashboard');
  } catch(err){
    console.error('Add expense error:', err);
    res.send('Server error');
  }
});

// Delete expense
app.get('/expenses/delete/:id', isAuthenticated, async (req,res)=>{
  try{
    await Expense.findByIdAndDelete(req.params.id);
    res.redirect('/dashboard');
  } catch(err){
    console.error('Delete expense error:', err);
    res.send('Server error');
  }
});

// Chat page
app.get('/chat', isAuthenticated, (req,res)=>{
  res.render('chat',{ username: req.session.username });
});

// ========== SOCKET.IO ==========
const onlineUsers = new Set();

io.on('connection', (socket)=>{
  console.log('Socket connected:', socket.id);

  // client should emit joinChat with username when loading chat
  socket.on('joinChat', (username)=>{
    socket.username = username;
    onlineUsers.add(username);
    io.emit('updateUsers', Array.from(onlineUsers));
  });

  // load history
  Message.find().sort({ createdAt: 1 }).then(msgs=>{
    socket.emit('loadMessages', msgs);
  }).catch(err=>console.error(err));

  // new message
  socket.on('chatMessage', async (data)=>{
    try{
      const msg = new Message({ username: data.username, text: data.text });
      const saved = await msg.save();
      io.emit('newMessage', saved);
    } catch(err){
      console.error('chatMessage save error:', err);
    }
  });

  // delete specific message (anyone can delete)
  socket.on('deleteMessage', async (msgId)=>{
    try{
      await Message.findByIdAndDelete(msgId);
      io.emit('messageDeleted', msgId);
    } catch(err){
      console.error('deleteMessage error:', err);
    }
  });

  // delete all messages
  socket.on('deleteAllMessages', async ()=>{
    try{
      await Message.deleteMany({});
      io.emit('allMessagesDeleted');
    } catch(err){
      console.error('deleteAllMessages error:', err);
    }
  });

  // disconnect
  socket.on('disconnect', ()=>{
    if(socket.username){
      onlineUsers.delete(socket.username);
      io.emit('updateUsers', Array.from(onlineUsers));
    }
    console.log('Socket disconnected:', socket.id);
  });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`🚀 Server running at http://localhost:${PORT}`));
