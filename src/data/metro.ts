import { stations as stations2087, lines as lines2087 } from "./metro2087-data"
import type { Station } from "./metro2087-data"

// 2087 line id → graph color name. The names match keys in MetroCanvas's
// METRO_LINE_COLORS so each line renders in the correct palette.
const LINE_COLOR_BY_ID: Record<string, string> = {
  circle: "brown",
  sokol: "red",
  zamosk: "green",
  arbat: "darkblue",
  filyov: "lightblue",
  kalrij: "orange",
  tagan: "purple",
  kalin: "yellow",
  serp: "gray",
  lyub: "lightgreen",
}

// Compute the comma-joined `line` property for each station — used by
// MetroCanvas to color the brown ring smoothing and as ambient metadata.
const LINES_BY_STATION = (() => {
  const map = new Map<string, string[]>()
  for (const L of lines2087) {
    const color = LINE_COLOR_BY_ID[L.id]
    if (!color) continue
    for (const sid of L.stations) {
      let arr = map.get(sid)
      if (!arr) { arr = []; map.set(sid, arr) }
      if (!arr.includes(color)) arr.push(color)
    }
  }
  return map
})()

// Lore overrides applied on top of the auto-generated station properties.
// Drop a `description` for the popover blurb and `image` for the thumbnail
// — files live in /public/images/ and are referenced like "/images/foo.png".
const STATION_LORE: Record<
  string,
  { description?: string; image?: string }
> = {
  vdnkh: {
    description:
      "Northern terminus of the red Sokolnicheskaya line and Artyom's home station. Raised here under Sukhoi's command, Artyom set out from VDNKh in 2033 to call for help after the Dark Ones broke through. The mushroom farms and pig pens of VDNKh are the metro's most famous green-thumb economy.",
  },
  biblioteka: {
    description:
      "Capital of Polis and seat of the Brahmins — keepers of pre-war knowledge. Four lines meet under the Great Library above, where Librarians prowl the stacks. The path to D6 began here in 2033.",
  },
  park_pobedy: {
    description:
      "Western terminus on the dark-blue line and one of the deepest stations in Moscow. The Dark Ones surfaced from here onto the surface ruins of Victory Park — Artyom's final mission in Metro 2033 launched out of this hall.",
  },
  sevastopolskaya: {
    description:
      "Southern frontier of the gray Serpukhovskaya line — a small republic that survives on hydropower and constant mutant warfare. Hunter is brigadier here in 2034; the watchmen on the dark south tunnels are its grim immortals.",
  },
  polyanka: {
    description:
      "Mid-gray-line junction whose flooded lower decks separate Sevastopolskaya from the safe north. Setting of much of Metro 2034 as Hunter, Homer, and Sasha cross the gray frontier.",
  },
  tulskaya: {
    description:
      "Gray-line station overrun by the Worm Cult fanatics in 2034. Their plague and panic almost cost the rest of the metro the south.",
  },
  komsomolskaya_k: {
    description:
      "Ring-line transfer above three mainline rail termini — Hansa's heaviest garrison. The three-station transfer cluster (Komsomolskaya / Komsomolskaya-R / Krasnoselskaya) is the crown jewel of the brown ring.",
  },
  paveletskaya_k: {
    description:
      "Wealthy Hansa station on the southern ring; a major trade hub where MGR rounds change hands by the crate.",
  },
  dobryninskaya: {
    description:
      "Hansa ring station guarding the south transfer to the gray line — frontier checkpoint against Fourth Reich incursions.",
  },
  oktyabrskaya_k: {
    description:
      "Hansa ring station between Dobryninskaya and Park Kultury — controls trade between the southwest and the central core.",
  },
  borovitskaya: {
    description:
      "Polis member station; the Council of Brahmins convenes in its halls.",
  },
  arbatskaya: {
    description:
      "Polis member station and one of Moscow's deepest — Polis's military fist, garrisoned by the Spartans before their move to D6.",
  },
}

// Convert a 2087 station into a graph node. mapZ is negated because the
// 2087 dataset uses +z = north while the graph (and Three.js) expect -z = north.
function stationNode(s: Station) {
  const properties: Record<string, unknown> = {
    // `name` drives the 3D label and the popover title — keep it English so
    // the visualization is readable for non-Russian-speaking viewers.
    // `name_ru` is preserved for context (rendered as a small subtitle).
    name: s.en,
    name_ru: s.ru,
    line: (LINES_BY_STATION.get(s.id) ?? []).join(","),
    status: s.status,
    faction: s.faction,
    mapX: s.x,
    mapZ: -s.z,
  }
  if (s.note) properties.note = s.note
  const lore = STATION_LORE[s.id]
  if (lore) Object.assign(properties, lore)
  return {
    date_added_to_graph: 1778230600.0,
    node_type: "Station",
    properties,
    ref_id: s.id,
  }
}

interface RawEdge {
  edge_type: string
  source: string
  target: string
  ref_id: string
  weight: number
  properties: Record<string, unknown>
}

// Walk each line and emit a TUNNEL_TO edge between every consecutive pair of
// stations; closed lines (only the brown ring today) get a final wraparound
// segment so the smooth-circle pass in MetroCanvas has a complete loop.
function tunnelEdges(): RawEdge[] {
  const edges: RawEdge[] = []
  for (const L of lines2087) {
    const color = LINE_COLOR_BY_ID[L.id]
    if (!color) continue
    for (let i = 0; i < L.stations.length - 1; i++) {
      edges.push({
        edge_type: "TUNNEL_TO",
        properties: { line: color },
        ref_id: `m-t-${L.id}-${i}`,
        source: L.stations[i],
        target: L.stations[i + 1],
        weight: 1,
      })
    }
    if (L.closed && L.stations.length > 1) {
      edges.push({
        edge_type: "TUNNEL_TO",
        properties: { line: color },
        ref_id: `m-t-${L.id}-close`,
        source: L.stations[L.stations.length - 1],
        target: L.stations[0],
        weight: 1,
      })
    }
  }
  return edges
}

const stationNodes = Object.values(stations2087).map(stationNode)
const tunnels = tunnelEdges()

// Map fixture ref_ids to their backend UUIDs. Keeps the inline node/edge
// definitions readable while letting the runtime data align with the seeded
// graph so unlock/preview calls hit the right backend records.
//
// Stations are mapped separately in STATION_BACKEND_REF_ID_MAP (below), since
// the backend DOES have all ~160 Station nodes (it's a seed of this fixture).
// The only exceptions are the dual-platform transfer twins, which the backend
// collapses into their ring node — those keep fixture slugs to preserve the
// dual-platform schematic and short-circuit in node-preview-panel.
const BACKEND_REF_ID_MAP: Record<string, string> = {
  // Persons
  Artyom: "e7542bf7-1390-458a-af69-f334d1c59f8c",
  Anna: "a4f71239-a934-4600-90f4-692b3caa1a8f",
  Miller: "d3caecc7-941d-40ac-978a-849f9c4ceca4",
  Khan: "52dd33b9-13a3-4216-aef6-b616e18f8e80",
  Hunter: "4b5d9f6a-3cb1-4876-a7f5-e1c339ac223c",
  Pavel: "4cd2d13e-9d0d-4da6-a6ff-5cf7944b6b89",
  Bourbon: "6375bc51-0173-4ba1-b81a-5a1ece283263",
  Ulman: "0c041493-6c6f-4c70-93e6-cdf488dab8e7",
  Sukhoi: "48775912-5cee-4f8e-9927-2ea7cf7018e4",
  Damir: "dd79822e-2b2e-4d55-a5e0-839c45f90dd2",
  Tokarev: "a357aa9b-c8ac-4292-99f8-40ef5fefef17",
  Stepan: "422057e8-fbc1-4000-8226-27026bd58c1a",
  Krest: "af7fdb5c-2527-4e86-b754-9c5aea526b60",
  Idiot: "2ec82fc8-5dac-463d-a1e0-f6a8676aded0",
  Sam: "5e0e0816-21c6-4290-a83a-06b38c863765",
  Khlebnikov: "edbe69a6-ab4c-48e6-8698-94e948bd00a3",
  Kirill: "9b913f07-2ffa-488f-878f-2cb135c4a250",
  Lesnitsky: "e8441af8-ee86-4841-955e-53ff741a4f0c",
  // Organizations
  SpartanOrder: "061e560b-05f4-4e88-ba86-d2abf23cd730",
  RedLine: "948ca7bd-bf56-4bdb-a3ff-06a44c35b82b",
  FourthReich: "3e37e9be-c66a-4fd0-83af-bf45e192b01f",
  Hansa: "a933966a-600f-4dd5-a0e2-0a60bc7b2e4a",
  Polis: "9753580e-2c13-43ff-a391-da9d904ff2ff",
  AuroraCrew: "00f302c2-cdcc-4f54-99b0-975b401f80f1",
  GreatWormCult: "2798e9d4-c41d-4189-8d90-7b9b25d48a7e",
  TaigaWatchmen: "0bb29bd8-1511-4c0b-9f02-971f428a105c",
  ChildrenOfForest: "8991d537-911d-4437-9c3a-7cfe3552d5c4",
  CaspianPirates: "7f91e83f-f8ef-4387-8ced-4d85e9e77619",
  Stalkers: "0b9f640c-2859-45f3-a533-29a98877af26",
  // Locations
  MoscowMetro: "e44dad45-8c38-4470-a830-50c2eba36659",
  D6: "3be86cf6-e108-4bc8-9a49-e8881228a251",
  Volga: "5978ade2-956c-40fa-a814-d1fe16f86f2b",
  Caspian: "ac2d3d1d-b322-4771-b9f2-3cf417a272f3",
  Taiga: "ed75df74-4e5f-4a63-a5e8-16f40494ea1a",
  Yamantau: "86eaa97b-9254-4e13-a251-af31d82ec86c",
  Baikal: "2b0679ea-778a-4661-ac5e-b11d6ee94e45",
  Novosibirsk: "e78548d9-bcb7-413f-bc5c-581da4bd1361",
  DeadCity: "bb9f9fbf-a033-4b25-bb9f-ecfc60a92b93",
  Surface: "7581a86a-ce16-4b68-89fc-f87ff87ca55b",
  // Transports
  Aurora: "1cad61aa-761b-499b-be0e-551115a9e0e7",
  Handcar: "86b59186-c58c-475b-970b-f7e6a4be4334",
  HansaTrain: "3a488abf-2ccc-419e-9507-9d4d5f98a585",
  CaspianBoat: "888635f3-cb65-4d44-8a1a-983b6ed0aca0",
  // Creatures
  Nosalis: "5d074699-4692-436b-bbfe-ca8208325394",
  Lurker: "64924159-a014-4bea-83c9-d8b0be510a3d",
  Watcher: "aac06586-0a77-4fc2-9ac6-54faaee8b6c0",
  Demon: "da67ad65-6ad0-4e16-9de2-2d77d1d83477",
  Librarian: "1ee142e8-a1c1-4ff4-8ddf-b0d9abdb7e53",
  DarkOnes: "1f17c4b4-35b2-4710-be9c-3ae3c19f07f2",
  Shrimp: "803c4b1b-679e-4511-87f1-aa9988aa63a7",
  Humanimal: "fa79b68d-6e1b-4c3f-af04-43eae18736da",
  Watchman: "6d9ce4e1-b836-4a7a-943a-f99162d2cf10",
  MutantBear: "4fcdc414-8600-4d4b-998f-201052cfeede",
  // Weapons
  Bastard: "57f5dbf1-7d92-4979-865a-6f49c2e93278",
  Tikhar: "fdd6ff7f-c851-436b-ac9b-9c5a6afb989e",
  Helsing: "51f6fef1-e318-4b49-ad8f-3b0c9730f773",
  Ashot: "61f0a4ac-8562-4e50-87c9-7ed8a3d75cc7",
  VoltDriver: "06a928c6-add4-4a5c-8ed8-a4390c2b563f",
  // Items
  GasMask: "def60281-b0c7-4047-93a9-399251f819a8",
  Filter: "9dff2b2c-2c30-4f0b-9f14-5935cb20e25f",
  Charger: "9bf3dbf4-57c8-41eb-b322-a260b0e0b3f7",
  MGR: "a8353dcb-d156-4961-a6d5-d355f20e6b75",
  Medkit: "4fa8c19b-5731-4ed3-be2b-446deea91ce3",
  Workbench: "41d28422-9013-4761-8273-756c19df360b",
}

// Fixture station slug -> backend Station UUID. Generated by matching each
// fixture station's (x, -z) to the DB Station node's (mapX, mapZ) — the DB
// is a faithful seed of the fixture, so coordinates align exactly. Lets
// clicking a station resolve to its live DB record (content, edges, unlock)
// while the fixture still provides the static schematic (positions + tunnels).
//
// The 4 dual-platform transfer twins (park_kultury_r, komsomolskaya_r,
// belorusskaya_z, paveletskaya_z) are intentionally absent: the DB collapses
// them into their ring node, so they keep fixture slugs and short-circuit
// (their ring counterpart loads the shared real station).
const STATION_BACKEND_REF_ID_MAP: Record<string, string> = {
  aeroport: "a4358d1c-a507-4657-962a-1d03c51acc39",
  akademicheskaya: "a2ec3ef9-755d-4933-a5ab-9da151072cf5",
  alekseyevskaya: "836e8d99-bb1d-422f-9de1-09982cafd0bc",
  altufyevo: "3eeb9bac-8c82-429e-908a-9e839256dde9",
  annino: "4a27314b-1f20-4941-b9a4-f70e8f9f1c88",
  arbatskaya: "f256e56d-c480-4b64-8c19-51d986388ca5",
  aviamotornaya: "e132da71-1fee-4efb-b462-3ba642b3f835",
  avtozavodskaya: "f3d1aeec-60b7-488b-87f9-7231c8c3c2cc",
  babushkinskaya: "94ac4d72-4175-4ddc-a3cc-2f195ecfff5d",
  bagrationovskaya: "e24b6fc5-90ec-41a5-aca2-b3170c91960d",
  barrikadnaya: "7ed9e6e0-75a0-41af-8ca4-0d8cfc977eb3",
  baumanskaya: "36ed02f8-8b67-415d-b2b6-0b3f2bc917f3",
  begovaya: "f0c95008-1bd5-484d-884a-662e94857800",
  belorusskaya_k: "aa5672be-812c-4363-a2bb-e01c8b26537d",
  belyayevo: "1bc1a9c0-5293-4833-b7db-2022c21a1fd7",
  bibirevo: "b28bc39e-5c0f-4762-9115-2415ab90d043",
  biblioteka: "1d768f22-6463-48b1-aa8c-5f2207230a0a",
  borovitskaya: "b2054536-307a-436f-ba41-5910e5979ac6",
  botanichesky: "b84ee9c9-0f25-4eb1-93a6-a76aa3910e41",
  bratislavskaya: "e2421e39-ad9c-4b99-8379-31a7ba84056e",
  bulvar_dd: "0290e324-624c-4c8d-aa42-7ab961317696",
  chekhovskaya: "b03de616-ec9b-489c-8b49-53417813a076",
  cherkizovskaya: "727e12c1-8380-47ca-8430-f8ec166d191d",
  chertanovskaya: "35d84fb4-d598-4002-8262-3936efeb8cff",
  cheryomushki: "4a5d6c28-c904-4d2e-b519-dd9060762b97",
  chistye_prudy: "dd534809-a82f-47e0-a70d-14d32bfb9e23",
  chkalovskaya: "924cba93-4547-4922-a8b2-7676752b9bee",
  dinamo: "16c33082-85b4-4727-a564-37c7f7fd5755",
  dmitrovskaya: "8b11d73d-23d3-4455-9fec-6434b1416430",
  dobryninskaya: "75fc09fc-7a70-4e5f-9e3b-f70995b0bf3f",
  domodedovskaya: "8c800d11-efd1-41b7-9b0c-ca69d0175097",
  dostoyevskaya: "1609dc1d-cf46-43ba-af09-bc20f8304c7b",
  dubrovka: "797c6ed2-81a7-48d5-a88c-4c0e894d26b9",
  elektrozavodskaya: "a3d935ea-8ce6-4299-84c9-1b29ab179ffa",
  fili: "0fbdd817-7cd3-4ae5-b176-4ab293b79c5a",
  filyovsky_park: "73bc9837-afd9-48fd-bb2b-ce1218470d8e",
  frunzenskaya: "0c8d1801-94ee-4376-81cd-d7f9935fe0a6",
  izmaylovskaya: "6a6f3d8e-1593-411d-9646-429592b6bb13",
  kaluzhskaya: "8d4f07eb-b7d3-44c8-ac1c-4ff9ddf68211",
  kantemirovskaya: "758c0c9e-a453-43a8-a525-bb9c9795a8a9",
  kashirskaya: "3230c374-586e-411b-aa8d-96f9d5443494",
  khovrino: "4916fd83-3515-4299-877d-225e1ed5f3e6",
  kievskaya_k: "043328f8-df03-4441-8d4a-30995259ae47",
  kitay_gorod: "d54b09b4-6f06-428a-b5fd-d947df069a2d",
  kolomenskaya: "eadc5bdc-2377-445f-8833-c4c047ef7e9a",
  komsomolskaya_k: "bb0f0a6c-6798-41e6-bba8-6deb345fadaa",
  konkovo: "b693b358-31e7-44ca-b938-67062edcb910",
  kozhukhovskaya: "700125ca-5a0b-4dfd-9ecc-1076fc1ce47f",
  krasnogvardeyskaya: "72e73b28-9dec-4673-bc25-2fd48e24bea7",
  krasnopresnenskaya: "bb922d34-ed2e-4c6b-8df1-673e7c3c861e",
  krasnoselskaya: "afd8d3e1-2ee5-4f48-abc9-42c810ab36ef",
  krasnye_vorota: "57e9f225-4975-4035-aec4-7cc3043a1b52",
  krestyanskaya: "bc849e56-95e1-45de-b621-b9d95fa19f9b",
  kropotkinskaya: "aa3f706b-bb8a-421b-9fcd-48ea25c2e103",
  krylatskoye: "14034a5d-1252-40b5-8679-fe155836adf5",
  kuntsevskaya: "4874a2e3-0b93-4899-b53c-ee6b5fd95641",
  kurskaya_k: "8c7e3041-0f4d-4714-af36-e389f5ddfd88",
  kutuzovskaya: "2da659fb-f9e2-435d-a2bb-54e2e8ba0424",
  kuzminki: "001a0ed0-5e3e-415c-8962-cf6cc32ffde3",
  kuznetsky_most: "19b96143-3f06-4199-8e2f-10389ee44289",
  leninsky_pr: "302d4e35-233f-414a-9190-bca98c745a99",
  lermontovsky: "d90fc695-de8a-4bb4-87aa-750f7974936e",
  lubyanka: "1ba1482e-c81c-4ac9-b718-ced277e46d59",
  lyublino: "8212f36b-8738-4775-80b1-1187688065cc",
  marksistskaya: "8f8cd793-f889-4ee6-bcbf-0e848f79a25a",
  maryina_roshcha: "a7f5b24e-3864-4c2d-a201-d1864f6282ec",
  maryino: "6ec1cff2-ba41-49bb-9550-95775f887e6c",
  mayakovskaya: "339e26fd-47e7-4c7d-a131-8dfc8da4f9bf",
  medvedkovo: "0fcdfd92-f5c3-48a3-8a0d-029bb0de3c59",
  mendeleyevskaya: "ad093c3f-5c4d-49da-a765-e92ea762fc45",
  molodezhnaya: "dedbaa20-af9a-4029-aa1f-b69a871ef0f6",
  myakinino: "eab09292-a25a-4b51-959e-d1f4f7667970",
  nagatinskaya: "c6d3be24-38bc-4e1a-9d8d-d7cf7075710c",
  nagornaya: "506dac8c-4a7c-4123-8daf-d4197b0271e4",
  nakhimovsky: "b0887686-64c2-4edc-bdfb-f941500706df",
  novogireevo: "6f6044bd-41e8-4ebd-92cd-57e94055bf3e",
  novokuznetskaya: "4f06d251-fdc6-4420-b915-a818e0cc9dae",
  novoslobodskaya: "c9dd1399-e98a-43ba-ba14-59a7e920a552",
  novoyasenevskaya: "0fa354c6-ab5d-4dcd-a970-e633afd227fa",
  okhotny_ryad: "44bb6e57-def5-4b90-bee4-acf7e3fbd387",
  oktyabrskaya_k: "b1d5930b-ce14-4de2-a616-333d7ed9e276",
  oktyabrskoye_pole: "a006e480-154c-413d-bd6b-96809e716bdf",
  orekhovo: "1c9088f1-6748-4d56-9885-7c51be953bc8",
  otradnoye: "7643c464-023a-4ec1-ad47-f27ee4af12ed",
  park_kultury_k: "c8d6e282-26a6-4949-80a0-c4bb61a7c03a",
  park_pobedy: "67c5af74-bb4a-4b1b-8792-9336a80a3fdf",
  partizanskaya: "2f977a96-ef2e-4557-8504-cbe7805330ce",
  paveletskaya_k: "3d116718-05d7-47da-a2de-c212f9e16ba9",
  pechatniki: "8f5703e3-9560-4d1a-ad81-5998454a5c8e",
  perovo: "752b8690-fdea-4378-b3fb-49114118536b",
  pervomayskaya: "5da74ff3-57d2-4c70-b91b-f6af0e14b402",
  petrovsko_raz: "f9e8f90a-8303-461e-bf71-9f77a0e7c518",
  pionerskaya: "c46d1aec-1bdc-42b2-8371-f1b29be68ba9",
  planernaya: "fb52cceb-27e7-4e7e-8456-32d28af057f8",
  ploshchad_il: "f3fc9e41-d36f-46e5-b398-59f103da2210",
  ploshchad_rev: "5b682ba3-470b-4053-b094-bb0430bf0cb9",
  polezhayevskaya: "21c5cdac-3f0e-4d39-abc9-cd1ec74bfb44",
  polyanka: "0cb344b8-9f60-4282-afb2-86104d0452cb",
  prazhskaya: "0eb0ed27-7bc6-48c9-af4a-69bfb9eddd97",
  preobrazhenskaya: "56814f60-dbee-4efd-bb3c-2f003a07660b",
  profsoyuznaya: "abfbda26-ad68-46f7-bc60-186fb8333d0a",
  proletarskaya: "9f8cdb9c-f773-44af-8014-fb1dc297773b",
  prospekt_mira_k: "1ebcc93d-c97c-43d0-85e6-657ef052a3e6",
  prospekt_vernad: "48a64e40-5cd0-4976-a33e-81cc0b144f04",
  pushkinskaya: "ca061350-627b-4fd4-b932-b07216d7d1c7",
  rechnoy_vokzal: "f99f6d1e-c02c-4b93-83c1-f59bd8d92c12",
  rimskaya: "6843bd7f-9655-40d7-bd01-9eef59a5cdd8",
  rizhskaya: "6960f047-4692-483e-a287-01ee9b4a5ef2",
  rumyantsevo: "254d6c5f-55b6-4985-8926-a5136d11d821",
  ryazansky: "c023faa9-e0dd-4776-a2e4-a2b15b2078bc",
  salaryevo: "3fa90758-acba-41f9-a90f-059e085dc669",
  savyolovskaya: "70fd344d-b523-4185-840c-93c6194f9570",
  semyonovskaya: "9a979cd0-9584-4294-93a6-85fecd534fb9",
  serpukhovskaya: "5d37a612-6b0d-4af4-83ce-8ca2abab0445",
  sevastopolskaya: "e5b3ddfc-c8a1-4c6f-b284-7e4eae1503a7",
  shabolovskaya: "e83d41b7-43ef-49df-9a39-8bc4da67f044",
  shchukinskaya: "951422f4-1101-4077-86a2-25fd06080ae2",
  shchyolkovskaya: "ecef1541-7cf8-4451-a401-dfb549cd02a9",
  shosse_ent: "8c4516db-b591-4477-a77b-4a77dc06b8fc",
  skhodnenskaya: "2d6959df-4ad4-4e9f-b607-6f18d9b9764e",
  slavyansky_b: "bd23ef75-74f7-43f6-9ad5-0de09b5de39c",
  smolenskaya: "11335e83-d9e4-4bdb-8dfa-b175c0eec4bf",
  sokol: "216a0a58-ba0c-405b-9f21-a1db72c1602c",
  sokolniki: "f9845f70-5181-4ac7-934d-4f2e21255000",
  sportivnaya: "dd3119a6-b64c-4927-ba2a-76b921d9e7c7",
  sretensky_b: "dadffecd-8cf8-400d-ba50-0b5c1838fe7f",
  strogino: "1780e1fb-9f85-4806-9e49-86feedde4f1c",
  studencheskaya: "d99a8fb7-0882-46f2-b5b2-23a5a40dee24",
  sukharevskaya: "e98a1d74-1370-473f-a64e-f4ac3a8c289e",
  sviblovo: "fe1eaa9e-fef3-4207-960c-3e628bc5e5ed",
  taganskaya_k: "a093ca63-345d-4fb9-851b-0637cb24341d",
  teatralnaya: "33f9db4a-34df-4e08-b39c-090ec6eb776b",
  tekstilshchiki: "4a691c2e-dc88-4e8a-8ade-9389f04f8ba0",
  timiryazevskaya: "3682c72b-3eca-4809-833e-fc462bf9e25d",
  tretyakovskaya: "7d01b2b8-5c63-4152-93d8-f67f23e4bee9",
  troparyovo: "c256440c-24bc-4198-a279-dc94cb2552f6",
  trubnaya: "1d67cc44-d2c6-436c-b00e-dcf80f55eea2",
  tsaritsyno: "5118f294-047d-4bb0-93ad-e0024766109d",
  tsvetnoy: "c970483a-03be-43ac-90b7-2b5dcbf6a922",
  tulskaya: "61cbd8e7-32f7-4c98-b555-27fbc564953d",
  turgenevskaya: "4d527b84-70d6-46e5-96db-1a8f5e738fcb",
  tushinskaya: "bc87df88-16ca-47ff-9698-e1c65f705faa",
  tverskaya: "e6eb1a46-c752-4f8e-827b-a4e0bd8db077",
  tyoply_stan: "a6dbb387-0f52-4ff1-909b-fe982a3ed6d2",
  ulitsa_1905: "cb5cdcac-e881-453c-b219-b683e8615150",
  ulitsa_pod: "214a76ec-e686-49ad-ba0e-03418a864ea7",
  universitet: "f60ccbce-5b4b-4e8a-a7c3-6f4175aaa2ed",
  vdnkh: "358a7770-17c2-44d3-a5dd-60bbbc893eeb",
  vladykino: "68fccb43-a533-4d10-8231-a202689301fc",
  vodny_stadion: "22b7c621-756c-440a-a343-1631d227f5b6",
  volgogradsky: "7c0fc501-03a0-4bad-8f53-d5eb6cb5fd55",
  volokolamskaya: "f9517146-15c2-48ee-80ed-22c010168962",
  volzhskaya: "0f2f49a7-e9be-4537-9fd3-a335e6fb3f2c",
  vorobyovy_gory: "7dab5b27-df26-477c-becf-0e776fdadcdc",
  voykovskaya: "56c5dbed-220c-476e-b909-03cd09706592",
  vykhino: "2125f0f1-967c-4560-b4eb-56b715882a62",
  yasenevo: "2a0e8529-7827-4f93-aecb-b300ded3fee8",
  yugo_zapadnaya: "e40d6b9e-1468-42ee-a72c-674c19318eaf",
  yuzhnaya: "5602874b-3d1e-4539-88d7-84f33eb2cfa2",
}

function rid(id: string): string {
  return BACKEND_REF_ID_MAP[id] ?? STATION_BACKEND_REF_ID_MAP[id] ?? id
}

const rawMetroSeries = {
  edges: [
    // --- Family --------------------------------------------------------
    { "edge_type": "STEPSON_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-25", "source": "Artyom", "target": "Sukhoi", "weight": 1 },
    { "edge_type": "MARRIED_TO", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-26", "source": "Artyom", "target": "Anna", "weight": 1 },
    { "edge_type": "DAUGHTER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-27", "source": "Anna", "target": "Miller", "weight": 1 },
    { "edge_type": "FATHER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-28", "source": "Khlebnikov", "target": "Kirill", "weight": 1 },

    // --- Mentorship / Spartan Order ------------------------------------
    { "edge_type": "MENTOR_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-29", "source": "Khan", "target": "Artyom", "weight": 1 },
    { "edge_type": "LEADER_OF", "properties": { "date_added_to_graph": "1778230600.0", "rank": "Colonel" }, "ref_id": "m-e-30", "source": "Miller", "target": "SpartanOrder", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-31", "source": "Artyom", "target": "SpartanOrder", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-32", "source": "Anna", "target": "SpartanOrder", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-33", "source": "Hunter", "target": "SpartanOrder", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-34", "source": "Ulman", "target": "SpartanOrder", "weight": 1 },
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-35", "source": "SpartanOrder", "target": "D6", "weight": 1 },

    // --- Aurora crew ---------------------------------------------------
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-36", "source": "Artyom", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-37", "source": "Anna", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-38", "source": "Miller", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "Tatar mechanic" }, "ref_id": "m-e-39", "source": "Damir", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "engineer" }, "ref_id": "m-e-40", "source": "Tokarev", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "comms / musician" }, "ref_id": "m-e-41", "source": "Stepan", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "veteran mechanic" }, "ref_id": "m-e-42", "source": "Krest", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-43", "source": "Idiot", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "US Marine radio operator" }, "ref_id": "m-e-104", "source": "Sam", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "OPERATES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-44", "source": "AuroraCrew", "target": "Aurora", "weight": 1 },

    // --- Aurora journey (Exodus locations) -----------------------------
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "1" }, "ref_id": "m-e-45", "source": "Aurora", "target": "Volga", "weight": 1 },
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "2" }, "ref_id": "m-e-46", "source": "Aurora", "target": "Caspian", "weight": 1 },
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "3" }, "ref_id": "m-e-47", "source": "Aurora", "target": "Taiga", "weight": 1 },
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "4" }, "ref_id": "m-e-48", "source": "Aurora", "target": "DeadCity", "weight": 1 },
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "interlude" }, "ref_id": "m-e-105", "source": "Aurora", "target": "Yamantau", "weight": 1 },
    { "edge_type": "TRAVELS_TO", "properties": { "date_added_to_graph": "1778230600.0", "chapter": "destination" }, "ref_id": "m-e-106", "source": "Aurora", "target": "Baikal", "weight": 1 },

    // --- Factions ------------------------------------------------------
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "communist commander" }, "ref_id": "m-e-49", "source": "Pavel", "target": "RedLine", "weight": 1 },
    { "edge_type": "ANTAGONIST_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-50", "source": "Pavel", "target": "Artyom", "weight": 1 },
    { "edge_type": "ANTAGONIST_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-51", "source": "Lesnitsky", "target": "Khlebnikov", "weight": 1 },
    { "edge_type": "OPPOSED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-52", "source": "RedLine", "target": "FourthReich", "weight": 1 },
    // Polis (the org) is now based at Biblioteka Lenina — the central
    // archive in 2087 lore. Replaces the old PolisStation reference.
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-53", "source": "Polis", "target": "biblioteka", "weight": 1 },

    // --- Cults / surface tribes ----------------------------------------
    { "edge_type": "INHABITS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-54", "source": "GreatWormCult", "target": "Volga", "weight": 1 },
    { "edge_type": "INHABITS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-55", "source": "TaigaWatchmen", "target": "Taiga", "weight": 1 },
    { "edge_type": "INHABITS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-56", "source": "ChildrenOfForest", "target": "Taiga", "weight": 1 },
    { "edge_type": "INHABITS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-57", "source": "CaspianPirates", "target": "Caspian", "weight": 1 },

    // --- Companions -----------------------------------------------------
    { "edge_type": "COMPANION_OF", "properties": { "date_added_to_graph": "1778230600.0", "game": "Metro 2033" }, "ref_id": "m-e-58", "source": "Bourbon", "target": "Artyom", "weight": 1 },
    // Lore station refs rewired onto 2087 ids: VDNKh→vdnkh, PolisStation→
    // biblioteka, ParkPobedy→park_pobedy. The graph relies on these as
    // both endpoints existing — without the rename they'd dangle.
    { "edge_type": "HOME_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-59", "source": "vdnkh", "target": "Artyom", "weight": 1 },
    { "edge_type": "PART_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-60", "source": "vdnkh", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "PART_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-61", "source": "biblioteka", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "PART_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-62", "source": "park_pobedy", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "PART_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-63", "source": "D6", "target": "MoscowMetro", "weight": 1 },

    // --- Mutants by habitat --------------------------------------------
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-64", "source": "Nosalis", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-65", "source": "Lurker", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-66", "source": "Watcher", "target": "DeadCity", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-67", "source": "Demon", "target": "DeadCity", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0", "place": "Great Library" }, "ref_id": "m-e-68", "source": "Librarian", "target": "biblioteka", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-69", "source": "Shrimp", "target": "Volga", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-70", "source": "Humanimal", "target": "Caspian", "weight": 1 },
    { "edge_type": "FOUND_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-71", "source": "MutantBear", "target": "Taiga", "weight": 1 },
    { "edge_type": "INHABITS", "properties": { "date_added_to_graph": "1778230600.0", "alias": "Black Ones" }, "ref_id": "m-e-72", "source": "DarkOnes", "target": "park_pobedy", "weight": 1 },

    // --- Weapons -------------------------------------------------------
    { "edge_type": "WIELDED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-73", "source": "Bastard", "target": "Artyom", "weight": 1 },
    { "edge_type": "WIELDED_BY", "properties": { "date_added_to_graph": "1778230600.0", "type": "pneumatic sniper" }, "ref_id": "m-e-74", "source": "Tikhar", "target": "Anna", "weight": 1 },
    { "edge_type": "WIELDED_BY", "properties": { "date_added_to_graph": "1778230600.0", "type": "pneumatic crossbow" }, "ref_id": "m-e-75", "source": "Helsing", "target": "Artyom", "weight": 1 },
    { "edge_type": "WIELDED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-76", "source": "Ashot", "target": "Artyom", "weight": 1 },
    { "edge_type": "WIELDED_BY", "properties": { "date_added_to_graph": "1778230600.0", "type": "electric rifle" }, "ref_id": "m-e-77", "source": "VoltDriver", "target": "Artyom", "weight": 1 },

    // --- Items / survival gear -----------------------------------------
    { "edge_type": "REQUIRED_ON", "properties": { "date_added_to_graph": "1778230600.0", "purpose": "filtered air" }, "ref_id": "m-e-78", "source": "GasMask", "target": "Surface", "weight": 1 },
    { "edge_type": "USED_WITH", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-79", "source": "Filter", "target": "GasMask", "weight": 1 },

    // --- Polis alliance & Hansa ring -----------------------------------
    // Polis is an alliance of central red-line stations — Biblioteka is
    // already linked above; Borovitskaya and Arbatskaya are the other
    // member stations.
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-83", "source": "Polis", "target": "borovitskaya", "weight": 1 },
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-84", "source": "Polis", "target": "arbatskaya", "weight": 1 },
    // Hansa = Commonwealth of the Ring Line — controls the brown ring.
    // Three representative stations rather than all 12 to keep the graph
    // readable; any ring station's faction:"union" already reads as Hansa.
    { "edge_type": "CONTROLS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-85", "source": "Hansa", "target": "dobryninskaya", "weight": 1 },
    { "edge_type": "CONTROLS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-86", "source": "Hansa", "target": "paveletskaya_k", "weight": 1 },
    { "edge_type": "CONTROLS", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-87", "source": "Hansa", "target": "oktyabrskaya_k", "weight": 1 },
    // Hunter is brigadier of Sevastopolskaya in Metro 2034.
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0", "year": "2034", "rank": "Brigadier" }, "ref_id": "m-e-88", "source": "Hunter", "target": "sevastopolskaya", "weight": 1 },
    // Khlebnikov (and the Two Colonels arc) is anchored at Novosibirsk.
    { "edge_type": "BASED_AT", "properties": { "date_added_to_graph": "1778230600.0", "year": "2036", "rank": "Colonel" }, "ref_id": "m-e-107", "source": "Khlebnikov", "target": "Novosibirsk", "weight": 1 },

    // --- Survival-gear network — bridge the items cluster into the main
    // graph through Stalkers (Khan / Hunter / Bourbon), Artyom's own kit,
    // pneumatic chargers used by Tikhar/Helsing/Volt Driver, MGR currency
    // (Hansa's trade), and crafting on the Aurora. Without these edges
    // GasMask + Filter sit as a 2-node island far from everything else.
    { "edge_type": "USES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-89", "source": "Artyom", "target": "GasMask", "weight": 1 },
    { "edge_type": "USES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-90", "source": "Artyom", "target": "Filter", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "mystic" }, "ref_id": "m-e-91", "source": "Khan", "target": "Stalkers", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "veteran" }, "ref_id": "m-e-92", "source": "Hunter", "target": "Stalkers", "weight": 1 },
    { "edge_type": "MEMBER_OF", "properties": { "date_added_to_graph": "1778230600.0", "role": "mercenary" }, "ref_id": "m-e-93", "source": "Bourbon", "target": "Stalkers", "weight": 1 },
    { "edge_type": "REQUIRES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-94", "source": "Stalkers", "target": "GasMask", "weight": 1 },
    { "edge_type": "REQUIRES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-95", "source": "Stalkers", "target": "Filter", "weight": 1 },
    { "edge_type": "USED_WITH", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-96", "source": "Charger", "target": "Helsing", "weight": 1 },
    { "edge_type": "USED_WITH", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-97", "source": "Charger", "target": "Tikhar", "weight": 1 },
    { "edge_type": "USED_WITH", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-98", "source": "Charger", "target": "VoltDriver", "weight": 1 },
    { "edge_type": "TRADES_IN", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-99", "source": "Hansa", "target": "MGR", "weight": 1 },
    { "edge_type": "CURRENCY_OF", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-100", "source": "MGR", "target": "MoscowMetro", "weight": 1 },
    { "edge_type": "CARRIES", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-101", "source": "AuroraCrew", "target": "Medkit", "weight": 1 },
    { "edge_type": "INSTALLED_AT", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-102", "source": "Workbench", "target": "Aurora", "weight": 1 },
    { "edge_type": "OPERATES", "properties": { "date_added_to_graph": "1778230600.0", "role": "engineer" }, "ref_id": "m-e-103", "source": "Tokarev", "target": "Workbench", "weight": 1 },

    // --- Transport (vehicles in-universe) ------------------------------
    // Handcars are the stalkers' workhorse in the Moscow tunnels.
    { "edge_type": "OPERATED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-108", "source": "Handcar", "target": "Stalkers", "weight": 1 },
    { "edge_type": "OPERATES_IN", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-109", "source": "Handcar", "target": "MoscowMetro", "weight": 1 },
    // Hansa runs trade convoys around the brown ring.
    { "edge_type": "OPERATED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-110", "source": "HansaTrain", "target": "Hansa", "weight": 1 },
    { "edge_type": "OPERATES_IN", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-111", "source": "HansaTrain", "target": "MoscowMetro", "weight": 1 },
    // The Aurora crew commandeers a sailboat in the Caspian chapter.
    { "edge_type": "OPERATED_BY", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-112", "source": "CaspianBoat", "target": "AuroraCrew", "weight": 1 },
    { "edge_type": "OPERATES_IN", "properties": { "date_added_to_graph": "1778230600.0" }, "ref_id": "m-e-113", "source": "CaspianBoat", "target": "Caspian", "weight": 1 },

    // --- Schematic Moscow Metro 2087 — generated from metro2087/data ---
    ...tunnels,
  ],
  nodes: [
    // --- Persons --------------------------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Artyom", "title": "Ranger", "home": "VDNKh", "description": "Raised at VDNKh by his stepfather Sukhoi, Artyom answered Hunter's call in 2033 and journeyed across the metro to call down a missile strike on the Dark Ones — only to discover in Last Light that they were trying to talk to him, not destroy. By Exodus he commands the Aurora's expedition east." }, "ref_id": "Artyom" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Anna", "role": "Sniper", "description": "Miller's daughter and the Order's deadliest sharpshooter. Marries Artyom on the Aurora and bears the cost of his radiation poisoning through Exodus." }, "ref_id": "Anna" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Colonel Miller", "rank": "Colonel", "description": "Commander of the Spartan Order and master of the Aurora. Hard-line and pragmatic — believes only the surviving metro is worth fighting for, until Anna and Artyom prove him wrong on the Volga." }, "ref_id": "Miller" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Khan", "occupation": "Mystic stalker", "description": "Buddhist-aligned wanderer who walks tunnels closed to other men. Artyom's first guide in 2033; reappears in Last Light to push him toward the Dark Ones' truth." }, "ref_id": "Khan" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Hunter", "title": "Ranger", "description": "The Spartan who set Artyom on the road in 2033 with the words \"If it's hostile, you kill it\" — and was killed by the Dark Ones at VDNKh. Reborn as the Brigadier of Sevastopolskaya in Metro 2034." }, "ref_id": "Hunter" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Pavel Morozov", "faction": "Red Line", "description": "Charismatic Red Line officer who befriends and betrays Artyom in Last Light. The series' best-written villain — half mentor, half executioner." }, "ref_id": "Pavel" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Bourbon", "occupation": "Mercenary", "description": "Foul-mouthed stalker who takes Artyom south of VDNKh in 2033, trading curses for vodka. Killed by Watchmen before they reach Polis." }, "ref_id": "Bourbon" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Ulman", "title": "Ranger" }, "ref_id": "Ulman" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Alex Sukhoi", "relation": "Artyom's stepfather" }, "ref_id": "Sukhoi" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Damir", "origin": "Tatar" }, "ref_id": "Damir" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Tokarev" }, "ref_id": "Tokarev" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Stepan" }, "ref_id": "Stepan" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Krest", "background": "veteran" }, "ref_id": "Krest" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Idiot", "real_name": "Yermak" }, "ref_id": "Idiot" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Sam", "background": "US Marine" }, "ref_id": "Sam" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Khlebnikov", "rank": "Colonel" }, "ref_id": "Khlebnikov" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Kirill" }, "ref_id": "Kirill" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Person", "properties": { "name": "Lesnitsky" }, "ref_id": "Lesnitsky" },

    // --- Factions / Organizations ---------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Order of the Spartans", "alias": "Rangers", "description": "Elite paramilitary order garrisoning D6 — the pre-war bunker beneath the metro. Equal parts soldiers, scholars, and stalkers. Take their oath from Polis but answer to Miller." }, "ref_id": "SpartanOrder" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Red Line", "ideology": "Communist", "description": "Successor state to the Soviet Union claiming the red Sokolnicheskaya line. Ruled from a chain of NKVD-style purges; uses biological warfare and propaganda as readily as bullets." }, "ref_id": "RedLine" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Fourth Reich", "ideology": "Neo-Nazi", "description": "Neo-Nazi enclave squatting at Tverskaya / Pushkinskaya / Chekhovskaya. Reviled by every other faction — even Hansa won't trade with them." }, "ref_id": "FourthReich" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Hansa", "alias": "Commonwealth of the Ring Line", "description": "Pragmatic trade federation controlling the entire brown Koltsevaya ring. Owns the metro's economy — MGR cartridges are accepted everywhere because Hansa says so." }, "ref_id": "Hansa" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Polis", "ideology": "Neutral", "description": "Alliance of four central stations under the State Library. Home to the Brahmins (keepers of knowledge) and the Order of the Spartans. The closest the metro has to a civilization." }, "ref_id": "Polis" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Aurora Crew", "description": "Spartan expedition aboard the Aurora — Miller, Artyom, Anna, Damir, Tokarev, Stepan, Krest, Idiot, and Sam. The first humans in two decades to learn the metro is not the only home left in Russia." }, "ref_id": "AuroraCrew" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Cult of the Great Worm" }, "ref_id": "GreatWormCult" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Watchmen of the Taiga", "alias": "Pioneers" }, "ref_id": "TaigaWatchmen" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Children of the Forest" }, "ref_id": "ChildrenOfForest" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Caspian Slavers" }, "ref_id": "CaspianPirates" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Organization", "properties": { "name": "Stalkers", "alias": "surface scouts", "ideology": "Independent" }, "ref_id": "Stalkers" },

    // --- Locations (non-station) ----------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Moscow Metro", "context": "post-nuclear shelter network" }, "ref_id": "MoscowMetro" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "D6", "type": "Pre-war military bunker" }, "ref_id": "D6" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Volga River", "season": "winter" }, "ref_id": "Volga" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Caspian Sea", "season": "summer", "biome": "desert" }, "ref_id": "Caspian" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Taiga", "season": "autumn", "biome": "forest" }, "ref_id": "Taiga" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Yamantau", "type": "Pre-war bunker" }, "ref_id": "Yamantau" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Lake Baikal", "destination": "true" }, "ref_id": "Baikal" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Novosibirsk", "irradiation": "extreme" }, "ref_id": "Novosibirsk" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Dead City", "context": "Moscow surface" }, "ref_id": "DeadCity" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Location", "properties": { "name": "Surface", "context": "Irradiated outdoors" }, "ref_id": "Surface" },

    // --- Transport (vehicles) -------------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Transport", "properties": { "name": "Aurora", "type": "Steam locomotive", "role": "Spartan expedition train", "description": "Armored steam locomotive commandeered by the Spartans for the eastward journey of Exodus. Carries the entire Aurora Crew between Moscow, the Volga, the Caspian, the Taiga, and finally the shores of Baikal." }, "ref_id": "Aurora" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Transport", "properties": { "name": "Handcar", "type": "Hand-pumped railcar", "role": "Stalker tunnel transit" }, "ref_id": "Handcar" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Transport", "properties": { "name": "Hansa Caravan", "type": "Trade train", "role": "Ring-line trade convoys" }, "ref_id": "HansaTrain" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Transport", "properties": { "name": "Caspian Sailboat", "type": "Sail-powered boat", "role": "Coastal travel" }, "ref_id": "CaspianBoat" },

    // --- Schematic Moscow Metro 2087 stations (generated) -------------
    ...stationNodes,

    // --- Creatures (mutants) -------------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Nosalis", "type": "rat-like mutant" }, "ref_id": "Nosalis" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Lurker", "type": "tunnel scavenger" }, "ref_id": "Lurker" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Watcher", "type": "canine mutant" }, "ref_id": "Watcher" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Demon", "type": "winged predator" }, "ref_id": "Demon" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Librarian", "type": "ape-like mutant", "description": "Towering simian mutants that haunt the Great Library above Biblioteka Lenina. Intelligent enough to issue territorial threat displays — and lethal if you break eye contact. The Spartans' worst stalking ground.", "images": ["/images/librarian.jpg", "/images/librarian1.webp", "/images/librarian2.webp"] }, "ref_id": "Librarian" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Dark Ones", "alias": "Black Ones", "trait": "telepathic", "description": "Next-generation psychic mutants born from the irradiated surface. Hunted and exterminated in 2033 as the metro's nightmare — revealed in Last Light to have been trying to reach humanity, not destroy it." }, "ref_id": "DarkOnes" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Shrimp", "type": "aquatic mutant" }, "ref_id": "Shrimp" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Humanimal", "type": "feral child mutant" }, "ref_id": "Humanimal" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Watchman", "type": "intelligent canine pack" }, "ref_id": "Watchman" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Creature", "properties": { "name": "Mutant Bear" }, "ref_id": "MutantBear" },

    // --- Weapons --------------------------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Weapon", "properties": { "name": "Bastard Gun", "type": "improvised SMG" }, "ref_id": "Bastard" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Weapon", "properties": { "name": "Tikhar", "type": "pneumatic rifle" }, "ref_id": "Tikhar" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Weapon", "properties": { "name": "Helsing", "type": "pneumatic crossbow" }, "ref_id": "Helsing" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Weapon", "properties": { "name": "Ashot", "type": "sawn-off shotgun pistol" }, "ref_id": "Ashot" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Weapon", "properties": { "name": "Volt Driver", "type": "improvised electric weapon" }, "ref_id": "VoltDriver" },

    // --- Items / survival gear -----------------------------------------
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Gas Mask", "purpose": "Surface survival" }, "ref_id": "GasMask" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Filter", "duration_minutes": "5", "purpose": "Air filtration cartridge" }, "ref_id": "Filter" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Pneumatic Charger", "purpose": "Pressurises air-powered weapons" }, "ref_id": "Charger" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Military-Grade Round", "alias": "MGR", "purpose": "Pre-war currency in the Metro" }, "ref_id": "MGR" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Medkit", "purpose": "Field first aid" }, "ref_id": "Medkit" },
    { "date_added_to_graph": 1778230600.0, "node_type": "Item", "properties": { "name": "Workbench", "purpose": "Crafting and weapon upgrades" }, "ref_id": "Workbench" },
  ],
}

// Apply BACKEND_REF_ID_MAP to the raw fixture so consumers see backend UUIDs
// for any node the seeded graph has. Stations and any unmapped entries fall
// through unchanged (resolved by rid() identity).
export const metroSeries = {
  nodes: rawMetroSeries.nodes.map((n) => ({ ...n, ref_id: rid(n.ref_id) })),
  edges: rawMetroSeries.edges.map((e) => ({
    ...e,
    source: rid(e.source),
    target: rid(e.target),
  })),
}
