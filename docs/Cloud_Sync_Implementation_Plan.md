# Plan: Cloud Sync Implementation (Supabase + Clerk)

**Goal:** Automatically and silently synchronize completed recordings (metadata, plain-text transcript, Markdown summary) from the mobile app to a cloud backend (Supabase) associated with the authenticated user (Clerk), making the data available for a companion desktop app.

---

## 1. Backend & Cloud Storage (Supabase)

*   **Provider:** Supabase
*   **Database:** PostgreSQL
    *   **Action:** Create a `recordings` table.
    *   **Columns (Suggested):**
        *   `id` (UUID or Text, Primary Key - Matches mobile recording ID)
        *   `user_id` (UUID or Text - Foreign Key to auth users, **Crucial for RLS**)
        *   `title` (Text)
        *   `recorded_at` (TimestampTZ - Store the original recording date/time)
        *   `duration_seconds` (Integer)
        *   `transcript_text` (Text - Store the plain text transcript)
        *   `summary_markdown` (Text - Store the cleaned Markdown summary)
        *   `processing_status` (Text - e.g., 'complete', 'pending', 'error' - mirrors mobile)
        *   `created_at` (TimestampTZ, default `now()`)
        *   `updated_at` (TimestampTZ, default `now()`)
        *   `audio_file_path` (Text, nullable - For potential future audio sync)
    *   **Action:** Enable Row Level Security (RLS) on the `recordings` table.
    *   **Action:** Define RLS Policies:
        *   **INSERT:** Allow insert only if `user_id` matches the `auth.uid()` from the verified JWT.
        *   **SELECT:** Allow select only if `user_id` matches `auth.uid()`.
        *   **UPDATE:** Allow update only if `user_id` matches `auth.uid()`.
        *   **DELETE:** Allow delete only if `user_id` matches `auth.uid()`.
*   **File Storage (Optional Future):** Supabase Storage can be used later if audio file sync is desired.

---

## 2. Authentication (Clerk)

*   **Provider:** Clerk
*   **Mobile Integration:**
    *   **Action:** Integrate the `@clerk/clerk-react-native` SDK.
    *   **Action:** Implement Login/Signup UI flows using Clerk components or hooks.
    *   **Action:** Manage user authentication state within the app (e.g., using context or state management).
    *   **Action:** Access the current user's session token (JWT) via the Clerk SDK (`session.getToken({ template: 'supabase' })`).
*   **Backend Integration (Supabase):**
    *   **Action:** Configure Supabase Project's JWT Authentication settings (under Auth -> Settings -> JWT) to use Clerk's public keys/issuer details. This allows Supabase to verify Clerk JWTs automatically. Refer to Clerk's Supabase integration documentation for specifics.

---

## 3. API Layer / Mobile-Backend Interaction (Supabase Client)

*   **Tool:** Supabase JavaScript Client SDK (`@supabase/supabase-js`).
*   **Action:** Install and initialize the Supabase client in the mobile app (e.g., in a central config or service file) using your Supabase project URL and anon key.
*   **Authentication Flow:**
    1.  User logs in via Clerk.
    2.  Get the Supabase-compatible JWT from the Clerk session (`session.getToken({ template: 'supabase' })`).
    3.  When making Supabase client calls (`supabase.from(...)`), set the Authorization header globally or per-request: `supabase.auth.setAuth(clerkSupabaseToken)`.
    4.  Supabase verifies the token using the configured Clerk settings and enforces RLS policies based on the `user_id` embedded in the token.

---

## 4. Mobile Sync Logic

*   **Trigger Point:** After summarization completes successfully AND the updated recording data (including summary) is saved locally via `updateRecording`.
*   **Location:** Modify the function/code block that handles the successful summarization result (likely in `TranscriptionService.js` or where the 'complete' status update happens).
*   **Data Formatting:**
    *   **Transcript:** Ensure only the plain text version is extracted/sent.
    *   **Summary:** Use the cleaned Markdown version (using `cleanSummaryMarkdown` from `ShareUtils.js`).
*   **Implementation:**
    *   **Action:** Create `src/services/SyncService.js`.
    *   **Action:** Inside `SyncService.js`:
        *   Import the initialized `supabase` client.
        *   Implement `async function syncRecording(clerkToken, recordingData)`:
            *   Set Supabase auth: `supabase.auth.setAuth(clerkToken)`.
            *   Extract `userId` from the Clerk token payload (requires JWT decoding or Clerk SDK helper).
            *   Prepare the `dataObject` for Supabase table, mapping `recordingData` fields to table columns (e.g., `transcript_text`, `summary_markdown`, `user_id`).
            *   Use `await supabase.from('recordings').upsert(dataObject, { onConflict: 'id' })`. Handle potential errors.
    *   **Action:** Modify the summarization completion handler:
        *   Get the Clerk Supabase token: `await session.getToken({ template: 'supabase' })`.
        *   Get the complete `recordingData` (with summary).
        *   Prepare the data (plain transcript, cleaned summary).
        *   Call `SyncService.syncRecording(token, preparedData)`.
        *   Wrap the sync call in `try...catch` for basic error logging (non-blocking).
*   **Reliability (Initial):** Implement immediate sync attempt on success. Log errors if sync fails due to network issues. Robust offline queuing can be added later if needed.

---

## 5. Implementation Steps Outline (Mobile)

1.  **Setup Supabase & Clerk:**
    *   Create Supabase project, `recordings` table, enable RLS, define policies.
    *   Set up Clerk account/application.
    *   Configure Supabase JWT Auth settings for Clerk.
    *   Install `@supabase/supabase-js`, `@clerk/clerk-react-native`.
    *   Initialize clients.
2.  **Implement Authentication:**
    *   Add Clerk `SignedIn`, `SignedOut` components.
    *   Integrate Clerk login/signup UI.
    *   Manage auth state.
3.  **Create `SyncService.js`:**
    *   Implement `syncRecording` function using Supabase client `upsert`.
    *   Include logic to extract `userId` from Clerk token.
    *   Handle data mapping/formatting.
4.  **Modify Summarization Completion Handler:**
    *   Find the code block where the summary is successfully received and `updateRecording` is called.
    *   Add logic *after* local save: get Clerk token, prepare sync data, call `SyncService.syncRecording`.
5.  **Error Handling:**
    *   Add `try...catch` around the sync call for logging.
6.  **Testing:**
    *   Test login/logout.
    *   Test recording -> processing -> check Supabase dashboard for new/updated rows under the correct `user_id`.
    *   Test sync failure (e.g., turn off network) - ensure app doesn't crash and logs error.
