import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from "firebase/app";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, 
    increment, serverTimestamp, collection, query, where, getDocs, runTransaction 
} from "firebase/firestore";
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN || "7763480909:AAEsTt5O3eaI72q-MuraF7qeLxKAOfKN3_c";
const REWARD_AMOUNT = 500; // Coins given to referrer
const APP_URL = "https://angkurbasfor.github.io/Telegram-Mini-App-3/";

const firebaseConfig = {
  apiKey: "AIzaSyD6Zl8zG19cC8QcfzBYKGBhCCi6ijPjGWw",
  authDomain: "telegram-mini-app-3.firebaseapp.com",
  projectId: "telegram-mini-app-3",
  storageBucket: "telegram-mini-app-3.firebasestorage.app",
  messagingSenderId: "946812486932",
  appId: "1:946812486932:web:139c3f0a86d355b287ee01"
};

// Initialize Firebase & Bot
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Express Server for health checks
const server = express();
server.get('/', (req, res) => res.send('Bot is Running!'));
server.listen(process.env.PORT || 3000);

// --- CORE FUNCTIONS ---

/**
 * Creates user in Firestore if they don't exist, or merges info.
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
    const userRef = doc(db, "users", userId.toString());
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        await setDoc(userRef, {
            id: userId.toString(),
            name: firstName,
            photoURL: photoURL || "",
            coins: 0,
            reffer: 0,
            refferBy: referralId || null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false, // Set to true by the Frontend WebApp
            rewardGiven: false,
            createdAt: serverTimestamp()
        }, { merge: true });
        console.log(`New user created: ${userId}`);
    }
}

/**
 * Processes the referral reward logic safely using a Transaction
 */
async function rewardReferrer(targetUserDoc) {
    const userData = targetUserDoc.data();
    const userId = targetUserDoc.id;
    const referrerId = userData.refferBy;

    if (!referrerId) return;

    try {
        await runTransaction(db, async (transaction) => {
            const referrerRef = doc(db, "users", referrerId.toString());
            const targetUserRef = doc(db, "users", userId.toString());
            const ledgerRef = doc(db, "ref_rewards", userId.toString());

            // 1. Update Referrer
            transaction.update(referrerRef, {
                coins: increment(REWARD_AMOUNT),
                reffer: increment(1)
            });

            // 2. Mark target user as rewarded
            transaction.update(targetUserRef, {
                rewardGiven: true
            });

            // 3. Create Ledger entry
            transaction.set(ledgerRef, {
                userId: userId,
                referrerId: referrerId,
                reward: REWARD_AMOUNT,
                createdAt: serverTimestamp()
            });
        });
        console.log(`Reward of ${REWARD_AMOUNT} given to ${referrerId} for inviting ${userId}`);
    } catch (e) {
        console.error("Transaction failed: ", e);
    }
}

// --- TELEGRAM HANDLERS ---

bot.onText(/\/start (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const referralId = match[1]; // Extracts '123' from '/start 123'
    handleStart(msg, referralId);
});

bot.onText(/\/start$/, async (msg) => {
    handleStart(msg, null);
});

async function handleStart(msg, referralId) {
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    
    // Attempt to get profile photo
    let photoURL = "";
    try {
        const photos = await bot.getUserProfilePhotos(userId);
        if (photos.total_count > 0) {
            const fileId = photos.photos[0][0].file_id;
            const file = await bot.getFile(fileId);
            photoURL = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        }
    } catch (err) { console.log("Photo fetch failed"); }

    await createOrEnsureUser(userId, firstName, photoURL, referralId);

    const welcomeImg = "https://i.ibb.co/932298pT/file-32.jpg";
    const caption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

    const options = {
        caption: caption,
        reply_markup: {
            inline_keyboard: [
                [{ text: "▶ Open App", web_app: { url: APP_URL } }],
                [{ text: "📢 Channel", url: "https://t.me/finisher_tech" }],
                [{ text: "🌐 Community", url: "https://t.me/finisher_techg" }]
            ]
        }
    };

    bot.sendPhoto(msg.chat.id, welcomeImg, options);
}

// --- REFERRAL WORKER ---
// Runs every 5 seconds to check for users who opened the app but haven't triggered reward yet
setInterval(async () => {
    try {
        const q = query(
            collection(db, "users"), 
            where("frontendOpened", "==", true),
            where("rewardGiven", "==", false)
        );

        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((userDoc) => {
            if (userDoc.data().refferBy) {
                rewardReferrer(userDoc);
            } else {
                // If no referrer, just mark rewarded so we don't query it again
                updateDoc(doc(db, "users", userDoc.id), { rewardGiven: true });
            }
        });
    } catch (err) {
        console.error("Worker Error:", err);
    }
}, 5000);

console.log("Backend Worker and Bot are active...");

