/**
 * Generic retry utility with exponential backoff.
 * @param operation Function to retry.
 * @param retries Maximum number of retries (default: 3).
 * @param delay Initial delay in ms (default: 1000).
 * @param factor Multiplier for delay (default: 2).
 */
export async function retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000,
    factor: number = 2
): Promise<T> {
    let currentAttempt = 0;
    while (currentAttempt < retries) {
        try {
            return await operation();
        } catch (error) {
            currentAttempt++;
            console.warn(`Attempt ${currentAttempt} failed. Retrying in ${delay}ms...`, error);
            if (currentAttempt >= retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= factor;
        }
    }
    throw new Error('Operation failed after retries');
}
