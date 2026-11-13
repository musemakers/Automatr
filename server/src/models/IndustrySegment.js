import mongoose from 'mongoose';

const tickerSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true },
    price: { type: Number, required: true },
    change: { type: Number, required: true }
  },
  { _id: false }
);

const newsItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    desc: { type: String, default: '' },
    source: { type: String, default: 'MARKET SCAN' },
    time: { type: String, default: 'RECENTLY' },
    image: { type: String, default: '' }, // URL; empty renders the decorative gradient fallback
    url: { type: String, default: '' } // source URL; empty renders as non-clickable
  },
  { _id: false }
);

const industrySegmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    group: { type: String, required: true, trim: true, default: 'Other' },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true }, // soft-hide instead of hard delete so existing users referencing it don't break
    tickers: { type: [tickerSchema], default: [] },
    news: { type: [newsItemSchema], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model('IndustrySegment', industrySegmentSchema);
