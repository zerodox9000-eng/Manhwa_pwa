import Fuse from "fuse.js";

interface SearchWorkerItem {
  id: number;
  display_title: string;
  animeplanet_title?: string | null;
  mangabaka_title?: string | null;
  native_title?: string | null;
  romanized_title?: string | null;
  authors?: string[];
  artists?: string[];
}

type SearchWorkerMessage =
  | { type: "index"; items: SearchWorkerItem[] }
  | { type: "search"; query: string; requestId: number };

let searchIndex = createIndex([]);

function createIndex(items: SearchWorkerItem[]) {
  return new Fuse(items, {
    includeScore: true,
    shouldSort: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
    threshold: 0.28,
    keys: [
      { name: "display_title", weight: 0.55 },
      { name: "animeplanet_title", weight: 0.5 },
      { name: "mangabaka_title", weight: 0.2 },
      { name: "native_title", weight: 0.18 },
      { name: "romanized_title", weight: 0.18 },
      { name: "authors", weight: 0.1 },
      { name: "artists", weight: 0.1 },
    ],
  });
}

self.onmessage = (event: MessageEvent<SearchWorkerMessage>) => {
  if (event.data.type === "index") {
    searchIndex = createIndex(event.data.items);
    return;
  }

  const ids = searchIndex
    .search(event.data.query, { limit: 60 })
    .map((result) => result.item.id);

  self.postMessage({
    type: "results",
    requestId: event.data.requestId,
    ids,
  });
};
