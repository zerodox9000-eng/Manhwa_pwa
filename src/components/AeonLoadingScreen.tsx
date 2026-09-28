import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../domain/types";
import data from "../assets/loadingCovers.generated.json";
import "./AeonLoadingScreen.css";

type Pool = typeof data.pools[number];
type Props = {
  background: AppSettings["loadingBackground"];
  appName: string;
  complete: boolean;
  progress: number | null;
  error?: boolean;
  status?: string;
  onRetry?: () => void;
  onVisualComplete?: () => void;
};

export const LOADING_BACKGROUNDS = [
  { id: "random", name: "Random each time" },
  { id: "top-1", name: "Top 1% Trending" },
  { id: "mainstream", name: "Trending Mainstream" },
  { id: "upcoming", name: "Trending Upcoming" },
  { id: "underground", name: "Trending Underground" },
  { id: "deep-cut", name: "Trending Deep Cut" },
] as const;

export function chooseLoadingPool(background: Props["background"], previous: string | null, random = Math.random): Pool {
  const fixed = data.pools.find(pool => pool.id === background);
  if (fixed) return fixed;
  const available = data.pools.filter(pool => pool.id !== previous);
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))];
}

function initialPool(background: Props["background"]) {
  let previous = null;
  try { previous = sessionStorage.getItem("aeon-loading-feed"); } catch { /* Storage is optional. */ }
  return chooseLoadingPool(background, previous);
}

export function chooseLoadingStartIndex(count: number, previous: number | null, random = Math.random) {
  if (count <= 1) return 0;
  const validPrevious = previous != null && previous >= 0 && previous < count ? previous : null;
  const choices = validPrevious === null ? count : count - 1;
  const slot = Math.min(choices - 1, Math.floor(random() * choices));
  return validPrevious !== null && slot >= validPrevious ? slot + 1 : slot;
}

export function loadingCoverOrder<T>(picks: readonly T[], startIndex: number): T[] {
  return picks.map((_, slot) => picks[(startIndex + slot) % picks.length]);
}

export function loadingProgressTarget(progress: number | null, elapsedMs: number, complete: boolean) {
  if (complete) return 1;
  return Math.min(.95, Math.max(.12 + Math.max(0, Math.min(1, progress ?? 0)) * .78, .8 * (1 - Math.exp(-elapsedMs / 16000))));
}

const isDesktopViewport = () => window.innerWidth >= 1180 && window.innerHeight >= 650;

export function AeonLoadingScreen(props: Props) {
  const [pool] = useState(() => initialPool(props.background));
  const [desktop, setDesktop] = useState(isDesktopViewport);
  const [startIndex] = useState(() => {
    let previous: number | null = null;
    try {
      const saved = sessionStorage.getItem(`aeon-loading-start-${pool.id}`);
      if (saved !== null) previous = Number(saved);
    } catch { /* Storage is optional. */ }
    return chooseLoadingStartIndex(pool.picks.length, previous);
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(props);
  useEffect(() => { liveRef.current = props; });
  useEffect(() => {
    const update = () => setDesktop(isDesktopViewport());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem("aeon-loading-feed", pool.id); } catch { /* Storage is optional. */ }
    try { sessionStorage.setItem(`aeon-loading-start-${pool.id}`, String(startIndex)); } catch { /* Storage is optional. */ }
    const frame = frameRef.current!;
    const plane = planeRef.current!;
    const flow = desktop
      ? [5, 4, 3, 2, 1, 0, 12, 11, 10, 9, 8, 7, 6]
      : [2, 1, 0, 6, 5, 4, 3];
    const lanes = flow.map(() => document.createElement("div"));
    lanes.forEach(lane => { lane.className = "aeon-loading-lane"; plane.appendChild(lane); });
    let disposed = false;
    let animation = 0;
    let elapsed = 0;
    let previousTime: number | null = null;
    let pitch = 1;
    let cardHeight = 1;
    let laneLength = 1;
    let planeHeight = 1;
    let baseDistance = -1;
    let nextTransferDistance = 0;
    let laneAnimations: Animation[] = [];
    let coverPaint = 0;
    let loaded = 0;
    const orderedPicks = loadingCoverOrder(pool.picks, startIndex);
    const sequence = desktop
      ? [...orderedPicks, ...orderedPicks, ...orderedPicks, ...orderedPicks]
      : [...orderedPicks, ...orderedPicks];
    const cards = sequence.map(pick => {
      const tile = document.createElement("div");
      tile.className = "aeon-loading-cover";
      tile.dataset.title = pick.title;
      tile.dataset.rank = String(pick.feedRank);
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      let finished = false;
      let attempt = 0;
      let timeout = 0;
      const src = `${import.meta.env.BASE_URL}${pick.cover}`;
      const load = () => {
        const current = ++attempt;
        window.clearTimeout(timeout);
        const retry = () => {
          if (disposed || finished || current !== attempt) return;
          window.clearTimeout(timeout);
          timeout = window.setTimeout(load, attempt <= 2 ? 250 : 2000);
        };
        image.onload = async () => {
          try { await image.decode(); } catch { retry(); return; }
          if (disposed || finished || current !== attempt) return;
          finished = true;
          window.clearTimeout(timeout);
          tile.classList.add("has-cover");
          if (++loaded === sequence.length) {
            coverPaint = requestAnimationFrame(() => {
              if (!disposed) frame.classList.add("covers-ready");
            });
          }
        };
        image.onerror = retry;
        image.src = current === 1 ? src : `${src}?retry=${current - 1}`;
        timeout = window.setTimeout(load, attempt <= 2 ? 3000 : 10000);
      };
      tile.appendChild(image);
      lanes[0].appendChild(tile);
      load();
      return { tile, image, lane: 0, cancel: () => window.clearTimeout(timeout) };
    });
    function startLaneMotion(targetLanes: HTMLDivElement[], previous: Animation[]) {
      previous.forEach(animation => animation.cancel());
      const timelineTime = document.timeline?.currentTime;
      return targetLanes.map(lane => {
        const animation = lane.animate([
          { transform: "translate3d(0,0,0)" },
          { transform: `translate3d(0,${-cards.length * pitch}px,0)` },
        ], { duration: cards.length * 8800, iterations: Infinity, easing: "linear" });
        animation.currentTime = elapsed * 1000;
        if (typeof timelineTime === "number") animation.startTime = timelineTime - elapsed * 1000;
        return animation;
      });
    }
    const render = () => {
      const length = pitch * cards.length;
      const distance = (elapsed % (cards.length * 8.8)) * pitch / 8.8;
      // Only rebase the static cover positions when one crosses a lane edge.
      // Between transfers, the composited lane transforms move every cover.
      // Do not interleave layout reads and style writes for every card per frame.
      if (baseDistance < 0 || distance >= nextTransferDistance || distance < baseDistance) {
        baseDistance = distance;
        let untilNextTransfer = laneLength;
        cards.forEach((card, rank) => {
          const position = ((laneLength / 2 - rank * pitch + distance) % length + length) % length;
          const flowIndex = Math.min(flow.length - 1, Math.floor(position / laneLength));
          const lane = flow[flowIndex];
          const progress = position - flowIndex * laneLength;
          const y = (planeHeight + laneLength - cardHeight) / 2 - progress;
          untilNextTransfer = Math.min(untilNextTransfer, laneLength - progress);
          if (lane !== card.lane) {
            lanes[lane].appendChild(card.tile);
            card.lane = lane;
          }
          // The browser animation already translates each lane by -distance.
          // Bake its matching offset into the infrequent static rebase.
          card.tile.style.top = `${y + distance}px`;
        });
        nextTransferDistance = distance + Math.max(.00001, untilNextTransfer);
      }
    };
    const layout = () => {
      const tilt = (desktop ? 18 : 20) * Math.PI / 180;
      const angle = -9 * Math.PI / 180;
      const perspective = desktop ? 2200 : 1400;
      let halfWidth = 0;
      let halfHeight = 0;
      for (const x of [-frame.clientWidth / 2, frame.clientWidth / 2]) {
        for (const y of [-frame.clientHeight / 2, frame.clientHeight / 2]) {
          const v = y / (Math.cos(tilt) + y * Math.sin(tilt) / perspective);
          const u = x * (1 - v * Math.sin(tilt) / perspective);
          halfWidth = Math.max(halfWidth, Math.abs(Math.cos(angle) * u + Math.sin(angle) * v));
          halfHeight = Math.max(halfHeight, Math.abs(-Math.sin(angle) * u + Math.cos(angle) * v));
        }
      }
      plane.style.width = `${Math.ceil(halfWidth * 2 + 12)}px`;
      plane.style.height = `${Math.ceil(halfHeight * 2 + 12)}px`;
      cardHeight = cards[0].tile.offsetHeight;
      pitch = cardHeight + 2;
      laneLength = cards.length * pitch / flow.length;
      planeHeight = plane.clientHeight;
      baseDistance = -1;
      render();
      laneAnimations = startLaneMotion(lanes, laneAnimations);
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(frame);
    let started: number | null = null;
    let visual = .12;
    let completeNotified = false;
    const animate = (time: number) => {
      if (started === null) started = time;
      const delta = Math.min(time - (previousTime ?? time), 100);
      previousTime = time;
      const motionTime = laneAnimations[0]?.currentTime;
      if (typeof motionTime === "number") elapsed = motionTime / 1000;
      render();
      const current = liveRef.current;
      const target = loadingProgressTarget(current.progress, time - started, current.complete);
      visual = Math.max(visual, visual + (target - visual) * (1 - Math.exp(-delta / (current.complete ? 180 : 400))));
      if (current.complete && visual >= .999) {
        visual = 1;
        if (!completeNotified) { completeNotified = true; current.onVisualComplete?.(); }
      }
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${visual})`;
      progressRef.current?.setAttribute("aria-valuenow", String(Math.round(visual * 100)));
      animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      cancelAnimationFrame(coverPaint);
      observer.disconnect();
      laneAnimations.forEach(animation => animation.cancel());
      cards.forEach(({ image, cancel }) => { cancel(); image.onload = null; image.onerror = null; image.removeAttribute("src"); });
      frame.classList.remove("covers-ready");
      plane.parentElement?.style.removeProperty("filter");
      plane.replaceChildren();
    };
  }, [pool, startIndex, desktop]);

  return (
    <div ref={frameRef} className="aeon-loading-screen" data-cover-feed={pool.id} data-cover-layout={desktop ? "desktop" : "mobile"} data-start-rank={pool.picks[startIndex].feedRank}>
      <div className="aeon-loading-background" aria-hidden="true" onTransitionEnd={event => {
        if (event.propertyName === "filter" && frameRef.current?.classList.contains("covers-ready")) event.currentTarget.style.filter = "none";
      }}><div ref={planeRef} className="aeon-loading-plane" /></div>
      <div className="aeon-loading-vignette" aria-hidden="true" />
      <div className="aeon-loading-brand" role="status" aria-live="polite" aria-busy={!props.complete}>
        <img className="aeon-loading-icon" src={`${import.meta.env.BASE_URL}pwa-192.png`} alt="" />
        <span className="aeon-loading-name">{props.appName || "Aeon"}</span>
        <span className="aeon-loading-label">{props.error ? "Couldn't load your library" : "Loading"}</span>
        {!props.error ? <span className="aeon-loading-dots" aria-hidden="true"><i /><i /><i /></span> : null}
        <div ref={progressRef} className="aeon-loading-progress" role="progressbar" aria-label="Loading Aeon" aria-valuemin={0} aria-valuemax={100} aria-valuenow={12}><span ref={fillRef} /></div>
        {props.error ? <span className="aeon-loading-error">{props.status?.replace(/download/gi, "load")}</span> : null}
        {props.error && props.onRetry ? <button type="button" className="button primary" onClick={props.onRetry}>Retry</button> : null}
      </div>
    </div>
  );
}
