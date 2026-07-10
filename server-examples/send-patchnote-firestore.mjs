/**
 * Sendet EStyle Patchnotes an alle FCM Tokens aus Cloud Firestore.
 *
 * Lokaler Test:
 *   npm install firebase-admin
 *   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
 *   PATCH_TITLE="EStyle Update" \
 *   PATCH_BODY="Neue Analyse-Verbesserungen sind live." \
 *   node send-patchnote-firestore.mjs
 *
 * GitHub Actions:
 *   Service-Account JSON als Base64 in FIREBASE_SERVICE_ACCOUNT_BASE64 speichern.
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const serviceAccount = parseServiceAccountFromEnv();
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || "eskyna-style";
const collectionName = process.env.FCM_TOKENS_COLLECTION || "fcmTokens";
const title = process.env.PATCH_TITLE || "EStyle Update";
const body = process.env.PATCH_BODY || "Neue Verbesserungen in deiner EStyle App sind verfuegbar.";
const link = process.env.PATCH_URL || "https://eskyna.com/app/#welcome";

const app = initializeFirebaseAdmin(projectId, serviceAccount);
const db = getFirestore(app);
const messaging = getMessaging(app);
const snapshot = await getTokenSnapshot(db, collectionName, projectId);
const docs = snapshot.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((entry) => typeof entry.token === "string" && entry.token.length > 20);

if (!docs.length) {
  console.log(`Keine FCM Tokens in ${collectionName} gefunden.`);
  process.exit(0);
}

let successCount = 0;
let failureCount = 0;
const staleDocumentIds = [];

for (const batch of chunk(docs, 500)) {
  const response = await messaging.sendEachForMulticast({
    tokens: batch.map((entry) => entry.token),
    notification: { title, body },
    data: {
      title,
      body,
      url: link,
      tag: `patchnotes-${new Date().toISOString().slice(0, 10)}`,
    },
    webpush: {
      fcmOptions: { link },
    },
  });

  successCount += response.successCount;
  failureCount += response.failureCount;

  response.responses.forEach((result, index) => {
    const code = result.error?.code || "";
    if (
      code.includes("registration-token-not-registered") ||
      code.includes("invalid-registration-token")
    ) {
      staleDocumentIds.push(batch[index].id);
    }
  });
}

for (const staleId of staleDocumentIds) {
  await db
    .collection(collectionName)
    .doc(staleId)
    .delete()
    .catch(() => undefined);
}

console.log(
  `Gesendet: ${successCount}, Fehler: ${failureCount}, geloeschte stale Tokens: ${staleDocumentIds.length}`
);

function initializeFirebaseAdmin(projectId, serviceAccount) {
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function parseServiceAccountFromEnv() {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!base64) return null;

  try {
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (error) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 ist ungueltig (kein valides Base64-JSON).");
  }
}

async function getTokenSnapshot(db, collectionName, projectId) {
  try {
    return await db.collection(collectionName).get();
  } catch (error) {
    const code = String(error?.code || "");
    const notFound = code === "5" || String(error?.message || "").includes("NOT_FOUND");
    if (notFound) {
      throw new Error(
        `Firestore NOT_FOUND fuer Projekt '${projectId}'. Pruefen Sie: ` +
          "1) FIREBASE_PROJECT_ID passt zum Service Account, " +
          "2) Cloud Firestore ist im Projekt angelegt (Native Mode, Datenbank '(default)'), " +
          "3) Firestore API ist aktiviert."
      );
    }
    throw error;
  }
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
