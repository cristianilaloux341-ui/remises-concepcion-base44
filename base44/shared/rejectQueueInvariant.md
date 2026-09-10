# Reject queue invariant

A rejected automatic offer must continue only inside the RideOrder origin zone.

Required invariant:
1. Rejecting driver is released only from the reservation belonging to this order/token.
2. Rejecting driver is recorded in offered_driver_ids and re-enters the end of its zone queue.
3. Select the oldest eligible driver by queue_entered_at in the same zone, excluding all already offered drivers.
4. Reserve the candidate before sending the push.
5. If candidate reservation loses a race, do not stop: exclude that candidate and retry the next eligible driver in the same zone.
6. Every successful reassignment gets a new assignment_attempt, reservation_token, assigned_at and full offerExpiresAt window.
7. Push is sent only after server reservation succeeds.
8. If no eligible same-zone candidates remain, set RideOrder to pendiente and clear current reservation fields.
9. Never fall back to another zone.
10. Acceptance must validate the exact current assignment_attempt/reservation_token and must not be invalidated by an older timeout chain.

Do not alter taximeter, tariffs, Pendientes/manual reservations, or driver app UI as part of this backend invariant.