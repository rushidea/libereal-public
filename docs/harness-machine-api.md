# Harness machine API

The website owns business records and validates every operation. An external worker calls over HTTPS using `x-libereal-harness-token`, `x-libereal-harness-client-id`, and `x-libereal-harness-env`. Grant each client only the scopes and objects it needs. The API uses its own machine credentials and scopes. Existing website staff approvals, MFA, and evidence remain authoritative.

## Route and scope matrix

All paths below are relative to `/api/internal/harness`.

| Method | Path | Scope | Effect |
| --- | --- | --- | --- |
| GET | `/events` | `events.read` | List pilot approval and feedback events |
| GET | `/inquiries/[id]/context` | `inquiry.read` | Read inquiry context |
| GET | `/inquiries/[id]/feedback` | `inquiry.read` | Read feedback |
| GET | `/inquiries/[id]/status` | `inquiry.read` | Read inquiry and reconciliation status |
| GET | `/inquiries/[id]/supplier-evidence` | `inquiry.read` | Read supplier evidence |
| POST | `/inquiries/[id]/quote-preview` | `inquiry.quote.preview` | Preview the quote |
| POST | `/inquiries/[id]/supplier-review` | `inquiry.supplier_review.prepare` | Prepare a review task with version and idempotency checks |
| POST | `/inquiries/[id]/lease/claim` | `inquiry.lease` | Claim a fenced lease |
| POST | `/inquiries/[id]/lease/release` | `inquiry.lease` | Complete or cancel the current lease |
| GET | `/inquiries/[id]/pricing-context` | `pricing.read` | Read scoped pricing facts |
| POST | `/inquiries/[id]/pricing-impact-preview` | `pricing.impact.preview` | Preview price impact |
| GET | `/orders/[id]/context` | `order.read` | Read approval and credit facts |
| POST | `/orders/[id]/merchant-approval-preview` | `order.approval.preview` | Preview merchant acceptance constraints |
| GET | `/orders/[id]/purchase-workspace` | `purchase.read` | Read purchase facts |
| POST | `/orders/[id]/purchase-preparation-preview` | `purchase.prepare.preview` | Preview purchase requirements |
| POST | `/orders/[id]/supplier-payment-preview` | `purchase.payment.preview` | Preview supplier payment constraints |
| POST | `/orders/[id]/supply-change-preview` | `purchase.supply_change.preview` | Preview supply change scope |
| GET | `/orders/[id]/fulfillment-context` | `fulfillment.read` | Read parcels, batches, and receipts |
| POST | `/orders/[id]/fulfillment-event-preview` | `fulfillment.event.preview` | Preview dispatch and physical receipt scope |
| GET | `/orders/[id]/finance-context` | `finance.read` | Read balances, allocations, and invoice plans |
| POST | `/orders/[id]/finance-action-preview` | `finance.action.preview` | Preview allocation, invoicing, or supplier reconciliation |
| GET | `/after-sale-cases/[id]/context` | `after_sale.read` | Read an after-sale case and its original evidence |
| POST | `/after-sale-cases/[id]/action-preview` | `after_sale.action.preview` | Preview return, exchange, resend, or refund constraints |

Standard inquiry and event routes use the configured `pilotInquiryIds` when present. Pricing requires the client's `pilotPricingInquiryIds` and honors the global inquiry restriction. Order routes require the client's `pilotOrderIds`. Case routes require the client's `pilotAfterSaleCaseIds`. A parent grant does not authorize a child belonging to another object.

Pricing, order, purchase, fulfillment, finance, and after-sale previews are read-only. For these routes, use the `objectVersion` returned for the relevant parent or selected purchase and pass it as `expectedVersion`. The idempotency key is the SHA-256 of the UTF-8 JSON array `[tool, objectId, bodyWithoutIdempotencyKey]` with recursively sorted object keys and array order preserved. A successful preview echoes that key as `requestKey`. The same key binds intent. Checks on current shared state, such as waybill ownership, still run on every request. A preview can return business blockers in a 200 response. It does not record a dispatch, payment, invoice, refund, or approval.

## Operational checks

Start event polling with a verified UTC `since` and then use the returned `nextCursor`. Cursors are specific to the client, environment, and inquiry scope. On 409, reconcile the source and saved receipt before selecting a new boundary. An authentication probe can read `GET /events` with a current UTC `since` and `limit=1`.

During rollback, stop new claims and revoke the relevant machine client or disable the API in the target environment through the existing deployment controls. Revocation returns 403 and disablement returns 503. A writer presenting an invalidated lease and fencing token receives a conflict. Retain existing records and reconcile any unknown result before giving a different worker ownership.
