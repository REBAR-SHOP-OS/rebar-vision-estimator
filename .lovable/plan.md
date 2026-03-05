

## Fix: Update GOOGLE_VISION_SA_KEY with Correct Service Account JSON

### Problem
The `GOOGLE_VISION_SA_KEY` secret currently contains an incorrect value (either a 40-char hex string or an OAuth client secret). The correct Service Account JSON has been uploaded as `rebar-shop-floor-a510c960e1d0-2.json`.

### Plan
1. **Update the secret** using the secrets tool with the full JSON content from the uploaded Service Account key file (the one containing `"type": "service_account"`, `client_email`, and `private_key`).
2. **Verify** by calling the `ai-diagnostics` edge function to confirm the Vision probe passes.

### Security Note
The private key in this service account was visible in the chat. After confirming it works, you should rotate the key in Google Cloud Console (IAM & Admin → Service Accounts → Keys → delete old key, create new one).

