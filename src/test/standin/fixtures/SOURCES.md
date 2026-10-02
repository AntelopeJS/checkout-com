# Stand-in fixtures

Every body the stand-in answers with starts from one of these files and
overrides only the fields a request decides (ids, amounts, status, links).
Each is copied verbatim from Checkout.com's documentation, fetched
2026-10-02. Spec locations refer to the OpenAPI document at
https://api-reference.checkout.com/v1/swagger.json (info.version v1.0.0).

| Fixture                        | Source                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| payment-201.json               | swagger.json: paths."/payments".post.responses.201.content."application/json".examples.PaymentResponse.value                                                                                         |
| payment-202-redirect.json      | https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-using-the-payments-api (fetched 2026-10-02) -- "Request a payment with a token" 202 response example (3DS redirect)          |
| payment-201-declined.json      | https://www.checkout.com/docs/developer-resources/testing/test-cards (fetched 2026-10-02) -- Response code tests: response example (Declined, 20051; no response_summary)                            |
| payment-details.json           | https://www.checkout.com/docs/payments/manage-payments/get-payment-details (fetched 2026-10-02) -- Get payment details response example 1 (card, Captured, 3DS challenged)                           |
| payment-actions.json           | https://www.checkout.com/docs/payments/manage-payments/get-payment-actions (fetched 2026-10-02) -- Get payment actions response example 1 (Refund/Capture/Authorization)                             |
| void-202.json                  | https://www.checkout.com/docs/payments/manage-payments/void-a-payment (fetched 2026-10-02) -- void 202 response example                                                                              |
| refund-202.json                | https://www.checkout.com/docs/payments/manage-payments/refund-a-payment/refund-a-payment-with-a-reference (fetched 2026-10-02) -- refund 202 response example                                        |
| refund-422-declined.json       | https://www.checkout.com/docs/payments/manage-payments/refund-a-payment/refund-a-payment-with-a-reference (fetched 2026-10-02) -- "Refund authorization" 422 example (refund_authorization_declined) |
| customer-201.json              | https://www.checkout.com/docs/payments/store-and-manage-credentials/store-credentials/customers -- create customer 201 example                                                                       |
| customer-details.json          | same page -- get customer details 200 example                                                                                                                                                        |
| customer-422-email-exists.json | same page -- duplicate email 422 example                                                                                                                                                             |
| instrument-201.json            | swagger.json: paths./instruments.post.responses.201 examples[card]                                                                                                                                   |
| token-201.json                 | swagger.json: paths./tokens.post.responses.201 examples[card]                                                                                                                                        |
| hosted-201.json                | swagger.json: components.schemas.HostedPaymentsResponse.example                                                                                                                                      |
| hosted-pending.json            | https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-on-a-hosted-page/manage-your-hosted-payments-page -- Payment Pending example                                                 |
| hosted-received.json           | same page -- Payment Received example                                                                                                                                                                |
| payment_approved.json          | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_approved -- Example webhook                                                                                |
| payment_captured.json          | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_captured -- Example webhook                                                                                |
| payment_declined.json          | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_declined -- Example webhook                                                                                |
| payment_voided.json            | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_voided -- Example webhook                                                                                  |
| payment_refunded.json          | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_refunded -- Example webhook                                                                                |
| payment_refund_declined.json   | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_refund_declined -- Example webhook                                                                         |
| dispute_received.json          | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/dispute_received -- Example webhook                                                                                |
| payment_pending.json           | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_pending -- Example webhook                                                                                 |
| card_verified.json             | https://www.checkout.com/docs/developer-resources/event-notifications/event-types/card_verified -- Example webhook                                                                                   |
