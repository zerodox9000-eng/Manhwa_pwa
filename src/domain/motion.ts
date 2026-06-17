export const APP_MOTION = {
  fastMs: 120,
  snapBackMs: 160,
  pagerCommitMs: 200,
  settleMs: 40,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  reducedMotionMs: 1,
} as const;

export function motionDuration(ms: number) {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? APP_MOTION.reducedMotionMs
    : ms;
}
