# Browser-based Apartment Intercom Handset

## Product definition

Build a private mobile web app for one friend who wants to use his phone as a browser-based apartment intercom handset.

### User flow

1. The user opens the web app and enters a shared access code.
2. The backend verifies the code and creates a short-lived secure session.
3. When the building intercom calls the configured virtual phone number, the web app displays an incoming call.
4. The user presses Answer and allows microphone access.
5. Two-way audio connects the phone browser to the intercom call.
6. The user presses Open door, causing the provider to send DTMF digit 5 into the active call.
7. The user presses Hang up, or the call ends remotely.
8. The session expires after the call or after a short timeout.

### Interface states

- Enter access code
- Waiting for intercom call
- Incoming call: Answer
- Connected: Open door and Hang up

### MVP scope

Include only:

- One intercom
- One configured virtual phone number
- One shared access code
- A short-lived secure session
- Browser microphone and two-way audio
- Incoming-call state updates
- Answer, Open door and Hang up
- DTMF digit 5
- Provider webhook verification
- Rate limiting for incorrect codes
- Minimal internal security logging

Do not include:

- User accounts or registration
- Password recovery
- Multiple users, roles or invitations
- Multiple intercoms
- Scheduled access
- User-facing call history
- Notifications
- Purchasing numbers through the app
- Fancy UI
- On-demand opening without an active intercom call

### Provider requirements

The phone provider must support:

- Receiving a normal phone call from the building intercom
- Bridging that call to browser-based two-way audio
- Sending DTMF into the active call
- Reporting call states through webhooks

Do not select a provider or assume its capabilities without checking current documentation.

## Agreed MVP decisions

- Use 46elks with the already tested fixed-number-to-WebRTC connection.
- Support one active user and one open browser client only.
- Require the page to remain open, awake and in the foreground; notifications are deferred.
- End authentication after every call or after a hard 30-minute timeout.
- Block a network address for 15 minutes after five incorrect codes in 15 minutes.
- Send door digit 5 using SIP INFO, which opened the real door during provider testing.
- Build with vanilla TypeScript and one Cloudflare Worker to keep hosting small and inexpensive.

## Local development

The project requires Node.js 24 LTS. Install dependencies, copy the placeholder
file to Cloudflare's ignored local-secret file, and fill the values locally:

```sh
npm install
cp .env.example .dev.vars
npm run dev
```

Never place credentials in `.env.example`, Git, issue text or chat. The app is
served at the local address printed by Vite. `localhost` is a secure browser
context, so it can request microphone access.

Before publishing, confirm with 46elks whether the browser credential can be
temporary or restricted. The documented WebRTC password must otherwise be sent
to an authenticated browser and can be inspected by that browser user.

For this MVP, the owner has accepted that limitation. Revisit temporary or
restricted provider credentials before expanding access beyond the one trusted
user.

### Provider callback configuration

Local live calls continue to use the fixed number's existing static
`voice_start` connection. After deployment, set `voice_start` to:

```text
https://<worker-host>/api/provider/incoming
```

Set `PROVIDER_CALLBACK_IPS` from the current 46elks callback-origin
documentation. The Worker rejects callbacks from other source addresses and
connects valid incoming calls to `PROVIDER_WEBRTC_NUMBER`.

## Checks

```sh
npm run check
npm test
npm run build
```
