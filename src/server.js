const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

// Connect database
require('./db');

// Connect routers
const meetsRoutes = require('../routes/meets');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// Use routes
app.use(meetsRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`User Meets Service is running on http://localhost:${PORT}`);
});
