/* Optional site defaults. The parent settings panel overrides these and keeps
   the API key in this browser's localStorage — nothing is sent anywhere else. */
window.WINNIE_CONFIG = {
  geminiKey: "",
  geminiModel: "gemini-3.8-flash",
  geminiModels: [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash"
  ],
  aiEnabled: true,
  voice: "teacher",
  sfx: true
};
