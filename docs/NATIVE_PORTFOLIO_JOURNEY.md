# Native portfolio journey - local review candidate

Base: f201851e397f9ab134c82354b75daea732c91cee. No release is claimed by this note.

The original 25 October v0.2 Preview brief requires one recorded portfolio with Overview,
Assets, DeFi and Risk & Return. The reviewed recorded-data components were previously
mounted only on excluded development pages. This candidate mounts those same components
on /account/overview, /account/assets, /account/defi and /account/risk.

This is an intentional URL adaptation from the brief's /portfolio/overview: /portfolio/*
is the protected legacy address-list family. Reusing it would change the separately reviewed
Access boundary. /account remains Addresses & Wallets with existing explicit migration,
lookup and saved-address behavior. The legacy list and ownership bridge remain unchanged.
No Access policy, authentication guard, API, provider, database, schema, entitlement or flag
is changed. New views use existing permitted recorded snapshots. Page load does not start a
chain read. Recording and Refresh remain explicit user actions, using existing controls.

Returning native sessions and default successful sign-in lead to the actual Overview.
The welcome transition starts only from an intentional entry action, lasts 650 ms, can be
skipped, and is bypassed for reduced motion. It does not create a session or grant access.
Settings and the old onboarding prototype no longer describe an unbuilt native entrance.
The former prototype route now shows functional native sign-in and account-creation choices. No wallet connector is implied.

On phone, Overview / Assets / DeFi / More / Settings stay in the bottom bar. More includes
Risk & Return, Addresses & Wallets, Markets, Education and the explicit legacy list.
Desktop DeFi's wide table has its own keyboard-focusable horizontal scroll region.

Verification scope: local production static export; actual recorded-view handler responses
from SQLite-backed synthetic accounts; explicit malformed, empty, unauthorized, refresh,
withdrawal race, route, email-form and reduced-motion cases. All example holdings in those
screenshots are synthetic test inputs, not observed user balances or production acceptance.
No external financial provider requests, OTP sends, account writes or deployment occurred.

Still separate: real-device passkey ceremonies, customer wallet connector and wallet route
mounts, contract-wallet verification, all-device session controls/recovery acceptance,
Markets reliability, website converter, and broader original-brief acceptance cases.
