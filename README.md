# Matletika Reservation API

REST API for a mobile app (React Native / Expo) that lets students book math practice sessions in a classroom. The professor is present during the session, so students can ask questions. The professor confirms or rejects each request manually.

> Work in progress. See [Status](#status).

## Tech stack

- **NestJS** (TypeScript), REST API
- **PostgreSQL** (Neon) with **Prisma 7**
- **JWT** authentication, **bcrypt** password hashing, **class-validator** for input validation
- **luxon** for time zones (stored in UTC, displayed in `Europe/Belgrade`)
- **Vitest** for unit and e2e tests

## Key features

- Role-based access (`STUDENT`, `PROFESSOR`) with guards
- Availability computed on the fly (working hours minus time off, minus active bookings per 30-minute block, capacity 3)
- Booking rules enforced server-side: 1h or 2h sessions, starts at :00 or :30, max 2h per student per day, no overlapping bookings, cancellation allowed up to 6h before the session
- Students only see the number of free seats, never other students' names
- Booking lifecycle: `PENDING` → `CONFIRMED` / `CANCELLED`
- Forgotten-password flow
- Email-based password reset
- Push notifications (Expo)


## API overview

| Route | Access | Description |
|---|---|---|
| `POST /auth/register`, `POST /auth/login` | public | Returns `{ token, user }` |
| `GET /me`, `PATCH /me/updateProfile`, `PATCH /me/changePassword` | authenticated | Profile management |
| `GET /me/getBookings?when=upcoming\|past\|all` | authenticated | My bookings |
| `GET /slots?date=YYYY-MM-DD` | authenticated | Bookable start times with free seats |
| `POST /bookings`, `DELETE /bookings/:id` | authenticated | Create / cancel a booking |
| `GET /admin/getAllBookings`, `PATCH /admin/setBookingStatus/:id` | professor | Review requests |
| `POST /admin/createManualBooking`, `GET /admin/getSchedule` | professor | Manual entry, daily schedule |

Protected routes require `Authorization: Bearer <jwt>`.

## Getting started

Requirements: Node 20+, a PostgreSQL database.

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npx prisma migrate dev
npx prisma generate
npm run start:dev           # http://localhost:3000
```

## Tests

```bash
npm run test
npm run test:e2e
```

## Status

**Done:** project setup, auth (register, login, JWT, guards), profile endpoints, forgotten-password flow, `GET /slots`

**In progress:** booking creation/cancellation, professor endpoints, push notifications and reminders

**Planned:** working hours and time-off management, account deletion, seed data, deployment

## Project structure

```
src/
  admin/          # professor endpoints
  auth/           # register, login, JWT, forgotten password
  bookings/       # create / cancel bookings
  mail/           # transactional emails (password reset)
  middleware/
  notifications/  # push notifications
  slots/          # availability calculation
  users/          # profile
  prisma/         # PrismaService
  config.ts       # capacity, price, limits, time zone
```

The mobile app lives in `frontend/` (React Native + Expo).