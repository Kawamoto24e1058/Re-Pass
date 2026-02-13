
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import {
    PUBLIC_STRIPE_PRICE_SEASON,
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
        const { priceId, userId, email } = await request.json();
        const baseUrl = PUBLIC_BASE_URL || url.origin;

        if (!priceId || !userId) {
            return json({ error: 'Missing required parameters' }, { status: 400 });
        }

        // Determine mode based on priceId
        // The Season plan is a one-time payment ('payment'), while others are subscriptions
        const isSeason = priceId === PUBLIC_STRIPE_PRICE_SEASON;
        const mode = isSeason ? 'payment' : 'subscription';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: isSeason ? ['card', 'paypay'] : ['card'],
            currency: 'jpy',
            line_items: [
                isSeason
                    ? {
                        price_data: {
                            currency: 'jpy',
                            product_data: {
                                name: 'Season Pass (6 Months)',
                                description: '1学期＋α（6ヶ月）フルサポート・一括払い',
                            },
                            unit_amount: 1500,
                        },
                        quantity: 1,
                    }
                    : {
                        price: priceId,
                        quantity: 1,
                    },
            ],
            mode: mode as any,
            success_url: `${baseUrl}/settings/subscription?success=true`,
            cancel_url: `${baseUrl}/pricing`,
            customer_email: email,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                plan: isSeason ? 'season' : 'premium'
            }
        } as any);

        return json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe Checkout Error:', error);
        return json({ error: error.message }, { status: 500 });
    }
}
