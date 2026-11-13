// These MUST stay in sync with the equivalent arrays in
// client/src/pages/GenerateMedia.jsx (MOOD_TAGS / STYLE_REFERENCES /
// LIGHTING_STYLES / COMPOSITION_STYLES). They're duplicated here (rather
// than shared over the network) so the AI-suggestion endpoint can validate
// the model's picks against the exact same fixed option set the UI renders
// as chips/selects - the model is never allowed to invent a new tag.
export const MOOD_TAGS = ['Bold', 'Minimal', 'Luxurious', 'Playful', 'Editorial', 'Warm', 'Futuristic', 'Nostalgic', 'Energetic', 'Calm'];

export const STYLE_REFERENCES = [
  'Studio product photography',
  'Editorial lifestyle',
  'Cinematic film still',
  'Bold graphic / typographic',
  'Flat lay top-down',
  'Architectural / geometric',
  'Hand-illustrated',
  '3D render'
];

export const LIGHTING_STYLES = ['Natural daylight', 'Golden hour', 'Studio softbox', 'Dramatic high-contrast', 'Neon / vibrant', 'Moody low-key'];

export const COMPOSITION_STYLES = ['Rule-of-thirds hero shot', 'Centered minimal', 'Dynamic diagonal', 'Flat lay top-down', 'Negative-space led'];
