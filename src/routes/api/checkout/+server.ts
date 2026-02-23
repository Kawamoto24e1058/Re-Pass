
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { adminAuth } from '$lib/server/firebase-admin';
import {
    PUBLIC_STRIPE_PRICE_SEASON,
    PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY,
    PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON,
    PUBLIC_BASE_URL
} from "$env/static/public";

export async function POST({ request, url }) {
    // Check for Secret Key
    // Using $env/dynamic/private ensures it's only available on the server
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey || secretKey === 'sk_test_placeholder') {
        console.error('Stripe API Key is missing. Check your .env file or Vercel environment variables.');
        return json({ error: 'Stripe configuration missing' }, { status: 500 });
    }

    const stripe = new Stripe(secretKey);

    try {
        const { priceId, userId: bodyUserId, email, isUpgrade } = await request.json();
        const baseUrl = url.origin;

        // --- Auth Check (Prefer ID Token) ---
        let userId = bodyUserId;
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                userId = decodedToken.uid; // Prioritize token UID
                console.log(`Verified UID from token: ${userId}`);
            } catch (e) {
                console.warn('Auth token verification failed in checkout:', e);
                // Fallback to bodyUserId if token is invalid but present
            }
        }

        if (!priceId || !userId) {
            return json({ error: 'Missing required parameters' }, { status: 400 });
        }

        const mode = 'subscription';
        // Determine target plan for metadata
        const ULTIMATE_MONTHLY = PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY;
        const ULTIMATE_SEASON = PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON;
        const targetPlan = (priceId === ULTIMATE_MONTHLY || priceId === ULTIMATE_SEASON) ? 'ultimate' : 'premium';

        // Prepare session payload
        const sessionPayload: Stripe.Checkout.SessionCreateParams = {
            payment_method_types: ['card'],
            currency: 'jpy',
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: mode as Stripe.Checkout.SessionCreateParams.Mode,
            success_url: `${baseUrl}/settings/subscription?success=true`,
            cancel_url: `${baseUrl}/pricing`,
            customer_email: email,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                plan: targetPlan,
                priceId: priceId,
                isUpgrade: isUpgrade ? "true" : "false" // Tag this session as an upgrade
            }
        };

        // Example discount attachment for future scaling:
        // if (isUpgrade && targetPlan === 'ultimate') {
        //   sessionPayload.discounts = [{ coupon: 'YOUR_STRIPE_COUPON_ID' }];
        // }

        const session = await stripe.checkout.sessions.create(sessionPayload);

        return json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe Checkout Error:', error);
        return json({ error: error.message }, { status: 500 });
    }
}
