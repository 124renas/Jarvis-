// Prints a VAPID key pair for Web Push. Optional: the server generates and
// stores one automatically if VAPID_* variables are not set.
import webpush from "web-push";
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
