// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  username:  { type: String, required: true },
  text:      { type: String, required: true },
  // replyTo stores the parent message's id + minimal details for showing on frontend
  replyTo: {
    id:       { type: String, default: null },
    username: { type: String, default: null },
    text:     { type: String, default: null }
  },
  createdAt: { type: Date, default: Date.now }
});

// no automatic population needed because replyTo stores the small object already

module.exports = mongoose.model('Message', messageSchema);
