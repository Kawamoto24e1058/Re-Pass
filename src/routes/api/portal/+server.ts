
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export async function POST({ request, url }) {
    // Check for Secret Key
    if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
        console.error('Stripe API Key is missing. Check your .env file.');
        return json({ error: 'Stripe configuration missing' }, { status: 500 });
    }

    // Initialize Stripe
    const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);

    try {
        // Get the ID Token from the Authorization header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Fetch user data from Firestore to get the customer ID
        const userDoc = await adminDb.collection('users').doc(uid).get();
        const userData = userDoc.data();
        let customerId = userData?.stripeCustomerId;

        if (!customerId) {
            console.log(`No stripeCustomerId found for user ${uid}. Creating new customer...`);
            // If no customer ID, create one in Stripe
            const customer = await stripe.customers.create({
                email: userData?.email || decodedToken.email,
                name: userData?.displayName || decodedToken.name,
                metadata: {
                    userId: uid
                }
            });
            customerId = customer.id;

            // Save the new customer ID to Firestore
            await adminDb.collection('users').doc(uid).update({
                stripeCustomerId: customerId
            });
            console.log(`Successfully created and saved Stripe customer ${customerId} for user ${uid}`);
        }

        const baseUrl = PUBLIC_BASE_URL || url.origin;

        // Create a billing portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${baseUrl}/settings/subscription`, // Return to subscription management page
        });

        return json({ url: session.url });
    } catch (error: any) {
        console.error('Portal Session Creation Failed:', {
            uid: error.uid, // might not exist
            message: error.message,
            stack: error.stack
        });
        return json({ error: `現在、お支払い管理画面の準備ができません。しばらくしてから再度お試しください。(${error.message})` }, { status: 500 });
    }
}
