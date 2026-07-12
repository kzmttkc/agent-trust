const ERROR_MESSAGES: Record<string, string> = {
  invalid_api_key: "Invalid API key. Check the key and try again.",
  dashboard_requires_database_api_key:
    "Dashboard requires a database-backed API key. Create one with npm run api-key:create.",
  session_required: "Your session expired. Please sign in again.",
  invalid_origin: "Request blocked for security. Use the dashboard from the same site.",
  invalid_request: "Invalid request. Please check your input.",
  connection_failed: "Could not connect to the server. Try again.",
  session_expired: "Your session expired. Please sign in again.",
  rate_limit_exceeded: "Monthly API quota exceeded. Upgrade your plan or wait until next month.",
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
  billing_not_configured: "Billing is not available in this environment.",
  checkout_failed: "Could not start checkout. Try again.",
  portal_failed: "Could not open billing portal.",
  email_already_registered: "This email is already registered. Sign in instead.",
  invalid_invite_code: "Invalid invite code.",
};

export function dashboardErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please try again.";
}
