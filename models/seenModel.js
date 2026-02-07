const mongoose = require('../src/db');

// Модель для отслеживания просмотренных пользователей
const seenSchema = new mongoose.Schema({
  // Кто просмотрел
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Кого просмотрел
  seenUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // Действие: 'like', 'pass', 'view'
  action: {
    type: String,
    enum: ['like', 'pass', 'view'],
    default: 'view',
  },

  // Дата просмотра
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Уникальный индекс - один просмотр от пользователя к пользователю
seenSchema.index({ userId: 1, seenUserId: 1 }, { unique: true });

const Seen = mongoose.models.Seen || mongoose.model('Seen', seenSchema);

module.exports = Seen;
