
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export async function GET({ request }) {
    // Check for Secret Key
    if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
        return json({ error: 'Stripe configuration missing' }, { status: 500 });
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);

    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const userDoc = await adminDb.collection('users').doc(uid).get();
        const userData = userDoc.data();
        const customerId = userData?.stripeCustomerId;

        if (!customerId) {
            return json({ subscribed: false });
        }

        // Fetch subscriptions from Stripe
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 1,
        });

        if (subscriptions.data.length === 0) {
            // Check for one-time payments (Season plan might be handled as 'payment' mode)
            // For now, let's just return if no active subscription
            return json({ subscribed: false, hasCustomerId: true });
        }

        const sub = subscriptions.data[0] as any;

        return json({
            subscribed: true,
            status: sub.status,
            current_period_end: sub.current_period_end, // Unix timestamp
            plan: (sub.metadata?.plan === 'pro') ? 'premium' : (sub.metadata?.plan || 'free'),
            cancel_at_period_end: sub.cancel_at_period_end
        });
    } catch (error: any) {
        console.error('Error fetching subscription details:', error);
        return json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
