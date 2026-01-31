PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER NOT NULL,
  key TEXT NOT NULL,
  type TEXT CHECK (type IN ('docent','leerling')) NOT NULL,
  user_id INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
INSERT INTO api_keys (id, key, type, user_id, active, created_at) VALUES
(6, '2b6fbe72b4664619fd0bb167e7c2f754', 'docent', 3, 1, '2025-10-01 20:43:31'),
(7, '8490e3bb6f3841db1d1cb6d46f05d98c', 'docent', 10, 1, '2025-10-02 13:54:11'),
(8, 'c1d67ce952a786bfac01839a097bbfb6', 'docent', 16, NULL, '2025-10-02 13:54:11'),
(9, 'b3c85463ce04aa6fd5c3e972bc256ae4', 'docent', 18, NULL, '2025-10-02 13:54:44'),
(10, '720b65274eee4979166344aec43b8fec', 'docent', 19, NULL, '2025-10-02 13:54:44');
CREATE TABLE IF NOT EXISTS berichten (
  id INTEGER NOT NULL,
  afzender_id INTEGER NOT NULL,
  ontvanger_type TEXT CHECK (ontvanger_type IN ('klas','leerling')) NOT NULL,
  ontvanger_id INTEGER NOT NULL,
  bericht TEXT NOT NULL,
  gelezen INTEGER DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP) 
);
CREATE TABLE IF NOT EXISTS bibliotheek_vragen (
  id INTEGER NOT NULL,
  bibliotheek_lijst_id INTEGER NOT NULL,
  vraag TEXT NOT NULL,
  antwoord TEXT NOT NULL
);
INSERT INTO bibliotheek_vragen (id, bibliotheek_lijst_id, vraag, antwoord) VALUES
(1, 1, 'Vertaal: ik was', 'ich war'),
(2, 1, 'Vertaal: jij was', 'du warst'),
(3, 2, 'go ->', 'went'),
(4, 2, 'see ->', 'saw'),
(45, 4, 'Wat betekent het Duitse werkwoord "können"?', 'kunnen'),
(46, 4, 'Vul in: ich ___ (können) gut schwimmen.', 'kann'),
(47, 4, 'Vul in: du ___ (können) gut singen.', 'kannst'),
(48, 4, 'Vertaal: Wir können Deutsch spreken.', 'Wij kunnen Duits spreken.'),
(49, 4, 'Vul in: er ___ (können) schnell laufen.', 'kann'),
(50, 4, 'Wat betekent het Duitse werkwoord "dürfen"?', 'mogen'),
(51, 4, 'Vul in: ich ___ (dürfen) heute fernsehen.', 'darf'),
(52, 4, 'Vul in: du ___ (dürfen) hier niet parken.', 'darfst'),
(53, 4, 'Vertaal: Wir dürfen spielen.', 'Wij mogen spelen.'),
(54, 4, 'Vul in: ihr ___ (dürfen) das niet maken.', 'dürft'),
(55, 4, 'Wat betekent het Duitse werkwoord "wissen"?', 'weten'),
(56, 4, 'Vul in: ich ___ (wissen) es nicht.', 'weiß'),
(57, 4, 'Vul in: du ___ (wissen), wo er ist?', 'weißt'),
(58, 4, 'Vertaal: Wir wissen die Antwort.', 'Wij weten het antwoord.'),
(59, 4, 'Vul in: sie ___ (wissen) viel über Tiere.', 'wissen'),
(60, 4, 'Wat betekent het Duitse werkwoord "wollen"?', 'willen'),
(61, 4, 'Vul in: ich ___ (wollen) ein Eis.', 'will'),
(62, 4, 'Vul in: du ___ (wollen) mitkommen?', 'willst'),
(63, 4, 'Vertaal: Wir wollen spielen.', 'Wij willen spelen.'),
(64, 4, 'Vul in: er ___ (wollen) schlafen.', 'will'),
(65, 4, 'Wat betekent het Duitse werkwoord "mögen"?', 'houden van'),
(66, 4, 'Vul in: ich ___ (mögen) Pizza.', 'mag'),
(67, 4, 'Vul in: du ___ (mögen) Hunde?', 'magst'),
(68, 4, 'Vertaal: Wir mögen Schokolade.', 'Wij houden van chocolade.'),
(69, 4, 'Vul in: er ___ (mögen) Musik.', 'mag'),
(70, 4, 'Wat betekent het Duitse werkwoord "müssen"?', 'moeten'),
(71, 4, 'Vul in: ich ___ (müssen) lernen.', 'muss'),
(72, 4, 'Vul in: du ___ (müssen) früh aufstehen.', 'musst'),
(73, 4, 'Vertaal: Wir müssen gehen.', 'Wij moeten gaan.'),
(74, 4, 'Vul in: ihr ___ (müssen) zuhören.', 'müsst'),
(75, 4, 'Wat betekent het Duitse werkwoord "möchten"?', 'graag willen'),
(76, 4, 'Vul in: ich ___ (möchten) einen Kaffee.', 'möchte'),
(77, 4, 'Vul in: du ___ (möchten) tanzen?', 'möchtest'),
(78, 4, 'Vertaal: Wir möchten schlafen.', 'Wij willen graag slapen.'),
(79, 4, 'Vul in: er ___ (möchten) Lehrer werden.', 'möchte'),
(80, 4, 'Wat betekent het Duitse werkwoord "sollen"?', 'moeten (van iemand anders)'),
(81, 4, 'Vul in: ich ___ (sollen) meine Hausaufgaben machen.', 'soll'),
(82, 4, 'Vul in: du ___ (sollen) das tun?', 'sollst'),
(83, 4, 'Vertaal: Wir sollen warten.', 'Wij moeten wachten.'),
(84, 4, 'Vul in: ihr ___ (sollen) rustig zijn.', 'sollt');
CREATE TABLE IF NOT EXISTS bibliotheek_vragenlijsten (
  id INTEGER NOT NULL,
  naam TEXT NOT NULL,
  beschrijving TEXT DEFAULT NULL,
  licentie_type TEXT CHECK (licentie_type IN ('gratis','verborgen','Neue Kontakte','Engels','Grandes Lignes','Overal Natuurkunde')) DEFAULT 'gratis',
  created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
INSERT INTO bibliotheek_vragenlijsten (id, naam, beschrijving, licentie_type, created_at) VALUES
(1, 'Duits - Kapitel 1', 'Woordenlijst Neue Kontakte, hoofdstuk 1', 'verborgen', '2025-10-09 15:52:57'),
(2, 'Engels - Irregular verbs', 'Onregelmatige werkwoorden Engels', 'verborgen', '2025-10-09 15:52:57'),
(3, 'Duits - Kapitel 3 - Woorden', 'Neue Kontakte Havo 3, Alle woorden van kapitel 3!', 'verborgen', '2025-10-09 20:59:45'),
(4, 'Duits - Kapitel 3 - Grammatik', 'Neue Kontakte Havo 3, Alle grammatica van Kapitel 3!', 'Neue Kontakte', '2025-10-10 21:44:32');
CREATE TABLE IF NOT EXISTS boeken (
  id INTEGER NOT NULL,
  titel TEXT NOT NULL,
  bestand TEXT NOT NULL,
  omschrijving TEXT DEFAULT NULL
);
INSERT INTO boeken (id, titel, bestand, omschrijving) VALUES
(1, 'Neue Kontakte 3 Havo Duits', 'NK3HAVODU.json', 'Duits leerjaar 3 (havo) - methode Neue Kontakte.'),
(5, 'Grandes Lignes 3 Havo Frans', 'GL3HAVOFA.json', 'Frans leerjaar 3 (havo) - methode Grandes Lignes.'),
(6, 'Overal Natuurkunde Havo 3', 'ON3HAVONA.json', 'Natuurkunde leerjaar 3 (havo) - methode Overal Natuurkunde.'),
(7, 'Nieuw Nederlands Havo 3 Nederlands', 'NN3HAVONE.json', 'Nederlands leerjaar 3 (havo) - methode Nieuw Nederlands');
COMMIT;
