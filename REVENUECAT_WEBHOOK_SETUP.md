# RevenueCat Webhook Setup Guide

## Overview
This guide explains how to configure RevenueCat webhooks to automatically sync subscription status with your application.

## Environment Configuration

### 1. Add Webhook Secret to `.env`

Add the following environment variable to your `.env` file in the `api` directory:

```env
REVENUECAT_WEBHOOK_SECRET=your_secure_random_string_here
```

**Generate a secure secret:**
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32
```

## RevenueCat Dashboard Configuration

### 2. Configure Webhook in RevenueCat

1. Log in to [RevenueCat Dashboard](https://app.revenuecat.com)
2. Navigate to your project
3. Go to **Integrations** → **Webhooks**
4. Click **+ New**
5. Configure the webhook:

   **Webhook URL:**
   ```
   https://your-api-domain.com/subscription/revenuecat/webhook
   ```

   **Authorization Header:**
   ```
   Bearer your_secure_random_string_here
   ```
   *(Use the same value as `REVENUECAT_WEBHOOK_SECRET` from your `.env` file)*

### 3. Select Events to Listen

Enable the following event types:
- ✅ **INITIAL_PURCHASE** - User purchases premium for the first time
- ✅ **RENEWAL** - Auto-renewal succeeded
- ✅ **CANCELLATION** - Subscription canceled (user keeps access until expiration)
- ✅ **BILLING_ISSUE** - Payment failed but user is in grace period
- ✅ **EXPIRATION** - Subscription fully expired
- ✅ **PRODUCT_CHANGE** - User upgraded/downgraded subscription
- ✅ **NON_RENEWING_PURCHASE** - One-time purchase completed

### 4. Save and Test

1. Click **Save**
2. Use the **Test** button in RevenueCat dashboard to send a test webhook
3. Check your API logs to confirm receipt

## Webhook Endpoint Details

**URL:** `POST /subscription/revenuecat/webhook`

**Authentication:** Bearer token in Authorization header

**Request Body Example:**
```json
{
  "api_version": "1.0",
  "event": {
    "type": "INITIAL_PURCHASE",
    "app_user_id": "user-uuid-here",
    "product_id": "premium_monthly",
    "period_type": "normal",
    "purchased_at_ms": 1609459200000,
    "expiration_at_ms": 1612137600000,
    "store": "app_store",
    "environment": "production"
  }
}
```

**Response:**
```json
{
  "received": true
}
```

## Event Handling Logic

### INITIAL_PURCHASE
- Sets `isPremium` to `true`
- Sets `premiumUntil` to expiration date from webhook

### RENEWAL
- Sets `isPremium` to `true`
- Updates `premiumUntil` to new expiration date

### CANCELLATION
- Logs the cancellation
- **Does NOT revoke premium immediately**
- User keeps premium access until expiration
- Actual revocation happens on EXPIRATION event

### BILLING_ISSUE
- Logs the billing issue
- **Keeps premium active** during grace period
- RevenueCat will send EXPIRATION if billing isn't resolved

### EXPIRATION
- Sets `isPremium` to `false`
- Sets `premiumUntil` to `null`

### PRODUCT_CHANGE
- Updates subscription with new expiration date
- Maintains premium status

## User ID Mapping

**Important:** The `app_user_id` sent by RevenueCat must match the user's `id` (UUID) in your database.

When configuring RevenueCat SDK in your mobile app, ensure you set the app user ID:

```typescript
// In your mobile app
import Purchases from 'react-native-purchases';

// After user authentication
await Purchases.logIn(userId); // Use the UUID from your database
```

## Testing

### Test with cURL

```bash
curl -X POST https://your-api-domain.com/subscription/revenuecat/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secure_random_string_here" \
  -d '{
    "api_version": "1.0",
    "event": {
      "type": "INITIAL_PURCHASE",
      "app_user_id": "test-user-uuid",
      "expiration_at_ms": 1704067200000
    }
  }'
```

### Expected Response

```json
{
  "received": true
}
```

## Monitoring

Check your application logs for webhook events:

```bash
# View logs
tail -f logs/application.log | grep "RevenueCat webhook"
```

You should see log entries like:
```
[SubscriptionController] Received RevenueCat webhook: INITIAL_PURCHASE for user abc-123-def
[SubscriptionService] Handling INITIAL_PURCHASE for user abc-123-def
[SubscriptionService] Successfully updated premium status for user abc-123-def
```

## Security Considerations

1. **Keep your webhook secret secure** - Never commit it to version control
2. **Use HTTPS** - Always use HTTPS in production
3. **Validate all requests** - The controller validates the Authorization header
4. **Monitor for unauthorized attempts** - Check logs for failed authentication

## Troubleshooting

### Webhook returns 401 Unauthorized
- Check that `REVENUECAT_WEBHOOK_SECRET` is set in your `.env` file
- Verify the Authorization header in RevenueCat matches your secret
- Ensure you're using `Bearer your_secret` format

### User not found error
- Verify that `app_user_id` in RevenueCat matches the user UUID in your database
- Check that you're calling `Purchases.logIn(userId)` in your mobile app

### Webhook not being received
- Verify your API is publicly accessible
- Check firewall/security group rules
- Test the endpoint with cURL
- Check RevenueCat webhook logs in their dashboard

## Database Schema

The webhook updates the following fields in the `user` table:

| Field | Type | Description |
|-------|------|-------------|
| `isPremium` | boolean | Whether user has active premium subscription |
| `premiumUntil` | timestamp | When premium subscription expires (null if not premium) |

## Additional Resources

- [RevenueCat Webhooks Documentation](https://docs.revenuecat.com/docs/webhooks)
- [RevenueCat Event Types](https://docs.revenuecat.com/docs/event-types)

