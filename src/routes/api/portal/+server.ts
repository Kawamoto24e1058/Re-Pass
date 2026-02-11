
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

export async function POST({ request, url }) {
    // Initialize Stripe
    const stripe = new Stripe(env.STRIPE_SECRET_KEY as string);

    try {
        const { customerId } = await request.json();

        if (!customerId) {
            // Fallback: Redirect to pricing if no ID starts
            return json({ url: '/pricing' });
        }

        // Create a billing portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${url.origin}/settings`, // Return to settings page
        });

        return json({ url: session.url });
    } catch (error) {
        console.error('Error creating portal session:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
