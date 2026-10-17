# Golfzon Brooklyn: simulator booking feasibility

Investigated October 17, 2026. Local scaffold at `/#simulators`; not deployed.

## Decision

Use a Courses / Simulators switch on the search screen. Golfzon bays are hourly sessions for a group, not outdoor tee times with remaining player spots. Keep their search and checkout separate, and reuse existing buttons, sliders, and review drawers.

The minimum useful flow is implemented: choose a day, 1–6 guests and a 30–240 minute session; fetch live options; filter start times locally; review a time, provider rate, card requirement and cancellation terms; continue to the venue's SevenRooms page with the date, guests, duration and preferred time prefilled. The guest selects the time/rate and confirms the reservation on SevenRooms. Our app never claims that opening the provider confirms a booking.

No new services, packages, database tables, credentials, browser bots, or background jobs are needed for this scaffold. Simulator alerts and group-game integration are outside this spike.

## Verified evidence

- The [venue's official page](https://golfzonsocial.com/locations/brooklyn/) identifies 15 Hoyt Street, per-bay pricing and up to six people per bay.
- The [live SevenRooms booking page](https://www.sevenrooms.com/explore/golfzonsocialbrooklyn/reservations/create/search) supports guest count, date, time and duration. Its UI offers 30-minute increments from 30 minutes through four hours.
- A read-only HTTP request to the availability endpoint used by SevenRooms' own current widget returned HTTP 200 without login or API credentials. A query for October 18, four guests and 90 minutes returned 24 bookable options at the time of investigation. This is a transient observation, not inventory promised to users.
- Verified the destination UI actually selected October 18, four guests, 90 minutes and 10 a.m. from the handoff parameters. No hold or reservation was created.
- Verified the local Worker and mobile UI return actual live options, filter them, and show provider cancellation/card information before handoff. Request-only entries can have null fields; these are excluded without losing bookable entries.

The observed read endpoint is `https://www.sevenrooms.com/api-yoa/availability/ng/widget/range`. It is a widget implementation detail, not a documented partner API contract. Requests fix the venue to `golfzonsocialbrooklyn`, bound dates and duration, and never accept an arbitrary upstream URL. Queries run only on an explicit search, with a 15-second provider timeout. Responses are validated; failures are reported separately from zero availability. No raw provider HTML, guest data, cookies, session tokens or internal booking IDs are returned to the client.

## Automatic booking

Not established and not implemented. A user's email or consumer login is not evidence of access to SevenRooms' integration API. The [official API documentation](https://api-docs.sevenrooms.com/) requires individually provisioned accounts and directs new integrations to its partnership process. [SevenRooms describes booking integrations](https://sevenrooms.com/platform/integrations-apis/), but the permitted endpoints and Golfzon venue scope must be confirmed through that process.

Observed bookable options require a credit card and carry late-cancellation/no-show terms. An email-only auto-booking promise would be premature. Keep the existing provider checkout for MVP, where the guest reviews the final price, any prorating/fees and current terms, and supplies payment details directly to SevenRooms.

If venue-approved API access becomes available, extend this one provider module rather than build a job platform. Before any booking write: recheck the exact slot and final price/terms; show the guest a concrete confirmation; use the provider's supported duplicate-prevention and hold semantics; and mark confirmed only after a provider confirmation identifier. Clarify ambiguous timeouts before allowing a retry. Credentials must be Worker secrets; payment details should stay with the provider. Booking writes, financial transactions and agreement acceptance have not been exercised in this spike.

## Success criteria and remaining gates

- Completed locally: simulator entry in search, date/guest/duration selection, live availability, immediate time filtering, accurate unavailable/error states, review drawer and prefilled provider handoff.
- Completed verification: parser/request tests, query bounds, failure behavior, request-only/null entries, distinct rates at the same time, no booking endpoint, and UI review/filtering tests.
- Before production: verify SevenRooms permits this access pattern, test outgoing requests from the deployed Cloudflare Worker, and verify the complete guest checkout manually without creating an unwanted reservation. The widget endpoint may change or block requests; the direct provider link remains the fallback.
- Not delivered: automatic booking, automatic confirmation reconciliation, simulator push alerts, member-only rates or multi-bay reservations.


## Automatic-booking follow-up

The product acceptance criterion is now a confirmed booking, not availability alone. Keep the scaffold local until a controlled end-to-end booking proves the venue-specific flow. No booking or hold was created during this research.

The earlier recommendation was too conservative about the available technical routes: official partner API access and public guest checkout automation are separate paths. Partner credentials are required for the former; their absence does not establish that the latter is impossible.

Research sources:

- [Reddit: SevenRooms integration discussion](https://www.reddit.com/r/n8n/comments/1rlt5s4/anyone_integrating_with_open_table_or_seven_rooms/): a commenter reports using the official API and says access requires an API contract or integrator arrangement. This is anecdotal, consistent with the official documentation gate.
- [Reddit: WhatsApp and SevenRooms bookings](https://www.reddit.com/r/restaurant/comments/1p28060/anyone_using_a_tool_to_connect_sevenrooms_with/): reports of automated venue integrations, but not reproducible Golfzon consumer-checkout evidence.
- [Public browser-booking implementation](https://github.com/Jeffligit/reservation_bot): combines public availability calls with Playwright/Chromium to fill guest and payment fields and submit. Its source does not prove provider-confirmed success and is not Golfzon-specific. Do not adopt its raw-card environment storage or automatic acceptance of every checkbox.
- [Reported direct HTTP implementation](https://github.com/PolyAI-LDN/sevenrooms-api): search-indexed documentation describes a hold/confirm widget wrapper for Dishoom. The repository returned 404 during direct inspection, so treat its current functionality as unverified.
- [Cloudflare Playwright support](https://developers.cloudflare.com/browser-run/playwright/): a browser implementation can remain within Cloudflare using a browser binding and `@cloudflare/playwright`; a separate always-on VM is not inherently required.

Read-only inspection of SevenRooms' current official widget code confirms separate hold and booking operations, optional bearer-token headers in those operations, checkout-validation headers, payment setup/intent operations, and CAPTCHA-related handling. This establishes technical routes, not a guarantee that Golfzon accepts a guest booking without authentication. An attempt to read a separate widget-settings endpoint returned 401; it was not bypassed. Golfzon-specific guest-login, saved-card reuse and challenge behavior remain unverified.

Lean next spike: inspect the real guest checkout in a normal browser up to final review, determine the required session/payment/challenge steps, and then perform one explicitly approved real booking for a session the user actually wants. Success requires the exact venue, date, start, duration, guest count and accepted total/terms, plus a provider confirmation identifier and matching confirmation message. A click, HTTP 200, temporary hold, or submitted form is insufficient. An ambiguous response must not trigger another booking attempt automatically.

If direct authenticated guest requests work, reuse Worker fetch and D1 for an idempotent booking record; no scraping or orchestration package is inherently necessary. If browser execution is required, add one browser binding/package and isolate sessions per user. Challenges and payment verification may still require user action. Fully unattended scheduling remains a separate acceptance test from a booking the user approves and completes now.
