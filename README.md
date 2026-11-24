# Matletika — Reservation API

Matletika is a math practice booking application. Students can view available time slots and book sessions, while the professor manages reservations and working hours. Up to three students can attend a session at the same time.

This repository contains the backend API. The mobile app is still in development.

## Tech stack

- **NestJS** and **TypeScript**
- **PostgreSQL** (Neon) and **Prisma**
- **JWT** authentication and **bcrypt** for password hashing
- **class-validator** for request validation
- **Luxon** for date and time handling
- **Nodemailer** for password reset emails
- **Expo Push API** for notifications

## Features

**Students can:**
- Register, log in, update their profile and reset their password
- View available time slots and remaining seats
- Book 1-hour or 2-hour sessions
- View and cancel their reservations
- Receive push notifications about reservation updates

**The professor can:**
- View, confirm and cancel reservations
- Create reservations manually
- Set working hours and time off
- View the daily schedule

### Booking rules

- Maximum **3 students** at the same time
- Sessions last **1 or 2 hours** and start on the hour or half-hour
- Each student can book up to **2 hours per day**, without overlapping reservations
- Students can cancel up to **6 hours before** a session
- New student reservations have `PENDING` status until the professor confirms them
- Available time slots are calculated using working hours, time off and existing reservations

## API endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Register |
| `POST` | `/auth/login` | Log in |
| `POST` | `/auth/forgot-password` | Request password reset |
| `POST` | `/auth/reset-password` | Reset password |
| `GET` | `/me` | Get profile |
| `PATCH` | `/me/updateProfile` | Update profile |
| `PATCH` | `/me/changePassword` | Change password |
| `DELETE` | `/me` | Delete account |
| `GET` | `/me/getBookings?when=upcoming\|past\|all` | Get personal bookings |
| `POST`, `DELETE` | `/me/push-token` | Save or remove push token |
| `GET` | `/slots?date=YYYY-MM-DD` | Get available slots |
| `POST` | `/bookings` | Create booking |
| `DELETE` | `/bookings/:id` | Cancel booking |
| `GET` | `/admin/getAllBookings` | View all bookings |
| `PATCH` | `/admin/setBookingStatus/:id` | Confirm or cancel booking |
| `POST` | `/admin/createManualBooking` | Create manual booking |
| `GET` | `/admin/getSchedule?date=YYYY-MM-DD` | View daily schedule |
| `GET`, `PUT` | `/admin/availability` | Manage working hours |
| `GET`, `POST` | `/admin/time-off` | View or add time off |
| `DELETE` | `/admin/time-off/:id` | Remove time off |

All endpoints except authentication require a JWT bearer token. Admin routes are available only to the professor.

## Getting started

You'll need Node.js, npm and a PostgreSQL database.

From the `backend/` folder:

```bash
npm install
```

Create a `.env` file and set your database connection and JWT secret (along with any other environment variables required by your configuration):

```env
DATABASE_URL="your-postgresql-connection-string"
JWT_SECRET="your-jwt-secret"
```

Apply migrations, generate the Prisma client and start the server:

```bash
npx prisma migrate dev
npx prisma generate
npm run start:dev
```

The API runs at `http://localhost:3000` by default.

## Project status

The first version of the backend is implemented. Testing and the React Native / Expo mobile app are still in progress.
