"""Print the OpenAPI schema, so the frontend can generate types without a running server."""

import json

from app.main import app

print(json.dumps(app.openapi(), indent=2))
