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
  interests: { type: [String], default: [] },
  education: { type: String, default: '' },
  lookingFor: {
    id: { type: String },
    title: { type: String },
    icon: { type: String, default: '' },
  },
  about: { type: String, default: '' },
  work: { type: String, default: '' },
  zodiac: { type: String, default: '' },
  languages: { type: [String], default: [] },
  children: { type: String, default: '' },
  pets: { type: [String], default: [] },
  smoking: { type: String, default: '' },
  alcohol: { type: String, default: '' },
  relationship: { type: String, default: '' },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },
  onboardingComplete: { type: Boolean, default: false },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
