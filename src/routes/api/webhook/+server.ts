
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { adminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

import {
    PUBLIC_STRIPE_PRICE_PREMIUM,
    PUBLIC_STRIPE_PRICE_SEASON,
    PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY,
    PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON
} from '$env/static/public';

const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);
const endpointSecret = env.STRIPE_WEBHOOK_SECRET?.trim();

export async function POST({ request }) {
    const signature = request.headers.get('stripe-signature');
    if (!signature || !endpointSecret) {
        return json({ error: 'Missing signature or secret' }, { status: 400 });
    }

    let event: Stripe.Event;
    // Use arrayBuffer and Buffer for reliable raw body handling in SvelteKit
    const arrayBuffer = await request.arrayBuffer();
    const body = Buffer.from(arrayBuffer);

    console.log('--- Webhook Debug Log Start ---');
    console.log(`Received Webhook POST request`);
    console.log(`Signature Header: ${signature ? signature.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`Endpoint Secret: ${endpointSecret ? endpointSecret.substring(0, 10) + '...' : 'MISSING'}`);
    console.log(`Request Body Length: ${body.length}`);

    try {
        event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
        console.log('Stripe signature verification SUCCESS. Event Type:', event.type);
    } catch (err: any) {
        console.error(`!!! Stripe signature verification FAILED: ${err.message}`);
        return json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
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
        console.log('--- UID Identification ---');
        console.log('session.metadata?.userId:', session.metadata?.userId);
        console.log('session.client_reference_id:', session.client_reference_id);

        let userId = session.metadata?.userId || session.client_reference_id;
        if (userId) {
            console.log(`Found UID: ${userId}`);
        } else {
            console.warn('UID not found in metadata or client_reference_id. Attempting email lookup...');
        }

        const customerEmail = session.customer_details?.email;
        const plan = session.metadata?.plan || '';
        const priceId = session.metadata?.priceId;
        const customerId = session.customer as string;
        const subscriptionId = (session.subscription as string) || session.id;

        // Price IDs from static public env (aligned with frontend)
        const PREMIUM_MONTHLY_PRICE_ID = PUBLIC_STRIPE_PRICE_PREMIUM;
        const PREMIUM_SEASON_PRICE_ID = PUBLIC_STRIPE_PRICE_SEASON;
        const ULTIMATE_MONTHLY_PRICE_ID = PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY;
        const ULTIMATE_SEASON_PRICE_ID = PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON;

        let finalPlan = plan.toLowerCase().trim();

        console.log('--- Plan Detection ---');
        console.log('Initial plan from metadata:', finalPlan);
        console.log('PriceId from metadata:', priceId);

        // --- Plan Detection Fallback (Priority: metadata.plan > priceId) ---
        if (finalPlan === 'ultimate') {
            // Already set
        } else if (finalPlan === 'premium' || finalPlan === 'pro') {
            finalPlan = 'premium';
        } else if (priceId) {
            // Map priceId to plan if metadata.plan was missing or invalid
            if (priceId === ULTIMATE_MONTHLY_PRICE_ID || priceId === ULTIMATE_SEASON_PRICE_ID) {
                finalPlan = 'ultimate';
            } else if (priceId === PREMIUM_MONTHLY_PRICE_ID || priceId === PREMIUM_SEASON_PRICE_ID) {
                finalPlan = 'premium';
            }
        }

        console.log('Final determined plan:', finalPlan);

        // Final safety fallback
        if (!finalPlan) finalPlan = 'free';

        // Set Ultimate flag (legacy support but derived from finalPlan)
        const isUltimate = finalPlan === 'ultimate';

        // Handle Expiry for Season Passes (6 months / 180 days as per requirement)
        let expiresAt = null;
        if (priceId === ULTIMATE_SEASON_PRICE_ID || priceId === PREMIUM_SEASON_PRICE_ID) {
            const createdMs = session.created * 1000;
            expiresAt = new Date(createdMs + (180 * 24 * 60 * 60 * 1000)); // 6 months
        }

        // Robust User Lookup via Email if ID is missing
        if (!userId && customerEmail) {
            console.log(`Searching for user by email: ${customerEmail}`);
            const usersRef = adminDb.collection('users');
            const snapshot = await usersRef.where('email', '==', customerEmail).limit(1).get();
            if (!snapshot.empty) {
                userId = snapshot.docs[0].id;
                console.log(`Identified user via email: ${userId}`);
            } else {
                console.error(`User with email ${customerEmail} not found in Firestore.`);
            }
        }

        if (!userId) {
            console.error('UserId could not be identified for session:', session.id);
            return json({ error: 'User not found' }, { status: 404 });
        }

        try {
            const updateData: any = {
                plan: finalPlan, // Use the determined plan
                isUltimate: isUltimate, // Explicitly set flag
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                updatedAt: FieldValue.serverTimestamp()
            };
            // Explicitly REMOVE/RESET isPro to avoid confusion
            updateData.isPro = false;

            if (expiresAt) {
                updateData.ultimateExpiresAt = expiresAt; // User requested 'ultimateExpiresAt'
                updateData.expiresAt = expiresAt; // Keep generic one too for compatibility
            }

            console.log("Updating Plan for User:", userId, "to:", finalPlan);
            await adminDb.collection('users').doc(userId).set(updateData, { merge: true });
            console.log(`Successfully updated user ${userId} to plan ${finalPlan}`);
        } catch (error) {
            console.error('Error updating user in Firestore:', error);
            return json({ error: 'Database update failed' }, { status: 500 });
        }

        return json({ received: true });
    }

    return json({ received: true });
}
