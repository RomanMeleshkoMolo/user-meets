const mongoose = require('../src/db');

const UserPhotoSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    bucket: { type: String, required: true },
    url: { type: String },
    status: { type: String, enum: ['approved', 'rejected'], required: true },
  },
  { _id: false }
);

// Модель пользователя для meets
const userSchema = new mongoose.Schema({
  name: { type: String },
  age: { type: Number },
  userPhoto: { type: [UserPhotoSchema], default: [] },
  userLocation: { type: String },
  gender: {
    id: { type: String, enum: ['male', 'female', 'other'] },
    title: { type: String },
  },
  wishUser: { type: String, enum: ['male', 'female', 'all'] },
  userSex: { type: String },
  interests: {
    title: { type: String },
    icon: { type: String },
  },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },
  onboardingComplete: { type: Boolean, default: false },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
