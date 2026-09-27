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
  { id: "top-1", name: "Discover Top 1%" },
  { id: "mainstream", name: "Discover Mainstream" },
  { id: "upcoming", name: "Discover Upcoming" },
  { id: "underground", name: "Discover Underground" },
  { id: "deep-cut", name: "Discover Deep Cut" },
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

export function loadingProgressTarget(progress: number | null, elapsedMs: number, complete: boolean) {
  if (complete) return 1;
  return Math.min(.95, Math.max(.12 + Math.max(0, Math.min(1, progress ?? 0)) * .78, .8 * (1 - Math.exp(-elapsedMs / 16000))));
}

export function AeonLoadingScreen(props: Props) {
  const [pool] = useState(() => initialPool(props.background));
  const frameRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(props);
  useEffect(() => { liveRef.current = props; });

  useEffect(() => {
    try { sessionStorage.setItem("aeon-loading-feed", pool.id); } catch { /* Storage is optional. */ }
    const frame = frameRef.current!;
    const plane = planeRef.current!;
    const flow = [2, 1, 0, 6, 5, 4, 3];
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
    let settled = 0;
    const timers: number[] = [];
    const cards = pool.picks.map((pick, rank) => {
      const tile = document.createElement("div");
      tile.className = "aeon-loading-cover";
      tile.dataset.title = pick.title;
      tile.dataset.rank = String(rank + 1);
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      let finished = false;
      const finish = () => {
        if (finished || disposed) return;
        finished = true;
        settled++;
        if (settled === pool.picks.length) {
          coverPaint = requestAnimationFrame(() => {
            if (disposed) return;
            frame.classList.add("covers-ready");
          });
        }
      };
      const timeout = window.setTimeout(finish, 12000);
      timers.push(timeout);
      image.onload = async () => {
        try {
          await image.decode();
          if (!disposed) tile.classList.add("has-cover");
        } catch { /* An unavailable real cover leaves its space empty. */ }
        window.clearTimeout(timeout);
        finish();
      };
      image.onerror = () => { window.clearTimeout(timeout); finish(); };
      image.src = `${import.meta.env.BASE_URL}${pick.cover}`;
      tile.appendChild(image);
      lanes[0].appendChild(tile);
      return { tile, image, lane: 0 };
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
      // Between transfers, seven composited lane transforms move all covers.
      // Do not interleave layout reads and style writes for 100 cards per frame.
      if (baseDistance < 0 || distance >= nextTransferDistance || distance < baseDistance) {
        baseDistance = distance;
        let untilNextTransfer = laneLength;
        cards.forEach((card, rank) => {
          const position = ((laneLength / 2 - rank * pitch + distance) % length + length) % length;
          const flowIndex = Math.min(6, Math.floor(position / laneLength));
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
      const tilt = 20 * Math.PI / 180;
      const angle = -9 * Math.PI / 180;
      let halfWidth = 0;
      let halfHeight = 0;
      for (const x of [-frame.clientWidth / 2, frame.clientWidth / 2]) {
        for (const y of [-frame.clientHeight / 2, frame.clientHeight / 2]) {
          const v = y / (Math.cos(tilt) + y * Math.sin(tilt) / 1400);
          const u = x * (1 - v * Math.sin(tilt) / 1400);
          halfWidth = Math.max(halfWidth, Math.abs(Math.cos(angle) * u + Math.sin(angle) * v));
          halfHeight = Math.max(halfHeight, Math.abs(-Math.sin(angle) * u + Math.cos(angle) * v));
        }
      }
      plane.style.width = `${Math.ceil(halfWidth * 2 + 12)}px`;
      plane.style.height = `${Math.ceil(halfHeight * 2 + 12)}px`;
      cardHeight = cards[0].tile.offsetHeight;
      pitch = cardHeight + 2;
      laneLength = cards.length * pitch / 7;
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
      timers.forEach(timer => window.clearTimeout(timer));
      cards.forEach(({ image }) => { image.onload = null; image.onerror = null; image.removeAttribute("src"); });
      frame.classList.remove("covers-ready");
      plane.parentElement?.style.removeProperty("filter");
      plane.replaceChildren();
    };
  }, [pool]);

  return (
    <div ref={frameRef} className="aeon-loading-screen" data-cover-feed={pool.id}>
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
