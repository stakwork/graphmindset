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

export const metroSeries = {
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
