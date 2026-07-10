/**
 * Beispiel: Patchnote an FCM Tokens senden mit Firebase Admin SDK.
 *
 * Installation lokal/serverseitig:
 * npm install firebase-admin
 *
 * Secrets niemals ins GitHub Repo einchecken:
 * GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json node send-patchnote-node.mjs
 *
 * Dieses Beispiel erwartet eine tokens.json mit:
 * ["FCM_TOKEN_1", "FCM_TOKEN_2"]
 */
import { readFile } from "node:fs/promises";
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "eskyna-style",
});

const tokens = JSON.parse(await readFile(new URL("./tokens.json", import.meta.url), "utf8"));

const message = {
  tokens,
  notification: {
    title: "EStyle Patchnotes",
    body: "Neue Verbesserungen in deiner EStyle Analyse sind verfuegbar.",
  },
  data: {
    url: "https://eskyna.com/app/#welcome",
    tag: `patchnotes-${new Date().toISOString().slice(0, 10)}`,
  },
  webpush: {
    fcmOptions: {
      link: "https://eskyna.com/app/#welcome",
    },
  },
};

const response = await admin.messaging().sendEachForMulticast(message);
console.log(`Gesendet: ${response.successCount}, Fehler: ${response.failureCount}`);
