# Matletika: aplikacija za rezervaciju termina vežbanja

Mobilna aplikacija (Android prvo, iOS posle) za rezervaciju termina vežbanja iz matematike u učionici. Profesorka je u učionici dok vežbaju, pa može da odgovori na pitanja.

Dvoje programera: **A = backend**, **B = mobilna aplikacija** (prilagodi ko radi šta).

## Stack

| Deo | Tehnologija |
|---|---|
| Mobilna (`frontend/`) | React Native + Expo (TypeScript), expo-router, expo-secure-store, expo-notifications |
| Backend (`backend/`) | Node.js + NestJS (TypeScript, ESM), JWT + bcrypt, class-validator, luxon (vremenske zone), @nestjs/schedule |
| Baza | PostgreSQL (Neon) + Prisma 7 |
| Hosting (kasnije) | Railway ili Render za backend, Neon za bazu |
| Prodavnice | Google Play ($25 jednokratno), App Store ($99/god) |

Repo je jedan (monorepo): `backend/` i `frontend/`.

## Pravila aplikacije (dogovoreno)

- Učionica ima **3 mesta u svakom trenutku** (kapacitet se računa po blokovima od 30 min). Cena je **500 din/h**, plaća se na licu mesta (nema online plaćanja).
- Rezervacija traje **1h ili 2h** (najkraće 1h). Početak može biti na **:00 ili :30** (npr. 9:30, 10:00, 10:30).
- Učenik ima **max 2h po danu** (zbir svih njegovih aktivnih rezervacija tog dana, dan po zoni `Europe/Belgrade`).
- Svako rezerviše **sa svog naloga, jedno mesto**. Ne može da ima dve rezervacije koje se preklapaju.
- Nova rezervacija ide u **PENDING**, profesorka je **ručno potvrđuje ili odbija**.
- Aktivne rezervacije (**PENDING** i **CONFIRMED**) zauzimaju mesto. **CANCELLED** oslobađa mesto.
- Učenik otkazuje **najkasnije 6h pre časa**, bez naplate. Posle toga mora da pozove profesorku.
- Profesorka **upisuje i otkazuje bilo kad**. Ručno upisane rezervacije idu odmah u CONFIRMED. Učenik može da nema nalog (`guestName`).
- Pri rezervaciji učenik upisuje **nivo škole (osnovna/srednja), razred (osnovna 1-8, srednja 1-4) i 1-3 oblasti** (slobodan unos), da profesorka pripremi zadatke.
- Učenik vidi samo broj slobodnih mesta, nikad imena drugih učenika.
- Profil: učenik menja ime i prezime. **Mejl se ne menja.** Promena lozinke traži trenutnu lozinku i dvaput uneta nova.
- Obavezno u aplikaciji (zahtev Apple-a): **brisanje naloga**.
- Vreme se u bazi čuva u UTC, prikazuje u zoni `Europe/Belgrade`.
- Uloge: `STUDENT` i `PROFESSOR`. Registracija uvek pravi `STUDENT`, a profesorku postavlja administrator u bazi (Prisma Studio ili seed).
- Naknadno (opciono): verifikacija mejla pri registraciji.

## Model podataka

Vidi `backend/prisma/schema.prisma`. Tabele:
- `User` (firstName, lastName, email, password hash, role, pushToken)
- `Availability` (radno vreme po danu u nedelji, 0 = nedelja ... 6 = subota, vreme na :00 ili :30)
- `TimeOff` (slobodni dani, period)
- `Booking` (student ili guestName, startAt, endAt, hours, price, status, schoolLevel, grade, topics[], note, createdBy)

Slobodni termini se **ne čuvaju**, nego se računaju: radno vreme minus slobodni dani, pa broj aktivnih rezervacija po bloku od 30 min naspram kapaciteta 3.

## API ugovor (dogovor između A i B)

Svi odgovori su JSON. Zaštićene rute traže `Authorization: Bearer <jwt>`.

| Ruta | Ko | Opis |
|---|---|---|
| `POST /auth/register` | svi | `{firstName, lastName, email, password}` → `{token, user}` |
| `POST /auth/login` | svi | `{email, password}` → `{token, user}` |
| `GET /me` | prijavljen | moji podaci |
| `PATCH /me/updateProfile` | prijavljen | `{firstName?, lastName?}` |
| `PATCH /me/changePassword` | prijavljen | `{currentPassword, newPassword, confirmPassword}` |
| `GET /me/getBookings?when=upcoming\|past\|all` | prijavljen | moje rezervacije (prošle uključuju otkazane) |
| `DELETE /me` | prijavljen | brisanje naloga (**TODO**) |
| `POST /me/push-token` | prijavljen | čuvanje Expo push tokena (**TODO**) |
| `GET /slots?date=YYYY-MM-DD` | prijavljen | blokovi od 30 min, vidi ispod |
| `POST /bookings` | prijavljen | `{startAt, hours, schoolLevel, grade, topics[], note?}` → rezervacija (PENDING) |
| `DELETE /bookings/:id` | učenik (2h pravilo), profesorka | otkazivanje (status CANCELLED) |
| `GET /admin/getAllBookings?status=` | profesorka | lista rezervacija, npr. `PENDING` za zahteve |
| `PATCH /admin/setBookingStatus/:id` | profesorka | `{status: "CONFIRMED" \| "CANCELLED"}` |
| `POST /admin/createManualBooking` | profesorka | ručni upis (`studentId` ili `guestName`), odmah CONFIRMED |
| `GET /admin/getSchedule?date=` | profesorka | po bloku od 30 min: ko dolazi, sa razredom i oblastima |
| `GET/PUT /admin/availability` | profesorka | radno vreme (`{items: [{weekday, startTime, endTime}]}`, PUT zamenjuje sve) |
| `GET/POST/DELETE /admin/time-off` | profesorka | slobodni dani (`{startAt, endAt}`); POST vraća i broj pogođenih rezervacija |

### `/slots`

Svaki element je mogući **početak** rezervacije:

```json
[{ "hour": "16:30", "startAt": "2026-11-09T15:30:00.000Z", "free": 2, "capacity": 3, "maxHours": 2 }]
```

- `free` je broj slobodnih mesta u tom bloku od 30 min.
- `maxHours` je najduža rezervacija koja može da počne tu: `0` (ne nudi se), `1` (samo 1h) ili `2` (1h ili 2h). Mobilna nudi trajanja na osnovu ovoga.
- Pri rezervaciji se šalje `startAt` iz odgovora.

### Greške

- `400` nevalidan unos ili termin nije dostupan
- `401` nije prijavljen
- `403` nema pravo (npr. učenik na `/admin`, ili otkazivanje kasnije od 2h)
- `409` `{message: "Termin je pun"}`, `"Maksimum je 2h po danu"` ili `"Već imaš rezervaciju u tom terminu"`

**Ako neko menja ugovor, javi drugom pre nego što pushuje.**

## Status rada

**Gotovo:** setup (Nest, Prisma, Neon), auth (register, login, JWT, guardovi), profil (`/me`, izmena, lozinka, `/me/bookings`), `GET /slots`.

**U radu:** učenička rezervacija (`POST /bookings`, `DELETE /bookings/:id`), profesorske rute (`/admin/bookings`, `/admin/schedule`, ručni upis).

**Ostaje (backend):**
1. Radno vreme i slobodni dani (`/admin/availability`, `/admin/time-off`)
2. `DELETE /me` i `POST /me/push-token`
3. Push notifikacije (potvrda/odbijanje) i podsetnik sat pre časa (cron, polje `reminderSentAt`)
4. Seed (profesorka, početno radno vreme)
5. Testovi (`slots`, `bookings`) u Vitestu
6. Deploy (hosting, env varijable, `prisma migrate deploy`, HTTPS)

**Ostaje (mobilna):** auth ekrani, zakazivanje, moji termini i profil, profesorski ekrani, push, ikonica i build.

## Ekrani

**Učenik** (donji meni: Zakaži / Moji termini / Profil)
1. Login i registracija
2. Zakaži: izbor datuma (narednih 14 dana), lista početaka (`/slots`), izbor trajanja (po `maxHours`), nivo škole i razred, oblasti (max 3), potvrda sa cenom
3. Moji termini: Predstojeći / Prošli, status, dugme Otkaži (samo ako je do časa više od 2h)
4. Profil: izmena imena, promena lozinke, odjava, brisanje naloga

**Profesorka** (donji meni: Raspored / Zahtevi / Podešavanja)
1. Raspored po danu (ko dolazi, razred, oblasti), ručni upis i otkazivanje
2. Zahtevi na čekanju: Potvrdi / Odbij
3. Podešavanja: radno vreme, slobodni dani, odjava

## Pokretanje (lokalno)

Potrebno: Node 20+, Postgres baza (Neon ili lokalni), Expo Go na telefonu.

```bash
cd backend
npm install
# napravi backend/.env sa DATABASE_URL i JWT_SECRET (vidi ispod)
npx prisma migrate dev --name init
npx prisma generate
npm run start:dev          # http://localhost:3000
```

`backend/.env` (ne ide u git):
```
DATABASE_URL="postgresql://...?sslmode=require"
JWT_SECRET=dugacak_nasumican_string
```

Prisma 7: konfiguracija je u `backend/prisma.config.ts`, klijent se generiše u `backend/src/generated/prisma` (ne ide u git), a `PrismaService` koristi `@prisma/adapter-pg`.

Svako koristi **svoju** razvojnu bazu (poseban Neon projekat ili branch), da ne gazite jedno drugom podatke.

Posle svake promene šeme: `npx prisma migrate dev --name opis`, pa `npx prisma generate`.

```bash
cd frontend
npm install
npx expo start
```

## Struktura backenda

Po funkciji (a ne po tipu fajla):

```
backend/src/
  auth/  users/  slots/  bookings/  admin/  prisma/
  config.ts          # kapacitet, cena, limiti, zona
```

## Git pravila

- `main` je uvek ispravan, niko ne pushuje direktno u njega.
- Grana po funkciji (`feature/bookings`, `feature/admin`...), pa Pull Request, drugi pregleda pre merge-a.
- Pre pravljenja nove grane: `git checkout main && git pull`.
- `prisma/schema.prisma` i `prisma/migrations/` menja **samo jedna osoba u jednom trenutku**; javi drugom pre izmene šeme. Migracije se commit-uju.
- `.env` se nikad ne commit-uje.

## Otvorena pitanja

- Početne vrednosti: radno vreme učionice, tačan spisak oblasti (slobodan unos za sada).
- Ko drži developer naloge (Play/App Store) i čije ime stoji kao izdavač.
- Cena održavanja i dogovor sa profesorkom (2-4 update-a godišnje, infrastruktura oko $100-250/god).
- Verifikacija mejla pri registraciji (kasnije).
- Trajanja od 1,5h (trenutno samo 1h i 2h).
