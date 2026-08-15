const ERROR_MESSAGES: Record<string, string> = {
  invalid_api_key: "Invalid API key. Check the key and try again.",
  dashboard_requires_database_api_key:
    "This key cannot open the dashboard. Create a key from the signup page.",
  session_required: "Your session expired. Please sign in again.",
  invalid_origin: "Request blocked for security. Use the dashboard from the same site.",
  invalid_request: "Invalid request. Please check your input.",
  connection_failed: "Could not connect to the server. Try again.",
  session_expired: "Your session expired. Please sign in again.",
  rate_limit_exceeded: "Monthly quota used. Upgrade on Billing, or wait until next month.",
  database_unavailable: "Database is temporarily unavailable. Try again shortly.",
  service_unavailable: "Service is temporarily unavailable.",
  key_limit_reached: "You have reached the maximum number of active API keys (10). Revoke an unused key first.",
  cannot_revoke_active_session_key:
    "Sign out first, then revoke this key from another active session or create a new key.",
  duplicate_list_entry: "This wallet is already on your list.",
  import_failed: "CSV import failed. Check the format and try again.",
  no_valid_entries: "No valid wallet addresses found in the CSV.",
  csv_too_large: "CSV exceeds the maximum number of entries.",
  scoring_unavailable: "Scoring is temporarily unavailable. Try again shortly.",
  operator_policy: "Access restricted by operator policy.",
  billing_not_configured: "Paid upgrades are not available on this deploy.",
  checkout_failed: "Could not start checkout. Try again.",
  portal_failed: "Could not open billing portal.",
  email_already_registered:
    "This email is already registered. Sign in with your existing key, or email support to replace it.",
  invalid_invite_code:
    "Invalid invite code. If you were not given one, email support@vet402.com — signup is invite-only when that field is shown.",
  already_on_plan: "You are already on that plan.",
  agent_id_or_wallet_required: "Enter a payee wallet, or a payer agent ID.",
  invalid_wallet_address: "That is not a valid wallet address.",
  invalid_agent_id: "That is not a valid agent ID.",
  account_not_found: "No account is attached to this key.",
  please_accept_the_terms_and_privacy_policy:
    "Tick the agreement checkbox, then submit again.",
  signup_failed: "Could not create the account. Try again.",
};

export function dashboardErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please try again.";
}
