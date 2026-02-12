
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import admin, { adminDb } from '$lib/server/firebase-admin';

const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);
const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST({ request }) {
    const signature = request.headers.get('stripe-signature');
    if (!signature || !endpointSecret) {
        return json({ error: 'Missing signature or secret' }, { status: 400 });
    }

    let event;
    try {
        const body = await request.text();
        event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const plan = session.metadata?.plan; // 'premium' or 'season'
        const customerId = session.customer as string;
        const subscriptionId = (session.subscription as string) || session.id;

        if (!userId || !plan) {
            console.error('Missing userId or plan in session metadata');
            return json({ received: true });
        }

        try {
            await adminDb.collection('users').doc(userId).set({
                plan: plan,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            console.log(`User ${userId} upgraded to ${plan} plan successfuly.`);
        } catch (error) {
            console.error('Error updating user plan in Firestore:', error);
            return json({ error: 'Firestore update failed' }, { status: 500 });
        }
    }

    return json({ received: true });
}
