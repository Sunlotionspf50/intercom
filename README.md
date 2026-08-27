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
