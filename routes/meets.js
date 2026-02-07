const express = require('express');
const router = express.Router();

const { authRequired } = require('../middlewares/auth');
const {
  getMeets,
  getUserProfile,
  passUser,
  markViewed,
  resetHistory,
} = require('../controllers/meetsController');

// GET /meets - Получить пользователей для свайпа
router.get('/meets', authRequired, getMeets);

// GET /meets/:userId - Получить профиль пользователя
router.get('/meets/:userId', authRequired, getUserProfile);

// POST /meets/:userId/pass - Пропустить пользователя
router.post('/meets/:userId/pass', authRequired, passUser);

// POST /meets/:userId/view - Отметить просмотр
router.post('/meets/:userId/view', authRequired, markViewed);

// DELETE /meets/history - Сбросить историю (для тестирования)
router.delete('/meets/history', authRequired, resetHistory);

module.exports = router;
