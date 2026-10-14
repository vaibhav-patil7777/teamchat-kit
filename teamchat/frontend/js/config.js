/*
 * ===== BACKEND ADDRESS =====
 * LOCAL: leave this file as it is. When the frontend is opened from the Django server
 * (http://localhost:8000) it automatically talks to that same server.
 *
 * NETLIFY: before deploying set your backend (Render) address below, e.g.
 *   API_BASE: "https://teamchat-api.onrender.com/api"
 *   WS_URL:   "wss://teamchat-api.onrender.com/ws/"
 */
const PROD = {
  API_BASE: "",
  WS_URL: ""
};

window.APP_CONFIG = PROD.API_BASE
  ? PROD
  : {
      API_BASE: location.origin + "/api",
      WS_URL: (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/"
    };
