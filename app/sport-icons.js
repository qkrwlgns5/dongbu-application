// Original pictograms; no third-party image assets or remote image requests.
// Festival coverage checked 2026-09-14 against the School Sports Club Portal:
// https://schoolsportsclub.or.kr/games/result/clbr/info
/** @typedef {{key: string, label: string, englishName: string, aliases: readonly string[], src: string}} SportIcon */
/** @type {Array<[string, string, string, string[]]>} */
const definitions = [
  [
    "basketball-3x3",
    "3x3 농구",
    "3X3 BASKETBALL",
    [
      "3x3",
      "3×3",
      "3대3",
      "3on3"
    ]
  ],
  [
    "netball",
    "넷볼",
    "NETBALL",
    [
      "넷볼",
      "netball"
    ]
  ],
  [
    "basketball",
    "농구",
    "BASKETBALL",
    [
      "농구",
      "basketball"
    ]
  ],
  [
    "volleyball",
    "배구",
    "VOLLEYBALL",
    [
      "배구",
      "volleyball"
    ]
  ],
  [
    "badminton",
    "배드민턴",
    "BADMINTON",
    [
      "배드민턴",
      "badminton"
    ]
  ],
  [
    "sport-stacking",
    "스포츠스태킹",
    "SPORT STACKING",
    [
      "스포츠스태킹",
      "스포츠스태킹",
      "스태킹",
      "스택킹",
      "stacking"
    ]
  ],
  [
    "baseball",
    "연식야구",
    "SOFT BASEBALL",
    [
      "연식야구",
      "야구",
      "baseball"
    ]
  ],
  [
    "athletics",
    "육상",
    "ATHLETICS",
    [
      "육상",
      "athletics",
      "달리기"
    ]
  ],
  [
    "jokgu",
    "족구",
    "JOKGU",
    [
      "족구",
      "jokgu"
    ]
  ],
  [
    "jump-rope",
    "줄넘기",
    "JUMP ROPE",
    [
      "줄넘기",
      "jumprope"
    ]
  ],
  [
    "football",
    "축구",
    "FOOTBALL",
    [
      "축구",
      "football",
      "soccer"
    ]
  ],
  [
    "cheerleading",
    "치어리딩",
    "CHEERLEADING",
    [
      "치어리딩",
      "cheerleading"
    ]
  ],
  [
    "kinball",
    "킨볼",
    "KIN-BALL",
    [
      "킨볼",
      "kinball",
      "kin-ball"
    ]
  ],
  [
    "table-tennis",
    "탁구",
    "TABLE TENNIS",
    [
      "탁구",
      "tabletennis"
    ]
  ],
  [
    "teeball",
    "티볼",
    "TEE-BALL",
    [
      "티볼",
      "teeball",
      "tee-ball",
      "t볼"
    ]
  ],
  [
    "futsal",
    "풋살",
    "FUTSAL",
    [
      "풋살",
      "futsal"
    ]
  ],
  [
    "flying-disc",
    "플라잉디스크",
    "FLYING DISC",
    [
      "플라잉디스크",
      "얼티미트",
      "디스크골프",
      "flyingdisc",
      "ultimate"
    ]
  ],
  [
    "floorball",
    "플로어볼",
    "FLOORBALL",
    [
      "플로어볼",
      "floorball"
    ]
  ],
  [
    "dodgeball",
    "피구",
    "DODGEBALL",
    [
      "피구",
      "dodgeball"
    ]
  ],
  [
    "generic",
    "기타 종목",
    "SPORTS",
    []
  ]
];
export const SPORT_ICONS = Object.freeze(definitions.map(([key, label, englishName, aliases]) =>
  Object.freeze({ key, label, englishName, aliases: Object.freeze(aliases), src: `/sport-icons/${key}.svg` })));
const byKey = new Map(SPORT_ICONS.map((icon) => [icon.key, icon]));
const comparable = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/×/g, "x").replace(/[\s_-]+/g, "");
export function normalizeSportIconKey(value, fallback = "auto") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || (value !== "auto" && !byKey.has(value))) {
    throw new Error("종목 그림을 목록에서 선택해 주세요.");
  }
  return value;
}
export function resolveSportIcon(iconKey, sportName = "") {
  const selected = byKey.get(iconKey);
  if (selected) return selected;
  const name = comparable(sportName);
  return SPORT_ICONS.find((icon) => icon.aliases.some((alias) => name.includes(comparable(alias)))) ?? SPORT_ICONS[SPORT_ICONS.length - 1];
}
