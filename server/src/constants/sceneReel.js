// Multi-scene reels ("Made for You" -> Multi-scene Video): limits shared by the planner, the controller and the runner.
export const SCENE_MIN_SECONDS = 3; // Gemini Omni Flash makes 3-10 s clips
export const SCENE_MAX_SECONDS = 10;
export const MAX_SCENES = 12;
export const TOTAL_OPTIONS = [15, 30, 45, 60]; // seconds the person can aim for
export const ASPECTS = ['9:16', '16:9'];
export const TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipe', 'slide'];
// ffmpeg xfade names for the transitions above ('cut' is a one-frame fade, i.e. effectively a hard cut)
export const XFADE = { cut: 'fade', fade: 'fadeblack', dissolve: 'dissolve', wipe: 'wipeleft', slide: 'slideup' };
export const TRANSITION_SECONDS = 0.5;
export const CUT_SECONDS = 0.04;
