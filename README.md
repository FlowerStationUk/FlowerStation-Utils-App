# FlowerStation Utils - Bulk Discount Management

A Shopify app for managing bulk discount codes efficiently. This app allows you to create multiple discount codes from a master discount, organize them into sets, and manage them through a clean interface.

## 🌟 Features

- **Bulk Discount Creation**: Generate multiple discount codes from a master discount
- **CSV Import**: Upload CSV files with discount codes for easy bulk processing
- **Discount Sets**: Organize discounts into named sets for better management  
- **Single-Use Enforcement**: All generated discounts are automatically set to single-use
- **GraphQL API Integration**: Uses Shopify's GraphQL API for all operations
- **PostgreSQL Storage**: Stores discount records in your PostgreSQL database
- **Bulk Operations**: Delete individual discounts or entire sets
- **Utility Tools**: Helper page to easily find and copy discount IDs

## 🚀 Setup Instructions

### 1. Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_PUBLIC_URL=your_postgresql_connection_string

# Shopify App Configuration  
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SCOPES=write_discounts,read_discounts,write_price_rules,read_price_rules

# App URLs
SHOPIFY_APP_URL=https://your-app-domain.com
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret

# Session Storage
SESSION_SECRET=your_session_secret
```

### 2. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run database migration
npx prisma migrate deploy
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Development

```bash
npm run dev
```

## 📋 Required Shopify App Scopes

The app requires these scopes in your `shopify.app.toml`:

```toml
[access_scopes]
scopes = "write_discounts,read_discounts,write_price_rules,read_price_rules"
```

## 🔧 How to Use

### 1. Getting Master Discount ID

1. Navigate to **Utility Helpers** page
2. Click **Fetch All Discounts** 
3. Find your master discount and copy its ID
4. The ID format will be: `gid://shopify/DiscountCodeNode/...`

### 2. Creating Bulk Discounts

1. Go to **Bulk Discount** page
2. Enter the Master Discount ID
3. Provide a name for your discount set
4. Upload a CSV file with your discount codes
5. Review the preview and click **Generate All Discounts**

### 3. CSV Format

Your CSV can use any of these formats:

**One code per line:**
```
SAVE10WINTER
HOLIDAY20  
BLACKFRIDAY25
```

**Comma-separated:**
```
SAVE10WINTER,HOLIDAY20,BLACKFRIDAY25
```

**Mixed format:**
```
SAVE10WINTER,HOLIDAY20
BLACKFRIDAY25
CYBER30,NEWYEAR15
```

### 4. Managing Discounts

- View all discount sets on the main Bulk Discount page
- Delete individual discounts using the "Delete" button
- Delete entire sets using "Delete Set" (removes all discounts in Shopify)
- Monitor discount status (PENDING, CREATED, FAILED)

## ⚠️ Important Notes

- **Single-Use Only**: All generated discounts are automatically set to single-use regardless of the master discount settings
- **Master Discount**: The original master discount is used as a template - its settings are copied to new discounts
- **Error Handling**: Failed discount creations are logged with error messages
- **Shopify Sync**: Deleting from the app also removes discounts from Shopify

## 🗄️ Database Schema

The app uses these main tables:

- **DiscountSet**: Groups of related discounts
- **Discount**: Individual discount records with Shopify sync status
- **Session**: Shopify app session data

## 🔗 API Endpoints

- `GET /app/bulk-discount` - Main bulk discount management page
- `POST /app/bulk-discount` - Actions: create_discounts, delete_discount_set, delete_single_discount
- `GET /app/utility-helpers` - Utility tools page  
- `POST /app/utility-helpers` - Actions: fetch_discounts

## 💾 Tech Stack

- **Frontend**: React Router + Polaris Web Components
- **Backend**: Node.js + GraphQL
- **Database**: PostgreSQL + Prisma ORM
- **API**: Shopify GraphQL Admin API
- **Authentication**: Shopify App Bridge

## 🐛 Troubleshooting

### Common Issues:

1. **Migration Errors**: Ensure you're using PostgreSQL and have cleared any SQLite migrations
2. **Scope Errors**: Verify your app has the correct discount scopes approved
3. **Discount Creation Failures**: Check that the master discount ID is valid and accessible
4. **CSV Parsing Issues**: Ensure codes don't contain special characters or excessive whitespace

### Getting Help:

- Check the browser console for detailed error messages
- Verify your environment variables are correctly set
- Test with a simple master discount first
- Use the Utility Helpers page to validate discount IDs

---

Built with ❤️ for FlowerStation