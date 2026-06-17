const FEED_SCROLL_SESSION_KEY = "manhwa-library-feed-scroll-v1";
const LAST_FEED_SESSION_KEY = "manhwa-library-last-feed-v1";

function readFeedScrollPositions() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(FEED_SCROLL_SESSION_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFeedScrollPosition(feedId: string, y: number) {
  try {
    const positions = readFeedScrollPositions();
    positions[feedId] = Math.max(0, y);
    sessionStorage.setItem(FEED_SCROLL_SESSION_KEY, JSON.stringify(positions));
    sessionStorage.setItem(LAST_FEED_SESSION_KEY, feedId);
  } catch {
    // sessionStorage may be unavailable in private contexts.
  }
}

function getActiveFeedPanel() {
  return document.querySelector<HTMLElement>(".feed-pager-panel[data-feed-id]:not(.inactive-panel)");
}

function saveActiveFeedScroll() {
  const panel = getActiveFeedPanel();
  const feedId = panel?.dataset.feedId;
  if (!panel || !feedId || feedId === "blank") return;
  writeFeedScrollPosition(feedId, panel.scrollTop);
}

function getSavedScrollForPanel(panel: HTMLElement) {
  const positions = readFeedScrollPositions();
  const feedId = panel.dataset.feedId;
  if (feedId && typeof positions[feedId] === "number") return positions[feedId];
  const lastFeedId = sessionStorage.getItem(LAST_FEED_SESSION_KEY);
  return lastFeedId ? positions[lastFeedId] ?? 0 : 0;
}

function restoreActiveFeedScroll(deadline = performance.now() + 2500) {
  const attempt = () => {
    const panel = getActiveFeedPanel();
    const y = panel ? getSavedScrollForPanel(panel) : 0;

    if (panel && y > 0 && Math.abs(panel.scrollTop - y) > 2) {
      panel.scrollTo({ top: y, left: 0, behavior: "auto" });
    }

    if (performance.now() < deadline) {
      requestAnimationFrame(attempt);
    }
  };

  requestAnimationFrame(attempt);
}

function isTitleLink(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('a[href*="#/title/"]'));
}

function isTitleRoute() {
  return window.location.hash.startsWith("#/title/");
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (isTitleLink(event.target)) saveActiveFeedScroll();
  },
  { capture: true, passive: true },
);

document.addEventListener(
  "click",
  (event) => {
    if (isTitleLink(event.target)) saveActiveFeedScroll();
  },
  { capture: true, passive: true },
);

window.addEventListener("hashchange", () => {
  if (!isTitleRoute()) restoreActiveFeedScroll();
});

window.addEventListener("pageshow", () => {
  if (!isTitleRoute()) restoreActiveFeedScroll();
});

window.addEventListener("pagehide", saveActiveFeedScroll);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveActiveFeedScroll();
});

if (!isTitleRoute()) restoreActiveFeedScroll();
