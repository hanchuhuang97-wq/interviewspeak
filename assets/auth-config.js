/* Public browser config for the Supabase login gate.
 *
 * Fill these from: Supabase dashboard > Project Settings > API
 *   - Project URL
 *   - anon / public key   (this key is safe to ship in a static page)
 *
 * Username login: Supabase signs users in with an email. The page silently
 * maps "winnie01" to "winnie01@students.winnie-garden.app". Disable
 * Authentication > Email > Confirm email, because that synthetic mailbox
 * does not receive mail. Change usernameDomain if you prefer another domain.
 *
 * Do NOT put the service_role key or a Gemini/OpenAI API key here — this file
 * is public. For local previews only, set enabled: false. Turn it back on
 * before deploying so students see the login gate.
 */
window.WINNIE_AUTH = {
  enabled: true,
  supabaseUrl: "https://epdawhkwjgbalulhcodd.supabase.co",
  supabaseAnonKey: "sb_publishable_yTmqnDZcz2gZUm6T76TF_Q_BeVfkbPH",
  usernameDomain: "students.winnie-garden.app",
  allowSignUp: true
};
