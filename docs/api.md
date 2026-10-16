# API handoff agreement

Backend and frontend should fill in this contract together before implementing the first feature. No endpoint or schema below is a claim about an existing implementation.

For each operation record:

- Method and path, purpose, and owner.
- Authentication requirements, or explicitly none.
- Example request and successful response, including field types and required fields.
- Status codes and example error responses.
- Validation rules, empty states, and any pagination.

Use the agreed examples for frontend mocks. Update examples in the same PR as API changes and notify the other contributor. Prefer a consistent error object that exposes a readable message without stack traces or secrets.

## Integration checks

- Frontend base URL is configurable and points to the correct deployed environment.
- Backend permits only intended browser origins when CORS is needed.
- Loading, success, empty, invalid-input, and server-failure paths are exercised.
- Seed data is safe and reproducible.
- Real requests work end to end, not only mocks.
