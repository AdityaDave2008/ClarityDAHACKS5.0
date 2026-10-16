# Backend

Owner: Yash. Own the API, business logic, validation, persistence, migrations, and backend tests.

Agree on [the API contract](../docs/api.md) with frontend before implementing endpoints. Keep credentials server-side and read them from environment variables. Validate inputs and avoid exposing internal errors or secrets to clients.

When choosing the stack, document prerequisites and exact install, development, migration, seed, and test commands here. Add a `.env.example` containing names and safe example values only. Keep unit and integration tests beside backend code.

First milestone: a health endpoint and one real API operation used by the frontend, deployed and tested.
