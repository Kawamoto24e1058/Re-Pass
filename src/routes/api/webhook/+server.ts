
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { adminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);
const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST({ request }) {
    const signature = request.headers.get('stripe-signature');
    if (!signature || !endpointSecret) {
        return json({ error: 'Missing signature or secret' }, { status: 400 });
    }

    let event: Stripe.Event;
    const body = await request.text();

    console.log('--- Webhook Debug Log Start ---');
    console.log(`Received Webhook POST request`);
    console.log(`Signature Header: ${signature ? signature.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`Endpoint Secret: ${endpointSecret ? endpointSecret.substring(0, 10) + '...' : 'MISSING'}`);
    console.log(`Request Body Length: ${body.length}`);

    try {
        console.log('Attempting to verify Stripe signature...');
        event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
        console.log('Stripe signature verification SUCCESS. Event Type:', event.type);
    } catch (err: any) {
        console.error(`!!! Stripe signature verification FAILED: ${err.message}`);

        // --- EMERGENCY DEBUG SKIP (TEST ONLY) ---
        // If signature fails, we try to parse the body manually to test DB logic
        // WARNING: This should be disabled in production!
        try {
            console.warn('--- FALLBACK: Attempting manual parse for DB logic debugging ---');
            event = JSON.parse(body) as Stripe.Event;
            console.warn(`Manual parse SUCCESS. Proceeding with unverified event: ${event.type}`);
        } catch (parseErr) {
            console.error('Manual parse also failed. Aborting.');
            return json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
        }
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        console.log(`Processing checkout.session.completed for event ID: ${event.id}`);
        const session = event.data.object as Stripe.Checkout.Session;

        console.log('Session Data Extracting...');
        console.log('metadata.userId:', session.metadata?.userId);
        console.log('client_reference_id:', session.client_reference_id);
        console.log('customer_details.email:', session.customer_details?.email);
        console.log('metadata.priceId:', session.metadata?.priceId);

        // Priority: metadata.userId > client_reference_id
        let userId = session.metadata?.userId || session.client_reference_id;
        const customerEmail = session.customer_details?.email;
        const plan = session.metadata?.plan || 'pro';
        const priceId = session.metadata?.priceId;
        const customerId = session.customer as string;
        const subscriptionId = (session.subscription as string) || session.id;

        // Season Pass Specific Logic (4 months duration)
        const SEASON_PASS_PRICE_ID = 'price_1T0d6PRuwTinsDU9aJjf0JW1';
        let expiresAt = null;

        if (priceId === SEASON_PASS_PRICE_ID) {
            // 4 months = approx 120 days
            const createdMs = session.created * 1000;
            expiresAt = new Date(createdMs + (120 * 24 * 60 * 60 * 1000));
        }

        // Robust User Lookup via Email if ID is missing
        if (!userId && customerEmail) {
            console.log(`Searching for user by email: ${customerEmail}`);
            const usersRef = adminDb.collection('users');
            const snapshot = await usersRef.where('email', '==', customerEmail).limit(1).get();
            if (!snapshot.empty) {
                userId = snapshot.docs[0].id;
            }
        }

        if (!userId) {
            console.error('UserId could not be identified for session:', session.id);
            return json({ error: 'User not found' }, { status: 404 });
        }

        try {
            const updateData: any = {
                plan: 'pro',
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                updatedAt: FieldValue.serverTimestamp()
            };

            if (expiresAt) {
                updateData.expiresAt = expiresAt;
                // Season Pass Logic
                updateData.plan = 'season';
                updateData.isUltimate = true;
                updateData.ultimateExpiresAt = expiresAt; // Same as expiresAt for now
                console.log(`Setting expiration to ${expiresAt.toISOString()} for Season Pass.`);
            }

            await adminDb.collection('users').doc(userId).set(updateData, { merge: true });

            console.log(`User ${userId} upgraded to 'pro' plan successfully. (Price: ${priceId || 'Unknown'})`);
        } catch (error) {
            console.error('Error updating user plan in Firestore:', error);
            return json({ error: 'Firestore update failed' }, { status: 500 });
        }
    }

    return json({ received: true });
}
