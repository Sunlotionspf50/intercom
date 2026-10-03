# Apartment Intercom Door Access

## Product definition

Build a private mobile web app that arms a temporary automatic apartment-door opening window.

### User flow

1. The user opens the web app and enters a shared access code.
2. The backend verifies the shared code and starts a two-minute secure access window.
3. The user may close the browser; the access window remains active on the server.
4. When the building intercom calls during the active access window, the provider plays DTMF digit 5 into the call automatically.
5. The access window is consumed when the door signal is requested.
6. If no access window is active, the call is forwarded to the owner's mobile number.
7. If no intercom call arrives, the access window expires after two minutes.

### Interface states

- Enter access code
- Timer active and waiting for the intercom

### MVP scope

Include only:

- One intercom
- One configured virtual phone number
- One shared access code
- One owner mobile fallback number when no access window is active
- A two-minute secure access window
- Server-side automatic call answer and DTMF door signal
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
- Sending DTMF into the active call
- Reporting call states through webhooks

Do not select a provider or assume its capabilities without checking current documentation.

## Agreed MVP decisions

- Use 46elks with its webhook-controlled call actions.
- Support one active access window.
- Allow the page to close after the access window starts.
- End the access window when a call claims it for the door signal or after a hard 2-minute timeout.
- The newest timer replaces the previous access window.
- Forward incoming calls to the owner's mobile when no active access window exists.
- Return the provider's `sound/dtmf/5` action for active calls.
- Block a network address for 15 minutes after five incorrect codes in 15 minutes.
- The direct provider DTMF action still needs physical testing with the intercom; the earlier SIP INFO test was browser-based.
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
served at the local address printed by Vite. The page only starts and displays
the server-side access window; it does not need microphone, audio or WebRTC
access.

### Provider callback configuration

Local live calls continue to use the fixed number's existing static
`voice_start` connection. After deployment, set `voice_start` to:

```text
https://<worker-host>/api/provider/incoming
```

Set `PROVIDER_CALLBACK_IPS` from the current 46elks callback-origin
documentation. The Worker rejects callbacks from other source addresses. It
returns the `sound/dtmf/5` action when an access window is active; otherwise it
connects the call to `OWNER_PHONE_NUMBER`.

The owner-mobile path remains the fallback when no timer is active. The
server-side DTMF action must be tested against the actual intercom before the
old WebRTC number and credentials are cancelled.

## Checks

```sh
npm run check
npm test
npm run build
```
