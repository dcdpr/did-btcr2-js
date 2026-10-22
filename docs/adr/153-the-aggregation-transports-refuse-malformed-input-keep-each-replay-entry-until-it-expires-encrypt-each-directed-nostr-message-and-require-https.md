# ADR 153: The Aggregation Transports Refuse Malformed Input, Keep Each Replay Entry Until It Expires, Encrypt Each Directed Nostr Message, and Require HTTPS

- **Status:** Accepted
- **Date:** 2026-10-21
- **Packages:** `@did-btcr2/aggregation` (MINOR: the three transports refuse input that they accepted before. `NonceCache`, `InboxBuffer`, `verifyEnvelope`, `parseSseStream`, and the Nostr send rules change, and `HttpClientTransport` refuses a plain http base URL); `@did-btcr2/method` (PATCH: the JSDoc of `resolveBtcr2SenderPk` in the shipped `src` changes; no code change)

## Context

The aggregation package has three network transports. `HttpServerTransport` serves the service, `HttpClientTransport` serves a participant, and `NostrTransport` serves both roles. Before this change, these transports had seven defects. The same code also had old defects.

### Malformed input stopped the service process

`#bootstrapSenderPk` revived and flattened the message of an envelope before any key check, with no try block. `flattenMessage` read `msg.body` with no null check.

Example: a server has `resolveSenderPk` set. A request with no signature posts `{"from":"x","message":null}` to `POST /v1/messages`. `handleRequest` rejected with a `TypeError`, and the `node:http` adapter of the demo does not catch a rejection. Thus one request stopped the service process. A body with no `message`, a `__bytes` value that is not hex, and the body `5` had the same result.

Three other inputs had a result of the same class:

- The request target `http://[`. Node gives it to the adapter in `req.url`, and `extractPath` threw in `handleRequest` and in `handleSse`.
- A nested message of about 60,000 characters under the body limit of 64 KiB. Under Node, `reviveFromWire` threw a `RangeError`.
- On Nostr, a public kind 1 event with the content `null`. Both receive paths rejected, and Node 24 stopped the process with exit code 1. The relay pool calls `onevent` and does not catch a rejection.

The HTTP client closed the stream for a malformed event, and it connected again. A broadcast handler that rejected gave an unhandled rejection, and Node stops the process at an unhandled rejection.

### The replay cache lost live entries

The server stored `(from, nonce)` before the rate limiter, in one FIFO map of 10,000 entries for all senders. An entry had no expiry, and a new entry deleted the oldest entry.

Example: a server injects `resolveBtcr2SenderPk`, so it accepts each self-minted k1 DID. A victim posts an envelope (202), and a replay of it gets 409. An attacker DID then sends 10,001 fresh envelopes. 30 envelopes get 202 and 9,971 get 429, but each one stores its nonce. A replay of the victim envelope inside its skew window then got 202.

`verifyEnvelope` did not check the nonce, so the server stored a nonce of 60,000 characters. A `timestamp` that is not a number gave a `NaN` difference, and `NaN > skewSec` is false. Thus a replay of such an envelope always passed the skew check. The verify calls of the POST routes also read `Date.now`, not the injected clock of the server.

ADR 029 says that the server "rejects replayed `(from, nonce)` pairs".

### A retained message expired before delivery

The server signed each inbox event one time, at `sendMessage`. The client applies the skew check (`clockSkewSec`, default 60 s) to each envelope that it gets.

Example: a participant reconnects 90 s after the service sent COHORT_READY. The server sends the retained event, and the client drops it with `ENVELOPE_TIMESTAMP_SKEW`. The cohort then stalls, or it continues without this member. A local advert had the same defect: a subscriber dropped an advert that the server published 120 s before the subscribe (TTL 300 s).

The client also sent no `Last-Event-ID`. Thus each reconnect got each retained event again, and the client dispatched a recent message again. After a stream end, the client connected again at once. A stream that ended at once gave 1,000 inbox requests in 1,386 ms.

The inbox event ids were `1`, `2`, and so on. A new buffer after a server restart started again at `1`. Thus an old id `57` hid the first 57 events of the new buffer.

### Nostr published directed messages as plaintext

`NostrTransport` sent COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, and COHORT_READY as public kind 1 events with plaintext JSON. Each event had a `t` tag with the message type. A kind 1059 event also had this tag.

Example: an x1 participant opts in over Nostr. Its opt-in holds the full genesis document, so each relay and each subscriber got the genesis document and its link to the cohort. A member that declined an update sent SUBMIT_NONINCLUDED as kind 1059, but the `t` tag showed the type. For a k1 member, the event key gives the DID, so a relay saw the update decision of the DID.

### The HTTP client accepted a plain http URL

The constructor parsed `baseUrl` and did not check the protocol.

Example: `new HttpClientTransport({ baseUrl: 'http://aggregator.example/' })` succeeded. Signed updates, MuSig2 nonces, and partial signatures then went over the network as plaintext. `ftp://svc.example/` also succeeded, and `'not a url'` threw a raw `TypeError`. Fetch follows a redirect by default. Thus a 307 or a 308 answer to an http URL sent the signed body again as plaintext.

### The SSE parser had no size limit

`parseSseStream` kept the unterminated line as text, with no limit. It also scanned its full buffer again at each read, so the parse time grew with the square of the line length.

Example: a hostile server, or a party between the client and a plain http server, sends one `data:` line with no line end. The parser buffer grows to about 1.6 GiB. With a heap of 192 MiB, the process aborts with exit code 134.

At the end of the stream, the parser also gave an incomplete event to the caller.

### The transport key of a DID is its genesis key

`resolveBtcr2SenderPk` gives the key of a k1 DID from the DID string. For an x1 DID, it gives the key of `capabilityInvocation[0]` of the genesis document. It reads no current DID document, and a peer registry entry has no expiry.

Example: a k1 DID D has the genesis key K0. After a leak of K0, the controller rotates to K1. An opt-in that K0 signs for D gets 202, and an opt-in that K1 signs gets 401.

### Old defects in the same code

This change also fixes these defects:

1. **The outer body.** Each flatten (Nostr, HTTP client, HTTP server) copied the members of `body` to the top level with `{ ...msg, ...msg.body }`. A `body` member inside `body` then replaced the outer `body`. The transport checked the `communicationPk` of the outer body, but a state machine read the key of the inner body.
2. **The `__proto__` member.** `reviveFromWire` assigned each member. For a member named `__proto__`, the assignment set the prototype of the result. The `communicationPk` check of an advert then found no key, but a reader of the message found the inherited key.
3. **Fetch with a `this` value.** `HttpClientTransport` called fetch with the transport as `this`. A browser fetch then threw a `TypeError` (Illegal invocation).
4. **An advert with a recipient.** `POST /v1/adverts` and the broadcast path of the client accepted an envelope with a `to` member. A recipient can post an inbox envelope of an actor as an advert. The server then sent it to each broadcast subscriber as the current advert, and each client accepted it.
5. **The body of a failed POST.** `sendMessage` read the full body of a failed answer. A body that does not end filled the memory: 8 GiB in 10 s.
6. **The logger in a catch.** The `publishRepeating` catches of the HTTP client and of Nostr called `logger.debug` directly. A logger that throws then gave an unhandled rejection.
7. **A copy of the local advert.** `GET /v1/adverts` gives the local advert envelope to each party. A POST of that envelope replaced the local advert, and the stop function of `publishRepeating` then did not remove the copy.

### Examples

| Case | Before | After |
|---|---|---|
| `POST /v1/messages` with `{"from":"x","message":null}` and `resolveSenderPk` set | `handleRequest` rejects. The demo process stops. | 400 `malformed_envelope`. |
| A Nostr kind 1 event with the content `null` | Two unhandled rejections. Node 24 stops with exit code 1. | The transport drops the event with a debug line. |
| 10,001 fresh envelopes of one DID, then a replay of a victim envelope | The replay gets 202. | The throttled envelopes store no nonce. The replay gets 409. |
| A nonce of 60,000 characters | 202. The server stores the nonce. | 401 `invalid_envelope` (`ENVELOPE_NONCE_INVALID`). |
| A participant reconnects 90 s after COHORT_READY | The client drops the event (`ENVELOPE_TIMESTAMP_SKEW`). | The server signs the event again, and the client dispatches it one time. |
| A reconnect after a dispatched inbox event | The server sends each retained event again. | The client sends `Last-Event-ID`, and the server sends only the later events. |
| An x1 opt-in over Nostr | A public kind 1 event with the genesis document. | A kind 1059 event with NIP-44 v2 content and two `p` tags. |
| `new HttpClientTransport({ baseUrl: 'http://aggregator.example/' })` | The constructor accepts it. | `INSECURE_BASE_URL`. |
| A 308 answer to an http URL | Fetch sends the signed body again. | `SEND_MESSAGE_HTTP` with the status 308. |
| One `data:` line of 2 GiB, `maxSseEventBytes` 1 MiB | The process aborts. | `SSE_EVENT_TOO_LARGE`. The client connects again after the backoff delay. |

### The normative specification texts

- Security Considerations, Invalidation Attacks (`appendix/security-considerations.md:14`): "Due to the requirement for processing all relevant Beacon Signals, if these updates cannot be retrieved by a resolver, the DID MUST be considered invalid."
- Security Considerations, Data Retention (`appendix/security-considerations.md:20`): "DID controllers SHOULD consider that in some constrained environments it is preferable to discard a DID and replace it with a newly issued DID, rather than rotating a key."
- Conformance (`conformance.md:8`): "Everything else in this specification is normative." The specification does not mark the appendix as non-normative. Thus the SHOULD texts of the security considerations are normative, as ADR 152 records.

### The texts with no requirement

- Security Considerations, Key Compromise (`appendix/security-considerations.md:32`): "Should these keys get compromised without the DID controller's knowledge, it would be possible for an adversary to take control of a DID by submitting a BTCR2 Update to a BTCR2 Beacon that replaces key material and BTCR2 Beacons in the DID document for ones under the adversary's control." The word "Should" is not in all capitals, so the text has no BCP 14 keyword. It describes a threat and sets no transport rule.
- Privacy Considerations, DID Documents Can Be Private (`appendix/privacy-considerations.md:16`): "To keep the DID document fully private, the DID controller can choose to use an externally resolved initial did:btcr2 identifier and not place the initial DID document on a Content Addressable Storage (CAS) system such as the InterPlanetary File System (IPFS)." The text describes an option of the controller.
- Privacy Considerations, Aggregation Services Only Need Hashes (`appendix/privacy-considerations.md:24`): "However, in did:btcr2, aggregators are able to coordinate Beacon Signals without needing to view or validate DID documents or the updates." The text describes a capability.

### The illustrative example

`beacons/aggregate-beacons.md:12`: "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration." Conformance (`conformance.md:8`): "All sections marked as non-normative, as well as all authoring guidelines, diagrams, examples, and notes in this specification are non-normative." Thus these texts of the example are illustrative:

- `beacons/aggregate-beacons.md:20`: "An Aggregation Cohort may fail if Aggregation Participants stop participating or the Aggregation Service is compromised."
- `beacons/aggregate-beacons.md:50`: "Advertising Aggregation Cohorts to participants can be done with Nostr or DIDComm."
- `beacons/aggregate-beacons.md:63`: "All Aggregation Participants must be made aware of each opportunity because every participant must respond for the Aggregation Service to broadcast Beacon Signals."
- `beacons/aggregate-beacons.md:88`: "This response SHOULD be sent over a secure communication channel and MAY be signed."

The specification defines no aggregation transport. This change follows the SHOULD of `beacons/aggregate-beacons.md:88`, but no rule of this change depends on it.

### Other standards

- HTML, 9.2.4 The `Last-Event-ID` header: "It is essentially any UTF-8 encoded string, that does not contain U+0000 NULL, U+000A LF, or U+000D CR."
- HTML, 9.2.6 Interpreting an event stream:
  - "The UTF-8 decode algorithm strips one leading UTF-8 Byte Order Mark (BOM), if any."
  - "When a stream is parsed, a data buffer, an event type buffer, and a last event ID buffer must be associated with it. They must be initialized to the empty string."
  - "Once the end of the file is reached, any pending data must be discarded. (If the file ends in the middle of an event, before the final empty line, the incomplete event is not dispatched.)"
  - The `id` field: "If the field value does not contain U+0000 NULL, then set the last event ID buffer to the field value. Otherwise, ignore the field."
  - The dispatch, step 1: "Set the last event ID string of the event source to the value of the last event ID buffer." Step 2: "If the data buffer is an empty string, set the data buffer and the event type buffer to the empty string and return."
- W3C Secure Contexts (Candidate Recommendation Draft, 10 November 2023), 3.1:
  - "If origin’s host matches one of the CIDR notations 127.0.0.0/8 or ::1/128"
  - The name step starts with "If the user agent conforms to the name resolution rules in", then a reference to [let-localhost-be-localhost]. Its two cases are these texts:

    > origin’s host is "localhost" or "localhost."

    > origin’s host ends with ".localhost" or ".localhost."

  - 5.2: "For better or worse, resolvers often ignore these suggestions, and will send localhost to the network for resolution in a number of circumstances."
- Fetch, the `Request` constructor: "If parsedURL includes credentials, then throw a TypeError." The redirect mode `"manual"`: "Retrieves an opaque-redirect filtered response when a request is met with a redirect, to allow a service worker to replay the redirect offline."
- Cloudflare workerd, `src/workerd/api/http.c++` lines 481 to 485 (main at commit `0de84962`, read on 2026-10-21). The error text of the Workers fetch for each other redirect mode:

  > Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).
- NIP-44, Encryption, step 4: "Validate plaintext length. Minimum is 1 byte, maximum is 4,294,967,295 bytes". Also: "If length is less than 65536: prefix is 2 bytes (`u16`), format is `[plaintext_length: u16][plaintext][zero_bytes]`". Implementation considerations: "Implementations SHOULD enforce their own maximum payload size based on platform and resource constraints, rejecting oversized payloads early in `decode_payload` (before base64 decoding) to prevent denial-of-service."
- NIP-59, Other Considerations: "To protect recipient metadata, relays SHOULD guard access to `kind 1059` events based on user AUTH."
- RFC 9110, 15.5.1: "The 400 (Bad Request) status code indicates that the server cannot or will not process the request due to something that is perceived to be a client error (e.g., malformed request syntax, invalid request message framing, or deceptive request routing)." 15.5.10: "The 409 (Conflict) status code indicates that the request could not be completed due to a conflict with the current state of the target resource." 15.6.1: "The 500 (Internal Server Error) status code indicates that the server encountered an unexpected condition that prevented it from fulfilling the request."
- RFC 6585, 4: "The 429 status code indicates that the user has sent too many requests in a given amount of time ("rate limiting")."

## Decision

### 1. The server refuses malformed input and never rejects

The two POST routes check the body before they read its fields:

- No body, a body that does not parse as JSON, and `null` get 400 `{ error: 'invalid_json' }`.
- Each other JSON value must have the envelope shape: an object (not an array) with a non-empty string `from` and an object `message` (not an array). Else the answer is 400 `{ error: 'malformed_envelope' }`. Thus `0`, `false`, and `""` get `malformed_envelope`. Before, they got `invalid_json`.

`isEnvelopeShape` and `isValidNonce` are in the new module `core/transport/http/wire-checks.ts`. No barrel exports this module, so neither function is public API. The client uses the same shape check (decision 6).

If `reviveFromWire` throws for the message of a verified envelope, the answer is 400 `{ error: 'malformed_message' }`. An example is a `__bytes` value that is not hex. On the x1 bootstrap path, the same throw gives 401 `{ error: 'unknown_sender' }`, because the bootstrap gets the sender key from that message. For a message that is too deep for the signature check of a resolved sender, the server catches the throw of the verify call, and the answer is 401 `invalid_envelope`.

`extractPath` returns `undefined` for an absolute request target that does not parse as a URL. `handleRequest` then answers 404 `{ error: 'not_found' }`, and `handleSse` closes the stream. The server writes no error line for this case.

`handleRequest` catches each other throw. It writes a `logger.error` line and answers 500 `{ error: 'internal_error' }`. An example is a throw of the injected `resolveSenderPk`. The 500 path builds the CORS headers inside a try, and a logger throw does not leave the 500 path. Thus `handleRequest` never rejects, also for a request with no headers object.

`handleSse` catches each throw. It writes a `logger.error` line and closes the stream. The close runs the `onClose` cleanup of a subscriber that the method added. Thus `handleSse` never throws.

The answer order of `POST /v1/messages`:

1. 413 `payload_too_large`, 400 `invalid_json`, and 400 `malformed_envelope`.
2. 401 `unknown_sender` or 401 `invalid_envelope`: the sender key and the envelope verification.
3. 409 `replay` and 429 `rate_limited` (decision 2).
4. 400 `missing_recipient`, 404 `unknown_recipient`, 400 `malformed_message`, 401 `sender_mismatch`, and 400 `missing_message_type`.

The answer order of `POST /v1/adverts`: 413 `payload_too_large`, 400 `invalid_json`, 400 `malformed_envelope`, 401 `unknown_sender`, 401 `invalid_envelope`, 409 `local_advert` (decision 4), 409 `replay`, 429 `rate_limited`, 403 `not_an_actor`, 400 `malformed_message`, and 401 `sender_mismatch`.

A failed verification on `POST /v1/adverts` now gets a `logger.debug` line, as on `POST /v1/messages`. An inbox subscription that the replay lookup or the rate limiter refuses also gets a `logger.debug` line. The status codes of these cases do not change.

### 2. The replay cache keeps each entry until it expires

**The order.** The three authenticated routes are `POST /v1/messages`, `POST /v1/adverts`, and the inbox GET. After the verification of the envelope or the auth header, each route uses this order:

1. The replay lookup: `NonceCache.has(did, nonce, nowSec)`. If a live entry exists, the request is a replay: 409 `{ error: 'replay' }`, or a closed inbox stream. The lookup stores nothing and uses no token.
2. The rate limiter: 429 `{ error: 'rate_limited' }`, or a closed inbox stream. A throttled request stores no nonce, so its sender can send it again after the refill.
3. The nonce store: `store(did, nonce, nowSec + 2 * clockSkewSec, nowSec)`.

Thus a replay uses no token of its sender. With the order "rate limiter, then store", 40 replays of a captured envelope got 29 x 409 and 11 x 429. The next fresh envelope of the victim then got 429. With the order of this decision, the 40 replays got 409, and the fresh envelope got 202.

**One clock value.** The server reads its clock (`HttpServerTransportConfig.now`) one time for each request. The skew check, the replay cache, the rate limiter, the advert TTL, and each envelope that the server signs use that value. Before, the verify calls of the POST routes and of the x1 bootstrap read `Date.now`. Thus the verify call and the cache now always use the same second.

**The entry life.** An entry expires at the second `nowSec + 2 * clockSkewSec` of its store (120 s by default). `has` treats an entry as live while its expiry is at or after the current second. `verifyEnvelope` refuses only a difference above `clockSkewSec`, so an envelope with the timestamp T passes until the second T + `clockSkewSec`. At the store, T is at most `nowSec + clockSkewSec`, so T + `clockSkewSec` is at most the expiry. Thus the entry is live for each second in which a replay can pass the skew check, also at the boundary second.

**The purge.** `store` deletes the expired entries from the head of the map, and it stops at the first live head. The expiry that the server gives does not decrease, so the head is the entry that expires first. If the clock steps back, the purge of some expired entries comes later, and `has` treats each expired entry as absent. `store` also deletes an old entry for the same key, so the new entry goes to the tail.

**A full cache.** If the cache holds `maxEntries` live entries, `store` deletes the head and returns `'evicted'`. The deleted entry is the live entry that expires first. The server then writes at most one `logger.warn` line in each `clockSkewSec` window. The line gives the count of evictions since the previous line. A clock step back starts a new window, so the server does not stay silent for the size of the step. A replay of an evicted envelope passes until its timestamp leaves the skew window (see the residuals).

**A timestamp that is not a number.** `verifyEnvelope` refuses a timestamp that gives no finite difference to the clock, with `ENVELOPE_TIMESTAMP_SKEW`. A string that is not a number gives `NaN`. Before, such an envelope always passed the skew check, so its replay passed when the cache no longer held its entry. A string of decimal digits gives a finite difference, and it still passes.

**The nonce rule.** `verifyEnvelope` and `verifyRequestAuth` require a nonce of 16 to 64 bytes of lowercase hex. The nonce is thus a string of 32 to 128 hex characters, with an even count. Else they throw `ENVELOPE_NONCE_INVALID` or `REQUEST_AUTH_NONCE_INVALID`. Each function checks the nonce after the timestamp skew and before the signature. `signEnvelope` and `buildRequestAuth` make a nonce of 16 bytes (`DEFAULT_NONCE_LEN_BYTES`), so the clients of this package pass.

**The two bounds stay ON.** The cache size (`maxEntries`, default 10,000) and the nonce length apply by default. The cache size is admission control on a public service, and the nonce length is a validity threshold. No DID data passes through either bound, so neither bound can refuse a conformant DID document or update. The project rule that a limit ships OFF applies to a resource budget on conformant data. The `NonceCache` constructor refuses a `maxEntries` that is not an integer of 1 or more, with `INVALID_NONCE_CACHE_CAPACITY`.

### 3. The server signs a retained envelope again at delivery

`sendMessage` signs each inbox event one time for all live subscribers, with the clock of the server. A sign throw goes to the caller. The inbox buffer keeps the signed envelope and its JSON form.

At an inbox subscribe, the server sends each event after the `Last-Event-ID` of the request. For each event, it applies this rule:

- If the envelope is at most `clockSkewSec / 2` old, the server sends it as it is.
- Else the server signs the wire form of the message again. It uses the current actor keys of the sender, the same recipient, and the current time. The new envelope replaces the retained envelope, so a later subscriber uses it again. The event id does not change.
- If the sender is no longer an actor, the server skips the event with a `logger.debug` line. If the sign throws, the server skips the event with a `logger.warn` line. The server then sends the next events.

The two skip rules apply only to a stale event. A fresh retained event of a removed actor still goes out, because its signature is valid.

The local advert of `publishRepeating` uses the same rule at each broadcast subscribe within its TTL. The new envelope replaces the cached envelope. A posted advert of `POST /v1/adverts` goes out verbatim, and the server does not sign it again. Its poster publishes it again on its own interval.

The margin of `clockSkewSec / 2` keeps the age of each delivered envelope at most half of `clockSkewSec`. The other half of `clockSkewSec` is for the transit time and the clock difference of the client. The server signs a stale event one time for all later subscribers, not one time for each request.

**Inbox ids.** An inbox event id is `<epoch>-<seq>`:

- The epoch is 16 lowercase hex characters, random for each buffer.
- The seq is a decimal integer with no zero at the start. It starts at 1 and increases by 1 at each append.

`InboxBuffer.since(id)` returns the events after `id` only for an id of this buffer. For each other value, it returns each retained event: no id, a malformed id, a seq that is not a safe integer, or an id of another buffer. A server restart makes a new buffer with a new epoch, so an old id gets each retained event of the new buffer. `InboxBuffer` becomes `InboxBuffer<T = string>`, and the buffer keeps the seq next to each event. Thus `since` does not parse the stored ids.

### 4. The advert route refuses a recipient and keeps a live local advert

`POST /v1/adverts` verifies the envelope with `expectedTo: undefined`. An envelope with a `to` member gets 401 `{ error: 'invalid_envelope' }`. The broadcast path of `HttpClientTransport` also verifies with `expectedTo: undefined`, and it drops such an envelope. This closes the old defect 4.

While a local advert is within its TTL, `POST /v1/adverts` answers 409 `{ error: 'local_advert' }`. The check runs after the verification and before the replay lookup, so the refusal stores no nonce and uses no token. It applies to each poster, also to another actor of the server.

Reason: `GET /v1/adverts` gives the local envelope to each party, and the server stores no nonce for an envelope that it signs. Thus a POST of that envelope passed each gate and replaced the local advert (old defect 7). The copy then got no new signature at delivery (decision 3), and the stop function of `publishRepeating` did not remove it. The server has one advert slot, so a captured envelope of another local actor can also replace a live local advert.

### 5. The client requires HTTPS and follows no redirect

The constructor checks `baseUrl` in this order:

1. The parse. A value that is not a string or a `URL` instance gives `INVALID_BASE_URL`. A value that does not parse as an absolute URL gives the same error. The client copies a `URL` instance, so the rule that adds a final slash does not change the URL of the caller.
2. The protocol. A protocol other than `https:` or `http:` gives `INVALID_BASE_URL` with the data `{ protocol }`.
3. The credentials. A URL with a username or a password gives `INVALID_BASE_URL` with the message "The baseUrl must not hold a username or a password." Fetch refuses a request URL with credentials, and its error text shows the URL.
4. The host. A plain `http:` URL with a host that is not a loopback host gives `INSECURE_BASE_URL` with the data `{ hostname }`, unless `allowInsecureHttp` is `true`.

The error data never holds the full URL. `allowInsecureHttp: true` accepts plain http on each host, and steps 1 to 3 still apply.

A loopback host is one of these hosts:

- An IPv4 address in 127.0.0.0/8. The URL parser serializes each IPv4 form, so `127.1` and `0x7f000001` give `127.0.0.1`.
- The IPv6 address `::1`, serialized as `[::1]`. An IPv4-mapped address, for example `[::ffff:127.0.0.1]`, is not a loopback host.
- A localhost name: `localhost`, or a name that ends with `.localhost`. Each name can end with a dot.

The IP literals are loopback hosts with no condition, as in the CIDR step of W3C Secure Contexts 3.1. The rule for the localhost names is a recorded trust assumption: the host must resolve each localhost name to a loopback address. Secure Contexts applies the same name rule only under a precondition on the resolver, and the client cannot check the resolver. The HTTP demo script uses `http://localhost`.

**Redirects.** The three fetch calls (`sendMessage`, the broadcast GET, and the inbox GET) set `redirect: 'manual'`. A redirect answer is a failed request:

- Node and Cloudflare Workers give the 3xx answer. A browser gives an opaque redirect answer with status 0 for a same-origin request, or if the redirect answer passes the CORS check. In each case, `res.ok` is false. `sendMessage` then throws `SEND_MESSAGE_HTTP` with the status. An SSE loop writes a warn line, cancels the body, and waits the backoff delay.
- In a browser, fetch rejects for a cross-origin redirect that fails the CORS check, and for a CORS preflight that gets a redirect. `sendMessage` gives the rejection to the caller unchanged. An SSE loop writes a debug line and waits the backoff delay.

The client follows no redirect on any runtime. Thus it never sends a signed body again to a `Location`.

The client does not use `redirect: 'error'`. The Cloudflare Workers fetch refuses `'error'` with a `TypeError` (the workerd text in the Context). With `'error'`, each request fails on Workers, and both SSE loops wait the backoff delay with no end. `'manual'` gives the same result on Node, in browsers, and on Workers: the client does not follow the redirect.

**The fetch call.** The constructor reads `fetchImpl` or `globalThis.fetch`, and it stores `(input, init) => fetchImpl(input, init)`. Thus the client calls fetch with no `this` value (old defect 3). The wrapper also covers a caller that gives the raw browser fetch as `fetchImpl`. The `NO_FETCH_IMPL` check stays at construction.

### 6. The client refuses malformed input and keeps its loops open

**Event checks.** For each SSE event, the client applies these checks. A failure drops the event with a `logger.debug` line, and the stream stays open:

1. The data parses as JSON and has the envelope shape of decision 1.
2. The sender key resolves. A throw of the injected `resolveSenderPk` counts as no key.
3. The envelope verifies. A broadcast envelope must have no `to` (decision 4).
4. `reviveFromWire` does not throw.
5. The inner `from` is the envelope `from`. A log line names an inner `from` that is not a string by its type, because `String(value)` can throw for an object from the wire.

**Own properties.** `reviveFromWire` makes each member an own property of the result, also a member named `__proto__`. Thus a `__proto__` member cannot set the prototype of a revived message (old defect 2). The x1 bootstrap of the server uses the same function.

**The outer body.** Each flatten (`NostrTransport`, `HttpClientTransport`, and `HttpServerTransport`) now gives `{ ...msg, ...body, body }`. The flat message keeps the outer `body` as its `body` member. Thus a `body` member inside `body` cannot replace it, and the transport checks and the state machines read the same `communicationPk` (old defect 1). A nested message still goes to the handler, with the outer body.

**Handler failures.** The client does not wait for a broadcast handler. A synchronous throw or a rejection gets a `logger.warn` line, and the handlers of the other actors still get the event. An inbox handler runs to its end before the next event. A throw or a rejection gets a `logger.warn` line, and the stream stays open. Each other throw in the dispatch of one event gets a `logger.error` line, and the client drops the event.

**The loops.** `start()` and the inbox open add a final catch to each loop promise, so a loop rejection is never an unhandled rejection. A `reconnectBackoff` that throws ends that loop with one `logger.error` line. The subscription then stays closed until `stop()` and `start()`. A logger that throws never ends a loop. Each logger call of the loop body goes through a helper that catches the throw. A logger throw in the dispatch of one event goes to the catch of that event. The `publishRepeating` catch uses the same helper (old defect 6).

**The backoff.** Each loop waits the backoff delay after each attempt. An attempt ends with a failed answer, a stream end, an event above the size limit, or a fetch or read error. The attempt count goes back to 0 after an attempt that received at least one body byte, for example a heartbeat comment. An attempt with an event above the size limit counts as failed, also if bytes arrived. Each loop stops before the backoff call if the abort signal is set. For a failed answer, the client cancels the body to free the connection.

**Inbox resume.** The client keeps the id of the last inbox event of each actor: the resume id. It sends the resume id in `Last-Event-ID` at each inbox request. The client records the id before the event name filter and before the checks. An event that fails a check fails again on a replay. The rules for an `id` field:

- An empty id clears the resume id, as in HTML. The next request then sends no `Last-Event-ID`.
- An id of 1 to 256 visible ASCII characters (0x21 to 0x7E) replaces the resume id.
- The client ignores each other id. Fetch refuses some header values, and a server can refuse a long header. The ids of `HttpServerTransport` have at most 33 characters.

`stop()` and `start()` keep the resume id. A new `registerActor` starts with no resume id, so the server sends each retained event again. The broadcast loop sends no `Last-Event-ID`: the server sends its current advert at each subscribe, and an advert repeats by design.

**A failed POST.** `sendMessage` reads at most 1,024 bytes of the body of a failed answer, then it cancels the body. `data.body` of `SEND_MESSAGE_HTTP` holds at most 256 characters, as before. Before, the client read the full body (old defect 5). A fetch rejection goes to the caller unchanged.

### 7. The SSE parser follows the HTML end and BOM rules, runs in linear time, and has an optional size limit

**The end of the stream.** At the end of the stream, `parseSseStream` discards an incomplete event and an unterminated last line, as HTML says. An incomplete event has no final blank line. The exported function gets an optional second parameter (the size limit below), and its result at the end of the stream changes: before, the parser gave the incomplete event. A cut event never gives its id.

**One BOM.** The parser removes one U+FEFF at the start of the stream, as the UTF-8 decode of HTML does. It uses `new TextDecoder('utf-8', { ignoreBOM: true })`, and it removes one U+FEFF from the first decoded text that is not empty. Reason: Bun 1.3.11 removes a BOM at the start of each decode call with `stream: true`, and the parser decodes each line with its own calls. A second BOM starts an unknown field name, as in HTML. An invalid UTF-8 sequence gives U+FFFD in the line that holds it.

**Bytes and linear time.** The parser keeps the bytes of the unterminated line in one buffer. It looks for LF bytes only in the new bytes of each read, and it decodes each line one time. Thus the parse time is linear in the stream length. The buffer capacity doubles and stays at most the limit plus 1 byte, because the size check runs before each append. After its line ends, the parser frees a buffer above 64 KiB. With the old scan, a speed test took 15,740 ms under Node, against a bound of 5,000 ms.

**The size limit.** `SseParseOptions.maxEventBytes` sets the maximum byte count of one event. A number greater than 0 sets the limit, and the parser ignores each other value. The default is no limit. The byte count of an event is the sum of these values:

- The bytes of each completed line of the event, with its line end (LF = 1 byte, CRLF = 2 bytes). A comment line does not count after its LF.
- The bytes of the current unterminated line, of each kind. A final CR byte does not count until its LF arrives, because it can start a CRLF line end.

The blank line that ends an event sets the count to 0. The parser checks the count at each LF, after each field line, and at the end of each read. Thus a long comment line fails also if it arrives in one read. Above the limit, the parser cancels the stream and throws `SSE_EVENT_TOO_LARGE` with the data `{ maxEventBytes }`.

`HttpClientTransportConfig.maxSseEventBytes` gives the limit to both loops. The default is no limit. `RECOMMENDED_MAX_SSE_EVENT_BYTES` is 1,048,576 bytes (1 MiB). For did:btcr2 KEY DIDs, this value holds a CAS DISTRIBUTE_AGGREGATED_DATA of about 8,500 members (122 bytes for each member). It also holds a COHORT_READY of about 12,900 members (81 bytes for each cohort key).

For an event above the limit, the client writes a `logger.warn` line with the limit of the parser. It closes the stream and connects again after the backoff delay, and the attempt counts as failed.

Reason for no limit by default: DISTRIBUTE_AGGREGATED_DATA and COHORT_READY grow with the cohort size. Thus a fixed limit can refuse a conformant message of a large cohort. The server limit `maxBodyBytes` does not bound these messages, because the service sends them in process. A limit that the specification does not set ships OFF, with a `RECOMMENDED_*` value (the project rule for limits).

**The inbox skip by id.** If the parser applied an `id` field of the refused event before the count passed the limit, the error data also holds `eventId`. If the parser applied more than one `id` field of the event, the last one gives the value. The inbox loop applies `eventId` with the resume rules of decision 6. If the id replaces the resume id, the next inbox request resumes after the refused event. The actor then loses only that event, and the later events arrive.

The warn line says that the client skips the event only if the id replaced the resume id. The broadcast loop does not change: a refused advert gets another attempt.

`formatSseEvent`, the SSE writer of this package, writes the `id` field first. Thus, with this writer, the parser gives the id of a refused event of `HttpServerTransport`, if the `id` line fits in the limit. HTML sets the last event ID string only at the dispatch of an event, and the parser does not dispatch the refused event. Thus `eventId` is an addition outside HTML.

Reason: one refused event must not block each later message of the actor. Without the skip, the server sends the same event again at each reconnect, because the resume id stays before it. The limit is opt-in, and the specification is silent.

**Two differences from HTML.** The parser and the client keep two differences from the last event ID rules of HTML:

1. An id-only block (`id: X` and a blank line, with no `data`) changes nothing, because the parser gives no event for it. HTML sets the last event ID string at the dispatch, before the check for an empty data buffer.
2. A new stream does not reset the id. HTML gives each new stream an empty last event ID buffer, so a first event with no id clears the string. The client keeps the old resume id.

The server of this package always writes `data` and an id, so neither difference applies to it.

### 8. NostrTransport encrypts each message with a recipient

`sendMessage` applies these rules in this order:

1. A message with no type gives `SEND_MESSAGE_ERROR`. A sender that is not a registered actor gives `UNKNOWN_ACTOR_ERROR`.
2. A type that is not an aggregation message type gives a `logger.warn` line, and the method publishes nothing.
3. No recipient: only a COHORT_ADVERT goes out, as a kind 1 event with plaintext JSON content. The tags are `['p', <sender x-only key>]` and `['t', COHORT_ADVERT]`. For each other type, the method throws `SEND_MESSAGE_ERROR` with the data `{ adapter, type }`. An empty string `to` counts as no recipient, as in `HttpServerTransport.sendMessage`.
4. A recipient: the recipient DID must be a registered peer, for each message type. Else the method throws `UNKNOWN_PEER_ERROR`.
5. The plaintext JSON must be at most 65,535 UTF-8 bytes. Else the method throws a `TransportAdapterError` of the type `MESSAGE_TOO_LARGE`, with the data `{ adapter, type, plaintextBytes, maxPlaintextBytes }`. It publishes nothing.
6. The event is kind 1059. Its content is NIP-44 v2 ciphertext for the recipient key. Its tags are exactly `['p', <sender x-only key>]` and `['p', <recipient x-only key>]`, with no `t` tag.

Thus COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, and COHORT_READY also go as kind 1059, and an x1 opt-in no longer shows its genesis document to a relay. The two runners register each recipient before they send to it. The participant registers the service key of the advert before it joins, and the service registers the key of a participant at its opt-in. A test runs a full cohort of a k1 member and an x1 member, with no peer registered before the start.

The peer lookup comes before the size check, because an unknown peer is the more basic error. A kind 1 advert gets no size check, because NIP-44 does not apply to it.

**The limit of 65,535 bytes.** This value is the largest plaintext for the 2-byte length prefix of NIP-44 v2. NIP-44 now also defines a 6-byte prefix for a plaintext of 65,536 bytes or more. nostr-tools 2.23.3 is the lowest version in the range `^2.23.3` of this package. It refuses the 6-byte prefix on encrypt and on decrypt, and nostr-tools 2.23.4 and later accept it. Thus a larger message can fail at a receiver of this package. Before, the NIP-44 encrypt of an update message or a sign message threw a raw `Error`, and a plaintext keygen message had no limit.

**The directed receive path.** The directed subscription of each actor filters on `{ kinds: [1059], '#p': [<actor x-only key>] }`. The handler also checks the kind, before the self-echo check. It drops each event of another kind with a `logger.debug` line. No compatibility path for old peers exists. The project has no users yet, and after this change only an old or a hostile sender publishes a directed kind 1 event. The broadcast subscription stays kind 1 with the advert `t` tag.

**Receive guards.** Both receive paths drop a content or a decrypted plaintext that is not a JSON object, with a `logger.debug` line. A reviver throw, for example for a bad `__bytes` value, stays inside the parse try and drops the event. A throw of the injected `resolveSenderPk` drops the event with a `logger.debug` line, as in `HttpClientTransport`.

**Handler failures.** The transport calls the directed handler at once, and it does not wait for the handler, as before. Thus the directed path keeps its call order. A synchronous throw or a rejection gets a `logger.warn` line with the message type and the sender DID. A broadcast event goes to the actors one after the other, and each call is inside a try. A failure gets the same warn line, and the handlers of the later actors still run.

Each `onevent` callback is a wrapper. It catches a throw and a rejection of the handler, and it writes a `logger.error` line. The relay pool calls `onevent` with no catch, so the wrapper returns nothing that can reject. Each logger call on the receive paths, in the `onclose` callbacks, and in the `publishRepeating` catches goes through a helper that catches a logger throw.

### 9. The transport key of a DID stays its genesis key

This decision changes no code. `resolveBtcr2SenderPk` reads no current DID document. For a k1 DID, it gives the key in the DID. For an x1 DID, it gives the key of `capabilityInvocation[0]` of the genesis document. It gives this key also after an update removes the key from the DID document.

Reason: the transports are sans-I/O and synchronous. A resolver of the current DID document needs Bitcoin I/O and CAS I/O inside the transport. A caller that holds the current document already has a path: a custom `resolveSenderPk`. The specification sets no transport rule.

The attack after a key leak:

- The holder of the old key can authenticate as the DID, and it can join a cohort as the DID.
- A peer registry entry has no expiry. Thus a cohort that the DID joined with the old key keeps that key.
- The service checks only the structure and the sender DID of an update (ADR 152, decision 4).
- The aggregate beacon of a cohort with the old key can be in the DID document. Then the holder can make the cohort announce an update that a resolver cannot get or refuses, and the DID does not resolve. This is an invalidation attack (Security Considerations, Invalidation Attacks).

The method JSDoc of `resolveBtcr2SenderPk` and the method docs give the steps after a rotation:

- A transport accepts the current key only after `registerPeer(did, currentKey)`, or with a custom `resolveSenderPk` that calls `getAggregationCommunicationKey` on the current DID document. The peer registry comes before `resolveSenderPk`, so a registered old key stays in use until a new `registerPeer` call replaces it.
- The controller must remove each aggregate beacon whose cohort key is the old key from the DID document.

Data Retention also tells a controller to consider a new DID in place of a key rotation.

### 10. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The server answers a malformed body with 400 or 401, and an unexpected throw with 500 `internal_error`. `handleRequest` never rejects, and `handleSse` never throws. | Aggregate Beacons, example: "An Aggregation Cohort may fail if Aggregation Participants stop participating or the Aggregation Service is compromised." RFC 9110 15.5.1: "The 400 (Bad Request) status code indicates that the server cannot or will not process the request due to something that is perceived to be a client error (e.g., malformed request syntax, invalid request message framing, or deceptive request routing)." RFC 9110 15.6.1: "The 500 (Internal Server Error) status code indicates that the server encountered an unexpected condition that prevented it from fulfilling the request." | Conforms. The specification defines no transport input ("A full protocol definition is out of scope for this specification"). One request with no signature must not stop the service. Each status code agrees with RFC 9110. |
| The bodies `0`, `false`, and `""` get `malformed_envelope`. No body, a parse failure, and `null` stay `invalid_json`. | RFC 9110 15.5.1, above. | Conforms. Each of the three bodies parses as JSON, so the fault is the envelope shape, as for `5` or `[]`. |
| The order is the replay lookup, the rate limiter, then the nonce store. A replay uses no token, and a throttled request stores no nonce. | RFC 9110 15.5.10: "The 409 (Conflict) status code indicates that the request could not be completed due to a conflict with the current state of the target resource." RFC 6585 4: "The 429 status code indicates that the user has sent too many requests in a given amount of time ("rate limiting")." | Conforms. A replay conflicts with the state of the cache. A throttled request is a request that the server did not process, so its nonce is not used. |
| A full cache evicts the live entry that expires first, with at most one warn line in each `clockSkewSec` window. | Aggregate Beacons, example: "This response SHOULD be sent over a secure communication channel and MAY be signed." | The specification is silent on replay protection. TLS is the secure channel (ADR 029), so a replay needs a captured envelope. A refusal of each new envelope with 503 gives an outage that needs no captured envelope. |
| The cache size and the nonce length stay ON. | The specification sets no cache size and no nonce length. | The specification is silent. No DID data passes through either bound, so neither bound refuses a conformant DID document or update. |
| An entry lives until `nowSec + 2 * clockSkewSec`, and it is live at its expiry second. The server reads its clock one time for each request. A non-finite skew difference fails the skew check. | The specification defines no envelope. | The specification is silent. The entry is live for each second in which a replay can pass the skew check. A `NaN` difference always passed the check. |
| The server signs a retained envelope again at delivery if it is older than `clockSkewSec / 2`. A posted advert goes out verbatim. | Aggregate Beacons, example: "All Aggregation Participants must be made aware of each opportunity because every participant must respond for the Aggregation Service to broadcast Beacon Signals." | Conforms. The lowercase "must" is in the example, and it sets no delivery rule. A participant that reconnects now gets a retained message, so the cohort does not stall for this cause. |
| An inbox id is `<epoch>-<seq>`. An id of another buffer gets each retained event. | HTML 9.2.4: "It is essentially any UTF-8 encoded string, that does not contain U+0000 NULL, U+000A LF, or U+000D CR." | Conforms. The id is opaque to the client. The format is a rule of this server only. |
| `POST /v1/adverts` refuses an envelope with a `to` member, and it answers 409 `local_advert` while a local advert is within its TTL. | Aggregate Beacons, example: "Advertising Aggregation Cohorts to participants can be done with Nostr or DIDComm." RFC 9110 15.5.10, above. | Conforms. An advert names no recipient. The live local advert is the current state of the advert resource, so a post conflicts with it. |
| The client requires https, with the opt-out `allowInsecureHttp`. | Aggregate Beacons, example: "This response SHOULD be sent over a secure communication channel and MAY be signed." | Conforms. The client applies the SHOULD to each message. A SHOULD allows a documented exception, so an opt-out exists. |
| The IP literals 127.0.0.0/8 and `::1` are loopback hosts with no condition. The rule for the localhost names is a recorded trust assumption. | W3C Secure Contexts 3.1: "If origin’s host matches one of the CIDR notations 127.0.0.0/8 or ::1/128". The name step starts with "If the user agent conforms to the name resolution rules in", then a reference to [let-localhost-be-localhost]. 5.2: "For better or worse, resolvers often ignore these suggestions, and will send localhost to the network for resolution in a number of circumstances." | Conforms for the IP literals. The client cannot check the resolver, so the docs and the JSDoc record the precondition of the name step as a trust assumption. |
| A base URL with a username or a password gives `INVALID_BASE_URL`, with no URL in the error data. | Fetch: "If parsedURL includes credentials, then throw a TypeError." | Conforms. Fetch refuses each request to such a URL, so the constructor refuses it first. |
| The three fetch calls set `redirect: 'manual'`, and a redirect answer is a failed request. | Fetch, the redirect mode `"manual"`: "Retrieves an opaque-redirect filtered response when a request is met with a redirect, to allow a service worker to replay the redirect offline." workerd: `Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).` | Conforms. The client follows no redirect on any runtime, so it never sends a signed body again to a `Location`. The specification is silent on redirects. |
| `parseSseStream` discards an incomplete event at the end of the stream. | HTML 9.2.6: "Once the end of the file is reached, any pending data must be discarded. (If the file ends in the middle of an event, before the final empty line, the incomplete event is not dispatched.)" | Conforms. |
| The parser removes one BOM at the start of the stream. | HTML 9.2.6: "The UTF-8 decode algorithm strips one leading UTF-8 Byte Order Mark (BOM), if any." | Conforms. The manual strip gives the HTML result also under Bun 1.3.11. |
| The client keeps a resume id for each actor. An empty id clears it. The client ignores an id over 256 characters or with a character outside 0x21 to 0x7E. | HTML 9.2.6: "If the field value does not contain U+0000 NULL, then set the last event ID buffer to the field value. Otherwise, ignore the field." HTML 9.2.4, above. | A subset of HTML. HTML accepts a longer id, but a server can refuse a long header at each reconnect. The ids of `HttpServerTransport` have at most 33 characters, so the rule does not refuse them. |
| An id-only block changes nothing, and a new stream does not reset the id. | HTML 9.2.6, the dispatch: "Set the last event ID string of the event source to the value of the last event ID buffer." Also: "When a stream is parsed, a data buffer, an event type buffer, and a last event ID buffer must be associated with it. They must be initialized to the empty string." | Two differences from HTML, recorded as residuals. The server of this package always writes `data` and an id, so neither difference applies to it. |
| `maxSseEventBytes` is OFF by default, with `RECOMMENDED_MAX_SSE_EVENT_BYTES`. An event above the limit is a failed attempt. | The specification sets no message size. | The specification is silent. A limit ON can refuse a conformant DISTRIBUTE_AGGREGATED_DATA of a large cohort. |
| The parser puts the id of a refused event in the error data, and the inbox loop skips the event by that id. | HTML 9.2.6, the dispatch: "Set the last event ID string of the event source to the value of the last event ID buffer." | An addition outside HTML: HTML sets the last event ID string only at the dispatch, and the parser does not dispatch the refused event. The specification is silent. One refused event must not block each later message of the actor. |
| Each Nostr message with a recipient is a kind 1059 event with NIP-44 v2 content and two `p` tags only. | Aggregate Beacons, example: "This response SHOULD be sent over a secure communication channel and MAY be signed." Privacy Considerations: "To keep the DID document fully private, the DID controller can choose to use an externally resolved initial did:btcr2 identifier and not place the initial DID document on a Content Addressable Storage (CAS) system such as the InterPlanetary File System (IPFS)." | Conforms. An x1 opt-in no longer publishes the genesis document, and no tag shows the message type. |
| Only a COHORT_ADVERT can go out with no recipient. | Aggregate Beacons, example: "Advertising Aggregation Cohorts to participants can be done with Nostr or DIDComm." | Conforms. The advert is the one message for each participant. Each other message has one recipient. |
| The plaintext limit is 65,535 UTF-8 bytes. | NIP-44: "Validate plaintext length. Minimum is 1 byte, maximum is 4,294,967,295 bytes". Also: "Implementations SHOULD enforce their own maximum payload size based on platform and resource constraints, rejecting oversized payloads early in `decode_payload` (before base64 decoding) to prevent denial-of-service." | Conforms. The limit is lower than the NIP-44 maximum, as NIP-44 allows. It keeps the 2-byte prefix, which each nostr-tools version in the package range accepts. |
| The directed path accepts only kind 1059, with no compatibility path. | The specification defines no Nostr event kind. | The specification is silent. The project has no users yet, so the wire changes with no compatibility path. |
| The transport key of a DID stays its genesis key, and the docs give the steps after a rotation. | Security Considerations, Key Compromise: "Should these keys get compromised without the DID controller's knowledge, it would be possible for an adversary to take control of a DID by submitting a BTCR2 Update to a BTCR2 Beacon that replaces key material and BTCR2 Beacons in the DID document for ones under the adversary's control." Invalidation Attacks: "Due to the requirement for processing all relevant Beacon Signals, if these updates cannot be retrieved by a resolver, the DID MUST be considered invalid." | Conforms. The Key Compromise text has no BCP 14 keyword, and it sets no transport rule. The docs tell the controller to remove each aggregate beacon with the old key, as the text names the replacement of "key material and BTCR2 Beacons". |
| The flatten keeps the outer body, `reviveFromWire` makes own properties, and the receive paths catch each handler failure and each logger throw. Fetch gets no `this` value. | The specification defines no library API. | The specification is silent. Each fix keeps the sender bind of ADR 090: the transport check and the state machine read the same members. |

## Alternatives

- **Answer 401 for each malformed body.** Rejected. A 401 says that the credentials fail. The fault is the request shape, and RFC 9110 gives 400 for it.
- **Keep `invalid_json` for `0`, `false`, and `""`.** Rejected. Each of these bodies parses as JSON, so the fault is the envelope shape.
- **Let `handleRequest` reject, and let the adapter catch.** Rejected. The JSDoc promises a fully formed answer, and the `node:http` adapter of the demo does not catch. One request with no signature then stops the process.
- **Refuse a new envelope with 503 `replay_cache_full` while the cache is full of live entries.** Rejected. About 334 self-minted k1 DIDs (burst 30) fill the 10,000 entries at once, and about 84 signed requests per second keep the cache full. Each sender then gets 503, and the attacker needs no captured envelope.
- **A quota for each DID, and an eviction that takes an entry of a sender that is not a registered peer first.** Rejected for this change. It protects the cohort members better, but it costs more code.
- **The order "rate limiter, then nonce store" with no lookup first.** Rejected. Each replay of a captured envelope then uses a token of the victim before the 409. In a test, the next fresh envelope of the victim got 429.
- **Store the nonce before the rate limiter on the inbox GET.** Rejected. The three routes then have two orders, and replays use the tokens of the victim again. The residual "a throttled inbox auth header" records the effect.
- **An expiry from the envelope timestamp.** Rejected. The cache then depends on a value that the sender sets, and a timestamp that is not a number gives no expiry. The store time plus 2 x `clockSkewSec` covers each timestamp that passes the skew check.
- **A clock call in each verify call.** Rejected. Two clock values can fall in two seconds, so the verify call and the cache can disagree at the boundary second.
- **Ship the cache size and the nonce length OFF, with `RECOMMENDED_*` values.** Rejected. The project rule for limits applies to a resource budget on conformant data. The cache size is admission control, and the nonce length is a validity threshold.
- **The client accepts a retained envelope up to a new `bufferedMaxAgeSec`.** Rejected. The client has no replay cache, so it then accepts an old envelope from each sender for that full age.
- **`Last-Event-ID` resume only.** Rejected. It stops the repeated dispatch, but a message that waited more than `clockSkewSec` still fails the skew check.
- **Sign each retained event again at each delivery.** Rejected. A client with no `Last-Event-ID` then makes the server sign up to 100 events for each request, about 1.56 ms each under Node 24.
- **A maximum delivery age for retained events.** Rejected. It drops a retained message that the participant needs, and it does not stop a repeated delivery inside that age.
- **Skip each retained event of a removed actor.** Rejected. A fresh retained event has a valid signature, so the server delivers it.
- **Sign a posted advert again at delivery.** Rejected. The server relays a posted advert verbatim (ADR 090, decision 3), and its poster publishes it again on its own interval.
- **Refuse a posted advert only for the `from` of the local advert.** Rejected. The server has one advert slot, so a captured envelope of another local actor also replaces a live local advert.
- **Answer 202 to the post and keep the local advert.** Rejected. The poster then gets a success for an advert that the server does not send.
- **Record the nonce of each local envelope in the replay cache.** Rejected. Each refresh signs again, so the server fills its replay cache with its own signatures.
- **Plain http with no opt-out.** Rejected. The SHOULD allows a documented exception, for example a client behind a trusted TLS proxy or on a closed test network.
- **A warning only, or docs only.** Rejected. With either one, the client still sends signed updates, MuSig2 nonces, and partial signatures as plaintext.
- **Accept only the IP literals as loopback hosts.** Rejected. The HTTP demo script and many local setups use `http://localhost`. This ADR and the JSDoc record the name rule as a trust assumption.
- **Accept each object with a string `href` as a URL.** Rejected. The config type is `string | URL`, and the client copies a parsed `URL` instance.
- **`redirect: 'error'` on the three fetch calls.** Rejected. The Cloudflare Workers fetch refuses this value with a `TypeError`, so each request fails on Workers.
- **`redirect: 'follow'`, the fetch default.** Rejected. A 307 or a 308 answer to an http URL then sends the signed body again as plaintext.
- **A wrapper that reads `globalThis.fetch` at each call, for the default fetch only.** Rejected. A caller can also give the raw browser fetch as `fetchImpl`.
- **Reset the attempt count at each ok answer.** Rejected. A server that ends each stream at once then gets about 700 requests per second from one client.
- **A `Last-Event-ID` of each length.** Rejected. A server with a header limit of 16 KiB (the Node default) refuses each reconnect for a very long id.
- **Send `Last-Event-ID` on the broadcast loop too.** Rejected. The server sends its current advert at each subscribe, and an advert repeats by design.
- **Keep the flush of an incomplete event at the end of the stream.** Rejected. HTML discards the incomplete event, and a cut event can hold a part of a message.
- **Keep the default `TextDecoder`, and state in the JSDoc that the parser needs a standard decoder.** Rejected. Bun 1.3.11 then removes a BOM at the start of each line.
- **Keep the unterminated line as text, and fix only the JSDoc.** Rejected. With reads of 2 bytes, the text form used about 16 times the memory of the line. The byte buffer keeps the bound for each read size.
- **Check the size only at the end of each read.** Rejected. A long comment line then passes or fails by the places where the reads split.
- **A size limit ON by default.** Rejected. A fixed limit can refuse a conformant DISTRIBUTE_AGGREGATED_DATA or COHORT_READY of a large cohort.
- **No size limit, and a later change for it.** Rejected. A hostile server can then stop the client process, and the speed fix changes the same file.
- **Keep the retry of an oversize inbox event, with no skip.** Rejected. The server sends the same event again at each reconnect, so the actor gets no later inbox message while the server holds that event.
- **Encrypt only an opt-in with a genesis document.** Rejected. The `t` tag still shows the type of each message, and COHORT_OPT_IN_ACCEPT and COHORT_READY still show the cohort membership.
- **Docs only for Nostr.** Rejected. Each x1 participant then publishes its genesis document to each relay.
- **Keep the directed kind 1 receive path for old peers.** Rejected. The project has no users yet, so the wire changes with no compatibility path.
- **A plaintext limit above 65,535 bytes with the 6-byte NIP-44 prefix.** Rejected. nostr-tools 2.23.3, a version in the package range, refuses the 6-byte prefix.
- **The size check before the peer lookup.** Rejected. An unknown peer is the more basic error.
- **`to !== undefined` as the recipient test, so that `''` gives `UNKNOWN_PEER_ERROR`.** Rejected. The old code and `HttpServerTransport.sendMessage` treat an empty `to` as no recipient.
- **An asynchronous resolver of the current DID document inside the transports.** Rejected. It adds Bitcoin I/O and CAS I/O to a sans-I/O transport, and it makes each sender check asynchronous.
- **A `currentDocument` option on `resolveBtcr2SenderPk`.** Rejected. The transport holds no current document of a sender, so the caller must still get it. A custom `resolveSenderPk` already gives this path.

## Consequences

- The aggregation package gets a MINOR release. At 0.x, a MINOR release can hold a break of the public API. No other workspace package depends on the aggregation package.
- The method package gets a PATCH release. The JSDoc of `resolveBtcr2SenderPk` in the shipped `src` changes, and the method docs and the method README change too. No code of the method package changes.
- The test vectors do not change. No vector and no step of the vector pipeline uses an aggregation transport.

The behavior changes:

- One malformed request, event, or Nostr event no longer stops a process or closes a stream. It gets a defined answer, or the transport drops it with a log line.
- The server refuses a replay of an envelope while its entry is live, also after a flood of throttled envelopes.
- A participant that reconnects after more than `clockSkewSec` gets its retained inbox messages and the current local advert. It gets each inbox event one time.
- Each Nostr message with a recipient is NIP-44 v2 ciphertext. A relay no longer sees an x1 genesis document or a message type.
- The HTTP client refuses a plain http URL on a host that is not a loopback host, and it follows no redirect.
- The SSE parse time is linear, and the client can bound the size of one event.

The public API breaks:

1. `NonceCache.store(did, nonce, expiresAtSec, nowSec)` replaces `store(did, nonce, timestampSec)`. It returns `NonceStoreResult` (`'stored'` or `'evicted'`), and it does not look for a replay. The new `NonceCache.has(did, nonce, nowSec)` finds a live entry. Before, `store` returned `false` for a replay.
2. The `NonceCache` constructor throws `INVALID_NONCE_CACHE_CAPACITY` for a `maxEntries` that is not an integer of 1 or more.
3. `InboxBuffer` becomes `InboxBuffer<T = string>`, and `StoredEvent` becomes `StoredEvent<T = string>` with `data: T`. The ids are `<epoch>-<seq>`, and `since` returns each retained event for an id of another buffer.
4. `verifyEnvelope` throws `ENVELOPE_NONCE_INVALID`, and it throws `ENVELOPE_TIMESTAMP_SKEW` for a non-finite difference. `verifyRequestAuth` throws `REQUEST_AUTH_NONCE_INVALID`.
5. `reviveFromWire` makes each member an own property, also `__proto__`.
6. `HttpServerTransport` has new answers: 400 `malformed_envelope`, 400 `malformed_message`, 500 `internal_error`, and 409 `local_advert`. The bodies `0`, `false`, and `""` get `malformed_envelope`, not `invalid_json`. An absolute request target that does not parse gets 404. An advert with a `to` member gets 401 `invalid_envelope`. A retry of a throttled envelope gets 202 after the refill, not 409.
7. `HttpServerTransportConfig.now` also drives the envelope skew checks, the replay cache, and the timestamp of each envelope that the server signs.
8. The `HttpClientTransport` constructor throws `INVALID_BASE_URL` and `INSECURE_BASE_URL`. An object with a string `href` that is not a `URL` instance gives `INVALID_BASE_URL`.
9. `HttpClientTransport` follows no redirect: a redirect gives `SEND_MESSAGE_HTTP` with the status 3xx or 0. The broadcast path drops an envelope with a `to` member. It sends `Last-Event-ID`, and it waits the backoff delay after each attempt. A throw of `reconnectBackoff` ends the loop with a `logger.error` line.
10. `parseSseStream` discards an incomplete event at the end of the stream, and it removes only one BOM at the start of the stream. It throws `SSE_EVENT_TOO_LARGE` above `maxEventBytes`.
11. `NostrTransport.sendMessage` sends each message with a recipient as kind 1059 with no `t` tag. It throws `UNKNOWN_PEER_ERROR` for an unregistered recipient of each type, and `SEND_MESSAGE_ERROR` for a message other than COHORT_ADVERT with no recipient. It throws `MESSAGE_TOO_LARGE` above 65,535 bytes.
12. The directed subscription of `NostrTransport` accepts only kind 1059. A directed kind 1 event of an earlier version no longer arrives.
13. The additions: `HttpClientTransportConfig.allowInsecureHttp`, `HttpClientTransportConfig.maxSseEventBytes`, `SseParseOptions`, `RECOMMENDED_MAX_SSE_EVENT_BYTES`, `NonceStoreResult`, and `NonceCache.has`.

The residuals of the HTTP server:

- **Eviction under a flood.** If a party fills the replay cache with live entries and holds a captured envelope, a replay of an evicted envelope can pass. It passes until its timestamp leaves the skew window. To fill the cache, the party needs about 10,000 admitted requests inside 2 x `clockSkewSec`, for example from about 334 self-minted k1 DIDs. The warn line reports the evictions. A deployment with this risk can add a limit for each IP address at its own proxy.
- **A throttled inbox auth header.** If the rate limiter refuses an inbox GET, the server stores no nonce for its auth header. Another party that holds the header can then use it after the refill, until its timestamp leaves the skew window.
- **A client with no `Last-Event-ID`.** If a client sends no `Last-Event-ID` (a new process, or a new `registerActor`), the server sends each retained inbox event again. It signs each stale event again, so each event passes the client checks again. The message handlers of a participant must be idempotent.
- **A late subscriber and a posted advert.** If a subscriber connects more than `clockSkewSec` after the poster signed a posted advert, the client drops that advert. The skew check refuses it. The server relays a posted advert verbatim, so the poster must publish it again within `clockSkewSec`.
- **Two maps with no size bound.** If the server accepts self-minted k1 DIDs (`resolveSenderPk` injected), each new DID adds one rate-limit bucket. Each admitted inbox subscriber of a new DID also adds one inbox entry. The default `InMemoryRateLimitStore` never removes a bucket, and only `stop()` clears the inbox map. A test made 200 buckets from 200 DIDs and 50 inbox entries from 50 subscribers.
- **The time of a new signature.** If the server signs a retained envelope again, the timestamp is the delivery time, not the send time. ADR 029 names the proof "did X sent message M at time T" as a reason for the signatures. For such an envelope, T is the delivery time.

The residuals of the HTTP client:

- **No size limit by default.** If `maxSseEventBytes` is not set, a hostile server can make the client hold one line of each size. A party between the client and an `allowInsecureHttp` server can do the same. Set `maxSseEventBytes` to `RECOMMENDED_MAX_SSE_EVENT_BYTES` to bound it.
- **No skip for some oversize inbox events.** If an inbox event above `maxSseEventBytes` gives no id that replaces the resume id, the client does not skip it. There are four cases:
  - The event has no `id` field before the count passes the limit.
  - The id is equal to the resume id.
  - The client ignores the id: an id with NUL (the parser ignores it), over 256 characters, or with a character outside 0x21 to 0x7E.
  - The id is empty. It clears the resume id, so the server also sends each retained event again.

  In these cases, the server sends the refused event again at each reconnect. The inbox of the actor then gets no later event while the server holds that event in its buffer.
- **Bun keeps the connection.** If the client runs under Bun 1.3.11, a cancel, an abort, or a garbage collection of a fetch body does not close the TCP connection. Thus each `SSE_EVENT_TOO_LARGE` attempt against a hostile server leaves one connection open: a test counted 37 open connections after 600 ms. `stop()` has the same limit. Node closes the connection.
- **Two differences from HTML.** If a server sends an id-only block, the client does not change its resume id. If the first event of a new stream has no id, the client keeps the old resume id, but HTML clears it. The server of this package always writes `data` and an id, so these cases need another server.
- **The localhost names.** If the resolver of the host sends a localhost name to the network, plain http to that name can leave the host. The client cannot check the resolver.

The residuals of the Nostr transport:

- **Metadata on the relay.** If a relay or a subscriber reads a kind 1059 event, it sees both x-only keys in the `p` tags. It also sees the real `created_at` and the length of the ciphertext. From the length, a reader can tell an update from a non-inclusion. The event is not a NIP-59 gift wrap: the long-term key of the sender signs it, and it has no kind 13 seal.
- **The cohort size.** If a Nostr cohort of did:btcr2 KEY DIDs is too large, one of its messages is above 65,535 bytes. The limit is about 533 members for CAS and about 804 members for SMT. For CAS, DISTRIBUTE_AGGREGATED_DATA holds about 122 bytes for each member, and it fails after each member submitted its update. For SMT, COHORT_READY holds 81 bytes for each cohort key, and it fails after keygen. `sendMessage` then throws `MESSAGE_TOO_LARGE`, and the cohort fails. No code compares `maxParticipants` with this limit, and the service runner gives no early warning yet.
- **No NIP-42 AUTH.** If a relay applies the NIP-59 guard ("relays SHOULD guard access to `kind 1059` events based on user AUTH"), it closes the directed subscription. The transport does no NIP-42 AUTH. The cohort formation (opt-in, accept, and ready) now also needs the delivery of kind 1059 events.
- **The broadcast path accepts each type.** If a sender publishes another aggregation message type as kind 1 with the advert `t` tag, the broadcast path dispatches it. The sender bind of ADR 090 still applies, so the sender exposes only its own message.
- **The logger in `start()` and `sendMessage`.** If the logger throws in `info`, `start()` throws after the subscriptions open, and the transport stays started. If the logger throws in `warn` or `debug`, `sendMessage` rejects.

The residuals of the sender key:

- **The genesis key after a rotation.** If a controller rotates a leaked key, each transport still accepts the old key for the DID (decision 9). The operator must register the current key, or inject a resolver that reads the current DID document. The controller must remove each aggregate beacon with the old key.
- **The service reads an x1 genesis document.** If an x1 participant opts in, its opt-in still gives the genesis document to the service (ADR 066). NIP-44 hides it from the relays, and TLS hides it from the network. The operator still reads it (ADR 029), although the specification says that aggregators can work "without needing to view or validate DID documents or the updates".

The test evidence:

- The aggregation tests: 776 tests pass. Before this change, 427 tests passed.
- Old-code runs compile the new tests against the source of main. Of the 117 new server tests, 96 fail on the main source. The 21 tests that pass are controls: they test rules that the old code also had. 44 new client tests fail on the main client.
- The mutation run of the server has 88 mutants: 70 killed, 2 equivalent, 1 in a rule outside this change, and 15 test gaps. New tests close the 15 gaps, and a second run killed 18 of 18 mutants.
- The mutation run of the client killed 20 of 20 mutants. The mutation run of the inbox skip by id killed 6 of 6 mutants.

**Superseded.**

- ADR 029, "Decision": the clause "and rejects replayed `(from, nonce)` pairs". The server refuses a replay while the replay cache holds its entry. A full cache evicts the live entry that expires first. A replay of that envelope then passes until its timestamp leaves the skew window (decision 2).
- ADR 090, decision 2: the sentence "The wire format is unchanged, nothing is double-signed, and an old publisher's events remain byte-identical to a new one's." The Nostr wire changes (decision 8). No message is double-signed.
- ADR 152, decision 7, limit 2: the sentence "A later change of the transports binds the opt-in to the sender key." This change adds no sender authentication to `InMemoryTransport` or to a direct caller of the state machine.
- ADR 152, "Consequences", the residual "The transport sender key is the genesis key": the sentence "A later change of the transports closes it." This change keeps the genesis key, and it records the steps after a rotation (decision 9).

**Unchanged.**

- ADR 008: directed Nostr messages use NIP-44. This change applies that rule to each message with a recipient.
- ADR 029: TLS is the confidentiality layer of the HTTP transport, and the operator reads the plaintext. The envelope format and the default skew of 60 s stay. A participant that needs privacy against the operator still uses the Nostr transport. Decision 2 of this ADR adds an order, an entry life, and a rule for a full cache to the replay rule. Decision 3 signs a retained envelope again at delivery, and decision 5 enforces TLS for each host that is not a loopback host.
- ADR 030: the fetch-based SSE client, the `Authorization` header, and the default backoff of 1 s to 30 s with 20% jitter.
- ADR 032: `handleRequest` and `handleSse` stay sans-I/O. They now never reject and never throw.
- ADR 066: decisions A to D and D1 to D9, the bootstrap order with 409 before 429, and the deferrals of D8. Decision 9 of this ADR records the genesis key after a rotation and the steps after a rotation. With decisions 1 and 2, the bootstrap verification uses the clock of the server, and a bootstrap message that does not revive gives 401 `unknown_sender`.
- ADR 090, decision 1: the bind on each receive path. Decision 6 of this ADR makes the bind read the same members as the state machines: the flatten keeps the outer `body`, and `reviveFromWire` makes own properties. Decision 4 of this ADR refuses an envelope with a `to` member on the two HTTP broadcast paths. Decision 8 makes each Nostr message with a recipient NIP-44 v2 ciphertext, and the directed path accepts only kind 1059. Each receive path catches a handler failure.
- ADR 090, decision 3: the server relays a posted advert verbatim. Only the local advert of `publishRepeating` gets a new signature, and the server does not relay that advert.
- ADR 090, decision 4: the participant checks of the service DID.
- ADR 090, the residuals: the x1 service on Nostr, the self-declared `participantPk`, the `to` field on Nostr, no replay window on Nostr, the non-bootstrap HTTP opt-in, and `InMemoryTransport`. The follow-up warning of ADR 090 also stays open.
- ADR 152, decision 4: the service checks only the structure of the proof and the sender DID.

## Implementation

- `packages/aggregation/src/core/transport/http/wire-checks.ts` (new, in no barrel): `isEnvelopeShape` and `isValidNonce`.
- `packages/aggregation/src/core/transport/http/envelope.ts`: the nonce check and the finite skew check of `verifyEnvelope`, the own properties of `reviveFromWire`, and the JSDoc of the check order.
- `packages/aggregation/src/core/transport/http/request-auth.ts`: the nonce check of `verifyRequestAuth` and its JSDoc.
- `packages/aggregation/src/core/transport/http/protocol.ts`: the JSDoc of `SignedEnvelope`, `SignedEnvelope.nonce`, and `SSE_EVENT`.
- `packages/aggregation/src/service/nonce-cache.ts`: `has`, `store` with an expiry, the purge, the eviction, `NonceStoreResult`, and the capacity check.
- `packages/aggregation/src/service/inbox-buffer.ts`: the generic payload, the `<epoch>-<seq>` ids, and `since`.
- `packages/aggregation/src/service/http-server.ts`:
  - the shape checks, the safe `extractPath`, and the catch of `handleRequest` and `handleSse`;
  - `#admit`, `#noteEviction`, and one clock value for each request;
  - `#refreshForDelivery` and `#signAgain` for the inbox and the local advert;
  - the `to` check and `local_advert` of `POST /v1/adverts`;
  - the flatten, and the JSDoc of `clockSkewSec` and `now`.
- `packages/aggregation/src/participant/http-client.ts`:
  - `parseBaseUrl`, `isLoopbackHost`, and `allowInsecureHttp`;
  - `redirect: 'manual'` and the fetch wrapper;
  - the resume id, the backoff, and `maxSseEventBytes` with the inbox skip by id;
  - the event checks, the handler catches, the loop catches, the safe logger helpers, `readErrorBody`, and the flatten;
  - the JSDoc.
- `packages/aggregation/src/participant/sse-stream.ts`: `SseParseOptions`, `RECOMMENDED_MAX_SSE_EVENT_BYTES`, the byte line buffer, the LF scan, the BOM rule, the rule at the end of the stream, and `SSE_EVENT_TOO_LARGE` with `eventId`.
- `packages/aggregation/src/core/transport/nostr.ts`:
  - the send rules and `MESSAGE_TOO_LARGE`;
  - the kind 1059 directed filter and the receive guards;
  - `#guardEventHandler`, the handler catches, the safe logger helpers, and the resolver catch;
  - the flatten and the JSDoc, with the corrected `@throws` tags of `registerActor`, `unregisterActor`, and `#subscribeDirected`.
- `packages/method/src/core/did-sender-resolver.ts`: the JSDoc of `resolveBtcr2SenderPk` (decision 9).
- `packages/aggregation/tests/aggregation-transport-hardening.spec.ts` (new): the malformed input of the server and the client, the loop failures, and the logger throws.
- `packages/aggregation/tests/aggregation-nostr-transport.spec.ts` (new): the Nostr send rules, the plaintext limit, the receive guards, and a full cohort with the runners.
- `packages/aggregation/tests/aggregation-http-server.spec.ts`, `aggregation-http-nonce-cache.spec.ts`, `aggregation-http-inbox-buffer.spec.ts`, `aggregation-http-envelope.spec.ts`, and `aggregation-http-request-auth.spec.ts`: the order, the entry life, the eviction warn line, the delivery signature, the ids, and the nonce rule.
- `packages/aggregation/tests/aggregation-http-client.spec.ts`, `aggregation-http-sse-stream.spec.ts`, and `aggregation-http-parity.spec.ts`: the base URL, the redirects, the resume id, the backoff, the size limit, the inbox skip, and the parser rules.
- `packages/aggregation/tests/aggregation-transport-sender-auth.spec.ts` and `aggregation-x1-transport-auth.spec.ts`: an https base URL, the kind 1059 opt-in, the server clock in the bootstrap, and the outer body.
- `packages/method/docs/http-transport.md`:
  - the server checks and their order, and the replay cache;
  - the advert route with `local_advert`, and the inbox delivery and resume;
  - the server config: `maxBodyBytes`, `resolveSenderPk`, and `now`;
  - the client config: `baseUrl`, `allowInsecureHttp`, `fetchImpl` with `redirect: 'manual'`, `clockSkewSec`, `reconnectBackoff`, `maxSseEventBytes`, and `resolveSenderPk`;
  - the size limit, with the inbox skip and the Bun sentence;
  - the limitations and the paths of the demo scripts.
- `packages/method/docs/aggregation.md`:
  - NIP-44 v2 for each Nostr message with a recipient, and the cohort size limit of Nostr;
  - the relay text: kind 1059, the NIP-59 AUTH guard, and the metadata;
  - the HTTP resume and the delivery signature;
  - the genesis key after a rotation.
- `packages/method/README.md`: the genesis key after a rotation.
- `packages/aggregation/README.md`: the https rule of the HTTP client and ADR 153 in the list of design records.

## References

- did:btcr2 specification: [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html), [Conformance](https://dcdpr.github.io/did-btcr2/conformance.html), [Security Considerations](https://dcdpr.github.io/did-btcr2/appendix/security-considerations.html), and [Privacy Considerations](https://dcdpr.github.io/did-btcr2/appendix/privacy-considerations.html).
- [HTML Living Standard, Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html): 9.2.4 and 9.2.6.
- [W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/): 3.1 and 5.2.
- [Fetch Standard](https://fetch.spec.whatwg.org/): the `Request` constructor and the redirect mode.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110): 15.5.1, 15.5.10, and 15.6.1. [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585): 4.
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md), and [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md).
- [Cloudflare workerd, `src/workerd/api/http.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B): the redirect modes of the Workers fetch.
- [ADR 008](008-aggregation-subsystem-inception.md), [ADR 029](029-tls-only-confidentiality.md), [ADR 030](030-fetch-based-sse.md), [ADR 032](032-sans-io-server-primitives.md), [ADR 066](066-x1-transport-authentication.md), [ADR 090](090-aggregation-transport-sender-authentication.md), and [ADR 152](152-the-aggregation-checks-bind-to-the-beacon-type-the-membership-and-the-beacon-output-of-the-cohort-and-the-service-checks-only-the-update-sender.md).
