// Hands something from the Generate Media start screen to the Multi-scene Video flow
// ({ template } to prefill it, or { reel } to open an earlier reel). Kept until the flow has mounted, then cleared,
// so a double render in dev never loses it.
let pending = null;
export const setSceneHandoff = (v) => { pending = v || null; };
export const peekSceneHandoff = () => pending;
export const clearSceneHandoff = () => { pending = null; };
