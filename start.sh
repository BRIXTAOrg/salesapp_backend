#!/bin/bash
# 1. Load the credentials and Project ID from the .env  or .env.production file
export $(grep -v '^#' .env | xargs)
# 2. Safety check
if [ -z "$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" ] || [ -z "$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" ] || [ -z "$INFISICAL_PROJECT_ID" ]; then
    echo "Error: Infisical credentials or Project ID are missing from .env" 
    exit 1 
fi
# 3. Start Docker Compose via Infisical (Notice the new --projectId flag!)
infisical run --projectId=$INFISICAL_PROJECT_ID --env=prod -- docker compose up -d
# 4. Confirm success based on the exit code of the previous command
if [ $? -eq 0 ]; then
  echo "Containers started successfully with secure environment variables!"
else
  echo "Failed to start containers. Check the Infisical output above."
fi
