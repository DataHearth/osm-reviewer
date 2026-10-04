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
- Typed socket counts delete socket:unknown(:output).
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
- Housenumbers: no leading zeros, suffix in lower case, bis/ter written spaced ("12 bis"), as mappers in Lyon and Toulouse do. A merged commune's old name is dropped from the street; a port reads as a street.
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

Known gaps, deliberately not done: mention them only as a count, do not analyse them. This list replaces any earlier one: a stale UAI on an object that shares no address, phone, email or SIRET with the record (never matched, and not named by the "Another establishment" banner line); point-inside-area containment; street names not verified against OSM highways; no banner when a fill-only value contradicts the source; an IRVE operator, owner or network written as the registry spells it (capitals, legal names); operator:email / charge / maxheight not proposed.

Every fix above is in the running code. Report anything still wrong, regressions from these fixes included.
