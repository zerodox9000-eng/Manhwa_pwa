const READING_PLATFORM_NAMES: Record<string, string> = {
  "aethonwebcomics.com": "Aethon Webcomics",
  "comics.inkr.com": "INKR Comics",
  "comikey.com": "Comikey",
  "coolmic.me": "Coolmic",
  "crunchyroll.com": "Crunchyroll Manga",
  "daycomics.com": "DAYcomics",
  "ebookrenta.com": "Renta!",
  "evolvingspacemonster.com": "Evolving Space Monster",
  "global.lalatoon.com": "LaLatoon",
  "global.toptoon.com": "TOPTOON",
  "global.toomics.com": "Toomics",
  "honeytoon.com": "HoneyToon",
  "lalatoon.com": "LaLatoon",
  "lezhin.com": "Lezhin Comics",
  "lezhinus.com": "Lezhin Comics",
  "lezhinx.com": "Lezhin X",
  "m.tapas.io": "Tapas",
  "m.webnovel.com": "WebNovel",
  "mangaplaza.com": "MangaPlaza",
  "mangaplus-creators.jp": "MANGA Plus Creators",
  "mangatoon.mobi": "MangaToon",
  "manta.net": "Manta",
  "mrblue.com": "Mr. Blue",
  "namicomi.com": "NamiComi",
  "netcomics.com": "Netcomics",
  "peanutoon.com": "Peanutoon",
  "pixiv.net": "pixiv",
  "postype.com": "Postype",
  "ridibooks.com": "RIDI",
  "sololeveling.netmarble.com": "Solo Leveling",
  "tapas.io": "Tapas",
  "tappytoon.com": "Tappytoon",
  "theorieduko.com": "Theorie Duko",
  "toptoon.com": "TOPTOON",
  "toomics.com": "Toomics",
  "toomics.net": "Toomics",
  "voyce.me": "Voyce",
  "web.archive.org": "Internet Archive",
  "webcomicsapp.com": "WebComics",
  "webnovel.com": "WebNovel",
  "webtoons.com": "WEBTOON",
  "yaoi.biz": "Yaoi.biz",
};

export function readingPlatformName(href: string) {
  try {
    const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return READING_PLATFORM_NAMES[hostname] ?? hostname;
  } catch {
    return "Official English";
  }
}
