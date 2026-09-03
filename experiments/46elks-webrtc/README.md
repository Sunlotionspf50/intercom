# 46elks feasibility test

This disposable page tests the provider's incoming WebRTC call, manual answer,
two-way audio, hangup, and DTMF support. It is not the application.

## Run locally

From this directory, run:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080> in a desktop browser. `localhost` is required
because browsers allow microphone access only from secure contexts (HTTPS or
localhost).

Enter the WebRTC username and the current rotated password, then select
**Register**. The password remains in browser memory for this test and is not
saved by the page. Never put it in this repository.

With the page registered, call the public fixed 46elks number from a separate
phone or the building intercom. Answer manually and test the two DTMF transports
one at a time. Record which one reaches the calling side or opens the door.

The page loads the same pinned JsSIP 3.10.0 browser library used by the current
46elks example, directly from the JsSIP project website.
