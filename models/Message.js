// ./models/Message.js (only show schema additions)
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  username: String,
  text: String,
  replyTo: {
    id: { type: String, default: null },
    username: { type: String, default: null },
    text: { type: String, default: null }
  },
  createdAt: { type: Date, default: Date.now },

  // NEW fields for editing / seen / reactions (we'll use edited now)
  edited: { type: Boolean, default: false },
  // seenBy and reactions will be used later
  seenBy: [String],
  reactions: [{ emoji: String, username: String }]
});

module.exports = mongoose.model('Message', messageSchema);
