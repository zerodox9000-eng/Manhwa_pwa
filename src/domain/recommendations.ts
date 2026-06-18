import { metricValue } from "./metrics";
import { isGenreTag, tagRoot } from "./query";
import type { HistoryMap, MetricId, RecommendationFeature, RecommendationShelf, SeriesCatalog, TagNode } from "./types";

interface ScoredRecommendation {
  item: SeriesCatalog;
  finalScore: number;
  profileScore: number;
  textScore: number;
  tagScore: number;
  qualityScore: number;
  sharedPrimaryAnchors: number;
  matchTier: number;
}

const PROFILE_WEIGHTS: Record<string, number> = {
  "business-core": 6.4,
  "murim-core": 6.1,
  "game-core": 6.1,
  "court-core": 5.8,
  "family-politics-core": 5.8,
  "school-core": 4.8,
  "survival-core": 5.4,
  "romance-core": 4.2,
  "psychological-core": 5.2,
  "showbiz-core": 4.8,
  "sports-core": 4.7,
  "food-core": 4.4,
  "medical-core": 4.4,
  "engineering-core": 5.0,
  "meta-core": 4.6,
  "business-career-regression": 5.6,
  "korean-corporate-regression": 6.4,
  "sci-fi-business-regression": 7,
  "corporate-workplace": 3.4,
  "korean-business": 2.7,
  "business-career": 2.4,
  "regression-return": 2.4,
  "modern-workplace": 2,
  "modern-korea": 1.6,
  "horror-survival": 5.2,
  "murim-wuxia": 5.2,
  "chinese-murim": 4.6,
  "game-system": 4.6,
  "euro-fantasy": 4.1,
  "kingdom-management": 4.4,
  "engineering-builder": 3.8,
  "medical-career": 4.2,
  "showbiz-career": 3.4,
  "sports-career": 3.8,
  "food-career": 3.4,
  "office-romance": 3.2,
  "romance-heavy": 2.2,
  "school-life": 1.2,
};

const PRIMARY_PROFILE_GROUPS = new Set([
  "business-core",
  "murim-core",
  "game-core",
  "court-core",
  "family-politics-core",
  "school-core",
  "survival-core",
  "romance-core",
  "psychological-core",
  "showbiz-core",
  "sports-core",
  "food-core",
  "medical-core",
  "engineering-core",
  "meta-core",
  "business-career-regression",
  "korean-corporate-regression",
  "sci-fi-business-regression",
  "corporate-workplace",
  "korean-business",
  "business-career",
  "horror-survival",
  "murim-wuxia",
  "chinese-murim",
  "game-system",
  "euro-fantasy",
  "kingdom-management",
  "engineering-builder",
  "medical-career",
  "showbiz-career",
  "sports-career",
  "food-career",
  "office-romance",
]);

const CORE_PROFILE_GROUPS = new Set([
  "business-core",
  "murim-core",
  "game-core",
  "court-core",
  "family-politics-core",
  "school-core",
  "survival-core",
  "romance-core",
  "psychological-core",
  "showbiz-core",
  "sports-core",
  "food-core",
  "medical-core",
  "engineering-core",
  "meta-core",
]);

const STORY_FAMILY_PATTERNS: Array<{ id: string; tag: RegExp; text: RegExp; anchor?: boolean }> = [
  {
    id: "business-core",
    tag: /economics|company|corporate|conglomerate|chaebol|merchant|business|sales|trading|hostile takeover|office worker|office|employee|director|secretary|workplace|ceo|manager/,
    text: /business|economics|merchant|company|corporate|conglomerate|chaebol|ceo|director|office|employee|workplace|career|trading|takeover|sales|manager|executive|corporate/,
    anchor: true,
  },
  {
    id: "murim-core",
    tag: /murim|wuxia|martial arts|cultivation|martial artist|ancient china|chinese mythology|sect|inner energy|qi/,
    text: /murim|wuxia|cultivation|martial arts|martial world|sect|qi|inner energy|sword saint|jianghu|dao|disciples|martial artist/,
    anchor: true,
  },
  {
    id: "game-core",
    tag: /dungeon|tower|level system|game system|game world|game elements|ranker|hunter|virtual reality|system administrator|quest|raid|status window/,
    text: /dungeon|tower|level system|game system|game world|ranker|hunter|virtual reality|system|quest|raid|status window|level up|player/,
    anchor: true,
  },
  {
    id: "court-core",
    tag: /european ambience|medieval|nobility|royalty|duke|prince|princess|emperor|villainess|king|queen|castle|throne|duchy|palace|court/,
    text: /palace|court|royal|throne|queen|concubine|prince|princess|duke|duchess|emperor|noble house|succession|duchy|royalty|castle/,
    anchor: true,
  },
  {
    id: "family-politics-core",
    tag: /family|inheritance|heir|lineage|marriage alliance|household|succession|estate|noble house|clan politics|family politics|bloodline/,
    text: /family politics|inheritance|heir|lineage|household|succession|family|estate|noble house|clan|bloodline|marriage alliance|house politics/,
    anchor: true,
  },
  {
    id: "school-core",
    tag: /school|high school|academy|student|teacher|classmate|campus/,
    text: /school|high school|academy|student|teacher|campus|classmate|homeroom|classroom/,
  },
  {
    id: "survival-core",
    tag: /horror|gore|zombie|ghost|death game|psychological horror|survival horror|apocalypse|deadly game|survival/,
    text: /survival|horror|gore|zombie|ghost|death game|apocalypse|psychological horror|survival horror|deadly game|threat of death/,
    anchor: true,
  },
  {
    id: "romance-core",
    tag: /office romance|mature romance|romantic|dating|love triangle|pregnancy|marriage proposal|forbidden love|unrequited love|romance/,
    text: /romance|love triangle|dating|marriage proposal|forbidden love|unrequited love|couple|affair|boyfriend|girlfriend|pregnancy|marriage/,
    anchor: true,
  },
  {
    id: "psychological-core",
    tag: /psychological|thriller|mystery|trauma|obsession|manipulation|dark|twisted/,
    text: /psychological|thriller|mystery|trauma|obsession|manipulation|dark|twisted|obsessive|mind game/,
    anchor: true,
  },
  {
    id: "showbiz-core",
    tag: /actor|actress|idol|showbiz|entertainment industry|celebrity/,
    text: /actor|actress|idol|showbiz|entertainment industry|celebrity|stage|broadcast|agency/,
  },
  {
    id: "sports-core",
    tag: /sports|boxing|baseball|basketball|football|tennis|golf|wrestling|racing|athletics/,
    text: /sports|boxing|baseball|basketball|football|tennis|golf|wrestling|racing|athletics|competition/,
  },
  {
    id: "food-core",
    tag: /food|cooking|restaurant|gourmet|chef/,
    text: /food|cooking|restaurant|gourmet|chef|meal|recipe|kitchen/,
  },
  {
    id: "medical-core",
    tag: /doctor|hospital|surgeon|nurse|clinic|patient|medical/,
    text: /doctor|hospital|surgeon|nurse|clinic|patient|medical|surgery|treatment/,
  },
  {
    id: "engineering-core",
    tag: /engineering|construction|architecture|agriculture|inventions|developer|builder/,
    text: /engineering|construction|architecture|developer|builder|agriculture|inventions|building|design|project/,
    anchor: true,
  },
  {
    id: "meta-core",
    tag: /webtoon|game world|virtual reality|system administrator|reader|character/,
    text: /webtoon|game world|virtual reality|system|reader|character|inside the story|fiction|meta/,
  },
];

const TEXT_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "and",
  "back",
  "been",
  "but",
  "for",
  "from",
  "has",
  "have",
  "her",
  "him",
  "his",
  "into",
  "life",
  "manhwa",
  "new",
  "not",
  "one",
  "source",
  "that",
  "the",
  "their",
  "them",
  "then",
  "this",
  "with",
  "world",
]);

function normalizeText(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function featureTermText(series: SeriesCatalog) {
  return normalizeText(
    [
      series.display_title,
      series.mangabaka_title,
      series.native_title,
      series.romanized_title,
      ...(series.authors ?? []),
      ...(series.artists ?? []),
    ].join(" "),
  );
}

function hasText(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function tagText(tag: TagNode) {
  return `${tag.name} ${tag.path}`.toLowerCase();
}

function pathHas(tag: TagNode, pattern: RegExp) {
  return pattern.test(tagText(tag));
}

function seriesTagTexts(series: SeriesCatalog, tagsById: Map<number, TagNode>) {
  return (series.tag_ids ?? []).map((id) => tagsById.get(id)).filter((tag): tag is TagNode => Boolean(tag));
}

function tagCount(tags: TagNode[], pattern: RegExp) {
  return tags.filter((tag) => pathHas(tag, pattern)).length;
}

function hasExactGenre(tags: TagNode[], name: string) {
  const target = name.toLowerCase();
  return tags.some((tag) => isGenreTag(tag) && tag.name.trim().toLowerCase() === target);
}

function addFeature(features: Record<string, number>, key: string, value: number) {
  features[key] = Number(((features[key] ?? 0) + value).toFixed(4));
}

function familySignalsFor(series: SeriesCatalog, tagsById: Map<number, TagNode>) {
  const signals: Record<string, number> = {};
  const text = normalizeText(
    [
      featureTermText(series),
      ...(series.tag_ids ?? [])
        .map((id) => tagsById.get(id))
        .filter((tag): tag is TagNode => Boolean(tag))
        .map((tag) => `${tag.name} ${tag.path}`),
    ].join(" "),
  );
  for (const family of STORY_FAMILY_PATTERNS) {
    const tagMatches = (series.tag_ids ?? [])
      .map((id) => tagsById.get(id))
      .filter((tag): tag is TagNode => Boolean(tag))
      .filter((tag) => family.tag.test(tagText(tag))).length;
    const textMatches = family.text.test(text) ? 1 : 0;
    const score = tagMatches * 1.15 + textMatches * 0.9;
    if (score > 0) addFeature(signals, family.id, score);
  }
  return signals;
}

function buildDominantContext(series: SeriesCatalog, tagsById: Map<number, TagNode>) {
  const tags = seriesTagTexts(series, tagsById);
  if (!tags.length) return { profileGroups: [], primaryAnchors: [] };
  const titleText = featureTermText(series);
  const familySignals = familySignalsFor(series, tagsById);
  const groups = new Set<string>();
  const anchors = new Set<string>();

  const murim =
    tagCount(tags, /murim|wuxia|martial arts|cultivation|martial artist|ancient china|chinese mythology|sect/) > 0;
  const chineseMurim = murim && tagCount(tags, /china|chinese|ancient china|wuxia|cultivation|sect/) > 0;
  const kingdomManagement =
    tagCount(tags, /kingdom management|territory management|civilization|estate|agriculture/) > 0 ||
    /\b(estate|civilization|kingdom|territory)\b/.test(titleText);
  const engineering =
    tagCount(tags, /engineering|construction|architecture|agriculture|inventions|developer|builder/) > 0 ||
    /\b(engineer|engineering|developer|builder|construction|estate)\b/.test(titleText);
  const gameSignal =
    tagCount(tags, /dungeon|tower|level system|game system|game world|game elements|ranker|hunter|virtual reality|system administrator/) > 0;
  const game = gameSignal && !kingdomManagement;
  const business =
    tagCount(tags, /economics|company|corporate|conglomerate|chaebol|merchant|business|sales|trading|hostile takeover/) > 0;
  const regression =
    tagCount(tags, /time rewind|time travel|age regression|reincarnation|second chance|regression|regressed|returner/) > 0 ||
    /\b(reborn|regressed|returned|second chance|back in time)\b/.test(titleText);
  const modernKorea = tagCount(tags, /south korea|korean folklore|21st century|modern era/) > 0;
  const workplace = tagCount(tags, /company|ceos?|office worker|office|employee|director|secretary|workplace/) > 0;
  const euroFantasy = !murim && tagCount(tags, /european ambience|medieval|nobility|royalty|duke|prince|princess|emperor|villainess|kingdom|castle|territory management|kingdom management/) > 0;
  const horror =
    (!game && !murim && !kingdomManagement && hasExactGenre(tags, "horror")) ||
    (!game && !murim && !kingdomManagement && tagCount(tags, /horror|gore|zombie|ghost|death game|psychological horror|survival horror/) >= 2);
  const medical = !murim && tagCount(tags, /doctor|hospital|surgeon|nurse|clinic|patient|medical/) > 0;
  const showbiz = tagCount(tags, /actor|actress|idol|showbiz|entertainment industry/) > 0;
  const sports = !business && tagCount(tags, /sports|boxing|baseball|basketball|football|tennis|golf|wrestling|racing|athletics/) > 0;
  const food = tagCount(tags, /food|cooking|restaurant|gourmet|chef/) > 0;
  const school = tagCount(tags, /school|high school|academy|student|teacher/) > 0;
  const exactRomance = hasExactGenre(tags, "romance");
  const romanceStrong =
    exactRomance ||
    tagCount(tags, /office romance|mature romance|romantic|dating|love triangle|pregnancy|marriage proposal|forbidden love|unrequited love/) >= 1;
  const romanceCore = romanceStrong && !(game || murim || business);
  const officeRomance = romanceCore && workplace;
  const koreanCorporateRegression =
    business &&
    regression &&
    modernKorea &&
    tagCount(tags, /\beconomics\b|\bworking\b|politics|sci-fi|urban|smart protagonist|company|office worker/) >= 2;
  const sciFiBusinessRegression =
    business &&
    regression &&
    modernKorea &&
    tagCount(tags, /sci-fi|\beconomics\b|time rewind|time travel|smart protagonist|politics/) >= 3;

  if (business) groups.add("business-career");
  if (regression) groups.add("regression-return");
  if (modernKorea) groups.add("modern-korea");
  if (workplace) groups.add("modern-workplace");
  if (sciFiBusinessRegression) groups.add("sci-fi-business-regression");
  if (koreanCorporateRegression) groups.add("korean-corporate-regression");
  if (business && regression && (modernKorea || workplace)) groups.add("business-career-regression");
  if (business && workplace) groups.add("corporate-workplace");
  if (business && modernKorea) groups.add("korean-business");
  if (kingdomManagement) groups.add("kingdom-management");
  if (engineering) groups.add("engineering-builder");
  if (horror) groups.add("horror-survival");
  if (murim) groups.add("murim-wuxia");
  if (chineseMurim) groups.add("chinese-murim");
  if (game) groups.add("game-system");
  if (euroFantasy) groups.add("euro-fantasy");
  if (medical) groups.add("medical-career");
  if (showbiz) groups.add("showbiz-career");
  if (sports) groups.add("sports-career");
  if (food) groups.add("food-career");
  if (exactRomance && business) groups.add("romance-heavy");
  if (romanceCore) groups.add("romance-core");
  if (officeRomance) groups.add("office-romance");
  if (school) groups.add("school-life");

  const sortedFamilies = Object.entries(familySignals).sort((a, b) => b[1] - a[1]);
  for (const [family, score] of sortedFamilies) {
    if (score < 1.15) continue;
    groups.add(family);
    if (
      score >= 1.6 ||
      family === "business-core" ||
      family === "murim-core" ||
      family === "game-core" ||
      family === "court-core" ||
      family === "family-politics-core" ||
      family === "engineering-core"
    ) {
      anchors.add(family);
    }
  }

  if (groups.has("sci-fi-business-regression")) anchors.add("sci-fi-business-regression");
  if (groups.has("korean-corporate-regression")) anchors.add("korean-corporate-regression");
  if (groups.has("business-career-regression")) anchors.add("business-career-regression");
  if (groups.has("corporate-workplace")) anchors.add("corporate-workplace");
  if (groups.has("korean-business")) anchors.add("korean-business");
  if (groups.has("business-career") && !groups.has("business-career-regression")) anchors.add("business-career");
  if (groups.has("kingdom-management")) anchors.add("kingdom-management");
  if (groups.has("engineering-builder")) anchors.add("engineering-builder");
  if (groups.has("game-system")) anchors.add("game-system");
  if (groups.has("murim-wuxia")) anchors.add("murim-wuxia");
  if (groups.has("chinese-murim")) anchors.add("chinese-murim");
  if (groups.has("euro-fantasy")) anchors.add("euro-fantasy");
  if (groups.has("horror-survival")) anchors.add("horror-survival");
  if (groups.has("medical-career")) anchors.add("medical-career");
  if (groups.has("showbiz-career")) anchors.add("showbiz-career");
  if (groups.has("sports-career")) anchors.add("sports-career");
  if (groups.has("food-career")) anchors.add("food-career");
  if (groups.has("office-romance")) anchors.add("office-romance");

  return {
    profileGroups: [...groups].sort(),
    primaryAnchors: [...anchors].sort(),
  };
}

function withDominantContext(series: SeriesCatalog, feature: RecommendationFeature, tagsById: Map<number, TagNode>) {
  const context = buildDominantContext(series, tagsById);
  if (context.profileGroups.length === 0) return feature;
  return {
    ...feature,
    profileGroups: context.profileGroups,
    primaryAnchors: context.primaryAnchors,
  };
}

function fallbackTagWeight(tag: TagNode) {
  const root = tagRoot(tag);
  const name = tag.name.trim().toLowerCase();
  const level = Math.max(tag.level ?? 1, 1);

  if (root === "Work Info") return 0.05;
  if (root === "Derivative Work") return 0.08;
  if (root === "Audience Demographics") return 0.15;
  if (root === "Sexual Content") return 0.1;
  if (root === "Character Traits") return 0.18 / Math.sqrt(level);
  if (root === "Character Types") {
    if (/(male lead|female lead|protagonist|cast)$/.test(name)) return 0.16;
    return 0.44 / Math.sqrt(level);
  }
  if (root === "Settings") {
    if (name === "fantasy" || name === "supernatural" || name === "sci-fi") return 0.28;
    return 0.82 / Math.sqrt(level);
  }
  if (root === "Themes") {
    if (name === "drama" || name === "romance" || name === "comedy" || name === "slice of life") return 0.18;
    if (isGenreTag(tag)) return 1.5 / Math.sqrt(level);
    return 0.95 / Math.sqrt(level);
  }
  if (root === "Occupations" || root === "Activities") return 1.15 / Math.sqrt(level);
  if (root === "Locations") return 0.88 / Math.sqrt(level);
  if (root === "Narrative Tropes" || root === "World Building") return 1.05 / Math.sqrt(level);
  return isGenreTag(tag) ? 1 : 0.62 / Math.sqrt(level);
}

export function buildFallbackRecommendationFeature(series: SeriesCatalog, tagsById: Map<number, TagNode>): RecommendationFeature {
  const text = `${featureTermText(series)} ${(series.tag_ids ?? []).map((id) => tagsById.get(id)).filter(Boolean).map((tag) => tagText(tag!)).join(" ")}`;
  const profileGroups = new Set<string>();
  const familySignals = familySignalsFor(series, tagsById);

  if (hasText(text, /business|economics|merchant|company|corporate|conglomerate|chaebol|ceo|director|office|employee|workplace|career|trading|hostile takeover|sales/)) profileGroups.add("business-career");
  if (hasText(text, /regression|regressed|return|returned|reborn|reincarnation|second chance|time rewind|time travel|age regression|back in time/)) profileGroups.add("regression-return");
  if (hasText(text, /south korea|korean|seoul|chaebol|kdrama|naver|kakao|webtoon/)) profileGroups.add("modern-korea");
  if (hasText(text, /working|office|company|ceo|director|secretary|coworker|employee|career|manager/)) profileGroups.add("modern-workplace");
  if (hasText(text, /romance|marriage|pregnancy|dating|couple|wife|husband|fiance|one-night stand|love triangle|male lead falls in love|mature romance/)) profileGroups.add("romance-core");
  if (hasText(text, /horror|gore|ghost|zombie|death game|survival horror|psychological horror/)) profileGroups.add("horror-survival");
  if (hasText(text, /murim|wuxia|martial arts|cultivation|sect|martial artist|ancient china|chinese ambience|chinese mythology/)) profileGroups.add("murim-wuxia");
  if (hasText(text, /wuxia|cultivation|sect|ancient china|chinese ambience|chinese mythology/)) profileGroups.add("chinese-murim");
  if (hasText(text, /dungeon|tower|hunter|ranker|level system|game system|guild|virtual reality|game world|rpg/)) profileGroups.add("game-system");
  if (hasText(text, /kingdom management|territory management|civilization|estate|agriculture/)) profileGroups.add("kingdom-management");
  if (hasText(text, /engineering|engineer|developer|builder|construction|architecture|inventions|estate/)) profileGroups.add("engineering-builder");
  if (hasText(text, /european ambience|medieval|nobility|royalty|duke|prince|princess|emperor|villainess|castle|kingdom/)) profileGroups.add("euro-fantasy");
  if (hasText(text, /doctor|medical|hospital|surgeon|nurse|clinic|patient/)) profileGroups.add("medical-career");
  if (hasText(text, /actor|actress|idol|celebrity|showbiz|entertainment industry|manager/)) profileGroups.add("showbiz-career");
  if (hasText(text, /boxing|sports|baseball|basketball|football|tennis|golf|wrestling|athletics|racing/)) profileGroups.add("sports-career");
  for (const [family, score] of Object.entries(familySignals)) {
    if (score >= 1.15) profileGroups.add(family);
  }
  if (profileGroups.has("kingdom-management")) {
    profileGroups.delete("game-system");
    profileGroups.delete("horror-survival");
  }
  if (profileGroups.has("murim-wuxia")) {
    profileGroups.delete("euro-fantasy");
    profileGroups.delete("medical-career");
    profileGroups.delete("horror-survival");
  }
  if (profileGroups.has("game-system")) {
    profileGroups.delete("horror-survival");
  }
  if (profileGroups.has("business-career") && profileGroups.has("regression-return") && (profileGroups.has("modern-korea") || profileGroups.has("modern-workplace"))) profileGroups.add("business-career-regression");
  if (profileGroups.has("business-career") && profileGroups.has("regression-return") && profileGroups.has("modern-korea")) profileGroups.add("korean-corporate-regression");
  if (profileGroups.has("korean-corporate-regression") && hasText(text, /sci-fi|economics|time rewind|time travel|smart protagonist|politics/)) profileGroups.add("sci-fi-business-regression");
  if (profileGroups.has("business-career") && profileGroups.has("modern-workplace")) profileGroups.add("corporate-workplace");
  if (profileGroups.has("business-career") && profileGroups.has("modern-korea")) profileGroups.add("korean-business");
  if (profileGroups.has("business-career") && profileGroups.has("romance-core")) profileGroups.add("romance-heavy");
  if (profileGroups.has("romance-core") && profileGroups.has("modern-workplace") && !profileGroups.has("business-career")) profileGroups.add("office-romance");

  const tagFeatures: Record<string, number> = {};
  for (const tagId of series.tag_ids ?? []) {
    const tag = tagsById.get(tagId);
    if (!tag) continue;
    const weight = fallbackTagWeight(tag);
    addFeature(tagFeatures, `tag:${tagId}`, weight);
    if (tag.parent_id != null) addFeature(tagFeatures, `parent:${tag.parent_id}`, weight * 0.22);
    const root = tagRoot(tag);
    if (root) addFeature(tagFeatures, `root:${root}`, Math.min(0.12, weight * 0.08));
  }
  for (const [family, score] of Object.entries(familySignals)) {
    addFeature(tagFeatures, `story:${family}`, 1.6 * score);
  }

  const textFeatures: Record<string, number> = {};
  for (const token of featureTermText(series).split(" ")) {
    if (token.length >= 3 && !TEXT_STOPWORDS.has(token)) addFeature(textFeatures, token, 1);
  }
  for (const [family, score] of Object.entries(familySignals)) {
    addFeature(textFeatures, `story:${family}`, 1.4 * score);
  }

  return {
    id: series.id,
    profileGroups: [...profileGroups].sort(),
    primaryAnchors: [...profileGroups].filter((group) => PRIMARY_PROFILE_GROUPS.has(group)).sort(),
    tagFeatures,
    textFeatures,
    quality: {
      discPct: series.analytics?.fanFavouriteDiscoveryPercentile ?? null,
      fanPct: series.analytics?.fanFavouriteRaw ?? null,
      popularity: series.stats?.popularity ?? null,
    },
  };
}

function weightedOverlap(baseGroups: string[], candidateGroups: string[]) {
  const candidate = new Set(candidateGroups);
  let matched = 0;
  let total = 0;
  for (const group of baseGroups) {
    const weight = PROFILE_WEIGHTS[group] ?? 1;
    total += weight;
    if (candidate.has(group)) matched += weight;
  }
  return total > 0 ? matched / total : 0;
}

function cosine(left: Record<string, number>, right: Record<string, number>) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of Object.values(left)) leftNorm += value * value;
  for (const value of Object.values(right)) rightNorm += value * value;
  for (const [key, value] of Object.entries(left)) dot += value * (right[key] ?? 0);
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function groupSet(feature: RecommendationFeature) {
  return new Set(feature.profileGroups);
}

function anchorSet(feature: RecommendationFeature) {
  return new Set(feature.primaryAnchors);
}

function sharedCount(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function hasAny(groups: Set<string>, values: string[]) {
  return values.some((value) => groups.has(value));
}

function compatibilityStats(base: RecommendationFeature, candidate: RecommendationFeature) {
  const baseGroups = groupSet(base);
  const candidateGroups = groupSet(candidate);
  const baseAnchors = anchorSet(base);
  const candidateAnchors = anchorSet(candidate);
  const sharedAnchors = sharedCount(baseAnchors, candidateAnchors);

  return { baseGroups, candidateGroups, baseAnchors, candidateAnchors, sharedAnchors };
}

function storyAffinity(base: RecommendationFeature, candidate: RecommendationFeature, scores: { profileScore: number; tagScore: number; textScore: number }) {
  const { baseGroups, candidateGroups, baseAnchors, sharedAnchors } = compatibilityStats(base, candidate);
  const baseCoreGroups = [...baseGroups].filter((group) => CORE_PROFILE_GROUPS.has(group));
  const candidateCoreGroups = [...candidateGroups].filter((group) => CORE_PROFILE_GROUPS.has(group));
  const coreOverlap = weightedOverlap(baseCoreGroups, candidateCoreGroups);
  const anchorOverlap = baseAnchors.size > 0 ? sharedAnchors / baseAnchors.size : 0;
  const supportOverlap = scores.profileScore;
  const signalOverlap = Math.max(scores.tagScore, scores.textScore);

  const crossDomainPenalty =
    (baseGroups.has("business-core") && hasAny(candidateGroups, ["murim-core", "game-core", "survival-core"]) && !candidateGroups.has("business-core") ? 0.18 : 1) *
    (baseGroups.has("murim-core") && hasAny(candidateGroups, ["business-core", "romance-core", "court-core"]) && !candidateGroups.has("murim-core") ? 0.18 : 1) *
    (baseGroups.has("game-core") && hasAny(candidateGroups, ["business-core", "romance-core"]) && !candidateGroups.has("game-core") ? 0.24 : 1) *
    (baseGroups.has("court-core") && hasAny(candidateGroups, ["business-core", "murim-core", "game-core"]) && !candidateGroups.has("court-core") ? 0.05 : 1) *
    (baseGroups.has("romance-core") && hasAny(candidateGroups, ["business-core", "murim-core", "game-core"]) && !candidateGroups.has("romance-core") ? 0.55 : 1) *
    (baseGroups.has("survival-core") && candidateGroups.has("romance-core") && !candidateGroups.has("survival-core") ? 0.4 : 1);

  const anchorPenalty = baseAnchors.size > 0 && sharedAnchors === 0 ? 0.7 : 1;
  const affinity = Math.max(
    0.12,
    Math.min(
      1,
      (0.82 * coreOverlap + 0.08 * supportOverlap + 0.06 * anchorOverlap + 0.04 * signalOverlap) * crossDomainPenalty * anchorPenalty,
    ),
  );

  return affinity;
}

function qualityScore(feature: RecommendationFeature) {
  const disc = feature.quality.discPct == null ? 0 : Math.min(1, Math.max(0, feature.quality.discPct / 100));
  const fan = feature.quality.fanPct == null ? 0 : Math.min(1, Math.max(0, feature.quality.fanPct / 12));
  const popularity = feature.quality.popularity == null ? 0 : Math.min(1, Math.log10(feature.quality.popularity + 1) / 5);
  return disc * 0.65 + fan * 0.2 + popularity * 0.15;
}

export function scoreRecommendation(base: RecommendationFeature, candidate: RecommendationFeature, mode: "strict" | "relaxed" = "strict") {
  const profileScore = weightedOverlap(base.profileGroups, candidate.profileGroups);
  const tagScore = cosine(base.tagFeatures, candidate.tagFeatures);
  const textScore = cosine(base.textFeatures, candidate.textFeatures);
  const qScore = qualityScore(candidate);
  const basePrimaryAnchors = anchorSet(base);
  const sharedPrimaryAnchors = sharedCount(basePrimaryAnchors, anchorSet(candidate));
  const anchorCoverage = basePrimaryAnchors.size ? sharedPrimaryAnchors / basePrimaryAnchors.size : 0;
  const affinity = storyAffinity(base, candidate, { profileScore, tagScore, textScore }) * (mode === "strict" ? 1 : 0.92);
  const baseCoreGroups = base.profileGroups.filter((group) => CORE_PROFILE_GROUPS.has(group));
  const candidateCoreGroups = candidate.profileGroups.filter((group) => CORE_PROFILE_GROUPS.has(group));
  const coreOverlap = weightedOverlap(baseCoreGroups, candidateCoreGroups);
  const baseAnchors = anchorSet(base);
  const candidateAnchors = anchorSet(candidate);
  const sharedCoreAnchors = sharedCount(baseAnchors, candidateAnchors);

  if (baseCoreGroups.length > 0 && mode === "relaxed" && coreOverlap < 0.28 && sharedCoreAnchors === 0) return null;

  const sharedKoreanBusinessRegression =
    ((base.profileGroups.includes("sci-fi-business-regression") &&
      candidate.profileGroups.includes("sci-fi-business-regression")) ||
      (base.profileGroups.includes("korean-corporate-regression") &&
        candidate.profileGroups.includes("korean-corporate-regression")) ||
      (base.profileGroups.includes("business-career-regression") &&
        candidate.profileGroups.includes("business-career-regression"))) &&
    base.profileGroups.includes("korean-business") &&
    candidate.profileGroups.includes("korean-business");

  const finalScore =
    (profileScore * 0.55 +
      tagScore * 0.1 +
      textScore * 0.2 +
      qScore * 0.05 +
      anchorCoverage * 0.08 +
      Math.min(sharedPrimaryAnchors, 3) * 0.02 +
      (sharedKoreanBusinessRegression ? 0.18 : 0)) * affinity;

  if (finalScore < (mode === "strict" ? 0.08 : 0.12)) return null;
  return {
    finalScore,
    profileScore,
    textScore,
    tagScore,
    qualityScore: qScore,
    sharedPrimaryAnchors,
  };
}

export function rankRecommendations(args: {
  base: SeriesCatalog;
  candidates: SeriesCatalog[];
  tags: TagNode[];
  features: RecommendationFeature[];
  shelf: RecommendationShelf;
  history: HistoryMap;
  latestDate?: string | null;
}) {
  const { base, candidates, tags, features, shelf, history, latestDate } = args;
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const featuresById = new Map(features.map((feature) => [feature.id, feature]));
  const baseFeature = withDominantContext(base, featuresById.get(base.id) ?? buildFallbackRecommendationFeature(base, tagsById), tagsById);

  const scoreCandidates = (mode: "strict" | "relaxed", skipIds = new Set<number>()) =>
    candidates
      .filter((item) => !skipIds.has(item.id))
      .map((item): ScoredRecommendation | null => {
        const candidateFeature = withDominantContext(item, featuresById.get(item.id) ?? buildFallbackRecommendationFeature(item, tagsById), tagsById);
        const score = scoreRecommendation(baseFeature, candidateFeature, mode);
        return score ? { item, matchTier: mode === "strict" ? 0 : 1, ...score } : null;
      })
      .filter((item): item is ScoredRecommendation => Boolean(item));

  const strict = scoreCandidates("strict");
  const strictIds = new Set(strict.map(({ item }) => item.id));
  const relaxed = strict.length >= 12 ? [] : scoreCandidates("relaxed", strictIds);
  return [...strict, ...relaxed]
    .sort((a, b) => {
      if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
      if (Math.abs(a.finalScore - b.finalScore) > 0.0001) return b.finalScore - a.finalScore;
      if (Math.abs(a.profileScore - b.profileScore) > 0.0001) return b.profileScore - a.profileScore;
      if (Math.abs(a.textScore - b.textScore) > 0.0001) return b.textScore - a.textScore;
      if (Math.abs(a.tagScore - b.tagScore) > 0.0001) return b.tagScore - a.tagScore;
      for (const rule of shelf.sort) {
        const av = metricValue(a.item, rule.metric as MetricId, history, latestDate);
        const bv = metricValue(b.item, rule.metric as MetricId, history, latestDate);
        const aMissing = typeof av !== "string" && (av === -Infinity || av == null || Number.isNaN(Number(av)));
        const bMissing = typeof bv !== "string" && (bv === -Infinity || bv == null || Number.isNaN(Number(bv)));
        if (aMissing || bMissing) {
          if (aMissing && bMissing) continue;
          return aMissing ? 1 : -1;
        }
        if (av === bv) continue;
        const direction = rule.direction === "asc" ? 1 : -1;
        return av > bv ? direction : -direction;
      }
      if (Math.abs(a.qualityScore - b.qualityScore) > 0.0001) return b.qualityScore - a.qualityScore;
      return a.item.display_title.localeCompare(b.item.display_title);
    })
    .map(({ item }) => item);
}
