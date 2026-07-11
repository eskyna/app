import { writeFileSync } from "node:fs";

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readFirebaseFromJson() {
  const raw = readEnv("FIREBASE_WEB_CONFIG");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      apiKey: String(parsed.apiKey || ""),
      authDomain: String(parsed.authDomain || ""),
      projectId: String(parsed.projectId || ""),
      storageBucket: String(parsed.storageBucket || ""),
      messagingSenderId: String(parsed.messagingSenderId || ""),
      appId: String(parsed.appId || ""),
      measurementId: String(parsed.measurementId || ""),
    };
  } catch (error) {
    throw new Error("FIREBASE_WEB_CONFIG ist kein gueltiges JSON.");
  }
}

function readProjectIdFromServiceAccount() {
  const base64 = readEnv("FIREBASE_SERVICE_ACCOUNT_BASE64");
  if (!base64) return "";

  try {
    const json = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    return String(json.project_id || "");
  } catch (error) {
    return "";
  }
}

function fillDerivedFirebaseFields(firebaseConfig) {
  if (!firebaseConfig.projectId) {
    firebaseConfig.projectId = readProjectIdFromServiceAccount();
  }

  if (!firebaseConfig.authDomain && firebaseConfig.projectId) {
    firebaseConfig.authDomain = `${firebaseConfig.projectId}.firebaseapp.com`;
  }

  if (!firebaseConfig.storageBucket && firebaseConfig.projectId) {
    firebaseConfig.storageBucket = `${firebaseConfig.projectId}.firebasestorage.app`;
  }

  return firebaseConfig;
}

const fromJson = readFirebaseFromJson();
const firebaseConfig = fillDerivedFirebaseFields({
  apiKey: readEnv("FIREBASE_API_KEY") || fromJson?.apiKey || "",
  authDomain: readEnv("FIREBASE_AUTH_DOMAIN") || fromJson?.authDomain || "",
  projectId: readEnv("FIREBASE_PROJECT_ID") || fromJson?.projectId || "",
  storageBucket: readEnv("FIREBASE_STORAGE_BUCKET") || fromJson?.storageBucket || "",
  messagingSenderId:
    readEnv("FIREBASE_MESSAGING_SENDER_ID") || fromJson?.messagingSenderId || "",
  appId: readEnv("FIREBASE_APP_ID") || fromJson?.appId || "",
  measurementId: readEnv("FIREBASE_MEASUREMENT_ID") || fromJson?.measurementId || "",
});

const fcmVapidKey = readEnv("FIREBASE_FCM_VAPID_KEY", "FIREBASE_WEB_PUSH_VAPID_KEY");

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
  throw new Error(
    "Firebase Web Config unvollstaendig. Mindestens FIREBASE_API_KEY und FIREBASE_PROJECT_ID oder FIREBASE_SERVICE_ACCOUNT_BASE64 sind noetig."
  );
}

const config = {
  appBasePath: "/app/",
  pwaStartUrl: "/app/#welcome",
  apiEndpoint: "https://api.eskyna-style.workers.dev/v1/images",
  demoMode: false,
  uploadMode: "binary",
  contentType: "application/octet-stream",
  credentials: "same-origin",
  maxUploadWidth: 1600,
  jpegQuality: 0.88,
  timeoutMs: 60000,
  maxPhotos: 4,
  multiPhotoUploadMode: "multipart",
  push: {
    enabled: true,
    provider: "firebase-cloud-messaging",
    fcmVapidKey,
    tokenStorage: "firestore",
    fcmTokensCollection: "fcmTokens",
    registerTokenEndpoint: "",
    unregisterTokenEndpoint: "",
    topic: "patchnotes",
    attachIdTokenToRegisterRequest: true,
  },
  auth: {
    enabled: true,
    required: true,
    provider: "firebase",
    firebaseSdkVersion: "12.15.0",
    allowedProviders: ["google"],
    signInMode: "popup",
    redirectAfterLogin: "create",
    attachIdTokenToAnalysisRequest: false,
    firebaseConfig,
  },
};

const jsValue = JSON.stringify(config, null, 2).replace(/"([^"]+)":/g, "$1:");
const source = `// Generated during deploy. Do not edit on the server.
(function initEskynaConfig(globalScope) {
  const config = ${jsValue};
  globalScope.ESKYNA_CONFIG = config;
})(typeof self !== "undefined" ? self : window);
`;

writeFileSync("config.js", source, "utf8");
console.log("config.js erzeugt.");
