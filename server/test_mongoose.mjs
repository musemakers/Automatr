import mongoose from 'mongoose';
import User from './src/models/User.js';

// Simulate what happens when the doc is loaded from DB via findById (hydrate == no network needed)
const plain = {
  _id: new mongoose.Types.ObjectId(),
  name: 'Test',
  email: 'test@example.com',
  passwordHash: 'x',
  company: { name: 'Acme', designation: 'CEO', industry: 'Technology' }
};

const doc = User.hydrate(plain);
console.log('isNew:', doc.isNew);
console.log('before mutate, isModified company.industry:', doc.isModified('company.industry'));
console.log('before mutate, isModified company:', doc.isModified('company'));

doc.company.industry = 'Fashion & Apparel';

console.log('after mutate, company.industry value:', doc.company.industry);
console.log('after mutate, isModified company.industry:', doc.isModified('company.industry'));
console.log('after mutate, isModified company:', doc.isModified('company'));
console.log('modifiedPaths:', doc.modifiedPaths());
