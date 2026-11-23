# Matletika — Reservation API

Backend for **Matletika**, a math-practice booking application. Students can browse available classroom sessions and request a place, while the professor manages reservations, working hours and time off. Sessions take place in a shared classroom, with up to three students at the same time.

> **Project status:** Backend MVP implemented; integration testing and mobile-app integration are ongoing.

## Tech stack

- **NestJS**, **TypeScript** — REST API
- **PostgreSQL** (Neon), **Prisma** — persistence and database access
- **JWT**, **Passport**, **bcrypt** — authentication and password security
- **class-validator**, **class-transformer** — request validation
- **Luxon** — date and time handling (`Europe/Belgrade`)
- **Nodemailer** — password-reset emails
- **Expo Push API** — mobile push notifications

## Features

### Student

- Register, log in and manage a profile
- Reset a forgotten password using a six-digit, time-limited email code
- View available times and remaining seats without seeing other students' details
- Book a **1- or 2-hour** session, choose school level and grade, and specify practice topics
- View upcoming, past or all personal reservations
- Cancel a reservation at least **6 hours** before the start
- Register or remove an Expo push token for notifications
- Delete an account after password confirmation

### Professor

- View all booking requests, filter by status and inspect a daily schedule
- Confirm or cancel bookings
- Create a manual booking for an existing student or guest
- Configure recurring weekly working hours
- Add or remove time-off periods
- Notify students when a reservation is confirmed or cancelled (when a push token is available)

### Booking rules

| Rule | Implementation |
| --- | --- |
| Capacity | Maximum **3** students in each overlapping 30-minute block |
| Duration | **1 or 2 hours** |
| Student booking start | On the hour or half-hour (`:00` / `:30`) |
| Daily limit | Maximum **2 hours** per student |
| Overlapping reservations | Prevented for the same student |
| Cancellation | Students must cancel at least **6 hours** before the session; professor can cancel independently |
| Initial status | Student requests are `PENDING`; manual professor bookings are `CONFIRMED` |
| Availability | Calculated from weekly working hours, time off and non-cancelled reservations |
| Price | **1,000 RSD/hour**, configured in `src/config.ts` |

Student booking creation rechecks working hours, student booking limits and classroom capacity inside a PostgreSQL transaction protected by a day-based advisory lock. Concurrent changes to working hours or time off still require coordinated locking to eliminate all race conditions.

## API endpoints

All routes except authentication require `Authorization: Bearer <token>`.

### Authentication — public

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Register a student |
| `POST` | `/auth/login` | Log in; receive a JWT and user details |
| `POST` | `/auth/forgot-password` | Request a password-reset code by email |
| `POST` | `/auth/reset-password` | Reset password with the received code |

### Student / authenticated account

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/me` | Current user profile |
| `PATCH` | `/me/updateProfile` | Update first and/or last name |
| `PATCH` | `/me/changePassword` | Change password |
| `DELETE` | `/me` | Delete student account (requires password) |
| `GET` | `/me/getBookings?when=upcoming\|past\|all` | View own bookings |
| `POST` | `/me/push-token` | Save Expo push token |
| `DELETE` | `/me/push-token` | Remove Expo push token |
| `GET` | `/slots?date=YYYY-MM-DD` | View availability for a date |
| `POST` | `/bookings` | Request a reservation |
| `DELETE` | `/bookings/:id` | Cancel a reservation |

### Professor only — `PROFESSOR` role

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/admin/getAllBookings?status=PENDING` | View bookings; optional status filter |
| `PATCH` | `/admin/setBookingStatus/:id` | Confirm or cancel a booking |
| `POST` | `/admin/createManualBooking` | Create a booking for a student or guest |
| `GET` | `/admin/getSchedule?date=YYYY-MM-DD` | View daily schedule |
| `GET` | `/admin/availability` | Get weekly working hours |
| `PUT` | `/admin/availability` | Replace weekly working hours |
| `GET` | `/admin/time-off` | List upcoming time-off periods |
| `POST` | `/admin/time-off` | Add a time-off period |
| `DELETE` | `/admin/time-off/:id` | Remove a time-off period |

### Example: create a booking

```http
POST /bookings
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "startAt": "2026-12-01T16:00:00+01:00",
  "hours": 1,
  "schoolLevel": "SECONDARY",
  "grade": 2,
  "topics": ["Quadratic equations"],
  "note": "Practice for an upcoming test"
}
```

A successful request creates a booking with an initial status of `PENDING`. The professor can subsequently confirm or cancel it.

### Example: available slots

```http
GET /slots?date=2026-12-01
Authorization: Bearer <token>
```

Each returned slot includes `hour` (Belgrade local time), `startAt` (UTC ISO timestamp), `free`, `capacity` and `maxHours`. A `maxHours` value of `0` means a full 1-hour session cannot start at that time.

## Getting started

**Prerequisites:** Node.js, npm and a PostgreSQL database.

1. Install dependencies from the backend project root:

   ```bash
   npm install
   ```

2. Configure your environment variables in `.env` (see the project's environment template, if present):

   ```dotenv
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
   JWT_SECRET="replace-with-a-long-random-secret"

   # For password-reset emails (optional in local development)
   SMTP_HOST=""
   SMTP_PORT="587"
   SMTP_USER=""
   SMTP_PASS=""
   MAIL_FROM=""
   ```

3. Apply the Prisma database schema and generate the client using the migrations/configuration provided by the full repository:

   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. Start the development server:

   ```bash
   npm run start:dev
   ```

   Default address: `http://localhost:3000`.

> **Repository note:** When SMTP is not configured, the current development implementation logs reset codes instead of sending an email.

## Project structure

```text
src/
├── admin/           # Professor dashboard, schedule, working hours and time off
├── auth/            # Registration, login, JWT and password reset
├── bookings/        # Booking creation, cancellation and validation
├── generated/       # Generated Prisma client
├── mail/            # Transactional email service
├── notifications/   # Expo push delivery and reminder job
├── prisma/          # PrismaService and module
├── slots/           # Availability calculation
├── users/           # Profiles, personal bookings and account management
├── app.module.ts    # Root NestJS module
├── config.ts        # Booking limits, capacity, pricing and time zone
└── main.ts          # Application bootstrap
```

## Current status and next steps

**Implemented in the reviewed backend source:** authentication and password reset; account management; slot calculation; booking creation and cancellation; professor booking management; weekly availability and time-off management; Expo push sending and reminder-job code.

**Still to verify or finish:** automated and end-to-end tests; end-to-end push-notification delivery and scheduled reminder execution; frontend integration; deployment and production configuration.

## Mobile application

The API is designed for a **React Native / Expo** mobile client with separate student and professor experiences. The mobile frontend is being developed alongside the backend.
