const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const Expense = require('./models/Expense');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- MongoDB Connection ----------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

// ---------- Auth Middleware ----------
function isAuthenticated(req,res,next){
  if(req.session.userId) next();
  else res.redirect('/login');
}

// ---------- Routes ----------

// Redirect root
app.get('/', (req,res)=>res.redirect('/login'));

// ---------- Register ----------
app.get('/register',(req,res)=>res.render('register',{error:null}));
app.post('/register', async (req,res)=>{
  try{
    const { username, password } = req.body;
    const exist = await User.findOne({username});
    if(exist) return res.render('register',{error:'Username already taken'});

    const user = new User({username,password});
    await user.save();
    res.redirect('/login');
  } catch(err){
    console.log('Registration Error:', err);
    res.render('register',{error:'Server error. Try again later.'});
  }
});

// ---------- Login ----------
app.get('/login',(req,res)=>res.render('login',{error:null}));
app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    const user = await User.findOne({username});
    if(!user || !(await user.comparePassword(password)))
      return res.render('login',{error:'Invalid username or password'});

    req.session.userId = user._id;
    req.session.username = user.username;
    res.redirect('/dashboard');
  } catch(err){
    console.log('Login Error:',err);
    res.render('login',{error:'Server error. Try again later.'});
  }
});

// ---------- Dashboard ----------
app.get('/dashboard', isAuthenticated, async (req,res)=>{
  try{
    const expenses = await Expense.find({userId:req.session.userId});

    const categoryTotals = {};
    const monthlyTotals = {};

    expenses.forEach(e=>{
      categoryTotals[e.category] = (categoryTotals[e.category]||0) + e.amount;
      const month = e.date.toISOString().slice(0,7);
      monthlyTotals[month] = (monthlyTotals[month]||0) + e.amount;
    });

    res.render('dashboard',{
      expenses,
      categoryTotals,
      monthlyTotals,
      username:req.session.username
    });
  } catch(err){
    console.log('Dashboard Error:',err);
    res.send('Server error. Try again later.');
  }
});

// ---------- Add Expense ----------
app.post('/expenses/add', isAuthenticated, async (req,res)=>{
  try{
    const { title, amount, category, date } = req.body;
    const exp = new Expense({userId:req.session.userId,title,amount,category,date});
    await exp.save();
    res.redirect('/dashboard');
  } catch(err){
    console.log('Add Expense Error:', err);
    res.send('Server error. Try again later.');
  }
});

// ---------- Delete Expense ----------
app.get('/expenses/delete/:id', isAuthenticated, async (req,res)=>{
  try{
    await Expense.findByIdAndDelete(req.params.id);
    res.redirect('/dashboard');
  } catch(err){
    console.log('Delete Expense Error:',err);
    res.send('Server error. Try again later.');
  }
});

// ---------- Chat ----------
app.get('/chat', isAuthenticated, (req,res)=>{
  res.render('chat',{username:req.session.username});
});

// ---------- Socket.IO Chat ----------
io.on('connection',(socket)=>{
  console.log('User connected to chat');

  Message.find().sort({createdAt:1}).then(msgs=>{
    socket.emit('loadMessages',msgs);
  }).catch(err=>console.log(err));

  socket.on('chatMessage', async (data)=>{
    try{
      const msg = new Message(data);
      await msg.save();
      io.emit('newMessage',msg);
    } catch(err){
      console.log('Chat Save Error:',err);
    }
  });

  socket.on('disconnect',()=>console.log('User disconnected'));
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`Server running at http://localhost:${PORT}`));
