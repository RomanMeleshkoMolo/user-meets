const mongoose = require('mongoose');
require('dotenv').config();

const AUTH_MONGO_URI  = process.env.AUTH_MONGO_URI  || 'mongodb://localhost:27017/molo_auth';
const MEETS_MONGO_URI = process.env.MONGO_URI        || 'mongodb://localhost:27017/molo_meets';
const LIKES_MONGO_URI = process.env.LIKES_MONGO_URI  || 'mongodb://localhost:27017/molo_likes';

const authConn = mongoose.createConnection(AUTH_MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

const meetsConn = mongoose.createConnection(MEETS_MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

const likesConn = mongoose.createConnection(LIKES_MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

authConn.on('connected',  () => console.log('[user-meets] authConn  connected → molo_auth'));
authConn.on('error',      (err) => console.error('[user-meets] authConn  error:', err));

meetsConn.on('connected', () => console.log('[user-meets] meetsConn connected → molo_meets'));
meetsConn.on('error',     (err) => console.error('[user-meets] meetsConn error:', err));

likesConn.on('connected', () => console.log('[user-meets] likesConn connected → molo_likes'));
likesConn.on('error',     (err) => console.error('[user-meets] likesConn error:', err));

module.exports = { authConn, meetsConn, likesConn };
