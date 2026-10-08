Decisions already settled by the maintainer — do NOT report these as issues, only report if the code fails to do what they say:
- Matching fetches OSM over the same bbox the records are cut by (relation areas cut by bbox; neighbour corners get in on purpose).
- Doubtful matches are not guessed: they get a `warning` line (shown as a "Check" banner): a "new" POI with an object of its kind within 150 m, a match whose site is mapped as several objects, an object matched by several records. Judge whether the warning is present when it should be and absent when it should not.
- Schools: écoles maternelles are amenity=school + school:FR=maternelle (FR wiki); post-bac-only establishments amenity=college; collèges/lycées amenity=school. Only etat=FERME counts as a closure; closures are written as disused:<key>.
- name / operator / network only FILL GAPS (never overwrite a mapper's value).
- IRVE: `ref:EU:EVSE` on a station is the station/pool id written with `*` (e.g. FR*ABC*P12345), never overwriting a mapper's id. `:output` is proposed for a socket type only when every point carrying it has that connector alone, or for DC types (CCS) on a DC unit; AC type 2 on a mixed unit gets no output; CHAdeMO beside CCS gets no output. "Accès libre" → access=yes only where OSM has no access (add-only); "Accès réservé" → no access tag.
- Upstream noise (type 2 at 24 kW, CHAdeMO at 22 kW, broken encoding) is not a mapping bug.

Settled and implemented since the previous audit (judge whether the code does this, do not argue the decision):
- Medico-social institutes (IME, ITEP, IES…) → new nodes `amenity=social_facility` + `social_facility:for=disabled`, no `social_facility=*`; an existing object's amenity is never changed (amenity is add-only for them). Sections housed in a parent (SEP/SEGPA, type_rattachement "FILIERE OU DEPARTEMENT OU SECTION") are skipped.
- start_date: IRVE commissioning date (earliest, bare 1 January dropped) at 0.7. School `date_ouverture` only from 1978 on and never for a primaire.
- `network` is not proposed when nom_enseigne is the site's own name (equals/overlaps the station name, contains " - ", numeric). A curated network list (accents, "Révéo" vs "Reveo") is planned later: don't report spelling of real networks.
- No `:output` above 43.5 kW on type 2 / type2_cable or above 3.7 kW on type E.
- "hors contrat" is stripped from school names; "privée/publique" stay.
- Addresses are proposed whole or not at all; a street differing from OSM's only in case/accents counts as the same.
- On a split site (several same-kind objects ≤25 m), capacity and socket:* counts are left out and the banner says so.
- Matching: a ref several records share (one SIRET for two establishments) decides nothing; a school's ce.<UAI>@ac-… mailbox counts as its UAI; a station carrying only another operator's EVSE code is never matched by name/distance; an unnamed station matches within 50 m when operator/network/brand agrees (else 15 m); the fetch includes any object with ref:UAI, school/college/university kin, and a ~220 m margin.

Settled after the second audit (2026-10-04) — judge whether the code does this, do not argue the decision:
- EVSE ids compared per station without the E/P letter; a pool id survives a change of operator code (tail ≥ 8 chars); another station's EVSE ids rule out a name/distance match and split-site membership.
- A school's ce.<UAI>@ac-… mailbox is indexed as its UAI for matching.
- A brand-only or generic OSM name ("Allego", "Recharge", "Borne de recharge Révéo") leaves the match to operator/network/brand; a name all inside the record's ("La Fourmi") is a strong match, and a strong name (≥ 0.6) matches up to 150 m.
- Objects carrying ref:EU:EVSE are fetched without amenity (charge points excluded).
- A value among the object's ;-list agrees (school:FR=collège;primaire;lycée). Keys that several records on one object disagree on are left out with a banner line.
- phone not added when the same number is in mobile; contact: scheme chosen only from contact:phone/email/website/fax/mobile.
- Typed socket counts delete socket:unknown(:output) (only firm ones, since the fifth audit).
- Address held as contact:housenumber|street|postcode|city moves to addr:* (del/add pair) in the mapper's spelling; a differing part leaves the whole address alone.
- authentication:none from paiement_acte, skipped when notes mention app/badge/abonnement or OSM says badge-only.
- fee follows gratuit (false → yes, FR wiki); may overwrite a mapper's fee=no, with a banner line.
- Postcodes come from BAN (api-adresse.data.gouv.fr); no confident match → no postcode; a source point > 1 km from its BAN address gets a banner line.
- IRVE: a site is read from its newest declaration (resource) whole; a single station whose nbre_pdc disagrees with its listed points gets no capacity (note); a one-row station uses nbre_pdc and no sockets; wheelchair/reservation aggregated over points; network not the owner's name or "owner + place"; no operator:phone mobiles; no vehicle tag when the name/connectors contradict the two-wheeler flag; all-TRUE connector flags → no sockets.
- Education: initials kept in mixed-case names; "hors contrat"/"hors-contrat" stripped; precision_localisation other than Parfaite/Numéro de rue → banner line.

- A name whose words all appear in the record's name is a name match even when the operator is named after the place ("Association La Fourmi" / "La Fourmi").

Context for this (third) audit: every fix above is in the running code. Report anything still wrong, regressions from the fixes above included.

Settled after the third audit (2026-10-04), judge whether the code does this, do not argue the decision:
- A source point > 1 km (school) / > 100 m (station) from a confident BAN housenumber hit moves there before matching (banner "Moved N m…"); one moved out of the area box is dropped and counted in the run message.
- School addresses are spelled by BAN (street, postcode, city) with the source's housenumber (ranges kept); no confident hit → no address.
- Every mod of a mapper's value has a banner line (with a recent check_date noted). No opening_hours when the notes state hours. Capacity skips type-2-only points above 43.5 kW on a site with DC.
- Named building=school|college|university is matched (amenity added, banner); unnamed ones banner only.
- Personal mailboxes (first.last, no role word) and 06/07 mobiles are left out of schools.
- EVSE tail alone only with a letter and within 150 m; a match > 150 m away has a banner; another object carrying the record's id at any distance counts as the same site; several records on one object → counts left out; twin "new" records bannered.
- An unsure station count suppresses sockets too (DC :output kept). A station's newest declaration is read per station; declarations sharing a point id within 400 m are one site.
- Accept refuses part of an address or half of a contact:* → addr:* move.
- authentication:none suppression by IZIVIA's tariff boilerplate is accepted.

Settled after the fourth audit and the fixes that followed (on `main` 2026-10-05), judge whether the code does this, do not argue the decision. Where a line here differs from one above, this one wins.

Moving a point, and addresses:
- A record is matched at its SOURCE point first and stays there when something matches. The campus/mall exception for moves is gone.
- A school's point more than 1 km from its housenumber moves there, only to a housenumber on the street the source names. A station's point moves (100 m) only when the registry gives it to four decimals or fewer; a precise one stays, is matched at its address only when nothing matches where it stands, and a "new" one says how far its address is. Duplicates are looked for at the source point of a moved record.
- The address base's street is taken only when it names the street the source gives, whatever type it calls it; a near-miss on another street proposes no address. It is asked again without the postcode when that sinks the line, and with the housenumber glued. A station whose address is in another département than the consolidation is geocoded from its own postcode and commune.
- Housenumbers: no leading zeros, a letter suffix in capitals and glued ("6A", as FR:Adresses and most mapped ones do), bis/ter in lower case and spaced ("12 bis"), as mappers in Lyon and Toulouse do. Comparison ignores case and spacing. A merged commune's old name is dropped from the street; a port reads as a street.
- A match more than 500 m from BOTH the source's point and the address base's housenumber or street gets no address, contacts or SIRET, and nothing saying what the place is goes onto a far object mapped as no place. Such matches left with nothing to write are counted in the run's line.

Matching:
- An id on an object that is no longer the place (a `disused:`/`was:` main tag, a construction site, another main key) settles no match and reopens nothing. An object carrying the record's id goes to that record.
- Operators compare without legal and trade words; Alizé reads as Bouygues; the owner or a brand-only name counts as who runs a station. The operator alone reaches no farther than 50 m, and another operator's sign counts against an object.
- Choosing a station's object scores capacity, connectors and power class (listed sockets count even when the count is too unsure to propose); no DC unit is taken for an AC station on the operator's word. An object two records match without ids goes to the one whose counts fit. A station's plain `ref` is read as its point id or borne letter, to tell split sites and other stations apart and keep the station's counts off one borne; a borne whose capacity is the station's whole counts as the station.
- The network's own station within 25 m whose connectors fit is matched under a lost name or a renumbered pool id, with a banner.
- Split sites are found by the matched object's operator and a point id without its connector; objects other records matched stay out of a split.
- A named way or grounds is preferred over a bare node or a school building. Maternelles mapped as kindergartens, blind and deaf institutes and car parks with chargers count as duplicates for the banner. A same-name object of the matched one's kind 25–150 m off it is named in the banner.
- New records of one name, address and operator are paired however far apart; one operator's new stations up to 60 m apart are paired. Two records' websites compare strictly. A sibling is named by SIRET or by what its own record says.

IRVE:
- Declarations sharing a charge point id within 400 m, or its seven-digit number within 100 m under another operator's prefix, are one site. Lone points declared as stations a few metres from their car park join it under its name or address. A station re-declared in another file (shared points with its name or count, name and count on the same spot, or as many points as its single row counted) is dropped and its renumbered points are not counted. "Non concerné" rows are keyed by place and operator.
- When every single-row station of a site repeats one count n and there are n of them, n is the site's total (one point per row); otherwise each counts its own n.
- No socket count while some points name no connector, and no socket output without its count. A point's connectors come from an older declaration where the newest names none or only "autre". A high-power type 2 point counts as a bay unless its own station has DC.
- Notes, fee, two-wheelers and accessibility are read over every declaration of the points; the last two are proposed only where declarations agree. opening_hours only where the site's stations agree (overlapping spans joined), and no default 24/7 over real hours.
- The commissioning date comes from this site's rows only and is never later than a declaration of the station.
- No network that an older declaration's station or host is named by, none that is descriptive; no owner written as a slug; no filler phone of one repeated digit.

Education:
- The main site of a UAI is the one whose address is at its point; OSM keeps another site's phone or website. A SEGPA attached as a geographic annex is skipped.
- A mapper's finer operator:type, school level and site are kept. `social_facility:for` is written only on a social facility. No start_date on a group's or campus's single object, and no campus gets a single level. The banner says when a lycée would become a college.
- One-word personal mailboxes are withheld (a single word that is neither a role nor the school's name, place or domain).
- Names: EPNAK, IESCA, ICS, ASEI, OVE and ISO stay in capitals; the accent goes back on Métiers, Éclat, Édouard and Boétie; a capital typed twice is dropped; De, Du and Des are small inside a name.
- A website's fragment is dropped, and https is kept where another site of the UAI gives the page over it.
- Disputed values are compared under the object's own key, and a move or an address is left out whole.

Settled after the code bug hunt (on `main` 2026-10-05). Where a line here differs from one above, this one wins.

- No `socket:type2_combo:output` or `socket:chademo:output` above 400 kW (the registry holds cabinet or site totals), like the 43.5 kW cap on type 2. A type 2 point declared in watts counts as a bay, not as a DC cabinet's outlet.
- Phones follow FR:Key:phone: `+33 4 …` for a geographic or mobile number, an 08 number national and spaced (`08 06 14 15 00`), an overseas number under its own code (`+262 262 …`). Mobiles, overseas ones included, are still left out of schools.
- A blank `cable_t2_attache` means unknown: such type 2 points are proposed as `socket:type2` (and its output) fill-only, and not at all where the object has `socket:type2` or `socket:type2_cable`; `socket:type2_cable` is never ruled out because of them and they weigh nothing in the fit. Explicit true is a cable, explicit false a socket.
- A day named again after `;` or `,` in the registry's hours is one split day (`Mo-Sa 07:30-12:00,13:30-17:30`); overlapping spans propose no opening_hours. Only 23:57 to 23:59 read as the end of the day.
- `socket:schuko` is never ruled out on a station that ticks an E/F outlet. `motorcycle=yes` from `station_deux_roues` stays, fill-only, with no `motorcar=no` beside it.
- A school's street may be a cité, ruelle, cour, traverse, résidence, lotissement and the like; a lieu-dit or hameau still gets no address (`addr:place` is never written). A postcode is dropped only where the address lines say CEDEX, BP or CS.
- A mapper's socket output is read in its own unit (W, kW, kVA) before power classes are compared.
- A candidate whose OSM object moved on is flagged in conflict whatever its banner says; one accepted during a run is not rewritten; a record that moves to another area is taken over by it in the same run.

Settled after the fifth audit (schools). Where a line here differs from one above, this one wins.

Addresses:
- A hit of the address base scored from 0.5 up to 0.7 counts when it is the source's own housenumber on a street holding every word of the source's street ("rue Rebatel" in Rue Docteur Rebatel, "impasse Roger Brechan" as Passage Roger Bréchan); under 0.5 it never does. Schools and stations alike.
- Open, not settled: an address the base found by its street only still follows the 500 m rule. A 150 m limit measured to the street's point was tried on 05-10-2026 and withdrawn, since it dropped 11 good addresses with Jacques Prévert's (a school stands on its street, not at its centre). Count Jacques Prévert as a known gap.
- A street spelling a day out ("Rue du Onze Novembre 1918") is the mapper's "Rue du 11 Novembre 1918" (days 1–31, "premier"/"1er"), and the mapper's spelling stays.
- A match more than 500 m off gets no `start_date` either, so one left with only that is counted as a far match.

Matching and banners:
- A `ref:UAI` or `ref:FR:SIRET` the object already holds with another id is never replaced: no op, and a banner line names the object's id and the record's.
- On an object other records share, a `ce.<UAI>@ac-…` mailbox is left out with the UAI ("Left out, since another record…").
- No level op of any kind on a campus object (`school:FR` mod included).
- A school building carrying the record's UAI stays the match when the grounds around it are named for a campus and another establishment's object (another UAI) stands within 100 m of their centre.
- An object no longer the place (closed, being built, repurposed) is not matched by name or distance either; the record becomes "new" and its banner names the object.
- A post-bac record (`amenity=college`) matched to an object that reads as a lycée, by `school:FR` containing lycée or a name beginning "Lycée", proposes no `amenity` op: a banner line says the post-bac section is housed in the lycée, and only gap-filling tags go through (Saliège, Pigier, Myriam, Billières, Limayrac). Any other object keeps the school→college mod with its banner.
- Namesake banner: besides an exact name, an id-less same-kind object 25–150 m off whose name scores ≥ 0.8 against the matched one's with the same school-kind words ("privé"/"privée", "Baptiste"/"Jean-Baptiste"); and a groupe scolaire of the same proper name when it carries the record's housenumber and street, or no other establishment (another UAI's object, another matched record) shares its proper name.
- A same-UAI object more than 25 m from the match is named on its own line ("Another object carrying this UAI is …"), not counted into "Same site may be mapped as N objects". EVSE ids are unchanged.
- An update whose object does not carry the record's id names an object no longer the place that does ("carries this record's id, but it is mapped as disused…").
- A match more than 150 m from the source's point names the nearest object of its kind within 50 m of that point.
- Institutes get the unnamed `building=school` lookalike banner too.
- A "new" school names every object of its kind within 50 m carrying a UAI the source's whole read (every area of the run) does not list: "… carries UAI X, which the directory no longer lists". Never matched. One farther off stays unnamed.

Education preset:
- A webmail mailbox is proposed only when a part of it names the school, its place or a role ("gorge.de.loup@", "ecole.juive.de.lyon@"); any other ("sophiejery@", "fatemi60@") is withheld and counted.
- A lycée's SEP (334) or SEGT (335) attached as a geographic annex at its parent's address is skipped, like a SEGPA; annexes elsewhere (lycées professionnels, STS, IME) stay.
- "The directory lists this UAI at N sites" counts distinct addresses and points; repeated rows of one site say nothing.
- An accented name written in lower case gets its capital ("la boétie" → "la Boétie").

Settled after the fifth audit (2026-10-05). Where a line here differs from one above, this one wins.

IRVE:
- On one `date_maj` the operator's or owner's own file outranks an aggregator's copy (Qualicharge, by `datagouv_organization_or_owner`); `last_modified` only orders files of the same standing.
- A point's `cable_t2_attache` is its newest declaration that states it before anything is ruled out; a blank type 2 point's output is fill-only and not proposed where the object has `socket:type2` or `socket:type2_cable`.
- A station whose own name says DC (`\bDC\b`, `rapide`) but which ticks no DC connector has unknown connectors: no socket counts, a note.
- Type 2 output leaves out a DC unit's own type 2 outlet: a point numbered as another connector of a DC point (ids differing in the last character) at that point's power.
- Days spelled in English (`Sat`, `Sun`, `Mon-Fri`) are read as OSM's two letters before the days are folded.
- An operator phone the CSV stripped of its 0 (nine digits) or its `+` (`33` and nine digits) is read back; the filler and mobile rules still apply. School phones are unchanged.
- A postal box (`BP 75`, `CS 30012`) or CEDEX is dropped from `adresse_station` before geocoding.
- No `owner` where a site's stations name different owners, and none on an object whose `owner:ref:FR:SIREN` is not the row's `siren_amenageur`.
- A point more than 2 km from a confident housenumber in its own postcode is an error whatever its precision: it moves (banner), and is dropped and counted when that takes it out of the area.

Matching and banners:
- Firm typed socket counts delete socket:unknown(:output), quoting them all; a fill-only count deletes and quotes nothing.
- A socket type the record counts that an object listing other socket types lacks counts against it (type 2 socket and cable, E/F and Schuko, are each one connector).
- A charger for bicycles or scooters only (`bicycle`/`scooter` yes or designated without `motorcar=yes` and with `motorcar=no` or no car connector), or one with Schuko alone, is never matched to a car station (one listing a car connector and no `motorcycle`) nor part of its site.
- A plain `ref` holding a `;`-list of point ids is read as those EVSE ids.
- Within 150 m (to a way's or relation's nearest box edge), an object is a station's match when its operator, network, owner or name agrees (the record's own operator and owner words dropped from the name), its capacity if it states one is the record's, some count agrees (a fill-only one may) and no firm count differs, and it carries no other station's id unless the same operator's renumbered pool. Past 50 m such a match has the "Matched to … m away" banner.
- The duplicate banner of a "new" station names an object without another station's id first, says "(carries …, another station's)" when the one it names has one, and counts the others of its kind within 25 m of it.
- `start_date` is when the place opened. A school's `date_ouverture` is that, and is never checked against the object. A station's `date_mise_en_service` is its current operator's, so it is left out when the object was first mapped more than 90 days before it (a re-commissioning: Ramonville's 2026 date on a node mapped in 2024); a station mapped up to 90 days before keeps it (Basso Cambo, 56 days). Version 1 is read from the OSM API for an edited object, and an unknown first day means no date. This is a stand-in, not the answer: the real opening date has to be mined from older versions of the consolidated file.
- A kit's rules run only for records of its own kind: a station gets no school rule (a campus-named object no longer withholds its `start_date`) and a school gets no station rule, and a record of no kind gets none.
- The far-match banner names only what the record's kind declares in its mapping (a station's or a defibrillator's: "its opening date is left out", never SIRET or contacts it cannot write).
- An institute (`amenity=social_facility`) matched to a school-shell building beside grounds of its kind gets the school's banner worded for an institute: amenity and name are left out, so the institute is not mapped twice.
- The duplicate banner of a "new" record names the tag that made the lookalike one (`capacity:charging=8`, `healthcare=centre`), not the object's first main key, and never `amenity=undefined`.
- Name comparison drops the status words (private, public) for every kind and the words of what a station is (borne, recharge, station, irve) for stations only; a school's proper name no longer loses them.
- A place's main keys are one list, the legacy seven plus whatever each mapping's `matching.main` names: a building also tagged with any of them (an `emergency` device included) is not a bare shell, and the area's "POIs watched" counts every one.
- A closure is written as `disused:` on the main key the record carries, not the object's first one; an object without that key gets no closure.
- Matching cuts objects by the nearest edge of their box, not their centre's latitude, so a large way whose edge is within reach is considered; the Overpass margin is the farthest reach plus 70 m.
- Two objects carrying one `ref:FR:GeoDAE` are one site mapped as two objects, however far apart, and get the "Same site" line.

Known gaps, deliberately not done: mention them only as a count, do not analyse them. This list replaces any earlier one: a stale UAI on an object more than 50 m from a "new" record that shares no address, phone, email or SIRET with it (never matched, and named by no banner line), and one the run's read cannot judge (a directory row with no position is not read); point-inside-area containment; street names not verified against OSM highways; no banner when a fill-only value contradicts the source; an IRVE operator, owner or network written as the registry spells it (capitals, legal names); operator:email / charge / maxheight not proposed. A station's real opening date where the registry only holds a re-declaration (the first-mapping day stands in for it).

Every fix above is in the running code. Report anything still wrong, regressions from these fixes included.
