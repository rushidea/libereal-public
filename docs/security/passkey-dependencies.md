# Passkey dependency contract

The application uses `@simplewebauthn/server` 13.3.2 and
`@simplewebauthn/browser` 13.3.0 with Node 20 or later. Server 13.3.2
fixes [GHSA-6hxq-p678-4hr2](https://github.com/advisories/GHSA-6hxq-p678-4hr2),
which allowed an attestation certificate chain to stop at an attacker-controlled
self-signed root instead of a configured trust anchor.

The application implements registration and verification in
`src/lib/security/passkey-service.ts`. Credentials keep their existing base64url
IDs and public keys; no database migration is needed. Browser calls use the
`optionsJSON` wrapper. Registration user handles retain their UTF-8 bytes.

`@auth/core` and `next-auth` still declare optional SimpleWebAuthn 9 peers.
Targeted overrides resolve both packages to the versions above. The application
uses custom Credentials authentication and does not enable Auth.js's WebAuthn
provider. Before enabling that provider, migrate and verify its own version 9
API calls; the overrides alone do not make those calls compatible with version 13.

Standard `npm ci` must succeed without `--force` or `--legacy-peer-deps`.
`npm ls @simplewebauthn/server @simplewebauthn/browser` must show a single
fixed server version with no vulnerable nested copy.

`src/test/passkey-certificate-chain.test.ts` exercises the real public certificate
helper using certificates generated only for the test. It accepts a legitimate
chain and rejects the attacker's self-signed root against an unrelated trust
anchor. No real credentials or private keys are stored in fixtures.
