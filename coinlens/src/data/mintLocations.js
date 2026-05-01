// Ancient & medieval mint cities → coordinates.
// Coordinates are the historical city's site (modern lat/lng of the ruin or
// modern successor). Aliases handle Latin/Greek/Anglicized variants that
// appear in Harvard's titles.
//
// `kind` distinguishes a real point-mint ("city") from a broader regional
// attribution ("region") — when a coin's title only names a region we still
// plot it but the locator marks it less precise.

// `tier` controls when a city's label shows on the map.
//   1 — capitals / huge mints, visible even at world zoom
//   2 — major regional mints, visible at Mediterranean zoom
//   3 — minor mints, only visible when zoomed in close
// Defaults to 3 if unspecified.
export const MINTS = [
  // ─── Italy ────────────────────────────────────────────
  { name: 'Rome', aliases: ['Roma'], lat: 41.9028, lng: 12.4964, kind: 'city' },
  { name: 'Ostia', lat: 41.7558, lng: 12.2917, kind: 'city' },
  { name: 'Aquileia', lat: 45.7700, lng: 13.3700, kind: 'city' },
  { name: 'Mediolanum', aliases: ['Milan', 'Milano'], lat: 45.4642, lng: 9.1900, kind: 'city' },
  { name: 'Ticinum', aliases: ['Pavia'], lat: 45.1847, lng: 9.1582, kind: 'city' },
  { name: 'Ravenna', lat: 44.4173, lng: 12.1965, kind: 'city' },
  { name: 'Tarentum', aliases: ['Taras', 'Taranto'], lat: 40.4668, lng: 17.2400, kind: 'city' },
  { name: 'Metapontion', aliases: ['Metapontum'], lat: 40.3833, lng: 16.8167, kind: 'city' },
  { name: 'Neapolis', aliases: ['Naples', 'Napoli'], lat: 40.8518, lng: 14.2681, kind: 'city' },
  { name: 'Velia', aliases: ['Elea'], lat: 40.1622, lng: 15.1531, kind: 'city' },
  { name: 'Thurium', aliases: ['Thurii', 'Thourioi'], lat: 39.7300, lng: 16.5200, kind: 'city' },
  { name: 'Croton', aliases: ['Kroton', 'Crotone'], lat: 39.0808, lng: 17.1278, kind: 'city' },
  { name: 'Heraclea', aliases: ['Herakleia', 'Heracleia'], lat: 40.2167, lng: 16.6700, kind: 'city' },
  { name: 'Sybaris', lat: 39.7167, lng: 16.5000, kind: 'city' },
  { name: 'Lucania', lat: 40.4400, lng: 15.8000, kind: 'region' },
  { name: 'Calabria', lat: 39.3000, lng: 16.3500, kind: 'region' },
  { name: 'Apulia', aliases: ['Puglia'], lat: 41.1300, lng: 16.6700, kind: 'region' },
  { name: 'Campania', lat: 40.8400, lng: 14.2500, kind: 'region' },
  { name: 'Etruria', lat: 43.0000, lng: 11.6000, kind: 'region' },

  // ─── Sicily ───────────────────────────────────────────
  { name: 'Syracuse', aliases: ['Syrakousai', 'Siracusa'], lat: 37.0755, lng: 15.2866, kind: 'city' },
  { name: 'Akragas', aliases: ['Agrigentum', 'Agrigento'], lat: 37.3110, lng: 13.5760, kind: 'city' },
  { name: 'Selinous', aliases: ['Selinunte', 'Selinus'], lat: 37.5833, lng: 12.8250, kind: 'city' },
  { name: 'Segesta', lat: 37.9417, lng: 12.8367, kind: 'city' },
  { name: 'Gela', lat: 37.0739, lng: 14.2422, kind: 'city' },
  { name: 'Messana', aliases: ['Messina', 'Zankle'], lat: 38.1938, lng: 15.5540, kind: 'city' },
  { name: 'Catana', aliases: ['Catania', 'Katane'], lat: 37.5079, lng: 15.0830, kind: 'city' },
  { name: 'Himera', lat: 37.9722, lng: 13.8244, kind: 'city' },
  { name: 'Kamarina', aliases: ['Camarina'], lat: 36.8770, lng: 14.4500, kind: 'city' },
  { name: 'Naxos', aliases: ['Naxos (Sicily)'], lat: 37.8200, lng: 15.2800, kind: 'city' },
  { name: 'Panormos', aliases: ['Palermo', 'Panormus'], lat: 38.1157, lng: 13.3615, kind: 'city' },
  { name: 'Sicily', aliases: ['Sicilia'], lat: 37.6000, lng: 14.0000, kind: 'region' },
  { name: 'Sardinia', aliases: ['Sardegna'], lat: 40.0000, lng: 9.0000, kind: 'region' },

  // ─── Greek mainland ────────────────────────────────────
  { name: 'Athens', aliases: ['Athenai', 'Atene'], lat: 37.9838, lng: 23.7275, kind: 'city' },
  { name: 'Corinth', aliases: ['Korinthos'], lat: 37.9061, lng: 22.8783, kind: 'city' },
  { name: 'Sparta', aliases: ['Lakedaimon'], lat: 37.0810, lng: 22.4296, kind: 'city' },
  { name: 'Thebes', aliases: ['Thebai'], lat: 38.3250, lng: 23.3194, kind: 'city' },
  { name: 'Aegina', aliases: ['Aigina'], lat: 37.7456, lng: 23.4267, kind: 'city' },
  { name: 'Elis', lat: 37.8889, lng: 21.3667, kind: 'city' },
  { name: 'Megalopolis', lat: 37.4011, lng: 22.1422, kind: 'city' },
  { name: 'Patrai', aliases: ['Patras'], lat: 38.2466, lng: 21.7346, kind: 'city' },
  { name: 'Aegira', lat: 38.1170, lng: 22.3800, kind: 'city' },
  { name: 'Argos', lat: 37.6300, lng: 22.7300, kind: 'city' },
  { name: 'Pharsalos', aliases: ['Pharsalus'], lat: 39.3000, lng: 22.3833, kind: 'city' },
  { name: 'Larissa', lat: 39.6390, lng: 22.4191, kind: 'city' },
  { name: 'Thessaly', aliases: ['Thessalia'], lat: 39.6000, lng: 22.4200, kind: 'region' },
  { name: 'Boeotia', aliases: ['Boiotia'], lat: 38.3700, lng: 23.0900, kind: 'region' },
  { name: 'Arcadia', aliases: ['Arkadia'], lat: 37.5667, lng: 22.3333, kind: 'region' },
  { name: 'Epirus', aliases: ['Epeiros'], lat: 39.6650, lng: 20.8500, kind: 'region' },

  // ─── Macedon / N. Greece ──────────────────────────────
  { name: 'Pella', lat: 40.7575, lng: 22.5247, kind: 'city' },
  { name: 'Amphipolis', lat: 40.8200, lng: 23.8400, kind: 'city' },
  { name: 'Olynthos', aliases: ['Olynthus'], lat: 40.2922, lng: 23.3578, kind: 'city' },
  { name: 'Thessalonike', aliases: ['Thessaloniki', 'Thessalonica', 'Thessalonika', 'Salonika'], lat: 40.6401, lng: 22.9444, kind: 'city' },
  { name: 'Macedon', aliases: ['Macedonia', 'Makedonia'], lat: 40.7000, lng: 22.5000, kind: 'region' },
  { name: 'Thrace', aliases: ['Thrake', 'Thracia'], lat: 41.6700, lng: 26.5800, kind: 'region' },
  { name: 'Abdera', lat: 40.9444, lng: 24.9778, kind: 'city' },
  { name: 'Maroneia', lat: 40.8800, lng: 25.5000, kind: 'city' },
  { name: 'Apollonia', aliases: ['Apollonia Pontica'], lat: 42.4167, lng: 27.6964, kind: 'city' },
  { name: 'Mesembria', lat: 42.6585, lng: 27.7300, kind: 'city' },
  { name: 'Pautalia', lat: 42.2820, lng: 22.6910, kind: 'city' },
  { name: 'Philippi', lat: 41.0136, lng: 24.2864, kind: 'city' },

  // ─── Aegean islands ────────────────────────────────────
  { name: 'Lindos', lat: 36.0917, lng: 28.0883, kind: 'city' },
  { name: 'Kamiros', aliases: ['Camirus'], lat: 36.3375, lng: 27.9269, kind: 'city' },
  { name: 'Rhodes', aliases: ['Rhodos'], lat: 36.4341, lng: 28.2176, kind: 'city' },
  { name: 'Chios', lat: 38.3680, lng: 26.1359, kind: 'city' },
  { name: 'Samos', lat: 37.7540, lng: 26.9770, kind: 'city' },
  { name: 'Lesbos', aliases: ['Mytilene'], lat: 39.1100, lng: 26.5550, kind: 'city' },
  { name: 'Crete', aliases: ['Kreta', 'Creta'], lat: 35.2401, lng: 24.8093, kind: 'region' },
  { name: 'Cyclades', aliases: ['Kyklades'], lat: 37.0000, lng: 25.1500, kind: 'region' },
  { name: 'Cyprus', aliases: ['Kypros'], lat: 35.1264, lng: 33.4299, kind: 'region' },
  { name: 'Salamis', lat: 35.1833, lng: 33.9000, kind: 'city' },
  { name: 'Kition', aliases: ['Citium'], lat: 34.9189, lng: 33.6303, kind: 'city' },

  // ─── Asia Minor ────────────────────────────────────────
  { name: 'Cyzicus', aliases: ['Kyzikos'], lat: 40.3850, lng: 27.8853, kind: 'city' },
  { name: 'Lampsakos', aliases: ['Lampsacus'], lat: 40.3450, lng: 26.6869, kind: 'city' },
  { name: 'Sardis', aliases: ['Sardes'], lat: 38.4880, lng: 28.0400, kind: 'city' },
  { name: 'Miletos', aliases: ['Miletus'], lat: 37.5306, lng: 27.2778, kind: 'city' },
  { name: 'Ephesos', aliases: ['Ephesus'], lat: 37.9395, lng: 27.3417, kind: 'city' },
  { name: 'Magnesia', aliases: ['Magnesia ad Meandron', 'Magnesia ad Sipylum'], lat: 37.8650, lng: 27.5275, kind: 'city' },
  { name: 'Pergamon', aliases: ['Pergamum', 'Pergamos'], lat: 39.1320, lng: 27.1860, kind: 'city' },
  { name: 'Smyrna', aliases: ['Izmir'], lat: 38.4192, lng: 27.1287, kind: 'city' },
  { name: 'Phokaia', aliases: ['Phocaea'], lat: 38.6700, lng: 26.7530, kind: 'city' },
  { name: 'Kolophon', aliases: ['Colophon'], lat: 38.1058, lng: 27.1550, kind: 'city' },
  { name: 'Halicarnassus', aliases: ['Halikarnassos', 'Bodrum'], lat: 37.0379, lng: 27.4241, kind: 'city' },
  { name: 'Knidos', aliases: ['Cnidus'], lat: 36.6840, lng: 27.3750, kind: 'city' },
  { name: 'Side', lat: 36.7674, lng: 31.3886, kind: 'city' },
  { name: 'Perge', lat: 36.9606, lng: 30.8542, kind: 'city' },
  { name: 'Aspendos', lat: 36.9389, lng: 31.1722, kind: 'city' },
  { name: 'Tarsos', aliases: ['Tarsus'], lat: 36.9180, lng: 34.8949, kind: 'city' },
  { name: 'Nicomedia', aliases: ['Nikomedeia', 'Nicomedeia'], lat: 40.7654, lng: 29.9408, kind: 'city' },
  { name: 'Nicaea', aliases: ['Nikaia'], lat: 40.4297, lng: 29.7197, kind: 'city' },
  { name: 'Cyzicus', aliases: ['Kyzikos'], lat: 40.3850, lng: 27.8853, kind: 'city' },
  { name: 'Heraclea Pontica', aliases: ['Herakleia Pontike'], lat: 41.2842, lng: 31.4178, kind: 'city' },
  { name: 'Amisos', aliases: ['Amisus', 'Samsun'], lat: 41.2867, lng: 36.3300, kind: 'city' },
  { name: 'Sinope', aliases: ['Sinop'], lat: 42.0264, lng: 35.1531, kind: 'city' },
  { name: 'Trapezus', aliases: ['Trebizond', 'Trabzon'], lat: 41.0027, lng: 39.7168, kind: 'city' },
  { name: 'Amastris', lat: 41.7508, lng: 32.3838, kind: 'city' },
  { name: 'Alexandreia Troas', aliases: ['Alexandria Troas'], lat: 39.7470, lng: 26.1580, kind: 'city' },
  { name: 'Ilion', aliases: ['Troy', 'Ilium'], lat: 39.9573, lng: 26.2390, kind: 'city' },
  { name: 'Kaisareia', aliases: ['Caesarea', 'Caesarea in Cappadocia', 'Kaisareia-Germanike'], lat: 38.7322, lng: 35.4853, kind: 'city' },
  { name: 'Cappadocia', aliases: ['Kappadokia'], lat: 38.6431, lng: 34.8289, kind: 'region' },
  { name: 'Lycia', aliases: ['Lykia'], lat: 36.5500, lng: 29.9500, kind: 'region' },
  { name: 'Caria', aliases: ['Karia'], lat: 37.1500, lng: 28.0000, kind: 'region' },
  { name: 'Pisidia', lat: 37.7000, lng: 30.7000, kind: 'region' },
  { name: 'Pamphylia', lat: 36.9500, lng: 31.0000, kind: 'region' },
  { name: 'Cilicia', aliases: ['Kilikia'], lat: 36.9000, lng: 35.0000, kind: 'region' },
  { name: 'Bithynia', lat: 40.7000, lng: 30.5000, kind: 'region' },
  { name: 'Mysia', lat: 39.5000, lng: 27.5000, kind: 'region' },
  { name: 'Phrygia', lat: 38.8000, lng: 30.9000, kind: 'region' },
  { name: 'Lydia', aliases: ['Lydian'], lat: 38.4880, lng: 28.0400, kind: 'region' },
  { name: 'Ionia', lat: 38.0000, lng: 27.3000, kind: 'region' },
  { name: 'Pontus', aliases: ['Pontos'], lat: 41.0000, lng: 36.0000, kind: 'region' },
  { name: 'Galatia', lat: 39.9300, lng: 32.8600, kind: 'region' },
  { name: 'Bargasa', lat: 37.3600, lng: 27.9000, kind: 'city' },
  { name: 'Hypaepa', lat: 38.2700, lng: 28.1100, kind: 'city' },
  { name: 'Hadrianopolis', aliases: ['Adrianople', 'Edirne'], lat: 41.6770, lng: 26.5560, kind: 'city' },
  { name: 'Harpasa', lat: 37.7500, lng: 28.4000, kind: 'city' },
  { name: 'Apollonia Mordiaion', lat: 37.6000, lng: 30.5800, kind: 'city' },
  { name: 'Dium', lat: 40.1750, lng: 22.4900, kind: 'city' },

  // ─── Levant / Near East ───────────────────────────────
  { name: 'Antioch', aliases: ['Antiocheia', 'Antioch on the Orontes', 'Antakya'], lat: 36.2024, lng: 36.1604, kind: 'city' },
  { name: 'Seleukeia', aliases: ['Seleucia', 'Seleucia on the Tigris'], lat: 33.0833, lng: 44.5167, kind: 'city' },
  { name: 'Damascus', aliases: ['Dimashq'], lat: 33.5138, lng: 36.2765, kind: 'city' },
  { name: 'Tyre', aliases: ['Tyros', 'Sur'], lat: 33.2700, lng: 35.2031, kind: 'city' },
  { name: 'Sidon', aliases: ['Saida'], lat: 33.5630, lng: 35.3686, kind: 'city' },
  { name: 'Berytos', aliases: ['Berytus', 'Beirut'], lat: 33.8938, lng: 35.5018, kind: 'city' },
  { name: 'Arados', aliases: ['Arwad'], lat: 34.8556, lng: 35.8694, kind: 'city' },
  { name: 'Jerusalem', aliases: ['Hierosolyma', 'Aelia Capitolina'], lat: 31.7683, lng: 35.2137, kind: 'city' },
  { name: 'Caesarea Maritima', aliases: ['Caesarea Palaestinae'], lat: 32.5005, lng: 34.8919, kind: 'city' },
  { name: 'Sepphoris', aliases: ['Diocaesarea'], lat: 32.7508, lng: 35.2750, kind: 'city' },
  { name: 'Petra', lat: 30.3285, lng: 35.4444, kind: 'city' },
  { name: 'Bostra', aliases: ['Bosra'], lat: 32.5181, lng: 36.4814, kind: 'city' },
  { name: 'Palmyra', aliases: ['Tadmor'], lat: 34.5505, lng: 38.2706, kind: 'city' },
  { name: 'Edessa', aliases: ['Urfa'], lat: 37.1591, lng: 38.7969, kind: 'city' },
  { name: 'Mardin', lat: 37.3127, lng: 40.7345, kind: 'city' },
  { name: 'Nisibis', aliases: ['Nusaybin'], lat: 37.0667, lng: 41.2167, kind: 'city' },
  { name: 'Phoenicia', aliases: ['Phoenikia'], lat: 33.8900, lng: 35.5000, kind: 'region' },
  { name: 'Judaea', aliases: ['Judea', 'Iudaea'], lat: 31.7700, lng: 35.2300, kind: 'region' },
  { name: 'Samaria', lat: 32.2800, lng: 35.2000, kind: 'region' },

  // ─── Egypt / N. Africa ────────────────────────────────
  { name: 'Alexandria', aliases: ['Alexandreia', 'Alexandria ad Aegyptum'], lat: 31.2001, lng: 29.9187, kind: 'city' },
  { name: 'Memphis', lat: 29.8444, lng: 31.2497, kind: 'city' },
  { name: 'Thebes (Egypt)', aliases: ['Egyptian Thebes'], lat: 25.7188, lng: 32.6573, kind: 'city' },
  { name: 'Naucratis', aliases: ['Naukratis'], lat: 30.9000, lng: 30.6000, kind: 'city' },
  { name: 'Egypt', aliases: ['Aegyptus'], lat: 30.0000, lng: 31.2000, kind: 'region' },
  { name: 'Cyrene', aliases: ['Kyrene'], lat: 32.8200, lng: 21.8581, kind: 'city' },
  { name: 'Carthage', aliases: ['Karthago', 'Qart-Hadasht'], lat: 36.8531, lng: 10.3236, kind: 'city' },
  { name: 'Utica', lat: 37.0567, lng: 10.0628, kind: 'city' },
  { name: 'Hadrumetum', aliases: ['Sousse'], lat: 35.8254, lng: 10.6361, kind: 'city' },
  { name: 'Leptis Magna', aliases: ['Leptis'], lat: 32.6386, lng: 14.2906, kind: 'city' },
  { name: 'Sabratha', lat: 32.7905, lng: 12.4854, kind: 'city' },
  { name: 'Caesarea Mauretaniae', aliases: ['Iol Caesarea'], lat: 36.5851, lng: 2.4486, kind: 'city' },
  { name: 'Mauretania', lat: 35.0000, lng: -2.0000, kind: 'region' },
  { name: 'Numidia', lat: 36.0000, lng: 6.0000, kind: 'region' },

  // ─── Iberia / W. Europe ───────────────────────────────
  { name: 'Emerita', aliases: ['Emerita Augusta', 'Mérida'], lat: 38.9156, lng: -6.3433, kind: 'city' },
  { name: 'Colonia Patricia', aliases: ['Corduba', 'Cordoba', 'Córdoba'], lat: 37.8847, lng: -4.7791, kind: 'city' },
  { name: 'Gades', aliases: ['Cadiz', 'Cádiz'], lat: 36.5298, lng: -6.2924, kind: 'city' },
  { name: 'Tarraco', aliases: ['Tarragona'], lat: 41.1189, lng: 1.2445, kind: 'city' },
  { name: 'Hispania', lat: 40.0000, lng: -3.7000, kind: 'region' },
  { name: 'Lugdunum', aliases: ['Lyon', 'Lyons'], lat: 45.7640, lng: 4.8357, kind: 'city' },
  { name: 'Nemausus', aliases: ['Nimes', 'Nîmes'], lat: 43.8367, lng: 4.3601, kind: 'city' },
  { name: 'Arelate', aliases: ['Arles'], lat: 43.6766, lng: 4.6278, kind: 'city' },
  { name: 'Massalia', aliases: ['Massilia', 'Marseille'], lat: 43.2965, lng: 5.3698, kind: 'city' },
  { name: 'Trier', aliases: ['Augusta Treverorum', 'Treveri'], lat: 49.7491, lng: 6.6386, kind: 'city' },
  { name: 'Londinium', aliases: ['London'], lat: 51.5074, lng: -0.1278, kind: 'city' },

  // ─── Balkans / Pannonia ───────────────────────────────
  { name: 'Siscia', aliases: ['Sisak'], lat: 45.4880, lng: 16.3780, kind: 'city' },
  { name: 'Sirmium', aliases: ['Sremska Mitrovica'], lat: 44.9700, lng: 19.6000, kind: 'city' },
  { name: 'Singidunum', aliases: ['Belgrade', 'Beograd'], lat: 44.7866, lng: 20.4489, kind: 'city' },
  { name: 'Serdica', aliases: ['Sofia'], lat: 42.6977, lng: 23.3219, kind: 'city' },
  { name: 'Constantinople', aliases: ['Konstantinoupolis', 'Byzantium', 'Byzantion', 'Istanbul'], lat: 41.0082, lng: 28.9784, kind: 'city' },
  { name: 'Heraclea (Thrace)', aliases: ['Perinthus'], lat: 40.9667, lng: 27.9667, kind: 'city' },
  { name: 'Cherson', aliases: ['Chersonesos', 'Chersonese'], lat: 44.6116, lng: 33.4936, kind: 'city' },
  { name: 'Pantikapaion', aliases: ['Panticapaeum', 'Kerch'], lat: 45.3617, lng: 36.4711, kind: 'city' },
  { name: 'Olbia', lat: 46.6900, lng: 31.9000, kind: 'city' },
  { name: 'Scythia', aliases: ['Skythia'], lat: 47.0000, lng: 32.0000, kind: 'region' },

  // ─── Persia / Central Asia / India ────────────────────
  { name: 'Persepolis', lat: 29.9354, lng: 52.8916, kind: 'city' },
  { name: 'Susa', aliases: ['Sousa', 'Shush'], lat: 32.1923, lng: 48.2575, kind: 'city' },
  { name: 'Ecbatana', aliases: ['Hamadan', 'Hamedan'], lat: 34.7960, lng: 48.5147, kind: 'city' },
  { name: 'Ctesiphon', lat: 33.0925, lng: 44.5806, kind: 'city' },
  { name: 'Babylon', lat: 32.5422, lng: 44.4214, kind: 'city' },
  { name: 'Rhagai', aliases: ['Rhagae', 'Rhages', 'Rey'], lat: 35.5897, lng: 51.4350, kind: 'city' },
  { name: 'Rayy', lat: 35.5897, lng: 51.4350, kind: 'city' },
  { name: 'Wasit', lat: 32.1839, lng: 46.2942, kind: 'city' },
  { name: 'Basra', aliases: ['al-Basrah'], lat: 30.5081, lng: 47.7836, kind: 'city' },
  { name: 'Madina-t al-Salam', aliases: ['Madinat al-Salam', 'Baghdad'], lat: 33.3152, lng: 44.3661, kind: 'city' },
  { name: 'Misr', aliases: ['al-Fustat', 'Fustat'], lat: 30.0050, lng: 31.2317, kind: 'city' },
  { name: 'Parthia', lat: 36.5000, lng: 56.0000, kind: 'region' },
  { name: 'Bactria', aliases: ['Baktria'], lat: 36.7600, lng: 66.9000, kind: 'region' },
  { name: 'Balkh', aliases: ['Bactra'], lat: 36.7581, lng: 66.8989, kind: 'city' },
  { name: 'Taxila', lat: 33.7460, lng: 72.7868, kind: 'city' },

  // ─── E. Asia ──────────────────────────────────────────
  { name: 'Chang’an', aliases: ['Changan', 'Xi’an', 'Xian'], lat: 34.3416, lng: 108.9398, kind: 'city' },
  { name: 'Luoyang', lat: 34.6197, lng: 112.4540, kind: 'city' },
  { name: 'Beijing', aliases: ['Peking'], lat: 39.9042, lng: 116.4074, kind: 'city' },
  { name: 'Kaifeng', lat: 34.7986, lng: 114.3074, kind: 'city' },
  { name: 'Hangzhou', lat: 30.2741, lng: 120.1551, kind: 'city' },
];

// Curated label tiers — capitals/huge mints (1) always show, major regional
// mints (2) show at Mediterranean zoom, the rest (3) only when zoomed in.
const _tier1 = new Set([
  'Rome', 'Constantinople', 'Alexandria', 'Antioch', 'Carthage',
  'Athens', 'Syracuse',
]);
const _tier2 = new Set([
  'Corinth', 'Sparta', 'Pella', 'Thessalonike', 'Thebes',
  'Cyzicus', 'Sardis', 'Ephesos', 'Miletos', 'Pergamon', 'Smyrna',
  'Tarsos', 'Nicomedia', 'Nicaea',
  'Tyre', 'Sidon', 'Damascus', 'Jerusalem', 'Palmyra',
  'Memphis', 'Cyrene', 'Leptis Magna',
  'Lugdunum', 'Massalia', 'Trier', 'Aquileia', 'Mediolanum',
  'Tarentum', 'Metapontion', 'Neapolis', 'Akragas', 'Selinous',
  'Persepolis', 'Susa', 'Ecbatana', 'Ctesiphon', 'Babylon',
  'Madina-t al-Salam', 'Damascus', 'Misr',
  'Pantikapaion', 'Olbia', 'Cherson', 'Sirmium', 'Siscia', 'Serdica',
  'Hadrianopolis', 'Heraclea Pontica', 'Amisos', 'Kaisareia',
  'Chang’an', 'Beijing', 'Luoyang', 'Taxila', 'Balkh',
]);
for (const m of MINTS) {
  if (m.tier == null) {
    m.tier = _tier1.has(m.name) ? 1 : _tier2.has(m.name) ? 2 : 3;
  }
}

// Build a fast lookup table: lowercased name/alias → mint entry
const _index = new Map();
for (const m of MINTS) {
  _index.set(m.name.toLowerCase(), m);
  for (const a of m.aliases || []) _index.set(a.toLowerCase(), m);
}

export function findMint(name) {
  if (!name) return null;
  return _index.get(name.toLowerCase().trim()) || null;
}

// All distinct names + aliases sorted longest-first so multi-word matches
// ("Antioch on the Orontes") win over short ones ("Antioch").
const _allNames = [...new Set(
  MINTS.flatMap((m) => [m.name, ...(m.aliases || [])]),
)].sort((a, b) => b.length - a.length);

const _wordEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _scanRe = new RegExp(
  `\\b(${_allNames.map(_wordEscape).join('|')})\\b`,
  'gi',
);

// Scan a string for any mint mention; return [{name, mint, index}].
export function scanForMints(text) {
  if (!text) return [];
  const hits = [];
  let m;
  _scanRe.lastIndex = 0;
  while ((m = _scanRe.exec(text)) !== null) {
    const mint = findMint(m[1]);
    if (mint) hits.push({ matched: m[1], mint, index: m.index });
  }
  return hits;
}
