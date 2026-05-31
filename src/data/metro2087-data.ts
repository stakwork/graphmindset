// Moscow Metro 2087 — topology + lore.
// Coordinates are 2D plan view (x = east, z = north). The graph viz flips z
// (mapZ = -z) so north points "into the screen" in three.js space.
//
// Coordinates extracted directly from the official 2012 Moscow Metro SVG
// schematic (origin (1476, 1477), scale 25 SVG units = 1 our unit).
// Ring radius ≈ 15. Stations match the schematic's exact positions.

export type Status =
  | "stronghold"
  | "neutral"
  | "anomaly"
  | "scorched"
  | "flood"
  | "quarantine"
  | "lost"
  | "free"
  | "iron"
  | "swamp"
  | "commune"
  | "central"
  | "union"
  | "commune-line"
  | "central-zone"

export type Faction =
  | "union"
  | "central"
  | "commune"
  | "iron"
  | "free"
  | "swamp"
  | "none"

export interface Station {
  id: string
  ru: string
  en: string
  x: number
  z: number
  status: Status
  faction: Faction
  note?: string
}

export interface Line {
  id: string
  name: string
  en: string
  color: number
  depthBias: number
  closed?: boolean
  stations: string[]
}

export interface Ruin {
  x: number
  z: number
  w: number
  d: number
  h: number
  label: string
}

const S: Record<string, Station> = {}
const def = (
  id: string,
  ru: string,
  en: string,
  x: number,
  z: number,
  status: Status = "neutral",
  faction: Faction = "none",
  note?: string,
): void => {
  S[id] = { id, ru, en, x, z, status, faction, note }
}

// ===== Ring (Koltsevaya) — 12 stations, R≈15 =====
def("belorusskaya_k", "Белорусская", "Belorusskaya", -10.68, 10.6, "stronghold", "union")
def("novoslobodskaya", "Новослободская", "Novoslobodskaya", -4.36, 14.4, "stronghold", "union")
def("prospekt_mira_k", "Проспект Мира", "Prospekt Mira", 6.68, 13.32, "stronghold", "union")
def("komsomolskaya_k", "Комсомольская", "Komsomolskaya", 10.76, 10.2, "stronghold", "union", "three rail termini above — heavy garrison")
def("kurskaya_k", "Курская", "Kurskaya", 14.24, 2.52, "stronghold", "union")
def("taganskaya_k", "Таганская", "Taganskaya", 12.96, -5.92, "stronghold", "union")
def("paveletskaya_k", "Павелецкая", "Paveletskaya", 9.84, -10.08, "stronghold", "union")
def("dobryninskaya", "Добрынинская", "Dobryninskaya", 3.28, -13.76, "stronghold", "union")
def("oktyabrskaya_k", "Октябрьская", "Oktyabrskaya", -3.92, -13.64, "stronghold", "union")
def("park_kultury_k", "Парк Культуры", "Park Kultury", -10.48, -9.88, "stronghold", "union")
def("kievskaya_k", "Киевская", "Kievskaya", -14.32, -3.24, "stronghold", "union")
def("krasnopresnenskaya", "Краснопресненская", "Krasnopresnenskaya", -13.88, 5.52, "stronghold", "union")

// ===== Sokolnicheskaya (Red, line 1) =====
def("salaryevo", "Саларьево", "Salaryevo", -23.04, -38.92, "lost")
def("rumyantsevo", "Румянцево", "Rumyantsevo", -23.84, -35.12, "lost")
def("troparyovo", "Тропарёво", "Troparyovo", -23.84, -31.32, "scorched", "commune")
def("yugo_zapadnaya", "Юго-Западная", "Yugo-Zapadnaya", -23.84, -27.32, "stronghold", "commune")
def("prospekt_vernad", "Просп. Вернадского", "Prospekt Vernadskogo", -23.84, -24.12, "neutral", "commune")
def("universitet", "Университет", "Universitet", -21.08, -20.44, "stronghold", "commune", "pre-Fall MGU bunker network")
def("vorobyovy_gory", "Воробьёвы Горы", "Vorobyovy Gory", -17.8, -17.16, "flood", "none", "bridge collapsed — flooded")
def("sportivnaya", "Спортивная", "Sportivnaya", -14.52, -13.88, "neutral", "commune")
def("frunzenskaya", "Фрунзенская", "Frunzenskaya", -12.12, -11.48, "commune-line", "commune")
def("park_kultury_r", "Парк Культуры", "Park Kultury", -9.72, -9.12, "stronghold", "union")
def("kropotkinskaya", "Кропоткинская", "Kropotkinskaya", -7.44, -6.96, "neutral", "central")
def("biblioteka", "Библиотека Ленина", "Biblioteka", -5.04, -4.56, "stronghold", "central", "archive of the Republic")
def("okhotny_ryad", "Охотный Ряд", "Okhotny Ryad", 0.12, 0.6, "stronghold", "central")
def("lubyanka", "Лубянка", "Lubyanka", 2.92, 3.4, "quarantine", "central", "plague vaults — sealed")
def("chistye_prudy", "Чистые Пруды", "Chistye Prudy", 5.8, 6.28, "neutral")
def("krasnye_vorota", "Красные Ворота", "Krasnye Vorota", 7.96, 8.44, "neutral")
def("komsomolskaya_r", "Комсомольская", "Komsomolskaya", 10.72, 11.2, "stronghold", "union")
def("krasnoselskaya", "Красносельская", "Krasnoselskaya", 11.96, 14.48, "commune-line", "commune")
def("sokolniki", "Сокольники", "Sokolniki", 11.96, 18.56, "stronghold", "commune", "commune capital")
def("preobrazhenskaya", "Преображенская пл.", "Preobrazhenskaya", 14.56, 21.92, "commune-line", "commune")
def("cherkizovskaya", "Черкизовская", "Cherkizovskaya", 18.36, 27.32, "scorched", "commune")
def("ulitsa_pod", "Улица Подбельского", "Bulvar Rokossovskogo", 18.36, 29.32, "lost", "commune")

// ===== Zamoskvoretskaya (Green, line 2) =====
def("khovrino", "Ховрино", "Khovrino", -20.64, 39.08, "lost")
def("rechnoy_vokzal", "Речной Вокзал", "Rechnoy Vokzal", -20.64, 32.68, "anomaly", "none", "spider nests reported, 2086")
def("vodny_stadion", "Водный Стадион", "Vodny Stadion", -20.64, 29.48, "neutral")
def("voykovskaya", "Войковская", "Voykovskaya", -19.44, 25.64, "free", "free")
def("sokol", "Сокол", "Sokol", -16.48, 22.68, "iron", "iron", "Iron Order outpost")
def("aeroport", "Аэропорт", "Aeroport", -14.88, 21.08, "iron", "iron")
def("dinamo", "Динамо", "Dinamo", -14.08, 18.56, "iron", "iron", "Iron Order capital")
def("belorusskaya_z", "Белорусская", "Belorusskaya", -9.96, 9.88, "stronghold", "union")
def("mayakovskaya", "Маяковская", "Mayakovskaya", -8.04, 7.96, "stronghold", "central")
def("tverskaya", "Тверская", "Tverskaya", -5.0, 4.76, "stronghold", "central")
def("teatralnaya", "Театральная", "Teatralnaya", 0.12, -0.36, "stronghold", "central", "the Theatre — neutral ground")
def("novokuznetskaya", "Новокузнецкая", "Novokuznetskaya", 5.24, -5.48, "neutral")
def("paveletskaya_z", "Павелецкая", "Paveletskaya", 10.52, -10.76, "stronghold", "union")
def("avtozavodskaya", "Автозаводская", "Avtozavodskaya", 15.68, -16.12, "neutral")
def("kolomenskaya", "Коломенская", "Kolomenskaya", 16.88, -22.84, "free", "free")
def("kashirskaya", "Каширская", "Kashirskaya", 16.88, -25.96, "free", "free")
def("kantemirovskaya", "Кантемировская", "Kantemirovskaya", 18.36, -30.08, "neutral")
def("tsaritsyno", "Царицыно", "Tsaritsyno", 20.4, -32.12, "swamp", "swamp", "mutant tribes — DO NOT APPROACH")
def("orekhovo", "Орехово", "Orekhovo", 22.36, -34.08, "lost")
def("domodedovskaya", "Домодедовская", "Domodedovskaya", 26.36, -37.28, "lost")
def("krasnogvardeyskaya", "Красногвардейская", "Krasnogvardeyskaya", 32.92, -37.24, "lost")

// ===== Arbatsko-Pokrovskaya (Dark Blue, line 3) =====
def("shchyolkovskaya", "Щёлковская", "Shchyolkovskaya", 34.84, 32.76, "lost")
def("pervomayskaya", "Первомайская", "Pervomayskaya", 31.64, 29.56, "scorched")
def("izmaylovskaya", "Измайловская", "Izmaylovskaya", 28.44, 26.36, "neutral")
def("partizanskaya", "Партизанская", "Partizanskaya", 25.24, 23.16, "neutral", "free")
def("semyonovskaya", "Семёновская", "Semyonovskaya", 22.04, 19.96, "neutral")
def("elektrozavodskaya", "Электрозаводская", "Elektrozavodskaya", 20.6, 17.32, "stronghold", "iron", "munitions plant")
def("baumanskaya", "Бауманская", "Baumanskaya", 19.52, 7.88, "iron", "iron")
def("ploshchad_rev", "Площадь Революции", "Ploshchad Revolyutsii", 0.12, -1.32, "stronghold", "central")
def("arbatskaya", "Арбатская", "Arbatskaya", -5.92, -3.72, "stronghold", "central")
def("smolenskaya", "Смоленская", "Smolenskaya", -11.92, -3.72, "central-zone", "central")
def("park_pobedy", "Парк Победы", "Park Pobedy", -26.28, -7.68, "neutral")
def("slavyansky_b", "Славянский Бульвар", "Slavyansky Bulvar", -32.36, -3.96, "neutral")
def("kuntsevskaya", "Кунцевская", "Kuntsevskaya", -36.2, -0.12, "free", "free", "free traders")
def("molodezhnaya", "Молодёжная", "Molodyozhnaya", -37.84, 4.08, "scorched")
def("krylatskoye", "Крылатское", "Krylatskoye", -37.84, 9.88, "lost")
def("strogino", "Строгино", "Strogino", -37.84, 15.68, "lost")
def("myakinino", "Мякинино", "Myakinino", -37.84, 21.48, "lost")
def("volokolamskaya", "Волоколамская", "Volokolamskaya", -37.84, 28.28, "lost")

// ===== Filyovskaya (Light Blue, line 4) =====
def("studencheskaya", "Студенческая", "Studencheskaya", -19.48, -3.16, "neutral")
def("kutuzovskaya", "Кутузовская", "Kutuzovskaya", -24.12, -4.12, "neutral")
def("fili", "Фили", "Fili", -26.64, -3.12, "neutral")
def("bagrationovskaya", "Багратионовская", "Bagrationovskaya", -28.44, -1.32, "neutral")
def("filyovsky_park", "Филёвский Парк", "Filyovsky Park", -30.24, 0.48, "neutral")
def("pionerskaya", "Пионерская", "Pionerskaya", -33.04, 0.88, "neutral")

// ===== Tagansko-Krasnopresnenskaya (Purple, line 7) =====
def("planernaya", "Планерная", "Planernaya", -30.24, 39.08, "lost")
def("skhodnenskaya", "Сходненская", "Skhodnenskaya", -30.24, 34.28, "lost")
def("tushinskaya", "Тушинская", "Tushinskaya", -29.2, 26.92, "free", "free", "free traders / leader: Korbut")
def("shchukinskaya", "Щукинская", "Shchukinskaya", -24.8, 22.52, "anomaly")
def("oktyabrskoye_pole", "Октябрьское поле", "Oktyabrskoye Pole", -24.32, 20.08, "iron", "iron")
def("polezhayevskaya", "Полежаевская", "Polezhayevskaya", -23.92, 16.68, "iron", "iron")
def("begovaya", "Беговая", "Begovaya", -19.24, 12.0, "free", "free")
def("ulitsa_1905", "Улица 1905 года", "1905 goda St.", -15.72, 8.48, "free", "free")
def("barrikadnaya", "Баррикадная", "Barrikadnaya", -12.92, 5.52, "central-zone", "central")
def("pushkinskaya", "Пушкинская", "Pushkinskaya", -5.48, 3.96, "stronghold", "central")
def("kuznetsky_most", "Кузнецкий Мост", "Kuznetsky Most", 3.52, 3.96, "central-zone", "central")
def("kitay_gorod", "Китай-Город", "Kitay-Gorod", 6.68, 1.52, "stronghold", "central", "old town — heavy patrols")
def("proletarskaya", "Пролетарская", "Proletarskaya", 13.8, -6.4, "neutral")
def("volgogradsky", "Волгоградский пр.", "Volgogradsky Pr.", 18.6, -7.48, "scorched")
def("tekstilshchiki", "Текстильщики", "Tekstilshchiki", 23.36, -7.48, "lost")
def("kuzminki", "Кузьминки", "Kuzminki", 32.68, -7.48, "lost")
def("ryazansky", "Рязанский пр.", "Ryazansky Pr.", 35.36, -7.48, "lost")
def("vykhino", "Выхино", "Vykhino", 39.36, -7.48, "lost")
def("lermontovsky", "Лермонтовский пр.", "Lermontovsky Pr.", 41.6, -9.72, "lost")

// ===== Kaluzhsko-Rizhskaya (Orange, line 6) =====
def("medvedkovo", "Медведково", "Medvedkovo", 6.68, 39.08, "anomaly", "none", "sniper — base of north / north-north")
def("babushkinskaya", "Бабушкинская", "Babushkinskaya", 6.68, 37.08, "scorched")
def("sviblovo", "Свиблово", "Sviblovo", 6.68, 35.08, "neutral")
def("botanichesky", "Ботанический сад", "Botanichesky Sad", 6.68, 32.36, "swamp", "swamp", "overgrown — fungal blooms")
def("vdnkh", "ВДНХ", "VDNKh", 6.68, 27.88, "free", "free")
def("alekseyevskaya", "Алексеевская", "Alekseyevskaya", 6.68, 23.0, "neutral")
def("rizhskaya", "Рижская", "Rizhskaya", 6.68, 17.56, "neutral")
def("sukharevskaya", "Сухаревская", "Sukharevskaya", 6.68, 8.68, "neutral")
def("turgenevskaya", "Тургеневская", "Turgenevskaya", 6.68, 6.08, "central-zone", "central")
def("tretyakovskaya", "Третьяковская", "Tretyakovskaya", 4.28, -5.48, "neutral")
def("shabolovskaya", "Шаболовская", "Shabolovskaya", -4.24, -16.52, "neutral")
def("leninsky_pr", "Ленинский пр.", "Leninsky Pr.", -4.24, -19.12, "neutral")
def("akademicheskaya", "Академическая", "Akademicheskaya", -4.24, -21.72, "neutral")
def("profsoyuznaya", "Профсоюзная", "Profsoyuznaya", -4.24, -24.12, "free", "free")
def("cheryomushki", "Новые Черёмушки", "Novye Cheryomushki", -4.24, -26.12, "free", "free")
def("kaluzhskaya", "Калужская", "Kaluzhskaya", -4.24, -28.72, "neutral")
def("belyayevo", "Беляево", "Belyayevo", -4.24, -31.32, "lost")
def("konkovo", "Коньково", "Konkovo", -4.24, -33.92, "lost")
def("tyoply_stan", "Тёплый Стан", "Tyoply Stan", -4.24, -36.52, "anomaly", "none", "territories of the worm-cult")
def("yasenevo", "Ясенево", "Yasenevo", -4.24, -39.12, "lost")
def("novoyasenevskaya", "Новоясеневская", "Novoyasenevskaya", -4.24, -41.72, "lost")

// ===== Serpukhovsko-Timiryazevskaya (Gray, line 9) =====
def("altufyevo", "Алтуфьево", "Altufyevo", -0.32, 39.08, "lost", "none", "Spartan command — last contact 2083")
def("bibirevo", "Бибирево", "Bibirevo", -0.32, 37.08, "lost")
def("otradnoye", "Отрадное", "Otradnoye", -0.32, 35.08, "lost")
def("vladykino", "Владыкино", "Vladykino", -0.32, 32.36, "anomaly")
def("petrovsko_raz", "Петровско-Разум.", "Petrovsko-Razum.", -3.68, 28.28, "free", "free")
def("timiryazevskaya", "Тимирязевская", "Timiryazevskaya", -6.12, 25.88, "neutral")
def("dmitrovskaya", "Дмитровская", "Dmitrovskaya", -6.52, 22.36, "neutral")
def("savyolovskaya", "Савёловская", "Savyolovskaya", -6.52, 18.08, "neutral")
def("mendeleyevskaya", "Менделеевская", "Mendeleyevskaya", -3.68, 13.68, "neutral")
def("tsvetnoy", "Цветной Бульвар", "Tsvetnoy Bulvar", -1.16, 10.36, "neutral")
def("chekhovskaya", "Чеховская", "Chekhovskaya", -5.96, 4.76, "central-zone", "central")
def("borovitskaya", "Боровицкая", "Borovitskaya", -5.92, -4.56, "central-zone", "central")
def("polyanka", "Полянка", "Polyanka", 0.72, -11.2, "central-zone", "central")
def("serpukhovskaya", "Серпуховская", "Serpukhovskaya", 3.96, -14.44, "neutral")
def("tulskaya", "Тульская", "Tulskaya", 6.04, -16.52, "commune-line", "commune")
def("nagatinskaya", "Нагатинская", "Nagatinskaya", 7.56, -19.92, "commune-line", "commune")
def("nagornaya", "Нагорная", "Nagornaya", 7.56, -22.84, "neutral")
def("nakhimovsky", "Нахимовский пр.", "Nakhimovsky Pr.", 7.56, -25.32, "neutral")
def("sevastopolskaya", "Севастопольская", "Sevastopolskaya", 7.56, -27.76, "free", "free", "military intel — Sevastopol garrison")
def("chertanovskaya", "Чертановская", "Chertanovskaya", 7.56, -30.12, "lost")
def("yuzhnaya", "Южная", "Yuzhnaya", 7.56, -32.72, "lost")
def("prazhskaya", "Пражская", "Prazhskaya", 7.56, -35.32, "lost")
def("annino", "Аннино", "Annino", 7.56, -37.92, "lost")
def("bulvar_dd", "Б. Дм. Донского", "Bulvar D.Donskogo", 7.56, -40.52, "lost")

// ===== Kalininskaya (Yellow, line 8) =====
def("marksistskaya", "Марксистская", "Marksistskaya", 12.96, -6.88, "neutral")
def("ploshchad_il", "Площадь Ильича", "Ploshchad Ilyicha", 18.88, -2.56, "neutral")
def("aviamotornaya", "Авиамоторная", "Aviamotornaya", 29.0, 15.8, "anomaly", "none", "“Engine’s Breath” anomaly")
def("shosse_ent", "Шоссе Энтузиастов", "Shosse Entuziastov", 33.76, 16.48, "scorched")
def("perovo", "Перово", "Perovo", 38.56, 16.48, "lost")
def("novogireevo", "Новогиреево", "Novogireevo", 42.96, 16.48, "lost")

// ===== Lyublinsko-Dmitrovskaya (Light Green, line 10) =====
def("maryina_roshcha", "Марьина Роща", "Maryina Roshcha", -8.44, 35.88, "neutral")
def("dostoyevskaya", "Достоевская", "Dostoyevskaya", -7.96, 33.32, "neutral")
def("trubnaya", "Трубная", "Trubnaya", -5.92, 31.28, "central-zone", "central")
def("sretensky_b", "Сретенский б.", "Sretensky Bulvar", -2.92, 28.28, "central-zone", "central")
def("chkalovskaya", "Чкаловская", "Chkalovskaya", 6.0, 5.4, "neutral")
def("rimskaya", "Римская", "Rimskaya", 14.24, 1.08, "neutral", "none", "old town — “Venice”")
def("krestyanskaya", "Крестьянская Зст.", "Krestyanskaya Z.", 17.88, -2.56, "neutral")
def("dubrovka", "Дубровка", "Dubrovka", 18.6, -8.4, "scorched")
def("kozhukhovskaya", "Кожуховская", "Kozhukhovskaya", 20.0, -12.6, "lost")
def("pechatniki", "Печатники", "Pechatniki", 22.2, -14.8, "lost")
def("volzhskaya", "Волжская", "Volzhskaya", 29.72, -15.8, "lost")
def("lyublino", "Люблино", "Lyublino", 32.92, -20.68, "lost")
def("bratislavskaya", "Братиславская", "Bratislavskaya", 32.92, -23.28, "lost")
def("maryino", "Марьино", "Maryino", 32.92, -25.88, "lost")

export const stations: Record<string, Station> = S

export const lines: Line[] = [
  {
    id: "circle", name: "Кольцевая", en: "Koltsevaya", color: 0xb6724a, depthBias: 0.0, closed: true,
    stations: ["belorusskaya_k","novoslobodskaya","prospekt_mira_k","komsomolskaya_k","kurskaya_k","taganskaya_k","paveletskaya_k","dobryninskaya","oktyabrskaya_k","park_kultury_k","kievskaya_k","krasnopresnenskaya"],
  },
  {
    id: "sokol", name: "Сокольническая", en: "Sokolnicheskaya", color: 0xe53935, depthBias: 0.4,
    stations: ["salaryevo","rumyantsevo","troparyovo","yugo_zapadnaya","prospekt_vernad","universitet","vorobyovy_gory","sportivnaya","frunzenskaya","park_kultury_r","kropotkinskaya","biblioteka","okhotny_ryad","lubyanka","chistye_prudy","krasnye_vorota","komsomolskaya_r","krasnoselskaya","sokolniki","preobrazhenskaya","cherkizovskaya","ulitsa_pod"],
  },
  {
    id: "zamosk", name: "Замоскворецкая", en: "Zamoskvoretskaya", color: 0x44b85d, depthBias: 0.8,
    stations: ["khovrino","rechnoy_vokzal","vodny_stadion","voykovskaya","sokol","aeroport","dinamo","belorusskaya_z","mayakovskaya","tverskaya","teatralnaya","novokuznetskaya","paveletskaya_z","avtozavodskaya","kolomenskaya","kashirskaya","kantemirovskaya","tsaritsyno","orekhovo","domodedovskaya","krasnogvardeyskaya"],
  },
  {
    id: "arbat", name: "Арбатско-Покровская", en: "Arbatsko-Pokrovskaya", color: 0x1f5fb1, depthBias: 1.2,
    stations: ["volokolamskaya","myakinino","strogino","krylatskoye","molodezhnaya","kuntsevskaya","slavyansky_b","park_pobedy","kievskaya_k","smolenskaya","arbatskaya","ploshchad_rev","kurskaya_k","baumanskaya","elektrozavodskaya","semyonovskaya","partizanskaya","izmaylovskaya","pervomayskaya","shchyolkovskaya"],
  },
  {
    id: "filyov", name: "Филёвская", en: "Filyovskaya", color: 0x4cc4ee, depthBias: 1.6,
    stations: ["kievskaya_k","studencheskaya","kutuzovskaya","fili","bagrationovskaya","filyovsky_park","pionerskaya","kuntsevskaya"],
  },
  {
    id: "kalrij", name: "Калужско-Рижская", en: "Kaluzhsko-Rizhskaya", color: 0xee8033, depthBias: 2.0,
    stations: ["medvedkovo","babushkinskaya","sviblovo","botanichesky","vdnkh","alekseyevskaya","rizhskaya","prospekt_mira_k","sukharevskaya","turgenevskaya","kitay_gorod","tretyakovskaya","oktyabrskaya_k","shabolovskaya","leninsky_pr","akademicheskaya","profsoyuznaya","cheryomushki","kaluzhskaya","belyayevo","konkovo","tyoply_stan","yasenevo","novoyasenevskaya"],
  },
  {
    id: "tagan", name: "Таганско-Краснопр.", en: "Tagansko-Krasnopresnenskaya", color: 0x8d59a8, depthBias: 2.4,
    stations: ["planernaya","skhodnenskaya","tushinskaya","shchukinskaya","oktyabrskoye_pole","polezhayevskaya","begovaya","ulitsa_1905","barrikadnaya","pushkinskaya","kuznetsky_most","kitay_gorod","taganskaya_k","proletarskaya","volgogradsky","tekstilshchiki","kuzminki","ryazansky","vykhino","lermontovsky"],
  },
  {
    id: "kalin", name: "Калининская", en: "Kalininskaya", color: 0xe5b53a, depthBias: 2.8,
    stations: ["tretyakovskaya","marksistskaya","ploshchad_il","aviamotornaya","shosse_ent","perovo","novogireevo"],
  },
  {
    id: "serp", name: "Серпуховско-Тимир.", en: "Serpukhovsko-Timir.", color: 0x9aa3a8, depthBias: 3.2,
    stations: ["altufyevo","bibirevo","otradnoye","vladykino","petrovsko_raz","timiryazevskaya","dmitrovskaya","savyolovskaya","mendeleyevskaya","tsvetnoy","chekhovskaya","borovitskaya","polyanka","serpukhovskaya","tulskaya","nagatinskaya","nagornaya","nakhimovsky","sevastopolskaya","chertanovskaya","yuzhnaya","prazhskaya","annino","bulvar_dd"],
  },
  {
    id: "lyub", name: "Люблинско-Дмитр.", en: "Lyublinsko-Dmitr.", color: 0x9bcc55, depthBias: 3.6,
    stations: ["maryina_roshcha","dostoyevskaya","trubnaya","sretensky_b","chkalovskaya","rimskaya","krestyanskaya","dubrovka","kozhukhovskaya","pechatniki","volzhskaya","lyublino","bratislavskaya","maryino"],
  },
]

export const ruins: Ruin[] = [
  { x: 0, z: 0, w: 4, d: 4, h: 3.0, label: "KREMLIN" },
  { x: -16, z: -10, w: 2, d: 2, h: 2.0, label: "MGU" },
  { x: -1, z: 21, w: 2, d: 2, h: 2.5, label: "OSTANKINO" },
  { x: 18, z: -2, w: 1.5, d: 1.5, h: 1.6, label: "YAUZA" },
  { x: -3, z: 12, w: 2, d: 2, h: 1.4, label: "STATION" },
  { x: 12, z: 5, w: 3, d: 2, h: 1.6, label: "TERMINI" },
  { x: -20, z: -3, w: 2, d: 2, h: 2.0, label: "POBEDY" },
  { x: 10, z: -38, w: 2, d: 2, h: 1.4, label: "TSARITSYNO" },
]

export const STATUS_COLOR: Record<Status, number> = {
  stronghold: 0xe9c970,
  "commune-line": 0xe53935,
  "central-zone": 0xdadcc8,
  neutral: 0x9aa3a8,
  anomaly: 0xc43a2c,
  scorched: 0x7a4a2a,
  flood: 0x5a8aa8,
  quarantine: 0xcc7733,
  lost: 0x2a2a2a,
  free: 0xa5b48a,
  iron: 0x6f7a82,
  swamp: 0x7d6a4a,
  commune: 0xe53935,
  central: 0xdadcc8,
  union: 0xe9c970,
}

export const FACTION_NAME_RU: Record<Faction, string> = {
  union: "Союз Кольца",
  central: "Оплот Центра",
  commune: "Коммуна",
  iron: "Орден Железа",
  free: "Вольные",
  swamp: "Болотники",
  none: "—",
}

export const STATUS_NAME_RU: Record<Status, string> = {
  stronghold: "Оплот",
  neutral: "Нейтральная",
  anomaly: "Аномалия",
  scorched: "Выжжено",
  flood: "Затоплено",
  quarantine: "Карантин",
  lost: "Потеряно",
  "commune-line": "Линия Коммуны",
  "central-zone": "Зона Оплота",
  free: "Вольные торговцы",
  iron: "Орден Железа",
  swamp: "Болотники",
  commune: "Коммуна",
  central: "Оплот",
  union: "Союз Кольца",
}
