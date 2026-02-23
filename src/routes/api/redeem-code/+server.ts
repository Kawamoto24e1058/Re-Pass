import { json } from "@sveltejs/kit";
import { adminAuth, adminDb } from "$lib/server/firebase-admin";
import { FieldValue, Transaction } from "firebase-admin/firestore";

export async function POST({ request }) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return json(
                { error: "認証が必要です。" },
                { status: 401 },
            );
        }

        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const { code } = await request.json();

        if (!code || typeof code !== "string" || code.trim() === "") {
            return json(
                { error: "プロモコードを入力してください。" },
                { status: 400 },
            );
        }

        const upperCode = code.trim().toUpperCase();
        const promoCodeRef = adminDb.collection("promo_codes").doc(upperCode);
        const userRef = adminDb.collection("users").doc(uid);

        let targetPlan = "";

        // Transaction for Atomic Updates
        await adminDb.runTransaction(async (t: any) => {
            const promoDoc = await t.get(promoCodeRef as any);

            if (!promoDoc.exists) {
                throw new Error("PROMO_NOT_FOUND");
            }

            const data = promoDoc.data();

            if (!data?.isActive) {
                throw new Error("PROMO_INACTIVE");
            }

            const maxUses = data.maxUses || 0;
            const usedCount = data.usedCount || 0;

            if (maxUses > 0 && usedCount >= maxUses) {
                throw new Error("PROMO_LIMIT_REACHED");
            }

            targetPlan = data.targetPlan;

            if (!targetPlan) {
                throw new Error("PROMO_INVALID_PLAN");
            }

            // Update user plan
            t.set(userRef, { plan: targetPlan }, { merge: true });

            // Increment promo code used count
            t.update(promoCodeRef, { usedCount: FieldValue.increment(1) });
        });

        return json({
            success: true,
            message: "プロモコードが適用されました！",
            targetPlan: targetPlan,
        });
    } catch (e: any) {
        console.error("Redeem Code Error:", e);

        let errorMsg = "プロモコードの適用に失敗しました。";
        let status = 500;

        switch (e.message) {
            case "PROMO_NOT_FOUND":
                errorMsg = "無効なプロモコードです。";
                status = 404;
                break;
            case "PROMO_INACTIVE":
                errorMsg = "このプロモコードは現在無効です。";
                status = 400;
                break;
            case "PROMO_LIMIT_REACHED":
                errorMsg = "このプロモコードは使用上限に達しています。";
                status = 400;
                break;
            case "PROMO_INVALID_PLAN":
                errorMsg = "プロモコードの設定が不正です。(プラン未設定)";
                status = 500;
                break;
        }

        return json({ error: errorMsg }, { status });
    }
}
